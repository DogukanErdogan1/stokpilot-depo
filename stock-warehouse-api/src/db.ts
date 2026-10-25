import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const configuredPath = process.env.DATABASE_PATH ?? "./data/inventory.sqlite";
const databasePath = resolve(configuredPath);
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Genel',
    description TEXT,
    unit TEXT NOT NULL DEFAULT 'adet',
    cost INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
    symbol TEXT NOT NULL DEFAULT '□',
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    minimum_stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock_quantity >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL,
    address TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS inventory_balances (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (product_id, warehouse_id)
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK (type IN ('INBOUND', 'OUTBOUND', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT')),
    quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
    reference_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_movements_created_at ON stock_movements(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_movements_product_warehouse ON stock_movements(product_id, warehouse_id);
  CREATE INDEX IF NOT EXISTS idx_inventory_warehouse ON inventory_balances(warehouse_id);
`);

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing("products", "category", "TEXT NOT NULL DEFAULT 'Genel'");
addColumnIfMissing("products", "cost", "INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0)");
addColumnIfMissing("products", "symbol", "TEXT NOT NULL DEFAULT '□'");
addColumnIfMissing("products", "archived", "INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))");
addColumnIfMissing("warehouses", "archived", "INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))");

addColumnIfMissing("users", "workspace_id", "TEXT REFERENCES workspaces(id) ON DELETE CASCADE");
addColumnIfMissing("products", "workspace_id", "TEXT REFERENCES workspaces(id) ON DELETE CASCADE");
addColumnIfMissing("warehouses", "workspace_id", "TEXT REFERENCES workspaces(id) ON DELETE CASCADE");
addColumnIfMissing("inventory_balances", "workspace_id", "TEXT REFERENCES workspaces(id) ON DELETE CASCADE");
addColumnIfMissing("stock_movements", "workspace_id", "TEXT REFERENCES workspaces(id) ON DELETE CASCADE");

const unassignedUsers = db.prepare(`
  SELECT id, full_name AS fullName FROM users WHERE workspace_id IS NULL ORDER BY created_at, id
`).all() as Array<{ id: string; fullName: string }>;
const addWorkspace = db.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)");
const assignWorkspace = db.prepare("UPDATE users SET workspace_id = ? WHERE id = ?");
for (const user of unassignedUsers) {
  const workspaceId = randomUUID();
  addWorkspace.run(workspaceId, user.fullName);
  assignWorkspace.run(workspaceId, user.id);
}

const primaryWorkspace = db.prepare("SELECT workspace_id AS workspaceId FROM users ORDER BY created_at, id LIMIT 1")
  .get() as { workspaceId: string | null } | undefined;
if (primaryWorkspace?.workspaceId) {
  for (const table of ["products", "warehouses", "inventory_balances", "stock_movements"]) {
    db.prepare(`UPDATE ${table} SET workspace_id = ? WHERE workspace_id IS NULL`).run(primaryWorkspace.workspaceId);
  }
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_products_workspace_name ON products(workspace_id, name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_warehouses_workspace_name ON warehouses(workspace_id, name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_inventory_workspace ON inventory_balances(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_movements_workspace_created ON stock_movements(workspace_id, created_at DESC);
`);

db.function("search_text", { deterministic: true }, (value: unknown) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("tr-TR"));
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_products_workspace_archive_name ON products(workspace_id, archived, name COLLATE NOCASE, id);
  CREATE INDEX IF NOT EXISTS idx_inventory_workspace_product ON inventory_balances(workspace_id, product_id, warehouse_id);
  CREATE INDEX IF NOT EXISTS idx_inventory_workspace_warehouse ON inventory_balances(workspace_id, warehouse_id, product_id);
`);
