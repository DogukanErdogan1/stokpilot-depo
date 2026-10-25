import { Readable } from "node:stream";
import type { z } from "zod";
import { db } from "./db.js";
import { stockListQuerySchema, movementListQuerySchema, warehouseListQuerySchema } from "./validation.js";

type StockQuery = z.infer<typeof stockListQuerySchema>;
type MovementQuery = z.infer<typeof movementListQuerySchema>;
type Row = Record<string, any>;
type SqlQuery = { prefix: string; from: string; where: string; order: string; values: Array<string | number> };
const productColumns = `p.id, p.sku, p.name, p.category, p.description, p.unit, p.cost, p.symbol, p.archived,
  p.minimum_stock_quantity AS minimumStockQuantity, p.created_at AS createdAt, p.updated_at AS updatedAt`;
const totalPrefix = `WITH totals AS (
  SELECT ib.product_id, SUM(ib.quantity) AS totalQuantity,
    SUM(CASE WHEN ib.quantity > 0 THEN 1 ELSE 0 END) AS warehouseCount
  FROM inventory_balances ib JOIN warehouses w ON w.id = ib.warehouse_id AND w.workspace_id = ib.workspace_id
  WHERE ib.workspace_id = ? AND w.archived = 0 GROUP BY ib.product_id
)`;
function searchPattern(text: string): string {
  return `%${text.normalize("NFKC").toLocaleLowerCase("tr-TR").replace(/[\\%_]/g, "\\$&")}%`;
}
export function enrichProducts(workspaceId: string, products: Row[]): Row[] {
  if (!products.length) return [];
  const stocks = new Map(products.map(p => [p.id, {} as Record<string, number>]));
  const balances = db.prepare(`SELECT product_id AS productId, warehouse_id AS warehouseId, quantity
    FROM inventory_balances WHERE workspace_id = ? AND product_id IN (${products.map(() => "?").join(",")})`)
    .all(workspaceId, ...products.map(p => p.id)) as Row[];
  for (const row of balances) stocks.get(row.productId)![row.warehouseId] = row.quantity;
  return products.map(p => ({ ...p, stock: stocks.get(p.id) }));
}
function stockSql(workspaceId: string, query: StockQuery, view: "products" | "inventory"): SqlQuery {
  const inventory = view === "inventory";
  const values: Array<string | number> = [workspaceId, workspaceId, query.archived ? 1 : 0];
  const conditions = ["p.workspace_id = ?", "p.archived = ?"];
  let from = `products p LEFT JOIN totals t ON t.product_id = p.id`;
  if (inventory) {
    from += ` JOIN warehouses w ON w.workspace_id = p.workspace_id AND w.archived = 0
      LEFT JOIN inventory_balances b ON b.product_id = p.id AND b.warehouse_id = w.id AND b.workspace_id = p.workspace_id`;
    if (query.warehouseId) { conditions.push("w.id = ?"); values.push(query.warehouseId); }
  } else if (query.warehouseId) {
    from += ` LEFT JOIN inventory_balances b ON b.product_id = p.id AND b.workspace_id = p.workspace_id AND b.warehouse_id = ?`;
    values.splice(1, 0, query.warehouseId);
  }
  const quantity = inventory && query.scope !== "total" || !inventory && query.warehouseId
    ? "COALESCE(b.quantity, 0)" : "COALESCE(t.totalQuantity, 0)";
  if (query.productId) { conditions.push("p.id = ?"); values.push(query.productId); }
  if (query.q) {
    conditions.push("(search_text(p.name) LIKE ? ESCAPE '\\' OR search_text(p.sku) LIKE ? ESCAPE '\\' OR search_text(p.category) LIKE ? ESCAPE '\\')");
    const term = searchPattern(query.q); values.push(term, term, term);
  }
  if (query.category) { conditions.push("p.category = ?"); values.push(query.category); }
  const status = query.lowStockOnly ? "low" : query.status;
  if (status === "empty") conditions.push(`${quantity} = 0`);
  if (status === "low") conditions.push(`${quantity} <= p.minimum_stock_quantity`);
  if (status === "ok") conditions.push(`${quantity} > p.minimum_stock_quantity`);
  for (const [minimum, maximum, expression] of [
    [query.minCost, query.maxCost, "p.cost"], [query.minQuantity, query.maxQuantity, quantity],
    [query.minWarehouses, query.maxWarehouses, "COALESCE(t.warehouseCount, 0)"],
  ] as const) {
    if (minimum !== undefined) { conditions.push(`${expression} >= ?`); values.push(minimum); }
    if (maximum !== undefined) { conditions.push(`${expression} <= ?`); values.push(maximum); }
  }
  const sorts: Record<string, string> = {
    name: "p.name COLLATE NOCASE ASC", "quantity-desc": `${quantity} DESC`, "quantity-asc": `${quantity} ASC`,
    "cost-desc": "p.cost DESC", "cost-asc": "p.cost ASC", "warehouses-desc": "COALESCE(t.warehouseCount, 0) DESC",
  };
  return { prefix: totalPrefix, from, where: `WHERE ${conditions.join(" AND ")}`,
    order: `${sorts[query.sort]}, p.name COLLATE NOCASE, p.id${inventory ? ", w.name COLLATE NOCASE, w.id" : ""}`, values };
}
function pageRows(sql: SqlQuery, columns: string, page: number, pageSize: number) {
  return db.transaction(() => {
    const { total } = db.prepare(`${sql.prefix} SELECT COUNT(*) AS total FROM ${sql.from} ${sql.where}`).get(...sql.values) as { total: number };
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const effectivePage = Math.min(page, totalPages);
    const items = db.prepare(`${sql.prefix} SELECT ${columns} FROM ${sql.from} ${sql.where} ORDER BY ${sql.order} LIMIT ? OFFSET ?`)
      .all(...sql.values, pageSize, (effectivePage - 1) * pageSize) as Row[];
    return { items, pagination: { page: effectivePage, pageSize, total, totalPages, hasNext: effectivePage < totalPages, hasPrevious: effectivePage > 1 } };
  })();
}
export function listProducts(workspaceId: string, query: StockQuery) {
  const result = pageRows(stockSql(workspaceId, query, "products"), productColumns, query.page, query.pageSize);
  return { ...result, items: enrichProducts(workspaceId, result.items) };
}
export function listInventory(workspaceId: string, query: StockQuery) {
  const result = pageRows(stockSql(workspaceId, { ...query, archived: false }, "inventory"), `${productColumns},
    w.id AS warehouseId, COALESCE(b.quantity, 0) AS quantity`, query.page, query.pageSize);
  const uniqueProducts = [...new Map(result.items.map(({warehouseId, quantity, ...product}) => [product.id, product])).values()];
  const products = new Map(enrichProducts(workspaceId, uniqueProducts).map(p => [p.id, p]));
  return { ...result, items: result.items.map(row => ({ product: products.get(row.id), warehouseId: row.warehouseId, quantity: row.quantity })) };
}
function movementSql(workspaceId: string, query: MovementQuery): SqlQuery {
  const conditions = ["sm.workspace_id = ?"], values: Array<string | number> = [workspaceId];
  for (const [value, column] of [[query.productId, "sm.product_id"], [query.warehouseId, "sm.warehouse_id"], [query.type, "sm.type"]] as const) {
    if (value) { conditions.push(`${column} = ?`); values.push(value); }
  }
  if (query.q) {
    conditions.push("(search_text(p.name) LIKE ? ESCAPE '\\' OR search_text(p.sku) LIKE ? ESCAPE '\\' OR search_text(w.name) LIKE ? ESCAPE '\\' OR search_text(COALESCE(sm.note, '')) LIKE ? ESCAPE '\\')");
    const term = searchPattern(query.q); values.push(term, term, term, term);
  }
  return { prefix: "", from: `stock_movements sm
    JOIN products p ON p.id = sm.product_id AND p.workspace_id = sm.workspace_id
    JOIN warehouses w ON w.id = sm.warehouse_id AND w.workspace_id = sm.workspace_id`,
    where: `WHERE ${conditions.join(" AND ")}`, order: "sm.created_at DESC, sm.rowid DESC", values };
}
export function listMovements(workspaceId: string, query: MovementQuery) {
  return pageRows(movementSql(workspaceId, query), `sm.id, sm.type, sm.quantity_delta AS quantityDelta,
    sm.note, sm.reference_id AS referenceId, sm.created_at AS createdAt,
    p.id AS productId, p.name AS productName, p.sku, p.unit, p.symbol,
    w.id AS warehouseId, w.name AS warehouseName, w.code AS warehouseCode`, query.page, query.pageSize);
}
export function listWarehouses(workspaceId: string, query: z.infer<typeof warehouseListQuerySchema>) {
  const location = "COALESCE(NULLIF(TRIM(w.location), ''), NULLIF(TRIM(w.address), ''), '')";
  const conditions = ["w.workspace_id = ?", "w.archived = ?"];
  const values: Array<string | number> = [workspaceId, workspaceId, workspaceId, query.archived ? 1 : 0];
  if (query.q) {
    conditions.push("(search_text(w.name) LIKE ? ESCAPE '\\' OR search_text(w.code) LIKE ? ESCAPE '\\' OR search_text(COALESCE(w.address, '')) LIKE ? ESCAPE '\\' OR search_text(COALESCE(w.location, '')) LIKE ? ESCAPE '\\')");
    const pattern = searchPattern(query.q); values.push(pattern, pattern, pattern, pattern);
  }
  if (query.location !== undefined) {
    conditions.push(`search_text(${location}) = search_text(?)`); values.push(query.location);
  }
  const orders = { name: "w.name COLLATE NOCASE", "quantity-desc": "COALESCE(b.quantity, 0) DESC",
    "products-desc": "COALESCE(b.productCount, 0) DESC", "critical-desc": "c.productCount - COALESCE(b.healthyCount, 0) DESC" };
  const sql: SqlQuery = {
    prefix: `WITH balances AS (
      SELECT ib.warehouse_id, SUM(ib.quantity) AS quantity,
        SUM(CASE WHEN ib.quantity > 0 THEN 1 ELSE 0 END) AS productCount,
        SUM(CASE WHEN ib.quantity > p.minimum_stock_quantity THEN 1 ELSE 0 END) AS healthyCount
      FROM inventory_balances ib JOIN products p ON p.id = ib.product_id AND p.workspace_id = ib.workspace_id AND p.archived = 0
      WHERE ib.workspace_id = ? GROUP BY ib.warehouse_id
    ), catalog AS (SELECT COUNT(*) AS productCount FROM products WHERE workspace_id = ? AND archived = 0)`,
    from: "warehouses w LEFT JOIN balances b ON b.warehouse_id = w.id CROSS JOIN catalog c",
    where: `WHERE ${conditions.join(" AND ")}`, order: `${orders[query.sort]}, w.name COLLATE NOCASE, w.id`, values,
  };
  return db.transaction(() => {
    const result = pageRows(sql, `w.id, w.code, w.name, w.address, w.location, w.archived, w.created_at AS createdAt,
      ${location} AS locationLabel, COALESCE(b.quantity, 0) AS count, COALESCE(b.productCount, 0) AS products,
      c.productCount - COALESCE(b.healthyCount, 0) AS lowCount`, query.page, query.pageSize);
    const locations = db.prepare(`SELECT MIN(${location}) AS value, SUM(w.archived = ?) AS count
      FROM warehouses w WHERE w.workspace_id = ? GROUP BY search_text(${location}) ORDER BY search_text(${location})`)
      .all(query.archived ? 1 : 0, workspaceId);
    const counts = db.prepare(`SELECT COALESCE(SUM(archived = 0), 0) AS active, COALESCE(SUM(archived = 1), 0) AS archived
      FROM warehouses WHERE workspace_id = ?`).get(workspaceId);
    return { ...result, facets: { locations }, counts };
  })();
}

export function overview(workspaceId: string) {
  return db.transaction(() => {
    const metrics = db.prepare(`${totalPrefix} SELECT COUNT(*) AS productCount,
      COALESCE(SUM(COALESCE(t.totalQuantity, 0)), 0) AS totalQuantity,
      COALESCE(SUM(COALESCE(t.totalQuantity, 0) * p.cost), 0) AS stockValue,
      COALESCE(SUM(CASE WHEN COALESCE(t.totalQuantity, 0) <= p.minimum_stock_quantity THEN 1 ELSE 0 END), 0) AS criticalCount,
      COALESCE(SUM(CASE WHEN COALESCE(t.totalQuantity, 0) = 0 THEN 1 ELSE 0 END), 0) AS emptyCount
      FROM products p LEFT JOIN totals t ON t.product_id = p.id WHERE p.workspace_id = ? AND p.archived = 0`)
      .get(workspaceId, workspaceId) as Row;
    metrics.archivedProductCount = (db.prepare("SELECT COUNT(*) AS total FROM products WHERE workspace_id = ? AND archived = 1").get(workspaceId) as Row).total;
    const warehouses = db.prepare(`SELECT w.id, w.code, w.name, w.address, w.location, w.archived,
      COALESCE(SUM(CASE WHEN p.archived = 0 THEN ib.quantity ELSE 0 END), 0) AS count,
      SUM(CASE WHEN p.archived = 0 AND ib.quantity > 0 THEN 1 ELSE 0 END) AS products,
      ? - SUM(CASE WHEN p.archived = 0 AND ib.quantity > p.minimum_stock_quantity THEN 1 ELSE 0 END) AS lowCount
      FROM warehouses w LEFT JOIN inventory_balances ib ON ib.warehouse_id = w.id AND ib.workspace_id = w.workspace_id
      LEFT JOIN products p ON p.id = ib.product_id AND p.workspace_id = w.workspace_id
      WHERE w.workspace_id = ? GROUP BY w.id ORDER BY w.name COLLATE NOCASE, w.id`).all(metrics.productCount, workspaceId) as Row[];
    const alerts = listProducts(workspaceId, stockListQuerySchema.parse({ status: "low", sort: "quantity-asc", pageSize: 8 })).items;
    const recentMovements = listMovements(workspaceId, movementListQuerySchema.parse({ pageSize: 5 })).items;
    const categories = (db.prepare("SELECT DISTINCT category FROM products WHERE workspace_id = ? ORDER BY category COLLATE NOCASE").all(workspaceId) as Row[]).map(r => r.category);
    return { metrics, warehouses, alerts, recentMovements, categories };
  })();
}
function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (typeof value === "string" && /^\s*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function exportRows(workspaceId: string, view: "products" | "inventory" | "movements", query: StockQuery | MovementQuery): Readable {
  let sql: SqlQuery, columns: string, headings: string[], rowValues: (row: Row) => unknown[];
  if (view === "movements") {
    sql = movementSql(workspaceId, query as MovementQuery);
    columns = "sm.created_at, p.name, p.sku, sm.type, w.name AS warehouseName, sm.quantity_delta, p.unit, sm.note";
    headings = ["Tarih", "Ürün", "SKU", "İşlem", "Depo", "Miktar", "Birim", "Açıklama"];
    rowValues = r => [r.created_at, r.name, r.sku, r.type, r.warehouseName, r.quantity_delta, r.unit, r.note];
  } else {
    const filters = query as StockQuery;
    sql = stockSql(workspaceId, { ...filters, archived: view === "products" && filters.archived }, view);
    if (view === "products") {
      sql = { prefix: `${sql.prefix}, matched AS (SELECT p.id FROM ${sql.from} ${sql.where})`,
        from: `products p JOIN matched m ON m.id = p.id JOIN warehouses w ON w.workspace_id = p.workspace_id AND w.archived = 0
          LEFT JOIN inventory_balances b ON b.product_id = p.id AND b.warehouse_id = w.id AND b.workspace_id = p.workspace_id`,
        where: filters.warehouseId ? "WHERE w.id = ?" : "", order: "p.name COLLATE NOCASE, p.id, w.name COLLATE NOCASE, w.id",
        values: [...sql.values, ...(filters.warehouseId ? [filters.warehouseId] : [])] };
    }
    columns = `p.name, p.sku, p.category, w.name AS warehouseName, COALESCE(b.quantity, 0) AS quantity, p.unit, p.cost, p.minimum_stock_quantity AS minimum`;
    headings = ["Ürün", "SKU", "Kategori", "Depo", "Miktar", "Birim", "Birim maliyet (₺)", "Stok değeri (₺)", "Minimum", "Durum"];
    rowValues = r => [r.name, r.sku, r.category, r.warehouseName, r.quantity, r.unit, r.cost, r.quantity * r.cost, r.minimum,
      r.quantity === 0 ? "Tükendi" : r.quantity <= r.minimum ? "Kritik" : "Stokta"];
  }
  const statement = db.prepare(`${sql.prefix} SELECT ${columns} FROM ${sql.from} ${sql.where} ORDER BY ${sql.order} LIMIT ? OFFSET ?`);
  async function* rows() {
    yield "\uFEFF" + headings.map(csvCell).join(";") + "\r\n";
    for (let offset = 0; ; offset += 500) {
      const batch = statement.all(...sql.values, 500, offset) as Row[];
      if (!batch.length) break;
      yield batch.map(row => rowValues(row).map(csvCell).join(";")).join("\r\n") + "\r\n";
      if (batch.length < 500) break;
    }
  }
  return Readable.from(rows());
}
