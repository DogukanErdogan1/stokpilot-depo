import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "stokpilot-counts-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
process.env.PUBLIC_ORIGIN = "http://localhost";
const { db } = await import("../dist/db.js");
const { buildApp } = await import("../dist/app.js");
const app = await buildApp();
app.log.level = "silent";

function workspaceSession() {
  const workspace = randomUUID();
  const user = randomUUID();
  const token = randomUUID();
  db.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)").run(workspace, "Sayım testi");
  db.prepare("INSERT INTO users (id, email, full_name, password_hash, workspace_id, role) VALUES (?, ?, ?, ?, ?, 'admin')")
    .run(user, `${user}@example.test`, "Test", "unused", workspace);
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .run(createHash("sha256").update(token).digest("hex"), user, "2100-01-01");
  return { cookie: `stokpilot_session=${token}`, origin: "http://localhost", host: "localhost" };
}

const api = (headers, method, path, payload) => app.inject({ headers, method, url: `/api${path}`, payload });

async function json(headers, status, method, path, payload) {
  const response = await api(headers, method, path, payload);
  assert.equal(response.statusCode, status, response.body);
  return response.json();
}

async function setup() {
  const headers = workspaceSession();
  const warehouse = await json(headers, 201, "POST", "/warehouses", { code: randomUUID().slice(0, 20), name: "Ana depo" });
  const product = async (name, barcode) => json(headers, 201, "POST", "/products", { name, barcode, sku: randomUUID() });
  const move = (productId, quantity, type = "INBOUND") => json(headers, 201, "POST", "/stock-movements", {
    warehouseId: warehouse.id, productId, quantity, type,
  });
  const start = (status = 201) => json(headers, status, "POST", "/stock-counts", { warehouseId: warehouse.id });
  return { headers, warehouse, product, move, start };
}

const itemsUrl = count => `/stock-counts/${count.id}/items`;
const finishUrl = count => `/stock-counts/${count.id}/finish`;
const entry = (row, countedQuantity) => ({
  productId: row.productId,
  countedQuantity,
  previousCountedQuantity: row.countedQuantity,
  expectedQuantity: row.systemQuantity,
  stockRevision: row.stockRevision,
});

after(async () => {
  await app.close();
  db.close();
  for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
  rmdirSync(directory);
});

test("a warehouse draft is resumed, and its catalogue can be searched and paged without sending all products", async () => {
  const { headers, product, start } = await setup();
  await product("Ankara kutusu");
  const label = await product("İstanbul kolisi", "000200B");
  const count = await start();
  assert.equal((await start(200)).id, count.id);
  const page = await json(headers, 200, "GET", `${itemsUrl(count)}?pageSize=1&page=2`);
  assert.equal(page.items.length, 1);
  assert.equal(page.pagination.total, 2);
  assert.equal(page.items[0].systemQuantity, 0);
  assert.equal(page.items[0].countedQuantity, null);
  const search = await json(headers, 200, "GET", `${itemsUrl(count)}?q=000200B`);
  assert.equal(search.items[0].productId, label.id);
  const history = await json(headers, 200, "GET", "/stock-counts");
  assert.equal(history.items[0].id, count.id);
});

test("approval applies only counted differences, leaves blank rows untouched and is idempotent", async () => {
  const { headers, product, move, start, warehouse } = await setup();
  const [first, second, zero, untouched] = await Promise.all([
    product("A"), product("B"), product("C"), product("D"),
  ]);
  await move(first.id, 10);
  await move(untouched.id, 3);
  const count = await start();
  const page = await json(headers, 200, "GET", itemsUrl(count));
  const find = product => page.items.find(row => row.productId === product.id);
  const saved = await json(headers, 200, "PATCH", itemsUrl(count), {
    revision: count.revision, items: [entry(find(first), 8), entry(find(second), 4), entry(find(zero), 0)],
  });
  assert.equal(saved.counted, 3);
  assert.equal(saved.differences, 2);
  const review = await json(headers, 200, "GET", `${itemsUrl(count)}?filter=differences&pageSize=1`);
  assert.equal(review.pagination.total, 2);
  assert.equal(review.items[0].expectedQuantity, 10);
  assert.equal((await json(headers, 200, "GET", `/products/${first.id}`)).stock[warehouse.id], 10);
  const approval = { revision: saved.revision, action: "approve" };
  assert.equal((await json(headers, 200, "POST", finishUrl(count), approval)).status, "COMPLETED");
  assert.equal((await json(headers, 200, "POST", finishUrl(count), approval)).status, "COMPLETED");
  assert.equal((await json(headers, 200, "GET", `/products/${first.id}`)).stock[warehouse.id], 8);
  assert.equal((await json(headers, 200, "GET", `/products/${second.id}`)).stock[warehouse.id], 4);
  assert.equal((await json(headers, 200, "GET", `/products/${untouched.id}`)).stock[warehouse.id], 3);
  const movements = await json(headers, 200, "GET", "/stock-movements?type=ADJUSTMENT");
  assert.deepEqual(movements.items.map(item => item.quantityDelta).sort((a, b) => a - b), [-2, 4]);
  assert.ok(movements.items.every(item => item.referenceId === count.id));
  const closed = await json(headers, 200, "GET", itemsUrl(count));
  assert.equal(closed.items.length, 3);
  assert.equal(closed.items.find(row => row.productId === zero.id).countedQuantity, 0);
});

test("intervening movements block the entire approval even when stock returns to the same quantity", async () => {
  const { headers, product, move, start, warehouse } = await setup();
  const first = await product("A güncel");
  const second = await product("B değişen");
  await move(second.id, 5);
  const count = await start();
  const catalogue = await json(headers, 200, "GET", itemsUrl(count));
  const saved = await json(headers, 200, "PATCH", itemsUrl(count), {
    revision: count.revision, items: catalogue.items.map(row => entry(row, 3)),
  });
  await move(second.id, 2);
  await move(second.id, 2, "OUTBOUND");
  const conflict = await json(headers, 409, "POST", finishUrl(count), { revision: saved.revision, action: "approve" });
  assert.equal(conflict.error.code, "COUNT_STOCK_CHANGED");
  assert.equal((await json(headers, 200, "GET", `/products/${first.id}`)).stock[warehouse.id], undefined);
  const review = await json(headers, 200, "GET", `${itemsUrl(count)}?filter=counted`);
  const changed = review.items.find(row => row.productId === second.id);
  assert.equal(changed.systemQuantity, changed.expectedQuantity);
  assert.equal(changed.conflict, 1);
  const checked = await json(headers, 200, "PATCH", itemsUrl(count), {
    revision: saved.revision, items: [entry(changed, 4)],
  });
  await json(headers, 200, "POST", finishUrl(count), { revision: checked.revision, action: "approve" });
});

test("draft edits are workspace scoped and reject stale values, including concurrent edits to the same row", async () => {
  const { headers, product, start } = await setup();
  await json(headers, 201, "POST", "/products", { name: "Kalem", sku: randomUUID() });
  await product("Koli");
  const count = await start();
  const otherHeaders = workspaceSession();
  await json(otherHeaders, 404, "GET", itemsUrl(count));
  await json(otherHeaders, 404, "POST", finishUrl(count), { revision: 0, action: "cancel" });
  assert.equal((await json(otherHeaders, 200, "GET", "/stock-counts")).items.length, 0);
  const { items } = await json(headers, 200, "GET", itemsUrl(count));
  await json(headers, 400, "PATCH", itemsUrl(count), { revision: 0, items: [entry(items[0], -1)] });
  const saved = await json(headers, 200, "PATCH", itemsUrl(count), { revision: 0, items: [entry(items[0], 5)] });
  const stale = await json(headers, 409, "PATCH", itemsUrl(count), { revision: 0, items: [entry(items[1], 2)] });
  assert.equal(stale.error.code, "COUNT_UPDATED");
  const overlap = await json(headers, 409, "PATCH", itemsUrl(count), {
    revision: saved.revision, items: [entry(items[1], 2), entry(items[0], 7)],
  });
  assert.equal(overlap.error.code, "COUNT_UPDATED");
  const unchanged = await json(headers, 200, "GET", `${itemsUrl(count)}?filter=counted`);
  assert.equal(unchanged.items.length, 1);
  assert.equal(unchanged.items[0].countedQuantity, 5);
  const cancel = await json(headers, 200, "POST", finishUrl(count), { revision: saved.revision, action: "cancel" });
  assert.equal(cancel.status, "CANCELLED");
  assert.notEqual((await start()).id, count.id);
});
