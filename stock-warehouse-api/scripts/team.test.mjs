import assert from "node:assert/strict";
import { randomUUID, scryptSync } from "node:crypto";
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";

const directory = mkdtempSync(join(tmpdir(), "stokpilot-team-"));
process.env.DATABASE_PATH = join(directory, "team.sqlite");
process.env.PUBLIC_ORIGIN = "http://localhost";
process.env.ADMIN_EMAIL = "legacy-owner@example.test";
process.env.DEMO_EMAIL = "legacy-demo@example.test";
const password = "test-only-team-password";
const legacyWorkspace = randomUUID();
const legacyOwner = randomUUID();
const old = new Database(process.env.DATABASE_PATH);
old.exec(`
  CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE, full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), workspace_id TEXT);
`);
const oldSalt = "test-fixture-salt";
const oldDigest = `scrypt$${oldSalt}$${scryptSync(password, oldSalt, 64).toString("hex")}`;
for (const [workspace, id, email, name] of [
  [legacyWorkspace, legacyOwner, process.env.ADMIN_EMAIL, "Mevcut Yönetici"],
  [randomUUID(), randomUUID(), process.env.DEMO_EMAIL, "Eski Demo"],
]) {
  old.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)").run(workspace, name);
  old.prepare("INSERT INTO users (id, email, full_name, password_hash, workspace_id) VALUES (?, ?, ?, ?, ?)")
    .run(id, email, name, oldDigest, workspace);
}
old.close();

const { db } = await import("../dist/db.js");
const { buildApp } = await import("../dist/app.js");
const app = await buildApp();
app.log.level = "silent";
const origin = { origin: "http://localhost", host: "localhost" };
const call = (headers, method, path, payload) => app.inject({ headers, method, url: `/api${path}`, payload });
async function result(headers, method, path, status, payload) {
  const response = await call(headers, method, path, payload);
  assert.equal(response.statusCode, status, response.body);
  return response.json();
}
async function login(email) {
  const response = await call(origin, "POST", "/auth/login", { email, password });
  assert.equal(response.statusCode, 200, response.body);
  return { headers: { ...origin, cookie: `stokpilot_session=${response.cookies[0].value}` }, user: response.json().user };
}
const owner = await login(process.env.ADMIN_EMAIL);
const add = (email, fullName, role) => result(owner.headers, "POST", "/team", 201, { email, fullName, role, password });

after(async () => {
  await app.close();
  db.close();
  for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
  rmdirSync(directory);
});

test("legacy owner keeps administrator access and teammate password hashes are private", async () => {
  assert.equal(owner.user.role, "admin");
  assert.equal(owner.user.id, legacyOwner);
  const member = await add("  EKIP1@example.test ", "Ekip 1", "viewer");
  assert.equal(member.email, "ekip1@example.test");
  assert.equal(member.active, true);
  assert.equal(member.password, undefined);
  const stored = db.prepare("SELECT workspace_id, password_hash FROM users WHERE id = ?").get(member.id);
  assert.equal(stored.workspace_id, legacyWorkspace);
  assert.match(stored.password_hash, /^scrypt\$/);
  assert.ok(!stored.password_hash.includes(password));
  const roster = await result(owner.headers, "GET", "/team?pageSize=1", 200);
  assert.equal(roster.pagination.total, 2);
  assert.equal(roster.items.length, 1);
  const session = await login(member.email);
  assert.equal(session.user.role, "viewer");
  assert.equal((await result(session.headers, "GET", "/auth/session", 200)).user.isDemo, false);
  await result(owner.headers, "PATCH", `/team/${legacyOwner}`, 409, { role: "viewer", active: false });
});

test("viewer reads stock, operator changes stock, and only an administrator manages team or catalogue", async () => {
  const viewer = await add("read@example.test", "Salt Erişim", "viewer");
  const operator = await add("warehouse@example.test", "Depo Görevlisi", "operator");
  const reader = (await login(viewer.email)).headers;
  const worker = (await login(operator.email)).headers;
  for (const headers of [reader, worker]) {
    await result(headers, "GET", "/products", 200);
    await result(headers, "GET", "/stock-counts", 200);
    await result(headers, "GET", "/team", 403);
    for (const [method, path] of [["POST", "/products"], ["PATCH", `/products/${randomUUID()}`], ["POST", "/warehouses"], ["POST", "/team"]]) {
      await result(headers, method, path, 403, {});
    }
  }
  for (const path of ["/stock-movements", "/inventory/adjustments", "/transfers", "/stock-counts", `/stock-counts/${randomUUID()}/finish`]) {
    await result(reader, "POST", path, 403, {});
  }
  await result(reader, "PATCH", `/stock-counts/${randomUUID()}/items`, 403, {});
  assert.equal((await call(reader, "GET", "/export?view=movements")).statusCode, 200);
  await result(owner.headers, "PATCH", `/team/${viewer.id}`, 200, { role: "operator" });
  assert.equal((await result(reader, "GET", "/auth/session", 200)).user.role, "operator");
  await result(reader, "POST", "/stock-counts", 404, { warehouseId: randomUUID() });
  await result(owner.headers, "PATCH", `/team/${viewer.id}`, 200, { role: "viewer" });
  await result(reader, "POST", "/stock-counts", 403, { warehouseId: randomUUID() });
});

test("disabling an account revokes active sessions and workspace administrators cannot edit other members", async () => {
  const member = await add("retired@example.test", "Eski Üye", "operator");
  const session = await login(member.email);
  await result(owner.headers, "PATCH", `/team/${member.id}`, 200, { active: false });
  assert.equal((await result(session.headers, "GET", "/auth/session", 200)).authenticated, false);
  await result(session.headers, "GET", "/products", 401);
  await result(origin, "POST", "/auth/login", 401, { email: member.email, password });
  await result(owner.headers, "PATCH", `/team/${member.id}`, 200, { active: true });
  await result(session.headers, "GET", "/products", 401);
  assert.equal((await login(member.email)).user.role, "operator");

  const another = randomUUID();
  const outsiderId = randomUUID();
  const outsiderEmail = "foreign-owner@example.test";
  db.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)").run(another, "Başka işletme");
  db.prepare("INSERT INTO users (id, email, full_name, password_hash, workspace_id, role) VALUES (?, ?, ?, ?, ?, 'admin')")
    .run(outsiderId, outsiderEmail, "Başka Yönetici", oldDigest, another);
  const other = (await login(outsiderEmail)).headers;
  assert.deepEqual((await result(other, "GET", "/team", 200)).items.map(row => row.id), [outsiderId]);
  await result(other, "PATCH", `/team/${member.id}`, 404, { role: "admin" });
  await result(owner.headers, "PATCH", `/team/${outsiderId}`, 404, { active: false });
});

test("movement history uses the session actor for entries, transfers, corrections and count approvals", async () => {
  const member = await add("history@example.test", "İpek Örnek", "operator");
  const worker = (await login(member.email)).headers;
  const product = await result(owner.headers, "POST", "/products", 201, { name: "Kartuş", sku: "TEAM-P-1" });
  const source = await result(owner.headers, "POST", "/warehouses", 201, { name: "Ana", code: "TEAM-A" });
  const target = await result(owner.headers, "POST", "/warehouses", 201, { name: "Yedek", code: "TEAM-Y" });
  const base = { warehouseId: source.id, productId: product.id };
  db.prepare("INSERT INTO stock_movements (id, workspace_id, product_id, warehouse_id, type, quantity_delta) VALUES (?,?,?,?,?,?)")
    .run(randomUUID(), legacyWorkspace, product.id, source.id, "INBOUND", 1);
  await result(worker, "POST", "/stock-movements", 201, { ...base, type: "INBOUND", quantity: 10, actorId: legacyOwner, actorName: "sahte" });
  const transfer = await result(worker, "POST", "/transfers", 201, { productId: product.id, sourceWarehouseId: source.id, targetWarehouseId: target.id, quantity: 2 });
  await result(worker, "POST", "/inventory/adjustments", 201, { ...base, countedQuantity: 7 });
  const count = await result(worker, "POST", "/stock-counts", 201, { warehouseId: source.id });
  const page = await result(worker, "GET", `/stock-counts/${count.id}/items`, 200);
  const [row] = page.items;
  const draft = await result(worker, "PATCH", `/stock-counts/${count.id}/items`, 200, { revision: count.revision,
    items: [{ productId: product.id, previousCountedQuantity: null, countedQuantity: 6, expectedQuantity: row.systemQuantity, stockRevision: row.stockRevision }] });
  await result(owner.headers, "POST", `/stock-counts/${count.id}/finish`, 200, { revision: draft.revision, action: "approve" });
  const all = await result(owner.headers, "GET", "/stock-movements", 200);
  assert.equal(all.items.filter(item => item.actorId === member.id).length, 4);
  assert.equal(all.items.filter(item => item.referenceId === transfer.referenceId).every(item => item.actorName === "İpek Örnek"), true);
  assert.equal(all.items.find(item => item.referenceId === count.id).actorId, legacyOwner);
  assert.equal(all.items.filter(item => item.actorName === null).length, 1);
  const match = await result(owner.headers, "GET", `/stock-movements?q=${encodeURIComponent("İPEK ÖRNEK")}`, 200);
  assert.equal(match.items.length, 4);
  const csv = await call(owner.headers, "GET", "/export?view=movements");
  assert.match(csv.body, /İşlemi yapan/);
  assert.match(csv.body, /İpek Örnek/);
});

test("legacy demo remains usable without managing teams or signing in as a real member", async () => {
  const demo = await call(origin, "POST", "/auth/demo-login");
  assert.equal(demo.statusCode, 200);
  assert.equal(demo.json().user.isDemo, true);
  const headers = { ...origin, cookie: `stokpilot_session=${demo.cookies[0].value}` };
  await result(headers, "GET", "/products", 200);
  await result(headers, "GET", "/team", 403);
  await result(headers, "POST", "/team", 403, { email: "not-created@example.test", password, role: "admin", fullName: "Demo" });
  const member = await add("protected@example.test", "Gerçek Üye", "operator");
  const originalDemo = process.env.DEMO_EMAIL;
  try {
    process.env.DEMO_EMAIL = member.email;
    await result(origin, "POST", "/auth/demo-login", 503);
  } finally {
    process.env.DEMO_EMAIL = originalDemo;
  }
});
