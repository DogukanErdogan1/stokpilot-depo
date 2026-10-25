const today = new Date();
const API_BASE_URL = "";
let state = { warehouses: [], products: [], movements: [] };
let currentUser = null;
let currentView = location.hash.slice(1) || "overview";
let currentSearch = "";
let movementTypeFilter = "all";
let movementProductResults = [];
let movementProductActiveIndex = -1;
let showArchivedProducts = false;
let showArchivedWarehouses = false;
const warehouseFilters = {location:null, sort:"name"};

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
const productById = id => [...state.products, ...listPages.products.items, ...listPages.inventory.items.map(row=>row.product), ...(state.alerts || []), ...movementProductResults].find(product=>product.id===id);
const warehouseById = id => listPages.warehouses.items.find(warehouse=>warehouse.id===id) || state.warehouses.find(warehouse=>warehouse.id===id);
const activeProducts = () => state.products.filter((product) => !product.archived);
const activeWarehouses = () => state.warehouses.filter((warehouse) => !warehouse.archived);
const getUserInitials = (user) => (user.fullName || user.email || "StokPilot").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("tr-TR") || "SP";

const defaultStockFilters = () => ({ status: "all", warehouse: "all", category: "all", minCost: "", maxCost: "", minQuantity: "", maxQuantity: "", minWarehouses: "", maxWarehouses: "", scope: "warehouse", sort: "name", productId: "" });
const stockFilters = { products: defaultStockFilters(), inventory: defaultStockFilters() };
let modalContext = null;
const stockedWarehouseCount = (product) => activeWarehouses().filter((warehouse) => Number(product.stock?.[warehouse.id] || 0) > 0).length;
const matchesSearch = (product) => !currentSearch.trim() || [product.name, product.sku, product.category].some((value) => String(value || "").toLocaleLowerCase("tr-TR").includes(currentSearch.trim().toLocaleLowerCase("tr-TR")));
const inRange = (value, minimum, maximum) => (minimum === "" || value >= Number(minimum)) && (maximum === "" || value <= Number(maximum));



function resetStockFilters(view = currentView) {
  if (stockFilters[view]) stockFilters[view] = defaultStockFilters();
  currentSearch = "";
  $("#global-search").value = "";
}

function pageSearchControl(id, placeholder) {
  const hasQuery = Boolean(currentSearch.trim());
  return `<div class="table-search-wrap"><label class="visually-hidden" for="${id}">${esc(placeholder)}</label><input class="table-search" id="${id}" type="search" placeholder="${esc(placeholder)}" value="${esc(currentSearch)}"><button class="table-search-clear" type="button" data-action="clear-page-search" aria-label="Aramayı temizle" title="Aramayı temizle" ${hasQuery ? "" : "hidden"}>×</button></div>`;
}

function filterControls(view, resultCount, totalCount) {
  const filters = stockFilters[view];
  const statuses = [["all", "Tümü"], ["low", "Kritik stok"], ["empty", "Tükenenler"], ["ok", "Stokta"]];
  const advancedKeys = ["category", "minCost", "maxCost", "minQuantity", "maxQuantity", "minWarehouses", "maxWarehouses"];
  const activeCount = Object.keys(filters).filter((key) => filters[key] !== defaultStockFilters()[key]).length + Number(Boolean(currentSearch.trim()));
  const categories = state.summary?.categories || [];
  const range = (label, key, step = "1") => `<fieldset class="filter-range"><legend>${label}</legend><div><label><span>En az</span><input type="number" name="min${key}" min="0" step="${step}" placeholder="Sınır yok" value="${esc(filters[`min${key}`])}"></label><label><span>En çok</span><input type="number" name="max${key}" min="0" step="${step}" placeholder="Sınır yok" value="${esc(filters[`max${key}`])}"></label></div></fieldset>`;
  return `<section class="stock-filters" aria-label="${view === "products" ? "Ürün" : "Stok"} filtreleri">
    <div class="page-toolbar"><div class="page-toolbar-left">${pageSearchControl(view === "products" ? "product-search" : "inventory-search", "Ürün, SKU veya kategori ara...")}<label class="visually-hidden" for="warehouse-filter">Depo</label><select class="filter-control" id="warehouse-filter"><option value="all">Tüm depolar</option>${activeWarehouses().map((warehouse) => `<option value="${esc(warehouse.id)}" ${filters.warehouse === warehouse.id ? "selected" : ""}>${esc(warehouse.name)}</option>`).join("")}</select><label class="visually-hidden" for="stock-sort">Sıralama</label><select class="filter-control" id="stock-sort">${[["name", "Ürün adına göre"], ["quantity-desc", "Stok: çoktan aza"], ["quantity-asc", "Stok: azdan çoğa"], ["cost-desc", "Maliyet: yüksekten düşüğe"], ["cost-asc", "Maliyet: düşükten yükseğe"], ["warehouses-desc", "Depo sayısı: çoktan aza"]].map(([value, label]) => `<option value="${value}" ${filters.sort === value ? "selected" : ""}>${label}</option>`).join("")}</select></div></div>
    <div class="filter-status-row"><div class="filter-tabs" role="group" aria-label="Stok durumuna göre filtrele">${statuses.map(([value, label]) => `<button type="button" class="filter-tab ${filters.status === value ? "active" : ""}" aria-pressed="${filters.status === value}" data-action="filter-stock-status" data-status="${value}">${label}</button>`).join("")}</div><span class="table-count">${number(resultCount)} / ${number(totalCount)} ${view === "products" ? "ürün" : "stok satırı"}</span>${activeCount ? `<button class="subtle-link" type="button" data-action="clear-stock-filters">Filtreleri temizle (${activeCount})</button>` : ""}</div>
    ${view === "inventory" && filters.scope === "total" ? `<p class="filter-note">Durum ve miktar ürünün tüm depolardaki toplamına göre filtreleniyor.</p>` : ""}
    ${filters.productId ? `<div class="filter-context">Seçili ürün: <strong>${esc(productById(filters.productId)?.name || "Ürün")}</strong><button type="button" data-action="clear-stock-product" aria-label="Ürün seçimini kaldır">×</button></div>` : ""}
    <details class="advanced-filters" ${advancedKeys.some((key) => filters[key] !== defaultStockFilters()[key]) ? "open" : ""}><summary>Gelişmiş filtreler <span>Birim maliyet, miktar, depo sayısı ve kategori</span></summary><form id="stock-filter-form"><div class="advanced-filter-grid">${range("Birim maliyet (₺)", "Cost", "0.01")}${range(view === "inventory" && filters.scope === "warehouse" ? "Depodaki miktar" : "Stok miktarı", "Quantity")}${range("Stok bulunan depo sayısı", "Warehouses")}<label class="filter-field">Kategori<select name="category"><option value="all">Tüm kategoriler</option>${categories.map((category) => `<option value="${esc(category)}" ${filters.category === category ? "selected" : ""}>${esc(category)}</option>`).join("")}</select></label>${view === "inventory" ? `<label class="filter-field">Stok değerlendirmesi<select name="scope"><option value="warehouse" ${filters.scope === "warehouse" ? "selected" : ""}>Her depoyu ayrı değerlendir</option><option value="total" ${filters.scope === "total" ? "selected" : ""}>Ürünün toplam stokunu değerlendir</option></select></label>` : ""}</div><p class="filter-note">Sınırlar dahildir. Depo sayısı yalnızca stoku sıfırdan büyük aktif depoları sayar.${view === "inventory" && filters.scope === "total" ? " Durum ve miktar filtreleri ürün toplamına uygulanır; satırlar depo bakiyelerini gösterir." : ""}</p><div class="filter-form-footer"><span class="filter-error" role="alert" id="stock-filter-error"></span><button class="button button-primary" type="submit">Filtreleri uygula</button></div></form></details>
  </section>`;
}

function applyStockFilters(form) {
  const values = new FormData(form);
  const next = { ...stockFilters[currentView] };
  for (const [key, value] of values) next[key] = String(value).trim();
  const error = $("#stock-filter-error", form);
  for (const key of ["Cost", "Quantity", "Warehouses"]) {
    const min = next[`min${key}`], max = next[`max${key}`];
    if ((min !== "" && (!Number.isFinite(Number(min)) || Number(min) < 0)) || (max !== "" && (!Number.isFinite(Number(max)) || Number(max) < 0)) || (min !== "" && max !== "" && Number(min) > Number(max))) {
      error.textContent = "En az değeri en çok değerinden büyük olamaz. Geçerli, sıfır veya pozitif sınırlar gir.";
      return;
    }
  }
  stockFilters[currentView] = next;
  reloadList();
}

function openStockAlerts(productId = "") {
  resetStockFilters("inventory");
  stockFilters.inventory = { ...defaultStockFilters(), status: "low", scope: "total", productId };
  invalidateList("inventory",true);
  setView("inventory");
}

function beginModal() {
  if (!$("#modal-root .modal")) return;
  modalRequest++;
  if (!modalContext) {
    modalContext = { trigger: document.activeElement, x: window.scrollX, y: window.scrollY, bodyStyle: document.body.getAttribute("style") };
    document.body.style.position = "fixed";
    document.body.style.top = `-${modalContext.y}px`;
    document.body.style.left = `-${modalContext.x}px`;
    document.body.style.width = "100%";
    document.documentElement.classList.add("modal-open");
    $("#app-shell").inert = true;
  }
}

function closeModal() {
  modalRequest++;
  setMovementProductPickerOpen(false);
  $("#modal-root").innerHTML = "";
  if (!modalContext) return;
  const context = modalContext;
  modalContext = null;
  if (context.bodyStyle === null) document.body.removeAttribute("style");
  else document.body.setAttribute("style", context.bodyStyle);
  document.documentElement.classList.remove("modal-open");
  $("#app-shell").inert = false;
  window.scrollTo({ left: context.x, top: context.y, behavior: "instant" });
  if (context.trigger?.isConnected) context.trigger.focus({ preventScroll: true });
}

function stockNotifications() {
  return (state.alerts || []).map(product => ({product, quantity: sumStock(product)}));
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
  const total = metric("criticalCount");
  const visibleAlerts = alerts.slice(0, 6);
  $("#notification-popover").innerHTML = `
    <header class="popover-heading"><div><strong>Stok bildirimleri</strong><p>Minimum seviyeye ulaşan ürünler</p></div><span class="notification-total">${number(total)}</span></header>
    ${visibleAlerts.length ? `<div class="notification-list">${visibleAlerts.map(({ product, quantity }) => {
      const empty = quantity === 0;
      const message = empty ? "Stok tükendi" : `${number(quantity)} ${esc(product.unit)} kaldı · minimum ${number(product.minimum)}`;
      return `<button class="notification-item" type="button" data-action="open-stock-alert" data-product-id="${esc(product.id)}" aria-label="${esc(product.name)} stok uyarısı, ${esc(message)}">
        <span class="notification-symbol ${empty ? "empty" : "low"}" aria-hidden="true">${empty ? "!" : "↓"}</span>
        <span class="notification-item-copy"><strong>${esc(product.name)}</strong><small>${esc(product.sku)} · ${message} ${empty ? "" : esc(product.unit)}</small></span>
        <span class="notification-severity ${empty ? "empty" : "low"}">${empty ? "Tükendi" : "Kritik"}</span>
      </button>`;
    }).join("")}</div>${total > visibleAlerts.length ? `<p class="notification-overflow">+ ${number(total - visibleAlerts.length)} başka stok uyarısı</p>` : ""}` : `<div class="notification-empty"><span aria-hidden="true">✓</span><strong>Şimdilik her şey yolunda</strong><p>Minimum seviyenin altındaki ürün bulunmuyor.</p></div>`}
    <footer class="popover-footer"><button type="button" data-action="show-stock-alerts">Stok durumunu görüntüle <span aria-hidden="true">→</span></button></footer>`;
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
  const count = metric("criticalCount");
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

const listPages = Object.fromEntries(["products", "inventory", "movements", "warehouses"].map(view => [view, {
  page: 1, pageSize: 25, total: 0, totalPages: 1, items: [], key: "", loading: false, error: "", request: 0, controller: null, timer: null, deferred: false,
}]));
const metric = key => Number(state.summary?.metrics?.[key] || 0);
const normalizeWarehouse = warehouse => ({...warehouse, archived:Boolean(warehouse.archived)});
const normalizeProduct = p => ({ ...p, minimum: p.minimumStockQuantity, archived: Boolean(p.archived), stock: p.stock || {} });
const normalizeMovement = m => ({ ...m, delta: m.quantityDelta, at: m.createdAt,
  product: { id: m.productId, name: m.productName, sku: m.sku, unit: m.unit, symbol: m.symbol },
});
function listParams(view) {
  const page = listPages[view];
  const params = new URLSearchParams({ page: String(page?.page || 1), pageSize: String(page?.pageSize || 25) });
  if (currentSearch.trim()) params.set("q", currentSearch.trim());
  if (view === "warehouses") {
    params.set("archived",String(showArchivedWarehouses));
    params.set("sort",warehouseFilters.sort);
    if(warehouseFilters.location!==null)params.set("location",warehouseFilters.location);
    return params;
  }
  if (view === "movements") {
    if (movementTypeFilter !== "all") params.set("type", movementTypeFilter);
  } else {
    const filters = stockFilters[view] || defaultStockFilters();
    for (const [key, value] of Object.entries(filters)) {
      if (value === "" || value === "all") continue;
      params.set(key === "warehouse" ? "warehouseId" : key, value);
    }
    params.set("archived", String(view === "products" && showArchivedProducts));
  }
  return params;
}
function invalidateList(view, reset = false) {
  const page = listPages[view];
  if (!page) return;
  clearTimeout(page.timer); page.controller?.abort(); page.request++;
  page.key = ""; page.loading = false; page.error = ""; page.deferred = false;
  if (reset) page.page = 1;
}
function reloadList({reset = true, delay = 0} = {}) {
  const page = listPages[currentView];
  if (!page) { render(); return; }
  invalidateList(currentView, reset);
  if (delay) {
    page.deferred = true; page.loading = true;
    const view = currentView;
    page.timer = setTimeout(() => { page.deferred = false; if (currentView === view) render(); }, delay);
  }
  render();
}
async function loadListPage(view) {
  const page = listPages[view], params = listParams(view), key = params.toString();
  page.controller?.abort();
  const controller = new AbortController(), request = ++page.request;
  page.controller = controller; page.key = key; page.loading = true; page.error = "";
  try {
    const endpoint = view === "movements" ? "stock-movements" : view;
    const result = await api(`/${endpoint}?${key}`, { signal: controller.signal });
    if (request !== page.request || key !== listParams(view).toString()) return;
    page.items = view === "products" ? result.items.map(normalizeProduct)
      : view === "inventory" ? result.items.map(row => ({ ...row, product: normalizeProduct(row.product), warehouse: warehouseById(row.warehouseId) }))
      : view === "warehouses" ? result.items.map(normalizeWarehouse) : result.items.map(normalizeMovement);
    if(view === "warehouses"){page.facets=result.facets;page.counts=result.counts;}
    Object.assign(page, result.pagination);
    page.key = listParams(view).toString();
  } catch (problem) {
    if (request !== page.request || controller.signal.aborted) return;
    page.items = []; page.error = problem.message || "Kayıtlar yüklenemedi.";
  } finally {
    if (request === page.request) {
      page.loading = false;
      if (currentUser && currentView === view) {
        render();
        if(page.focusAfterLoad){const selector=page.focusAfterLoad==="size"?`#${view}-page-size`:page.focusAfterLoad==="movement-top"?"#movement-top-page-status":".pagination-nav [aria-current=page]";$(selector)?.focus({preventScroll:true});page.focusAfterLoad=null;}
      }
    }
  }
}
function ensureListPage(view) {
  const page = listPages[view];
  if (page && !page.deferred && page.key !== listParams(view).toString()) void loadListPage(view);
}
function tableNotice(view, columns) {
  const page = listPages[view];
  if (!page.loading && !page.error) return "";
  return `<tr><td colspan="${columns}"><div class="empty-state paged-table-state" role="${page.error ? "alert" : "status"}"><strong>${page.loading ? "Kayıtlar yükleniyor…" : "Kayıtlar yüklenemedi"}</strong>${page.error ? `<p>${esc(page.error)}</p><button type="button" class="button button-small" data-action="retry-list">Tekrar dene</button>` : ""}</div></td></tr>`;
}
function paginationControls(view) {
  const p = listPages[view], disabled = p.loading || Boolean(p.error);
  const start = p.total ? (p.page - 1) * p.pageSize + 1 : 0, end = Math.min(p.page * p.pageSize, p.total);
  const candidates = [...new Set([1, p.totalPages, ...Array.from({length:5}, (_,i) => p.page + i - 2)])].filter(n => n >= 1 && n <= p.totalPages).sort((a,b) => a-b);
  const button = (page,label,extra="") => `<button class="page-button ${page === p.page ? "is-current" : ""}" type="button" data-action="go-page" data-page="${page}" ${extra} ${disabled ? "disabled" : ""}>${label}</button>`;
  const numbers = candidates.map((n,i) => `${i && n > candidates[i-1] + 1 ? '<span class="page-ellipsis" aria-hidden="true">…</span>' : ""}${button(n,number(n),`aria-label="${n}. sayfa" ${n === p.page ? 'aria-current="page"' : ""}`)}`).join("");
  return `<div class="pagination-bar"><div class="pagination-settings"><label for="${view}-page-size">Sayfada <select id="${view}-page-size" data-page-size ${p.loading ? "disabled" : ""}>${[10,25,50,100].map(size => `<option value="${size}" ${size === p.pageSize ? "selected" : ""}>${size}</option>`).join("")}</select> kayıt</label><span class="pagination-summary" role="status" aria-live="polite">${p.loading ? "Yükleniyor…" : `${number(start)}–${number(end)} / ${number(p.total)} kayıt`}</span></div><nav class="pagination-nav" aria-label="${({products:"Ürün",inventory:"Stok",movements:"Hareket",warehouses:"Depo"})[view]} sayfaları">${button(p.page-1,"‹",`aria-label="Önceki sayfa" ${p.page <= 1 ? "disabled" : ""}`)}${numbers}${button(p.page+1,"›",`aria-label="Sonraki sayfa" ${p.page >= p.totalPages ? "disabled" : ""}`)}</nav></div>`;
}

const movementPickerState={page:1,total:0,totalPages:1,loading:false,error:"",controller:null,request:0,timer:null};
let modalRequest=0;
function launchModal(kind,presets={}){void openModal(kind,presets).catch(problem=>showToast(problem.message));}

async function refreshState() {
  const summary = await api("/overview");
  state = { ...state, products: [], summary, warehouses: summary.warehouses.map(w => ({ ...w, archived: Boolean(w.archived) })),
    alerts: summary.alerts.map(normalizeProduct), movements: summary.recentMovements.map(normalizeMovement) };
  for (const view of Object.keys(listPages)) invalidateList(view);
  if (listPages[currentView]) await loadListPage(currentView);
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

async function submitDemoLogin() {
  const form = $("#login-form");
  const error = $("#login-error");
  const submit = $("button[type='submit']", form);
  const demoButton = $("#demo-login-button");
  submit.disabled = true;
  demoButton.disabled = true;
  demoButton.textContent = "Demo hesabı açılıyor…";
  error.hidden = true;
  try {
    const session = await api("/auth/demo-login", { method: "POST" });
    await refreshState();
    showAuthenticatedApp(session.user);
    form.reset();
  } catch (problem) {
    error.textContent = problem.message || "Demo hesabına giriş yapılamadı.";
    error.hidden = false;
  } finally {
    submit.disabled = false;
    demoButton.disabled = false;
    demoButton.innerHTML = 'Demo hesapla giriş yap <svg><use href="#i-chevron"/></svg>';
  }
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    showToast("Sunucuya ulaşılamadığı için çıkış tamamlanamadı. Bağlantı gelince yeniden dene.");
    return;
  }
  for(const view of Object.keys(listPages)){invalidateList(view,true);listPages[view].items=[];listPages[view].total=0;}
  warehouseFilters.location=null;warehouseFilters.sort="name";showArchivedWarehouses=false;currentSearch="";$("#global-search").value="";listPages.warehouses.facets={locations:[]};listPages.warehouses.counts={active:0,archived:0};
  currentUser = null;
  state = { warehouses: [], products: [], movements: [] };
  closeTopbarPopovers();
  closeModal();
  $("#app-shell").hidden = true;
  $("#auth-screen").hidden = false;
}

function setView(view, { preserveSearch = false } = {}) {
  closeTopbarPopovers();
  const allowed = ["overview", "inventory", "products", "warehouses", "movements"];
  const nextView = allowed.includes(view) ? view : "overview";
  if (nextView !== currentView && !preserveSearch) { currentSearch = ""; $("#global-search").value = ""; }
  if (nextView !== currentView && listPages[nextView]) invalidateList(nextView,true);
  currentView = nextView;
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
    const product = movement.product;
    const warehouse = warehouseById(movement.warehouseId);
    if (!product || !warehouse) return "";
    const positive = movement.delta > 0;
    return `<tr><td><div class="product-cell">${productVisual(product)}<span class="product-name"><strong>${esc(product.name)}</strong><small>${esc(product.sku)}</small></span></div></td><td>${movementMark(movement.type)}</td><td><span class="warehouse-mini"><span class="warehouse-dot">${esc(warehouse.code.slice(0, 2))}</span>${esc(warehouse.name)}</span></td><td><span class="movement-qty ${positive ? "positive" : "negative"}">${positive ? "+" : "−"}${number(Math.abs(movement.delta))} ${esc(product.unit)}</span></td><td>${dateTime(movement.at)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function renderOverview() {
  const totalUnits = metric("totalQuantity");
  const stockValue = metric("stockValue");
  const lowProducts = state.alerts || [];
  const critical = lowProducts.slice(0, 4);
  const warehouseTotals = activeWarehouses();
  const maxWarehouseStock = Math.max(1, ...warehouseTotals.map((warehouse) => warehouse.count));
  const day = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(today);
  const actions = `<button class="button" data-action="export-csv">${icon("download")} Dışa aktar</button><button class="button button-primary" data-action="open-movement">${icon("plus")} Stok işlemi</button>`;
  return `${pageHeading(day, "Genel bakış", "Depolarındaki ürün ve stok durumunu tek ekranda gör.", actions)}
    <div class="metrics-grid">
      ${metricCard("Ürün çeşidi", number(metric("productCount")), "SKU", `<em>envanterinde</em> kayıtlı`, "box")}
      ${metricCard("Toplam stok", number(totalUnits), "adet", `${activeWarehouses().length} farklı depoda`, "arrows", "blue")}
      ${metricCard("Stok değeri", money(stockValue), "tahmini", "Birim maliyet üzerinden hesaplandı", "trend", "amber")}
      ${metricCard("Kritik ürün", number(metric("criticalCount")), "ürün", `<em>${metric("emptyCount")} ürün</em> tamamen tükendi`, "alert", "red")}
    </div>
    <div class="dashboard-grid">
      <section class="panel"><header class="panel-header"><div><h2 class="panel-title">Depolara göre stok</h2><p class="panel-subtitle">Tüm depolardaki toplam ürün adedi</p></div><button class="subtle-link" data-view="warehouses">Depoları gör →</button></header>
        <div class="stock-distribution"><div class="warehouse-bars">${warehouseTotals.map((warehouse) => `<div class="warehouse-bar-row"><div class="warehouse-label"><strong>${esc(warehouse.name)}</strong><small>${warehouse.products} ürün çeşidi</small></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, warehouse.count / maxWarehouseStock * 100)}%"></div></div><div class="bar-amount">${number(warehouse.count)}</div></div>`).join("")}</div><div class="panel-foot"><i class="status-dot"></i> Stok bakiyeleri güncel <span style="margin-left:auto">${activeWarehouses().length} aktif depo</span></div></div>
      </section>
      <section class="panel"><header class="panel-header"><div><h2 class="panel-title">Dikkat gerektirenler</h2><p class="panel-subtitle">Minimum stok seviyesinin altındakiler</p></div><button class="subtle-link" data-action="show-stock-alerts">Tümünü gör →</button></header>
        <div class="low-list">${critical.length ? critical.map((product) => `<div class="low-item">${productVisual(product)}<div class="low-item-main"><strong>${esc(product.name)}</strong><small>${esc(product.sku)} · Min. ${number(product.minimum)} ${esc(product.unit)}</small></div><span class="stock-alert ${statusOf(product) === "empty" ? "empty" : ""}">${sumStock(product) === 0 ? "Tükendi" : `${number(sumStock(product))} kaldı`}</span></div>`).join("") : `<div class="empty-state"><strong>Harika, kritik stok yok.</strong>Stok seviyelerin kontrol altında.</div>`}</div>
      </section>
    </div>
    <section class="panel table-panel"><header class="panel-header"><div><h2 class="panel-title">Son stok hareketleri</h2><p class="panel-subtitle">Depolarında gerçekleşen son işlemler</p></div><button class="subtle-link" data-view="movements">Hareket geçmişi →</button></header>${recentMovementTable(getRecentMovements(5))}</section>`;
}

function filteredProducts() {
  const page = listPages.products;
  return page.loading || page.error ? [] : page.items;
}

function productRows(products) {
  if (listPages.products.loading || listPages.products.error) return tableNotice("products",7);
  if (!products.length) return `<tr><td colspan="7"><div class="empty-state"><strong>${showArchivedProducts ? "Arşivde eşleşen ürün yok" : "Görüntülenecek ürün yok"}</strong><p>${metric("productCount") + metric("archivedProductCount") ? "Arama veya filtreler kayıtları gizliyor olabilir. Arşivlediğin ürünler Arşivdekiler bölümündedir." : "İlk ürününü ekleyerek ürün kataloğunu oluşturmaya başla."}</p><div class="empty-actions"><button class="button button-small" data-action="clear-stock-filters">Aramayı ve filtreleri temizle</button><button class="button button-small" data-action="toggle-archived-products">${showArchivedProducts ? "Aktif ürünlere dön" : "Arşivdekileri gör"}</button></div></div></td></tr>`;
  return products.map((product) => {
    const stock = stockFilters.products.warehouse === "all" ? sumStock(product) : Number(product.stock?.[stockFilters.products.warehouse] || 0);
    const status = statusFor(stock, product.minimum);
    const meterWidth = product.minimum > 0 ? Math.min(100, stock / (product.minimum * 2) * 100) : stock > 0 ? 100 : 0;
    return `<tr class="${product.archived ? "archived-row" : ""}"><td><div class="product-cell">${productVisual(product)}<span class="product-name"><strong>${esc(product.name)}${product.archived ? " · Arşivde" : ""}</strong><small>${esc(product.category || "Genel")} · ${stockedWarehouseCount(product)} depoda stok var</small></span></div></td><td><span class="sku-code">${esc(product.sku)}</span></td><td><div class="stock-cell"><div class="stock-cell-top"><b>${number(stock)} ${esc(product.unit)}</b><span>Min. ${number(product.minimum)}</span></div><div class="stock-meter"><span class="${status}" style="width:${meterWidth}%"></span></div></div></td><td>${money(Number(product.cost || 0))}</td><td>${money(stock * Number(product.cost || 0))}</td><td>${statusPill(product, stock)}</td><td><div class="row-actions"><button class="button button-small" data-action="edit-product" data-product-id="${esc(product.id)}">Düzenle</button><button class="button button-small" data-action="toggle-product-archive" data-product-id="${esc(product.id)}">${product.archived ? "Geri al" : "Arşivle"}</button>${product.archived ? "" : `<button class="button button-small" data-action="open-movement" data-product-id="${esc(product.id)}">Stok işlemi</button>`}</div></td></tr>`;
  }).join("");
}

function renderProducts() {
  const actions = '<button class="button" data-action="export-csv">' + icon("download") + ' CSV indir</button><button class="button button-primary" data-action="open-product">' + icon("plus") + ' Yeni ürün</button>';
  const archivedCount = metric("archivedProductCount");
  const products = filteredProducts();
  const total = metric(showArchivedProducts ? "archivedProductCount" : "productCount");
  return pageHeading("ENVANTER", "Ürünler", "Ürün kataloğunu ve toplam stok seviyelerini yönet.", actions)
    + '<div class="catalog-summary"><span>' + (showArchivedProducts ? "Arşivlenmiş ürünler" : "Aktif ürünler") + ' · ' + number(total) + ' kayıt</span><button class="button button-small" data-action="toggle-archived-products">' + (showArchivedProducts ? "Aktif ürünler" : "Arşivdekiler (" + archivedCount + ")") + '</button></div>'
    + filterControls("products", listPages.products.total, total)
    + '<section class="panel table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>ÜRÜN</th><th>SKU</th><th>' + (stockFilters.products.warehouse === "all" ? "TOPLAM STOK" : "SEÇİLİ DEPO STOKU") + '</th><th>BİRİM MALİYET</th><th>STOK DEĞERİ</th><th>DURUM</th><th>İŞLEMLER</th></tr></thead><tbody>' + productRows(products) + '</tbody></table></div>' + paginationControls("products") + '</section>';
}

function inventoryRows() {
  const page = listPages.inventory;
  return page.loading || page.error ? [] : page.items;
}

function renderInventory() {
  const rows = inventoryRows();
  const body = tableNotice("inventory",6) || (rows.length ? rows.map(({ product, warehouse, quantity }) => {
    return `<tr><td><div class="product-cell">${productVisual(product)}<span class="product-name"><strong>${esc(product.name)}</strong><small>${esc(product.sku)}</small></span></div></td><td><span class="warehouse-mini"><span class="warehouse-dot">${esc(warehouse.code.slice(0, 2))}</span>${esc(warehouse.name)}</span></td><td><b class="qty-cell ${quantity === 0 ? "empty" : quantity <= product.minimum ? "low" : ""}">${number(quantity)} ${esc(product.unit)}</b></td><td>${number(product.minimum)} ${esc(product.unit)}</td><td>${statusPill(product, quantity)}</td><td><button class="button button-small" data-action="open-movement" data-product-id="${esc(product.id)}" data-warehouse-id="${esc(warehouse.id)}">İşlem ekle</button></td></tr>`;
  }).join("") : `<tr><td colspan="6"><div class="empty-state"><strong>Sonuç bulunamadı</strong>Seçili filtrelere uygun stok kaydı yok.<div class="empty-actions"><button class="button button-small" data-action="clear-stock-filters">Aramayı ve filtreleri temizle</button></div></div></td></tr>`);
  const actions = `<button class="button" data-action="export-csv">${icon("download")} CSV indir</button><button class="button button-primary" data-action="open-movement">${icon("plus")} Stok işlemi</button>`;
  return `${pageHeading("ENVANTER", "Stok durumu", "Ürün bakiyelerini depo bazında incele ve güncelle.", actions)}
    ${filterControls("inventory", listPages.inventory.total, metric("productCount") * activeWarehouses().length)}
    <section class="panel table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>ÜRÜN</th><th>DEPO</th><th>MEVCUT</th><th>MİNİMUM</th><th>DEPO DURUMU</th><th></th></tr></thead><tbody>${body}</tbody></table></div>${paginationControls("inventory")}</section>`;
}

function renderWarehouses() {
  const page = listPages.warehouses;
  const warehouses = page.loading || page.error ? [] : page.items;
  const locations = page.facets?.locations || [];
  const activeFilters = Number(Boolean(currentSearch.trim())) + Number(warehouseFilters.location !== null) + Number(warehouseFilters.sort !== "name");
  const archivedCount = page.counts?.archived ?? state.warehouses.filter(w => w.archived).length;
  const actions = `<button class="button button-small" data-action="toggle-archived-warehouses">${showArchivedWarehouses ? "Aktif depolar" : `Arşivdekiler (${number(archivedCount)})`}</button><button class="button button-primary" data-action="open-warehouse">${icon("plus")} Yeni depo</button>`;
  const cards = warehouses.map(warehouse => `<article class="warehouse-card ${warehouse.archived ? "archived-row" : ""}">
    <div class="warehouse-card-top"><span class="warehouse-card-icon">${icon("warehouse")}</span><span class="warehouse-code">${esc(warehouse.code)}</span></div>
    <h3>${esc(warehouse.name)}${warehouse.archived ? " · Arşivde" : ""}</h3>
    ${warehouse.location ? `<span class="warehouse-location-tag">${esc(warehouse.location)}</span>` : ""}
    <p>${esc(warehouse.address || "Adres eklenmemiş")}</p>
    <div class="warehouse-card-stats"><span><strong>${number(warehouse.count)}</strong>Toplam adet</span><span><strong>${number(warehouse.products)}</strong>Ürün çeşidi</span><span><strong>${number(warehouse.lowCount)}</strong>Kritik stok</span></div>
    <div class="panel-foot"><i class="status-dot ${warehouse.archived ? "warn" : ""}"></i> ${warehouse.archived ? "Arşivlenmiş depo" : "Aktif depo"}<span class="warehouse-card-actions"><button class="button button-small" data-action="edit-warehouse" data-warehouse-id="${esc(warehouse.id)}">Düzenle</button><button class="button button-small" data-action="toggle-warehouse-archive" data-warehouse-id="${esc(warehouse.id)}">${warehouse.archived ? "Geri al" : "Arşivle"}</button></span></div>
  </article>`).join("");
  const empty = page.loading ? '<section class="panel empty-state warehouse-list-message" role="status"><strong>Depolar yükleniyor…</strong></section>'
    : page.error ? `<section class="panel empty-state warehouse-list-message" role="alert"><strong>Depolar yüklenemedi</strong><p>${esc(page.error)}</p><button class="button button-small" type="button" data-action="retry-list">Tekrar dene</button></section>`
    : `<section class="panel empty-state warehouse-list-message"><strong>${activeFilters ? "Aramana uygun depo bulunamadı" : showArchivedWarehouses ? "Arşivlenmiş depo yok" : "Henüz depo eklenmedi"}</strong><p>${activeFilters ? "Aramayı veya konum filtresini değiştirerek yeniden deneyebilirsin." : showArchivedWarehouses ? "Arşivlediğin depolar burada görünür." : "İlk deponu ekleyerek stoklarını konumlara göre düzenleyebilirsin."}</p>${activeFilters ? '<button class="button button-small" type="button" data-action="clear-warehouse-filters">Aramayı ve filtreleri temizle</button>' : ""}</section>`;
  return `${pageHeading("LOKASYONLAR", "Depolar", "Depolarını ad, kod veya adresle ara; konumlarına göre incele.", actions)}
    <section class="panel warehouse-search-panel" aria-label="Depo arama ve filtreleri">
      <div class="warehouse-filter-grid"><div class="warehouse-search-field"><span class="warehouse-filter-label">Depo ara</span>${pageSearchControl("warehouse-search", "Depo adı, kodu veya adres ara...")}</div>
        <label class="warehouse-filter-field" for="warehouse-location-filter"><span>Konum</span><select id="warehouse-location-filter"><option value="all">Tüm konumlar</option>${locations.map(item => `<option value="${esc('location:' + item.value)}" ${warehouseFilters.location !== null && warehouseFilters.location.normalize("NFKC").toLocaleLowerCase("tr-TR") === item.value.normalize("NFKC").toLocaleLowerCase("tr-TR") ? "selected" : ""}>${esc(item.value || "Konum belirtilmemiş")} (${number(item.count)})</option>`).join("")}</select></label>
        <label class="warehouse-filter-field" for="warehouse-sort"><span>Sıralama</span><select id="warehouse-sort">${[["name","Depo adına göre"],["quantity-desc","Stok: çoktan aza"],["products-desc","Ürün çeşidi: çoktan aza"],["critical-desc","Kritik stok: çoktan aza"]].map(([value,label])=>`<option value="${value}" ${warehouseFilters.sort===value?"selected":""}>${label}</option>`).join("")}</select></label>
      </div>
      <div class="warehouse-filter-footer"><span>${showArchivedWarehouses ? "Arşivlenmiş depolar" : "Aktif depolar"} · ${number(page.total)} / ${number(page.counts?.[showArchivedWarehouses ? "archived" : "active"] || 0)} depo</span>${activeFilters ? `<button type="button" class="subtle-link" data-action="clear-warehouse-filters">Filtreleri temizle (${activeFilters})</button>` : ""}</div>
    </section>
    <div class="warehouse-card-grid" aria-busy="${page.loading}">${cards || empty}</div>
    <section class="panel warehouse-pagination" aria-label="Depo listeleme seçenekleri">${paginationControls("warehouses")}</section>`;
}
function movementPaginationTop() {
  const p = listPages.movements, disabled = p.loading || Boolean(p.error);
  return `<nav class="movement-pagination-top" aria-label="Stok hareketleri sayfa geçişleri"><span id="movement-top-page-status" class="movement-page-summary" tabindex="-1" role="status" aria-live="polite">${p.loading ? "Hareketler yükleniyor…" : `Sayfa ${number(p.page)} / ${number(p.totalPages)} · ${number(p.total)} hareket`}</span><div><button type="button" class="button button-small" data-action="go-page" data-page="${p.page-1}" aria-label="Önceki hareket sayfası" ${disabled||p.page<=1?"disabled":""}>‹ Önceki</button><button type="button" class="button button-small" data-action="go-page" data-page="${p.page+1}" aria-label="Sonraki hareket sayfası" ${disabled||p.page>=p.totalPages?"disabled":""}>Sonraki ›</button></div></nav>`;
}

function renderMovements() {
  const page = listPages.movements;
  const rows = page.items.map(movement => {
    const product = movement.product, warehouse = warehouseById(movement.warehouseId);
    if (!product || !warehouse) return "";
    return `<tr><td>${dateTime(movement.at)}</td><td><div class="product-cell">${productVisual(product)}<span class="product-name"><strong>${esc(product.name)}</strong><small>${esc(product.sku)}</small></span></div></td><td>${movementMark(movement.type)}</td><td><span class="warehouse-mini"><span class="warehouse-dot">${esc(warehouse.code.slice(0,2))}</span>${esc(warehouse.name)}</span></td><td><span class="movement-qty ${movement.delta > 0 ? "positive" : "negative"}">${movement.delta > 0 ? "+" : "−"}${number(Math.abs(movement.delta))} ${esc(product.unit)}</span></td><td>${esc(movement.note || "—")}</td></tr>`;
  }).join("");
  const types = [["all","Tüm hareketler"],["INBOUND","Stok girişleri"],["OUTBOUND","Stok çıkışları"],["ADJUSTMENT","Sayım düzeltmeleri"],["TRANSFER_IN","Transfer girişleri"],["TRANSFER_OUT","Transfer çıkışları"]];
  const actions = `<button class="button" data-action="export-csv">${icon("download")} CSV indir</button><button class="button button-primary" data-action="open-movement">${icon("plus")} Hareket ekle</button>`;
  return `${pageHeading("İŞLEM GEÇMİŞİ","Stok hareketleri","Stok girişlerini, çıkışlarını ve transferlerini takip et.",actions)}
    <div class="page-toolbar movement-toolbar"><div class="page-toolbar-left">${pageSearchControl("movement-search","Ürün, depo veya not ara...")}<label class="visually-hidden" for="movement-filter">İşlem türü</label><select class="filter-control" id="movement-filter">${types.map(([value,label])=>`<option value="${value}" ${movementTypeFilter === value ? "selected" : ""}>${label}</option>`).join("")}</select></div><span class="table-count">${number(page.total)} hareket</span></div>
    ${movementPaginationTop()}
    <section class="panel table-panel" aria-busy="${page.loading}"><div class="table-scroll"><table class="data-table"><thead><tr><th>TARİH</th><th>ÜRÜN</th><th>İŞLEM</th><th>DEPO</th><th>MİKTAR</th><th>AÇIKLAMA</th></tr></thead><tbody>${tableNotice("movements",6) || rows || '<tr><td colspan="6"><div class="empty-state"><strong>Hareket bulunamadı</strong>Aramayı veya işlem türünü değiştirerek yeniden deneyebilirsin.</div></td></tr>'}</tbody></table></div>${paginationControls("movements")}</section>`;
}

function render() {
  const views = {overview:["Genel bakış",renderOverview],inventory:["Stok durumu",renderInventory],products:["Ürünler",renderProducts],warehouses:["Depolar",renderWarehouses],movements:["Hareketler",renderMovements]};
  if (!views[currentView]) currentView="overview";
  const focused=document.activeElement;
  const preserve=focused?.matches?.("#product-search, #inventory-search, #movement-search, #warehouse-search, #warehouse-location-filter, #warehouse-sort, [data-page-size]") ? {id:focused.id,start:focused.selectionStart,end:focused.selectionEnd} : null;
  ensureListPage(currentView);
  $$(".nav-link").forEach(link=>link.classList.toggle("active",link.dataset.view===currentView));
  $("#breadcrumb-current").textContent=views[currentView][0];
  $("#page-content").innerHTML=views[currentView][1]();
  $("#nav-stock-count").textContent=metric("criticalCount");
  updateNotificationIndicator();
  if (!$("#notification-popover").hidden) renderNotificationPopover();
  if (preserve) {const replacement=document.getElementById(preserve.id);replacement?.focus({preventScroll:true});if(replacement?.type==="search")replacement.setSelectionRange(preserve.start,preserve.end);}
}

function renderMovementProductOptions(query="",resetActive=false) {
  const search=$("#movement-product-search"), list=$("#movement-product-options"), p=movementPickerState;
  if(!search||!list)return;
  const selectedId=$("#movement-product")?.value;
  if(resetActive)movementProductActiveIndex=movementProductResults.length?0:-1;
  if(p.loading||p.error){list.innerHTML=`<div class="product-picker-empty" role="status">${p.loading?"Ürünler aranıyor…":esc(p.error)}</div>`;search.removeAttribute("aria-activedescendant");return;}
  list.innerHTML=movementProductResults.map((product,index)=>`<button id="movement-product-option-${index}" class="product-picker-option ${index===movementProductActiveIndex?"is-active":""}" type="button" role="option" aria-selected="${product.id===selectedId}" data-action="select-movement-product" data-product-id="${esc(product.id)}"><span><strong>${esc(product.name)}</strong><small>${esc(product.sku)} · ${esc(product.category||"Genel")}</small></span>${product.id===selectedId?'<span class="product-picker-selected">Seçili</span>':""}</button>`).join("")||'<div class="product-picker-empty" role="status">Aramana uygun ürün bulunamadı.</div>';
  const active=movementProductActiveIndex>=0?document.getElementById(`movement-product-option-${movementProductActiveIndex}`):null;
  if(active)search.setAttribute("aria-activedescendant",active.id);else search.removeAttribute("aria-activedescendant");
}
async function loadMovementProducts(query="",page=1) {
  const p=movementPickerState;
  clearTimeout(p.timer);p.controller?.abort();p.controller=new AbortController();
  const controller=p.controller, request=++p.request;
  p.loading=true;p.error="";movementProductResults=[];movementProductActiveIndex=-1;
  renderMovementProductOptions();
  try{
    const result=await api(`/products?${new URLSearchParams({q:query,page:String(page),pageSize:"20"})}`,{signal:controller.signal});
    if(request!==p.request||!$("#movement-product-panel")||$("#movement-product-panel").hidden)return;
    movementProductResults=result.items.map(normalizeProduct);Object.assign(p,result.pagination);p.loading=false;
    renderMovementProductOptions(query,true);
    $("#movement-product-pagination").innerHTML=`<span>${number(p.total)} ürün · ${p.page}/${p.totalPages}</span><span><button type="button" data-action="picker-page" data-page="${p.page-1}" ${p.page<=1?"disabled":""} aria-label="Önceki ürün sonuçları">‹</button><button type="button" data-action="picker-page" data-page="${p.page+1}" ${p.page>=p.totalPages?"disabled":""} aria-label="Sonraki ürün sonuçları">›</button></span>`;
  }catch(error){if(request!==p.request||controller.signal.aborted)return;p.loading=false;p.error=error.message;renderMovementProductOptions();}
}
function scheduleMovementProductSearch(query){
  const p=movementPickerState;clearTimeout(p.timer);p.controller?.abort();p.request++;p.loading=true;p.error="";movementProductResults=[];movementProductActiveIndex=-1;renderMovementProductOptions();
  $("#movement-product-pagination").textContent="";
  p.timer=setTimeout(()=>void loadMovementProducts(query,1),250);
}

function setMovementProductActive(index) {
  if (!movementProductResults.length) return;
  movementProductActiveIndex = Math.max(0, Math.min(index, movementProductResults.length - 1));
  renderMovementProductOptions($("#movement-product-search").value, false);
  document.getElementById(`movement-product-option-${movementProductActiveIndex}`)?.scrollIntoView({ block: "nearest" });
}

function setMovementProductPickerOpen(open,returnFocus=false) {
  const panel=$("#movement-product-panel"),trigger=$("#movement-product-trigger"),search=$("#movement-product-search");
  if(!panel||!trigger||!search)return;
  panel.hidden=!open;trigger.setAttribute("aria-expanded",String(open));search.setAttribute("aria-expanded",String(open));
  if(open){search.value="";search.focus();void loadMovementProducts();}
  else{clearTimeout(movementPickerState.timer);movementPickerState.controller?.abort();movementPickerState.request++;movementProductResults=[];movementProductActiveIndex=-1;search.removeAttribute("aria-activedescendant");if(returnFocus)trigger.focus();}
}

function selectMovementProduct(productId) {
  const product=movementProductResults.find(p=>p.id===productId)||productById(productId);
  if(!product||product.archived)return;
  state.products=[product,...state.products.filter(p=>p.id!==product.id).slice(0,2)];
  $("#movement-product").value=product.id;
  $("#movement-product-value").innerHTML=`<strong>${esc(product.name)}</strong><small>${esc(product.sku)} · ${esc(product.category||"Genel")}</small>`;
  $("#movement-product-trigger").setAttribute("aria-label",`Seçili ürün: ${product.name}, SKU ${product.sku}. Değiştirmek için aç.`);
  setMovementProductPickerOpen(false,true);updateMovementFields();
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
      <div class="product-picker-options" id="movement-product-options" role="listbox" aria-label="Ürünler"></div><div class="product-picker-pagination" id="movement-product-pagination"></div>
    </div>
  </div>`;
}

function warehouseOptions(selected = "") {
  return activeWarehouses().map((warehouse) => `<option value="${esc(warehouse.id)}" ${selected === warehouse.id ? "selected" : ""}>${esc(warehouse.name)}</option>`).join("");
}

async function openModal(kind, presets = {}) {
  const request=++modalRequest;
  let selectedForMovement;
  if(kind==="movement"){
    if(!metric("productCount")||!activeWarehouses().length){showToast("Önce en az bir ürün ve depo ekle.");return;}
    const selected=presets.productId?await api(`/products/${encodeURIComponent(presets.productId)}`):(await api("/products?pageSize=1")).items[0];
    if(request!==modalRequest||!selected)return;
    selectedForMovement=normalizeProduct(selected);
    state.products=[selectedForMovement,...state.products.filter(p=>p.id!==selectedForMovement.id).slice(0,2)];
  }
  const root = $("#modal-root");
  if (kind === "product") {
    root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">Yeni ürün ekle</h2><p>Ürün kataloğuna yeni bir kayıt oluştur.</p></div><button class="modal-close" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header><form class="modal-form" id="product-form"><div class="form-grid"><div class="form-field"><label for="product-sku">SKU / Ürün kodu</label><input id="product-sku" name="sku" maxlength="40" placeholder="Örn. KBL-1042" required></div><div class="form-field"><label for="product-name">Ürün adı</label><input id="product-name" name="name" maxlength="100" placeholder="Ürün adını yaz" required></div><div class="form-field"><label for="product-category">Kategori</label><input id="product-category" name="category" maxlength="50" placeholder="Örn. Elektronik" value="Genel"></div><div class="form-field"><label for="product-unit">Birim</label><select id="product-unit" name="unit"><option>adet</option><option>kutu</option><option>paket</option><option>rulo</option><option>kg</option><option>litre</option></select></div><div class="form-field"><label for="product-minimum">Minimum stok</label><input id="product-minimum" name="minimum" type="number" min="0" step="1" value="5" required></div><div class="form-field"><label for="product-cost">Birim maliyet (₺)</label><input id="product-cost" name="cost" type="number" min="0" step="1" value="0"></div></div><div class="form-error" id="form-error"></div><div class="modal-actions"><button type="button" class="button" data-action="close-modal">Vazgeç</button><button class="button button-primary" type="submit">Ürünü kaydet</button></div></form></section></div>`;
  } else if (kind === "warehouse") {
    root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">Yeni depo ekle</h2><p>Stoklarını takip edeceğin bir konum oluştur.</p></div><button class="modal-close" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header><form class="modal-form" id="warehouse-form"><div class="form-grid"><div class="form-field"><label for="warehouse-code">Depo kodu</label><input id="warehouse-code" name="code" maxlength="20" placeholder="Örn. IST-01" required></div><div class="form-field"><label for="warehouse-name">Depo adı</label><input id="warehouse-name" name="name" maxlength="80" placeholder="Örn. İstanbul Deposu" required></div><div class="form-field full"><label for="warehouse-location">Konum (şehir / ilçe)</label><input id="warehouse-location" name="location" maxlength="160" placeholder="Örn. İstanbul / Esenyurt"><span class="field-hint">Depolarını bu konuma göre filtreleyebilirsin.</span></div><div class="form-field full"><label for="warehouse-address">Adres</label><input id="warehouse-address" name="address" maxlength="500" placeholder="İlçe, şehir"></div></div><div class="form-error" id="form-error"></div><div class="modal-actions"><button type="button" class="button" data-action="close-modal">Vazgeç</button><button class="button button-primary" type="submit">Depoyu kaydet</button></div></form></section></div>`;
  } else if (kind === "movement") {
    if (!selectedForMovement || !activeWarehouses().length) {
      showToast("Önce en az bir ürün ve depo ekle.");
      return;
    }
    const selectedProduct = selectedForMovement.id;
    const selectedWarehouse = presets.warehouseId || activeWarehouses()[0].id;
    root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">Stok işlemi oluştur</h2><p>Giriş, çıkış, sayım düzeltmesi veya depo transferi.</p></div><button class="modal-close" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header><form class="modal-form" id="movement-form"><div class="form-grid"><div class="form-field full"><label for="movement-type">İşlem türü</label><select id="movement-type" name="type"><option value="INBOUND">Stok girişi</option><option value="OUTBOUND">Stok çıkışı</option><option value="ADJUSTMENT">Sayım düzeltmesi</option><option value="TRANSFER">Depolar arası transfer</option></select></div><div class="form-field full"><label for="movement-product-trigger">Ürün</label>${movementProductPicker(selectedProduct)}</div><div class="form-field full" id="single-warehouse-field"><label for="movement-warehouse">Depo</label><select id="movement-warehouse" name="warehouseId">${warehouseOptions(selectedWarehouse)}</select></div><div class="form-field" id="source-warehouse-field" hidden><label for="movement-source">Kaynak depo</label><select id="movement-source" name="sourceWarehouseId">${warehouseOptions(selectedWarehouse)}</select></div><div class="form-field" id="target-warehouse-field" hidden><label for="movement-target">Hedef depo</label><select id="movement-target" name="targetWarehouseId">${warehouseOptions(activeWarehouses().find((item) => item.id !== selectedWarehouse)?.id || "")}</select></div><div class="form-field full"><label for="movement-quantity" id="movement-quantity-label">Miktar</label><input id="movement-quantity" name="quantity" type="number" min="1" step="1" value="1" required><span class="field-hint" id="movement-hint">${esc(productById(selectedProduct)?.unit || "adet")} cinsinden miktar gir.</span></div><div class="form-field full"><label for="movement-note">Açıklama <span style="font-weight:400;color:#9aa39c">(isteğe bağlı)</span></label><input id="movement-note" name="note" maxlength="120" placeholder="Örn. Tedarikçi teslimatı"></div></div><div class="form-error" id="form-error"></div><div class="modal-actions"><button type="button" class="button" data-action="close-modal">Vazgeç</button><button class="button button-primary" type="submit">İşlemi kaydet</button></div></form></section></div>`;
    updateMovementFields();
  }
  beginModal();
  const firstInput = $("input:not([type=hidden]), select", root);
  firstInput?.focus();
}

function openProductEditor(productId) {
  const product = productById(productId);
  if (!product) return;
  const units = ["adet", "kutu", "paket", "rulo", "kg", "litre"];
  $("#modal-root").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">Ürünü düzenle</h2><p>Ürün bilgilerini güncelle.</p></div><button class="modal-close" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header><form class="modal-form" id="product-form" data-product-id="${esc(product.id)}"><div class="form-grid"><div class="form-field"><label for="product-sku">SKU / Ürün kodu</label><input id="product-sku" name="sku" maxlength="40" value="${esc(product.sku)}" required></div><div class="form-field"><label for="product-name">Ürün adı</label><input id="product-name" name="name" maxlength="100" value="${esc(product.name)}" required></div><div class="form-field"><label for="product-category">Kategori</label><input id="product-category" name="category" maxlength="50" value="${esc(product.category || "Genel")}"></div><div class="form-field"><label for="product-unit">Birim</label><select id="product-unit" name="unit">${units.map((unit) => `<option ${unit === product.unit ? "selected" : ""}>${unit}</option>`).join("")}</select></div><div class="form-field"><label for="product-minimum">Minimum stok</label><input id="product-minimum" name="minimum" type="number" min="0" step="1" value="${esc(product.minimum)}" required></div><div class="form-field"><label for="product-cost">Birim maliyet (₺)</label><input id="product-cost" name="cost" type="number" min="0" step="1" value="${esc(product.cost || 0)}"></div></div><div class="form-error" id="form-error"></div><div class="modal-actions"><button type="button" class="button" data-action="close-modal">Vazgeç</button><button class="button button-primary" type="submit">Değişiklikleri kaydet</button></div></form></section></div>`;
  beginModal();
  $("#product-sku").focus();
}

function openWarehouseEditor(warehouseId) {
  const warehouse = warehouseById(warehouseId);
  if (!warehouse) return;
  $("#modal-root").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">Depoyu düzenle</h2><p>Depo konum bilgilerini güncelle.</p></div><button class="modal-close" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header><form class="modal-form" id="warehouse-form" data-warehouse-id="${esc(warehouse.id)}"><div class="form-grid"><div class="form-field"><label for="warehouse-code">Depo kodu</label><input id="warehouse-code" name="code" maxlength="20" value="${esc(warehouse.code)}" required></div><div class="form-field"><label for="warehouse-name">Depo adı</label><input id="warehouse-name" name="name" maxlength="80" value="${esc(warehouse.name)}" required></div><div class="form-field full"><label for="warehouse-location">Konum (şehir / ilçe)</label><input id="warehouse-location" name="location" maxlength="160" placeholder="Örn. İstanbul / Esenyurt" value="${esc(warehouse.location || "")}"><span class="field-hint">Konum boşsa filtrelerde mevcut adres kullanılır.</span></div><div class="form-field full"><label for="warehouse-address">Adres</label><input id="warehouse-address" name="address" maxlength="500" value="${esc(warehouse.address || "")}"></div></div><div class="form-error" id="form-error"></div><div class="modal-actions"><button type="button" class="button" data-action="close-modal">Vazgeç</button><button class="button button-primary" type="submit">Değişiklikleri kaydet</button></div></form></section></div>`;
  beginModal();
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

function showToast(message, action = null) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  if (action) { const button = document.createElement("button"); button.type = "button"; button.textContent = action.label; button.addEventListener("click", () => { action.run(); toast.remove(); }); toast.append(button); }
  $("#toast-region").append(toast);
  setTimeout(() => toast.remove(), action ? 8000 : 4000);
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
  closeModal();
  render();
  showToast(productId ? "Ürün bilgileri güncellendi." : "Ürün envantere eklendi.");
}

async function saveWarehouse(form) {
  const data = new FormData(form);
  const code = String(data.get("code")).trim().toLocaleUpperCase("tr-TR");
  const warehouseId = form.dataset.warehouseId;
  const fields = { code, location:String(data.get("location")||"").trim()||null, name: String(data.get("name")).trim(), address: String(data.get("address") || "").trim() };
  await api(warehouseId ? `/warehouses/${encodeURIComponent(warehouseId)}` : "/warehouses", {
    method: warehouseId ? "PATCH" : "POST", body: JSON.stringify(fields),
  });
  await refreshState();
  closeModal();
  render();
  showToast(warehouseId ? "Depo bilgileri güncellendi." : "Yeni depo oluşturuldu.");
}

function confirmArchive(kind, id) {
  const item = kind === "product" ? productById(id) : warehouseById(id);
  if (!item) return;
  const hasStock = kind === "product" ? sumStock(item) > 0 : Number(item.count) > 0;
  if (hasStock) { showToast("Arşivlemeden önce bu kayıttaki stokları aktar veya sıfırla."); return; }
  $("#modal-root").innerHTML = '<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">' + (kind === "product" ? "Ürünü" : "Depoyu") + ' arşivle</h2><p>' + esc(item.name) + '</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Kapat">' + icon("close") + '</button></header><div class="modal-form"><p class="archive-explanation">Kayıt ve hareket geçmişi korunur. Arşivlenen kayıt yeni stok işlemlerinde görünmez. İstediğinde Arşivdekiler bölümünden geri alabilirsin.</p><p class="filter-error" id="archive-error" role="alert"></p><div class="modal-actions"><button class="button" type="button" data-action="close-modal">Vazgeç</button><button class="button button-primary" type="button" data-action="confirm-archive" data-kind="' + kind + '" data-id="' + esc(id) + '">Arşivle</button></div></div></section></div>';
  beginModal();
  $("#modal-root [data-action='confirm-archive']").focus();
}

async function toggleProductArchive(productId, desiredArchived) {
  const product=normalizeProduct(await api(`/products/${encodeURIComponent(productId)}`));
  const archived=desiredArchived ?? !product.archived;
  if(archived===product.archived)return;
  if(archived&&sumStock(product)>0){showToast("Arşivlemeden önce ürünün tüm depolardaki stokunu sıfırla.");return;}
  await api(`/products/${encodeURIComponent(productId)}`,{method:"PATCH",body:JSON.stringify({archived})});
  await refreshState();
  if(archived&&!showArchivedProducts&&currentSearch&&!filteredProducts().length){currentSearch="";$("#global-search").value="";invalidateList("products",true);}
  render();
  showToast(archived?"Ürün arşivlendi. Diğer ürünler korunuyor.":"Ürün yeniden etkinleştirildi.",archived?{label:"Geri al",run:()=>void toggleProductArchive(productId,false).catch(error=>showToast(error.message))}:null);
}

async function toggleWarehouseArchive(warehouseId) {
  const warehouse = warehouseById(warehouseId);
  if (!warehouse) return;
  if (!warehouse.archived && Number(warehouse.count) > 0) {
    showToast("Arşivlemeden önce bu depodaki stokları başka depoya aktar veya çıkış yap.");
    return;
  }
  const archived = !warehouse.archived;
  await api(`/warehouses/${encodeURIComponent(warehouseId)}`, { method: "PATCH", body: JSON.stringify({ archived }) });
  await refreshState();
  if (archived) for (const filters of Object.values(stockFilters)) if (filters.warehouse === warehouseId) filters.warehouse = "all";
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
  closeModal();
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
  const view=["products","inventory","movements"].includes(currentView)?currentView:"inventory";
  const params=listPages[currentView]?listParams(view):new URLSearchParams();params.delete("page");params.delete("pageSize");params.set("view",view);
  const link=document.createElement("a");link.href=`${API_BASE_URL}/api/export?${params}`;link.download=`stokpilot-${view}.csv`;link.click();
  showToast("Filtrelere uyan tüm kayıtlar CSV olarak indiriliyor.");
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
  beginModal();
  $("#help-title").focus();
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".popover-anchor")) closeTopbarPopovers();
  if (!event.target.closest("#movement-product-picker")) setMovementProductPickerOpen(false);
  if (event.target.closest("#demo-login-button")) { void submitDemoLogin(); return; }
  const viewLink = event.target.closest("[data-view]");
  if (viewLink) {
    event.preventDefault();
    if (viewLink.closest("#modal-root")) closeModal();
    setView(viewLink.dataset.view);
    return;
  }
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;
  const { action } = actionElement.dataset;
  if(action==="go-page"){const p=listPages[currentView];const target=Number(actionElement.dataset.page);if(p&&!p.loading&&Number.isInteger(target)&&target>=1&&target<=p.totalPages){p.page=target;p.focusAfterLoad=actionElement.closest(".movement-pagination-top")?"movement-top":"page";reloadList({reset:false});}return;}
  if(action==="clear-warehouse-filters"){warehouseFilters.location=null;warehouseFilters.sort="name";currentSearch="";$("#global-search").value="";reloadList();$("#warehouse-search")?.focus();return;}
  if(action==="retry-list"){reloadList({reset:false});return;}
  if(action==="picker-page"){void loadMovementProducts($("#movement-product-search").value,Number(actionElement.dataset.page));return;}
  if (action === "clear-page-search") {
    currentSearch = "";
    $("#global-search").value = "";
    const searchId = currentView === "products" ? "#product-search" : currentView === "inventory" ? "#inventory-search" : currentView === "warehouses" ? "#warehouse-search" : "#movement-search";
    reloadList();
    $(searchId)?.focus();
    return;
  }
  if (action === "toggle-movement-product-picker") { setMovementProductPickerOpen(Boolean($("#movement-product-panel")?.hidden), true); return; }
  if (action === "select-movement-product") { selectMovementProduct(actionElement.dataset.productId); return; }
  if (action === "open-stock-alert") { openStockAlerts(actionElement.dataset.productId); return; }
  if (action === "show-stock-alerts") { openStockAlerts(); return; }
  if (action === "filter-stock-status") { stockFilters[currentView].status = actionElement.dataset.status; reloadList(); return; }
  if (action === "clear-stock-filters") { resetStockFilters(); reloadList(); return; }
  if (action === "clear-stock-product") { stockFilters[currentView].productId = ""; reloadList(); return; }
  if (action === "confirm-archive") {
    actionElement.disabled = true;
    const operation = actionElement.dataset.kind === "product" ? toggleProductArchive : toggleWarehouseArchive;
    void operation(actionElement.dataset.id).then(() => closeModal()).catch((problem) => { const error = $("#archive-error"); if (error) error.textContent = problem.message; actionElement.disabled = false; });
    return;
  }
  if (action === "toggle-notifications") { toggleTopbarPopover("notifications"); return; }
  if (action === "toggle-profile") { toggleTopbarPopover("profile"); return; }
  if (action === "logout") { logout(); return; }
  if (action === "open-product") launchModal("product");
  if (action === "edit-product") openProductEditor(actionElement.dataset.productId);
  if (action === "toggle-product-archive") {
    const product = productById(actionElement.dataset.productId);
    if (product?.archived) void toggleProductArchive(actionElement.dataset.productId).catch((problem) => showToast(problem.message || "Ürün güncellenemedi."));
    else confirmArchive("product", actionElement.dataset.productId);
  }
  if (action === "open-warehouse") launchModal("warehouse");
  if (action === "edit-warehouse") openWarehouseEditor(actionElement.dataset.warehouseId);
  if (action === "toggle-warehouse-archive") {
    const warehouse = warehouseById(actionElement.dataset.warehouseId);
    if (warehouse?.archived) void toggleWarehouseArchive(actionElement.dataset.warehouseId).catch((problem) => showToast(problem.message || "Depo güncellenemedi."));
    else confirmArchive("warehouse", actionElement.dataset.warehouseId);
  }
  if (action === "toggle-archived-products") { showArchivedProducts = !showArchivedProducts; currentSearch = ""; $("#global-search").value=""; reloadList(); }
  if (action === "toggle-archived-warehouses") { showArchivedWarehouses = !showArchivedWarehouses; currentSearch="";$("#global-search").value="";reloadList(); }
  if (action === "open-movement") launchModal("movement", { productId: actionElement.dataset.productId, warehouseId: actionElement.dataset.warehouseId });
  if (action === "export-csv") exportCsv();
  if (action === "show-help") showHelp();
  if (action === "close-modal" && (actionElement === event.target || actionElement.closest(".modal"))) closeModal();
});

document.addEventListener("submit", (event) => {
  if (event.target.matches("#stock-filter-form")) { event.preventDefault(); applyStockFilters(event.target); return; }
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
  if(event.target.matches("#warehouse-location-filter")){warehouseFilters.location=event.target.value==="all"?null:event.target.value.slice("location:".length);reloadList();return;}
  if(event.target.matches("#warehouse-sort")){warehouseFilters.sort=event.target.value;reloadList();return;}
  if(event.target.matches("[data-page-size]")){listPages[currentView].pageSize=Number(event.target.value);listPages[currentView].focusAfterLoad="size";reloadList();return;}
  if (event.target.matches("#movement-type, #movement-product")) updateMovementFields();
  if (event.target.matches("#warehouse-filter")) { stockFilters[currentView].warehouse = event.target.value; reloadList(); }
  if (event.target.matches("#stock-sort")) { stockFilters[currentView].sort = event.target.value; reloadList(); }
  if (event.target.matches("#movement-filter")) { movementTypeFilter = event.target.value; reloadList(); }
});

document.addEventListener("input", (event) => {
  if(event.target.matches("#movement-product-search")){scheduleMovementProductSearch(event.target.value);return;}
  if(event.target.matches("#global-search, #product-search, #inventory-search, #movement-search, #warehouse-search")){
    currentSearch=event.target.value;$("#global-search").value=currentSearch;
    if(currentView === "overview"){currentView="products";location.hash="products";$("#sidebar").classList.remove("open");}
    reloadList({delay:250});
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
  if (modalContext && event.key === "Tab") {
    const modal = $("#modal-root .modal");
    const focusable = $$("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex='0']", modal).filter((element) => !element.closest("[hidden]") && element.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
  }
  if (event.key === "Escape") {
    closeModal();
    $("#sidebar").classList.remove("open");
    closeTopbarPopovers();
  }
  if (!modalContext && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $("#global-search").focus();
  }
});
window.addEventListener("hashchange", () => { const view = location.hash.slice(1) || "overview"; if (view !== currentView) { currentSearch = ""; $("#global-search").value = ""; closeModal(); } currentView = view; render(); });

void initializeAuth();
