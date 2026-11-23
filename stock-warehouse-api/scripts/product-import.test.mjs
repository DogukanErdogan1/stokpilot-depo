import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "stokpilot-import-"));
process.env.DATABASE_PATH = join(directory, "import.sqlite");
process.env.PUBLIC_ORIGIN = "http://localhost";
const { db } = await import("../dist/db.js");
const { buildApp } = await import("../dist/app.js");
const app = await buildApp();
app.log.level = "silent";

function account(role = "admin") {
  const workspace = randomUUID(), id = randomUUID(), token = randomUUID();
  db.prepare("INSERT INTO workspaces (id, name) VALUES (?, 'CSV testi')").run(workspace);
  db.prepare("INSERT INTO users (id, email, full_name, password_hash, workspace_id, role) VALUES (?, ?, 'Test', 'unused', ?, ?)")
    .run(id, `${id}@example.test`, workspace, role);
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, '2100-01-01')")
    .run(createHash("sha256").update(token).digest("hex"), id);
  return { workspace, headers: { cookie: `stokpilot_session=${token}`, origin: "http://localhost", host: "localhost" } };
}

async function json(user, method, url, status, payload) {
  const response = await app.inject({ method, url: `/api${url}`, headers: user.headers, payload });
  assert.equal(response.statusCode, status, response.body);
  return response.json();
}

const preview = (user, csv, status = 200) => json(user, "POST", "/products/import/preview", status, { csv });
const commit = (user, csv, status = 201, requestId = randomUUID()) => json(user, "POST", "/products/import", status, { csv, requestId });
const catalogue = user => json(user, "GET", "/products", 200);

after(async () => {
  await app.close();
  db.close();
  for (const name of readdirSync(directory)) unlinkSync(join(directory, name));
  rmdirSync(directory);
});

test("preview reads Excel-style CSV, quotes, multiline values and leading zeros without writing", async () => {
  const user = account();
  const csv = '\uFEFFsep=;\r\nSKU;Ürün adı;Barkod;Birim maliyet (₺);Minimum stok;Açıklama;Depo\r\n'
    + '00017;"Mavi; \"\"Koli\"\"";001222345678;125,00;3;"Paket\r\nikili";Ana\r\n\r\n'
    + "00018;İstanbul etiketi;;;;;Ana\r\n";
  const result = await preview(user, csv);
  assert.equal(result.valid, 2);
  assert.deepEqual(result.ignoredColumns, ["Depo"]);
  assert.deepEqual(result.rows.map(row => row.line), [3, 6]);
  assert.equal(result.rows[0].name, 'Mavi; "Koli"');
  assert.equal(result.rows[0].barcode, "001222345678");
  assert.equal(result.rows[0].cost, 125);
  assert.equal(result.rows[1].unit, "adet");
  assert.equal((await catalogue(user)).pagination.total, 0);
  await commit(user, csv);
  const products = (await catalogue(user)).items;
  const first = products.find(product => product.sku === "00017");
  assert.equal(first.description, "Paket\nikili");
  assert.equal(first.minimumStockQuantity, 3);
  assert.deepEqual(first.stock, {});
  assert.equal(products.find(product => product.sku === "00018").cost, 0);
});

test("invalid fields and file or catalogue duplicates are reported on their physical lines", async () => {
  const user = account();
  await json(user, "POST", "/products", 201, { sku: "CSV-EXISTING", name: "Kayıtlı", barcode: "012345678905" });
  const csv = 'SKU,Name,Barcode,Cost,Minimum stock\n'
    + 'CSV-EXISTING,"İlk, ürün",0012345678905,10,1\n'
    + "CSV-A,İkinci,000000000001,25.50,0\n"
    + "csv-a,,0000000000001,25,-2\n"
    + "CSV-VALID,Son ürün,,25,0\n";
  const report = await preview(user, csv);
  assert.equal(report.valid, 1);
  assert.equal(report.invalid, 3);
  assert.match(report.rows[0].issues.join(" "), /SKU kullanılamıyor.*başka bir ürüne kayıtlı/);
  assert.match(report.rows[1].issues.join(" "), /tam sayı.*SKU dosyada yineleniyor.*Barkod dosyada yineleniyor/);
  assert.match(report.rows[2].issues.join(" "), /zorunlu/);
  const rejected = await commit(user, csv, 409);
  assert.equal(rejected.preview.invalid, 3);
  assert.equal((await catalogue(user)).pagination.total, 1);
});

test("commit revalidates after preview, applies atomically and safely replays the request", async () => {
  const user = account();
  const csv = "Ürün kodu\tÜrün adı\nRACE-A\tİlk\nRACE-B\tİkinci\n";
  assert.equal((await preview(user, csv)).valid, 2);
  await json(user, "POST", "/products", 201, { sku: "RACE-B", name: "Sonradan eklenen" });
  const stale = await commit(user, csv, 409);
  assert.deepEqual(stale.preview.rows.filter(row => row.issues.length).map(row => row.sku), ["RACE-B"]);
  assert.deepEqual((await catalogue(user)).items.map(product => product.sku), ["RACE-B"]);
  const requestId = randomUUID();
  const fixed = csv.replace("RACE-B", "RACE-C");
  assert.deepEqual(await commit(user, fixed, 201, requestId), { imported: 2, replayed: false });
  assert.deepEqual(await commit(user, fixed, 200, requestId), { imported: 2, replayed: true });
  await commit(user, fixed.replace("RACE-C", "RACE-D"), 409, requestId);
  assert.equal((await catalogue(user)).pagination.total, 3);
});

test("template, malformed CSV, limits and access checks use the normal API", async () => {
  const user = account();
  const template = await app.inject({ url: "/api/products/import/template", headers: user.headers });
  assert.equal(template.statusCode, 200);
  assert.match(template.headers["content-disposition"], /stokpilot-urun-sablonu\.csv/);
  assert.equal((await preview(user, template.body + "TEMPLATE-1;Örnek\r\n")).valid, 1);
  await preview(user, "Ürün adı;Barkod\nBir;001", 400);
  await preview(user, 'SKU;Ürün adı\nA;"Kapanmadı', 400);
  await preview(user, "SKU,Name,Ürün adı\nA,First,İlk", 400);
  await preview(user, "SKU,Name\n" + Array.from({ length: 2001 }, (_, i) => `BIG-${i},Ürün`).join("\n"), 400);
  await preview(user, "SKU,Name\nBIG," + "Ö".repeat(260_000), 400);
  const extra = await preview(user, "SKU;Ürün adı\nEXTRA-1;Ürün;Fazla veri");
  assert.match(extra.rows[0].issues[0], /sütun sayısı/);
  await preview(account("operator"), "SKU,Name\nA,Test", 403);
  await commit(account("viewer"), "SKU,Name\nA,Test", 403);
});
