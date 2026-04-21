# agencias_polla_chilena

MVP de asistente por WhatsApp para Polla Chilena que responde la agencia abierta mas cercana usando como fuente maestra la planilla Excel `MaeGerCom - Base Datos 04.09.2025.xlsx`.

## Arquitectura propuesta

Se implemento `Python + FastAPI + SQLite` porque permite avanzar rapido con bajo costo operativo y mantiene el dominio aislado en modulos simples:

- `app/importer.py`: lee el Excel real, usa encabezados desde la fila 4, datos desde la fila 5 y normaliza filas.
- `app/repository.py`: persistencia SQLite para agencias y logs de consultas.
- `app/scheduler.py`: parser y evaluador de horarios por dia/bloque.
- `app/geo.py`: parser de coordenadas, Haversine y links Google Maps.
- `app/matcher.py`: ranking por abierta ahora y distancia.
- `app/main.py`: API HTTP + webhook de WhatsApp Cloud API.
- `app/whatsapp.py`: envio de respuestas a Meta.
- `app/analytics.py`: medicion simple de tiempos.

## Modelo de datos

Tabla principal `agencies`:

- `id`
- `lotos_code`
- `master_code`
- `raspe_code`
- `agent_name`
- `rut`
- `address`
- `comuna`
- `region_number`
- `rubro`
- `legal_representative`
- `phone_local`
- `phone_1`
- `phone_2`
- `email`
- `contact_name`
- `observation`
- `commercial_status`
- `agent_status`
- `status_change_date`
- `latitude`
- `longitude`
- `raw_coordinates`
- `schedule_json`
- `schedule_raw_json`
- `data_quality_errors_json`
- `raw_row_hash`
- `is_active_for_search`
- `created_at`
- `updated_at`

Tabla `query_logs`:

- `id`
- `created_at`
- `user_phone`
- `incoming_text`
- `had_location`
- `user_latitude`
- `user_longitude`
- `recommended_agency_id`
- `alternative_agency_ids_json`
- `response_time_ms`
- `error_message`
- `metadata_json`

## Estructura de carpetas

```text
.
├── app
│   ├── analytics.py
│   ├── config.py
│   ├── database.py
│   ├── geo.py
│   ├── importer.py
│   ├── intent.py
│   ├── main.py
│   ├── matcher.py
│   ├── models.py
│   ├── repository.py
│   ├── scheduler.py
│   ├── service.py
│   └── whatsapp.py
├── data
├── input
├── tests
├── import_agencies.py
└── pyproject.toml
```

## Plan de implementacion por etapas

1. Base del proyecto, configuracion, modelo y persistencia SQLite.
2. Parser de horarios, parser geo y matcher de agencias.
3. Importador Excel con reporte de calidad.
4. Webhook WhatsApp con deteccion de intencion por keywords y respuesta por ubicacion.
5. Tests minimos y documentacion operativa.

## Variables de entorno

Copiar `.env.example` o exportar estas variables:

```bash
APP_NAME=Polla Agencies WhatsApp MVP
DATABASE_PATH=data/agencies.db
APP_TIMEZONE=America/Santiago
WHATSAPP_VERIFY_TOKEN=replace-me
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
META_API_BASE_URL=https://graph.facebook.com/v21.0
```

## Instalacion

```bash
python3 -m pip install -e '.[dev]'
```

## Importacion del Excel

```bash
python3 import_agencies.py "input/MaeGerCom - Base Datos 04.09.2025.xlsx"
```

El importador:

- abre la hoja `Informe 1`
- toma encabezados desde la fila 4
- procesa datos desde la fila 5
- normaliza horarios y coordenadas
- filtra elegibilidad por estado + coordenadas + horario interpretable
- reemplaza el contenido de la tabla `agencies`
- imprime un reporte resumido de calidad

Resultado validado con la planilla real:

- `total_rows`: 7801
- `searchable_rows`: 1691
- `discarded_rows`: 6110
- `invalid_schedule_count`: 94
- `invalid_coordinates_count`: 0

## Ejecucion API

```bash
uvicorn app.main:app --reload
```

Endpoints:

- `GET /health`
- `GET /demo`
- `POST /demo/message`
- `GET /webhooks/whatsapp`
- `POST /webhooks/whatsapp`
- `POST /search`

## Demo local sin WhatsApp

Para probar el asistente sin integrar Meta:

```bash
uvicorn app.main:app --reload
```

Luego abre:

```text
http://127.0.0.1:8000/demo
```

La demo permite:

- escribir mensajes como `agencia más cercana` o `tienda abierta`
- probar fallback por comuna o dirección, por ejemplo `ARICA`
- usar latitud/longitud manual
- pedir ubicación al navegador
- mostrar la conversación simulada con la misma lógica del webhook real
- ver ranking en tarjetas, detalle principal y mapa de la agencia seleccionada

Si quieres integrarlo en otra interfaz de prueba, puedes usar:

```bash
curl -X POST http://127.0.0.1:8000/demo/message \
  -H "Content-Type: application/json" \
  -d '{"text":"agencia más cercana"}'
```

## Flujo WhatsApp MVP

1. Usuario escribe `agencia mas cercana`, `tienda abierta`, `local abierto` o similar.
2. El bot responde: `Compárteme tu ubicación y te digo la agencia abierta más cercana.`
3. Usuario comparte ubicacion.
4. El sistema devuelve recomendacion principal y hasta 2 alternativas.

Si el usuario manda ubicacion directo, responde sin pedir nada mas.

## Tests

```bash
python3 -m pytest
```

Cobertura minima implementada:

- agencia activa y abierta encontrada
- agencia abierta rankea sobre una cerrada mas cercana
- fallback a cerradas cuando no hay abiertas
- parse de horarios
- parse de `CERRADO`
- parse de coordenadas
- exclusion por `Estado Comercial`
- exclusion por `Estado Agente`

## Analisis comercial territorial semanal

Los archivos semanales de ventas se dejan en `input/` como Excel. El analizador ignora la base maestra `MaeGerCom...` y procesa las bases semanales que tengan una columna `Vta.Sem.N`.

```bash
python3 analyze_weekly_sales.py
```

El comando genera:

- `data/weekly_agency_sales.csv`: historial normalizado por agencia y semana.
- `data/commercial_territorial_report.md`: KPIs semanales, territorios, ejecutivos/coordinadores y alertas de gestion.

Uso sugerido:

1. Agregar cada nueva base semanal a `input/`.
2. Ejecutar `python3 analyze_weekly_sales.py`.
3. Revisar caidas, recuperaciones, cobertura territorial y agencias sin venta.

## Modulo GitHub Pages

El modulo estatico de gestion semanal vive en `docs/` y puede publicarse con GitHub Pages usando la opcion **Deploy from a branch** con carpeta `/docs`.

Para refrescar los datos del sitio despues de agregar una nueva semana:

```bash
python3 build_pages_data.py
```

Esto genera `docs/data/dashboard.json`, que alimenta:

- tablero de KPIs semanales;
- evolucion semanal agrupada por zona desde la hoja `LOTO_ Comuna`, usando `LOTO_ PtoVta` para mapear comuna a `Ubicación`;
- filtros por semana, territorio, ejecutivo y prioridad;
- lista priorizada de agencias;
- detalle de punto de venta;
- asistente conversacional local para preguntas como `mayores caidas`, `zona norte semanal`, `territorio norte`, `ejecutivo Dino Diaz` o un codigo Lotos.

Para probarlo localmente:

```bash
python3 -m http.server 8080 -d docs
```

Luego abrir `http://127.0.0.1:8080`.
