import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const configuredPath = process.env.DATABASE_PATH ?? "./data/inventory.sqlite";
const databasePath = resolve(configuredPath);
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
// Readers may return UPC-A as EAN-13 with a leading zero.
export const barcodeKeySql = "CASE WHEN length(barcode) = 12 AND barcode NOT GLOB '*[^0-9]*' THEN '0' || barcode ELSE barcode END";
export const barcodeKey = (barcode: string) => /^\d{12}$/.test(barcode) ? `0${barcode}` : barcode;
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

  CREATE TABLE IF NOT EXISTS stock_counts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COMPLETED', 'CANCELLED')),
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    closed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS stock_count_items (
    count_id TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    expected_quantity INTEGER NOT NULL CHECK (expected_quantity >= 0),
    stock_revision INTEGER NOT NULL CHECK (stock_revision >= 0),
    counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
    PRIMARY KEY (count_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    contact TEXT,
    email TEXT,
    phone TEXT,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS product_imports (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    csv_digest TEXT NOT NULL,
    imported INTEGER NOT NULL CHECK (imported > 0),
    PRIMARY KEY (workspace_id, request_id)
  );

  CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    order_number INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIAL', 'RECEIVED', 'CANCELLED')),
    expected_date TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (workspace_id, order_number),
    UNIQUE (workspace_id, request_id)
  );

  CREATE TABLE IF NOT EXISTS purchase_order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    received INTEGER NOT NULL DEFAULT 0 CHECK (received >= 0 AND received <= quantity),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    UNIQUE (order_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS purchase_receipts (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (order_id, request_id)
  );

  CREATE TABLE IF NOT EXISTS purchase_receipt_items (
    receipt_id TEXT NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (receipt_id, item_id)
  );

  CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(workspace_id, name COLLATE NOCASE, id);
  CREATE INDEX IF NOT EXISTS idx_purchase_order_warehouse ON purchase_orders(workspace_id, warehouse_id, status);
  CREATE INDEX IF NOT EXISTS idx_purchase_order_product ON purchase_order_items(product_id, order_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_counts_open_warehouse
    ON stock_counts(workspace_id, warehouse_id) WHERE status = 'DRAFT';
  CREATE INDEX IF NOT EXISTS idx_stock_counts_workspace_created ON stock_counts(workspace_id, created_at DESC, id);
  CREATE INDEX IF NOT EXISTS idx_movements_created_at ON stock_movements(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_movements_product_warehouse ON stock_movements(product_id, warehouse_id);
  CREATE INDEX IF NOT EXISTS idx_inventory_warehouse ON inventory_balances(warehouse_id);
`);

function addColumnIfMissing(table: string, column: string, definition: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

addColumnIfMissing("products", "category", "TEXT NOT NULL DEFAULT 'Genel'");
addColumnIfMissing("products", "cost", "INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0)");
addColumnIfMissing("products", "symbol", "TEXT NOT NULL DEFAULT '□'");
addColumnIfMissing("products", "archived", "INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))");
addColumnIfMissing("products", "barcode", "TEXT");
addColumnIfMissing("warehouses", "archived", "INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))");
addColumnIfMissing("warehouses", "location", "TEXT");

addColumnIfMissing("users", "workspace_id", "TEXT REFERENCES workspaces(id) ON DELETE CASCADE");
addColumnIfMissing("products", "workspace_id", "TEXT REFERENCES workspaces(id) ON DELETE CASCADE");
addColumnIfMissing("warehouses", "workspace_id", "TEXT REFERENCES workspaces(id) ON DELETE CASCADE");
addColumnIfMissing("inventory_balances", "workspace_id", "TEXT REFERENCES workspaces(id) ON DELETE CASCADE");
addColumnIfMissing("inventory_balances", "revision", "INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)");
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

db.transaction(() => {
  if (addColumnIfMissing("users", "role", "TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','operator','viewer'))")) {
    // Before teams, each existing user owned a separate workspace.
    db.exec("UPDATE users SET role = 'admin'");
  }
  addColumnIfMissing("users", "is_active", "INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))");
  if (addColumnIfMissing("workspaces", "is_demo", "INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1))")) {
    const demo = process.env.DEMO_EMAIL?.trim().toLowerCase();
    const admin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (demo && demo !== admin) {
      db.prepare(`UPDATE workspaces SET is_demo = 1 WHERE id = (SELECT workspace_id FROM users WHERE email = ?)
        AND (SELECT COUNT(*) FROM users WHERE workspace_id = workspaces.id) = 1`).run(demo);
    }
  }
  addColumnIfMissing("stock_movements", "actor_user_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  addColumnIfMissing("stock_movements", "actor_name", "TEXT");
}).immediate();

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_products_workspace_name ON products(workspace_id, name COLLATE NOCASE);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_products_workspace_barcode ON products(workspace_id, (${barcodeKeySql})) WHERE barcode IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_warehouses_workspace_name ON warehouses(workspace_id, name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_inventory_workspace ON inventory_balances(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_movements_workspace_created ON stock_movements(workspace_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_movements_workspace_warehouse_created ON stock_movements(workspace_id, warehouse_id, created_at);
`);

db.function("search_text", { deterministic: true }, (value: unknown) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("tr-TR"));
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_products_workspace_archive_name ON products(workspace_id, archived, name COLLATE NOCASE, id);
  CREATE INDEX IF NOT EXISTS idx_inventory_workspace_product ON inventory_balances(workspace_id, product_id, warehouse_id);
  CREATE INDEX IF NOT EXISTS idx_inventory_workspace_warehouse ON inventory_balances(workspace_id, warehouse_id, product_id);
`);

db.exec("CREATE INDEX IF NOT EXISTS idx_warehouses_workspace_archive_name ON warehouses(workspace_id, archived, name COLLATE NOCASE, id)");

const pendingProduct = `SELECT 1 FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.order_id
  WHERE i.product_id = OLD.id AND o.workspace_id = OLD.workspace_id
    AND o.status IN ('OPEN', 'PARTIAL') AND i.received < i.quantity`;
db.exec(`
  CREATE TRIGGER IF NOT EXISTS protect_pending_purchase_product_archival
  BEFORE UPDATE OF archived ON products WHEN NEW.archived = 1 AND OLD.archived = 0 AND EXISTS (${pendingProduct})
  BEGIN SELECT RAISE(ABORT, 'OPEN_PURCHASE_PRODUCT'); END;
  CREATE TRIGGER IF NOT EXISTS protect_pending_purchase_product_deletion
  BEFORE DELETE ON products WHEN EXISTS (${pendingProduct})
  BEGIN SELECT RAISE(ABORT, 'OPEN_PURCHASE_PRODUCT'); END;
  CREATE TRIGGER IF NOT EXISTS protect_pending_purchase_warehouse_archival
  BEFORE UPDATE OF archived ON warehouses WHEN NEW.archived = 1 AND OLD.archived = 0 AND EXISTS (
    SELECT 1 FROM purchase_orders o WHERE o.workspace_id = OLD.workspace_id AND o.warehouse_id = OLD.id AND o.status IN ('OPEN','PARTIAL')
  )
  BEGIN SELECT RAISE(ABORT, 'OPEN_PURCHASE_WAREHOUSE'); END;
`);
