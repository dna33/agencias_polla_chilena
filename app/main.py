from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse

from app.analytics import Timer
from app.config import settings
from app.database import ensure_database
from app.fallback_geo import FallbackGeocoder
from app.intent import wants_nearest_agency
from app.models import QueryLog
from app.repository import QueryLogRepository
from app.service import AgencySearchService
from app.whatsapp import send_text_message

search_service = AgencySearchService()
fallback_geocoder = FallbackGeocoder()
query_log_repository = QueryLogRepository()


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_database()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/demo", response_class=HTMLResponse)
def demo_page() -> str:
    return DEMO_HTML


@app.get("/webhooks/whatsapp")
def verify_webhook(
    hub_mode: str = Query(alias="hub.mode"),
    hub_verify_token: str = Query(alias="hub.verify_token"),
    hub_challenge: str = Query(alias="hub.challenge"),
):
    if hub_mode == "subscribe" and hub_verify_token == settings.whatsapp_verify_token:
        return PlainTextResponse(hub_challenge)
    raise HTTPException(status_code=403, detail="Invalid verification token")


@app.post("/webhooks/whatsapp")
async def receive_whatsapp_message(request: Request):
    timer = Timer()
    payload = await request.json()
    responses: list[str] = []

    try:
        for message in _extract_messages(payload):
            phone = message["from"]
            text = message.get("text")
            location = message.get("location")
            body = handle_incoming_message(phone, text, location)
            send_text_message(phone, body)
            responses.append(body)
    except Exception as exc:
        query_log_repository.create(
            QueryLog(
                incoming_text=None,
                error_message=str(exc),
                response_time_ms=timer.elapsed_ms(),
                metadata_json={"payload": payload},
            )
        )
        raise

    return JSONResponse({"status": "processed", "responses": responses})


@app.post("/search")
async def search_nearest(payload: dict):
    latitude = float(payload["latitude"])
    longitude = float(payload["longitude"])
    body, results = search_service.find_and_format(latitude, longitude, datetime.now(settings.timezone))
    return {"message": body, "count": len(results)}


@app.post("/demo/message")
async def demo_message(payload: dict):
    response = build_conversation_response(
        "demo-user",
        payload.get("text"),
        _coerce_location(payload.get("latitude"), payload.get("longitude")),
    )
    return response


def handle_incoming_message(phone: str, text: str | None, location: dict | None) -> str:
    return build_conversation_response(phone, text, location)["reply"]


def build_conversation_response(phone: str, text: str | None, location: dict | None) -> dict[str, object]:
    timer = Timer()
    if location:
        latitude = float(location["latitude"])
        longitude = float(location["longitude"])
        body, results = search_service.find_and_format(latitude, longitude, datetime.now(settings.timezone))
        structured_results = search_service.serialize_results(results)
        query_log_repository.create(
            QueryLog(
                user_phone=phone,
                incoming_text=text,
                had_location=True,
                user_latitude=latitude,
                user_longitude=longitude,
                recommended_agency_id=results[0].agency.id if results else None,
                alternative_agency_ids=[result.agency.id for result in results[1:]] if len(results) > 1 else [],
                response_time_ms=timer.elapsed_ms(),
            )
        )
        return {
            "reply": body,
            "mode": "location",
            "resolved_location": {
                "latitude": latitude,
                "longitude": longitude,
                "label": "Ubicación compartida",
                "strategy": "location",
            },
            "results": structured_results,
        }

    if wants_nearest_agency(text):
        body = "Compárteme tu ubicación y te digo la agencia abierta más cercana."
        query_log_repository.create(
            QueryLog(
                user_phone=phone,
                incoming_text=text,
                had_location=False,
                response_time_ms=timer.elapsed_ms(),
            )
        )
        return {
            "reply": body,
            "mode": "prompt_location",
            "resolved_location": None,
            "results": [],
        }
    else:
        resolved_location = fallback_geocoder.resolve(text)
        if resolved_location:
            body, results = search_service.find_and_format(
                resolved_location.latitude,
                resolved_location.longitude,
                datetime.now(settings.timezone),
            )
            structured_results = search_service.serialize_results(results)
            prefixed_body = f"Tomé '{resolved_location.label}' como referencia.\n\n{body}"
            query_log_repository.create(
                QueryLog(
                    user_phone=phone,
                    incoming_text=text,
                    had_location=False,
                    user_latitude=resolved_location.latitude,
                    user_longitude=resolved_location.longitude,
                    recommended_agency_id=results[0].agency.id if results else None,
                    alternative_agency_ids=[result.agency.id for result in results[1:]] if len(results) > 1 else [],
                    response_time_ms=timer.elapsed_ms(),
                    metadata_json={"fallback_strategy": resolved_location.strategy},
                )
            )
            return {
                "reply": prefixed_body,
                "mode": "fallback_geo",
                "resolved_location": {
                    "latitude": resolved_location.latitude,
                    "longitude": resolved_location.longitude,
                    "label": resolved_location.label,
                    "strategy": resolved_location.strategy,
                },
                "results": structured_results,
            }
        body = "Puedo decirte la agencia abierta más cercana. Envíame tu ubicación."

    query_log_repository.create(
        QueryLog(
            user_phone=phone,
            incoming_text=text,
            had_location=False,
            response_time_ms=timer.elapsed_ms(),
        )
    )
    return {
        "reply": body,
        "mode": "fallback_prompt",
        "resolved_location": None,
        "results": [],
    }


def _extract_messages(payload: dict) -> list[dict]:
    messages: list[dict] = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for message in value.get("messages", []):
                messages.append(
                    {
                        "from": message.get("from", ""),
                        "text": message.get("text", {}).get("body"),
                        "location": message.get("location"),
                    }
                )
    return messages


def _coerce_location(latitude: object, longitude: object) -> dict[str, float] | None:
    if latitude is None or longitude is None:
        return None
    return {"latitude": float(latitude), "longitude": float(longitude)}


DEMO_HTML = """
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Demo Asistente Polla</title>
  <style>
    :root {
      --bg: #f5f2ea;
      --paper: #ffffff;
      --paper-soft: #faf7f1;
      --ink: #1d2430;
      --muted: #626d78;
      --brand-red: #d71920;
      --brand-red-dark: #a80f16;
      --brand-blue: #123d8f;
      --brand-gold: #ffcb05;
      --line: #d9dee7;
      --shadow: 0 20px 60px rgba(18, 39, 78, 0.10);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Trebuchet MS", "Arial Narrow", Arial, sans-serif;
      background:
        radial-gradient(circle at top left, rgba(255,203,5,0.18), transparent 30%),
        linear-gradient(180deg, #fff 0%, var(--bg) 100%);
      color: var(--ink);
      min-height: 100vh;
    }
    .page {
      max-width: 1240px;
      margin: 0 auto;
      padding: 24px 18px 40px;
    }
    .eyebrow {
      color: var(--brand-gold);
      font-size: 12px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-weight: 800;
    }
    .hero {
      background: linear-gradient(135deg, var(--brand-red) 0%, var(--brand-red-dark) 62%, var(--brand-blue) 100%);
      border-radius: 28px;
      padding: 28px;
      color: #fff;
      box-shadow: var(--shadow);
      overflow: hidden;
      position: relative;
      margin-bottom: 20px;
    }
    .hero::after {
      content: "";
      position: absolute;
      width: 360px;
      height: 360px;
      right: -140px;
      top: -160px;
      background: radial-gradient(circle, rgba(255,203,5,0.34), transparent 68%);
      pointer-events: none;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(260px, 0.8fr);
      gap: 18px;
      align-items: stretch;
      position: relative;
      z-index: 1;
    }
    h1 {
      font-size: clamp(34px, 5vw, 62px);
      line-height: 0.94;
      margin: 0;
      max-width: 8ch;
      text-transform: uppercase;
      letter-spacing: -0.03em;
    }
    .sub {
      max-width: 720px;
      font-size: 18px;
      color: rgba(255,255,255,0.88);
      line-height: 1.5;
      margin: 10px 0 0;
    }
    .hero-card {
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 22px;
      padding: 20px;
      display: grid;
      gap: 14px;
      align-content: space-between;
    }
    .hero-card .statline {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .hero-card .stat {
      background: rgba(255,255,255,0.10);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      padding: 12px;
    }
    .hero-card strong {
      display: block;
      font-size: 24px;
      margin-bottom: 4px;
    }
    .shell {
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }
    .panel {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
    }
    .panel-head {
      padding: 22px 22px 0;
    }
    .panel-head h2 {
      margin: 0;
      font-size: 25px;
      color: var(--brand-blue);
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .panel-head p {
      margin: 8px 0 0;
      color: var(--muted);
      line-height: 1.5;
    }
    .controls {
      padding: 18px 22px 22px;
      display: grid;
      gap: 14px;
    }
    label {
      display: grid;
      gap: 6px;
      font-size: 14px;
      color: var(--muted);
      font-weight: 700;
    }
    textarea, input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px 16px;
      background: var(--paper-soft);
      color: var(--ink);
      font: inherit;
    }
    textarea:focus, input:focus {
      outline: 3px solid rgba(255,203,5,0.28);
      border-color: var(--brand-blue);
    }
    textarea {
      min-height: 124px;
      resize: vertical;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 4px;
    }
    button {
      border: 0;
      border-radius: 999px;
      padding: 12px 18px;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
      transition: transform 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease;
    }
    button:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 20px rgba(18, 39, 78, 0.10);
    }
    button.primary {
      background: linear-gradient(180deg, var(--brand-red) 0%, var(--brand-red-dark) 100%);
      color: #fff;
    }
    button.secondary {
      background: #eef3ff;
      color: var(--brand-blue);
    }
    .chip {
      background: #fff8d5;
      border-radius: 999px;
      border: 1px solid #f0df8b;
      padding: 8px 12px;
      font-size: 13px;
      cursor: pointer;
      color: var(--brand-blue);
    }
    .workspace {
      display: grid;
      gap: 18px;
    }
    .conversation-panel {
      padding: 22px;
      display: grid;
      grid-template-columns: minmax(0, 0.92fr) minmax(310px, 0.88fr);
      gap: 18px;
      align-items: start;
    }
    .chat-wrap {
      display: grid;
      gap: 12px;
    }
    .chat {
      display: grid;
      gap: 14px;
      min-height: 440px;
      align-content: start;
      background:
        linear-gradient(180deg, #fff 0%, #fffaf3 100%);
      border: 1px solid var(--line);
      border-radius: 22px;
      padding: 18px;
      overflow: auto;
    }
    .bubble {
      max-width: 85%;
      padding: 14px 16px;
      border-radius: 18px;
      white-space: pre-wrap;
      line-height: 1.45;
      animation: rise 0.22s ease;
    }
    .user {
      justify-self: end;
      background: linear-gradient(180deg, var(--brand-blue) 0%, #0d2d69 100%);
      color: #fff;
      border-bottom-right-radius: 6px;
    }
    .bot {
      justify-self: start;
      background: #fff;
      border: 1px solid var(--line);
      border-bottom-left-radius: 6px;
    }
    .insights-grid {
      display: grid;
      gap: 14px;
      grid-template-rows: auto auto 1fr;
    }
    .summary {
      background: linear-gradient(180deg, #fff 0%, #f7f9fc 100%);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 16px;
      display: grid;
      gap: 8px;
    }
    .summary h3,
    .list-card h3 {
      margin: 0;
      font-size: 18px;
    }
    .summary p {
      margin: 0;
      color: var(--muted);
      line-height: 1.45;
    }
    .map-card {
      overflow: hidden;
      border-radius: 20px;
      border: 1px solid var(--line);
      background: #eef3ff;
      min-height: 250px;
    }
    iframe {
      width: 100%;
      height: 100%;
      min-height: 250px;
      border: 0;
    }
    .rank-panel {
      padding: 0 22px 22px;
    }
    .list-card {
      background: linear-gradient(180deg, #fff 0%, #fbfcfe 100%);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 16px;
      display: grid;
      gap: 12px;
    }
    .result-list {
      display: grid;
      gap: 10px;
    }
    .result-item {
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 14px;
      background: #fff;
      display: grid;
      gap: 6px;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .result-item:hover {
      transform: translateY(-1px);
      border-color: rgba(215,25,32,0.45);
      box-shadow: 0 8px 20px rgba(18, 39, 78, 0.08);
    }
    .result-item.active {
      border-color: var(--brand-red);
      box-shadow: 0 8px 24px rgba(215,25,32,0.10);
    }
    .result-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
    }
    .rank {
      width: 30px;
      height: 30px;
      border-radius: 999px;
      background: #fff5cc;
      display: inline-grid;
      place-items: center;
      font-size: 13px;
      color: var(--brand-blue);
      border: 1px solid #f0df8b;
      flex: 0 0 auto;
      font-weight: 800;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      border: 1px solid var(--line);
      background: #f7f8fb;
      color: var(--muted);
      white-space: nowrap;
      font-weight: 700;
    }
    .pill.open {
      background: rgba(18,61,143,0.08);
      color: var(--brand-blue);
      border-color: rgba(18,61,143,0.20);
    }
    .mini {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }
    .result-actions a {
      color: var(--brand-red);
      text-decoration: none;
      font-size: 14px;
      font-weight: 800;
    }
    .status {
      min-height: 22px;
      color: var(--muted);
      font-size: 14px;
    }
    .chips,
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .legend {
      padding: 0 22px 22px;
    }
    .legend .pill {
      font-size: 13px;
      background: #fff;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (max-width: 1100px) {
      .shell {
        grid-template-columns: 1fr;
      }
      .conversation-panel {
        grid-template-columns: 1fr;
      }
      .insights-grid {
        grid-template-columns: 1fr 1fr;
        grid-template-rows: auto auto;
      }
      .summary {
        grid-column: 1 / -1;
      }
    }
    @media (max-width: 760px) {
      .hero-grid { grid-template-columns: 1fr; }
      .row { grid-template-columns: 1fr; }
      .conversation-panel { padding: 18px; }
      .chat { min-height: 280px; }
      .insights-grid { grid-template-columns: 1fr; }
      .hero-card .statline { grid-template-columns: 1fr; }
      .panel-head,
      .controls,
      .rank-panel,
      .legend {
        padding-left: 18px;
        padding-right: 18px;
      }
      .actions button {
        width: 100%;
      }
      .result-head {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div class="hero-grid">
        <div>
          <div class="eyebrow">Demo interna</div>
          <h1>Asistente de agencias Polla</h1>
          <p class="sub">Simula el flujo de WhatsApp sin integrar Meta. Prueba mensajes, comuna o ubicación real y muestra al equipo cómo responde el motor de agencias abiertas más cercanas.</p>
        </div>
        <div class="hero-card">
          <div>
            <div class="eyebrow">Qué demuestra</div>
            <p style="margin:0; line-height:1.5;">Importación real del Excel, filtro por estado y apertura, cálculo de distancia y respuesta lista para un canal conversacional.</p>
          </div>
          <div class="statline">
            <div class="stat"><strong>7.801</strong><span>filas procesadas</span></div>
            <div class="stat"><strong>1.691</strong><span>aptas para búsqueda</span></div>
            <div class="stat"><strong>3</strong><span>resultados por consulta</span></div>
          </div>
        </div>
      </div>
    </section>
    <section class="shell">
      <div class="panel">
        <div class="panel-head">
          <h2>Entrada</h2>
          <p>Usa texto tipo WhatsApp o comparte una ubicación manual o desde el navegador.</p>
        </div>
        <div class="controls">
          <div class="chips">
            <button class="chip" type="button" data-text="agencia más cercana">agencia más cercana</button>
            <button class="chip" type="button" data-text="tienda abierta">tienda abierta</button>
            <button class="chip" type="button" data-text="ARICA">ARICA</button>
            <button class="chip" type="button" data-text="21 de mayo">21 de mayo</button>
          </div>
          <label>
            Mensaje
            <textarea id="message" placeholder="Ej: agencia más cercana"></textarea>
          </label>
          <div class="row">
            <label>
              Latitud
              <input id="latitude" placeholder="-18.4780" />
            </label>
            <label>
              Longitud
              <input id="longitude" placeholder="-70.3190" />
            </label>
          </div>
          <div class="actions">
            <button class="secondary" type="button" id="use-browser-location">Usar mi ubicación</button>
            <button class="secondary" type="button" id="clear-location">Limpiar ubicación</button>
            <button class="primary" type="button" id="send">Enviar</button>
          </div>
          <div class="status" id="status"></div>
        </div>
        <div class="legend">
          <span class="pill">1. Escribe una frase</span>
          <span class="pill">2. O usa tu ubicación</span>
          <span class="pill">3. Revisa ranking y mapa</span>
        </div>
      </div>
      <div class="workspace">
        <div class="panel">
        <div class="panel-head">
          <h2>Simulación del chat</h2>
          <p>La conversación usa exactamente la misma lógica del backend que atiende el webhook.</p>
        </div>
        <div class="conversation-panel">
          <div class="chat-wrap">
            <div class="chat" id="chat">
              <div class="bubble bot">Compárteme tu ubicación y te digo la agencia abierta más cercana.</div>
            </div>
          </div>
          <div class="insights-grid">
            <div class="summary">
              <h3 id="summary-title">Esperando una consulta</h3>
              <p id="summary-copy">Prueba con texto libre o comparte una ubicación para ver la mejor agencia y las alternativas.</p>
            </div>
            <div class="map-card">
              <iframe id="map-frame" src="about:blank" title="Mapa de agencia"></iframe>
            </div>
          </div>
        </div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <h2>Ranking sugerido</h2>
            <p>La primera tarjeta es la recomendación principal. Puedes cambiar la selección para ver otra agencia en el mapa.</p>
          </div>
          <div class="rank-panel">
            <div class="list-card">
              <div class="result-list" id="result-list">
                <div class="mini">Todavía no hay resultados para mostrar.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>
  <script>
    const messageInput = document.getElementById("message");
    const latitudeInput = document.getElementById("latitude");
    const longitudeInput = document.getElementById("longitude");
    const statusEl = document.getElementById("status");
    const chatEl = document.getElementById("chat");
    const resultListEl = document.getElementById("result-list");
    const summaryTitleEl = document.getElementById("summary-title");
    const summaryCopyEl = document.getElementById("summary-copy");
    const mapFrameEl = document.getElementById("map-frame");
    let latestResults = [];
    let activeIndex = 0;

    function addBubble(text, role) {
      const div = document.createElement("div");
      div.className = `bubble ${role}`;
      div.textContent = text;
      chatEl.appendChild(div);
      chatEl.scrollTop = chatEl.scrollHeight;
    }

    function escapeHtml(text) {
      return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function setMap(lat, lon) {
      if (typeof lat !== "number" || typeof lon !== "number") {
        mapFrameEl.src = "about:blank";
        return;
      }
      mapFrameEl.src = `https://www.google.com/maps?q=${lat},${lon}&z=15&output=embed`;
    }

    function updateSummary(response) {
      const count = response.results.length;
      if (!count) {
        summaryTitleEl.textContent = "Sin ranking aún";
        summaryCopyEl.textContent = response.reply;
        setMap(null, null);
        return;
      }

      const top = response.results[activeIndex] || response.results[0];
      summaryTitleEl.textContent = top.agent_name;
      summaryCopyEl.textContent = `${top.status_text}. Distancia aproximada: ${top.distance_km} km. Dirección: ${top.address}.`;
      setMap(top.latitude, top.longitude);
    }

    function selectResult(index) {
      activeIndex = index;
      document.querySelectorAll(".result-item").forEach((item, itemIndex) => {
        item.classList.toggle("active", itemIndex === index);
      });
      const result = latestResults[index];
      if (!result) {
        return;
      }
      summaryTitleEl.textContent = result.agent_name;
      summaryCopyEl.textContent = `${result.status_text}. Distancia aproximada: ${result.distance_km} km. Dirección: ${result.address}.`;
      setMap(result.latitude, result.longitude);
    }

    function renderResults(response) {
      latestResults = response.results || [];
      activeIndex = 0;

      if (!latestResults.length) {
        resultListEl.innerHTML = '<div class="mini">Todavía no hay resultados para mostrar.</div>';
        updateSummary(response);
        return;
      }

      resultListEl.innerHTML = latestResults.map((result, index) => `
        <article class="result-item ${index === 0 ? "active" : ""}" data-index="${index}">
          <div class="result-head">
            <div style="display:flex; gap:10px;">
              <span class="rank">${index + 1}</span>
              <div>
                <strong style="display:block; font-size:15px; margin-bottom:4px;">${escapeHtml(result.agent_name)}</strong>
                <div class="mini">${escapeHtml(result.address)}</div>
              </div>
            </div>
            <span class="pill ${result.is_open ? "open" : ""}">${result.is_open ? "Abierta" : "Cerrada"}</span>
          </div>
          <div class="mini">${escapeHtml(result.status_text)}</div>
          <div class="mini">Distancia aproximada: ${escapeHtml(result.distance_km)} km</div>
          <div class="result-actions"><a href="${escapeHtml(result.google_maps_url)}" target="_blank" rel="noreferrer">Abrir en Google Maps</a></div>
        </article>
      `).join("");

      document.querySelectorAll(".result-item").forEach((item) => {
        item.addEventListener("click", () => {
          selectResult(Number(item.dataset.index));
        });
      });

      updateSummary(response);
    }

    async function sendMessage() {
      const text = messageInput.value.trim();
      const latitude = latitudeInput.value.trim();
      const longitude = longitudeInput.value.trim();

      if (!text && !(latitude && longitude)) {
        statusEl.textContent = "Escribe un mensaje o carga una ubicación.";
        return;
      }

      const payload = {};
      if (text) {
        payload.text = text;
        addBubble(text, "user");
      } else {
        addBubble(`Ubicación enviada: ${latitude}, ${longitude}`, "user");
      }
      if (latitude && longitude) {
        payload.latitude = Number(latitude);
        payload.longitude = Number(longitude);
      }

      statusEl.textContent = "Consultando...";
      try {
        const response = await fetch("/demo/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        addBubble(data.reply, "bot");
        renderResults(data);
        statusEl.textContent = "";
      } catch (error) {
        statusEl.textContent = "No pude consultar el backend.";
      }
    }

    document.getElementById("send").addEventListener("click", sendMessage);
    messageInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        sendMessage();
      }
    });

    document.getElementById("use-browser-location").addEventListener("click", () => {
      if (!navigator.geolocation) {
        statusEl.textContent = "Este navegador no soporta geolocalización.";
        return;
      }
      statusEl.textContent = "Pidiendo ubicación al navegador...";
      navigator.geolocation.getCurrentPosition(
        (position) => {
          latitudeInput.value = position.coords.latitude.toFixed(6);
          longitudeInput.value = position.coords.longitude.toFixed(6);
          statusEl.textContent = "Ubicación cargada.";
        },
        () => {
          statusEl.textContent = "No pude obtener la ubicación.";
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });

    document.getElementById("clear-location").addEventListener("click", () => {
      latitudeInput.value = "";
      longitudeInput.value = "";
      statusEl.textContent = "Ubicación limpiada.";
    });

    document.querySelectorAll("[data-text]").forEach((button) => {
      button.addEventListener("click", () => {
        messageInput.value = button.dataset.text || "";
        messageInput.focus();
      });
    });
  </script>
</body>
</html>
"""
