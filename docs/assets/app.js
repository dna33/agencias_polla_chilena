const state = {
  data: null,
  week: null,
  filters: {
    search: "",
    territory: "",
    executive: "",
    priority: "",
    trajectory: "",
  },
  weeklyView: "indexed",
  maps: {},
  selectedAgency: null,
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
  document.getElementById("refreshButton").addEventListener("click", loadData);
  document.getElementById("weekSelect").addEventListener("change", (event) => {
    state.week = Number(event.target.value);
    render();
  });
  document.getElementById("searchInput").addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    render();
  });
  document.getElementById("territorySelect").addEventListener("change", (event) => {
    state.filters.territory = event.target.value;
    render();
  });
  document.getElementById("executiveSelect").addEventListener("change", (event) => {
    state.filters.executive = event.target.value;
    render();
  });
  document.getElementById("prioritySelect").addEventListener("change", (event) => {
    state.filters.priority = event.target.value;
    render();
  });
  document.getElementById("trajectorySelect").addEventListener("change", (event) => {
    state.filters.trajectory = event.target.value;
    render();
  });
  document.getElementById("assistantToggle").addEventListener("click", () => {
    document.querySelector(".assistant").classList.toggle("collapsed");
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
    populateControls();
    render();
    resetChat();
  } catch (error) {
    showLoadError(error);
  }
}

function showLoadError(error) {
  const message = `No se pudo cargar la data del dashboard. Usa un servidor local o GitHub Pages; abrir index.html directo como archivo puede bloquear data/dashboard.json. Detalle: ${error.message}`;
  ["seriesNarrative", "territoryChart", "trendChart", "jackpotChart", "weeklyZoneChart", "agencyDetail"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.innerHTML = `<p class="load-error">${escapeHtml(message)}</p>`;
  });
}

function populateControls() {
  fillSelect("weekSelect", state.data.weeks.map(String), state.week, false);
  fillSelect("territorySelect", uniqueValues("territory"), state.filters.territory, true);
  fillSelect("executiveSelect", uniqueValues("executive"), state.filters.executive, true);
}

function uniqueValues(field) {
  return [...new Set(state.data.agencies.map((agency) => agency[field]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es"));
}

function fillSelect(id, values, selectedValue, includeAll) {
  const select = document.getElementById(id);
  select.innerHTML = "";
  if (includeAll) {
    select.append(new Option("Todos", ""));
  }
  values.forEach((value) => {
    const option = new Option(String(value), String(value));
    option.selected = String(value) === String(selectedValue);
    select.append(option);
  });
}

function render() {
  if (!state.data) return;
  const agencies = filteredAgencies();
  safeRender("kpis", () => renderKpis(agencies));
  safeRender("seriesNarrative", () => renderSeriesAnalysis(agencies));
  safeRender("territoryChart", () => renderTerritoryChart(agencies));
  safeRender("trendChart", renderTrendChart);
  safeRender("jackpotChart", renderJackpotChart);
  safeRender("territoryMaps", () => renderTerritoryMaps(agencies));
  safeRender("weeklyZoneChart", renderWeeklyZoneChart);
  safeRender("agencyTable", () => renderTable(agencies));
  safeRender("agencyDetail", () => renderDetail(state.selectedAgency));
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
  return state.data.agencies.filter((agency) => {
    const snapshot = weekSnapshot(agency, state.week);
    if (!snapshot) return false;
    if (state.filters.territory && snapshot.territory !== state.filters.territory) return false;
    if (state.filters.executive && snapshot.executive !== state.filters.executive) return false;
    if (state.filters.priority && agency.priority !== state.filters.priority) return false;
    if (state.filters.trajectory && agency.time_series?.trajectory !== state.filters.trajectory) return false;
    if (state.filters.search) {
      const haystack = [
        agency.lotos_code,
        agency.agent_name,
        agency.comuna,
        agency.address,
        agency.rubro,
      ].join(" ").toLowerCase();
      if (!haystack.includes(state.filters.search)) return false;
    }
    return true;
  });
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

function renderKpis(agencies) {
  const current = agencies.map((agency) => ({ agency, snapshot: weekSnapshot(agency, state.week) })).filter((item) => item.snapshot);
  const totalSales = current.reduce((sum, item) => sum + item.snapshot.sales, 0);
  const previousSales = current.reduce((sum, item) => sum + (previousSnapshot(item.agency, state.week)?.sales || 0), 0);
  const selling = current.filter((item) => item.snapshot.sales > 0).length;
  const closed = current.filter((item) => item.agency.is_closed).length;
  const actions = current.filter((item) => ["caida_fuerte", "sin_venta", "bajo_2019"].includes(item.agency.priority)).length;
  const delta = totalSales - previousSales;

  setText("kpiSales", money(totalSales));
  setText("kpiSalesDelta", previousSales ? `${signedMoney(delta)} vs semana previa` : "Sin comparativo");
  setText("kpiSelling", number(selling));
  setText("kpiSellingRate", `${percent(selling / (current.length || 1))} de ${number(current.length)}`);
  setText("kpiClosed", number(closed));
  setText("kpiActions", number(actions));
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

function renderTerritoryMaps(agencies) {
  const container = document.getElementById("territoryMaps");
  if (!container) return;
  destroyMaps();
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

  state.maps.chile = initLeafletMap("chileMap", chileBounds, chilePoints, 4);
  state.maps.rm = initLeafletMap("rmMap", rmBounds, rmPoints, 10);
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

function initLeafletMap(id, bounds, points, minZoom) {
  const map = L.map(id, {
    zoomControl: true,
    scrollWheelZoom: false,
    preferCanvas: true,
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  map.fitBounds(bounds, { padding: [14, 14] });
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

function destroyMaps() {
  Object.values(state.maps).forEach((map) => {
    if (map && typeof map.remove === "function") {
      map.remove();
    }
  });
  state.maps = {};
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
    `<div class="detail-item detail-wide"><span>Evolutivo semanal</span>${agencySparkline(agency.history || [], "detail")}</div>`,
  ].join("");
}

function detailItem(label, value) {
  return `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
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
    `Listo. Tengo ${number(state.data.agencies.length)} agencias y semanas ${state.data.weeks.join(", ")}. Puedes preguntar: "agencias en deterioro", "crecimiento sostenido", "alta volatilidad", "evolucion 120148" o "zona norte semanal".`,
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
    return "Puedes preguntarme por resumen semana, deterioro sostenido, crecimiento sostenido, alta volatilidad, racha cero venta, territorio, ejecutivo, codigo Lotos, evolucion de agencia o indice de agencia.";
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
