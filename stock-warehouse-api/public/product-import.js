const productImportMaxBytes = 500 * 1024;
const productImportPageSize = 20;
let productImport = null;

function closeProductImport() {
  productImport?.reader?.abort();
  productImport = null;
}

function showProductImport() {
  if (!canEditCatalog()) return;
  closeProductImport();
  productImport = { reader: null, csv: "", fileName: "", requestId: "", preview: null, page: 1, errorsOnly: false, loading: false, saving: false, error: "" };
  $("#modal-root").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal product-import-modal" role="dialog" aria-modal="true" aria-labelledby="product-import-title">
    <header class="modal-head"><div><h2 id="product-import-title">CSV ile ürün ekle</h2><p>Önce dosyayı kontrol et, ardından ürünleri kataloğa ekle.</p></div>
      <button class="modal-close" type="button" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header>
    <div class="modal-form">
      <div class="product-import-picker"><div class="form-field">
        <label for="product-import-file">Ürün CSV dosyası</label>
        <input id="product-import-file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" aria-describedby="product-import-help">
        <span class="field-hint" id="product-import-help">SKU ve Ürün adı gerekli. En fazla 2.000 satır ve 500 KB.</span>
      </div><a class="button" href="${API_BASE_URL}/api/products/import/template" download>${icon("download")} CSV şablonu</a></div>
      <p class="product-import-status" id="product-import-status" role="status" tabindex="-1"></p>
      <p class="product-import-error" id="product-import-error" role="alert" hidden></p>
      <div id="product-import-preview"></div>
      <div class="modal-actions"><button class="button" type="button" data-action="close-modal">Vazgeç</button>
        <button class="button button-primary" id="product-import-save" type="button" data-action="product-import-save" disabled>Ürünleri ekle</button></div>
    </div></section></div>`;
  beginModal();
  $("#product-import-file").focus();
}

function renderProductImportRows(preview, page, errorsOnly) {
  const matching = errorsOnly ? preview.rows.filter(row => row.issues.length) : preview.rows;
  const pages = Math.max(1, Math.ceil(matching.length / productImportPageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const items = matching.slice((current - 1) * productImportPageSize, current * productImportPageSize);
  return `${preview.ignoredColumns.length ? `<p class="product-import-warning">Aktarım dışındaki sütunlar: ${preview.ignoredColumns.map(esc).join(", ")}</p>` : ""}
    ${preview.invalid ? '<label class="product-import-filter"><input id="product-import-errors-only" type="checkbox" ' + (errorsOnly ? "checked" : "") + '> Yalnız hatalı satırlar</label>' : ""}
    <div class="table-scroll product-import-table"><table class="data-table">
      <thead><tr><th>Satır</th><th>SKU / Ürün</th><th>Kategori / Birim</th><th>Barkod</th><th>Maliyet</th><th>Min. stok</th><th>Kontrol</th></tr></thead>
      <tbody>${items.map(row => `<tr><td>${number(row.line)}</td>
        <td><div class="purchase-product"><strong>${esc(row.sku || "—")}</strong><small>${esc(row.name || "—")}</small></div></td>
        <td><div class="purchase-product"><strong>${esc(row.category)}</strong><small>${esc(row.unit)}</small></div></td>
        <td>${esc(row.barcode || "—")}</td><td>${row.cost === null ? "—" : money(row.cost)}</td>
        <td>${row.minimumStockQuantity === null ? "—" : number(row.minimumStockQuantity)}</td>
        <td>${row.issues.length ? `<ul class="product-import-issues">${row.issues.map(issue => `<li>${esc(issue)}</li>`).join("")}</ul>`
          : '<span class="product-import-valid">Aktarıma hazır</span>'}</td></tr>`).join("")}</tbody></table></div>
    ${pages > 1 ? `<div class="count-pager"><p>Sayfa ${number(current)} / ${number(pages)}</p><div>
      <button class="button button-small" type="button" data-action="product-import-page" data-page="${current - 1}" ${current === 1 ? "disabled" : ""}>Önceki</button>
      <button class="button button-small" type="button" data-action="product-import-page" data-page="${current + 1}" ${current === pages ? "disabled" : ""}>Sonraki</button></div></div>` : ""}`;
}

function refreshProductImport() {
  const screen = productImport;
  const { preview, error, loading, saving, page, errorsOnly } = screen;
  const status = $("#product-import-status");
  const message = $("#product-import-error");
  const save = $("#product-import-save");
  const file = $("#product-import-file");
  file.disabled = saving;
  save.disabled = loading || saving || !preview?.valid || preview.invalid > 0;
  save.textContent = saving ? "Ekleniyor…" : preview?.valid && !preview.invalid ? `${number(preview.valid)} ürünü ekle` : "Ürünleri ekle";
  const summary = loading ? "Dosya kontrol ediliyor…" : preview
    ? `${number(preview.total)} satır · ${number(preview.valid)} hazır · ${number(preview.invalid)} hatalı` : "";
  status.textContent = [screen.fileName, summary].filter(Boolean).join(" · ");
  message.hidden = !error && !preview?.invalid;
  message.textContent = error || (preview?.invalid ? "Belirtilen satırları düzeltip dosyayı yeniden seç." : "");
  $("#product-import-preview").innerHTML = preview ? renderProductImportRows(preview, page, errorsOnly) : "";
}

function decodeProductCsv(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder("utf-16be").decode(bytes);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-1254").decode(bytes); }
}

async function loadProductImport(file) {
  const screen = productImport;
  if (!screen || !file || screen.saving) return;
  screen.reader?.abort();
  const reader = new AbortController();
  Object.assign(screen, { reader, csv: "", fileName: file.name, preview: null, requestId: newRequestId(), page: 1, errorsOnly: false, loading: true, error: "" });
  refreshProductImport();
  try {
    if (file.size > productImportMaxBytes) throw new Error("CSV dosyası en fazla 500 KB olabilir.");
    const csv = decodeProductCsv(await file.arrayBuffer());
    if (reader.signal.aborted || screen !== productImport) return;
    if (!csv.trim()) throw new Error("Seçilen dosya boş.");
    screen.csv = csv;
    const preview = await api("/products/import/preview", {
      method: "POST", body: JSON.stringify({ csv }), signal: reader.signal,
    });
    if (!reader.signal.aborted && screen === productImport) screen.preview = preview;
  } catch (error) {
    if (!reader.signal.aborted && screen === productImport) screen.error = error.message;
  } finally {
    if (!reader.signal.aborted && screen === productImport) {
      screen.loading = false;
      refreshProductImport();
    }
  }
}

async function commitProductImport() {
  const screen = productImport;
  const user = currentUser;
  if (!canEditCatalog() || !screen?.preview?.valid || screen.preview.invalid || screen.loading || screen.saving) return;
  screen.saving = true;
  screen.error = "";
  refreshProductImport();
  try {
    const { imported } = await api("/products/import", {
      method: "POST", body: JSON.stringify({ csv: screen.csv, requestId: screen.requestId }),
    });
    if (currentUser !== user) return;
    if (screen === productImport) closeModal();
    invalidateList("products", true);
    showToast(`${number(imported)} ürün CSV'den eklendi.`);
    try { await refreshState(); } catch { /* The import has already been committed. */ }
    if (currentUser === user) render();
  } catch (error) {
    if (screen !== productImport) return;
    if (error.response?.preview) {
      screen.preview = error.response.preview;
      screen.page = 1;
      screen.errorsOnly = true;
    }
    screen.error = error.message;
  } finally {
    if (screen === productImport) {
      screen.saving = false;
      refreshProductImport();
    }
  }
}

function handleProductImportAction(action, button) {
  if (action === "product-import-open") return showProductImport();
  if (action === "product-import-save") return void commitProductImport();
  if (action === "product-import-page" && productImport) {
    productImport.page = Number(button.dataset.page);
    refreshProductImport();
    $("#product-import-status").focus({ preventScroll: true });
  }
}
