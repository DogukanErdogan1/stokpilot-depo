import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "stokpilot-reports-"));
process.env.DATABASE_PATH = join(directory, "report.sqlite");
const { db } = await import("../dist/db.js");
const { buildApp } = await import("../dist/app.js");
const app = await buildApp();
app.log.level = "silent";

function addWorkspace() {
  const workspace = randomUUID();
  const user = randomUUID();
  const token = randomUUID();
  db.prepare("INSERT INTO workspaces (id, name) VALUES (?, 'Rapor testi')").run(workspace);
  db.prepare("INSERT INTO users (id, email, full_name, password_hash, workspace_id, role) VALUES (?, ?, 'Test', 'unused', ?, 'viewer')")
    .run(user, `${user}@example.test`, workspace);
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, '2100-01-01')")
    .run(createHash("sha256").update(token).digest("hex"), user);
  return { workspace, headers: { cookie: `stokpilot_session=${token}` } };
}

function addWarehouse(workspace, code) {
  const id = randomUUID();
  db.prepare("INSERT INTO warehouses (id, workspace_id, name, code) VALUES (?, ?, ?, ?)").run(id, workspace, code, code);
  return id;
}

function addProduct(workspace, sku, cost) {
  const id = randomUUID();
  db.prepare("INSERT INTO products (id, workspace_id, name, sku, cost) VALUES (?, ?, ?, ?, ?)").run(id, workspace, sku, sku, cost);
  return id;
}

function balance(who, product, warehouse, quantity) {
  db.prepare("INSERT INTO inventory_balances (workspace_id, product_id, warehouse_id, quantity, updated_at) VALUES (?,?,?,?,?)")
    .run(who, product, warehouse, quantity, "2024-11-03T12:00:00.000Z");
}

function movement(who, product, warehouse, type, delta, timestamp) {
  db.prepare("INSERT INTO stock_movements (id, workspace_id, product_id, warehouse_id, type, quantity_delta, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(randomUUID(), who, product, warehouse, type, delta, timestamp);
}

const { workspace, headers } = addWorkspace();
const { workspace: foreign } = addWorkspace();
const first = addWarehouse(workspace, "Ana");
const second = addWarehouse(workspace, "Yedek");
const outside = addWarehouse(foreign, "Başka depo");
const A = addProduct(workspace, "Kartuş", 100);
const B = addProduct(workspace, "Kablo", 30);
const legacy = addProduct(workspace, "Eski kayıt", 200);
const hidden = addProduct(foreign, "Dış ürün", 99_999);

balance(workspace, A, first, 5);
balance(workspace, A, second, 1);
balance(workspace, B, first, 7);
balance(workspace, B, second, 4);
balance(workspace, legacy, first, 3);
balance(foreign, hidden, outside, 200);
movement(workspace, A, first, "INBOUND", 10, "2024-10-30T20:59:59.999Z");
movement(workspace, A, first, "OUTBOUND", -2, "2024-10-30T21:00:00.000Z");
movement(workspace, A, first, "TRANSFER_OUT", -3, "2024-11-01T12:00:00.000Z");
movement(workspace, A, second, "TRANSFER_IN", 3, "2024-11-01T12:00:00.000Z");
movement(workspace, A, second, "OUTBOUND", -2, "2024-11-01T13:00:00.000Z");
movement(workspace, A, first, "ADJUSTMENT", 1, "2024-11-01T14:00:00.000Z");
movement(workspace, A, first, "OUTBOUND", -1, "2024-11-01T21:00:00.000Z");
movement(workspace, B, first, "INBOUND", 7, "2024-10-01T12:00:00.000Z");
movement(workspace, B, second, "INBOUND", 5, "2024-11-01T12:00:00.000Z");
movement(workspace, B, second, "OUTBOUND", -1, "2024-11-01T20:59:59.999Z");
movement(foreign, hidden, outside, "OUTBOUND", -500, "2024-11-01T12:00:00.000Z");

const query = { from: "2024-10-31", to: "2024-11-01" };
const call = (section, input = {}, session = headers) => app.inject({
  url: `/api/reports/stock/${section}?${new URLSearchParams({ ...query, ...input })}`, headers: session,
});
async function report(section, input) {
  const response = await call(section, input);
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

after(async () => {
  await app.close();
  db.close();
  for (const name of readdirSync(directory)) unlinkSync(join(directory, name));
  rmdirSync(directory);
});

test("outbound ranks stock exits by date and warehouse, excludes transfers, and paginates", async () => {
  const all = await report("outbound", { pageSize: "1" });
  assert.equal(all.pagination.total, 2);
  assert.deepEqual(all.items.map(x => [x.id, x.quantity, x.movements]), [[A, 4, 2]]);
  const next = await report("outbound", { page: "2", pageSize: "1" });
  assert.deepEqual(next.items.map(x => [x.id, x.quantity]), [[B, 1]]);
  const scoped = await report("outbound", { warehouseId: first });
  assert.deepEqual(scoped.items.map(x => [x.id, x.quantity]), [[A, 2]]);
});

test("estimated value uses daily closing amounts, opening stock and current unit costs", async () => {
  const scoped = await report("summary", { warehouseId: first });
  assert.deepEqual(scoped, {
    openingValue: 1210, closingValue: 810, unreconciledRows: 1,
    trend: [{ day: "2024-10-31", value: 1010 }, { day: "2024-11-01", value: 810 }],
  });
  const all = await report("summary");
  assert.equal(all.closingValue, 1030);
  const one = await report("summary", { from: "2024-10-31", to: "2024-10-31" });
  assert.deepEqual(one.trend, [{ day: "2024-10-31", value: 1010 }]);
});

test("idle rows use the selected closing date and only positive stock", async () => {
  const aged = await report("idle", { idleDays: "30", warehouseId: first });
  assert.deepEqual(aged.items.map(row => [row.productId, row.quantity, row.daysIdle]), [[B, 7, 31]]);
  const earlier = await report("idle", { from: "2024-10-28", to: "2024-10-29", idleDays: "10", warehouseId: first });
  assert.deepEqual(earlier.items.map(row => [row.productId, row.quantity]), [[B, 7]]);
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const current = await report("idle", { from: today, to: today, idleDays: "1", warehouseId: first });
  assert.ok(current.items.some(row => row.productId === legacy && row.quantity === 3 && row.lastMovement === null));
});

test("invalid calendar dates, oversized windows and cross-workspace warehouses are rejected", async () => {
  assert.equal((await call("summary", { from: "2024-02-30" })).statusCode, 400);
  assert.equal((await call("summary", { to: "2024-10-30" })).statusCode, 400);
  assert.equal((await call("summary", { from: "2022-01-01" })).statusCode, 400);
  assert.equal((await call("summary", { from: "2099-01-01", to: "2099-01-01" })).statusCode, 400);
  assert.equal((await call("summary", { warehouseId: outside })).statusCode, 404);
  assert.equal((await call("summary", {}, {})).statusCode, 401);
});
