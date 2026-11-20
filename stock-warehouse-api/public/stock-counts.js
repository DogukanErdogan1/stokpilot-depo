function newStockCountScreen() {
  return {
    count: null, history: null, results: null, page: 1, historyPage: 1, search: "", warehouse: "",
    review: false, differencesOnly: false, confirmCancel: false, edits: new Map(),
    loading: false, busy: false, reader: null, timer: null, error: "", loadError: "", focusProduct: null,
  };
}

let countScreen = newStockCountScreen();
const countStatusNames = { DRAFT: "Taslak", COMPLETED: "Onaylandı", CANCELLED: "İptal edildi" };

function resetStockCounts() {
  countScreen.reader?.abort();
  clearTimeout(countScreen.timer);
  countScreen = newStockCountScreen();
}

function refreshCountScreen() {
  if (!currentUser || currentView !== "counts") return;
  $("#global-search").value = countScreen.count ? countScreen.search : "";
  render();
}

function ensureStockCountView() {
  const ui = countScreen;
  if (!ui.count && !ui.history && !ui.loading && !ui.busy && !ui.loadError) void readCountScreen(false);
}

async function readCountScreen(showLoading = true) {
  const ui = countScreen;
  clearTimeout(ui.timer);
  ui.reader?.abort();
  const reader = new AbortController();
  ui.reader = reader;
  ui.loading = true;
  ui.loadError = "";
  const count = ui.count;
  const params = new URLSearchParams({ page: String(count ? ui.page : ui.historyPage), pageSize: count ? "25" : "10" });
  if (count) {
    params.set("filter", ui.review ? (ui.differencesOnly ? "differences" : "counted") : "all");
    if (ui.search.trim()) params.set("q", ui.search.trim());
  }
  if (showLoading) refreshCountScreen();
  try {
    const endpoint = count ? `/stock-counts/${encodeURIComponent(count.id)}/items` : "/stock-counts";
    const result = await api(`${endpoint}?${params}`, { signal: reader.signal });
    if (reader.signal.aborted || countScreen !== ui) return;
    if (count) {
      ui.count = result.count;
      ui.results = result;
      ui.page = result.pagination.page;
      if (result.count.status !== "DRAFT") ui.edits.clear();
    } else {
      ui.history = result;
      ui.historyPage = result.pagination.page;
    }
  } catch (error) {
    if (!reader.signal.aborted && countScreen === ui) ui.loadError = error.message;
  } finally {
    if (!reader.signal.aborted && countScreen === ui) {
      ui.loading = false;
      refreshCountScreen();
      if (ui.focusProduct && currentView === "counts") {
        const field = document.getElementById(`count-qty-${ui.focusProduct}`);
        if (field) {
          field.value = "";
          field.placeholder = "Yeni miktar";
          field.focus();
        }
        ui.focusProduct = null;
      }
    }
  }
}

function countPager(result, action) {
  if (!result || result.pagination.totalPages < 2) return "";
  const { page, totalPages, total, hasPrevious, hasNext } = result.pagination;
  return `<div class="count-pager"><p role="status">Sayfa ${number(page)} / ${number(totalPages)} · ${number(total)} kayıt</p>
    <div><button class="button" type="button" data-action="${action}" data-page="${page - 1}" ${hasPrevious ? "" : "disabled"}>Önceki</button>
    <button class="button" type="button" data-action="${action}" data-page="${page + 1}" ${hasNext ? "" : "disabled"}>Sonraki</button></div></div>`;
}

function countFeedback() {
  const ui = countScreen;
  const message = ui.error || ui.loadError;
  return `<div class="count-feedback"${message ? "" : " hidden"} role="alert">
    <span>${esc(message)}</span>${ui.loadError ? '<button class="button" type="button" data-action="count-retry">Tekrar dene</button>' : ""}</div>`;
}

function renderCountHistory() {
  const ui = countScreen;
  const options = activeWarehouses();
  const items = ui.history?.items || [];
  const content = ui.loading ? '<p class="count-empty" role="status">Sayımlar yükleniyor…</p>'
    : items.length ? `<ul class="count-history-list">${items.map(count => `<li>
      <div><strong>${esc(count.warehouseName)}</strong><small>${dateTime(count.createdAt)}</small></div>
      <span class="count-status ${count.status.toLowerCase()}">${countStatusNames[count.status]}</span>
      <span class="count-history-numbers">${number(count.counted)} sayılan · ${number(count.differences)} fark</span>
      <button class="button" type="button" data-action="count-open" data-id="${esc(count.id)}">${count.status === "DRAFT" ? "Devam et" : "İncele"}</button>
    </li>`).join("")}</ul>${countPager(ui.history, "count-history-page")}`
    : ui.loadError ? "" : '<p class="count-empty">Henüz depo sayımı kaydı yok.</p>';
  return pageHeading("ENVANTER", "Depo sayımı", "Fiziki miktarları kaydet, stok farklarını incele ve birlikte onayla.")
    + `<section class="panel count-start">
      <div><h2>Sayım başlat</h2><p>Her deponun açık sayımına daha sonra devam edebilirsin.</p></div>
      ${options.length ? `<form id="stock-count-start-form" class="count-start-form">
        <label for="stock-count-warehouse">Depo</label>
        <select id="stock-count-warehouse" name="warehouseId" required ${ui.busy ? "disabled" : ""}>
          <option value="">Depo seç</option>${options.map(item => `<option value="${esc(item.id)}" ${ui.warehouse === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
        </select>
        <button class="button button-primary" type="submit" ${ui.busy ? "disabled" : ""}>${ui.busy ? "Açılıyor…" : "Sayımı aç"}</button>
      </form>` : '<a class="button" href="#warehouses" data-view="warehouses">Depo ekle</a>'}
    </section>${countFeedback()}
    <section class="panel count-history"><header class="panel-header"><div><h2 class="panel-title">Sayım geçmişi</h2><p class="panel-subtitle">Açık ve tamamlanan sayımlar</p></div></header>
      ${content}</section>`;
}

function describeCountDifference(quantity, expected, unit) {
  if (quantity === null || !Number.isSafeInteger(quantity) || quantity < 0) return "—";
  const delta = quantity - expected;
  return `${delta > 0 ? "+" : ""}${number(delta)} ${unit}`;
}

function countRow(row, editMode) {
  const ui = countScreen;
  const change = ui.edits.get(row.productId);
  const current = change ? change.countedQuantity : row.countedQuantity;
  const baseline = change ? change.expectedQuantity : (row.expectedQuantity ?? row.systemQuantity);
  const recorded = ui.count.status !== "DRAFT";
  const system = recorded ? baseline : row.systemQuantity;
  const countFieldId = `count-qty-${row.productId}`;
  const staleEdit = change && (change.stockRevision !== row.stockRevision || change.expectedQuantity !== row.systemQuantity);
  const editedElsewhere = change && change.previousCountedQuantity !== row.countedQuantity;
  const delta = current === null ? null : current - baseline;
  return `<li class="count-item" data-count-row="${esc(row.productId)}">
    <div class="count-product"><strong>${esc(row.name)}</strong><small>${esc(row.sku)}${row.barcode ? ` · ${esc(row.barcode)}` : ""}</small>
      ${editedElsewhere ? '<small class="count-conflict">Kayıt değişti. Miktarı yeniden gir.</small>'
        : row.conflict || staleEdit ? `<small class="count-conflict">${row.available ? "Stok değişti. Yeniden say." : "Ürün artık aktif değil."}</small>` : ""}
    </div>
    <div><span class="count-mobile-label">Sistemde</span><strong>${number(system)} ${esc(row.unit)}</strong>
      ${row.conflict && row.available ? `<small>İlk kayıt ${number(baseline)} ${esc(row.unit)}</small>` : ""}</div>
    <div><span class="count-mobile-label" aria-hidden="true">Sayılan</span>
      ${editMode ? `<label class="visually-hidden" for="${countFieldId}">Sayılan miktar, ${esc(row.name)}</label>
        <input id="${countFieldId}" data-count-quantity="${esc(row.productId)}" type="number" min="0" max="${Number.MAX_SAFE_INTEGER}"
          step="1" inputmode="numeric" placeholder="—" value="${esc(change ? change.value : (current ?? ""))}" ${ui.busy ? "disabled" : ""}>`
        : `<strong>${current === null ? "—" : `${number(current)} ${esc(row.unit)}`}</strong>`}
    </div>
    <div><span class="count-mobile-label">Fark</span><strong data-count-difference class="count-difference${delta ? " is-changed" : ""}">${esc(describeCountDifference(current, baseline, row.unit))}</strong>
      ${ui.review && row.conflict && ui.count.status === "DRAFT" && !ui.count.warehouseArchived ? `<div class="count-row-actions">
        ${row.available ? `<button type="button" class="button button-small" data-action="count-recount" data-id="${esc(row.productId)}" ${ui.busy ? "disabled" : ""}>Yeniden say</button>` : ""}
        <button type="button" class="button button-small" data-action="count-remove-row" data-id="${esc(row.productId)}" ${ui.busy ? "disabled" : ""}>Sayım dışı bırak</button></div>` : ""}
    </div></li>`;
}

function renderActiveCount() {
  const ui = countScreen;
  const { count } = ui;
  const draft = count.status === "DRAFT";
  const active = draft && !count.warehouseArchived;
  const editing = active && !ui.review;
  const rows = ui.results?.items || [];
  const actionDisabled = ui.busy ? "disabled" : "";
  const approveDisabled = !active || ui.busy || ui.loading || ui.loadError || !count.counted;
  const results = ui.loading ? '<p class="count-empty" role="status">Ürünler yükleniyor…</p>'
    : rows.length && !ui.loadError ? `<div class="count-item-head" aria-hidden="true"><span>Ürün</span><span>Sistemde</span><span>Sayılan</span><span>Fark</span></div>
      <ul class="count-items">${rows.map(row => countRow(row, editing)).join("")}</ul>${countPager(ui.results, "count-items-page")}`
    : ui.loadError ? "" : `<p class="count-empty">${ui.search ? "Aramaya uygun ürün bulunamadı." : ui.differencesOnly ? "Fark bulunan ürün yok." : ui.review || !draft ? "Kaydedilmiş ürün sayımı yok." : "Bu sayım için aktif ürün bulunamadı."}</p>`;
  const footer = active && ui.review
    ? `<p>Onay, bu sayımdaki tüm kayıtlı farkları stoka uygular.</p>
      <button class="button button-primary" type="button" data-action="count-approve" ${approveDisabled ? "disabled" : ""}>Onayla ve stoku güncelle</button>`
    : editing ? `<p>Boş bıraktığın ürünler sayım dışında kalır. Stokta ürün yoksa 0 yaz.</p>
      <div class="count-footer-actions"><button id="stock-count-save" class="button" type="button" data-action="count-save" ${ui.busy || !ui.edits.size ? "disabled" : ""}>Girilen miktarları kaydet</button>
      <button id="stock-count-review" class="button button-primary" type="button" data-action="count-review" ${ui.busy || (!ui.edits.size && !count.counted) ? "disabled" : ""}>Farkları incele</button></div>` : "";
  return pageHeading("ENVANTER", esc(count.warehouseName), draft ? "Depo sayımı" : countStatusNames[count.status],
    `<button class="button" type="button" data-action="count-back" ${actionDisabled}>Sayım geçmişine dön</button>`)
    + `<section class="panel count-work">
      <header class="count-work-header">
        <div><h2>${ui.review || !draft ? "Sayım sonuçları" : "Fiziki miktarları gir"}</h2>
          <span class="count-status ${count.status.toLowerCase()}">${countStatusNames[count.status]}</span></div>
        <dl class="count-metrics"><div><dt>Sayılan ürün</dt><dd>${number(count.counted)}</dd></div>
          <div><dt>Fark çıkan</dt><dd>${number(count.differences)}</dd></div>
          <div><dt>Eşleşen</dt><dd>${number(count.counted - count.differences)}</dd></div></dl>
        <div class="count-pending">
          <p id="stock-count-pending" aria-live="polite">${ui.edits.size ? `${number(ui.edits.size)} kaydedilmemiş satır` : ""}</p>
          <button class="button button-small" id="stock-count-reset-edits" type="button" data-action="count-reset-edits"
            ${ui.edits.size ? "" : "hidden"} ${actionDisabled}>Kaydedilmemişleri temizle</button>
        </div>
      </header>
      ${count.warehouseArchived && draft ? '<p class="count-feedback" role="status">Bu depo arşivlenmiş. Sayımı iptal edebilir veya depoyu yeniden etkinleştirebilirsin.</p>' : ""}
      <div class="count-tools"><div class="count-search">
        <label class="visually-hidden" for="stock-count-search">Ürün adı, SKU veya barkod ara</label>
        <input type="search" id="stock-count-search" maxlength="160" value="${esc(ui.search)}" placeholder="Ürün, SKU veya barkod ara…" ${actionDisabled}>
      </div>${ui.review || !draft ? `<label class="count-filter"><input type="checkbox" id="stock-count-differences" ${ui.differencesOnly ? "checked" : ""} ${actionDisabled}> Yalnız farklar</label>` : ""}
        ${active && ui.review ? `<button class="button" type="button" data-action="count-edit" ${actionDisabled}>Sayıma dön</button>` : ""}
      </div>
      ${countFeedback()}
      ${results}
      ${footer ? `<footer class="count-footer">${footer}</footer>` : ""}
      ${draft ? `<div class="count-cancel">${ui.confirmCancel
        ? `<p>Bu sayım kapanacak ve stok değişikliği yapılmayacak.</p><button class="button" type="button" data-action="count-cancel-close" ${actionDisabled}>Vazgeç</button><button class="button count-danger" type="button" data-action="count-cancel" ${actionDisabled}>İptali onayla</button>`
        : `<button class="button count-danger" type="button" data-action="count-cancel-open" ${actionDisabled}>Sayımı iptal et</button>`}</div>` : ""}
    </section>`;
}

function renderStockCounts() {
  return countScreen.count ? renderActiveCount() : renderCountHistory();
}

function enterStockCount(count) {
  const ui = countScreen;
  Object.assign(ui, { count, results: null, page: 1, review: count.status !== "DRAFT" || Boolean(count.warehouseArchived),
    differencesOnly: false, confirmCancel: false, search: "", error: "" });
  ui.edits.clear();
  void readCountScreen();
}

async function startCountFromForm(form) {
  const ui = countScreen;
  if (ui.busy || !form.reportValidity()) return;
  ui.warehouse = new FormData(form).get("warehouseId");
  ui.error = "";
  ui.busy = true;
  refreshCountScreen();
  try {
    const count = await api("/stock-counts", { method: "POST", body: JSON.stringify({ warehouseId: ui.warehouse }) });
    if (ui !== countScreen) return;
    ui.busy = false;
    enterStockCount(count);
  } catch (error) {
    if (ui !== countScreen) return;
    ui.busy = false;
    ui.error = error.message;
    refreshCountScreen();
  }
}

function trackCountInput(input) {
  const ui = countScreen;
  const productId = input.dataset.countQuantity;
  const row = ui.results?.items.find(item => item.productId === productId);
  if (!row || ui.busy) return;
  if (!ui.edits.has(productId) && ui.edits.size >= 250) {
    input.value = row.countedQuantity ?? "";
    showToast("250 satıra ulaştın. Yeni miktar girmeden önce bu sayımı kaydet.");
    return;
  }
  const countedQuantity = input.value === "" && !input.validity.badInput ? null : input.valueAsNumber;
  if (countedQuantity === row.countedQuantity && (!row.conflict || countedQuantity === null)) ui.edits.delete(productId);
  else ui.edits.set(productId, { productId, countedQuantity, previousCountedQuantity: row.countedQuantity, expectedQuantity: row.systemQuantity,
    stockRevision: row.stockRevision, value: input.value });
  const difference = $("[data-count-difference]", input.closest("[data-count-row]"));
  difference.textContent = describeCountDifference(countedQuantity, row.systemQuantity, row.unit);
  difference.classList.toggle("is-changed", Number.isSafeInteger(countedQuantity) && countedQuantity >= 0 && countedQuantity !== row.systemQuantity);
  $("#stock-count-pending").textContent = ui.edits.size ? `${number(ui.edits.size)} kaydedilmemiş satır` : "";
  $("#stock-count-reset-edits").hidden = !ui.edits.size;
  $("#stock-count-save").disabled = !ui.edits.size;
  $("#stock-count-review").disabled = !ui.edits.size && !ui.count.counted;
}

async function saveCountChanges() {
  const ui = countScreen;
  if (ui.busy) return false;
  if (!ui.edits.size) return true;
  const items = [...ui.edits.values()].map(({ value, ...item }) => item);
  if (items.some(item => item.countedQuantity !== null && (!Number.isSafeInteger(item.countedQuantity) || item.countedQuantity < 0))) {
    ui.error = "Sayılan miktarlar sıfır veya pozitif tam sayı olmalı.";
    refreshCountScreen();
    return false;
  }
  ui.reader?.abort();
  clearTimeout(ui.timer);
  ui.loading = false;
  ui.busy = true;
  ui.error = "";
  refreshCountScreen();
  let saved = false;
  try {
    const count = await api(`/stock-counts/${encodeURIComponent(ui.count.id)}/items`, {
      method: "PATCH", body: JSON.stringify({ revision: ui.count.revision, items }),
    });
    if (ui !== countScreen) return false;
    ui.count = count;
    ui.edits.clear();
    saved = true;
    showToast("Sayım taslağı kaydedildi.");
  } catch (error) {
    if (ui === countScreen) ui.error = error.message;
  } finally {
    ui.busy = false;
  }
  if (ui === countScreen && !saved) await readCountScreen();
  return ui === countScreen && saved;
}

async function finishCount(action) {
  const ui = countScreen;
  if (ui.busy) return;
  ui.reader?.abort();
  clearTimeout(ui.timer);
  ui.loading = false;
  ui.busy = true;
  ui.error = "";
  refreshCountScreen();
  try {
    const count = await api(`/stock-counts/${encodeURIComponent(ui.count.id)}/finish`, {
      method: "POST", body: JSON.stringify({ revision: ui.count.revision, action }),
    });
    if (ui !== countScreen) return;
    ui.count = count;
    ui.edits.clear();
    ui.review = true;
    ui.confirmCancel = false;
    showToast(action === "approve" ? "Depo sayımı onaylandı." : "Sayım iptal edildi.");
    if (action === "approve") void refreshState().then(refreshCountScreen).catch(() => {});
  } catch (error) {
    if (ui !== countScreen) return;
    ui.search = "";
    ui.page = 1;
    ui.differencesOnly = false;
    ui.error = error.message;
  } finally {
    ui.busy = false;
    if (ui === countScreen) void readCountScreen();
  }
}

async function handleStockCountAction(action, button) {
  const ui = countScreen;
  if (ui.busy) return;
  if (action === "count-history-page" || action === "count-items-page") {
    if (action === "count-history-page") ui.historyPage = Number(button.dataset.page);
    else ui.page = Number(button.dataset.page);
    return readCountScreen();
  }
  if (action === "count-open") {
    const count = ui.history?.items.find(item => item.id === button.dataset.id);
    if (count) enterStockCount(count);
    return;
  }
  if (action === "count-cancel-open" || action === "count-cancel-close") {
    ui.confirmCancel = action === "count-cancel-open";
    return refreshCountScreen();
  }
  if (action === "count-approve" || action === "count-cancel") return finishCount(action === "count-approve" ? "approve" : "cancel");
  if (action === "count-retry") return readCountScreen();
  if (action === "count-reset-edits") {
    ui.edits.clear();
    ui.error = "";
    return readCountScreen();
  }
  if (action === "count-recount" || action === "count-remove-row") {
    const row = ui.results?.items.find(item => item.productId === button.dataset.id);
    if (!row) return;
    if (action === "count-recount") {
      ui.review = false;
      ui.search = row.sku;
      ui.page = 1;
      ui.focusProduct = row.productId;
      ui.error = "";
      return readCountScreen();
    }
    ui.edits.set(row.productId, { productId: row.productId, countedQuantity: null, previousCountedQuantity: row.countedQuantity,
      expectedQuantity: row.systemQuantity, stockRevision: row.stockRevision, value: "" });
    if (await saveCountChanges()) return readCountScreen();
    return;
  }
  if (["count-save", "count-review", "count-back"].includes(action) && !await saveCountChanges()) return;
  ui.error = "";
  if (action === "count-back") {
    ui.count = null;
    ui.results = null;
  } else if (action === "count-review" || action === "count-edit") {
    ui.review = action === "count-review";
    ui.differencesOnly = false;
    ui.search = "";
    ui.page = 1;
  }
  return readCountScreen();
}

function updateStockCountSearch(value) {
  const ui = countScreen;
  ui.search = value;
  ui.page = 1;
  ui.reader?.abort();
  clearTimeout(ui.timer);
  ui.timer = setTimeout(() => void readCountScreen(), 250);
}
