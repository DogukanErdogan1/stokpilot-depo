const purchaseStatuses = { OPEN: "Açık", PARTIAL: "Kısmi teslim", RECEIVED: "Teslim alındı", CANCELLED: "İptal edildi" };
const purchaseMoney = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });
const purchaseNumber = value => `SA-${String(value).padStart(4, "0")}`;
const purchaseDate = day => day ? new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", dateStyle: "medium" })
  .format(new Date(`${day}T00:00:00Z`)) : "—";
const purchaseAmount = cents => purchaseMoney.format(cents / 100);

function newPurchasingList() {
  return { fields: { q: "", status: "" }, query: {}, result: null, loading: false, error: "", reader: null };
}

let purchasingLists = { suppliers: newPurchasingList(), purchases: newPurchasingList() };
let purchaseDetail = null;
let purchaseEditor = null;

function closePurchaseEditor() {
  if (!purchaseEditor) return;
  for (const search of Object.values(purchaseEditor.searches)) {
    search.reader?.abort();
    clearTimeout(search.timer);
  }
  purchaseEditor = null;
}

function resetPurchasing() {
  for (const list of Object.values(purchasingLists)) list.reader?.abort();
  purchasingLists = { suppliers: newPurchasingList(), purchases: newPurchasingList() };
  purchaseDetail?.reader.abort();
  purchaseDetail = null;
  closePurchaseEditor();
}

async function loadPurchasingList(view, page = 1, showLoading = true) {
  const list = purchasingLists[view];
  list.reader?.abort();
  const reader = new AbortController();
  list.reader = reader;
  list.loading = true;
  list.error = "";
  if (showLoading && currentView === view) render();
  try {
    const params = new URLSearchParams({ page: String(page), pageSize: "15" });
    if (list.query.q) params.set("q", list.query.q);
    if (view === "purchases" && list.query.status) params.set("status", list.query.status);
    const result = await api(`/${view === "suppliers" ? "suppliers" : "purchase-orders"}?${params}`, { signal: reader.signal });
    if (!reader.signal.aborted) list.result = result;
  } catch (error) {
    if (!reader.signal.aborted) list.error = error.message;
  } finally {
    if (!reader.signal.aborted) {
      list.loading = false;
      if (currentView === view) render();
    }
  }
}

function ensurePurchasingView(view) {
  const list = purchasingLists[view];
  if (view === "purchases" && purchaseDetail) return;
  if (!list.result && !list.loading && !list.error) void loadPurchasingList(view, 1, false);
}

function purchasingFilters(view) {
  const { fields } = purchasingLists[view];
  return `<form id="purchasing-filter" class="purchase-filter" data-view-name="${view}">
    <label><span class="visually-hidden">Kayıt ara</span><input name="q" type="search" maxlength="160" placeholder="${view === "suppliers" ? "Tedarikçi, kişi veya iletişim bilgisi ara…" : "Sipariş no, tedarikçi veya depo ara…"}" value="${esc(fields.q)}"></label>
    ${view === "purchases" ? `<label><span class="visually-hidden">Sipariş durumu</span><select name="status"><option value="">Tüm durumlar</option>
      ${Object.entries(purchaseStatuses).map(([value, name]) => `<option value="${value}" ${fields.status === value ? "selected" : ""}>${name}</option>`).join("")}</select></label>` : ""}
    <button class="button" type="submit">Filtrele</button></form>`;
}

function purchasingPager(pagination) {
  if (pagination.totalPages < 2) return "";
  const { page, totalPages, total } = pagination;
  return `<div class="count-pager"><p role="status">Sayfa ${number(page)} / ${number(totalPages)} · ${number(total)} kayıt</p><div>
    <button class="button button-small" type="button" data-action="purchase-page" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Önceki</button>
    <button class="button button-small" type="button" data-action="purchase-page" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>Sonraki</button></div></div>`;
}

function purchasingRows(view, emptyText, build) {
  const { result, loading, error } = purchasingLists[view];
  if (loading) return '<p class="purchase-empty" role="status">Kayıtlar yükleniyor…</p>';
  if (error) return `<div class="purchase-empty" role="alert"><p>${esc(error)}</p><button class="button" type="button" data-action="purchase-page" data-page="1">Tekrar dene</button></div>`;
  if (!result?.items.length) return `<p class="purchase-empty">${emptyText}</p>`;
  return build(result.items) + purchasingPager(result.pagination);
}

function renderSuppliers() {
  return pageHeading("SATIN ALMA", "Tedarikçiler", "İletişim bilgilerini yönet ve tedarikçiden sipariş aç.",
    canEditCatalog() ? `<button class="button button-primary" type="button" data-action="purchase-supplier-add">${icon("plus")} Tedarikçi ekle</button>` : "")
    + `<section class="panel purchase-panel">${purchasingFilters("suppliers")}
      ${purchasingRows("suppliers", "Tedarikçi bulunamadı.", items => `<ul class="purchase-records">${items.map(supplier => `<li>
        <div><strong>${esc(supplier.name)}</strong><small>${esc(supplier.contact || "—")}</small></div>
        <div class="purchase-contact"><span>${esc(supplier.email || "—")}</span><small>${esc(supplier.phone || "—")}</small></div>
        ${supplier.note ? `<span class="supplier-note">${esc(supplier.note)}</span>` : "<span></span>"}
        ${canEditCatalog() ? `<div class="purchase-row-actions"><button class="button button-small" type="button" data-action="purchase-supplier-edit" data-id="${esc(supplier.id)}">Düzenle</button>
        <button class="button button-small" type="button" data-action="purchase-from-supplier" data-id="${esc(supplier.id)}">Sipariş oluştur</button></div>` : ""}
        </li>`).join("")}</ul>`)}
    </section>`;
}

function purchaseStatus(order) {
  return `<span class="purchase-status ${order.status.toLowerCase()}">${purchaseStatuses[order.status]}</span>`;
}

function renderPurchases() {
  if (purchaseDetail) return renderPurchaseDetail();
  return pageHeading("SATIN ALMA", "Satın alma siparişleri", "Açık siparişleri, beklenen teslimatları ve gelen ürünleri takip et.",
    canEditCatalog() ? `<button class="button button-primary" type="button" data-action="purchase-new">${icon("plus")} Yeni sipariş</button>` : "")
    + `<section class="panel purchase-panel">${purchasingFilters("purchases")}
      ${purchasingRows("purchases", "Satın alma siparişi bulunamadı.", items => `<ul class="purchase-records purchase-orders">${items.map(order => `<li>
        <div><strong>${purchaseNumber(order.number)}</strong><small>${esc(order.supplierName)} · ${esc(order.warehouseName)}</small></div>
        <div>${purchaseStatus(order)}<small>${order.expectedDate ? "Beklenen " + purchaseDate(order.expectedDate) : ""}</small></div>
        <div><strong>${purchaseAmount(order.totalCents)}</strong><small>${order.status === "PARTIAL" ? `${number(order.pendingCount)} kalem bekliyor` : `${number(order.itemCount)} ürün`}</small></div>
        <button class="button button-small" type="button" data-action="purchase-open" data-id="${esc(order.id)}">İncele</button></li>`).join("")}</ul>`)}
    </section>`;
}

function isOpenPurchase(order) { return order.status === "OPEN" || order.status === "PARTIAL"; }

function renderPurchaseDetail() {
  const current = purchaseDetail;
  const back = '<button class="button" type="button" data-action="purchase-back">Siparişlere dön</button>';
  if (!current.data || current.error) {
    return pageHeading("SATIN ALMA", "Sipariş detayı", "", back) + `<section class="panel purchase-empty"
      role="${current.error ? "alert" : "status"}">${current.error ? esc(current.error) + '<button class="button button-small" type="button" data-action="purchase-detail-retry">Tekrar dene</button>' : "Sipariş yükleniyor…"}</section>`;
  }
  const { order, items, receipts, receiptCount } = current.data;
  const actions = back + (isOpenPurchase(order) && canChangeStock()
    ? '<button class="button button-primary" type="button" data-action="purchase-receive">Teslim al</button>' : "");
  return pageHeading("SATIN ALMA", purchaseNumber(order.number), esc(`${order.supplierName} · ${order.warehouseName}`), actions)
    + `<section class="panel purchase-detail">
      <div class="purchase-overview"><div><span>Durum</span>${purchaseStatus(order)}</div>
        <div><span>Beklenen teslimat</span><strong>${purchaseDate(order.expectedDate)}</strong></div>
        <div><span>Sipariş tutarı</span><strong>${purchaseAmount(order.totalCents)}</strong></div></div>
      ${order.note ? `<p class="purchase-note">${esc(order.note)}</p>` : ""}
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Ürün</th><th>Sipariş</th><th>Teslim alınan</th><th>${order.status === "CANCELLED" ? "İptal edilen" : "Kalan"}</th><th>Birim fiyat</th></tr></thead>
      <tbody>${items.map(item => `<tr><td><div class="purchase-product"><strong>${esc(item.name)}</strong><small>${esc(item.sku)}</small></div></td>
        ${[item.quantity, item.received, item.quantity - item.received].map(amount => `<td>${number(amount)} ${esc(item.unit)}</td>`).join("")}
        <td>${purchaseAmount(item.unitPriceCents)}</td></tr>`).join("")}</tbody></table></div>
      ${isOpenPurchase(order) && canEditCatalog() ? '<div class="purchase-detail-footer"><button class="button" type="button" data-action="purchase-cancel">Kalan siparişi iptal et</button></div>' : ""}
    </section>
    <section class="panel purchase-panel"><header class="panel-header"><div><h2 class="panel-title">Teslimat geçmişi</h2>
      <p class="panel-subtitle">${receiptCount > receipts.length ? `Son ${number(receipts.length)} / ${number(receiptCount)} teslimat` : `${number(receiptCount)} teslimat`}</p></div></header>
      ${receipts.length ? `<ul class="purchase-deliveries">${receipts.map(receipt => `<li><strong>${dateTime(receipt.createdAt)} · ${esc(receipt.actorName)}</strong>
        <small>${receipt.items.map(item => `${esc(item.name)} (${number(item.quantity)} ${esc(item.unit)})`).join(" · ")}</small></li>`).join("")}</ul>`
        : '<p class="purchase-empty">Henüz bir teslimat alınmadı.</p>'}</section>`;
}

async function openPurchaseDetail(id) {
  purchaseDetail?.reader.abort();
  const current = { id, reader: new AbortController(), data: null, error: "" };
  purchaseDetail = current;
  if (currentView === "purchases") render();
  try {
    current.data = await api(`/purchase-orders/${encodeURIComponent(id)}`, { signal: current.reader.signal });
  } catch (error) {
    current.error = error.message;
  } finally {
    if (!current.reader.signal.aborted && currentView === "purchases") render();
  }
}

function purchaseModal(title, subtitle, formId, formBody, submitLabel, id = "") {
  closePurchaseEditor();
  $("#modal-root").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal purchase-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-modal-title">
    <header class="modal-head"><div><h2 id="purchase-modal-title">${title}</h2><p>${subtitle}</p></div>
      <button class="modal-close" type="button" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header>
    <form class="modal-form" id="${formId}" data-id="${esc(id)}">
      ${formBody}<div class="form-error" id="purchase-form-error" role="alert"></div>
      <div class="modal-actions"><button class="button" type="button" data-action="close-modal">Vazgeç</button>
        <button class="button button-primary" type="submit">${submitLabel}</button></div>
    </form></section></div>`;
  beginModal();
  $(`#${formId} input, #${formId} select, #${formId} button`)?.focus();
}

function showSupplierForm(supplier) {
  const fields = [["name", "Tedarikçi adı", "text", 160, true], ["contact", "İlgili kişi", "text", 120],
    ["email", "E-posta", "email", 254], ["phone", "Telefon", "tel", 60], ["note", "Not", "text", 500]];
  purchaseModal(supplier ? "Tedarikçiyi düzenle" : "Tedarikçi ekle", "Sipariş ve teslimatlar için iletişim bilgilerini kaydet.", "purchase-supplier-form",
    `<div class="form-grid">${fields.map(([key, label, type, max, required]) => `<div class="form-field ${key === "name" || key === "note" ? "full" : ""}">
      <label for="supplier-${key}">${label}</label><input id="supplier-${key}" name="${key}" type="${type}" maxlength="${max}"
        value="${esc(supplier?.[key] || "")}" ${required ? "required" : ""}></div>`).join("")}</div>`,
    "Tedarikçiyi kaydet", supplier?.id);
}

function purchasingPicker(kind, label, placeholder) {
  return `<div class="form-field full purchase-picker">
    <label for="purchase-search-${kind}">${label}</label>
    <input id="purchase-search-${kind}" data-purchase-search="${kind}" type="search" maxlength="160" autocomplete="off" placeholder="${placeholder}">
    <div id="purchase-results-${kind}" class="purchase-picker-results" aria-live="polite" hidden></div></div>`;
}

function addPurchaseLine(product) {
  if (purchaseEditor.lines.has(product.id)) return;
  if (purchaseEditor.lines.size >= 100) { showToast("Bir sipariş en fazla 100 ürün içerebilir."); return; }
  purchaseEditor.lines.set(product.id, { product, quantity: "1", price: "" });
  renderPurchaseLines();
}

function showPurchaseForm({ supplier, product } = {}) {
  if (!activeWarehouses().length) { showToast("Sipariş açmak için aktif bir depo gerekli."); return; }
  purchaseModal("Satın alma siparişi oluştur", "Tedarikçiyi, teslimat deposunu ve sipariş kalemlerini seç.", "purchase-order-form",
    `<div class="form-grid">${purchasingPicker("supplier", "Tedarikçi", "Tedarikçi adıyla ara…")}
    <p class="purchase-selection form-field full" id="purchase-selected-supplier"></p>
    <div class="form-field"><label for="purchase-warehouse">Teslimat deposu</label><select id="purchase-warehouse" name="warehouseId" required>
      <option value="">Depo seç</option>${warehouseOptions()}</select></div>
    <div class="form-field"><label for="purchase-expected">Beklenen teslimat</label><input id="purchase-expected" name="expectedDate" type="date"></div>
    ${purchasingPicker("product", "Siparişe ürün ekle", "Ürün adı, SKU veya barkod ara…")}
    <div class="form-field full" id="purchase-lines"></div>
    <div class="form-field full"><label for="purchase-note">Not</label><input id="purchase-note" name="note" maxlength="500"></div></div>`,
    "Siparişi oluştur");
  purchaseEditor = { requestId: newRequestId(), supplier: supplier || null, lines: new Map(),
    searches: { product: {}, supplier: {} } };
  showSelectedSupplier();
  if (product) addPurchaseLine(product);
  else renderPurchaseLines();
  if (!supplier) void searchPurchasePicker("supplier", "");
}

function showSelectedSupplier() {
  $("#purchase-selected-supplier").textContent = purchaseEditor.supplier ? purchaseEditor.supplier.name : "Tedarikçi seçilmedi.";
}

function renderPurchaseLines() {
  const lines = [...purchaseEditor.lines.values()];
  $("#purchase-lines").innerHTML = lines.length ? `<ul class="purchase-lines">${lines.map(({ product, quantity, price }) => `<li>
    <div class="purchase-product"><strong>${esc(product.name)}</strong><small>${esc(product.sku)} · ${esc(product.unit)}</small></div>
    <label for="purchase-quantity-${esc(product.id)}">Miktar</label><input id="purchase-quantity-${esc(product.id)}" data-line-field="quantity" data-id="${esc(product.id)}"
      type="number" min="1" step="1" value="${esc(quantity)}" required>
    <label for="purchase-price-${esc(product.id)}">Birim fiyat (₺)</label><input id="purchase-price-${esc(product.id)}" data-line-field="price" data-id="${esc(product.id)}"
      type="number" min="0" step="0.01" value="${esc(price)}" required>
    <button class="button button-small" type="button" data-action="purchase-remove-line" data-id="${esc(product.id)}" aria-label="${esc(product.name)} kalemini çıkar">Çıkar</button>
    </li>`).join("")}</ul>` : '<p class="purchase-selection">Henüz ürün eklenmedi.</p>';
}

async function searchPurchasePicker(kind, query) {
  const editor = purchaseEditor;
  if (!editor) return;
  const search = editor.searches[kind];
  search.reader?.abort();
  clearTimeout(search.timer);
  const reader = new AbortController();
  search.reader = reader;
  const outlet = $(`#purchase-results-${kind}`);
  if (!outlet) return;
  outlet.hidden = false;
  outlet.textContent = "Aranıyor…";
  try {
    const endpoint = kind === "product" ? "/products" : "/suppliers";
    const data = await api(`${endpoint}?${new URLSearchParams({ q: query, pageSize: "12" })}`, { signal: reader.signal });
    if (reader.signal.aborted || purchaseEditor !== editor) return;
    search.items = data.items;
    outlet.innerHTML = data.items.map(item => `<button type="button" class="purchase-picker-option"
      data-action="purchase-select" data-kind="${kind}" data-id="${esc(item.id)}"><strong>${esc(item.name)}</strong>
      ${item.sku ? `<small>${esc(item.sku)}</small>` : ""}</button>`).join("") || "Eşleşen kayıt yok.";
    if (data.pagination.total > data.items.length) outlet.insertAdjacentHTML("beforeend", '<small class="purchase-picker-note">Daha fazla kayıt için aramayı daralt.</small>');
  } catch (error) {
    if (!reader.signal.aborted && purchaseEditor === editor) outlet.textContent = error.message;
  }
}

function updatePurchasingInput(input) {
  if (input.closest("#purchasing-filter")) {
    const list = purchasingLists[currentView];
    if (list) list.fields[input.name] = input.value;
  } else if (input.dataset.lineField && purchaseEditor) {
    const line = purchaseEditor.lines.get(input.dataset.id);
    if (line) line[input.dataset.lineField] = input.value;
  } else if (input.dataset.purchaseSearch && purchaseEditor) {
    const kind = input.dataset.purchaseSearch;
    const search = purchaseEditor.searches[kind];
    search.reader?.abort();
    clearTimeout(search.timer);
    const results = $(`#purchase-results-${kind}`);
    results.hidden = false;
    results.textContent = "Aranıyor…";
    search.timer = setTimeout(() => void searchPurchasePicker(kind, input.value.trim()), 230);
  }
}

function showReceiptForm() {
  const { order, items } = purchaseDetail.data;
  purchaseModal("Teslim al", `${purchaseNumber(order.number)} · ${esc(order.warehouseName)}`, "purchase-receipt-form",
    `<p class="purchase-selection">Gelen miktarları gir. Boş bıraktığın kalemler sonraki teslimata kalır.</p>
    <ul class="purchase-lines receipt-lines">${items.filter(item => item.received < item.quantity).map(item => `<li>
      <div class="purchase-product"><strong>${esc(item.name)}</strong><small>Kalan ${number(item.quantity - item.received)} ${esc(item.unit)}</small></div>
      <label for="receipt-${item.id}">Gelen miktar</label>
      <input id="receipt-${item.id}" name="${item.id}" type="number" min="0" max="${item.quantity - item.received}" step="1" inputmode="numeric"></li>`).join("")}</ul>`,
    "Teslimatı kaydet", order.id);
  $("#purchase-receipt-form").dataset.requestId = newRequestId();
}

async function savePurchasingForm(form) {
  const submit = $("button[type='submit']", form);
  if (submit.disabled || !form.reportValidity()) return;
  const user = currentUser;
  const error = $("#purchase-form-error", form);
  submit.disabled = true;
  error.classList.remove("visible");
  try {
    const values = Object.fromEntries(new FormData(form));
    const { id } = form.dataset;
    if (form.id === "purchase-supplier-form") {
      const payload = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value).trim() || null]));
      await api(id ? `/suppliers/${encodeURIComponent(id)}` : "/suppliers", { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) });
      if (currentUser !== user) return;
      if (form.isConnected) closeModal();
      await loadPurchasingList("suppliers", id ? purchasingLists.suppliers.result?.pagination.page : 1);
      showToast("Tedarikçi kaydedildi.");
      return;
    }
    if (form.id === "purchase-order-form") {
      const editor = purchaseEditor;
      if (!editor?.supplier) throw new Error("Önce tedarikçiyi seç.");
      if (!editor.lines.size) throw new Error("Siparişe en az bir ürün ekle.");
      const items = [...editor.lines.values()].map(line => ({
        productId: line.product.id, quantity: Number(line.quantity), unitPriceCents: Math.round(Number(line.price) * 100),
      }));
      const order = await api("/purchase-orders", { method: "POST", body: JSON.stringify({ requestId: editor.requestId,
        supplierId: editor.supplier.id, warehouseId: values.warehouseId, expectedDate: values.expectedDate || null, note: values.note || null, items }) });
      if (currentUser !== user) return;
      if (form.isConnected) closeModal();
      purchasingLists.purchases.result = null;
      await openPurchaseDetail(order.id);
      showToast("Satın alma siparişi oluşturuldu.");
      return;
    }
    if (form.id === "purchase-receipt-form") {
      const items = Object.entries(values).map(([itemId, quantity]) => ({ itemId, quantity: Number(quantity) })).filter(item => item.quantity > 0);
      if (!items.length) throw new Error("En az bir ürün için gelen miktarı gir.");
      await api(`/purchase-orders/${encodeURIComponent(id)}/receipts`, { method: "POST", body: JSON.stringify({ requestId: form.dataset.requestId, items }) });
      if (currentUser !== user) return;
      // The receipt is committed even if refreshing unrelated dashboard aggregates fails.
      void refreshState().then(() => { if (currentView === "purchases") render(); }).catch(() => {});
    } else {
      await api(`/purchase-orders/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      if (currentUser !== user) return;
    }
    if (form.isConnected) closeModal();
    purchasingLists.purchases.result = null;
    await openPurchaseDetail(id);
    showToast(form.id === "purchase-receipt-form" ? "Teslimat stoğa işlendi." : "Kalan sipariş iptal edildi.");
  } catch (problem) {
    error.textContent = problem.message;
    error.classList.add("visible");
  } finally {
    submit.disabled = false;
  }
}

function startPurchaseWith(preset) {
  purchaseDetail?.reader.abort();
  purchaseDetail = null;
  setView("purchases");
  showPurchaseForm(preset);
}

function handlePurchaseAction(action, target) {
  const { id, page, kind } = target.dataset;
  if (action === "purchase-page") return void loadPurchasingList(currentView, Number(page));
  if (action === "purchase-back") {
    purchaseDetail?.reader.abort();
    purchaseDetail = null;
    render();
    return;
  }
  if (action === "purchase-open" || action === "purchase-detail-retry") return void openPurchaseDetail(id || purchaseDetail.id);
  if (action === "purchase-receive" && canChangeStock()) return showReceiptForm();
  if (!canEditCatalog()) return;
  if (action === "purchase-cancel") {
    const { order } = purchaseDetail.data;
    purchaseModal("Kalan siparişi iptal et", purchaseNumber(order.number), "purchase-cancel-form",
      '<p class="purchase-selection">Bekleyen kalemler kapanır. Alınmış teslimatlar stokta ve geçmişte kalır.</p>', "İptali onayla", order.id);
  }
  if (action === "purchase-supplier-add") showSupplierForm();
  if (action === "purchase-new") showPurchaseForm();
  if (action === "purchase-supplier-edit" || action === "purchase-from-supplier") {
    const supplier = purchasingLists.suppliers.result?.items.find(item => item.id === id);
    if (!supplier) return;
    if (action === "purchase-supplier-edit") showSupplierForm(supplier);
    else startPurchaseWith({ supplier });
  }
  if (action === "purchase-from-alert") {
    const product = productById(id);
    if (product) startPurchaseWith({ product });
  }
  if (action === "purchase-remove-line" && purchaseEditor) {
    purchaseEditor.lines.delete(id);
    renderPurchaseLines();
  }
  if (action === "purchase-select" && purchaseEditor) {
    const item = purchaseEditor.searches[kind].items?.find(row => row.id === id);
    if (!item) return;
    if (kind === "product") addPurchaseLine(item);
    else { purchaseEditor.supplier = item; showSelectedSupplier(); }
    $(`#purchase-results-${kind}`).hidden = true;
    $(`#purchase-search-${kind}`).value = "";
    $(`#purchase-search-${kind}`).focus();
  }
}
