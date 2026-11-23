import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "stokpilot-purchasing-"));
process.env.DATABASE_PATH = join(directory, "purchasing.sqlite");
process.env.PUBLIC_ORIGIN = "http://localhost";
const { db } = await import("../dist/db.js");
const { buildApp } = await import("../dist/app.js");
const app = await buildApp();
app.log.level = "silent";

function workspace() {
  const id = randomUUID();
  db.prepare("INSERT INTO workspaces (id, name) VALUES (?, 'Satın alma testi')").run(id);
  return id;
}

function session(workspaceId, role) {
  const id = randomUUID();
  const token = randomUUID();
  db.prepare("INSERT INTO users (id, email, full_name, password_hash, workspace_id, role) VALUES (?, ?, ?, 'unused', ?, ?)")
    .run(id, `${id}@example.test`, role === "operator" ? "Teslim alan" : "Satın alma yöneticisi", workspaceId, role);
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, '2100-01-01')")
    .run(createHash("sha256").update(token).digest("hex"), id);
  return { id, headers: { cookie: `stokpilot_session=${token}`, origin: "http://localhost", host: "localhost" } };
}

async function call(user, method, url, status, payload) {
  const response = await app.inject({ method, url: "/api" + url, headers: user.headers, payload });
  assert.equal(response.statusCode, status, response.body);
  return response.body ? response.json() : null;
}

async function setup() {
  const id = workspace();
  const admin = session(id, "admin");
  const receiver = session(id, "operator");
  const viewer = session(id, "viewer");
  const supplier = await call(admin, "POST", "/suppliers", 201, { name: "İstanbul Tedarik", contact: "Örnek", email: "orders@example.test" });
  const depot = await call(admin, "POST", "/warehouses", 201, { name: "Ana depo", code: randomUUID().slice(0, 20) });
  const parts = await Promise.all(["Koli", "Etiket"].map(name =>
    call(admin, "POST", "/products", 201, { name, sku: randomUUID().slice(0, 18), cost: 77 })));
  const orderInput = {
    requestId: randomUUID(), supplierId: supplier.id, warehouseId: depot.id, expectedDate: "2027-01-18",
    items: [{ productId: parts[0].id, quantity: 100, unitPriceCents: 1250 }, { productId: parts[1].id, quantity: 5, unitPriceCents: 200 }],
  };
  return { admin, receiver, viewer, supplier, depot, parts, orderInput };
}

after(async () => {
  await app.close();
  db.close();
  for (const name of readdirSync(directory)) unlinkSync(join(directory, name));
  rmdirSync(directory);
});

test("supplier records can be searched and edited within the workspace by administrators", async () => {
  const { admin, receiver, viewer, supplier } = await setup();
  const foreign = session(workspace(), "admin");
  await call(receiver, "POST", "/suppliers", 403, { name: "Yetki yok" });
  await call(foreign, "PATCH", `/suppliers/${supplier.id}`, 404, { note: "Yetki yok" });
  assert.equal((await call(foreign, "GET", "/suppliers", 200)).pagination.total, 0);
  const edited = await call(admin, "PATCH", `/suppliers/${supplier.id}`, 200, { phone: "+90 555 0100", email: null });
  assert.equal(edited.name, supplier.name);
  assert.equal(edited.email, null);
  const search = await call(viewer, "GET", `/suppliers?q=${encodeURIComponent("İSTANBUL")}&pageSize=1`, 200);
  assert.deepEqual(search.items.map(item => item.phone), ["+90 555 0100"]);
});

test("order creation leaves inventory unchanged; attributed partial receipts are retry-safe and close the order", async () => {
  const { admin, receiver, viewer, depot, parts, orderInput } = await setup();
  await call(receiver, "POST", "/purchase-orders", 403, orderInput);
  const order = await call(admin, "POST", "/purchase-orders", 201, orderInput);
  assert.equal(order.number, 1);
  assert.equal(order.totalCents, 126000);
  assert.equal((await call(admin, "POST", "/purchase-orders", 200, orderInput)).id, order.id);
  await call(admin, "POST", "/purchase-orders", 409, { ...orderInput, note: "Farklı sipariş" });
  const detailUrl = `/purchase-orders/${order.id}`;
  const before = await call(viewer, "GET", detailUrl, 200);
  const [first, second] = parts.map(part => before.items.find(item => item.productId === part.id));
  assert.equal(before.order.status, "OPEN");
  assert.equal((await call(viewer, "GET", "/stock-movements", 200)).pagination.total, 0);
  const partial = { requestId: randomUUID(), items: [{ itemId: first.id, quantity: 60 }] };
  await call(viewer, "POST", detailUrl + "/receipts", 403, partial);
  const received = await call(receiver, "POST", detailUrl + "/receipts", 201, partial);
  assert.equal(received.order.status, "PARTIAL");
  assert.equal((await call(receiver, "POST", detailUrl + "/receipts", 200, partial)).receiptId, received.receiptId);
  await call(receiver, "POST", detailUrl + "/receipts", 409, { ...partial, items: [{ itemId: first.id, quantity: 61 }] });
  const afterFirst = await call(viewer, "GET", detailUrl, 200);
  assert.equal(afterFirst.items.find(item => item.id === first.id).received, 60);
  assert.equal(afterFirst.receipts[0].items[0].quantity, 60);
  const stock = await call(viewer, "GET", `/products/${parts[0].id}`, 200);
  assert.equal(stock.stock[depot.id], 60);
  assert.equal(stock.cost, 77);
  const finalReceipt = { requestId: randomUUID(), items: [{ itemId: first.id, quantity: 40 }, { itemId: second.id, quantity: 5 }] };
  assert.equal((await call(receiver, "POST", detailUrl + "/receipts", 201, finalReceipt)).order.status, "RECEIVED");
  await call(receiver, "POST", detailUrl + "/receipts", 200, finalReceipt);
  const movements = await call(viewer, "GET", "/stock-movements", 200);
  assert.equal(movements.items.length, 3);
  assert.ok(movements.items.every(item => item.type === "INBOUND" && item.actorId === receiver.id && item.note.includes("SA-0001")));
  assert.equal(movements.items.find(item => item.quantityDelta === 60).referenceId, received.receiptId);
  const filtered = await call(viewer, "GET", "/purchase-orders?status=RECEIVED&q=SA-0001&pageSize=1", 200);
  assert.deepEqual(filtered.items.map(item => item.id), [order.id]);
});

test("a failed receipt rolls back every line and closing a partial order preserves received stock", async () => {
  const { admin, receiver, viewer, depot, parts, orderInput } = await setup();
  const { id } = await call(admin, "POST", "/purchase-orders", 201, orderInput);
  const path = `/purchase-orders/${id}`;
  const detail = await call(viewer, "GET", path, 200);
  const [first, second] = parts.map(part => detail.items.find(item => item.productId === part.id));
  await call(receiver, "POST", path + "/receipts", 409, { requestId: randomUUID(),
    items: [{ itemId: first.id, quantity: 10 }, { itemId: second.id, quantity: 6 }] });
  assert.equal((await call(viewer, "GET", path, 200)).receiptCount, 0);
  assert.equal((await call(viewer, "GET", "/stock-movements", 200)).pagination.total, 0);
  assert.equal((await call(admin, "PATCH", `/products/${parts[0].id}`, 409, { archived: true })).error.code, "OPEN_PURCHASE_PRODUCT");
  await call(admin, "DELETE", `/products/${parts[1].id}`, 409);
  await call(admin, "PATCH", `/warehouses/${depot.id}`, 409, { archived: true });
  const partial = { requestId: randomUUID(), items: [{ itemId: first.id, quantity: 7 }] };
  await call(receiver, "POST", path + "/receipts", 201, partial);
  await call(receiver, "POST", path + "/cancel", 403);
  assert.equal((await call(admin, "POST", path + "/cancel", 200)).status, "CANCELLED");
  await call(admin, "POST", path + "/cancel", 200);
  await call(receiver, "POST", path + "/receipts", 409, { ...partial, requestId: randomUUID() });
  assert.equal((await call(viewer, "GET", `/products/${parts[0].id}`, 200)).stock[depot.id], 7);
  await call(admin, "DELETE", `/products/${parts[1].id}`, 204);
  assert.ok((await call(viewer, "GET", path, 200)).items.some(item => item.id === second.id && item.name === "Etiket"));
});

test("orders and receipts cannot use another workspace's supplier, warehouse or order", async () => {
  const { admin, supplier, orderInput } = await setup();
  const foreign = await setup();
  await call(admin, "POST", "/purchase-orders", 404, { ...orderInput, supplierId: foreign.supplier.id });
  await call(admin, "POST", "/purchase-orders", 404, { ...orderInput, warehouseId: foreign.depot.id });
  await call(admin, "POST", "/purchase-orders", 404, { ...orderInput, items: [{ productId: foreign.parts[0].id, quantity: 1, unitPriceCents: 1 }] });
  const order = await call(admin, "POST", "/purchase-orders", 201, { ...orderInput, supplierId: supplier.id });
  assert.equal(order.number, 1);
  await call(foreign.viewer, "GET", `/purchase-orders/${order.id}`, 404);
  await call(foreign.receiver, "POST", `/purchase-orders/${order.id}/receipts`, 404, { requestId: randomUUID(), items: [{ itemId: randomUUID(), quantity: 1 }] });
});
