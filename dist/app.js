const STORAGE_KEY = "stokpilot-demo-v1";
const today = new Date();
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function daysAgo(days, hour = 10) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 15, 0, 0);
  return date.toISOString();
}

function seedState() {
  const warehouses = [
    { id: "wh-main", code: "MRK-01", name: "Merkez Depo", address: "Kadıköy, İstanbul" },
    { id: "wh-ankara", code: "ANK-02", name: "Ankara Deposu", address: "Çankaya, Ankara" },
    { id: "wh-izmir", code: "IZM-03", name: "İzmir Deposu", address: "Bornova, İzmir" },
  ];
  const rows = [
    ["MON-2401", "24\" Ofis Monitörü", "Elektronik", "adet", 5, 4890, 8, 5, 5, "◉"],
    ["KLV-1042", "Mekanik Klavye", "Aksesuar", "adet", 10, 1840, 2, 2, 3, "⌨"],
    ["SAN-8830", "Ergonomik Çalışma Sandalyesi", "Mobilya", "adet", 6, 7250, 1, 2, 2, "▤"],
    ["STA-2300", "Alüminyum Laptop Standı", "Aksesuar", "adet", 4, 620, 10, 8, 4, "▱"],
    ["ETK-5521", "Termal Etiket Rulosu", "Paketleme", "rulo", 20, 185, 5, 4, 7, "▤"],
    ["HUB-0903", "USB-C Çoklayıcı", "Elektronik", "adet", 5, 1120, 4, 5, 0, "⎓"],
    ["KBL-1109", "Ethernet Kablosu 3 m", "Kablo", "adet", 15, 95, 12, 18, 12, "⌁"],
    ["FARE-3208", "Kablosuz Mouse", "Aksesuar", "adet", 10, 540, 2, 3, 3, "◉"],
    ["KUT-0034", "Kargo Kutusu — Orta", "Paketleme", "adet", 30, 28, 6, 3, 4, "□"],
    ["BNT-4120", "Güçlü Paketleme Bandı", "Paketleme", "adet", 25, 48, 16, 20, 14, "▥"],
    ["YAZ-8021", "Termal Barkod Yazıcı", "Elektronik", "adet", 3, 3650, 2, 1, 1, "▣"],
    ["SSD-1000", "Taşınabilir SSD 1 TB", "Elektronik", "adet", 6, 2780, 0, 0, 0, "▰"],
  ];
  const products = rows.map((row, index) => ({
    id: `product-${index + 1}`,
    sku: row[0], name: row[1], category: row[2], unit: row[3], minimum: row[4], cost: row[5],
    stock: { [warehouses[0].id]: row[6], [warehouses[1].id]: row[7], [warehouses[2].id]: row[8] },
    symbol: row[9],
  }));
  const movements = [
    { id: makeId(), type: "INBOUND", productId: "product-1", warehouseId: "wh-main", delta: 12, note: "Tedarikçi teslimatı", at: daysAgo(0, 9) },
    { id: makeId(), type: "OUTBOUND", productId: "product-2", warehouseId: "wh-ankara", delta: -3, note: "Ofis kullanımı", at: daysAgo(0, 8) },
    { id: makeId(), type: "TRANSFER_IN", productId: "product-7", warehouseId: "wh-izmir", delta: 8, note: "Merkez depodan aktarım", at: daysAgo(1, 16) },
    { id: makeId(), type: "TRANSFER_OUT", productId: "product-7", warehouseId: "wh-main", delta: -8, note: "İzmir deposuna aktarım", at: daysAgo(1, 16) },
    { id: makeId(), type: "ADJUSTMENT", productId: "product-5", warehouseId: "wh-main", delta: -2, note: "Haftalık sayım", at: daysAgo(2, 14) },
    { id: makeId(), type: "INBOUND", productId: "product-10", warehouseId: "wh-ankara", delta: 20, note: "Yeni stok girişi", at: daysAgo(3, 11) },
  ];
  return { warehouses, products, movements };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.products) && Array.isArray(parsed.warehouses) && Array.isArray(parsed.movements)) return parsed;
    }
  } catch (error) {
    console.warn("Demo kaydı okunamadı, örnek veriler yüklendi.", error);
  }
  return seedState();
}

let state = loadState();
let currentView = location.hash.slice(1) || "overview";
let currentSearch = "";
let inventoryWarehouseFilter = "all";
let movementTypeFilter = "all";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const sumStock = (product) => Object.values(product.stock || {}).reduce((total, amount) => total + Number(amount || 0), 0);
const money = (amount) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(amount);
const number = (amount) => new Intl.NumberFormat("tr-TR").format(amount);
const dateShort = (value) => new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(new Date(value));
const dateTime = (value) => new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const statusOf = (product) => sumStock(product) === 0 ? "empty" : sumStock(product) <= Number(product.minimum) ? "low" : "ok";
const productById = (id) => state.products.find((product) => product.id === id);
const warehouseById = (id) => state.warehouses.find((warehouse) => warehouse.id === id);

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    showToast("Tarayıcı depolaması kullanılamadı; değişiklikler bu oturumda kalır.");
  }
}

function setView(view) {
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

function statusPill(product) {
  const status = statusOf(product);
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
  const totalUnits = state.products.reduce((total, product) => total + sumStock(product), 0);
  const stockValue = state.products.reduce((total, product) => total + sumStock(product) * Number(product.cost || 0), 0);
  const lowProducts = state.products.filter((product) => statusOf(product) !== "ok");
  const critical = lowProducts.slice(0, 4);
  const warehouseTotals = state.warehouses.map((warehouse) => ({
    ...warehouse,
    count: state.products.reduce((total, product) => total + Number(product.stock?.[warehouse.id] || 0), 0),
    products: state.products.filter((product) => Number(product.stock?.[warehouse.id] || 0) > 0).length,
  }));
  const maxWarehouseStock = Math.max(1, ...warehouseTotals.map((warehouse) => warehouse.count));
  const day = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(today);
  const actions = `<button class="button" data-action="export-csv">${icon("download")} Dışa aktar</button><button class="button button-primary" data-action="open-movement">${icon("plus")} Stok işlemi</button>`;
  return `${pageHeading(day, "Genel bakış", "Depolarındaki ürün ve stok durumunu tek ekranda gör.", actions)}
    <div class="metrics-grid">
      ${metricCard("Ürün çeşidi", number(state.products.length), "SKU", `<em>envanterinde</em> kayıtlı`, "box")}
      ${metricCard("Toplam stok", number(totalUnits), "adet", `${state.warehouses.length} farklı depoda`, "arrows", "blue")}
      ${metricCard("Stok değeri", money(stockValue), "tahmini", "Birim maliyet üzerinden hesaplandı", "trend", "amber")}
      ${metricCard("Kritik ürün", number(lowProducts.length), "ürün", `<em>${state.products.filter((product) => sumStock(product) === 0).length} ürün</em> tamamen tükendi`, "alert", "red")}
    </div>
    <div class="dashboard-grid">
      <section class="panel"><header class="panel-header"><div><h2 class="panel-title">Depolara göre stok</h2><p class="panel-subtitle">Tüm depolardaki toplam ürün adedi</p></div><button class="subtle-link" data-view="warehouses">Depoları gör →</button></header>
        <div class="stock-distribution"><div class="warehouse-bars">${warehouseTotals.map((warehouse) => `<div class="warehouse-bar-row"><div class="warehouse-label"><strong>${esc(warehouse.name)}</strong><small>${warehouse.products} ürün çeşidi</small></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, warehouse.count / maxWarehouseStock * 100)}%"></div></div><div class="bar-amount">${number(warehouse.count)}</div></div>`).join("")}</div><div class="panel-foot"><i class="status-dot"></i> Stok bakiyeleri güncel <span style="margin-left:auto">${state.warehouses.length} aktif depo</span></div></div>
      </section>
      <section class="panel"><header class="panel-header"><div><h2 class="panel-title">Dikkat gerektirenler</h2><p class="panel-subtitle">Minimum stok seviyesinin altındakiler</p></div><button class="subtle-link" data-view="inventory">Tümünü gör →</button></header>
        <div class="low-list">${critical.length ? critical.map((product) => `<div class="low-item">${productVisual(product)}<div class="low-item-main"><strong>${esc(product.name)}</strong><small>${esc(product.sku)} · Min. ${number(product.minimum)} ${esc(product.unit)}</small></div><span class="stock-alert ${statusOf(product) === "empty" ? "empty" : ""}">${sumStock(product) === 0 ? "Tükendi" : `${number(sumStock(product))} kaldı`}</span></div>`).join("") : `<div class="empty-state"><strong>Harika, kritik stok yok.</strong>Stok seviyelerin kontrol altında.</div>`}</div>
      </section>
    </div>
    <section class="panel table-panel"><header class="panel-header"><div><h2 class="panel-title">Son stok hareketleri</h2><p class="panel-subtitle">Depolarında gerçekleşen son işlemler</p></div><button class="subtle-link" data-view="movements">Hareket geçmişi →</button></header>${recentMovementTable(getRecentMovements(5))}</section>`;
}

function filteredProducts() {
  const query = currentSearch.toLocaleLowerCase("tr-TR");
  return state.products.filter((product) => !query || [product.name, product.sku, product.category].some((value) => String(value || "").toLocaleLowerCase("tr-TR").includes(query)));
}

function productRows(products) {
  if (!products.length) return `<tr><td colspan="7"><div class="empty-state"><strong>Ürün bulunamadı</strong>Arama kelimeni değiştirebilir veya yeni ürün ekleyebilirsin.</div></td></tr>`;
  return products.map((product) => {
    const stock = sumStock(product);
    const status = statusOf(product);
    const meterWidth = product.minimum > 0 ? Math.min(100, stock / (product.minimum * 2) * 100) : stock > 0 ? 100 : 0;
    return `<tr><td><div class="product-cell">${productVisual(product)}<span class="product-name"><strong>${esc(product.name)}</strong><small>${esc(product.category || "Genel")}</small></span></div></td><td><span class="sku-code">${esc(product.sku)}</span></td><td><div class="stock-cell"><div class="stock-cell-top"><b>${number(stock)} ${esc(product.unit)}</b><span>Min. ${number(product.minimum)}</span></div><div class="stock-meter"><span class="${status}" style="width:${meterWidth}%"></span></div></div></td><td>${money(stock * Number(product.cost || 0))}</td><td>${statusPill(product)}</td><td><button class="button button-small" data-action="open-movement" data-product-id="${esc(product.id)}">Stok işlemi</button></td></tr>`;
  }).join("");
}

function renderProducts() {
  const actions = `<button class="button" data-action="export-csv">${icon("download")} CSV indir</button><button class="button button-primary" data-action="open-product">${icon("plus")} Yeni ürün</button>`;
  return `${pageHeading("ENVANTER", "Ürünler", "Ürün kataloğunu ve toplam stok seviyelerini yönet.", actions)}
    <div class="page-toolbar"><div class="page-toolbar-left"><input class="table-search" id="product-search" type="search" placeholder="Ürün adı, SKU veya kategori ara..." value="${esc(currentSearch)}"><span class="table-count">${state.products.length} ürün</span></div><div class="page-toolbar-right"><button class="button button-small" data-action="open-warehouse">${icon("plus")} Depo ekle</button></div></div>
    <section class="panel table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>ÜRÜN</th><th>SKU</th><th>TOPLAM STOK</th><th>STOK DEĞERİ</th><th>DURUM</th><th></th></tr></thead><tbody>${productRows(filteredProducts())}</tbody></table></div></section>`;
}

function inventoryRows() {
  const query = currentSearch.toLocaleLowerCase("tr-TR");
  const rows = [];
  for (const product of state.products) {
    const matches = !query || [product.name, product.sku, product.category].some((value) => String(value || "").toLocaleLowerCase("tr-TR").includes(query));
    if (!matches) continue;
    for (const warehouse of state.warehouses) {
      if (inventoryWarehouseFilter !== "all" && inventoryWarehouseFilter !== warehouse.id) continue;
      rows.push({ product, warehouse, quantity: Number(product.stock?.[warehouse.id] || 0) });
    }
  }
  return rows;
}

function renderInventory() {
  const rows = inventoryRows();
  const body = rows.length ? rows.map(({ product, warehouse, quantity }) => {
    const total = sumStock(product);
    const productStatus = statusOf(product);
    return `<tr><td><div class="product-cell">${productVisual(product)}<span class="product-name"><strong>${esc(product.name)}</strong><small>${esc(product.sku)}</small></span></div></td><td><span class="warehouse-mini"><span class="warehouse-dot">${esc(warehouse.code.slice(0, 2))}</span>${esc(warehouse.name)}</span></td><td><b class="qty-cell ${quantity === 0 ? "empty" : quantity <= product.minimum ? "low" : ""}">${number(quantity)} ${esc(product.unit)}</b></td><td>${number(product.minimum)} ${esc(product.unit)}</td><td>${statusPill({ ...product, stock: { total: total } })}</td><td><button class="button button-small" data-action="open-movement" data-product-id="${esc(product.id)}" data-warehouse-id="${esc(warehouse.id)}">İşlem ekle</button></td></tr>`;
  }).join("") : `<tr><td colspan="6"><div class="empty-state"><strong>Sonuç bulunamadı</strong>Seçili filtrelere uygun stok kaydı yok.</div></td></tr>`;
  const warehouseOptions = state.warehouses.map((warehouse) => `<option value="${esc(warehouse.id)}" ${inventoryWarehouseFilter === warehouse.id ? "selected" : ""}>${esc(warehouse.name)}</option>`).join("");
  const actions = `<button class="button" data-action="export-csv">${icon("download")} CSV indir</button><button class="button button-primary" data-action="open-movement">${icon("plus")} Stok işlemi</button>`;
  return `${pageHeading("ENVANTER", "Stok durumu", "Ürün bakiyelerini depo bazında incele ve güncelle.", actions)}
    <div class="page-toolbar"><div class="page-toolbar-left"><input class="table-search" id="inventory-search" type="search" placeholder="Ürün veya SKU ara..." value="${esc(currentSearch)}"><select class="filter-control" id="warehouse-filter"><option value="all">Tüm depolar</option>${warehouseOptions}</select></div><div class="page-toolbar-right"><span class="table-count">${rows.length} stok satırı</span></div></div>
    <section class="panel table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>ÜRÜN</th><th>DEPO</th><th>MEVCUT</th><th>MİNİMUM</th><th>GENEL DURUM</th><th></th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function renderWarehouses() {
  const cards = state.warehouses.map((warehouse) => {
    const total = state.products.reduce((sum, product) => sum + Number(product.stock?.[warehouse.id] || 0), 0);
    const productCount = state.products.filter((product) => Number(product.stock?.[warehouse.id] || 0) > 0).length;
    const lowCount = state.products.filter((product) => Number(product.stock?.[warehouse.id] || 0) > 0 && Number(product.stock?.[warehouse.id]) <= Number(product.minimum)).length;
    return `<article class="warehouse-card"><div class="warehouse-card-top"><span class="warehouse-card-icon">${icon("warehouse")}</span><span class="warehouse-code">${esc(warehouse.code)}</span></div><h3>${esc(warehouse.name)}</h3><p>${esc(warehouse.address || "Adres eklenmemiş")}</p><div class="warehouse-card-stats"><span><strong>${number(total)}</strong>Toplam adet</span><span><strong>${number(productCount)}</strong>Ürün çeşidi</span><span><strong>${number(lowCount)}</strong>Kritik stok</span></div><div class="panel-foot"><i class="status-dot"></i> Aktif depo</div></article>`;
  }).join("");
  const actions = `<button class="button button-primary" data-action="open-warehouse">${icon("plus")} Yeni depo</button>`;
  return `${pageHeading("LOKASYONLAR", "Depolar", "Depo konumlarını ve her birindeki ürün dağılımını görüntüle.", actions)}<div class="warehouse-card-grid">${cards || `<section class="panel empty-state"><strong>Henüz depo eklenmedi</strong>İlk depoyu ekleyerek envanterini düzenlemeye başlayabilirsin.</section>`}</div>`;
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
    <div class="page-toolbar"><div class="page-toolbar-left"><input class="table-search" id="movement-search" type="search" placeholder="Ürün, depo veya not ara..." value="${esc(currentSearch)}"><select class="filter-control" id="movement-filter">${types.map(([value, label]) => `<option value="${value}" ${movementTypeFilter === value ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="page-toolbar-right"><span class="table-count">${movements.length} hareket</span></div></div>
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
  $("#nav-stock-count").textContent = state.products.filter((product) => statusOf(product) !== "ok").length;
}

function productOptions(selected = "") {
  return state.products.map((product) => `<option value="${esc(product.id)}" ${selected === product.id ? "selected" : ""}>${esc(product.name)} · ${esc(product.sku)}</option>`).join("");
}

function warehouseOptions(selected = "") {
  return state.warehouses.map((warehouse) => `<option value="${esc(warehouse.id)}" ${selected === warehouse.id ? "selected" : ""}>${esc(warehouse.name)}</option>`).join("");
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
    root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">Stok işlemi oluştur</h2><p>Giriş, çıkış, sayım düzeltmesi veya depo transferi.</p></div><button class="modal-close" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header><form class="modal-form" id="movement-form"><div class="form-grid"><div class="form-field full"><label for="movement-type">İşlem türü</label><select id="movement-type" name="type"><option value="INBOUND">Stok girişi</option><option value="OUTBOUND">Stok çıkışı</option><option value="ADJUSTMENT">Sayım düzeltmesi</option><option value="TRANSFER">Depolar arası transfer</option></select></div><div class="form-field full"><label for="movement-product">Ürün</label><select id="movement-product" name="productId">${productOptions(selectedProduct)}</select></div><div class="form-field full" id="single-warehouse-field"><label for="movement-warehouse">Depo</label><select id="movement-warehouse" name="warehouseId">${warehouseOptions(selectedWarehouse)}</select></div><div class="form-field" id="source-warehouse-field" hidden><label for="movement-source">Kaynak depo</label><select id="movement-source" name="sourceWarehouseId">${warehouseOptions(selectedWarehouse)}</select></div><div class="form-field" id="target-warehouse-field" hidden><label for="movement-target">Hedef depo</label><select id="movement-target" name="targetWarehouseId">${warehouseOptions(state.warehouses.find((item) => item.id !== selectedWarehouse)?.id || "")}</select></div><div class="form-field full"><label for="movement-quantity" id="movement-quantity-label">Miktar</label><input id="movement-quantity" name="quantity" type="number" min="1" step="1" value="1" required><span class="field-hint" id="movement-hint">${esc(productById(selectedProduct)?.unit || "adet")} cinsinden miktar gir.</span></div><div class="form-field full"><label for="movement-note">Açıklama <span style="font-weight:400;color:#9aa39c">(isteğe bağlı)</span></label><input id="movement-note" name="note" maxlength="120" placeholder="Örn. Tedarikçi teslimatı"></div></div><div class="form-error" id="form-error"></div><div class="modal-actions"><button type="button" class="button" data-action="close-modal">Vazgeç</button><button class="button button-primary" type="submit">İşlemi kaydet</button></div></form></section></div>`;
    updateMovementFields();
  }
  const firstInput = $("input:not([type=hidden]), select", root);
  firstInput?.focus();
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

function addMovement({ productId, warehouseId, type, delta, note }) {
  const product = productById(productId);
  if (!product) throw new Error("Ürün bulunamadı.");
  if (!warehouseById(warehouseId)) throw new Error("Depo bulunamadı.");
  const next = Number(product.stock[warehouseId] || 0) + delta;
  if (next < 0) throw new Error("Bu depoda bu işlem için yeterli stok yok.");
  product.stock[warehouseId] = next;
  state.movements.unshift({ id: makeId(), productId, warehouseId, type, delta, note, at: new Date().toISOString() });
}

function saveProduct(form) {
  const data = new FormData(form);
  const sku = String(data.get("sku")).trim();
  if (state.products.some((product) => product.sku.toLocaleLowerCase("tr-TR") === sku.toLocaleLowerCase("tr-TR"))) throw new Error("Bu SKU kodu zaten kullanılıyor.");
  const product = {
    id: makeId(), sku, name: String(data.get("name")).trim(), category: String(data.get("category") || "Genel").trim(),
    unit: String(data.get("unit")), minimum: Math.max(0, Number(data.get("minimum") || 0)), cost: Math.max(0, Number(data.get("cost") || 0)),
    stock: Object.fromEntries(state.warehouses.map((warehouse) => [warehouse.id, 0])), symbol: "□",
  };
  state.products.unshift(product);
  persist();
  $("#modal-root").innerHTML = "";
  render();
  showToast("Ürün envantere eklendi.");
}

function saveWarehouse(form) {
  const data = new FormData(form);
  const code = String(data.get("code")).trim().toLocaleUpperCase("tr-TR");
  if (state.warehouses.some((warehouse) => warehouse.code.toLocaleLowerCase("tr-TR") === code.toLocaleLowerCase("tr-TR"))) throw new Error("Bu depo kodu zaten kullanılıyor.");
  const warehouse = { id: makeId(), code, name: String(data.get("name")).trim(), address: String(data.get("address") || "").trim() };
  state.warehouses.push(warehouse);
  state.products.forEach((product) => { product.stock[warehouse.id] = 0; });
  persist();
  $("#modal-root").innerHTML = "";
  render();
  showToast("Yeni depo oluşturuldu.");
}

function saveMovement(form) {
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
    addMovement({ productId, warehouseId: sourceWarehouseId, type: "TRANSFER_OUT", delta: -quantity, note: note || "Depolar arası transfer" });
    addMovement({ productId, warehouseId: targetWarehouseId, type: "TRANSFER_IN", delta: quantity, note: note || "Depolar arası transfer" });
  } else if (type === "ADJUSTMENT") {
    const warehouseId = String(data.get("warehouseId"));
    const delta = quantity - Number(product?.stock?.[warehouseId] || 0);
    if (delta === 0) throw new Error("Sayım miktarı mevcut stokla aynı.");
    addMovement({ productId, warehouseId, type: "ADJUSTMENT", delta, note: note || "Fiziki sayım düzeltmesi" });
  } else {
    addMovement({ productId, warehouseId: String(data.get("warehouseId")), type, delta: type === "INBOUND" ? quantity : -quantity, note });
  }
  persist();
  $("#modal-root").innerHTML = "";
  render();
  showToast("Stok hareketi kaydedildi.");
}

function submitForm(form) {
  const error = $("#form-error", form);
  if (!form.reportValidity()) return;
  try {
    if (form.id === "product-form") saveProduct(form);
    if (form.id === "warehouse-form") saveWarehouse(form);
    if (form.id === "movement-form") saveMovement(form);
  } catch (problem) {
    error.textContent = problem.message || "İşlem kaydedilemedi.";
    error.classList.add("visible");
  }
}

function exportCsv() {
  const rows = [["Ürün", "SKU", "Kategori", "Depo", "Miktar", "Birim", "Minimum", "Durum"]];
  for (const product of state.products) {
    for (const warehouse of state.warehouses) {
      rows.push([product.name, product.sku, product.category, warehouse.name, product.stock?.[warehouse.id] || 0, product.unit, product.minimum, statusOf(product) === "ok" ? "Stokta" : statusOf(product) === "empty" ? "Tükendi" : "Kritik"]);
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
  alert("Hızlı başlangıç\n\n1. Ürünler bölümünden ürün ekle.\n2. Depolar bölümünde lokasyonlarını tanımla.\n3. Stok işlemi ile giriş, çıkış, sayım düzeltmesi veya transfer kaydet.\n4. Stok durumu ve hareketler ekranından kayıtlarını takip et.\n\nBu demo verileri tarayıcında saklanır.");
}

document.addEventListener("click", (event) => {
  const viewLink = event.target.closest("[data-view]");
  if (viewLink) {
    event.preventDefault();
    setView(viewLink.dataset.view);
    return;
  }
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;
  const { action } = actionElement.dataset;
  if (action === "open-product") openModal("product");
  if (action === "open-warehouse") openModal("warehouse");
  if (action === "open-movement") openModal("movement", { productId: actionElement.dataset.productId, warehouseId: actionElement.dataset.warehouseId });
  if (action === "export-csv") exportCsv();
  if (action === "show-help") showHelp();
  if (action === "close-modal" && (actionElement === event.target || actionElement.closest(".modal"))) $("#modal-root").innerHTML = "";
});

document.addEventListener("submit", (event) => {
  if (event.target.matches("#product-form, #warehouse-form, #movement-form")) {
    event.preventDefault();
    submitForm(event.target);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("#movement-type, #movement-product")) updateMovementFields();
  if (event.target.matches("#warehouse-filter")) { inventoryWarehouseFilter = event.target.value; render(); }
  if (event.target.matches("#movement-filter")) { movementTypeFilter = event.target.value; render(); }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("#global-search, #product-search, #inventory-search, #movement-search")) {
    currentSearch = event.target.value;
    if (event.target.id !== "global-search") {
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
  if (event.key === "Escape") {
    $("#modal-root").innerHTML = "";
    $("#sidebar").classList.remove("open");
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $("#global-search").focus();
  }
});
window.addEventListener("hashchange", () => { currentView = location.hash.slice(1) || "overview"; render(); });

persist();
render();
