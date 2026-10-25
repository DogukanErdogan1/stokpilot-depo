const today = new Date();
const API_BASE_URL = "";
let state = { warehouses: [], products: [], movements: [] };
let currentUser = null;
let currentView = location.hash.slice(1) || "overview";
let currentSearch = "";
let inventoryWarehouseFilter = "all";
let movementTypeFilter = "all";
let movementProductResults = [];
let movementProductActiveIndex = -1;
let showArchivedProducts = false;
let showArchivedWarehouses = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const sumStock = (product) => Object.values(product.stock || {}).reduce((total, amount) => total + Number(amount || 0), 0);
const statusFor = (quantity, minimum) => Number(quantity) === 0 ? "empty" : Number(quantity) <= Number(minimum) ? "low" : "ok";
const money = (amount) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(amount);
const number = (amount) => new Intl.NumberFormat("tr-TR").format(amount);
const dateShort = (value) => new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(new Date(value));
const dateTime = (value) => new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const statusOf = (product) => statusFor(sumStock(product), product.minimum);
const productById = (id) => state.products.find((product) => product.id === id);
const warehouseById = (id) => state.warehouses.find((warehouse) => warehouse.id === id);
const activeProducts = () => state.products.filter((product) => !product.archived);
const activeWarehouses = () => state.warehouses.filter((warehouse) => !warehouse.archived);
const getUserInitials = (user) => (user.fullName || user.email || "StokPilot").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("tr-TR") || "SP";

function stockNotifications() {
  return activeProducts()
    .map((product) => ({ product, quantity: sumStock(product) }))
    .filter(({ product, quantity }) => quantity <= Number(product.minimum))
    .sort((a, b) => Number(a.quantity > 0) - Number(b.quantity > 0) || a.quantity - b.quantity || a.product.name.localeCompare(b.product.name, "tr"));
}

function closeTopbarPopovers() {
  for (const [buttonId, panelId] of [["notification-button", "notification-popover"], ["top-avatar", "profile-popover"]]) {
    const button = $(`#${buttonId}`);
    const panel = $(`#${panelId}`);
    button.setAttribute("aria-expanded", "false");
    panel.hidden = true;
  }
}

function renderNotificationPopover() {
  const alerts = stockNotifications();
  const visibleAlerts = alerts.slice(0, 6);
  $("#notification-popover").innerHTML = `
    <header class="popover-heading"><div><strong>Stok bildirimleri</strong><p>Minimum seviyeye ulaşan ürünler</p></div><span class="notification-total">${number(alerts.length)}</span></header>
    ${visibleAlerts.length ? `<div class="notification-list">${visibleAlerts.map(({ product, quantity }) => {
      const empty = quantity === 0;
      const message = empty ? "Stok tükendi" : `${number(quantity)} ${esc(product.unit)} kaldı · minimum ${number(product.minimum)}`;
      return `<button class="notification-item" type="button" data-view="inventory" aria-label="${esc(product.name)} stok uyarısı, ${esc(message)}">
        <span class="notification-symbol ${empty ? "empty" : "low"}" aria-hidden="true">${empty ? "!" : "↓"}</span>
        <span class="notification-item-copy"><strong>${esc(product.name)}</strong><small>${esc(product.sku)} · ${message} ${empty ? "" : esc(product.unit)}</small></span>
        <span class="notification-severity ${empty ? "empty" : "low"}">${empty ? "Tükendi" : "Kritik"}</span>
      </button>`;
    }).join("")}</div>${alerts.length > visibleAlerts.length ? `<p class="notification-overflow">+ ${number(alerts.length - visibleAlerts.length)} başka stok uyarısı</p>` : ""}` : `<div class="notification-empty"><span aria-hidden="true">✓</span><strong>Şimdilik her şey yolunda</strong><p>Minimum seviyenin altındaki ürün bulunmuyor.</p></div>`}
    <footer class="popover-footer"><button type="button" data-view="inventory">Stok durumunu görüntüle <span aria-hidden="true">→</span></button></footer>`;
}

function renderProfilePopover() {
  const user = currentUser || {};
  const name = user.fullName || user.email || "StokPilot kullanıcısı";
  const initials = getUserInitials(user);
  $("#profile-popover").innerHTML = `
    <header class="popover-heading"><div><strong>Hesabım</strong><p>Oturum açan kullanıcı</p></div></header>
    <div class="profile-popover-user"><span class="profile-popover-avatar" aria-hidden="true">${esc(initials)}</span><span><strong>${esc(name)}</strong><small>Yönetici hesabı</small></span></div>
    <div class="profile-popover-email"><span>E-posta</span><strong>${esc(user.email || "—")}</strong></div>
    <p class="profile-popover-note">Daire içindeki harfler hesabı temsil eder; bu sürümde fotoğraf yükleme yoktur.</p>
    <button class="profile-logout" type="button" data-action="logout"><span aria-hidden="true">↪</span> Oturumu kapat</button>`;
}

function toggleTopbarPopover(name) {
  const buttonId = name === "notifications" ? "notification-button" : "top-avatar";
  const panelId = name === "notifications" ? "notification-popover" : "profile-popover";
  const button = $(`#${buttonId}`);
  const panel = $(`#${panelId}`);
  const shouldOpen = panel.hidden;
  closeTopbarPopovers();
  if (!shouldOpen) return;
  if (name === "notifications") renderNotificationPopover();
  else renderProfilePopover();
  panel.hidden = false;
  button.setAttribute("aria-expanded", "true");
}

function updateNotificationIndicator() {
  const count = stockNotifications().length;
  const button = $("#notification-button");
  const badge = $("#notification-count");
  badge.hidden = count === 0;
  badge.textContent = count > 9 ? "9+" : String(count);
  button.setAttribute("aria-label", count ? `Bildirimler, ${count} stok uyarısı` : "Bildirimler, uyarı yok");
  button.title = count ? `${count} kritik stok uyarısı` : "Kritik stok uyarısı yok";
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api${path}`, {
      credentials: "same-origin",
      ...options,
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
  } catch {
    throw new Error("Sunucuya ulaşılamadı. API hizmetinin çalıştığını kontrol edin.");
  }
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message || "İstek tamamlanamadı.");
  return result;
}

async function refreshState() {
  const [products, warehouses, inventory, movements] = await Promise.all([
    api("/products"), api("/warehouses"), api("/inventory"), api("/stock-movements?limit=100&offset=0"),
  ]);
  const nextWarehouses = warehouses.map((warehouse) => ({ ...warehouse, archived: Boolean(warehouse.archived) }));
  const nextProducts = products.map((product) => ({
    ...product,
    minimum: product.minimumStockQuantity,
    archived: Boolean(product.archived),
    stock: Object.fromEntries(nextWarehouses.map((warehouse) => [warehouse.id, 0])),
  }));
  const productsById = new Map(nextProducts.map((product) => [product.id, product]));
  for (const balance of inventory) {
    const product = productsById.get(balance.productId);
    if (product) product.stock[balance.warehouseId] = Number(balance.quantity);
  }
  state = {
    products: nextProducts,
    warehouses: nextWarehouses,
    movements: movements.map((movement) => ({
      ...movement, delta: movement.quantityDelta, at: movement.createdAt,
    })),
  };
}

function showAuthenticatedApp(user) {
  currentUser = user;
  const initials = getUserInitials(user);
  $("#profile-name").textContent = user.fullName || user.email;
  $("#profile-role").textContent = user.email;
  $("#profile-avatar").textContent = initials || "SP";
  $("#top-avatar").textContent = initials || "SP";
  $("#top-avatar").title = user.fullName || user.email;
  $("#top-avatar").setAttribute("aria-label", `Hesap menüsünü aç: ${user.fullName || user.email}`);
  $("#auth-screen").hidden = true;
  $("#app-shell").hidden = false;
  render();
}

async function initializeAuth() {
  $("#auth-screen").hidden = false;
  $("#app-shell").hidden = true;
  try {
    const session = await api("/auth/session");
    if (!session.authenticated) return;
    await refreshState();
    showAuthenticatedApp(session.user);
  } catch (problem) {
    const error = $("#login-error");
    error.textContent = problem.message || "Sunucuya ulaşılamadı.";
    error.hidden = false;
  }
}

async function submitLogin(form) {
  const values = new FormData(form);
  const email = String(values.get("email") || "").trim();
  const password = String(values.get("password") || "");
  const error = $("#login-error");
  const submit = $("button[type='submit']", form);
  submit.disabled = true;
  error.hidden = true;
  try {
    const session = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    await refreshState();
    showAuthenticatedApp(session.user);
    form.reset();
  } catch (problem) {
    error.textContent = problem.message || "Giriş yapılamadı.";
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    showToast("Sunucuya ulaşılamadığı için çıkış tamamlanamadı. Bağlantı gelince yeniden dene.");
    return;
  }
  currentUser = null;
  state = { warehouses: [], products: [], movements: [] };
  closeTopbarPopovers();
  $("#modal-root").innerHTML = "";
  $("#app-shell").hidden = true;
  $("#auth-screen").hidden = false;
}

function setView(view) {
  closeTopbarPopovers();
  const allowed = ["overview", "inventory", "products", "warehouses", "movements"];
  currentView = allowed.includes(view) ? view : "overview";
  location.hash = currentView;
  render();
  $("#sidebar").classList.remove("open");
}

function pageHeading(eyebrow, title, subtitle, actions = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
}

function metricCard(label, value, unit, note, iconName, tone = "") {
  return `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon ${tone}">${icon(iconName)}</span></div><div class="metric-value-row"><strong class="metric-value">${value}</strong><span class="metric-unit">${unit}</span></div><div class="metric-note">${note}</div></article>`;
}

function getRecentMovements(limit = 6) {
  return [...state.movements].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
}

function movementTitle(type) {
  return ({ INBOUND: "Stok girişi", OUTBOUND: "Stok çıkışı", ADJUSTMENT: "Sayım düzeltmesi", TRANSFER_IN: "Depo transferi · giriş", TRANSFER_OUT: "Depo transferi · çıkış" })[type] || "Stok hareketi";
}

function movementMark(type) {
  const cls = type.toLowerCase().replace("_", "-");
  return `<span class="type-mark ${cls}">${movementTitle(type)}</span>`;
}

function productVisual(product) {
  return `<span class="product-avatar" aria-hidden="true">${esc(product.symbol || "□")}</span>`;
}

function statusPill(product, quantity = sumStock(product)) {
  const status = statusFor(quantity, product.minimum);
  const title = status === "empty" ? "Tükendi" : status === "low" ? "Kritik seviye" : "Stokta";
  return `<span class="status-pill ${status}">${title}</span>`;
}

function recentMovementTable(movements) {
  if (!movements.length) return `<div class="empty-state"><strong>Henüz hareket yok</strong>İlk stok girişini veya çıkışını ekleyebilirsin.</div>`;
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>ÜRÜN</th><th>İŞLEM</th><th>DEPO</th><th>MİKTAR</th><th>TARİH</th></tr></thead><tbody>${movements.map((movement) => {
    const product = productById(movement.productId);
    const warehouse = warehouseById(movement.warehouseId);
    if (!product || !warehouse) return "";
    const positive = movement.delta > 0;
    return `<tr><td><div class="product-cell">${productVisual(product)}<span class="product-name"><strong>${esc(product.name)}</strong><small>${esc(product.sku)}</small></span></div></td><td>${movementMark(movement.type)}</td><td><span class="warehouse-mini"><span class="warehouse-dot">${esc(warehouse.code.slice(0, 2))}</span>${esc(warehouse.name)}</span></td><td><span class="movement-qty ${positive ? "positive" : "negative"}">${positive ? "+" : "−"}${number(Math.abs(movement.delta))} ${esc(product.unit)}</span></td><td>${dateTime(movement.at)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function renderOverview() {
  const totalUnits = activeProducts().reduce((total, product) => total + sumStock(product), 0);
  const stockValue = activeProducts().reduce((total, product) => total + sumStock(product) * Number(product.cost || 0), 0);
  const lowProducts = activeProducts().filter((product) => statusOf(product) !== "ok");
  const critical = lowProducts.slice(0, 4);
  const warehouseTotals = activeWarehouses().map((warehouse) => ({
    ...warehouse,
    count: activeProducts().reduce((total, product) => total + Number(product.stock?.[warehouse.id] || 0), 0),
    products: activeProducts().filter((product) => Number(product.stock?.[warehouse.id] || 0) > 0).length,
  }));
  const maxWarehouseStock = Math.max(1, ...warehouseTotals.map((warehouse) => warehouse.count));
  const day = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(today);
  const actions = `<button class="button" data-action="export-csv">${icon("download")} Dışa aktar</button><button class="button button-primary" data-action="open-movement">${icon("plus")} Stok işlemi</button>`;
  return `${pageHeading(day, "Genel bakış", "Depolarındaki ürün ve stok durumunu tek ekranda gör.", actions)}
    <div class="metrics-grid">
      ${metricCard("Ürün çeşidi", number(activeProducts().length), "SKU", `<em>envanterinde</em> kayıtlı`, "box")}
      ${metricCard("Toplam stok", number(totalUnits), "adet", `${activeWarehouses().length} farklı depoda`, "arrows", "blue")}
      ${metricCard("Stok değeri", money(stockValue), "tahmini", "Birim maliyet üzerinden hesaplandı", "trend", "amber")}
      ${metricCard("Kritik ürün", number(lowProducts.length), "ürün", `<em>${activeProducts().filter((product) => sumStock(product) === 0).length} ürün</em> tamamen tükendi`, "alert", "red")}
    </div>
    <div class="dashboard-grid">
      <section class="panel"><header class="panel-header"><div><h2 class="panel-title">Depolara göre stok</h2><p class="panel-subtitle">Tüm depolardaki toplam ürün adedi</p></div><button class="subtle-link" data-view="warehouses">Depoları gör →</button></header>
        <div class="stock-distribution"><div class="warehouse-bars">${warehouseTotals.map((warehouse) => `<div class="warehouse-bar-row"><div class="warehouse-label"><strong>${esc(warehouse.name)}</strong><small>${warehouse.products} ürün çeşidi</small></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, warehouse.count / maxWarehouseStock * 100)}%"></div></div><div class="bar-amount">${number(warehouse.count)}</div></div>`).join("")}</div><div class="panel-foot"><i class="status-dot"></i> Stok bakiyeleri güncel <span style="margin-left:auto">${activeWarehouses().length} aktif depo</span></div></div>
      </section>
      <section class="panel"><header class="panel-header"><div><h2 class="panel-title">Dikkat gerektirenler</h2><p class="panel-subtitle">Minimum stok seviyesinin altındakiler</p></div><button class="subtle-link" data-view="inventory">Tümünü gör →</button></header>
        <div class="low-list">${critical.length ? critical.map((product) => `<div class="low-item">${productVisual(product)}<div class="low-item-main"><strong>${esc(product.name)}</strong><small>${esc(product.sku)} · Min. ${number(product.minimum)} ${esc(product.unit)}</small></div><span class="stock-alert ${statusOf(product) === "empty" ? "empty" : ""}">${sumStock(product) === 0 ? "Tükendi" : `${number(sumStock(product))} kaldı`}</span></div>`).join("") : `<div class="empty-state"><strong>Harika, kritik stok yok.</strong>Stok seviyelerin kontrol altında.</div>`}</div>
      </section>
    </div>
    <section class="panel table-panel"><header class="panel-header"><div><h2 class="panel-title">Son stok hareketleri</h2><p class="panel-subtitle">Depolarında gerçekleşen son işlemler</p></div><button class="subtle-link" data-view="movements">Hareket geçmişi →</button></header>${recentMovementTable(getRecentMovements(5))}</section>`;
}

function filteredProducts() {
  const query = currentSearch.toLocaleLowerCase("tr-TR");
  return state.products.filter((product) => (showArchivedProducts ? product.archived : !product.archived)
    && (!query || [product.name, product.sku, product.category].some((value) => String(value || "").toLocaleLowerCase("tr-TR").includes(query))));
}

function productRows(products) {
  if (!products.length) return `<tr><td colspan="6"><div class="empty-state"><strong>Ürün bulunamadı</strong>Arama kelimeni değiştirebilir veya yeni ürün ekleyebilirsin.</div></td></tr>`;
  return products.map((product) => {
    const stock = sumStock(product);
    const status = statusOf(product);
    const meterWidth = product.minimum > 0 ? Math.min(100, stock / (product.minimum * 2) * 100) : stock > 0 ? 100 : 0;
    return `<tr class="${product.archived ? "archived-row" : ""}"><td><div class="product-cell">${productVisual(product)}<span class="product-name"><strong>${esc(product.name)}${product.archived ? " · Arşivde" : ""}</strong><small>${esc(product.category || "Genel")}</small></span></div></td><td><span class="sku-code">${esc(product.sku)}</span></td><td><div class="stock-cell"><div class="stock-cell-top"><b>${number(stock)} ${esc(product.unit)}</b><span>Min. ${number(product.minimum)}</span></div><div class="stock-meter"><span class="${status}" style="width:${meterWidth}%"></span></div></div></td><td>${money(stock * Number(product.cost || 0))}</td><td>${statusPill(product)}</td><td><div class="row-actions"><button class="button button-small" data-action="edit-product" data-product-id="${esc(product.id)}">Düzenle</button><button class="button button-small" data-action="toggle-product-archive" data-product-id="${esc(product.id)}">${product.archived ? "Geri al" : "Arşivle"}</button>${product.archived ? "" : `<button class="button button-small" data-action="open-movement" data-product-id="${esc(product.id)}">Stok işlemi</button>`}</div></td></tr>`;
  }).join("");
}

function pageSearchControl(id, placeholder) {
  const hasQuery = Boolean(currentSearch.trim());
  return `<div class="table-search-wrap"><label class="visually-hidden" for="${id}">${esc(placeholder)}</label><input class="table-search" id="${id}" type="search" placeholder="${esc(placeholder)}" value="${esc(currentSearch)}"><button class="table-search-clear" type="button" data-action="clear-page-search" aria-label="Aramayı temizle" title="Aramayı temizle" ${hasQuery ? "" : "hidden"}>×</button></div>`;
}

function renderProducts() {
  const actions = `<button class="button" data-action="export-csv">${icon("download")} CSV indir</button><button class="button button-primary" data-action="open-product">${icon("plus")} Yeni ürün</button>`;
  const archivedCount = state.products.filter((product) => product.archived).length;
  const visibleCount = filteredProducts().length;
  return `${pageHeading("ENVANTER", "Ürünler", "Ürün kataloğunu ve toplam stok seviyelerini yönet.", actions)}
    <div class="page-toolbar"><div class="page-toolbar-left">${pageSearchControl("product-search", "Ürün adı, SKU veya kategori ara...")}<span class="table-count">${visibleCount} ${showArchivedProducts ? "arşivlenmiş" : "aktif"} ürün</span></div><div class="page-toolbar-right"><button class="button button-small" data-action="toggle-archived-products">${showArchivedProducts ? "Aktif ürünler" : `Arşivdekiler (${archivedCount})`}</button><button class="button button-small" data-action="open-warehouse">${icon("plus")} Depo ekle</button></div></div>
    <section class="panel table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>ÜRÜN</th><th>SKU</th><th>TOPLAM STOK</th><th>STOK DEĞERİ</th><th>DURUM</th><th></th></tr></thead><tbody>${productRows(filteredProducts())}</tbody></table></div></section>`;
}

function inventoryRows() {
  const query = currentSearch.toLocaleLowerCase("tr-TR");
  const rows = [];
  for (const product of activeProducts()) {
    const matches = !query || [product.name, product.sku, product.category].some((value) => String(value || "").toLocaleLowerCase("tr-TR").includes(query));
    if (!matches) continue;
    for (const warehouse of activeWarehouses()) {
      if (inventoryWarehouseFilter !== "all" && inventoryWarehouseFilter !== warehouse.id) continue;
      rows.push({ product, warehouse, quantity: Number(product.stock?.[warehouse.id] || 0) });
    }
  }
  return rows;
}

function renderInventory() {
  const rows = inventoryRows();
  const body = rows.length ? rows.map(({ product, warehouse, quantity }) => {
    return `<tr><td><div class="product-cell">${productVisual(product)}<span class="product-name"><strong>${esc(product.name)}</strong><small>${esc(product.sku)}</small></span></div></td><td><span class="warehouse-mini"><span class="warehouse-dot">${esc(warehouse.code.slice(0, 2))}</span>${esc(warehouse.name)}</span></td><td><b class="qty-cell ${quantity === 0 ? "empty" : quantity <= product.minimum ? "low" : ""}">${number(quantity)} ${esc(product.unit)}</b></td><td>${number(product.minimum)} ${esc(product.unit)}</td><td>${statusPill(product, quantity)}</td><td><button class="button button-small" data-action="open-movement" data-product-id="${esc(product.id)}" data-warehouse-id="${esc(warehouse.id)}">İşlem ekle</button></td></tr>`;
  }).join("") : `<tr><td colspan="6"><div class="empty-state"><strong>Sonuç bulunamadı</strong>Seçili filtrelere uygun stok kaydı yok.</div></td></tr>`;
  const warehouseOptions = activeWarehouses().map((warehouse) => `<option value="${esc(warehouse.id)}" ${inventoryWarehouseFilter === warehouse.id ? "selected" : ""}>${esc(warehouse.name)}</option>`).join("");
  const actions = `<button class="button" data-action="export-csv">${icon("download")} CSV indir</button><button class="button button-primary" data-action="open-movement">${icon("plus")} Stok işlemi</button>`;
  return `${pageHeading("ENVANTER", "Stok durumu", "Ürün bakiyelerini depo bazında incele ve güncelle.", actions)}
    <div class="page-toolbar"><div class="page-toolbar-left">${pageSearchControl("inventory-search", "Ürün veya SKU ara...")}<select class="filter-control" id="warehouse-filter"><option value="all">Tüm depolar</option>${warehouseOptions}</select></div><div class="page-toolbar-right"><span class="table-count">${rows.length} stok satırı</span></div></div>
    <section class="panel table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>ÜRÜN</th><th>DEPO</th><th>MEVCUT</th><th>MİNİMUM</th><th>DEPO DURUMU</th><th></th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function renderWarehouses() {
  const visibleWarehouses = state.warehouses.filter((warehouse) => (showArchivedWarehouses ? warehouse.archived : !warehouse.archived));
  const cards = visibleWarehouses.map((warehouse) => {
    const total = state.products.reduce((sum, product) => sum + Number(product.stock?.[warehouse.id] || 0), 0);
    const productCount = state.products.filter((product) => Number(product.stock?.[warehouse.id] || 0) > 0).length;
    const lowCount = activeProducts().filter((product) => Number(product.stock?.[warehouse.id] || 0) <= Number(product.minimum)).length;
    return `<article class="warehouse-card ${warehouse.archived ? "archived-row" : ""}"><div class="warehouse-card-top"><span class="warehouse-card-icon">${icon("warehouse")}</span><span class="warehouse-code">${esc(warehouse.code)}</span></div><h3>${esc(warehouse.name)}${warehouse.archived ? " · Arşivde" : ""}</h3><p>${esc(warehouse.address || "Adres eklenmemiş")}</p><div class="warehouse-card-stats"><span><strong>${number(total)}</strong>Toplam adet</span><span><strong>${number(productCount)}</strong>Ürün çeşidi</span><span><strong>${number(lowCount)}</strong>Kritik stok</span></div><div class="panel-foot"><i class="status-dot ${warehouse.archived ? "warn" : ""}"></i> ${warehouse.archived ? "Arşivlenmiş depo" : "Aktif depo"}<span class="warehouse-card-actions"><button class="button button-small" data-action="edit-warehouse" data-warehouse-id="${esc(warehouse.id)}">Düzenle</button><button class="button button-small" data-action="toggle-warehouse-archive" data-warehouse-id="${esc(warehouse.id)}">${warehouse.archived ? "Geri al" : "Arşivle"}</button></span></div></article>`;
  }).join("");
  const archivedCount = state.warehouses.filter((warehouse) => warehouse.archived).length;
  const actions = `<button class="button button-small" data-action="toggle-archived-warehouses">${showArchivedWarehouses ? "Aktif depolar" : `Arşivdekiler (${archivedCount})`}</button><button class="button button-primary" data-action="open-warehouse">${icon("plus")} Yeni depo</button>`;
  return `${pageHeading("LOKASYONLAR", "Depolar", "Depo konumlarını ve her birindeki ürün dağılımını görüntüle.", actions)}<div class="warehouse-card-grid">${cards || `<section class="panel empty-state"><strong>${showArchivedWarehouses ? "Arşivlenmiş depo yok" : "Henüz depo eklenmedi"}</strong>${showArchivedWarehouses ? "Arşivlenmiş depolar burada görünür." : "İlk depoyu ekleyerek envanterini düzenlemeye başlayabilirsin."}</section>`}</div>`;
}

function renderMovements() {
  const query = currentSearch.toLocaleLowerCase("tr-TR");
  const movements = getRecentMovements(state.movements.length).filter((movement) => {
    const product = productById(movement.productId);
    const warehouse = warehouseById(movement.warehouseId);
    const matchesQuery = !query || [product?.name, product?.sku, warehouse?.name, movement.note].some((value) => String(value || "").toLocaleLowerCase("tr-TR").includes(query));
    return matchesQuery && (movementTypeFilter === "all" || movement.type === movementTypeFilter);
  });
  const rows = movements.map((movement) => {
    const product = productById(movement.productId);
    const warehouse = warehouseById(movement.warehouseId);
    if (!product || !warehouse) return "";
    return `<tr><td>${dateTime(movement.at)}</td><td><div class="product-cell">${productVisual(product)}<span class="product-name"><strong>${esc(product.name)}</strong><small>${esc(product.sku)}</small></span></div></td><td>${movementMark(movement.type)}</td><td><span class="warehouse-mini"><span class="warehouse-dot">${esc(warehouse.code.slice(0, 2))}</span>${esc(warehouse.name)}</span></td><td><span class="movement-qty ${movement.delta > 0 ? "positive" : "negative"}">${movement.delta > 0 ? "+" : "−"}${number(Math.abs(movement.delta))} ${esc(product.unit)}</span></td><td>${esc(movement.note || "—")}</td></tr>`;
  }).join("");
  const types = [["all", "Tüm hareketler"], ["INBOUND", "Stok girişleri"], ["OUTBOUND", "Stok çıkışları"], ["ADJUSTMENT", "Sayım düzeltmeleri"], ["TRANSFER_IN", "Transfer girişleri"], ["TRANSFER_OUT", "Transfer çıkışları"]];
  const actions = `<button class="button" data-action="export-csv">${icon("download")} CSV indir</button><button class="button button-primary" data-action="open-movement">${icon("plus")} Hareket ekle</button>`;
  return `${pageHeading("İŞLEM GEÇMİŞİ", "Stok hareketleri", "Stok girişlerini, çıkışlarını ve transferlerini takip et.", actions)}
    <div class="page-toolbar"><div class="page-toolbar-left">${pageSearchControl("movement-search", "Ürün, depo veya not ara...")}<select class="filter-control" id="movement-filter">${types.map(([value, label]) => `<option value="${value}" ${movementTypeFilter === value ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="page-toolbar-right"><span class="table-count">${movements.length} hareket</span></div></div>
    <section class="panel table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>TARİH</th><th>ÜRÜN</th><th>İŞLEM</th><th>DEPO</th><th>MİKTAR</th><th>AÇIKLAMA</th></tr></thead><tbody>${rows || `<tr><td colspan="6"><div class="empty-state"><strong>Hareket bulunamadı</strong>Filtreleri temizleyip yeniden deneyebilirsin.</div></td></tr>`}</tbody></table></div></section>`;
}

function render() {
  const views = {
    overview: ["Genel bakış", renderOverview],
    inventory: ["Stok durumu", renderInventory],
    products: ["Ürünler", renderProducts],
    warehouses: ["Depolar", renderWarehouses],
    movements: ["Hareketler", renderMovements],
  };
  if (!views[currentView]) currentView = "overview";
  $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === currentView));
  $("#breadcrumb-current").textContent = views[currentView][0];
  $("#page-content").innerHTML = views[currentView][1]();
  $("#nav-stock-count").textContent = activeProducts().filter((product) => statusOf(product) !== "ok").length;
  updateNotificationIndicator();
  if (!$("#notification-popover").hidden) renderNotificationPopover();
}

function productOptions(selected = "") {
  return activeProducts().map((product) => `<option value="${esc(product.id)}" ${selected === product.id ? "selected" : ""}>${esc(product.name)} · ${esc(product.sku)}</option>`).join("");
}

function renderMovementProductOptions(query = "", resetActive = false) {
  const search = $("#movement-product-search");
  const list = $("#movement-product-options");
  if (!search || !list) return;
  const selectedId = $("#movement-product")?.value || "";
  const normalized = String(query).trim().toLocaleLowerCase("tr-TR");
  movementProductResults = activeProducts().filter((product) =>
    !normalized || [product.name, product.sku, product.category].some((value) => String(value || "").toLocaleLowerCase("tr-TR").includes(normalized))
  );
  if (resetActive) movementProductActiveIndex = movementProductResults.length ? 0 : -1;
  else if (movementProductActiveIndex >= movementProductResults.length) movementProductActiveIndex = movementProductResults.length - 1;

  list.innerHTML = movementProductResults.length ? movementProductResults.map((product, index) => `
    <button id="movement-product-option-${index}" class="product-picker-option ${index === movementProductActiveIndex ? "is-active" : ""}" type="button" role="option" aria-selected="${product.id === selectedId}" data-action="select-movement-product" data-product-id="${esc(product.id)}">
      <span><strong>${esc(product.name)}</strong><small>${esc(product.sku)} · ${esc(product.category || "Genel")}</small></span>
      ${product.id === selectedId ? '<span class="product-picker-selected">Seçili</span>' : ""}
    </button>`).join("") : '<div class="product-picker-empty" role="option" aria-disabled="true">Aramana uygun ürün bulunamadı.</div>';
  const active = movementProductActiveIndex >= 0 ? document.getElementById(`movement-product-option-${movementProductActiveIndex}`) : null;
  if (active) search.setAttribute("aria-activedescendant", active.id);
  else search.removeAttribute("aria-activedescendant");
}

function setMovementProductActive(index) {
  if (!movementProductResults.length) return;
  movementProductActiveIndex = Math.max(0, Math.min(index, movementProductResults.length - 1));
  renderMovementProductOptions($("#movement-product-search").value, false);
  document.getElementById(`movement-product-option-${movementProductActiveIndex}`)?.scrollIntoView({ block: "nearest" });
}

function setMovementProductPickerOpen(open, returnFocus = false) {
  const panel = $("#movement-product-panel");
  const trigger = $("#movement-product-trigger");
  const search = $("#movement-product-search");
  if (!panel || !trigger || !search) return;
  panel.hidden = !open;
  trigger.setAttribute("aria-expanded", String(open));
  search.setAttribute("aria-expanded", String(open));
  if (open) {
    search.value = "";
    renderMovementProductOptions("", true);
    search.focus();
  } else {
    search.value = "";
    search.removeAttribute("aria-activedescendant");
    movementProductResults = [];
    movementProductActiveIndex = -1;
    if (returnFocus) trigger.focus();
  }
}

function selectMovementProduct(productId) {
  const product = activeProducts().find((item) => item.id === productId);
  if (!product) return;
  $("#movement-product").value = product.id;
  $("#movement-product-value").innerHTML = `<strong>${esc(product.name)}</strong><small>${esc(product.sku)} · ${esc(product.category || "Genel")}</small>`;
  $("#movement-product-trigger").setAttribute("aria-label", `Seçili ürün: ${product.name}, SKU ${product.sku}. Değiştirmek için aç.`);
  setMovementProductPickerOpen(false, true);
  updateMovementFields();
}

function movementProductPicker(selected = "") {
  const product = productById(selected) || activeProducts()[0];
  return `<input id="movement-product" type="hidden" name="productId" value="${esc(product.id)}"><div class="product-picker" id="movement-product-picker">
    <button class="product-picker-trigger" id="movement-product-trigger" type="button" data-action="toggle-movement-product-picker" aria-haspopup="listbox" aria-expanded="false" aria-controls="movement-product-panel" aria-label="Seçili ürün: ${esc(product.name)}, SKU ${esc(product.sku)}. Değiştirmek için aç.">
      <span class="product-picker-value" id="movement-product-value"><strong>${esc(product.name)}</strong><small>${esc(product.sku)} · ${esc(product.category || "Genel")}</small></span><span class="product-picker-caret" aria-hidden="true">⌄</span>
    </button>
    <div class="product-picker-panel" id="movement-product-panel" hidden>
      <label class="visually-hidden" for="movement-product-search">Ürün adı, SKU veya kategori ara</label>
      <input class="product-picker-search" id="movement-product-search" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="movement-product-options" autocomplete="off" placeholder="Ürün adı veya SKU ara...">
      <div class="product-picker-options" id="movement-product-options" role="listbox" aria-label="Ürünler"></div>
    </div>
  </div>`;
}

function warehouseOptions(selected = "") {
  return activeWarehouses().map((warehouse) => `<option value="${esc(warehouse.id)}" ${selected === warehouse.id ? "selected" : ""}>${esc(warehouse.name)}</option>`).join("");
}

function openModal(kind, presets = {}) {
  const root = $("#modal-root");
  if (kind === "product") {
    root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">Yeni ürün ekle</h2><p>Ürün kataloğuna yeni bir kayıt oluştur.</p></div><button class="modal-close" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header><form class="modal-form" id="product-form"><div class="form-grid"><div class="form-field"><label for="product-sku">SKU / Ürün kodu</label><input id="product-sku" name="sku" maxlength="40" placeholder="Örn. KBL-1042" required></div><div class="form-field"><label for="product-name">Ürün adı</label><input id="product-name" name="name" maxlength="100" placeholder="Ürün adını yaz" required></div><div class="form-field"><label for="product-category">Kategori</label><input id="product-category" name="category" maxlength="50" placeholder="Örn. Elektronik" value="Genel"></div><div class="form-field"><label for="product-unit">Birim</label><select id="product-unit" name="unit"><option>adet</option><option>kutu</option><option>paket</option><option>rulo</option><option>kg</option><option>litre</option></select></div><div class="form-field"><label for="product-minimum">Minimum stok</label><input id="product-minimum" name="minimum" type="number" min="0" step="1" value="5" required></div><div class="form-field"><label for="product-cost">Birim maliyet (₺)</label><input id="product-cost" name="cost" type="number" min="0" step="1" value="0"></div></div><div class="form-error" id="form-error"></div><div class="modal-actions"><button type="button" class="button" data-action="close-modal">Vazgeç</button><button class="button button-primary" type="submit">Ürünü kaydet</button></div></form></section></div>`;
  } else if (kind === "warehouse") {
    root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">Yeni depo ekle</h2><p>Stoklarını takip edeceğin bir konum oluştur.</p></div><button class="modal-close" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header><form class="modal-form" id="warehouse-form"><div class="form-grid"><div class="form-field"><label for="warehouse-code">Depo kodu</label><input id="warehouse-code" name="code" maxlength="20" placeholder="Örn. IST-01" required></div><div class="form-field"><label for="warehouse-name">Depo adı</label><input id="warehouse-name" name="name" maxlength="80" placeholder="Örn. İstanbul Deposu" required></div><div class="form-field full"><label for="warehouse-address">Adres</label><input id="warehouse-address" name="address" maxlength="150" placeholder="İlçe, şehir"></div></div><div class="form-error" id="form-error"></div><div class="modal-actions"><button type="button" class="button" data-action="close-modal">Vazgeç</button><button class="button button-primary" type="submit">Depoyu kaydet</button></div></form></section></div>`;
  } else if (kind === "movement") {
    if (!state.products.length || !state.warehouses.length) {
      showToast("Önce en az bir ürün ve depo ekle.");
      return;
    }
    const selectedProduct = presets.productId || state.products[0].id;
    const selectedWarehouse = presets.warehouseId || state.warehouses[0].id;
    root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">Stok işlemi oluştur</h2><p>Giriş, çıkış, sayım düzeltmesi veya depo transferi.</p></div><button class="modal-close" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header><form class="modal-form" id="movement-form"><div class="form-grid"><div class="form-field full"><label for="movement-type">İşlem türü</label><select id="movement-type" name="type"><option value="INBOUND">Stok girişi</option><option value="OUTBOUND">Stok çıkışı</option><option value="ADJUSTMENT">Sayım düzeltmesi</option><option value="TRANSFER">Depolar arası transfer</option></select></div><div class="form-field full"><label for="movement-product-trigger">Ürün</label>${movementProductPicker(selectedProduct)}</div><div class="form-field full" id="single-warehouse-field"><label for="movement-warehouse">Depo</label><select id="movement-warehouse" name="warehouseId">${warehouseOptions(selectedWarehouse)}</select></div><div class="form-field" id="source-warehouse-field" hidden><label for="movement-source">Kaynak depo</label><select id="movement-source" name="sourceWarehouseId">${warehouseOptions(selectedWarehouse)}</select></div><div class="form-field" id="target-warehouse-field" hidden><label for="movement-target">Hedef depo</label><select id="movement-target" name="targetWarehouseId">${warehouseOptions(state.warehouses.find((item) => item.id !== selectedWarehouse)?.id || "")}</select></div><div class="form-field full"><label for="movement-quantity" id="movement-quantity-label">Miktar</label><input id="movement-quantity" name="quantity" type="number" min="1" step="1" value="1" required><span class="field-hint" id="movement-hint">${esc(productById(selectedProduct)?.unit || "adet")} cinsinden miktar gir.</span></div><div class="form-field full"><label for="movement-note">Açıklama <span style="font-weight:400;color:#9aa39c">(isteğe bağlı)</span></label><input id="movement-note" name="note" maxlength="120" placeholder="Örn. Tedarikçi teslimatı"></div></div><div class="form-error" id="form-error"></div><div class="modal-actions"><button type="button" class="button" data-action="close-modal">Vazgeç</button><button class="button button-primary" type="submit">İşlemi kaydet</button></div></form></section></div>`;
    updateMovementFields();
  }
  const firstInput = $("input:not([type=hidden]), select", root);
  firstInput?.focus();
}

function openProductEditor(productId) {
  const product = productById(productId);
  if (!product) return;
  const units = ["adet", "kutu", "paket", "rulo", "kg", "litre"];
  $("#modal-root").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">Ürünü düzenle</h2><p>Ürün bilgilerini güncelle.</p></div><button class="modal-close" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header><form class="modal-form" id="product-form" data-product-id="${esc(product.id)}"><div class="form-grid"><div class="form-field"><label for="product-sku">SKU / Ürün kodu</label><input id="product-sku" name="sku" maxlength="40" value="${esc(product.sku)}" required></div><div class="form-field"><label for="product-name">Ürün adı</label><input id="product-name" name="name" maxlength="100" value="${esc(product.name)}" required></div><div class="form-field"><label for="product-category">Kategori</label><input id="product-category" name="category" maxlength="50" value="${esc(product.category || "Genel")}"></div><div class="form-field"><label for="product-unit">Birim</label><select id="product-unit" name="unit">${units.map((unit) => `<option ${unit === product.unit ? "selected" : ""}>${unit}</option>`).join("")}</select></div><div class="form-field"><label for="product-minimum">Minimum stok</label><input id="product-minimum" name="minimum" type="number" min="0" step="1" value="${esc(product.minimum)}" required></div><div class="form-field"><label for="product-cost">Birim maliyet (₺)</label><input id="product-cost" name="cost" type="number" min="0" step="1" value="${esc(product.cost || 0)}"></div></div><div class="form-error" id="form-error"></div><div class="modal-actions"><button type="button" class="button" data-action="close-modal">Vazgeç</button><button class="button button-primary" type="submit">Değişiklikleri kaydet</button></div></form></section></div>`;
  $("#product-sku").focus();
}

function openWarehouseEditor(warehouseId) {
  const warehouse = warehouseById(warehouseId);
  if (!warehouse) return;
  $("#modal-root").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">Depoyu düzenle</h2><p>Depo konum bilgilerini güncelle.</p></div><button class="modal-close" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header><form class="modal-form" id="warehouse-form" data-warehouse-id="${esc(warehouse.id)}"><div class="form-grid"><div class="form-field"><label for="warehouse-code">Depo kodu</label><input id="warehouse-code" name="code" maxlength="20" value="${esc(warehouse.code)}" required></div><div class="form-field"><label for="warehouse-name">Depo adı</label><input id="warehouse-name" name="name" maxlength="80" value="${esc(warehouse.name)}" required></div><div class="form-field full"><label for="warehouse-address">Adres</label><input id="warehouse-address" name="address" maxlength="150" value="${esc(warehouse.address || "")}"></div></div><div class="form-error" id="form-error"></div><div class="modal-actions"><button type="button" class="button" data-action="close-modal">Vazgeç</button><button class="button button-primary" type="submit">Değişiklikleri kaydet</button></div></form></section></div>`;
  $("#warehouse-code").focus();
}

function updateMovementFields() {
  const form = $("#movement-form");
  if (!form) return;
  const type = $("#movement-type", form).value;
  const isTransfer = type === "TRANSFER";
  $("#single-warehouse-field", form).hidden = isTransfer;
  $("#source-warehouse-field", form).hidden = !isTransfer;
  $("#target-warehouse-field", form).hidden = !isTransfer;
  const quantity = $("#movement-quantity", form);
  const label = $("#movement-quantity-label", form);
  const hint = $("#movement-hint", form);
  if (type === "ADJUSTMENT") {
    label.textContent = "Fiziki sayım miktarı";
    quantity.min = "0";
    quantity.value = "0";
    hint.textContent = "Depodaki güncel gerçek adedi gir.";
  } else {
    label.textContent = isTransfer ? "Aktarılacak miktar" : "Miktar";
    quantity.min = "1";
    if (Number(quantity.value) < 1) quantity.value = "1";
    hint.textContent = `${productById($("#movement-product", form).value)?.unit || "adet"} cinsinden miktar gir.`;
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  $("#toast-region").append(toast);
  setTimeout(() => toast.remove(), 3200);
}

async function saveProduct(form) {
  const data = new FormData(form);
  const productId = form.dataset.productId;
  const fields = {
    sku: String(data.get("sku")).trim(),
    name: String(data.get("name")).trim(),
    category: String(data.get("category") || "Genel").trim(),
    unit: String(data.get("unit")),
    minimumStockQuantity: Math.max(0, Number(data.get("minimum") || 0)),
    cost: Math.max(0, Number(data.get("cost") || 0)),
  };
  await api(productId ? `/products/${encodeURIComponent(productId)}` : "/products", {
    method: productId ? "PATCH" : "POST", body: JSON.stringify(fields),
  });
  await refreshState();
  $("#modal-root").innerHTML = "";
  render();
  showToast(productId ? "Ürün bilgileri güncellendi." : "Ürün envantere eklendi.");
}

async function saveWarehouse(form) {
  const data = new FormData(form);
  const code = String(data.get("code")).trim().toLocaleUpperCase("tr-TR");
  const warehouseId = form.dataset.warehouseId;
  const fields = { code, name: String(data.get("name")).trim(), address: String(data.get("address") || "").trim() };
  await api(warehouseId ? `/warehouses/${encodeURIComponent(warehouseId)}` : "/warehouses", {
    method: warehouseId ? "PATCH" : "POST", body: JSON.stringify(fields),
  });
  await refreshState();
  $("#modal-root").innerHTML = "";
  render();
  showToast(warehouseId ? "Depo bilgileri güncellendi." : "Yeni depo oluşturuldu.");
}

async function toggleProductArchive(productId) {
  const product = productById(productId);
  if (!product) return;
  if (!product.archived && sumStock(product) > 0) {
    showToast("Arşivlemeden önce ürünün tüm depolardaki stokunu sıfırla.");
    return;
  }
  const archived = !product.archived;
  await api(`/products/${encodeURIComponent(productId)}`, { method: "PATCH", body: JSON.stringify({ archived }) });
  await refreshState();
  render();
  showToast(archived ? "Ürün arşivlendi." : "Ürün yeniden etkinleştirildi.");
}

async function toggleWarehouseArchive(warehouseId) {
  const warehouse = warehouseById(warehouseId);
  if (!warehouse) return;
  if (!warehouse.archived && state.products.some((product) => Number(product.stock?.[warehouseId] || 0) > 0)) {
    showToast("Arşivlemeden önce bu depodaki stokları başka depoya aktar veya çıkış yap.");
    return;
  }
  const archived = !warehouse.archived;
  await api(`/warehouses/${encodeURIComponent(warehouseId)}`, { method: "PATCH", body: JSON.stringify({ archived }) });
  await refreshState();
  if (inventoryWarehouseFilter === warehouseId && archived) inventoryWarehouseFilter = "all";
  render();
  showToast(archived ? "Depo arşivlendi." : "Depo yeniden etkinleştirildi.");
}

async function saveMovement(form) {
  const data = new FormData(form);
  const type = String(data.get("type"));
  const productId = String(data.get("productId"));
  const product = productById(productId);
  const note = String(data.get("note") || "").trim();
  const quantity = Number(data.get("quantity"));
  if (!Number.isInteger(quantity) || quantity < (type === "ADJUSTMENT" ? 0 : 1)) throw new Error("Geçerli bir miktar gir.");
  if (type === "TRANSFER") {
    const sourceWarehouseId = String(data.get("sourceWarehouseId"));
    const targetWarehouseId = String(data.get("targetWarehouseId"));
    if (sourceWarehouseId === targetWarehouseId) throw new Error("Kaynak ve hedef depo farklı olmalı.");
    const sourceQuantity = Number(product?.stock?.[sourceWarehouseId] || 0);
    if (sourceQuantity < quantity) throw new Error("Kaynak depoda yeterli stok yok.");
    await api("/transfers", { method: "POST", body: JSON.stringify({
      productId, sourceWarehouseId, targetWarehouseId, quantity, note: note || "Depolar arası transfer",
    }) });
  } else if (type === "ADJUSTMENT") {
    const warehouseId = String(data.get("warehouseId"));
    const delta = quantity - Number(product?.stock?.[warehouseId] || 0);
    if (delta === 0) throw new Error("Sayım miktarı mevcut stokla aynı.");
    await api("/inventory/adjustments", { method: "POST", body: JSON.stringify({
      productId, warehouseId, countedQuantity: quantity, note: note || "Fiziki sayım düzeltmesi",
    }) });
  } else {
    await api("/stock-movements", { method: "POST", body: JSON.stringify({
      productId, warehouseId: String(data.get("warehouseId")), type, quantity, note,
    }) });
  }
  await refreshState();
  $("#modal-root").innerHTML = "";
  render();
  showToast("Stok hareketi kaydedildi.");
}

async function submitForm(form) {
  const error = $("#form-error", form);
  if (!form.reportValidity()) return;
  const submit = $("button[type='submit']", form);
  submit.disabled = true;
  error.textContent = "";
  error.classList.remove("visible");
  try {
    if (form.id === "product-form") await saveProduct(form);
    if (form.id === "warehouse-form") await saveWarehouse(form);
    if (form.id === "movement-form") await saveMovement(form);
  } catch (problem) {
    error.textContent = problem.message || "İşlem kaydedilemedi.";
    error.classList.add("visible");
  } finally {
    submit.disabled = false;
  }
}

function exportCsv() {
  const rows = [["Ürün", "SKU", "Kategori", "Depo", "Miktar", "Birim", "Minimum", "Durum"]];
  for (const product of activeProducts()) {
    for (const warehouse of activeWarehouses()) {
      const quantity = Number(product.stock?.[warehouse.id] || 0);
      const status = statusFor(quantity, product.minimum);
      rows.push([product.name, product.sku, product.category, warehouse.name, quantity, product.unit, product.minimum, status === "ok" ? "Stokta" : status === "empty" ? "Tükendi" : "Kritik"]);
    }
  }
  const csv = "\uFEFF" + rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = "stokpilot-envanter.csv";
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Envanter CSV dosyası indirildi.");
}

function showHelp() {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" aria-describedby="help-intro-text">
    <header class="modal-head help-modal-head"><div><p class="help-eyebrow">STOKPILOT KULLANIM REHBERİ</p><h2 id="help-title" tabindex="-1">Stoklarını adım adım yönet</h2><p>Ürünleri ve depoları tanımla, hareketleri kaydet, kritik seviyeleri erkenden fark et.</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Rehberi kapat">${icon("close")}</button></header>
    <div class="help-content">
      <div class="help-intro"><span class="help-intro-icon">${icon("spark")}</span><div><strong>Önerilen başlangıç sırası</strong><p id="help-intro-text">Önce ürün kataloğunu ve depo konumlarını oluştur. Ardından her ürünün mevcut miktarını stok girişi olarak ekle. Sonraki giriş, çıkış, sayım ve transferler hareket geçmişine kaydedilir.</p></div></div>
      <div class="help-step-grid">
        <article class="help-step"><span class="help-step-number">01</span><div><h3>Ürün kataloğunu oluştur</h3><p>Ürünler ekranından ürün adı, benzersiz SKU kodu, kategori ve birimi ekle. Minimum stok seviyesi, sistemin ne zaman uyarı vereceğini belirler. Birim maliyet stok değerinin hesaplanmasına yardımcı olur.</p><button class="button button-small" type="button" data-view="products">Ürünlere git <span aria-hidden="true">→</span></button></div></article>
        <article class="help-step"><span class="help-step-number">02</span><div><h3>Depo konumlarını tanımla</h3><p>Her fiziksel lokasyon için benzersiz bir depo kodu ve anlaşılır bir ad kullan. Böylece aynı ürünün hangi depoda bulunduğunu ayrı ayrı takip edebilirsin.</p><button class="button button-small" type="button" data-view="warehouses">Depolara git <span aria-hidden="true">→</span></button></div></article>
        <article class="help-step"><span class="help-step-number">03</span><div><h3>Stok işlemlerini kaydet</h3><p>Stok girişinde miktar artar, çıkışta azalır. Sayım düzeltmesinde gerçek sayım miktarını gir; sistem farkı hesaplar. Transferde kaynak ve hedef depoyu seç. Yetersiz stokla çıkış yapılamaz.</p><button class="button button-small" type="button" data-view="movements">Hareket geçmişini gör <span aria-hidden="true">→</span></button></div></article>
        <article class="help-step"><span class="help-step-number">04</span><div><h3>Stok seviyelerini izle</h3><p>Genel bakış toplam ürün çeşidini, stok miktarını ve yaklaşık stok değerini özetler. Stok Durumu ekranında ürünleri ve depoları filtreleyebilir; miktarı minimum seviyede olanları görebilirsin.</p><button class="button button-small" type="button" data-view="inventory">Stok durumuna git <span aria-hidden="true">→</span></button></div></article>
        <article class="help-step"><span class="help-step-number">05</span><div><h3>Bildirimleri takip et</h3><p>Ürün toplamı minimum stok seviyesine indiğinde veya sıfırlandığında zil simgesinde uyarı görünür. Zile tıklayarak uyarı listesini aç; bir uyarı seni stok ekranına götürür.</p></div></article>
        <article class="help-step"><span class="help-step-number">06</span><div><h3>Raporla ve hesabını yönet</h3><p>Genel bakıştaki Dışa aktar düğmesi envanteri CSV olarak indirir. Profil dairesi oturum açan kişinin baş harflerini gösterir; menüden e-posta bilgini görebilir ve güvenli şekilde çıkış yapabilirsin.</p></div></article>
      </div>
      <div class="help-tip"><strong>İpucu</strong><span>Ürün veya depo geçmişi varsa silmek yerine arşivle. Kayıtlar korunur, arşivlenenler yeni stok işlemlerinde seçilemez.</span></div>
    </div>
  </section></div>`;
  $("#help-title").focus();
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".popover-anchor")) closeTopbarPopovers();
  if (!event.target.closest("#movement-product-picker")) setMovementProductPickerOpen(false);
  const viewLink = event.target.closest("[data-view]");
  if (viewLink) {
    event.preventDefault();
    if (viewLink.closest("#modal-root")) $("#modal-root").innerHTML = "";
    setView(viewLink.dataset.view);
    return;
  }
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;
  const { action } = actionElement.dataset;
  if (action === "clear-page-search") {
    currentSearch = "";
    $("#global-search").value = "";
    const searchId = currentView === "products" ? "#product-search" : currentView === "inventory" ? "#inventory-search" : "#movement-search";
    render();
    $(searchId)?.focus();
    return;
  }
  if (action === "toggle-movement-product-picker") { setMovementProductPickerOpen(Boolean($("#movement-product-panel")?.hidden), true); return; }
  if (action === "select-movement-product") { selectMovementProduct(actionElement.dataset.productId); return; }
  if (action === "toggle-notifications") { toggleTopbarPopover("notifications"); return; }
  if (action === "toggle-profile") { toggleTopbarPopover("profile"); return; }
  if (action === "logout") { logout(); return; }
  if (action === "open-product") openModal("product");
  if (action === "edit-product") openProductEditor(actionElement.dataset.productId);
  if (action === "toggle-product-archive") {
    const product = productById(actionElement.dataset.productId);
    if (product?.archived || confirm("Bu ürünü arşivlemek istiyor musun? Arşivlenmiş ürünler yeni stok işlemlerinde görünmez.")) {
      void toggleProductArchive(actionElement.dataset.productId).catch((problem) => showToast(problem.message || "Ürün güncellenemedi."));
    }
  }
  if (action === "open-warehouse") openModal("warehouse");
  if (action === "edit-warehouse") openWarehouseEditor(actionElement.dataset.warehouseId);
  if (action === "toggle-warehouse-archive") {
    const warehouse = warehouseById(actionElement.dataset.warehouseId);
    if (warehouse?.archived || confirm("Bu depoyu arşivlemek istiyor musun? Depo hareket geçmişi korunur.")) {
      void toggleWarehouseArchive(actionElement.dataset.warehouseId).catch((problem) => showToast(problem.message || "Depo güncellenemedi."));
    }
  }
  if (action === "toggle-archived-products") { showArchivedProducts = !showArchivedProducts; currentSearch = ""; render(); }
  if (action === "toggle-archived-warehouses") { showArchivedWarehouses = !showArchivedWarehouses; render(); }
  if (action === "open-movement") openModal("movement", { productId: actionElement.dataset.productId, warehouseId: actionElement.dataset.warehouseId });
  if (action === "export-csv") exportCsv();
  if (action === "show-help") showHelp();
  if (action === "close-modal" && (actionElement === event.target || actionElement.closest(".modal"))) $("#modal-root").innerHTML = "";
});

document.addEventListener("submit", (event) => {
  if (event.target.matches("#login-form")) {
    event.preventDefault();
    void submitLogin(event.target);
    return;
  }
  if (event.target.matches("#product-form, #warehouse-form, #movement-form")) {
    event.preventDefault();
    void submitForm(event.target);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("#movement-type, #movement-product")) updateMovementFields();
  if (event.target.matches("#warehouse-filter")) { inventoryWarehouseFilter = event.target.value; render(); }
  if (event.target.matches("#movement-filter")) { movementTypeFilter = event.target.value; render(); }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("#movement-product-search")) {
    renderMovementProductOptions(event.target.value, true);
    return;
  }
  if (event.target.matches("#global-search, #product-search, #inventory-search, #movement-search")) {
    currentSearch = event.target.value;
    if (event.target.id !== "global-search") {
      $("#global-search").value = currentSearch;
      const cursor = event.target.selectionStart;
      const id = event.target.id;
      render();
      const replacement = document.getElementById(id);
      replacement?.focus();
      replacement?.setSelectionRange(cursor, cursor);
    } else if (currentSearch.length >= 2) {
      if (["overview", "warehouses"].includes(currentView)) setView("products");
      else render();
    }
  }
});

$("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
document.addEventListener("keydown", (event) => {
  if (event.target?.matches?.("#movement-product-search") && !$("#movement-product-panel")?.hidden) {
    if (event.key === "ArrowDown") { event.preventDefault(); setMovementProductActive(movementProductActiveIndex + 1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); setMovementProductActive(movementProductActiveIndex - 1); return; }
    if (event.key === "Enter") { event.preventDefault(); const product = movementProductResults[movementProductActiveIndex]; if (product) selectMovementProduct(product.id); return; }
    if (event.key === "Escape") { event.preventDefault(); setMovementProductPickerOpen(false, true); return; }
  }
  if (event.key === "Escape") {
    $("#modal-root").innerHTML = "";
    $("#sidebar").classList.remove("open");
    closeTopbarPopovers();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $("#global-search").focus();
  }
});
window.addEventListener("hashchange", () => { currentView = location.hash.slice(1) || "overview"; render(); });

void initializeAuth();
