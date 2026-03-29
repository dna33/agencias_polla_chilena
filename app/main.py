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
      --bg: #efe8d9;
      --panel: rgba(255, 250, 242, 0.88);
      --panel-strong: #fffaf2;
      --ink: #182224;
      --muted: #5f6d70;
      --accent: #0a6c60;
      --accent-2: #df8b2d;
      --accent-3: #153f43;
      --border: #d6c8b0;
      --shadow: 0 18px 60px rgba(63, 42, 17, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at top left, rgba(223,139,45,0.18), transparent 28%),
        radial-gradient(circle at bottom right, rgba(10,108,96,0.12), transparent 26%),
        linear-gradient(180deg, #f5ecdc 0%, var(--bg) 58%, #ebe2d0 100%);
      color: var(--ink);
      min-height: 100vh;
    }
    .page {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .hero {
      display: grid;
      gap: 18px;
      margin-bottom: 26px;
    }
    .eyebrow {
      color: var(--accent);
      font-size: 14px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-weight: 700;
    }
    h1 {
      font-size: clamp(32px, 6vw, 64px);
      line-height: 0.95;
      margin: 0;
      max-width: 9ch;
    }
    .sub {
      max-width: 700px;
      font-size: 18px;
      color: var(--muted);
      line-height: 1.5;
      margin: 0;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: 1.3fr 0.9fr;
      gap: 20px;
      align-items: end;
    }
    .hero-card {
      background: linear-gradient(135deg, rgba(10,108,96,0.94), rgba(21,63,67,0.98));
      color: #f7f3ea;
      border-radius: 26px;
      padding: 22px;
      box-shadow: var(--shadow);
      min-height: 220px;
      display: grid;
      gap: 14px;
      align-content: space-between;
    }
    .hero-card .statline {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .hero-card .stat {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 18px;
      padding: 12px;
    }
    .hero-card strong {
      display: block;
      font-size: 24px;
      margin-bottom: 4px;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(320px, 420px) minmax(320px, 1fr);
      gap: 20px;
      align-items: start;
    }
    .panel {
      background: var(--panel);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 24px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .panel-head {
      padding: 20px 22px 0;
    }
    .panel-head h2 {
      margin: 0;
      font-size: 24px;
    }
    .panel-head p {
      margin: 8px 0 0;
      color: var(--muted);
      line-height: 1.5;
    }
    .controls {
      padding: 20px 22px 22px;
      display: grid;
      gap: 14px;
    }
    label {
      display: grid;
      gap: 6px;
      font-size: 14px;
      color: var(--muted);
    }
    textarea, input {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px 16px;
      background: #fff;
      color: var(--ink);
      font: inherit;
    }
    textarea {
      min-height: 120px;
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
      cursor: pointer;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }
    button:hover { transform: translateY(-1px); }
    button.primary {
      background: var(--accent);
      color: #fff;
    }
    button.secondary {
      background: #efe3cf;
      color: var(--ink);
    }
    .demo-grid {
      padding: 22px;
      display: grid;
      grid-template-columns: minmax(260px, 0.9fr) minmax(320px, 1.1fr);
      gap: 18px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0.88)),
        repeating-linear-gradient(
          180deg,
          transparent 0,
          transparent 28px,
          rgba(217,205,184,0.22) 28px,
          rgba(217,205,184,0.22) 29px
        );
    }
    .chat {
      display: grid;
      gap: 14px;
      min-height: 540px;
      align-content: start;
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
      background: #1f2a2c;
      color: #fff;
      border-bottom-right-radius: 6px;
    }
    .bot {
      justify-self: start;
      background: #fff;
      border: 1px solid var(--border);
      border-bottom-left-radius: 6px;
    }
    .insights {
      display: grid;
      gap: 14px;
      align-content: start;
    }
    .summary {
      background: var(--panel-strong);
      border: 1px solid var(--border);
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
      border: 1px solid var(--border);
      background: #f3eadb;
      min-height: 220px;
    }
    iframe {
      width: 100%;
      height: 100%;
      min-height: 220px;
      border: 0;
    }
    .list-card {
      background: var(--panel-strong);
      border: 1px solid var(--border);
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
      border: 1px solid var(--border);
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
      border-color: var(--accent-2);
      box-shadow: 0 8px 20px rgba(63, 42, 17, 0.08);
    }
    .result-item.active {
      border-color: var(--accent);
      box-shadow: 0 8px 24px rgba(10,108,96,0.12);
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
      background: #efe3cf;
      display: inline-grid;
      place-items: center;
      font-size: 13px;
      color: var(--accent-3);
      border: 1px solid var(--border);
      flex: 0 0 auto;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      border: 1px solid var(--border);
      background: #f6f0e4;
      color: var(--muted);
    }
    .pill.open {
      background: rgba(10,108,96,0.1);
      color: var(--accent);
      border-color: rgba(10,108,96,0.26);
    }
    .mini {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }
    .result-actions a {
      color: var(--accent);
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
    }
    .status {
      min-height: 22px;
      color: var(--muted);
      font-size: 14px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      background: #efe3cf;
      border-radius: 999px;
      border: 1px solid var(--border);
      padding: 8px 12px;
      font-size: 13px;
      cursor: pointer;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (max-width: 860px) {
      .hero-grid { grid-template-columns: 1fr; }
      .layout { grid-template-columns: 1fr; }
      .demo-grid { grid-template-columns: 1fr; }
      .chat { min-height: 240px; }
      .hero-card .statline { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div class="hero-grid">
        <div>
          <div class="eyebrow">Demo local</div>
          <h1>Asistente de agencias Polla</h1>
          <p class="sub">Simula el flujo de WhatsApp sin integrar Meta. Puedes probar texto, comuna o ubicación exacta y mostrarle al equipo cómo responde el motor real del MVP.</p>
        </div>
        <div class="hero-card">
          <div>
            <div class="eyebrow" style="color:#f4d6aa;">Qué demuestra</div>
            <p style="margin:0; line-height:1.5;">Importación real del Excel, filtro por agencias elegibles, validación de apertura, cálculo de distancia y respuesta corta para WhatsApp.</p>
          </div>
          <div class="statline">
            <div class="stat"><strong>7.801</strong><span>filas procesadas</span></div>
            <div class="stat"><strong>1.691</strong><span>aptas para búsqueda</span></div>
            <div class="stat"><strong>3</strong><span>resultados por consulta</span></div>
          </div>
        </div>
      </div>
    </section>
    <section class="layout">
      <div class="panel">
        <div class="panel-head">
          <h2>Entrada</h2>
          <p>Usa texto tipo WhatsApp, o comparte una ubicación manual o desde el navegador.</p>
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
      </div>
      <div class="panel">
        <div class="panel-head">
          <h2>Resultado de la simulación</h2>
          <p>La conversación y el ranking usan exactamente la misma lógica del backend que atiende el webhook.</p>
        </div>
        <div class="demo-grid">
          <div class="chat" id="chat">
            <div class="bubble bot">Compárteme tu ubicación y te digo la agencia abierta más cercana.</div>
          </div>
          <div class="insights">
            <div class="summary">
              <h3 id="summary-title">Esperando una consulta</h3>
              <p id="summary-copy">Prueba con texto libre o comparte una ubicación para ver la mejor agencia y las alternativas.</p>
            </div>
            <div class="map-card" id="map-card">
              <iframe id="map-frame" src="about:blank" title="Mapa de agencia"></iframe>
            </div>
            <div class="list-card">
              <h3>Ranking</h3>
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
      summaryCopyEl.textContent = `${top.status_text}. ${top.distance_km} km aprox. ${top.address}.`;
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
      summaryCopyEl.textContent = `${result.status_text}. ${result.distance_km} km aprox. ${result.address}.`;
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
