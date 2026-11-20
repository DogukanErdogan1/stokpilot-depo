import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const temp = mkdtempSync(join(tmpdir(), "stokpilot-barcode-"));
process.env.DATABASE_PATH = join(temp, "test.sqlite");
process.env.PUBLIC_ORIGIN = "http://localhost";
const { db } = await import("../dist/db.js");
const { buildApp } = await import("../dist/app.js");
const app = await buildApp();
app.log.level = "silent";

function workspaceSession() {
  const workspace = randomUUID();
  const user = randomUUID();
  const token = randomUUID();
  db.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)").run(workspace, "Barkod testi");
  db.prepare("INSERT INTO users (id, email, full_name, password_hash, workspace_id) VALUES (?, ?, ?, ?, ?)")
    .run(user, `${user}@example.test`, "Test", "unused", workspace);
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .run(createHash("sha256").update(token).digest("hex"), user, "2100-01-01");
  return { cookie: `stokpilot_session=${token}`, origin: "http://localhost", host: "localhost" };
}

const headers = workspaceSession();
const otherHeaders = workspaceSession();
const lookup = (code, session = headers) => app.inject({
  url: `/api/products/by-barcode?${new URLSearchParams({ code })}`,
  headers: session,
});
const createProduct = (barcode, session = headers) => app.inject({
  url: "/api/products",
  method: "POST",
  headers: session,
  payload: { sku: randomUUID(), name: "Barkodlu ürün", barcode },
});

after(async () => {
  await app.close();
  db.close();
  for (const name of readdirSync(temp)) unlinkSync(join(temp, name));
  rmdirSync(temp);
});

test("barcode lookup preserves leading zeroes, matches UPC alternatives and stays within the workspace", async () => {
  const created = await createProduct("012345678905");
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().barcode, "012345678905");
  const id = created.json().id;

  assert.equal((await lookup("012345678905")).json().id, id);
  assert.equal((await lookup("0012345678905")).json().id, id);
  assert.equal((await lookup("012345678905", otherHeaders)).statusCode, 404);
  assert.equal((await lookup("012345678905", {})).statusCode, 401);
  assert.equal((await lookup("01234567890")).statusCode, 404);
  const list = await app.inject({ url: "/api/products?q=012345678905", headers });
  assert.equal(list.json().items[0].id, id);

  const duplicate = await createProduct("0012345678905");
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, "DUPLICATE_BARCODE");
  assert.equal((await createProduct("0012345678905", otherHeaders)).statusCode, 201);
});

test("barcode can be changed or removed and archived products cannot be selected", async () => {
  const created = await createProduct("WH-BOX/1");
  const url = `/api/products/${created.json().id}`;
  const update = payload => app.inject({ url, method: "PATCH", payload, headers });

  assert.equal((await update({ name: "Kutu" })).json().barcode, "WH-BOX/1");
  assert.equal((await update({ barcode: " WH-BOX/2 " })).json().barcode, "WH-BOX/2");
  assert.equal((await lookup("WH-BOX/1")).statusCode, 404);
  assert.equal((await lookup("WH-BOX/2")).statusCode, 200);
  assert.equal((await update({ archived: true })).statusCode, 200);
  assert.equal((await lookup("WH-BOX/2")).statusCode, 404);
  assert.equal((await update({ barcode: null })).json().barcode, null);
  assert.equal((await createProduct("WH-BOX/2")).statusCode, 201);
});

test("the scanned product can receive stock through the existing movement endpoint", async () => {
  const created = await createProduct("STOCK-ENTRY-LABEL");
  assert.equal(created.statusCode, 201);
  const warehouse = await app.inject({
    url: "/api/warehouses", method: "POST", headers, payload: { code: "SCAN-DEP", name: "Barkod deposu" },
  });
  assert.equal(warehouse.statusCode, 201);
  const warehouseId = warehouse.json().id;
  const selected = (await lookup("STOCK-ENTRY-LABEL")).json();
  assert.equal(selected.id, created.json().id);
  assert.equal(selected.stock[warehouseId], undefined);
  const move = await app.inject({
    url: "/api/stock-movements", method: "POST", headers,
    payload: { type: "INBOUND", warehouseId, productId: selected.id, quantity: 2 },
  });
  assert.equal(move.statusCode, 201);
  assert.equal((await lookup("STOCK-ENTRY-LABEL")).json().stock[warehouseId], 2);
});

test("camera policy and decoder are served from the application", async () => {
  const page = await app.inject("/");
  assert.match(page.headers["permissions-policy"], /camera=\(self\)/);
  const bundle = await app.inject("/zxing-browser.js");
  assert.equal(bundle.statusCode, 200);
  assert.match(bundle.headers["content-type"], /^text\/javascript/);
  assert.match(bundle.body, /BrowserMultiFormatReader/);
});
