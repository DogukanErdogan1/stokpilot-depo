const reportDayMs = 86_400_000;
const reportHourOffset = 3 * 3_600_000;
const reportSectionNames = ["summary", "outbound", "idle"];
const reportDateFormatter = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const reportAxisDateFormatter = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", day: "numeric", month: "short" });
const reportTickFormatter = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const reportDateText = day => reportDateFormatter.format(new Date(`${day}T00:00:00Z`));
const reportToday = () => new Date(Date.now() + reportHourOffset).toISOString().slice(0, 10);

function newReportScreen() {
  const to = reportToday();
  const from = new Date(Date.parse(to) - 29 * reportDayMs).toISOString().slice(0, 10);
  return {
    fields: { from, to, warehouseId: "", idleDays: "30" }, applied: null, error: "", chartIndex: null,
    sections: Object.fromEntries(reportSectionNames.map(key => [key, { data: null, reader: null, loading: false, error: "" }])),
  };
}

let reportScreen = newReportScreen();

function resetStockReports() {
  invalidateStockReports();
  reportScreen = newReportScreen();
}

function invalidateStockReports() {
  for (const section of Object.values(reportScreen.sections)) section.reader?.abort();
  reportScreen.applied = null;
}

async function loadReportSection(key, page = 1) {
  const screen = reportScreen;
  const section = screen.sections[key];
  section.reader?.abort();
  const reader = new AbortController();
  section.reader = reader;
  section.loading = true;
  section.error = "";
  try {
    const params = new URLSearchParams({ ...screen.applied, page: String(page), pageSize: "10" });
    if (!screen.applied.warehouseId) params.delete("warehouseId");
    const result = await api(`/reports/stock/${key}?${params}`, { signal: reader.signal });
    if (!reader.signal.aborted && screen === reportScreen) section.data = result;
  } catch (error) {
    if (!reader.signal.aborted && screen === reportScreen) section.error = error.message;
  } finally {
    if (!reader.signal.aborted && screen === reportScreen) {
      section.loading = false;
      if (currentView === "reports") refreshReportSection(key);
    }
  }
}

function fetchStockReports() {
  reportScreen.applied = { ...reportScreen.fields };
  reportScreen.chartIndex = null;
  for (const key of reportSectionNames) {
    reportScreen.sections[key].data = null;
    void loadReportSection(key);
  }
}

function ensureStockReports() {
  if (!reportScreen.applied) fetchStockReports();
}

function updateReportField(input) {
  reportScreen.fields[input.name] = input.value;
}

function applyStockReports(form) {
  if (!form.reportValidity()) return;
  reportScreen.fields = Object.fromEntries(new FormData(form));
  const { from, to } = reportScreen.fields;
  const duration = Date.parse(to) - Date.parse(from);
  if (duration < 0 || duration >= 366 * reportDayMs) {
    reportScreen.error = "Bitiş tarihini başlangıçtan önce seçme. En fazla 366 gün görüntülenebilir.";
  } else {
    reportScreen.error = "";
    fetchStockReports();
  }
  render();
}

function reportNotice(key, empty) {
  const section = reportScreen.sections[key];
  if (section.loading) return '<p class="report-empty" role="status">Rapor yükleniyor…</p>';
  if (section.error) return `<div class="report-empty" role="alert"><p>${esc(section.error)}</p>
    <button class="button button-small" type="button" data-action="report-page" data-section="${key}" data-page="${section.data?.pagination?.page || 1}">Tekrar dene</button></div>`;
  return !section.data || (empty && !section.data.items.length) ? `<p class="report-empty">${empty || "Rapor henüz hazır değil."}</p>` : "";
}

function reportPager(key, pagination) {
  const { page, totalPages, total } = pagination;
  if (totalPages === 1) return "";
  return `<div class="count-pager"><p role="status">Sayfa ${number(page)} / ${number(totalPages)} · ${number(total)} kayıt</p><div>
    <button class="button button-small" type="button" data-action="report-page" data-section="${key}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Önceki</button>
    <button class="button button-small" type="button" data-action="report-page" data-section="${key}" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>Sonraki</button></div></div>`;
}

function renderReportTrend() {
  const notice = reportNotice("summary");
  const data = reportScreen.sections.summary.data;
  const heading = '<header class="panel-header"><div><h2 class="panel-title">Stok değeri</h2><p class="panel-subtitle">Gün sonu miktarı × güncel birim maliyet · tahmini değer</p></div></header>';
  if (notice) return `<section id="report-summary" class="panel report-trend">${heading}${notice}</section>`;
  const index = reportScreen.chartIndex ?? data.trend.length - 1;
  const selected = data.trend[index];
  const delta = data.closingValue - data.openingValue;
  const change = `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${money(Math.abs(delta))}`;
  return `<section id="report-summary" class="panel report-trend" aria-label="Tahmini stok değeri">${heading}
    <dl class="report-metrics"><div><dt>Dönem başı</dt><dd>${money(data.openingValue)}</dd></div>
      <div><dt>Dönem sonu</dt><dd>${money(data.closingValue)}</dd></div>
      <div><dt>Dönem farkı</dt><dd class="${delta < 0 ? "report-fall" : delta > 0 ? "report-rise" : ""}">${change}</dd></div></dl>
    ${data.unreconciledRows ? `<p class="report-quality">${number(data.unreconciledRows)} ürün/depo kaydının hareket geçmişi mevcut bakiyeyle uyuşmuyor. Bu kayıtlar değer hesabı dışında.</p>` : ""}
    <div class="report-chart">
      <canvas id="report-trend-chart" aria-hidden="true"></canvas>
      <div class="report-chart-controls"><label for="report-chart-day">Grafikte gün seç</label>
        <input type="range" id="report-chart-day" min="0" max="${data.trend.length - 1}" value="${index}"
          aria-valuetext="${esc(`${reportDateText(selected.day)}, ${money(selected.value)}`)}" ${data.trend.length < 2 ? "disabled" : ""}>
        <output id="report-chart-point" for="report-chart-day">${reportDateText(selected.day)} · ${money(selected.value)}</output></div>
    </div>
    <details class="report-data"><summary>Günlük değer tablosu</summary>
      <div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">Tarih</th><th scope="col">Tahmini stok değeri</th></tr></thead>
      <tbody>${data.trend.map(point => `<tr><td>${reportDateText(point.day)}</td><td>${money(point.value)}</td></tr>`).join("")}</tbody></table></div>
    </details></section>`;
}

function renderReportTable(key) {
  const outbound = key === "outbound";
  const title = outbound ? "En çok çıkışı yapılan ürünler" : "Hareketsiz stoklar";
  const description = outbound ? "Seçilen tarihlerdeki stok çıkışları" : `Bitiş tarihinde stokta olan ve en az ${esc(reportScreen.applied?.idleDays || "30")} gündür hareket görmeyen ürünler`;
  const notice = reportNotice(key, outbound ? "Bu dönemde stok çıkışı bulunamadı." : "Bu eşiğe uyan stok bulunamadı.");
  const data = reportScreen.sections[key].data;
  return `<section id="report-${key}" class="panel report-ranking" aria-busy="${reportScreen.sections[key].loading}"><header class="panel-header">
    <div><h2 class="panel-title">${title}</h2><p class="panel-subtitle">${description}</p></div></header>
    ${notice || `<div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">Ürün</th>
      ${outbound ? '<th scope="col">Çıkış miktarı</th><th scope="col">Hareket</th>'
        : '<th scope="col">Depo</th><th scope="col">Stok</th><th scope="col">Son hareket</th><th scope="col">Hareketsiz</th>'}</tr></thead>
      <tbody>${data.items.map(row => `<tr><td><span class="report-product"><strong>${esc(row.name)}</strong><small>${esc(row.sku)}</small></span></td>
        ${outbound ? "" : `<td>${esc(row.warehouseName)}</td>`}<td>${number(row.quantity)} ${esc(row.unit)}</td>
        ${outbound ? `<td>${number(row.movements)}</td>`
          : `<td>${row.lastMovement ? reportDateText(new Date(Date.parse(row.lastMovement) + reportHourOffset).toISOString().slice(0, 10)) : "Kayıt yok"}</td><td>${number(row.daysIdle)} gün</td>`}
      </tr>`).join("")}</tbody></table></div>${reportPager(key, data.pagination)}`}
  </section>`;
}

function renderStockReports() {
  const { fields, applied, error } = reportScreen;
  const today = reportToday();
  return pageHeading("ANALİZ", "Stok raporları", "Çıkışları, uzun süredir bekleyen stokları ve stok değerini incele.")
    + `<section class="panel report-filters" aria-label="Rapor filtreleri">
      <form id="stock-report-filters">
        <label>Başlangıç<input type="date" name="from" max="${today}" value="${esc(fields.from)}" required></label>
        <label>Bitiş<input type="date" name="to" max="${today}" value="${esc(fields.to)}" required></label>
        <label>Depo<select name="warehouseId"><option value="">Tüm depolar</option>${state.warehouses.map(w => `<option value="${esc(w.id)}" ${fields.warehouseId === w.id ? "selected" : ""}>${esc(w.name)}${w.archived ? " · Arşivde" : ""}</option>`).join("")}</select></label>
        <label>Hareketsizlik eşiği (gün)<input type="number" name="idleDays" min="1" max="365" step="1" required value="${esc(fields.idleDays)}"></label>
        <button class="button button-primary" type="submit">Raporu göster</button>
      </form>
      ${error ? `<p class="report-form-error" role="alert">${esc(error)}</p>` : ""}
      <p class="report-period">${applied ? `${reportDateText(applied.from)} – ${reportDateText(applied.to)} · ${esc(state.warehouses.find(w => w.id === applied.warehouseId)?.name || "Tüm depolar")} · ` : ""}UTC+03:00</p>
    </section>
    ${renderReportTrend()}
    <div class="report-tables">${renderReportTable("outbound")}${renderReportTable("idle")}</div>`;
}

function refreshReportSection(key) {
  const panel = $(`#report-${key}`);
  if (!panel) return;
  panel.outerHTML = key === "summary" ? renderReportTrend() : renderReportTable(key);
  if (key === "summary") bindReportChart();
}

function drawReportTrend() {
  const canvas = $("#report-trend-chart");
  const points = reportScreen.sections.summary.data?.trend;
  const context = canvas?.getContext("2d");
  if (!context || !points?.length) return;
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  context.scale(scale, scale);
  const padding = { left: width < 420 ? 55 : 73, right: 13, top: 12, bottom: 25 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const floor = Math.min(...points.map(point => point.value));
  const ceiling = Math.max(...points.map(point => point.value));
  const margin = Math.max(1, (ceiling - floor) * .12, Math.abs(ceiling) * .015);
  const minimum = floor >= 0 ? Math.max(0, floor - margin) : floor - margin;
  const maximum = ceiling + margin;
  const x = step => padding.left + (points.length > 1 ? step * chartWidth / (points.length - 1) : chartWidth / 2);
  const y = value => padding.top + (maximum - value) / (maximum - minimum) * chartHeight;
  context.font = "11px system-ui, sans-serif";
  context.textBaseline = "middle";
  for (let tick = 0; tick <= 4; tick++) {
    const value = minimum + (maximum - minimum) * tick / 4;
    const lineY = y(value);
    context.beginPath();
    context.moveTo(padding.left, lineY);
    context.lineTo(width - padding.right, lineY);
    context.strokeStyle = "#e5ece6";
    context.stroke();
    context.fillStyle = "#52645a";
    context.textAlign = "right";
    context.fillText(`₺${reportTickFormatter.format(value)}`, padding.left - 8, lineY);
  }
  context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(x(index), y(point.value)) : context.moveTo(x(index), y(point.value)));
  context.strokeStyle = "#17765a";
  context.lineWidth = 2;
  context.stroke();
  const selected = reportScreen.chartIndex ?? points.length - 1;
  context.beginPath();
  context.moveTo(x(selected), padding.top);
  context.lineTo(x(selected), height - padding.bottom);
  context.lineWidth = 1;
  context.strokeStyle = "#85b8a1";
  context.stroke();
  context.beginPath();
  context.arc(x(selected), y(points[selected].value), 4.5, 0, 2 * Math.PI);
  context.fillStyle = "#17765a";
  context.fill();
  context.fillStyle = "#52645a";
  context.textAlign = "left";
  const axisDate = point => reportAxisDateFormatter.format(new Date(`${point.day}T00:00:00Z`));
  context.fillText(axisDate(points[0]), padding.left, height - 9);
  if (points.length > 1) {
    context.textAlign = "right";
    context.fillText(axisDate(points.at(-1)), width - padding.right, height - 9);
  }
}

function selectReportDay(index) {
  const point = reportScreen.sections.summary.data?.trend[index];
  if (!point) return;
  reportScreen.chartIndex = index;
  const range = $("#report-chart-day");
  range.value = index;
  range.setAttribute("aria-valuetext", `${reportDateText(point.day)}, ${money(point.value)}`);
  $("#report-chart-point").textContent = `${reportDateText(point.day)} · ${money(point.value)}`;
  drawReportTrend();
}

function bindReportChart() {
  const canvas = $("#report-trend-chart");
  if (!canvas) return;
  drawReportTrend();
  canvas.addEventListener("pointermove", event => {
    const { left, width } = canvas.getBoundingClientRect();
    const points = reportScreen.sections.summary.data.trend;
    const inset = width < 420 ? 55 : 73;
    const ratio = Math.max(0, Math.min(1, (event.clientX - left - inset) / (width - inset - 13)));
    const index = Math.round(ratio * (points.length - 1));
    if (index !== reportScreen.chartIndex) selectReportDay(index);
  });
}

function handleReportClick(button) {
  const { section, page } = button.dataset;
  if (!reportSectionNames.includes(section)) return;
  void loadReportSection(section, Number(page));
  refreshReportSection(section);
}
