const state = {
  data: null,
  week: null,
  perspective: "territory",
  weeklyView: "indexed",
  maps: {
    territory: {},
    agencies: {},
    commune: null,
  },
  selectedAgency: null,
  selectedCommune: null,
};

const priorityLabels = {
  caida_fuerte: "Caida fuerte",
  sin_venta: "Sin venta",
  bajo_2019: "Bajo 2019",
  recuperacion: "Recuperacion",
  cerrada: "Cerrada",
  seguimiento: "Seguimiento",
};

const priorityClass = {
  caida_fuerte: "red",
  sin_venta: "amber",
  bajo_2019: "amber",
  recuperacion: "green",
  cerrada: "blue",
  seguimiento: "",
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  await loadData();
}

function bindEvents() {
  document.querySelectorAll("[data-perspective]").forEach((button) => {
    button.addEventListener("click", () => {
      state.perspective = button.dataset.perspective;
      applyPerspective();
    });
  });
  document.querySelectorAll("[data-week-control]").forEach((select) => {
    select.addEventListener("change", (event) => {
      state.week = Number(event.target.value);
      syncWeekControls();
      render();
    });
  });
  document.getElementById("assistantToggle").addEventListener("click", () => {
    const assistant = document.querySelector(".assistant");
    assistant.classList.toggle("collapsed");
    const isCollapsed = assistant.classList.contains("collapsed");
    const button = document.getElementById("assistantToggle");
    button.textContent = isCollapsed ? "+" : "−";
    button.title = isCollapsed ? "Abrir asistente" : "Minimizar asistente";
    button.setAttribute("aria-label", button.title);
  });
  document.getElementById("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    addMessage(text, "user");
    addMessage(answerQuestion(text), "bot");
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = button.dataset.prompt;
      addMessage(prompt, "user");
      addMessage(answerQuestion(prompt), "bot");
    });
  });
  document.querySelectorAll("[data-weekly-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.weeklyView = button.dataset.weeklyView;
      document.querySelectorAll("[data-weekly-view]").forEach((item) => item.classList.toggle("active", item === button));
      renderWeeklyZoneChart();
    });
  });
}

async function loadData() {
  try {
    const response = await fetch(`data/dashboard.json?ts=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`No se pudo cargar dashboard.json (${response.status})`);
    }
    state.data = await response.json();
    state.week = state.data.latest_week;
    state.selectedAgency = state.data.agencies[0] || null;
    state.selectedCommune = lowestCommuneName();
    populateControls();
    render();
    resetChat();
  } catch (error) {
    showLoadError(error);
  }
}

function showLoadError(error) {
  const message = `No se pudo cargar la data del dashboard. Usa un servidor local o GitHub Pages; abrir index.html directo como archivo puede bloquear data/dashboard.json. Detalle: ${error.message}`;
  ["segmentComparison", "seriesNarrative", "territoryChart", "trendChart", "jackpotChart", "weeklyZoneChart", "communeMarketPanel", "territorialPrizeCommunesMaps", "agencyDetail"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.innerHTML = `<p class="load-error">${escapeHtml(message)}</p>`;
  });
}

function populateControls() {
  syncPerspectiveTabs();
  syncWeekControls();
}

function syncWeekControls() {
  document.querySelectorAll("[data-week-control]").forEach((select) => {
    fillSelect(select.id, state.data.weeks.map(String), state.week, false);
  });
}

function syncPerspectiveTabs() {
  document.querySelectorAll("[data-perspective]").forEach((button) => {
    button.classList.toggle("active", button.dataset.perspective === state.perspective);
    button.setAttribute("aria-pressed", button.classList.contains("active") ? "true" : "false");
  });
}

function fillSelect(id, values, selectedValue, includeAll) {
  const select = document.getElementById(id);
  select.innerHTML = "";
  if (includeAll) {
    select.append(new Option("Todos", ""));
  }
  values.forEach((value) => {
    const rawValue = typeof value === "object" ? value.value : value;
    const label = typeof value === "object" ? value.label : value;
    const option = new Option(String(label), String(rawValue));
    option.selected = String(rawValue) === String(selectedValue);
    select.append(option);
  });
}

function render() {
  if (!state.data) return;
  const agencies = filteredAgencies();
  safeRender("territoryKpiSales", () => renderTerritoryKpis(agencies));
  safeRender("agencyKpiSelling", () => renderAgencyKpis(agencies));
  safeRender("agencyPrizeRanking", renderAgencyPrizeSummary);
  safeRender("agencyPrizeHeatMaps", renderAgencyPrizeHeatMaps);
  safeRender("seriesNarrative", () => renderSeriesAnalysis(agencies));
  safeRender("territoryChart", () => renderTerritoryChart(agencies));
  safeRender("trendChart", renderTrendChart);
  safeRender("jackpotChart", renderJackpotChart);
  safeRender("territoryMaps", () => renderTerritoryMaps(agencies));
  safeRender("segmentComparison", renderSegmentComparison);
  safeRender("weeklyZoneChart", renderWeeklyZoneChart);
  safeRender("communeMarketPanel", renderCommuneMarketPanel);
  safeRender("territorialPrizeCommunesMaps", renderTerritorialPrizeCommunesMaps);
  safeRender("agencyTable", () => renderTable(agencies));
  safeRender("agencyDetail", () => renderDetail(state.selectedAgency));
  applyPerspective();
}

function applyPerspective() {
  document.body.dataset.perspective = state.perspective;
  syncPerspectiveTabs();
  document.querySelectorAll("[data-page]").forEach((section) => {
    const isActive = section.dataset.page === state.perspective;
    section.hidden = !isActive;
    section.classList.toggle("active-page", isActive);
  });
  setTimeout(() => invalidatePerspectiveMaps(), 0);
}

function safeRender(targetId, callback) {
  try {
    callback();
  } catch (error) {
    const target = document.getElementById(targetId);
    if (target) {
      target.innerHTML = `<p class="load-error">Error al renderizar esta vista: ${escapeHtml(error.message)}</p>`;
    }
    console.error(error);
  }
}

function filteredAgencies() {
  return state.data.agencies.filter((agency) => weekSnapshot(agency, state.week));
}

function weekSnapshot(agency, week) {
  return agency.history.find((item) => item.week === Number(week));
}

function previousSnapshot(agency, week) {
  const previousWeeks = agency.history
    .filter((item) => item.week < Number(week))
    .sort((a, b) => b.week - a.week);
  return previousWeeks[0] || null;
}

function renderTerritoryKpis(agencies) {
  const current = agencies.map((agency) => ({ agency, snapshot: weekSnapshot(agency, state.week) })).filter((item) => item.snapshot);
  const totalSales = current.reduce((sum, item) => sum + item.snapshot.sales, 0);
  const previousSales = current.reduce((sum, item) => sum + (previousSnapshot(item.agency, state.week)?.sales || 0), 0);
  const selling = current.filter((item) => item.snapshot.sales > 0).length;
  const territories = new Set(current.map((item) => item.agency.territory).filter(Boolean));
  const activeTerritories = new Set(current.filter((item) => item.snapshot.sales > 0).map((item) => item.agency.territory).filter(Boolean));
  const communesBelow = state.data?.commune_market_context?.below_latest_benchmark_communes || 0;
  const delta = totalSales - previousSales;

  setText("territoryKpiSales", money(totalSales));
  setText("territoryKpiSalesDelta", previousSales ? `${signedMoney(delta)} vs semana previa` : "Sin comparativo");
  setText("territoryKpiCoverage", number(selling));
  setText("territoryKpiCoverageRate", `${percent(selling / (current.length || 1))} de ${number(current.length)} agencias`);
  setText("territoryKpiTerritories", number(territories.size));
  setText("territoryKpiTerritoriesMeta", `${number(activeTerritories.size)} con venta en la semana`);
  setText("territoryKpiCommunes", number(communesBelow));
  setText("territoryKpiCommunesMeta", "Ultimo mes relativo vs benchmark red");
}

function renderAgencyKpis(agencies) {
  const current = agencies.map((agency) => ({ agency, snapshot: weekSnapshot(agency, state.week) })).filter((item) => item.snapshot);
  const selling = current.filter((item) => item.snapshot.sales > 0).length;
  const closed = current.filter((item) => item.agency.is_closed).length;
  const actions = current.filter((item) => ["caida_fuerte", "sin_venta", "bajo_2019"].includes(item.agency.priority)).length;
  const avgSales = current.length ? current.reduce((sum, item) => sum + item.snapshot.sales, 0) / current.length : 0;

  setText("agencyKpiSelling", number(selling));
  setText("agencyKpiSellingRate", `${percent(selling / (current.length || 1))} de ${number(current.length)} agencias`);
  setText("agencyKpiClosed", number(closed));
  setText("agencyKpiActions", number(actions));
  setText("agencyKpiAvgSales", money(avgSales));
  setText("agencyKpiAvgSalesMeta", `Promedio sobre ${number(current.length)} agencias observadas`);
}

function renderAgencyPrizeSummary() {
  const summary = state.data.agency_prize_summary || {};
  const meta = document.getElementById("agencyPrizeMeta");
  const ranking = document.getElementById("agencyPrizeRanking");
  const subgames = document.getElementById("agencyPrizeSubgames");
  if (!ranking || !subgames) return;

  if (!summary.agencies_with_prizes) {
    if (meta) meta.textContent = "No hay archivo de premios cargado.";
    ranking.innerHTML = "<p class='muted'>Sin agencias con premios procesadas.</p>";
    subgames.innerHTML = "<p class='muted'>Sin subjuegos con premios procesados.</p>";
    return;
  }

  if (meta) {
    const sourceFile = summary.source_file ? `Fuente: ${summary.source_file}. ` : "";
    meta.textContent = `${sourceFile}${number(summary.agencies_with_prizes)} agencias con premios, ${money(summary.gross_total || 0)} brutos y ${money(summary.net_total || 0)} netos. Promedio bruto: ${money(summary.avg_gross_per_agency || 0)} por agencia.`;
  }

  ranking.innerHTML = (summary.top_agencies || []).map((item, index) => `
    <button class="ranking-item" data-lotos="${escapeHtml(item.lotos_code)}">
      <span>${index + 1}</span>
      <strong>${escapeHtml(item.lotos_code)} · ${escapeHtml(item.agent_name || "Sin nombre")}</strong>
      <em>${money(item.gross_total || 0)} bruto · ${money(item.net_total || 0)} neto · ${number(item.subgames_count || 0)} subj.</em>
    </button>
  `).join("") || "<p class='muted'>Sin ranking de premios.</p>";

  const maxGross = Math.max(...(summary.top_subgames || []).map((item) => item.gross_total || 0), 1);
  subgames.innerHTML = (summary.top_subgames || []).map((item) => {
    const width = Math.max(4, ((item.gross_total || 0) / maxGross) * 100);
    return `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(item.subgame || "Sin subjuego")}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        <div class="bar-value">${money(item.gross_total || 0)}</div>
        <div class="bar-meta">${money(item.net_total || 0)} neto · ${number(item.agencies || 0)} agencias</div>
      </div>
    `;
  }).join("") || "<p class='muted'>Sin subjuegos con monto procesado.</p>";

  document.querySelectorAll("#agencyPrizeRanking .ranking-item").forEach((button) => {
    button.addEventListener("click", () => {
      const agency = state.data.agencies.find((item) => item.lotos_code === button.dataset.lotos);
      if (agency) {
        state.selectedAgency = agency;
        renderDetail(agency);
      }
    });
  });
}

function renderAgencyPrizeHeatMaps() {
  const container = document.getElementById("agencyPrizeHeatMaps");
  const meta = document.getElementById("agencyPrizeHeatMeta");
  if (!container) return;

  const points = agencyPrizeMapPoints();
  const threshold = 5_000_000;
  if (meta) {
    const totalGross = points.reduce((sum, point) => sum + (point.prizeGross || 0), 0);
    const totalNet = points.reduce((sum, point) => sum + (point.prizeNet || 0), 0);
    const aboveGross = points.filter((point) => (point.prizeGross || 0) >= threshold).length;
    const ratioReady = points.filter((point) => (point.prizeGrossOverSalesPct || 0) > 0).length;
    meta.textContent = points.length
      ? `${number(points.length)} agencias con premios georreferenciadas. Bruto total: ${money(totalGross)}. Neto total: ${money(totalNet)}. El color bruto parte en ${money(threshold)} y la vista inferior muestra premio bruto sobre ventas brutas del local (%). ${number(ratioReady)} agencias tienen base de ventas para ese ratio.`
      : "No hay agencias con premios y coordenadas para mapear.";
  }

  destroyAgencyPrizeMaps();

  if (!points.length) {
    container.innerHTML = "<p class='muted'>Sin premios georreferenciados para desplegar.</p>";
    return;
  }

  if (!window.Plotly) {
    container.innerHTML = "<p class='load-error'>No se pudo cargar Plotly para el mapa de la suerte.</p>";
    return;
  }

  const rmBounds = [[-34.15, -71.45], [-32.95, -70.25]];
  const rmPoints = points.filter((point) => point.lat >= rmBounds[0][0] && point.lat <= rmBounds[1][0] && point.lon >= rmBounds[0][1] && point.lon <= rmBounds[1][1]);
  const ratioPoints = points.filter((point) => (point.prizeGrossOverSalesPct || 0) > 0);
  const rmRatioPoints = rmPoints.filter((point) => (point.prizeGrossOverSalesPct || 0) > 0);
  container.innerHTML = `
    ${renderPrizePlotCard("agencyPrizeMapChile", "Chile", "Densidad territorial de premios brutos entregados", points.length)}
    ${renderPrizePlotCard("agencyPrizeMapRm", "Region Metropolitana", "Concentracion metropolitana de premios brutos", rmPoints.length)}
    ${renderPrizePlotCard("agencyPrizeNetMapChile", "Chile", "Premio bruto sobre ventas brutas del local (%)", ratioPoints.length)}
    ${renderPrizePlotCard("agencyPrizeNetMapRm", "Region Metropolitana", "Premio bruto sobre ventas brutas del local (%)", rmRatioPoints.length)}
  `;

  renderPrizeDensityPlot("agencyPrizeMapChile", points, {
    center: { lat: -35.7, lon: -71.2 },
    zoom: 3.9,
    radius: 20,
  }, "prizeGross");
  renderPrizeDensityPlot("agencyPrizeMapRm", rmPoints, {
    center: { lat: -33.45, lon: -70.66 },
    zoom: 8.3,
    radius: 16,
  }, "prizeGross");
  renderPrizeDensityPlot("agencyPrizeNetMapChile", ratioPoints, {
    center: { lat: -35.7, lon: -71.2 },
    zoom: 3.9,
    radius: 8,
  }, "prizeGrossOverSalesPct");
  renderPrizeDensityPlot("agencyPrizeNetMapRm", rmRatioPoints, {
    center: { lat: -33.45, lon: -70.66 },
    zoom: 8.3,
    radius: 6,
  }, "prizeGrossOverSalesPct");
}

function agencyPrizeMapPoints() {
  return (state.data.agencies || [])
    .filter((agency) => Number.isFinite(agency.latitude) && Number.isFinite(agency.longitude) && (agency.prize_total_gross || 0) > 0)
    .map((agency) => ({
      lotosCode: agency.lotos_code,
      code: agency.lotos_code,
      name: agency.agent_name || "Sin nombre",
      zone: agency.territory || "Sin zona",
      comuna: agency.comuna || "Sin comuna",
      lat: agency.latitude,
      lon: agency.longitude,
      sales: weekSnapshot(agency, state.week)?.sales || 0,
      prizeGross: agency.prize_total_gross || 0,
      prizeNet: agency.prize_total_net || 0,
      observedSalesTotal: (agency.history || []).reduce((sum, item) => sum + (item.sales || 0), 0),
      prizeSubgamesCount: agency.prize_subgames_count || 0,
      topPrize: agency.prize_top_subgames?.[0] || null,
      history: agency.history || [],
    }))
    .map((point) => ({
      ...point,
      prizeGrossOverSalesPct: point.observedSalesTotal > 0
        ? (point.prizeGross / point.observedSalesTotal) * 100
        : 0,
    }));
}

function renderPrizePlotCard(id, title, subtitle, count) {
  return `
    <article class="map-card">
      <div class="map-card-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <span>${number(count)} agencias</span>
      </div>
      <div id="${id}" class="prize-map-plot" aria-label="${escapeHtml(title)}"></div>
    </article>
  `;
}

function prizeHeatWeight(value, maxValue) {
  const threshold = 5_000_000;
  if (!value || !maxValue) return 0;
  if (maxValue <= 100) {
    const ratio = value / maxValue;
    return Math.max(0.02, Math.min(1, Math.pow(ratio, 0.9)));
  }
  if (value < threshold) return 0;
  const shiftedValue = value - threshold;
  const shiftedMax = Math.max(1, maxValue - threshold);
  const ratio = Math.log10(1 + shiftedValue) / Math.log10(1 + shiftedMax);
  return Math.max(0.02, Math.min(1, Math.pow(ratio, 1.15)));
}

function prizeHeatScale(points, valueKey = "prizeGross") {
  const threshold = 5_000_000;
  const values = points
    .map((point) => point[valueKey] || 0)
    .filter((value) => valueKey === "prizeGrossOverSalesPct" ? value > 0 : value >= threshold)
    .sort((a, b) => a - b);
  if (!values.length) {
    return valueKey === "prizeGrossOverSalesPct"
      ? { cap: 1, min: 0.01 }
      : { cap: threshold, min: threshold };
  }
  if (valueKey === "prizeGrossOverSalesPct") {
    const percentileIndex = Math.max(0, Math.min(values.length - 1, Math.floor((values.length - 1) * 0.95)));
    const cap = values[percentileIndex] || values[values.length - 1] || 1;
    return {
      cap: Math.max(1, cap),
      min: Math.max(0.01, values[0] || 0.01),
    };
  }
  const cap = values[values.length - 1] || 1;
  return {
    cap: Math.max(threshold, cap),
    min: Math.max(threshold, values[0] || threshold),
  };
}

function renderPrizeDensityPlot(id, points, view, valueKey = "prizeGross") {
  const element = document.getElementById(id);
  if (!element) return;
  if (!points.length) {
    element.innerHTML = "<div class='map-unavailable'>Sin agencias con premios para esta vista.</div>";
    return;
  }
  const scale = prizeHeatScale(points, valueKey);
  const weights = points.map((point) => prizeHeatWeight(point[valueKey] || 0, scale.cap));
  const colorValues = points.map((point) => {
    const value = point[valueKey] || 0;
    return value >= scale.min ? Math.log10(1 + value) : Math.log10(1 + scale.min);
  });
  const colorMin = Math.log10(1 + scale.min);
  const colorMax = Math.log10(1 + scale.cap);
  const colorbarTicks = prizeColorbarTicks(scale.min, scale.cap, valueKey);
  const baseRadius = view.radius;
  const colorscale = prizeOriginalColorscale();
  const trace = {
    type: "densitymapbox",
    lat: points.map((point) => point.lat),
    lon: points.map((point) => point.lon),
    z: weights,
    radius: baseRadius,
    hovertemplate: "Densidad de premios<extra></extra>",
    colorscale,
    showscale: false,
    opacity: 0.68,
  };
  const legendTrace = {
    type: "scattermapbox",
    mode: "markers",
    lat: points.map((point) => point.lat),
    lon: points.map((point) => point.lon),
    hoverinfo: "skip",
    marker: {
      size: 0.1,
      opacity: 0,
      color: colorValues,
      cmin: colorMin,
      cmax: colorMax,
      colorscale,
      showscale: true,
      colorbar: {
        title: { text: valueKey === "prizeGrossOverSalesPct" ? "Premio / venta" : valueKey === "prizeNet" ? "Premios netos" : "Premios brutos" },
        thickness: 12,
        len: 0.72,
        x: 0.98,
        y: 0.5,
        tickvals: colorbarTicks.map((item) => item.value),
        ticktext: colorbarTicks.map((item) => item.label),
        outlinewidth: 0,
      },
    },
  };
  const layout = {
    autosize: true,
    margin: { t: 0, r: 0, b: 0, l: 0 },
    paper_bgcolor: "#fbfcfc",
    plot_bgcolor: "#fbfcfc",
    dragmode: "pan",
    mapbox: {
      style: "carto-positron",
      center: view.center,
      zoom: view.zoom,
    },
  };
  const config = {
    displayModeBar: false,
    responsive: true,
    scrollZoom: true,
  };
  Plotly.newPlot(element, [trace, legendTrace], layout, config).then(() => {
    const width = element.clientWidth || element.offsetWidth || 0;
    const height = element.clientHeight || element.offsetHeight || 560;
    if (width > 0 && height > 0) {
      Plotly.relayout(element, { width, height });
    }
    Plotly.Plots.resize(element);
    requestAnimationFrame(() => {
      Plotly.Plots.resize(element);
    });
    setTimeout(() => {
      const delayedWidth = element.clientWidth || element.offsetWidth || 0;
      const delayedHeight = element.clientHeight || element.offsetHeight || 560;
      if (delayedWidth > 0 && delayedHeight > 0) {
        Plotly.relayout(element, { width: delayedWidth, height: delayedHeight });
      }
      Plotly.Plots.resize(element);
    }, 180);
  });
}

function prizeColorbarTicks(minValue, maxValue, valueKey = "prizeGross") {
  if (valueKey === "prizeGrossOverSalesPct") {
    const candidates = [1, 2, 5, 10, 20, 30, 50, 75, 100];
    const bounded = candidates.filter((value) => value >= minValue && value <= maxValue);
    const values = bounded.length ? bounded : [minValue, maxValue];
    return values.map((value) => ({
      value: Math.log10(1 + value),
      label: `${round(value).toFixed(0)}%`,
    }));
  }
  const candidates = [500_000, 1_000_000, 5_000_000, 10_000_000, 50_000_000, 100_000_000, 500_000_000, 1_000_000_000];
  const bounded = candidates.filter((value) => value >= minValue && value <= maxValue);
  const values = bounded.length ? bounded : [minValue, maxValue];
  return values.map((value) => ({
    value: Math.log10(1 + value),
    label: shortMoney(value),
  }));
}

function prizeOriginalColorscale() {
  return [
    [0.0, "#2c7bb6"],
    [0.2, "#00a6ca"],
    [0.4, "#00ccbc"],
    [0.58, "#90eb9d"],
    [0.74, "#ffff8c"],
    [0.88, "#f9d057"],
    [1.0, "#f29e2e"],
  ];
}

function renderSegmentComparison() {
  const container = document.getElementById("segmentComparison");
  if (!container) return;
  destroyAgencySegmentMaps();
  const full = state.data.agencies || [];
  const top50 = topAverageAgencies(full);
  const fullMetrics = segmentMetrics(full, state.week);
  const topMetrics = segmentMetrics(top50, state.week, fullMetrics.sales);
  container.innerHTML = `
    <div class="segment-grid">
      ${renderSegmentCard("Red completa", "Todas las agencias con historial disponible", fullMetrics, "segmentMapFull")}
      ${renderSegmentCard("Top 50 promedio", "50 agencias con mayor venta promedio semanal", topMetrics, "segmentMapTop50")}
    </div>
  `;

  if (!window.L) {
    container.querySelectorAll(".segment-map").forEach((map) => {
      map.innerHTML = "<div class='map-unavailable'>No se pudo cargar Leaflet para el mapa.</div>";
    });
    return;
  }

  state.maps.agencies.segmentFull = initSegmentMap("segmentMapFull", segmentMapPoints(full));
  state.maps.agencies.segmentTop50 = initSegmentMap("segmentMapTop50", segmentMapPoints(top50));
}

function renderTop50PopulationContext() {
  const context = state.data.top50_population_context;
  if (!context || !context.rows?.length) {
    return "<div class='population-context'><p class='muted'>Sin cruce de poblacion comunal para el Top 50.</p></div>";
  }
  const rows = [...context.rows].sort((a, b) => (b.agencies_per_100k || 0) - (a.agencies_per_100k || 0));
  const maxDensity = Math.max(...rows.map((row) => row.agencies_per_100k || 0), 1);
  const maxSalesPerCapita = Math.max(...rows.map((row) => row.avg_sales_per_capita || 0), 1);
  return `
    <div class="population-context">
      <div class="population-head">
        <div>
          <h3>Top 50 y poblacion comunal Censo 2024</h3>
          <p>${number(context.communes)} comunas · ${number(context.top_agencies)} agencias · ${number(context.covered_population)} habitantes mayores de 18 en comunas cubiertas</p>
        </div>
        <span>Fuente: ${escapeHtml(context.source_file)} · ${escapeHtml(context.population_basis || "Poblacion total")}</span>
      </div>
      <div class="population-summary">
        ${segmentMetric("Venta prom. Top 50 / hab. 18+", money(context.avg_sales_per_capita || 0))}
        ${segmentMetric("Venta S" + state.week + " / hab. 18+", money(context.latest_sales_per_capita || 0))}
        ${segmentMetric("Comunas Top 50", number(context.communes))}
        ${segmentMetric("Poblacion 18+ cubierta", number(context.covered_population))}
      </div>
      <div class="population-table">
        <div class="population-row head">
          <span>Comuna</span>
          <span>Top 50</span>
          <span>Poblacion 18+</span>
          <span>Ag. / 100k</span>
          <span>Prom. / hab.</span>
        </div>
        ${rows.map((row) => `
          <button class="population-row" data-commune="${escapeHtml(row.commune)}">
            <strong>${escapeHtml(row.commune)}</strong>
            <span>${number(row.agencies)}</span>
            <span>${number(row.population || 0)}</span>
            <span>
              <i style="width:${Math.max(4, ((row.agencies_per_100k || 0) / maxDensity) * 100)}%"></i>
              ${row.agencies_per_100k === null ? "s/d" : round(row.agencies_per_100k).toFixed(1)}
            </span>
            <span>
              <i class="green" style="width:${Math.max(4, ((row.avg_sales_per_capita || 0) / maxSalesPerCapita) * 100)}%"></i>
              ${money(row.avg_sales_per_capita || 0)}
            </span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function lowestCommuneName() {
  const rows = state.data?.commune_market_context?.rows || [];
  return rows[0]?.commune || null;
}

function renderCommuneMarketPanel() {
  const container = document.getElementById("communeMarketPanel");
  if (!container) return;
  const context = state.data?.commune_market_context;
  if (!context?.rows?.length) {
    container.innerHTML = "<p class='muted'>Sin cruce comunal completo entre ventas y Censo 2024.</p>";
    return;
  }
  const rows = [...context.rows];
  if (!state.selectedCommune || !rows.find((row) => row.commune === state.selectedCommune)) {
    state.selectedCommune = rows[0].commune;
  }
  const selected = rows.find((row) => row.commune === state.selectedCommune) || rows[0];
  const orderedRows = [
    selected,
    ...rows.filter((row) => row.commune !== selected.commune),
  ];
  const maxOverallPer100k = Math.max(...rows.map((row) => row.overall_avg_sales_per_100k_adults || 0), 1);
  const benchmark = context.overall_avg_sales_per_100k_adults || 0;
  container.innerHTML = `
    <div class="commune-market-summary">
      ${segmentMetric("Comunas con cruce", number(context.communes || 0))}
      ${segmentMetric("Poblacion 18+ cubierta", number(context.covered_population || 0))}
      ${segmentMetric("Prom. red / 100k", money(benchmark))}
      ${segmentMetric("Bajo benchmark ultimo mes", number(context.below_latest_benchmark_communes || 0))}
    </div>
    <p class="commune-market-note">${escapeHtml(context.method_note || "")}</p>
    <div class="commune-market-layout">
      <div class="commune-market-list">
        <div class="commune-market-head">
          <span>Comuna</span>
          <span>Ag.</span>
          <span>Pob. 18+</span>
          <span>Prom. / 100k</span>
          <span>Ultimo mes / 100k</span>
        </div>
        ${orderedRows.map((row) => {
          const width = Math.max(4, ((row.overall_avg_sales_per_100k_adults || 0) / maxOverallPer100k) * 100);
          const isLow = (row.gap_vs_latest_month_benchmark_per_100k || 0) < 0;
          return `
            <button class="commune-market-row ${row.commune === selected.commune ? "active" : ""}" data-commune="${escapeHtml(row.commune)}">
              <strong>${escapeHtml(row.commune)}</strong>
              <span>${number(row.agencies || 0)}</span>
              <span>${number(row.population || 0)}</span>
              <span>
                <i style="width:${width}%"></i>
                ${money(row.overall_avg_sales_per_100k_adults || 0)}
              </span>
              <span class="${isLow ? "red" : "green"}">
                ${money(row.latest_month_avg_sales_per_100k_adults || 0)}
              </span>
            </button>
          `;
        }).join("")}
      </div>
      <div class="commune-market-detail">
        ${renderCommuneMarketDetail(selected, context)}
      </div>
    </div>
  `;
  container.querySelectorAll(".commune-market-row[data-commune]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedCommune = row.dataset.commune;
      renderCommuneMarketPanel();
    });
  });
  renderCommuneMarketMap(selected);
  const selectedRow = container.querySelector(".commune-market-row.active");
  if (selectedRow) {
    selectedRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function renderTerritorialPrizeCommunesMaps() {
  const container = document.getElementById("territorialPrizeCommunesMaps");
  const meta = document.getElementById("territorialPrizeCommunesMeta");
  if (!container) return;
  const context = state.data?.territorial_prize_communes;
  if (!context?.features?.length) {
    if (meta) meta.textContent = "Sin geometria comunal o sin premios agregados por comuna.";
    container.innerHTML = "<p class='muted'>Sin base comunal para desplegar premios sobre vectores.</p>";
    return;
  }
  if (!window.Plotly) {
    if (meta) meta.textContent = "";
    container.innerHTML = "<p class='load-error'>No se pudo cargar Plotly para el mapa comunal de premios.</p>";
    return;
  }

  const features = context.features;
  const prizeFeatures = features.filter((feature) => (feature.properties?.gross_total || 0) > 0);
  const rmFeatures = prizeFeatures.filter((feature) => String(feature.properties?.region_code || "") === "13");
  const netRatioFeatures = features.filter((feature) => (feature.properties?.net_over_sales_pct || 0) > 0);
  const rmNetRatioFeatures = netRatioFeatures.filter((feature) => String(feature.properties?.region_code || "") === "13");
  if (meta) {
    meta.textContent = `${number(context.communes_with_prizes || prizeFeatures.length)} comunas con premios. Total bruto comunal: ${money(context.gross_total || 0)}. Las vistas inferiores normalizan premios netos por venta comunal observada (%).`;
  }

  destroyTerritorialPrizeCommunePlots();
  container.innerHTML = `
    ${renderPrizePlotCard("territorialPrizeCommunesChile", "Chile", "Premios brutos agregados por comuna", prizeFeatures.length)}
    ${renderPrizePlotCard("territorialPrizeCommunesRm", "Region Metropolitana", "Premios brutos agregados por comuna en RM", rmFeatures.length)}
    ${renderPrizePlotCard("territorialPrizeCommunesNetChile", "Chile", "Premios netos sobre venta comunal (%)", netRatioFeatures.length)}
    ${renderPrizePlotCard("territorialPrizeCommunesNetRm", "Region Metropolitana", "Premios netos sobre venta comunal (%) en RM", rmNetRatioFeatures.length)}
  `;

  renderTerritorialPrizeCommunePlot("territorialPrizeCommunesChile", features, {
    center: { lat: -35.7, lon: -71.2 },
    zoom: 3.9,
    fitbounds: "locations",
  });
  renderTerritorialPrizeCommunePlot("territorialPrizeCommunesRm", rmFeatures, {
    center: { lat: -33.45, lon: -70.66 },
    zoom: 8.3,
  });
  renderTerritorialPrizeCommunePlot("territorialPrizeCommunesNetChile", netRatioFeatures, {
    center: { lat: -35.7, lon: -71.2 },
    zoom: 3.9,
    fitbounds: "locations",
  }, "net_over_sales_pct");
  renderTerritorialPrizeCommunePlot("territorialPrizeCommunesNetRm", rmNetRatioFeatures, {
    center: { lat: -33.45, lon: -70.66 },
    zoom: 8.3,
  }, "net_over_sales_pct");
}

function renderTerritorialPrizeCommunePlot(id, features, view, valueKey = "gross_total") {
  const element = document.getElementById(id);
  if (!element) return;
  const activeFeatures = (features || []).filter((feature) => (feature.properties?.[valueKey] || 0) > 0);
  if (!activeFeatures.length) {
    element.innerHTML = "<div class='map-unavailable'>Sin comunas con premios para esta vista.</div>";
    return;
  }
  const rawValues = activeFeatures.map((feature) => feature.properties?.[valueKey] || 0);
  const minValue = Math.min(...rawValues);
  const maxValue = Math.max(...rawValues);
  const transformed = territorialPrizeScale(rawValues, valueKey);
  const centroidRows = activeFeatures
    .map((feature, index) => {
      const centroid = geometryCentroid(feature.geometry);
      if (!centroid) return null;
      return {
        feature,
        lat: centroid[1],
        lon: centroid[0],
        value: rawValues[index],
        scaled: transformed.values[index],
        area: Number(feature.properties?.shape_area || 0),
      };
    })
    .filter(Boolean);
  if (!centroidRows.length) {
    element.innerHTML = "<div class='map-unavailable'>No pude calcular centroides comunales para esta vista.</div>";
    return;
  }
  const colorscale = territorialPrizeColorscale(valueKey);
  const colorbarTicks = territorialPrizeColorbarTicks(minValue, maxValue, valueKey);
  const thermalTraces = territorialThermalLayers(centroidRows, colorscale, transformed, valueKey);
  const legendTrace = {
    type: "scattermapbox",
    mode: "markers",
    lat: centroidRows.map((row) => row.lat),
    lon: centroidRows.map((row) => row.lon),
    hoverinfo: "skip",
    marker: {
      size: 0.1,
      opacity: 0,
      color: centroidRows.map((row) => row.scaled),
      cmin: transformed.zmin,
      cmax: transformed.zmax,
      colorscale,
      showscale: true,
      colorbar: {
        title: { text: valueKey === "net_over_sales_pct" ? "Suerte comunal" : "Premios brutos" },
        thickness: 12,
        len: 0.72,
        x: 0.98,
        y: 0.5,
        tickvals: colorbarTicks.map((item) => territorialPrizeScaleValue(item.value, minValue, maxValue, valueKey)),
        ticktext: colorbarTicks.map((item) => item.label),
        outlinewidth: 0,
      },
    },
  };
  const hoverTrace = {
    type: "scattermapbox",
    mode: "markers",
    lat: centroidRows.map((row) => row.lat),
    lon: centroidRows.map((row) => row.lon),
    marker: {
      size: centroidRows.map((row) => 14 + row.scaled * 18),
      opacity: 0.01,
      color: centroidRows.map((row) => row.scaled),
      cmin: transformed.zmin,
      cmax: transformed.zmax,
      colorscale,
    },
    customdata: centroidRows.map((row) => [
      row.feature.properties.commune,
      row.feature.properties.region_name,
      row.feature.properties.gross_total,
      row.feature.properties.net_total,
      row.feature.properties.agencies_with_prizes,
      row.feature.properties.sales_total,
      row.feature.properties.net_over_sales_pct,
    ]),
    hovertemplate: [
      "<b>%{customdata[0]}</b>",
      "%{customdata[1]}",
      "Premios brutos: %{customdata[2]:$,d}",
      "Premios netos: %{customdata[3]:$,d}",
      "Agencias con premios: %{customdata[4]}",
      "Venta comunal: %{customdata[5]:$,d}",
      "Premio neto / venta: %{customdata[6]:.2f}%",
      valueKey === "net_over_sales_pct" ? "Lectura: suerte relativa comunal" : "",
      "<extra></extra>",
    ].filter(Boolean).join("<br>"),
  };
  const layout = {
    autosize: true,
    margin: { t: 0, r: 0, b: 0, l: 0 },
    paper_bgcolor: "#fbfcfc",
    plot_bgcolor: "#fbfcfc",
    dragmode: "pan",
    mapbox: {
      style: "carto-positron",
      center: view.center,
      zoom: view.zoom,
    },
  };
  if (view.fitbounds) {
    layout.mapbox.fitbounds = view.fitbounds;
  }
  const config = {
    displayModeBar: false,
    responsive: true,
    scrollZoom: true,
  };
  Plotly.newPlot(element, [...thermalTraces, legendTrace, hoverTrace], layout, config).then(() => {
    const width = element.clientWidth || element.offsetWidth || 0;
    const height = element.clientHeight || element.offsetHeight || 560;
    if (width > 0 && height > 0) {
      Plotly.relayout(element, { width, height });
    }
    Plotly.Plots.resize(element);
    requestAnimationFrame(() => Plotly.Plots.resize(element));
  });
}

function territorialThermalLayers(rows, colorscale, transformed, valueKey = "gross_total") {
  const areas = rows.map((row) => row.area).filter((value) => value > 0);
  const minArea = areas.length ? Math.min(...areas) : 1;
  const maxArea = areas.length ? Math.max(...areas) : minArea;
  const layerMultipliers = valueKey === "net_over_sales_pct"
    ? [4.9, 3.15, 1.85]
    : [4.4, 2.85, 1.7];
  const opacities = valueKey === "net_over_sales_pct"
    ? [0.16, 0.25, 0.36]
    : [0.14, 0.22, 0.34];
  return layerMultipliers.map((multiplier, index) => ({
    type: "densitymapbox",
    lat: rows.map((row) => row.lat),
    lon: rows.map((row) => row.lon),
    z: rows.map((row) => row.scaled),
    radius: rows.map((row) => areaWeightedRadius(row, minArea, maxArea, multiplier, valueKey)),
    hoverinfo: "skip",
    colorscale,
    zmin: transformed.zmin,
    zmax: transformed.zmax,
    showscale: false,
    opacity: opacities[index],
  }));
}

function areaWeightedRadius(row, minArea, maxArea, multiplier, valueKey = "gross_total") {
  const safeArea = Math.max(row.area || minArea, minArea);
  const minLog = Math.log10(1 + minArea);
  const maxLog = Math.log10(1 + maxArea);
  const areaLog = Math.log10(1 + safeArea);
  const normalizedArea = (areaLog - minLog) / Math.max(maxLog - minLog, 1e-9);
  const curvedArea = Math.pow(normalizedArea, 0.72);
  const normalizedValue = clamp(row.scaled, 0, 1);
  const curvedValue = valueKey === "net_over_sales_pct"
    ? Math.pow(normalizedValue, 1.05)
    : Math.pow(normalizedValue, 0.58);
  const baseRadius = 18 + curvedArea * 42;
  const valueBoost = 0.92 + curvedValue * 1.45;
  return baseRadius * valueBoost * multiplier;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function territorialPrizeScale(values, valueKey = "gross_total") {
  if (valueKey === "net_over_sales_pct") {
    const sorted = [...values].sort((a, b) => a - b);
    const ranked = values.map((value) => {
      const index = sorted.findIndex((item) => item === value);
      const percentile = sorted.length <= 1 ? 1 : index / (sorted.length - 1);
      return Math.max(0.08, percentile);
    });
    return {
      values: ranked,
      zmin: 0,
      zmax: 1,
    };
  }
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  return {
    values: values.map((value) => territorialPrizeScaleValue(value, minValue, maxValue, valueKey)),
    zmin: 0,
    zmax: 1,
  };
}

function territorialPrizeScaleValue(value, minValue, maxValue, valueKey = "gross_total") {
  if (valueKey === "net_over_sales_pct") {
    const safeMax = Math.max(maxValue, minValue + 1e-9);
    const normalized = (value - minValue) / (safeMax - minValue);
    return Math.max(0.08, Math.min(1, normalized));
  }
  const minLog = Math.log10(1 + minValue);
  const maxLog = Math.log10(1 + maxValue);
  const currentLog = Math.log10(1 + value);
  const normalized = (currentLog - minLog) / Math.max(maxLog - minLog, 1e-9);
  return Math.pow(Math.max(0, Math.min(1, normalized)), 0.72);
}

function territorialPrizeColorscale(valueKey = "gross_total") {
  if (valueKey === "net_over_sales_pct") {
    return [
      [0.0, "#fff8ef"],
      [0.18, "#ffe8c8"],
      [0.36, "#ffd29a"],
      [0.56, "#ffb774"],
      [0.74, "#fb8d59"],
      [0.88, "#ef6548"],
      [1.0, "#d7301f"],
    ];
  }
  return [
    [0.0, "#fff7ec"],
    [0.18, "#fee8c8"],
    [0.38, "#fdd49e"],
    [0.58, "#fdbb84"],
    [0.78, "#fc8d59"],
    [0.92, "#e34a33"],
    [1.0, "#b30000"],
  ];
}

function geometryCentroid(geometry) {
  if (!geometry || !geometry.type || !geometry.coordinates) {
    return null;
  }
  if (geometry.type === "Polygon") {
    return polygonCentroid(geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    const centroids = geometry.coordinates
      .map((polygon) => polygonCentroid(polygon))
      .filter(Boolean);
    if (!centroids.length) return null;
    const lon = centroids.reduce((sum, item) => sum + item[0], 0) / centroids.length;
    const lat = centroids.reduce((sum, item) => sum + item[1], 0) / centroids.length;
    return [lon, lat];
  }
  return null;
}

function polygonCentroid(coordinates) {
  const ring = coordinates?.[0];
  if (!ring || ring.length < 3) {
    return null;
  }
  let area = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const factor = x1 * y2 - x2 * y1;
    area += factor;
    x += (x1 + x2) * factor;
    y += (y1 + y2) * factor;
  }
  if (Math.abs(area) < 1e-9) {
    const lon = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
    const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
    return [lon, lat];
  }
  const denominator = area * 3;
  return [x / denominator, y / denominator];
}

function territorialPrizeColorbarTicks(minValue, maxValue, valueKey = "gross_total") {
  if (valueKey === "net_over_sales_pct") {
    return [
      { value: minValue, label: "baja" },
      { value: minValue + (maxValue - minValue) * 0.35, label: "media" },
      { value: minValue + (maxValue - minValue) * 0.7, label: "alta" },
      { value: maxValue, label: "muy alta" },
    ];
  }
  return prizeColorbarTicks(minValue, maxValue);
}

function renderCommuneMarketDetail(row, context) {
  if (!row) return "<p class='muted'>Selecciona una comuna.</p>";
  const agencies = communeAgencies(row.commune);
  const latestSeries = row.monthly_series[row.monthly_series.length - 1];
  const gap = row.gap_vs_latest_month_benchmark_per_100k;
  return `
    <div class="commune-market-detail-head">
      <div>
        <h3>${escapeHtml(row.commune)}</h3>
        <p>${number(agencies.length)} agencias georreferenciadas en la comuna · ${escapeHtml(row.latest_month_label || "-")}</p>
      </div>
      <span>Ultimo mes: ${escapeHtml(row.latest_month_label || "-")}</span>
    </div>
    <div class="commune-market-stats">
      ${segmentMetric("Poblacion mayor de 18", number(row.population || 0))}
      ${segmentMetric("Prom. ventas", money(row.overall_avg_sales || 0))}
      ${segmentMetric("Prom. ventas / habitante", money(row.overall_avg_sales_per_adult || 0))}
      ${segmentMetric("Prom. ventas / 100k", money(row.overall_avg_sales_per_100k_adults || 0))}
      ${segmentMetric("Ultimo mes / 100k", money(row.latest_month_avg_sales_per_100k_adults || 0))}
    </div>
    <div class="commune-market-map-card">
      <div class="commune-market-map-head">
        <strong>Mapa de agencias en la comuna</strong>
        <span>${number(agencies.length)} puntos con coordenadas</span>
      </div>
      <div id="communeMarketMap" class="leaflet-map commune-market-map" aria-label="Mapa comunal"></div>
    </div>
    <div class="commune-market-series-wrap">
      ${communeMonthlySeriesChart(row.monthly_series, context.months || [])}
    </div>
    <div class="commune-market-month-table">
      <div class="commune-market-month-head">
        <span>Mes</span>
        <span>Prom. semanal</span>
        <span>/ hab. 18+</span>
        <span>/ 100k</span>
      </div>
      ${row.monthly_series.map((item) => `
        <div class="commune-market-month-row">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${money(item.avg_sales || 0)}</span>
          <span>${money(item.avg_sales_per_adult || 0)}</span>
          <span>${money(item.avg_sales_per_100k_adults || 0)}</span>
        </div>
      `).join("")}
    </div>
    <p class="commune-market-footnote">
      ${escapeHtml(row.latest_month_label || "-")}: ${money(latestSeries?.avg_sales || 0)} promedio semanal total en la comuna. Gap vs benchmark red del ultimo mes: ${gap === null || gap === undefined ? "s/d" : signedMoney(gap)} por 100k.
    </p>
  `;
}

function communeAgencies(commune) {
  return (state.data?.agencies || []).filter((agency) =>
    agency.comuna === commune &&
    agency.latitude !== null &&
    agency.longitude !== null
  );
}

function renderCommuneMarketMap(row) {
  destroyCommuneMap();
  const element = document.getElementById("communeMarketMap");
  if (!element || !row || !window.L) return;
  const agencies = communeAgencies(row.commune);
  if (!agencies.length) {
    element.outerHTML = "<p class='muted'>No hay agencias georreferenciadas para esta comuna.</p>";
    return;
  }
  const points = agencies.map((agency) => ({
    lat: agency.latitude,
    lon: agency.longitude,
    sales: weekSnapshot(agency, state.week)?.sales || 0,
    zone: agency.territory || "Sin territorio",
    code: agency.lotos_code,
    name: agency.agent_name || "Sin nombre",
    comuna: agency.comuna || row.commune,
    history: agency.history || [],
  }));
  state.maps.commune = initCommuneMap("communeMarketMap", points);
}

function initCommuneMap(id, points) {
  const map = L.map(id, {
    zoomControl: true,
    scrollWheelZoom: false,
    preferCanvas: true,
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  const pointBounds = L.latLngBounds(points.map((point) => [point.lat, point.lon]));
  if (points.length === 1) {
    const [point] = points;
    map.setView([point.lat, point.lon], 13);
  } else {
    map.fitBounds(pointBounds.pad(0.35), { padding: [18, 18], maxZoom: 13 });
  }
  map.setMinZoom(11);

  points.forEach((point) => {
    L.circleMarker([point.lat, point.lon], {
      radius: mapPointRadius(point.sales) + 2,
      color: "white",
      weight: 1,
      fillColor: zoneColor(point.zone),
      fillOpacity: 0.76,
    })
      .bindPopup(mapPopup(point), { maxWidth: 280 })
      .addTo(map);
  });
  setTimeout(() => map.invalidateSize(), 0);
  return map;
}

function communeMonthlySeriesChart(series, months) {
  const ordered = (months || []).map((month) => {
    const point = (series || []).find((item) => item.month === month.month);
    return point ? { ...point, benchmarkLabel: month.label } : {
      month: month.month,
      label: month.label,
      avg_sales: null,
      avg_sales_per_100k_adults: null,
      benchmark_avg_sales_per_100k_adults: month.avg_sales_per_100k_adults,
    };
  }).filter((item) => item.benchmark_avg_sales_per_100k_adults !== null || item.avg_sales_per_100k_adults !== null);
  if (!ordered.length) return "<p class='muted'>Sin serie mensual.</p>";
  const width = 560;
  const height = 220;
  const margin = { top: 22, right: 18, bottom: 42, left: 72 };
  const valuePoints = ordered.flatMap((item) => [item.avg_sales_per_100k_adults || 0, item.benchmark_avg_sales_per_100k_adults || 0]);
  const maxValue = Math.max(...valuePoints, 1);
  const x = (index) => margin.left + (index / Math.max(ordered.length - 1, 1)) * (width - margin.left - margin.right);
  const y = (value) => margin.top + (1 - value / maxValue) * (height - margin.top - margin.bottom);
  const communePath = ordered.reduce((path, item, index) => {
    if (item.avg_sales_per_100k_adults === null) return path;
    return `${path}${path ? " L" : "M"}${x(index)},${y(item.avg_sales_per_100k_adults)}`;
  }, "");
  const benchmarkPath = ordered.reduce((path, item, index) => {
    if (item.benchmark_avg_sales_per_100k_adults === null) return path;
    return `${path}${path ? " L" : "M"}${x(index)},${y(item.benchmark_avg_sales_per_100k_adults)}`;
  }, "");
  return `
    <svg class="line-svg" viewBox="0 0 ${width} ${height}" aria-label="Serie mensual relativa por comuna">
      <line class="grid-line" x1="${margin.left}" y1="${y(maxValue)}" x2="${width - margin.right}" y2="${y(maxValue)}"></line>
      <line class="grid-line" x1="${margin.left}" y1="${y(0)}" x2="${width - margin.right}" y2="${y(0)}"></line>
      <text class="axis-label" x="${margin.left - 8}" y="${y(maxValue) + 4}" text-anchor="end">${shortMoney(maxValue)}</text>
      <text class="axis-label" x="${margin.left - 8}" y="${y(0) + 4}" text-anchor="end">$0</text>
      <path class="spark-path-network" d="${benchmarkPath}"></path>
      <path class="spark-path" d="${communePath}"></path>
      ${ordered.map((item, index) => item.benchmark_avg_sales_per_100k_adults !== null
        ? `<circle class="spark-dot-network" cx="${x(index)}" cy="${y(item.benchmark_avg_sales_per_100k_adults)}" r="3"><title>${escapeHtml(item.label)} benchmark red: ${money(item.benchmark_avg_sales_per_100k_adults)}/100k</title></circle>`
        : "").join("")}
      ${ordered.map((item, index) => item.avg_sales_per_100k_adults !== null
        ? `<circle class="spark-dot" cx="${x(index)}" cy="${y(item.avg_sales_per_100k_adults)}" r="4"><title>${escapeHtml(item.label)} comuna: ${money(item.avg_sales_per_100k_adults)}/100k · promedio semanal ${money(item.avg_sales || 0)}</title></circle>`
        : "").join("")}
      ${ordered.map((item, index) => `<text class="axis-label" x="${x(index)}" y="${height - 12}" text-anchor="middle">${escapeHtml(item.label.split(" ")[0])}</text>`).join("")}
      <text class="axis-title" x="${margin.left}" y="16">Promedio semanal del mes por 100.000 hab. 18+</text>
    </svg>
    <div class="spark-legend"><span><i class="agency"></i>Comuna seleccionada</span><span><i class="network-gray"></i>Benchmark red</span></div>
  `;
}

function bindPopulationRows() {
  document.querySelectorAll(".population-row[data-commune]").forEach((row) => {
    row.addEventListener("click", () => {
      renderCommuneDetail(row.dataset.commune);
    });
  });
}

function topAverageAgencies(agencies) {
  return [...agencies]
    .filter((agency) => (agency.time_series?.avg_sales || 0) > 0)
    .sort((a, b) => (b.time_series?.avg_sales || 0) - (a.time_series?.avg_sales || 0))
    .slice(0, 50);
}

function segmentMetrics(agencies, week, fullSales = null) {
  const current = agencies.map((agency) => ({ agency, snapshot: weekSnapshot(agency, week) })).filter((item) => item.snapshot);
  const sales = current.reduce((sum, item) => sum + (item.snapshot.sales || 0), 0);
  const previousSales = current.reduce((sum, item) => sum + (previousSnapshot(item.agency, week)?.sales || 0), 0);
  const selling = current.filter((item) => item.snapshot.sales > 0).length;
  const avgAgencySales = agencies.length ? sales / agencies.length : 0;
  const avgSeriesSales = agencies.length
    ? agencies.reduce((sum, agency) => sum + (agency.time_series?.avg_sales || 0), 0) / agencies.length
    : 0;
  return {
    agencies: agencies.length,
    sales,
    previousSales,
    delta: sales - previousSales,
    selling,
    sellingRate: selling / Math.max(agencies.length, 1),
    avgAgencySales,
    avgSeriesSales,
    share: fullSales ? sales / fullSales : 1,
    trajectories: countTrajectories(agencies),
    territories: countSegmentTerritories(agencies, week),
  };
}

function renderSegmentCard(title, subtitle, metrics, mapId) {
  const topTerritories = Object.entries(metrics.territories)
    .sort((a, b) => b[1].sales - a[1].sales)
    .slice(0, 4);
  return `
    <article class="segment-card">
      <div class="segment-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <span>S${state.week}</span>
      </div>
      <div class="segment-metrics">
        ${segmentMetric("Venta semana", money(metrics.sales))}
        ${segmentMetric("Cambio vs previa", signedMoney(metrics.delta), metrics.delta < 0 ? "red" : "green")}
        ${segmentMetric("Agencias con venta", `${number(metrics.selling)} / ${number(metrics.agencies)}`)}
        ${segmentMetric("Cobertura", percent(metrics.sellingRate))}
        ${segmentMetric("Prom. agencia semana", money(metrics.avgAgencySales))}
        ${segmentMetric("Prom. agencia serie", money(metrics.avgSeriesSales))}
        ${segmentMetric("Participacion red", percent(metrics.share))}
      </div>
      <div class="segment-subsection">
        <strong>Trayectorias</strong>
        ${renderSegmentTrajectory(metrics.trajectories, metrics.agencies)}
      </div>
      <div class="segment-subsection">
        <strong>Territorios</strong>
        <div class="segment-territories">
          ${topTerritories.map(([territory, item]) => `<span>${escapeHtml(territory)} · ${money(item.sales)} · ${number(item.agencies)} ag.</span>`).join("") || "<span>Sin territorio</span>"}
        </div>
      </div>
      <div id="${mapId}" class="segment-map" aria-label="${escapeHtml(title)}"></div>
    </article>
  `;
}

function segmentMetric(label, value, tone = "") {
  return `
    <div class="segment-metric ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function countTrajectories(agencies) {
  return agencies.reduce((acc, agency) => {
    const trajectory = agency.time_series?.trajectory || "sin_clasificar";
    acc[trajectory] = (acc[trajectory] || 0) + 1;
    return acc;
  }, {});
}

function countSegmentTerritories(agencies, week) {
  return agencies.reduce((acc, agency) => {
    const snapshot = weekSnapshot(agency, week);
    const territory = snapshot?.territory || agency.territory || "Sin territorio";
    if (!acc[territory]) acc[territory] = { agencies: 0, sales: 0 };
    acc[territory].agencies += 1;
    acc[territory].sales += snapshot?.sales || 0;
    return acc;
  }, {});
}

function renderSegmentTrajectory(counts, total) {
  const order = ["creciente", "estable", "deterioro", "intermitente", "reactivada", "apagada", "sin_venta"];
  return `
    <div class="segment-trajectory">
      ${order.filter((key) => counts[key]).map((key) => {
        const value = counts[key];
        return `
          <div>
            <span>${trajectoryLabel(key)}</span>
            <i style="width:${Math.max(4, (value / Math.max(total, 1)) * 100)}%"></i>
            <strong>${number(value)}</strong>
          </div>
        `;
      }).join("") || "<p class='muted'>Sin trayectorias.</p>"}
    </div>
  `;
}

function segmentMapPoints(agencies) {
  return agencies
    .filter((agency) => Number.isFinite(agency.latitude) && Number.isFinite(agency.longitude))
    .map((agency) => ({
      lotosCode: agency.lotos_code,
      code: agency.lotos_code,
      name: agency.agent_name || "Sin nombre",
      zone: agency.territory || "Sin zona",
      comuna: agency.comuna || "Sin comuna",
      lat: agency.latitude,
      lon: agency.longitude,
      sales: weekSnapshot(agency, state.week)?.sales || 0,
      history: agency.history || [],
    }))
    .filter((point) => point.sales > 0);
}

function initSegmentMap(id, points) {
  const map = L.map(id, {
    zoomControl: true,
    scrollWheelZoom: false,
    preferCanvas: true,
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  const chileBounds = [[-56.2, -76.5], [-17.2, -66.0]];
  map.fitBounds(chileBounds, { padding: [14, 14] });
  points.forEach((point) => {
    const marker = L.circleMarker([point.lat, point.lon], {
      radius: mapPointRadius(point.sales),
      color: "white",
      weight: 1,
      fillColor: zoneColor(point.zone),
      fillOpacity: 0.72,
    })
      .bindPopup(mapPopup(point), { maxWidth: 280 })
      .addTo(map);
    marker.on("click", () => {
      const agency = state.data.agencies.find((item) => item.lotos_code === point.lotosCode);
      if (agency) {
        state.selectedAgency = agency;
        renderDetail(agency);
      }
    });
  });
  setTimeout(() => map.invalidateSize(), 0);
  return map;
}

function renderSeriesAnalysis(agencies) {
  const weeks = state.data.weeks || [];
  setText("seriesWindow", weeks.length ? `S${weeks[0]}-S${weeks[weeks.length - 1]} · ${weeks.length} semanas` : "Sin semanas");
  renderSeriesNarrative(agencies);
  renderTrajectoryMix(agencies);
  renderSeriesSignals(agencies);
  renderTrajectoryByTerritory(agencies);
  renderSeriesRanking("growthRanking", agencies, "slope_per_week", true, "crecimiento");
  renderSeriesRanking("deteriorationRanking", agencies, "slope_per_week", false, "deterioro");
  renderSeriesRanking("volatilityRanking", agencies, "volatility", true, "volatilidad");
}

function renderSeriesNarrative(agencies) {
  const total = Math.max(agencies.length, 1);
  const counts = agencies.reduce((acc, agency) => {
    const trajectory = agency.time_series?.trajectory || "sin_clasificar";
    acc[trajectory] = (acc[trajectory] || 0) + 1;
    return acc;
  }, {});
  const deteriorating = counts.deterioro || 0;
  const apagadas = counts.apagada || 0;
  const growing = counts.creciente || 0;
  const recentDelta = agencies.reduce((sum, agency) => sum + (agency.time_series?.recent_delta_sales || 0), 0) / total;
  const jackpot = latestJackpotContext();
  const jackpotText = jackpot
    ? `Los PDF Quick Report aportan pozos promedio separados para S${jackpot.week}: ${number(jackpot.loto_total_mm)} MM$ Loto y ${number(jackpot.kino_total_mm)} MM$ Kino, calculados sobre ${number(Object.keys(jackpot.draws || {}).length)} sorteos.`
    : "No hay pozos cargados desde PDF para cruzar contra la serie.";
  document.getElementById("seriesNarrative").innerHTML = `
    <p>La lectura temporal separa agencias por forma de comportamiento, no solo por la ultima semana. En el filtro actual, ${number(deteriorating)} agencias muestran deterioro sostenido, ${number(apagadas)} estan apagadas y ${number(growing)} muestran crecimiento persistente.</p>
    <p>El cambio promedio reciente es ${signedMoney(recentDelta)} por agencia. Si este valor cae mientras la venta total se sostiene, la concentracion probablemente se esta moviendo hacia menos puntos de venta.</p>
    <p>${escapeHtml(jackpotText)}</p>
  `;
}

function renderTrajectoryByTerritory(agencies) {
  const trajectories = ["creciente", "estable", "deterioro", "intermitente", "reactivada", "apagada"];
  const groups = agencies.reduce((acc, agency) => {
    const territory = agency.territory || "Sin territorio";
    const trajectory = agency.time_series?.trajectory || "sin_clasificar";
    if (!acc[territory]) {
      acc[territory] = { total: 0, trajectories: {} };
    }
    acc[territory].total += 1;
    acc[territory].trajectories[trajectory] = (acc[territory].trajectories[trajectory] || 0) + 1;
    return acc;
  }, {});
  const rows = Object.entries(groups)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([territory, payload]) => {
      const cells = trajectories.map((trajectory) => {
        const value = payload.trajectories[trajectory] || 0;
        const rate = value / Math.max(payload.total, 1);
        return `
          <div class="trajectory-cell" title="${trajectoryLabel(trajectory)}: ${number(value)} agencias">
            <span>${trajectoryLabel(trajectory)}</span>
            <strong>${number(value)}</strong>
            <em>${percent(rate)}</em>
          </div>
        `;
      }).join("");
      return `
        <div class="trajectory-territory-row">
          <div class="trajectory-territory-name">
            <strong>${escapeHtml(territory)}</strong>
            <span>${number(payload.total)} agencias</span>
          </div>
          ${cells}
        </div>
      `;
    }).join("");
  document.getElementById("trajectoryByTerritory").innerHTML = rows || "<p class='muted'>Sin datos para los filtros.</p>";
}

function renderTrajectoryMix(agencies) {
  const counts = agencies.reduce((acc, agency) => {
    const trajectory = agency.time_series?.trajectory || "sin_clasificar";
    acc[trajectory] = (acc[trajectory] || 0) + 1;
    return acc;
  }, {});
  const total = Math.max(agencies.length, 1);
  const order = ["creciente", "estable", "deterioro", "intermitente", "reactivada", "apagada", "sin_venta"];
  document.getElementById("trajectoryMix").innerHTML = order
    .filter((key) => counts[key])
    .map((key) => {
      const value = counts[key];
      return `
        <div class="trajectory-row">
          <div class="trajectory-label"><span class="trajectory-dot trajectory-${key}"></span>${trajectoryLabel(key)}</div>
          <div class="trajectory-track"><div style="width:${Math.max(3, (value / total) * 100)}%"></div></div>
          <strong>${number(value)}</strong>
        </div>
      `;
    }).join("") || "<p class='muted'>Sin datos para los filtros.</p>";
}

function renderSeriesSignals(agencies) {
  const total = Math.max(agencies.length, 1);
  const deteriorating = agencies.filter((agency) => agency.time_series?.trajectory === "deterioro").length;
  const growing = agencies.filter((agency) => agency.time_series?.trajectory === "creciente").length;
  const volatile = agencies.filter((agency) => (agency.time_series?.volatility || 0) >= 0.9).length;
  const persistentZero = agencies.filter((agency) => (agency.time_series?.zero_streak || 0) >= 2).length;
  const avgRecentDelta = agencies.reduce((sum, agency) => sum + (agency.time_series?.recent_delta_sales || 0), 0) / total;
  const jackpot = latestJackpotContext();
  const signals = [
    { label: "En deterioro", value: `${number(deteriorating)} (${percent(deteriorating / total)})`, tone: "red" },
    { label: "Crecimiento sostenido", value: `${number(growing)} (${percent(growing / total)})`, tone: "green" },
    { label: "Alta volatilidad", value: `${number(volatile)} (${percent(volatile / total)})`, tone: "amber" },
    { label: "Racha cero venta", value: `${number(persistentZero)} agencias`, tone: "blue" },
    { label: "Cambio promedio reciente", value: signedMoney(avgRecentDelta), tone: avgRecentDelta < 0 ? "red" : "green" },
    { label: jackpot ? `Pozo Loto S${jackpot.week}` : "Pozo Loto", value: jackpot ? `${number(jackpot.loto_total_mm)} MM$` : "Sin dato", tone: "blue" },
  ];
  document.getElementById("seriesSignals").innerHTML = signals.map((signal) => `
    <div class="signal-item ${signal.tone}">
      <span>${escapeHtml(signal.label)}</span>
      <strong>${escapeHtml(signal.value)}</strong>
    </div>
  `).join("");
}

function renderSeriesRanking(id, agencies, metric, reverse, kind) {
  const ranked = [...agencies]
    .filter((agency) => agency.time_series)
    .sort((a, b) => {
      const av = a.time_series[metric] || 0;
      const bv = b.time_series[metric] || 0;
      return reverse ? bv - av : av - bv;
    })
    .slice(0, 6);
  document.getElementById(id).innerHTML = ranked.map((agency, index) => {
    const ts = agency.time_series;
    const metricText = kind === "volatilidad"
      ? `${(ts.volatility || 0).toFixed(2)} cv`
      : `${signedMoney(ts.slope_per_week || 0)}/sem`;
    return `
      <button class="ranking-item" data-lotos="${escapeHtml(agency.lotos_code)}">
        <span>${index + 1}</span>
        <strong>${escapeHtml(agency.lotos_code)} · ${escapeHtml(agency.agent_name || "Sin nombre")}</strong>
        <em>${metricText} · ${trajectoryLabel(ts.trajectory)}</em>
      </button>
    `;
  }).join("");
  document.querySelectorAll(`#${id} .ranking-item`).forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAgency = state.data.agencies.find((agency) => agency.lotos_code === button.dataset.lotos);
      renderDetail(state.selectedAgency);
    });
  });
}

function renderTerritoryChart(agencies) {
  const groups = groupByCurrent(agencies, "territory");
  const maxSales = Math.max(...groups.map((item) => item.sales), 1);
  const html = groups.map((item) => {
    const width = Math.max(2, (item.sales / maxSales) * 100);
    return `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(item.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        <div class="bar-value">${money(item.sales)}</div>
        <div class="bar-meta">${number(item.selling)} con venta de ${number(item.agencies)} agencias · ${percent(item.selling / item.agencies)}</div>
      </div>
    `;
  }).join("");
  document.getElementById("territoryChart").innerHTML = html || "<p class='muted'>Sin datos para los filtros.</p>";
}

function renderTrendChart() {
  const weekTotals = state.data.weeks.map((week) => {
    const total = state.data.agencies.reduce((sum, agency) => {
      return sum + (weekSnapshot(agency, week)?.sales || 0);
    }, 0);
    return { week, total };
  });
  const max = Math.max(...weekTotals.map((item) => item.total), 1);
  document.getElementById("trendChart").innerHTML = weekTotals.map((item) => {
    const height = Math.max(6, (item.total / max) * 168);
    const current = item.week === state.week ? "current" : "";
    return `
      <div class="trend-bar ${current}">
        <div class="trend-column" title="${money(item.total)}" style="height:${height}px"></div>
        <div class="trend-label">S${item.week}<br>${shortMoney(item.total)}</div>
      </div>
    `;
  }).join("");
}

function renderJackpotChart() {
  const container = document.getElementById("jackpotChart");
  const summary = document.getElementById("jackpotSummary");
  if (!container) return;
  const rows = state.data.weekly_sales_with_jackpots || [];
  const drawable = rows.filter((row) => row.sales || row.jackpot_total_mm);
  if (!drawable.length) {
    container.innerHTML = "<p class='muted'>Sin datos de pozos PDF para graficar.</p>";
    if (summary) summary.textContent = "Sin datos de pozos PDF.";
    return;
  }

  const width = 980;
  const height = 330;
  const margin = { top: 28, right: 128, bottom: 58, left: 78 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const salesValues = drawable.map((row) => row.sales || 0);
  const jackpotValues = drawable.flatMap((row) => [row.loto_total_mm || 0, row.kino_total_mm || 0]);
  const maxSales = Math.max(...salesValues, 1);
  const maxJackpot = Math.max(...jackpotValues, 1);
  const x = (index) => margin.left + (index / Math.max(drawable.length - 1, 1)) * plotWidth;
  const ySales = (value) => margin.top + (1 - (value || 0) / maxSales) * plotHeight;
  const yJackpot = (value) => margin.top + (1 - (value || 0) / maxJackpot) * plotHeight;
  const line = (field, yFn, requireValue = true) => drawable
    .map((row, index) => ({ value: row[field], index }))
    .filter((point) => !requireValue || point.value !== null && point.value !== undefined)
    .map((point, segmentIndex) => `${segmentIndex === 0 ? "M" : "L"}${x(point.index)},${yFn(point.value || 0)}`)
    .join(" ");
  const salesPath = line("sales", ySales);
  const lotoPath = line("loto_total_mm", yJackpot);
  const kinoPath = line("kino_total_mm", yJackpot);
  const salesWithLotoJackpot = drawable.filter((row) => row.sales && row.loto_total_mm);
  const lotoCorrelation = pearson(
    salesWithLotoJackpot.map((row) => row.sales),
    salesWithLotoJackpot.map((row) => row.loto_total_mm),
  );
  const salesWithKinoJackpot = drawable.filter((row) => row.sales && row.kino_total_mm);
  const kinoCorrelation = pearson(
    salesWithKinoJackpot.map((row) => row.sales),
    salesWithKinoJackpot.map((row) => row.kino_total_mm),
  );
  const topLotoJackpot = [...drawable].filter((row) => row.loto_total_mm).sort((a, b) => b.loto_total_mm - a.loto_total_mm)[0];
  const topKinoJackpot = [...drawable].filter((row) => row.kino_total_mm).sort((a, b) => b.kino_total_mm - a.kino_total_mm)[0];
  const topSales = [...drawable].filter((row) => row.sales).sort((a, b) => b.sales - a.sales)[0];
  const corrText = [
    `corr. venta vs Loto ${lotoCorrelation === null ? "s/d" : round(lotoCorrelation).toFixed(1)}`,
    `corr. venta vs Kino ${kinoCorrelation === null ? "s/d" : round(kinoCorrelation).toFixed(1)}`,
  ].join(" · ");
  if (summary) {
    summary.textContent = topLotoJackpot
      ? `Venta corresponde a agencias Loto. Mayor pozo promedio Loto: S${topLotoJackpot.week}, ${number(topLotoJackpot.loto_total_mm)} MM$. Mayor pozo promedio Kino: S${topKinoJackpot ? topKinoJackpot.week : "-"}, ${topKinoJackpot ? number(topKinoJackpot.kino_total_mm) : "s/d"} MM$. Mayor venta Loto: S${topSales?.week || "-"}, ${topSales ? money(topSales.sales) : "sin dato"}. ${corrText}.`
      : "Los PDFs aun no aportan pozos comparables.";
  }

  const salesTicks = [0, maxSales / 2, maxSales];
  const jackpotTicks = [0, maxJackpot / 2, maxJackpot];
  container.innerHTML = `
    <svg class="jackpot-svg" viewBox="0 0 ${width} ${height}">
      ${salesTicks.map((value) => `
        <line class="grid-line" x1="${margin.left}" y1="${ySales(value)}" x2="${width - margin.right}" y2="${ySales(value)}"></line>
        <text class="axis-label" x="${margin.left - 10}" y="${ySales(value) + 4}" text-anchor="end">${shortMoney(value)}</text>
      `).join("")}
      ${jackpotTicks.map((value) => `
        <text class="axis-label jackpot-axis" x="${width - margin.right + 10}" y="${yJackpot(value) + 4}">${number(Math.round(value))} MM$</text>
      `).join("")}
      <path class="jackpot-line sales" d="${salesPath}"></path>
      <path class="jackpot-line loto" d="${lotoPath}"></path>
      <path class="jackpot-line kino" d="${kinoPath}"></path>
      ${drawable.map((row, index) => `
        <g>
          <rect x="${x(index) - 18}" y="${margin.top}" width="36" height="${plotHeight}" fill="transparent">
            <title>${jackpotTooltip(row)}</title>
          </rect>
          ${row.sales ? `<circle class="jackpot-dot sales" cx="${x(index)}" cy="${ySales(row.sales)}" r="4"><title>S${row.week} venta: ${money(row.sales)}</title></circle>` : ""}
          ${row.loto_total_mm ? `<circle class="jackpot-dot loto" cx="${x(index)}" cy="${yJackpot(row.loto_total_mm)}" r="4"><title>S${row.week} Loto: ${number(row.loto_total_mm)} MM$ · ${number(row.jackpot_draws || 0)} sorteos PDF</title></circle>` : ""}
          ${row.kino_total_mm ? `<circle class="jackpot-dot kino" cx="${x(index)}" cy="${yJackpot(row.kino_total_mm)}" r="4"><title>S${row.week} Kino: ${number(row.kino_total_mm)} MM$ · ${number(row.jackpot_draws || 0)} sorteos PDF</title></circle>` : ""}
          <text class="axis-label" x="${x(index)}" y="${height - 22}" text-anchor="middle">S${row.week}</text>
        </g>
      `).join("")}
      <text class="axis-title" x="${margin.left}" y="18">Venta semanal agencias Loto</text>
      <text class="axis-title jackpot-axis" x="${width - margin.right}" y="18" text-anchor="end">Pozo promedio por juego MM$</text>
    </svg>
    <div class="jackpot-legend">
      <span><i class="sales"></i>Venta agencias Loto</span>
      <span><i class="loto"></i>Loto</span>
      <span><i class="kino"></i>Kino</span>
    </div>
  `;
}

function jackpotTooltip(row) {
  return [
    `Semana ${row.week}`,
    row.sales ? `Venta total: ${money(row.sales)}` : "Venta total: s/d",
    row.loto_total_mm ? `Pozo Loto: ${number(row.loto_total_mm)} MM$` : "Pozo Loto: s/d",
    row.kino_total_mm ? `Pozo Kino: ${number(row.kino_total_mm)} MM$` : "Pozo Kino: s/d",
    `Sorteos PDF: ${number(row.jackpot_draws || 0)}`,
  ].join(" · ");
}

function renderTerritoryMaps(agencies) {
  const container = document.getElementById("territoryMaps");
  if (!container) return;
  destroyTerritoryMaps();
  const points = agencies
    .filter((agency) => Number.isFinite(agency.latitude) && Number.isFinite(agency.longitude))
    .map((agency) => ({
      code: agency.lotos_code,
      name: agency.agent_name || "Sin nombre",
      zone: agency.territory || "Sin zona",
      comuna: agency.comuna || "Sin comuna",
      lat: agency.latitude,
      lon: agency.longitude,
      sales: weekSnapshot(agency, state.week)?.sales || 0,
      history: agency.history || [],
    }))
    .filter((point) => point.sales > 0);
  const chileBounds = [[-56.2, -76.5], [-17.2, -66.0]];
  const rmBounds = [[-34.15, -71.45], [-32.95, -70.25]];
  const chilePoints = points.filter((point) => point.lat >= chileBounds[0][0] && point.lat <= chileBounds[1][0] && point.lon >= chileBounds[0][1] && point.lon <= chileBounds[1][1]);
  const rmPoints = points.filter((point) => point.lat >= rmBounds[0][0] && point.lat <= rmBounds[1][0] && point.lon >= rmBounds[0][1] && point.lon <= rmBounds[1][1]);
  container.innerHTML = `${renderLeafletMapCard("chileMap", "Chile", "Agencias con venta en la semana seleccionada", chilePoints, points.length - chilePoints.length)}${renderLeafletMapCard("rmMap", "Region Metropolitana", "Agencias con venta en RM Norte / RM Sur", rmPoints, points.length - rmPoints.length)}`;

  if (!window.L) {
    container.querySelectorAll(".leaflet-map").forEach((map) => {
      map.innerHTML = "<div class='map-unavailable'>No se pudo cargar Leaflet. Revisa conexion a internet para ver el mapa base.</div>";
    });
    return;
  }

  state.maps.territory.chile = initLeafletMap("chileMap", chileBounds, chilePoints, 3, 11, {
    center: [-35.7, -71.2],
    zoom: 4,
  });
  state.maps.territory.rm = initLeafletMap("rmMap", rmBounds, rmPoints, 8, 13, {
    center: [-33.45, -70.7],
    zoom: 9,
  });
}

function renderLeafletMapCard(id, title, subtitle, points, outOfBounds) {
  const zoneCounts = countBy(points, "zone");
  const zones = Object.keys(zoneCounts).sort((a, b) => a.localeCompare(b, "es"));
  return `
    <article class="map-card">
      <div class="map-card-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <span>${number(points.length)} con venta</span>
      </div>
      <div id="${id}" class="leaflet-map" aria-label="${escapeHtml(title)}"></div>
      <div class="map-legend">
        ${zones.map((zone) => `<span><i class="${zoneClass(zone)}"></i>${escapeHtml(zone)} · ${number(zoneCounts[zone])}</span>`).join("")}
      </div>
      ${outOfBounds ? `<p class="map-note">${number(outOfBounds)} agencias con venta quedan fuera del encuadre inicial; puedes navegar o usar el mapa correspondiente.</p>` : ""}
    </article>
  `;
}

function initLeafletMap(id, bounds, points, minZoom, maxZoomOnFit, fixedView = null) {
  const map = L.map(id, {
    zoomControl: true,
    scrollWheelZoom: false,
    preferCanvas: true,
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  if (fixedView) {
    map.setView(fixedView.center, fixedView.zoom);
    map.setMaxBounds(bounds);
  } else if (points.length) {
    const pointBounds = L.latLngBounds(points.map((point) => [point.lat, point.lon]));
    map.fitBounds(pointBounds, { padding: [18, 18], maxZoom: maxZoomOnFit });
  } else {
    map.fitBounds(bounds, { padding: [14, 14] });
  }
  map.setMinZoom(minZoom);
  points.forEach((point) => {
    L.circleMarker([point.lat, point.lon], {
      radius: mapPointRadius(point.sales) + 1.8,
      color: "white",
      weight: 1,
      fillColor: zoneColor(point.zone),
      fillOpacity: 0.72,
    })
      .bindPopup(mapPopup(point), { maxWidth: 280 })
      .addTo(map);
  });
  setTimeout(() => map.invalidateSize(), 0);
  return map;
}

function destroyTerritoryMaps() {
  Object.values(state.maps.territory || {}).forEach((map) => {
    if (map && typeof map.remove === "function") {
      map.remove();
    }
  });
  state.maps.territory = {};
}

function destroyAgencyMaps() {
  Object.values(state.maps.agencies || {}).forEach((map) => {
    if (map && typeof map.remove === "function") {
      map.remove();
    }
  });
  state.maps.agencies = {};
}

function destroyAgencySegmentMaps() {
  ["segmentFull", "segmentTop50"].forEach((key) => {
    const map = state.maps.agencies?.[key];
    if (map && typeof map.remove === "function") {
      map.remove();
    }
    if (state.maps.agencies) {
      delete state.maps.agencies[key];
    }
  });
}

function destroyAgencyPrizeMaps() {
  ["agencyPrizeMapChile", "agencyPrizeMapRm", "agencyPrizeNetMapChile", "agencyPrizeNetMapRm"].forEach((id) => {
    const element = document.getElementById(id);
    if (element && window.Plotly) {
      Plotly.purge(element);
    }
  });
  ["prizeChile", "prizeRm"].forEach((key) => {
    const map = state.maps.agencies?.[key];
    if (map && typeof map.remove === "function") {
      map.remove();
    }
    if (state.maps.agencies) {
      delete state.maps.agencies[key];
    }
  });
}

function destroyCommuneMap() {
  const map = state.maps.commune;
  if (map && typeof map.remove === "function") {
    map.remove();
  }
  state.maps.commune = null;
}

function destroyTerritorialPrizeCommunePlots() {
  ["territorialPrizeCommunesChile", "territorialPrizeCommunesRm", "territorialPrizeCommunesNetChile", "territorialPrizeCommunesNetRm"].forEach((id) => {
    const element = document.getElementById(id);
    if (element && window.Plotly) {
      Plotly.purge(element);
    }
  });
}

function invalidatePerspectiveMaps() {
  const groups = state.perspective === "territory"
    ? [...Object.values(state.maps.territory || {}), state.maps.commune]
    : Object.values(state.maps.agencies || {});
  groups.forEach((map) => {
    if (map && typeof map.invalidateSize === "function") {
      map.invalidateSize();
    }
  });
  if (state.perspective === "agencies" && window.Plotly) {
    ["agencyPrizeMapChile", "agencyPrizeMapRm", "agencyPrizeNetMapChile", "agencyPrizeNetMapRm"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        Plotly.Plots.resize(element);
      }
    });
  }
  if (state.perspective === "territory" && window.Plotly) {
    ["territorialPrizeCommunesChile", "territorialPrizeCommunesRm", "territorialPrizeCommunesNetChile", "territorialPrizeCommunesNetRm"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        Plotly.Plots.resize(element);
      }
    });
  }
}

function mapPopup(point) {
  return `
    <strong>${escapeHtml(point.code)} · ${escapeHtml(point.name)}</strong>
    <div>${escapeHtml(point.comuna)} · ${escapeHtml(point.zone)}</div>
    <div>Venta semana ${state.week}: ${money(point.sales)}</div>
    ${agencySparkline(point.history, "popup")}
  `;
}

function mapPointRadius(sales) {
  if (sales >= 2_000_000) return 4.2;
  if (sales >= 500_000) return 3.4;
  if (sales > 0) return 2.8;
  return 2.1;
}

function renderWeeklyZoneChart() {
  const rows = state.data.weekly_zone_evolution || [];
  const container = document.getElementById("weeklyZoneChart");
  const note = document.getElementById("weeklyNote");
  if (!rows.length) {
    note.textContent = "";
    container.innerHTML = "<p class='muted'>No encontre una hoja agrupada compatible para evolucion semanal.</p>";
    return;
  }

  const model = weeklyModel(rows);
  const lastWeek = model.weeks[model.weeks.length - 1];
  note.textContent = lastWeek ? `Serie semanal S${model.weeks[0].week}-S${lastWeek.week}. Fuente: LOTO_ Comuna; zona mapeada desde LOTO_ PtoVta.` : "";

  if (state.weeklyView === "smallMultiples") {
    container.innerHTML = renderWeeklySmallMultiples(model);
  } else if (state.weeklyView === "perAdult") {
    container.innerHTML = renderWeeklyPopulationLine(model, "sales_per_adult");
  } else if (state.weeklyView === "per100k") {
    container.innerHTML = renderWeeklyPopulationLine(model, "sales_per_100k_adults");
  } else if (state.weeklyView === "heatmap") {
    container.innerHTML = renderWeeklyHeatmap(model);
  } else if (state.weeklyView === "change") {
    container.innerHTML = renderWeeklyLatestChange(model);
  } else {
    container.innerHTML = renderWeeklyIndexedLine(model);
  }
}

function weeklyModel(rows) {
  const zones = [...new Set(rows.map((row) => row.zone))]
    .filter((zone) => zone !== "Sin zona")
    .sort((a, b) => a.localeCompare(b, "es"));
  const weeks = [...new Set(rows.map((row) => row.week))]
    .sort((a, b) => a - b)
    .map((week) => {
      const row = rows.find((item) => item.week === week);
      return { week, label: row.week_label || `S${week}` };
    });
  const byZone = zones.map((zone) => {
    const points = weeks.map((week) => {
      const row = rows.find((item) => item.zone === zone && item.week === week.week);
      return {
        week: week.week,
        label: week.label,
        sales: row?.sales || 0,
        communes: row?.communes || 0,
        populationAdult: row?.population_adult || 0,
        salesPerAdult: row?.sales_per_adult ?? null,
        salesPer100kAdults: row?.sales_per_100k_adults ?? null,
      };
    });
    const firstSales = points.find((point) => point.sales > 0)?.sales || 1;
    const indexed = points.map((point) => ({ ...point, index: (point.sales / firstSales) * 100 }));
    return { zone, points, indexed };
  });
  return { zones, weeks, byZone };
}

function renderWeeklyIndexedLine(model) {
  const width = 1080;
  const height = 380;
  const margin = { top: 26, right: 190, bottom: 56, left: 68 };
  const maxIndex = Math.max(...model.byZone.flatMap((zone) => zone.indexed.map((point) => point.index)), 120);
  const minIndex = Math.min(...model.byZone.flatMap((zone) => zone.indexed.map((point) => point.index)), 80);
  const yMin = Math.max(0, Math.floor(minIndex / 10) * 10 - 10);
  const yMax = Math.ceil(maxIndex / 10) * 10 + 10;
  const x = (index) => margin.left + (index / Math.max(model.weeks.length - 1, 1)) * (width - margin.left - margin.right);
  const y = (value) => margin.top + ((yMax - value) / (yMax - yMin || 1)) * (height - margin.top - margin.bottom);
  const gridValues = uniqueSorted([yMin, 100, yMax]);
  const tickIndexes = weeklyTickIndexes(model.weeks.length);

  return `
    <div class="chart-caption">Indice S${model.weeks[0].week}=100. Compara ritmo relativo entre zonas, independiente del tamaño de cada zona.</div>
    <svg class="line-svg" viewBox="0 0 ${width} ${height}" aria-label="Indice semanal por zona">
      ${gridValues.map((value) => `
        <line class="grid-line" x1="${margin.left}" y1="${y(value)}" x2="${width - margin.right}" y2="${y(value)}"></line>
        <text class="axis-label" x="${margin.left - 10}" y="${y(value) + 4}" text-anchor="end">${value}</text>
      `).join("")}
      ${tickIndexes.map((index) => `
        <text class="axis-label" x="${x(index)}" y="${height - 18}" text-anchor="middle">${escapeHtml(model.weeks[index].label)}</text>
      `).join("")}
      ${model.byZone.map((zoneData, zoneIndex) => {
        const path = zoneData.indexed.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"}${x(pointIndex)},${y(point.index)}`).join(" ");
        const lastPoint = zoneData.indexed[zoneData.indexed.length - 1];
        return `
          <path class="line-chart-path zone-stroke-${(zoneIndex % 4) + 1}" d="${path}"></path>
          ${zoneData.indexed.map((point, pointIndex) => `<circle class="line-dot zone-fill-${(zoneIndex % 4) + 1}" cx="${x(pointIndex)}" cy="${y(point.index)}" r="3.6"><title>${zoneData.zone} ${point.label}: indice ${point.index.toFixed(1)} · ${money(point.sales)}</title></circle>`).join("")}
          <text class="line-end-label" x="${width - margin.right + 12}" y="${safeLabelY(y(lastPoint.index), height)}">${escapeHtml(zoneData.zone)} ${lastPoint.index.toFixed(0)}</text>
        `;
      }).join("")}
    </svg>
  `;
}

function renderWeeklySmallMultiples(model) {
  const maxSales = Math.max(...model.byZone.flatMap((zone) => zone.points.map((point) => point.sales)), 1);
  return `
    <div class="chart-caption">Venta absoluta semanal. Todos los paneles usan la misma escala Y y las cifras completas aparecen al pasar el cursor.</div>
    <div class="small-multiple-grid">
      ${model.byZone.map((zoneData, zoneIndex) => renderSmallMultiple(zoneData, model.weeks, maxSales, zoneIndex)).join("")}
    </div>
  `;
}

function renderWeeklyPopulationLine(model, metric) {
  const isPer100k = metric === "sales_per_100k_adults";
  const title = isPer100k
    ? "Venta semanal por cada 100.000 habitantes mayores de 18 anos."
    : "Venta semanal promedio por habitante mayor de 18 anos.";
  const valueFor = (point) => isPer100k ? point.salesPer100kAdults : point.salesPerAdult;
  const values = model.byZone.flatMap((zone) => zone.points.map(valueFor).filter((value) => value !== null));
  if (!values.length) {
    return "<p class='muted'>No hay población censal adulta suficiente para normalizar la serie por zona.</p>";
  }

  const width = 1120;
  const height = 390;
  const margin = { top: 28, right: 230, bottom: 58, left: 96 };
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const yMin = Math.max(0, minValue * 0.92);
  const yMax = maxValue * 1.08;
  const x = (index) => margin.left + (index / Math.max(model.weeks.length - 1, 1)) * (width - margin.left - margin.right);
  const y = (value) => margin.top + ((yMax - value) / Math.max(yMax - yMin, 1)) * (height - margin.top - margin.bottom);
  const formatter = isPer100k ? money : (value) => `$${round(value).toFixed(0)}`;
  const tickIndexes = weeklyTickIndexes(model.weeks.length);
  const gridValues = uniqueSorted([yMin, (yMin + yMax) / 2, yMax]);

  return `
    <div class="chart-caption">${title} Denominador: poblacion comunal Censo 2024 filtrada a edad &gt; 18; permite comparar intensidad territorial semana a semana.</div>
    <svg class="line-svg" viewBox="0 0 ${width} ${height}" aria-label="${isPer100k ? "Venta por 100 mil adultos" : "Venta por adulto"} por zona">
      ${gridValues.map((value) => `
        <line class="grid-line" x1="${margin.left}" y1="${y(value)}" x2="${width - margin.right}" y2="${y(value)}"></line>
        <text class="axis-label" x="${margin.left - 10}" y="${y(value) + 4}" text-anchor="end">${formatter(value)}</text>
      `).join("")}
      ${tickIndexes.map((index) => `
        <text class="axis-label" x="${x(index)}" y="${height - 18}" text-anchor="middle">${escapeHtml(model.weeks[index].label)}</text>
      `).join("")}
      ${model.byZone.map((zoneData, zoneIndex) => {
        const available = zoneData.points
          .map((point, pointIndex) => ({ point, pointIndex, value: valueFor(point) }))
          .filter((item) => item.value !== null);
        const path = available.map((item, pathIndex) => `${pathIndex === 0 ? "M" : "L"}${x(item.pointIndex)},${y(item.value)}`).join(" ");
        const latest = available[available.length - 1];
        if (!available.length) return "";
        return `
          <path class="line-chart-path zone-stroke-${(zoneIndex % 4) + 1}" d="${path}"></path>
          ${available.map((item) => `<circle class="line-dot zone-fill-${(zoneIndex % 4) + 1}" cx="${x(item.pointIndex)}" cy="${y(item.value)}" r="3.5"><title>${escapeHtml(zoneData.zone)} ${escapeHtml(item.point.label)}: ${formatter(item.value)} · ${money(item.point.sales)} · pob. 18+ ${number(item.point.populationAdult)}</title></circle>`).join("")}
          <text class="line-end-label" x="${width - margin.right + 12}" y="${safeLabelY(y(latest.value), height)}">${escapeHtml(zoneData.zone)} ${formatter(latest.value)}</text>
        `;
      }).join("")}
    </svg>
  `;
}

function renderSmallMultiple(zoneData, weeks, maxSales, zoneIndex) {
  const width = 420;
  const height = 190;
  const margin = { top: 16, right: 18, bottom: 36, left: 58 };
  const x = (index) => margin.left + (index / Math.max(weeks.length - 1, 1)) * (width - margin.left - margin.right);
  const y = (value) => margin.top + ((maxSales - value) / maxSales) * (height - margin.top - margin.bottom);
  const path = zoneData.points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.sales)}`).join(" ");
  const tickIndexes = weeklyTickIndexes(weeks.length);
  const total = zoneData.points.reduce((sum, point) => sum + point.sales, 0);
  return `
    <div class="small-card">
      <div class="small-card-title">${escapeHtml(zoneData.zone)} <span title="${money(total)}">${shortMoney(total)}</span></div>
      <svg viewBox="0 0 ${width} ${height}" aria-label="${escapeHtml(zoneData.zone)} semanal">
        <line class="grid-line" x1="${margin.left}" y1="${y(maxSales)}" x2="${width - margin.right}" y2="${y(maxSales)}"></line>
        <line class="grid-line" x1="${margin.left}" y1="${y(0)}" x2="${width - margin.right}" y2="${y(0)}"></line>
        <text class="axis-label" x="${margin.left - 8}" y="${y(maxSales) + 4}" text-anchor="end">${shortMoney(maxSales)}</text>
        <text class="axis-label" x="${margin.left - 8}" y="${y(0) + 4}" text-anchor="end">$0</text>
        <path class="line-chart-path zone-stroke-${(zoneIndex % 4) + 1}" d="${path}"></path>
        ${zoneData.points.map((point, index) => `<circle class="line-dot zone-fill-${(zoneIndex % 4) + 1}" cx="${x(index)}" cy="${y(point.sales)}" r="2.8"><title>${point.label}: ${money(point.sales)}</title></circle>`).join("")}
        ${tickIndexes.map((index) => `<text class="axis-label" x="${x(index)}" y="${height - 10}" text-anchor="middle">${escapeHtml(weeks[index].label)}</text>`).join("")}
      </svg>
    </div>
  `;
}

function renderWeeklyHeatmap(model) {
  const salesValues = model.byZone.flatMap((zone) => zone.points.map((point) => point.sales));
  const minSales = Math.min(...salesValues);
  const maxSales = Math.max(...salesValues);
  return `
    <div class="chart-caption">Intensidad de venta en toda la serie semanal. Color mas oscuro = mayor venta relativa dentro del conjunto zona-semana completo.</div>
    <div class="heatmap-scroll">
      <div class="heatmap-grid weekly" style="grid-template-columns: 112px repeat(${model.weeks.length}, minmax(58px, 1fr));">
        <div></div>
        ${model.weeks.map((week) => `<div class="heatmap-head">${escapeHtml(week.label)}</div>`).join("")}
        ${model.byZone.map((zoneData) => `
          <div class="heatmap-zone">${escapeHtml(zoneData.zone)}</div>
          ${zoneData.points.map((point) => {
            const intensity = heatmapIntensity(point.sales, minSales, maxSales);
            const color = `rgba(40, 106, 155, ${0.12 + intensity * 0.76})`;
            return `<div class="heatmap-cell compact" style="background:${color}" title="${zoneData.zone} ${point.label}: ${money(point.sales)}"><strong>${shortMoney(point.sales)}</strong><span>${intensityLabel(intensity)}</span></div>`;
          }).join("")}
        `).join("")}
      </div>
    </div>
  `;
}

function renderWeeklyLatestChange(model) {
  const width = 1080;
  const rowHeight = 54;
  const margin = { top: 52, right: 180, bottom: 34, left: 132 };
  const previousIndex = Math.max(0, model.weeks.length - 2);
  const latestIndex = model.weeks.length - 1;
  const previousLabel = model.weeks[previousIndex]?.label || "Previa";
  const latestLabel = model.weeks[latestIndex]?.label || "Ultima";
  const changes = model.byZone.map((zoneData) => {
    const previous = zoneData.points[previousIndex] || { sales: 0 };
    const latest = zoneData.points[latestIndex] || { sales: 0 };
    const delta = latest.sales - previous.sales;
    const pct = previous.sales ? delta / previous.sales : null;
    const recent = zoneData.points.slice(Math.max(0, latestIndex - 3), latestIndex + 1);
    const fourWeekDelta = recent.length > 1 ? latest.sales - recent[0].sales : delta;
    return { zone: zoneData.zone, previous, latest, delta, pct, fourWeekDelta };
  }).sort((a, b) => a.delta - b.delta);

  const height = margin.top + margin.bottom + changes.length * rowHeight;
  const maxAbsDelta = Math.max(...changes.map((item) => Math.abs(item.delta)), 1);
  const plotLeft = margin.left;
  const plotRight = width - margin.right;
  const zeroX = plotLeft + (plotRight - plotLeft) / 2;
  const scale = (value) => (Math.abs(value) / maxAbsDelta) * ((plotRight - plotLeft) / 2);

  return `
    <div class="chart-caption">Cambio operativo de la ultima semana: ${escapeHtml(previousLabel)} → ${escapeHtml(latestLabel)}. Ordenado de mayor caida a mayor alza; la cifra completa queda visible a la derecha.</div>
    <svg class="line-svg" viewBox="0 0 ${width} ${height}" aria-label="Cambio semanal reciente por zona">
      <text class="axis-label" x="${plotLeft}" y="22">${escapeHtml(previousLabel)} → ${escapeHtml(latestLabel)}</text>
      <text class="axis-label" x="${plotRight}" y="22" text-anchor="end">Delta semanal</text>
      <line class="zero-line" x1="${zeroX}" y1="${margin.top - 14}" x2="${zeroX}" y2="${height - margin.bottom + 8}"></line>
      ${changes.map((item, index) => {
        const y = margin.top + index * rowHeight + 18;
        const barWidth = scale(item.delta);
        const x = item.delta < 0 ? zeroX - barWidth : zeroX;
        const klass = item.delta < 0 ? "change-negative" : "change-positive";
        const pctText = item.pct === null ? "s/base" : signedPercent(item.pct);
        return `
          <text class="change-zone-label" x="${margin.left - 12}" y="${y + 5}" text-anchor="end">${escapeHtml(item.zone)}</text>
          <rect class="${klass}" x="${x}" y="${y - 10}" width="${Math.max(2, barWidth)}" height="20" rx="4"></rect>
          <text class="change-value-label" x="${plotRight + 12}" y="${y + 5}">${signedMoney(item.delta)} · ${pctText}</text>
          <text class="change-context-label" x="${plotLeft}" y="${y + 24}">${money(item.previous.sales)} → ${money(item.latest.sales)} · 4 sem: ${signedMoney(item.fourWeekDelta)}</text>
        `;
      }).join("")}
    </svg>
  `;
}

function renderTable(agencies) {
  const rows = agencies
    .map((agency) => {
      const snapshot = weekSnapshot(agency, state.week);
      const previous = previousSnapshot(agency, state.week);
      return {
        agency,
        snapshot,
        delta: snapshot.sales - (previous?.sales || 0),
      };
    })
    .sort((a, b) => priorityRank(a.agency.priority) - priorityRank(b.agency.priority) || a.delta - b.delta || b.snapshot.sales - a.snapshot.sales)
    .slice(0, 150);

  setText("tableCount", `${number(agencies.length)} agencias`);
  document.getElementById("agencyTable").innerHTML = rows.map((item) => {
    const agency = item.agency;
    const snapshot = item.snapshot;
    return `
      <tr data-lotos="${escapeHtml(agency.lotos_code)}">
        <td>
          <strong>${escapeHtml(agency.agent_name || "Sin nombre")}</strong>
          <span class="muted">${escapeHtml(agency.lotos_code)} · ${escapeHtml(agency.comuna || "Sin comuna")}</span>
        </td>
        <td>${escapeHtml(snapshot.territory || "Sin dato")}</td>
        <td>${escapeHtml(snapshot.executive || "Sin dato")}</td>
        <td>${money(snapshot.sales)}</td>
        <td class="${item.delta < 0 ? "delta-negative" : "delta-positive"}">${signedMoney(item.delta)}</td>
        <td><span class="pill ${priorityClass[agency.priority] || ""}">${priorityLabels[agency.priority] || agency.priority}</span></td>
      </tr>
    `;
  }).join("");

  document.querySelectorAll("#agencyTable tr").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedAgency = state.data.agencies.find((agency) => agency.lotos_code === row.dataset.lotos);
      renderDetail(state.selectedAgency);
    });
  });
}

function renderDetail(agency) {
  const detail = document.getElementById("agencyDetail");
  if (!agency) {
    detail.innerHTML = "<p class='muted'>No hay agencias para mostrar.</p>";
    return;
  }
  const snapshot = weekSnapshot(agency, state.week) || {};
  const previous = previousSnapshot(agency, state.week);
  const delta = (snapshot.sales || 0) - (previous?.sales || 0);
  const ts = agency.time_series || {};
  const topPrize = agency.prize_top_subgames?.[0] || null;
  setText("detailTitle", `${agency.lotos_code} · ${agency.agent_name || "Sin nombre"}`);
  detail.innerHTML = [
    detailItem("Direccion", `${agency.address || "Sin dato"}, ${agency.comuna || ""}`),
    detailItem("Territorio", snapshot.territory || agency.territory || "Sin dato"),
    detailItem("Ejecutivo", snapshot.executive || agency.executive || "Sin dato"),
    detailItem("Venta semana", money(snapshot.sales || 0)),
    detailItem("Delta", signedMoney(delta)),
    detailItem("Trayectoria", trajectoryLabel(ts.trajectory || "sin_clasificar")),
    detailItem("Tendencia", `${signedMoney(ts.slope_per_week || 0)} / sem`),
    detailItem("Volatilidad", `${((ts.volatility || 0) * 100).toFixed(0)}%`),
    detailItem("Estado", `${agency.commercial_status || "Sin dato"} · ${agency.sales_status || "Sin dato"}`),
    detailItem("Rubro", agency.rubro || "Sin dato"),
    detailItem("Mejor semana", ts.best_week ? `S${ts.best_week}: ${money(ts.best_sales || 0)}` : "Sin dato"),
    detailItem("Prom. serie", money(ts.avg_sales || 0)),
    detailItem("Premios brutos", money(agency.prize_total_gross || 0)),
    detailItem("Premios netos", money(agency.prize_total_net || 0)),
    detailItem("Subjuegos con premio", number(agency.prize_subgames_count || 0)),
    detailItem("Principal premio", topPrize ? `${topPrize.subgame} · ${money(topPrize.gross_total || 0)}` : "Sin premios cargados"),
    topPrize ? `<div class="detail-item detail-wide"><span>Detalle premios</span><strong>${escapeHtml((agency.prize_top_subgames || []).map((item) => `${item.subgame}: ${money(item.gross_total || 0)}`).join(" · "))}</strong></div>` : "",
    `<div class="detail-item detail-wide"><span>Evolutivo semanal</span>${agencySparkline(agency.history || [], "detail")}</div>`,
  ].join("");
}

function renderCommuneDetail(commune) {
  const context = state.data.top50_population_context;
  const row = context?.rows?.find((item) => item.commune === commune);
  const detail = document.getElementById("agencyDetail");
  if (!row || !detail) return;
  const agencies = topAverageAgencies(state.data.agencies || []).filter((agency) => agency.comuna === commune);
  const population = row.population || 0;
  const series = (state.data.weeks || []).map((week) => {
    const sales = agencies.reduce((sum, agency) => sum + (weekSnapshot(agency, week)?.sales || 0), 0);
    return {
      week,
      sales,
      perCapita: population ? sales / population : 0,
      per100k: population ? (sales / population) * 100_000 : 0,
    };
  });
  const latest = series.find((point) => point.week === state.week) || series[series.length - 1] || { sales: 0, perCapita: 0, per100k: 0 };
  const previous = [...series].filter((point) => point.week < state.week).sort((a, b) => b.week - a.week)[0];
  const delta = latest.sales - (previous?.sales || 0);
  setText("detailTitle", `${commune} · detalle comuna`);
  detail.innerHTML = [
    detailItem("Poblacion 18+", number(population)),
    detailItem("Agencias Top 50", number(row.agencies)),
    detailItem("Agencias / 100k hab.", row.agencies_per_100k === null ? "s/d" : round(row.agencies_per_100k).toFixed(1)),
    detailItem(`Venta S${state.week}`, money(latest.sales)),
    detailItem("Delta vs previa", signedMoney(delta)),
    detailItem("Venta / hab. 18+", money(latest.perCapita)),
    detailItem("Venta / 100k hab.", money(latest.per100k)),
    detailItem("Prom. serie / hab.", money(row.avg_sales_per_capita || 0)),
    `<div class="detail-item detail-wide"><span>Serie semanal comuna Top 50</span>${communeSparkline(series)}</div>`,
    `<div class="detail-item detail-wide"><span>Agencias Top 50 en comuna</span><div class="detail-agency-list">${agencies.map((agency) => `<button data-lotos="${escapeHtml(agency.lotos_code)}">${escapeHtml(agency.lotos_code)} · ${escapeHtml(agency.agent_name || "Sin nombre")} · ${money(agency.time_series?.avg_sales || 0)} prom.</button>`).join("")}</div></div>`,
  ].join("");
  detail.querySelectorAll(".detail-agency-list button").forEach((button) => {
    button.addEventListener("click", () => {
      const agency = state.data.agencies.find((item) => item.lotos_code === button.dataset.lotos);
      if (agency) {
        state.selectedAgency = agency;
        renderDetail(agency);
      }
    });
  });
}

function detailItem(label, value) {
  return `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function communeSparkline(series) {
  const points = [...(series || [])].sort((a, b) => a.week - b.week);
  if (!points.length) return "<div class='spark-empty'>Sin serie semanal.</div>";
  const width = 520;
  const height = 160;
  const margin = { top: 18, right: 18, bottom: 38, left: 64 };
  const maxSales = Math.max(...points.map((point) => point.sales), 1);
  const maxPer100k = Math.max(...points.map((point) => point.per100k), 1);
  const totalPoints = points.map((point) => ({ week: point.week, sales: totalSalesForWeek(point.week) })).filter((point) => point.sales !== null);
  const maxTotalSales = Math.max(...totalPoints.map((point) => point.sales), 1);
  const minTotalSales = Math.min(...totalPoints.map((point) => point.sales), 0);
  const x = (index) => margin.left + (index / Math.max(points.length - 1, 1)) * (width - margin.left - margin.right);
  const ySales = (value) => margin.top + (1 - value / maxSales) * (height - margin.top - margin.bottom);
  const yPer100k = (value) => margin.top + (1 - value / maxPer100k) * (height - margin.top - margin.bottom);
  const yTotal = (value) => margin.top + ((maxTotalSales - value) / Math.max(maxTotalSales - minTotalSales, 1)) * (height - margin.top - margin.bottom);
  const salesPath = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${ySales(point.sales)}`).join(" ");
  const per100kPath = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${yPer100k(point.per100k)}`).join(" ");
  const totalPath = totalPoints.map((point) => {
    const index = points.findIndex((item) => item.week === point.week);
    return `${index === 0 ? "M" : "L"}${x(index)},${yTotal(point.sales)}`;
  }).join(" ");
  const ticks = points.length <= 5 ? points.map((_, index) => index) : [0, points.length - 1];
  return `
    <div class="sparkline detail">
      <svg viewBox="0 0 ${width} ${height}" aria-label="Serie semanal comuna">
        <line class="grid-line" x1="${margin.left}" y1="${ySales(maxSales)}" x2="${width - margin.right}" y2="${ySales(maxSales)}"></line>
        <line class="grid-line" x1="${margin.left}" y1="${ySales(0)}" x2="${width - margin.right}" y2="${ySales(0)}"></line>
        <text class="axis-label" x="${margin.left - 8}" y="${ySales(maxSales) + 4}" text-anchor="end">${shortMoney(maxSales)}</text>
        <text class="axis-label" x="${margin.left - 8}" y="${ySales(0) + 4}" text-anchor="end">$0</text>
        <path class="spark-path" d="${salesPath}"></path>
        <path class="spark-path-per100k" d="${per100kPath}"></path>
        ${totalPath ? `<path class="spark-path-network" d="${totalPath}"><title>Venta total red, escala propia</title></path>` : ""}
        ${points.map((point, index) => `<circle class="spark-dot" cx="${x(index)}" cy="${ySales(point.sales)}" r="3.8"><title>S${point.week}: ${money(point.sales)} · ${money(point.perCapita)}/hab · ${money(point.per100k)}/100k</title></circle>`).join("")}
        ${ticks.map((index) => `<text class="axis-label" x="${x(index)}" y="${height - 10}" text-anchor="middle">S${points[index].week}</text>`).join("")}
      </svg>
      <div class="spark-legend"><span><i class="agency"></i>Venta comuna Top 50</span><span><i class="per100k"></i>Venta / 100k hab. (escala propia)</span><span><i class="network-gray"></i>Total red (escala propia)</span></div>
      <div class="spark-values">${points.map((point) => `<span>S${point.week}: ${money(point.sales)} · ${money(point.per100k)}/100k</span>`).join("")}</div>
    </div>
  `;
}

function agencySparkline(history, variant = "detail") {
  const points = [...(history || [])].sort((a, b) => a.week - b.week);
  if (!points.length) return "<div class='spark-empty'>Sin historia semanal.</div>";
  const width = variant === "popup" ? 230 : 520;
  const height = variant === "popup" ? 94 : 150;
  const margin = variant === "popup"
    ? { top: 12, right: 12, bottom: 28, left: 38 }
    : { top: 18, right: 18, bottom: 36, left: 58 };
  const maxSales = Math.max(...points.map((point) => point.sales), 1);
  const minSales = Math.min(...points.map((point) => point.sales), 0);
  const x = (index) => margin.left + (index / Math.max(points.length - 1, 1)) * (width - margin.left - margin.right);
  const y = (value) => margin.top + ((maxSales - value) / Math.max(maxSales - minSales, 1)) * (height - margin.top - margin.bottom);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.sales)}`).join(" ");
  const totalPoints = points.map((point) => ({ week: point.week, sales: totalSalesForWeek(point.week) })).filter((point) => point.sales !== null);
  const maxTotalSales = Math.max(...totalPoints.map((point) => point.sales), 1);
  const minTotalSales = Math.min(...totalPoints.map((point) => point.sales), 0);
  const yTotal = (value) => margin.top + ((maxTotalSales - value) / Math.max(maxTotalSales - minTotalSales, 1)) * (height - margin.top - margin.bottom);
  const totalPath = totalPoints.map((point) => {
    const index = points.findIndex((item) => item.week === point.week);
    return `${index === 0 ? "M" : "L"}${x(index)},${yTotal(point.sales)}`;
  }).join(" ");
  const latest = points[points.length - 1];
  const first = points[0];
  const ticks = points.length <= 5 ? points.map((_, index) => index) : [0, points.length - 1];
  const rows = points.map((point) => `<span>S${point.week}: ${money(point.sales)}</span>`).join("");

  return `
    <div class="sparkline ${variant}">
      <svg viewBox="0 0 ${width} ${height}" aria-label="Evolutivo semanal">
        <line class="grid-line" x1="${margin.left}" y1="${y(maxSales)}" x2="${width - margin.right}" y2="${y(maxSales)}"></line>
        <line class="grid-line" x1="${margin.left}" y1="${y(minSales)}" x2="${width - margin.right}" y2="${y(minSales)}"></line>
        <text class="axis-label" x="${margin.left - 7}" y="${y(maxSales) + 4}" text-anchor="end">${shortMoney(maxSales)}</text>
        <text class="axis-label" x="${margin.left - 7}" y="${y(minSales) + 4}" text-anchor="end">${shortMoney(minSales)}</text>
        <path class="spark-path" d="${path}"></path>
        ${totalPath ? `<path class="spark-path-total" d="${totalPath}"><title>Venta total red, escala propia</title></path>` : ""}
        ${points.map((point, index) => `<circle class="spark-dot" cx="${x(index)}" cy="${y(point.sales)}" r="${variant === "popup" ? 3 : 4}"><title>S${point.week}: ${money(point.sales)}</title></circle>`).join("")}
        ${ticks.map((index) => `<text class="axis-label" x="${x(index)}" y="${height - 8}" text-anchor="middle">S${points[index].week}</text>`).join("")}
      </svg>
      <div class="spark-legend"><span><i class="agency"></i>Agencia</span><span><i class="network"></i>Total red (escala propia)</span></div>
      <div class="spark-summary">${escapeHtml(`S${first.week}`)} ${money(first.sales)} → ${escapeHtml(`S${latest.week}`)} ${money(latest.sales)}</div>
      <div class="spark-values">${rows}</div>
    </div>
  `;
}

function groupByCurrent(agencies, field) {
  const groups = new Map();
  agencies.forEach((agency) => {
    const snapshot = weekSnapshot(agency, state.week);
    if (!snapshot) return;
    const name = snapshot[field] || agency[field] || "Sin dato";
    if (!groups.has(name)) groups.set(name, { name, agencies: 0, selling: 0, sales: 0 });
    const group = groups.get(name);
    group.agencies += 1;
    group.sales += snapshot.sales;
    if (snapshot.sales > 0) group.selling += 1;
  });
  return [...groups.values()].sort((a, b) => b.sales - a.sales);
}

function resetChat() {
  const messages = document.getElementById("chatMessages");
  messages.innerHTML = "";
  addMessage(
    `Listo. Tengo ${number(state.data.agencies.length)} agencias y semanas ${state.data.weeks.join(", ")}. Puedes preguntar: "agencias en deterioro", "crecimiento sostenido", "alta volatilidad", "evolucion 120148", "zona norte semanal" o "quiero ir a comprar en la agencia que mas suerte ha tenido, mas cercana a mi, donde la suerte pese 80% y la distancia un 20%".`,
    "bot",
  );
}

function addMessage(text, type) {
  const messages = document.getElementById("chatMessages");
  const message = document.createElement("div");
  message.className = `message ${type}`;
  message.textContent = text;
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
}

function answerQuestion(rawText) {
  const text = normalize(rawText);
  if (!state.data) return "Aun estoy cargando los datos.";
  if (text.includes("ayuda")) {
    return "Puedes preguntarme por resumen semana, deterioro sostenido, crecimiento sostenido, alta volatilidad, racha cero venta, territorio, ejecutivo, codigo Lotos, evolucion de agencia, indice de agencia o agencia con mas suerte y cercania.";
  }
  if ((text.includes("suerte") || text.includes("premio")) && (text.includes("cerca") || text.includes("cercana") || text.includes("distancia"))) {
    return "Puedo armar ese ranking, pero me falta tu ubicacion. La logica seria: score = 80% suerte + 20% cercania, usando la metrica de premios del local y la distancia a tu punto de origen. Si me das una comuna, direccion o coordenadas, la siguiente version del chat puede devolverte la mejor agencia candidata.";
  }

  const code = rawText.match(/\b\d{5,6}\b/)?.[0];
  const mentionedAgency = findAgencyInText(rawText);
  if (code || mentionedAgency) {
    const agency = mentionedAgency || state.data.agencies.find((item) => item.lotos_code === code);
    return agencyQuestionAnswer(agency, text);
  }

  if ((text.includes("caida") || text.includes("recuper")) && (text.includes("agencia") || text.includes("punto"))) {
    return listAgencyRanking(text.includes("caida") ? "drop" : "recovery");
  }
  if (text.includes("deterioro") || text.includes("deteriorando")) return listTimeSeriesRanking("deterioro");
  if (text.includes("crecimiento sostenido") || text.includes("creciente")) return listTimeSeriesRanking("creciente");
  if (text.includes("volatil")) return listTimeSeriesRanking("volatilidad");
  if (text.includes("racha cero") || text.includes("persistente cero")) return listTimeSeriesRanking("apagada");
  if (text.includes("caida")) return listChanges("drop");
  if (text.includes("recuper")) return listChanges("recovery");
  if (text.includes("sin venta") || text.includes("cero venta")) return listZeroSales();
  if (text.includes("resumen") || text.includes("venta")) return summaryAnswer();
  if (text.includes("semanal") || text.includes("semana") || text.includes("zona")) return weeklyZoneAnswer(text);

  const territory = findNamedValue(text, uniqueValues("territory"));
  if (territory) return groupAnswer("territory", territory);

  const executive = findNamedValue(text, uniqueValues("executive"));
  if (executive || text.includes("ejecutivo")) return executive ? groupAnswer("executive", executive) : "Indica el nombre del ejecutivo. Ejemplo: ejecutivo Dino Diaz.";

  return "No encontre una lectura directa. Prueba con un codigo Lotos, un territorio, un ejecutivo, mayores caidas o agencias sin venta.";
}

function weeklyZoneAnswer(text) {
  const rows = state.data.weekly_zone_evolution || [];
  if (!rows.length) return "No hay informacion semanal agrupada disponible.";
  const model = weeklyModel(rows);
  const zone = findNamedValue(text, [...new Set(rows.map((row) => row.zone))]);
  const wantsLatestChange = text.includes("ultimo cambio") || text.includes("ultimo") || text.includes("variacion") || text.includes("cambio semanal");
  if (wantsLatestChange) {
    const previousIndex = Math.max(0, model.weeks.length - 2);
    const latestIndex = model.weeks.length - 1;
    const changes = model.byZone
      .filter((zoneData) => !zone || zoneData.zone === zone)
      .map((zoneData) => {
        const previous = zoneData.points[previousIndex] || { sales: 0 };
        const latest = zoneData.points[latestIndex] || { sales: 0 };
        const delta = latest.sales - previous.sales;
        const pct = previous.sales ? delta / previous.sales : null;
        return { zone: zoneData.zone, previous, latest, delta, pct };
      })
      .sort((a, b) => a.delta - b.delta);
    return `Cambio ${model.weeks[previousIndex].label} -> ${model.weeks[latestIndex].label}:\n` + changes.map((item, index) => {
      const pctText = item.pct === null ? "s/base" : signedPercent(item.pct);
      return `${index + 1}. ${item.zone}: ${money(item.previous.sales)} -> ${money(item.latest.sales)} (${signedMoney(item.delta)}, ${pctText})`;
    }).join("\n");
  }
  const wantsGrowth = text.includes("crecio") || text.includes("crecimiento") || text.includes("mejor") || text.includes("ranking");
  if (wantsGrowth) {
    const ranking = model.byZone.map((zoneData) => {
      const first = zoneData.indexed[0];
      const last = zoneData.indexed[zoneData.indexed.length - 1];
      return { zone: zoneData.zone, index: last.index, delta: last.index - first.index, sales: last.sales };
    }).sort((a, b) => b.delta - a.delta);
    return `Ranking de evolucion relativa desde ${model.weeks[0].label}:\n` + ranking.map((item, index) => {
      return `${index + 1}. ${item.zone}: indice ${item.index.toFixed(0)} (${signedPercent(item.delta / 100)}), ${money(item.sales)} ultima semana`;
    }).join("\n");
  }

  const filtered = zone ? rows.filter((row) => row.zone === zone) : rows;
  const byWeek = [...new Set(filtered.map((row) => row.week))]
    .sort((a, b) => a - b)
    .map((week) => {
      const weekRows = filtered.filter((row) => row.week === week);
      return {
        label: weekRows[0].week_label,
        sales: weekRows.reduce((sum, row) => sum + row.sales, 0),
      };
    });
  const best = [...filtered].sort((a, b) => b.sales - a.sales)[0];
  return [
    zone ? `Evolucion semanal de ${zone}:` : "Evolucion semanal por zonas:",
    byWeek.map((item) => `${item.label}: ${money(item.sales)}`).join(" · "),
    best ? `Mayor registro: ${best.zone} en ${best.week_label}, con ${money(best.sales)}.` : "",
  ].filter(Boolean).join("\n");
}

function summaryAnswer() {
  const agencies = filteredAgencies();
  const snapshots = agencies.map((agency) => weekSnapshot(agency, state.week)).filter(Boolean);
  const sales = snapshots.reduce((sum, item) => sum + item.sales, 0);
  const selling = snapshots.filter((item) => item.sales > 0).length;
  const topTerritory = groupByCurrent(agencies, "territory")[0];
  return [
    `Semana ${state.week}: ${money(sales)} en ${number(agencies.length)} agencias filtradas.`,
    `${number(selling)} tienen venta (${percent(selling / (snapshots.length || 1))}).`,
    topTerritory ? `Territorio lider: ${topTerritory.name}, con ${money(topTerritory.sales)}.` : "Sin territorio lider para este filtro.",
  ].join("\n");
}

function listChanges(type) {
  const agencies = filteredAgencies()
    .map((agency) => {
      const snapshot = weekSnapshot(agency, state.week);
      const previous = previousSnapshot(agency, state.week);
      return { agency, snapshot, delta: (snapshot?.sales || 0) - (previous?.sales || 0), previous };
    })
    .filter((item) => type === "drop" ? item.delta < 0 : item.delta > 0)
    .sort((a, b) => type === "drop" ? a.delta - b.delta : b.delta - a.delta)
    .slice(0, 5);

  if (!agencies.length) return "No hay casos para los filtros actuales.";
  const title = type === "drop" ? "Mayores caidas" : "Mayores recuperaciones";
  return `${title} semana ${state.week}:\n` + agencies.map((item, index) => {
    return `${index + 1}. ${item.agency.lotos_code} ${item.agency.agent_name}: ${money(item.previous?.sales || 0)} -> ${money(item.snapshot.sales)} (${signedMoney(item.delta)})`;
  }).join("\n");
}

function listZeroSales() {
  const agencies = filteredAgencies()
    .filter((agency) => (weekSnapshot(agency, state.week)?.sales || 0) === 0 && !agency.is_closed)
    .slice(0, 8);
  if (!agencies.length) return "No encontre agencias sin venta para los filtros actuales.";
  return `Agencias sin venta semana ${state.week}:\n` + agencies.map((agency, index) => {
    return `${index + 1}. ${agency.lotos_code} ${agency.agent_name} (${agency.territory || "Sin territorio"}, ${agency.executive || "Sin ejecutivo"})`;
  }).join("\n");
}

function listAgencyRanking(type) {
  const agencies = filteredAgencies()
    .map((agency) => {
      const latest = latestAgencyPoint(agency);
      const previous = previousAgencyPoint(agency, latest?.week);
      const delta = (latest?.sales || 0) - (previous?.sales || 0);
      const pct = previous?.sales ? delta / previous.sales : null;
      return { agency, latest, previous, delta, pct };
    })
    .filter((item) => item.latest && item.previous)
    .filter((item) => type === "drop" ? item.delta < 0 : item.delta > 0)
    .sort((a, b) => type === "drop" ? a.delta - b.delta : b.delta - a.delta)
    .slice(0, 8);
  if (!agencies.length) return "No encontre agencias para ese ranking con los filtros actuales.";
  const title = type === "drop" ? "Mayores caidas por agencia" : "Mayores recuperaciones por agencia";
  return `${title} (${agencies[0].previous.week} -> ${agencies[0].latest.week}):\n` + agencies.map((item, index) => {
    const pctText = item.pct === null ? "s/base" : signedPercent(item.pct);
    return `${index + 1}. ${item.agency.lotos_code} ${item.agency.agent_name}: ${money(item.previous.sales)} -> ${money(item.latest.sales)} (${signedMoney(item.delta)}, ${pctText})`;
  }).join("\n");
}

function listTimeSeriesRanking(kind) {
  const agencies = filteredAgencies().filter((agency) => agency.time_series);
  let ranked;
  let title;
  if (kind === "deterioro") {
    title = "Agencias con deterioro sostenido";
    ranked = agencies
      .filter((agency) => agency.time_series.trajectory === "deterioro" || agency.time_series.slope_per_week < 0)
      .sort((a, b) => (a.time_series.slope_per_week || 0) - (b.time_series.slope_per_week || 0));
  } else if (kind === "creciente") {
    title = "Agencias con crecimiento sostenido";
    ranked = agencies
      .filter((agency) => agency.time_series.trajectory === "creciente" || agency.time_series.slope_per_week > 0)
      .sort((a, b) => (b.time_series.slope_per_week || 0) - (a.time_series.slope_per_week || 0));
  } else if (kind === "volatilidad") {
    title = "Agencias con mayor volatilidad";
    ranked = agencies.sort((a, b) => (b.time_series.volatility || 0) - (a.time_series.volatility || 0));
  } else {
    title = "Agencias con racha de cero venta";
    ranked = agencies
      .filter((agency) => (agency.time_series.zero_streak || 0) > 0)
      .sort((a, b) => (b.time_series.zero_streak || 0) - (a.time_series.zero_streak || 0));
  }
  ranked = ranked.slice(0, 8);
  if (!ranked.length) return "No encontre agencias para esa señal con los filtros actuales.";
  return `${title}:\n` + ranked.map((agency, index) => {
    const ts = agency.time_series;
    const metric = kind === "volatilidad"
      ? `vol ${ts.volatility.toFixed(2)}`
      : kind === "apagada"
        ? `${ts.zero_streak} semanas en cero`
        : `${signedMoney(ts.slope_per_week)}/sem`;
    return `${index + 1}. ${agency.lotos_code} ${agency.agent_name}: ${metric}, ${trajectoryLabel(ts.trajectory)}, ultima ${money(agency.latest_sales)}`;
  }).join("\n");
}

function agencyQuestionAnswer(agency, text) {
  if (!agency) return "No encontre esa agencia.";
  const wantsEvolution = text.includes("evolucion") || text.includes("semanal") || text.includes("semana") || text.includes("historia") || text.includes("tendencia");
  const wantsChange = text.includes("ultimo cambio") || text.includes("variacion") || text.includes("cambio");
  const wantsIndex = text.includes("indice") || text.includes("index");
  const wantsTrajectory = text.includes("trayectoria") || text.includes("tendencia") || text.includes("volatilidad");
  if (wantsEvolution || wantsChange || wantsIndex) {
    return agencyEvolutionAnswer(agency, { latestOnly: wantsChange, indexed: wantsIndex, trajectory: wantsTrajectory });
  }
  return agencyAnswer(agency.lotos_code);
}

function agencyEvolutionAnswer(agency, options = {}) {
  const history = [...agency.history].sort((a, b) => a.week - b.week);
  if (!history.length) return `No hay historia semanal para ${agency.lotos_code}.`;
  state.selectedAgency = agency;
  renderDetail(agency);

  const latest = history[history.length - 1];
  const previous = history[history.length - 2] || null;
  const delta = previous ? latest.sales - previous.sales : 0;
  const pct = previous?.sales ? delta / previous.sales : null;
  const firstSelling = history.find((item) => item.sales > 0) || history[0];
  const ts = agency.time_series || {};

  if (options.latestOnly) {
    const pctText = pct === null ? "s/base" : signedPercent(pct);
    return [
      `${agency.lotos_code} ${agency.agent_name || ""}`,
      `Ultimo cambio S${previous?.week || latest.week} -> S${latest.week}: ${money(previous?.sales || 0)} -> ${money(latest.sales)} (${signedMoney(delta)}, ${pctText}).`,
      `Trayectoria: ${trajectoryLabel(ts.trajectory)} · tendencia ${signedMoney(ts.slope_per_week || 0)}/sem · volatilidad ${((ts.volatility || 0) * 100).toFixed(0)}%.`,
      `Territorio: ${latest.territory || agency.territory || "Sin dato"} · Ejecutivo: ${latest.executive || agency.executive || "Sin dato"}.`,
    ].join("\n");
  }

  const evolution = history.map((point) => {
    if (options.indexed) {
      const index = firstSelling.sales ? (point.sales / firstSelling.sales) * 100 : 0;
      return `S${point.week}: ${index.toFixed(0)} (${money(point.sales)})`;
    }
    return `S${point.week}: ${money(point.sales)}`;
  }).join(" · ");
  const best = [...history].sort((a, b) => b.sales - a.sales)[0];
  const pctText = pct === null ? "s/base" : signedPercent(pct);
  return [
    `${agency.lotos_code} ${agency.agent_name || ""}`,
    options.indexed ? `Indice S${firstSelling.week}=100: ${evolution}` : `Evolucion semanal: ${evolution}`,
    `Ultimo cambio: ${signedMoney(delta)} (${pctText}). Mejor semana: S${best.week}, ${money(best.sales)}.`,
    `Trayectoria: ${trajectoryLabel(ts.trajectory)} · tendencia ${signedMoney(ts.slope_per_week || 0)}/sem · promedio serie ${money(ts.avg_sales || 0)}.`,
    `Territorio: ${latest.territory || agency.territory || "Sin dato"} · Ejecutivo: ${latest.executive || agency.executive || "Sin dato"}.`,
  ].join("\n");
}

function agencyAnswer(code) {
  const agency = state.data.agencies.find((item) => item.lotos_code === code);
  if (!agency) return `No encontre el codigo ${code}.`;
  const snapshot = weekSnapshot(agency, state.week) || {};
  const previous = previousSnapshot(agency, state.week);
  const delta = (snapshot.sales || 0) - (previous?.sales || 0);
  state.selectedAgency = agency;
  renderDetail(agency);
  return [
    `${agency.lotos_code} ${agency.agent_name || ""}`,
    `Semana ${state.week}: ${money(snapshot.sales || 0)} (${signedMoney(delta)} vs previa).`,
    `Territorio: ${snapshot.territory || agency.territory || "Sin dato"} · Ejecutivo: ${snapshot.executive || agency.executive || "Sin dato"}.`,
    `Prioridad: ${priorityLabels[agency.priority] || agency.priority}.`,
  ].join("\n");
}

function findAgencyInText(rawText) {
  const text = normalize(rawText);
  if (text.length <= 4) return null;
  const code = rawText.match(/\b\d{5,6}\b/)?.[0];
  if (code) return state.data.agencies.find((agency) => agency.lotos_code === code) || null;
  const candidates = state.data.agencies
    .map((agency) => ({ agency, name: normalize(agency.agent_name || "") }))
    .filter((item) => item.name.length > 4 && (text.includes(item.name) || item.name.includes(text)))
    .sort((a, b) => b.name.length - a.name.length);
  return candidates[0]?.agency || null;
}

function latestAgencyPoint(agency) {
  return [...agency.history].sort((a, b) => b.week - a.week)[0] || null;
}

function totalSalesForWeek(week) {
  const fromSeries = state.data.weekly_sales_with_jackpots?.find((item) => item.week === week);
  if (fromSeries && fromSeries.sales !== null && fromSeries.sales !== undefined) return fromSeries.sales;
  const fromSummary = state.data.summary?.by_week?.find((item) => Number(item.name) === Number(week));
  return fromSummary?.sales ?? null;
}

function latestJackpotContext() {
  const jackpots = state.data.weekly_jackpots || [];
  if (!jackpots.length) return null;
  return [...jackpots].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
}

function previousAgencyPoint(agency, week) {
  return [...agency.history].filter((point) => point.week < week).sort((a, b) => b.week - a.week)[0] || null;
}

function groupAnswer(field, name) {
  const agencies = state.data.agencies.filter((agency) => {
    const snapshot = weekSnapshot(agency, state.week);
    return snapshot && (snapshot[field] || agency[field]) === name;
  });
  const snapshots = agencies.map((agency) => weekSnapshot(agency, state.week)).filter(Boolean);
  const sales = snapshots.reduce((sum, item) => sum + item.sales, 0);
  const selling = snapshots.filter((item) => item.sales > 0).length;
  const drops = agencies.filter((agency) => {
    const snapshot = weekSnapshot(agency, state.week);
    const previous = previousSnapshot(agency, state.week);
    return snapshot && previous && snapshot.sales < previous.sales;
  }).length;
  return [
    `${name} en semana ${state.week}: ${money(sales)}.`,
    `${number(selling)} de ${number(agencies.length)} agencias con venta (${percent(selling / (agencies.length || 1))}).`,
    `${number(drops)} agencias caen vs semana previa.`,
  ].join("\n");
}

function findNamedValue(normalizedText, values) {
  return values.find((value) => normalizedText.includes(normalize(value)));
}

function countBy(items, field) {
  return items.reduce((acc, item) => {
    const key = item[field] || "Sin dato";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function zoneClass(zone) {
  const normalized = normalize(zone);
  if (normalized.includes("rm norte")) return "zone-rm-norte";
  if (normalized.includes("rm sur")) return "zone-rm-sur";
  if (normalized.includes("norte")) return "zone-norte";
  if (normalized.includes("sur")) return "zone-sur";
  return "zone-sin-zona";
}

function zoneColor(zone) {
  const normalized = normalize(zone);
  if (normalized.includes("rm norte")) return "#b06b15";
  if (normalized.includes("rm sur")) return "#b23b3b";
  if (normalized.includes("norte")) return "#286a9b";
  if (normalized.includes("sur")) return "#1f7a4d";
  return "#7e8a84";
}

function weeklyTickIndexes(length) {
  if (length <= 8) return Array.from({ length }, (_, index) => index);
  const indexes = new Set([0, length - 1]);
  for (let index = 4; index < length - 1; index += 5) {
    indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function safeLabelY(value, height) {
  return Math.max(18, Math.min(height - 18, value));
}

function heatmapIntensity(value, min, max) {
  if (max <= min) return 0.5;
  return (value - min) / (max - min);
}

function intensityLabel(value) {
  if (value >= 0.8) return "Muy alto";
  if (value >= 0.6) return "Alto";
  if (value >= 0.4) return "Medio";
  if (value >= 0.2) return "Bajo";
  return "Muy bajo";
}

function trajectoryLabel(value) {
  return {
    creciente: "Creciente",
    estable: "Estable",
    deterioro: "Deterioro",
    intermitente: "Intermitente",
    reactivada: "Reactivada",
    apagada: "Apagada",
    sin_venta: "Sin venta",
    sin_clasificar: "Sin clasificar",
  }[value] || "Sin clasificar";
}

function priorityRank(priority) {
  return {
    caida_fuerte: 1,
    sin_venta: 2,
    bajo_2019: 3,
    recuperacion: 4,
    seguimiento: 5,
    cerrada: 6,
  }[priority] || 9;
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function money(value) {
  return "$" + Number(value || 0).toLocaleString("es-CL", { maximumFractionDigits: 0 });
}

function shortMoney(value) {
  const numberValue = Number(value || 0);
  if (numberValue >= 1_000_000_000) return `$${(numberValue / 1_000_000_000).toFixed(1)}B`;
  if (numberValue >= 1_000_000) return `$${(numberValue / 1_000_000).toFixed(0)}M`;
  return money(numberValue);
}

function signedMoney(value) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${money(Math.abs(value))}`;
}

function number(value) {
  return Number(value || 0).toLocaleString("es-CL", { maximumFractionDigits: 0 });
}

function percent(value) {
  return Number(value || 0).toLocaleString("es-CL", { style: "percent", maximumFractionDigits: 1 });
}

function signedPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${percent(value)}`;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function pearson(xs, ys) {
  if (xs.length < 2 || ys.length < 2 || xs.length !== ys.length) return null;
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const numerator = xs.reduce((sum, value, index) => sum + (value - xMean) * (ys[index] - yMean), 0);
  const xDen = Math.sqrt(xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0));
  const yDen = Math.sqrt(ys.reduce((sum, value) => sum + (value - yMean) ** 2, 0));
  if (!xDen || !yDen) return null;
  return numerator / (xDen * yDen);
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
