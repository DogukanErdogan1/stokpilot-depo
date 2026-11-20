import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { db } from "./db.js";
import { AppError } from "./errors.js";
import { adjustInventory } from "./inventory-service.js";
import { pageRows, searchPattern } from "./listing-service.js";
import type { countItemsQuerySchema, finishCountSchema, saveCountItemsSchema } from "./validation.js";

type Count = {
  id: string;
  warehouseId: string;
  warehouseName: string;
  warehouseArchived: number;
  status: "DRAFT" | "COMPLETED" | "CANCELLED";
  revision: number;
  createdAt: string;
  closedAt: string | null;
  counted: number;
  differences: number;
};

const countFrom = "stock_counts c JOIN warehouses w ON w.id = c.warehouse_id AND w.workspace_id = c.workspace_id";
const countColumns = `c.id, c.warehouse_id AS warehouseId, w.name AS warehouseName, w.archived AS warehouseArchived,
  c.status, c.revision, c.created_at AS createdAt, c.closed_at AS closedAt,
  (SELECT COUNT(*) FROM stock_count_items e WHERE e.count_id = c.id) AS counted,
  (SELECT COUNT(*) FROM stock_count_items e WHERE e.count_id = c.id AND e.counted_quantity <> e.expected_quantity) AS differences`;

function getCount(workspaceId: string, id: string): Count {
  const count = db.prepare(`SELECT ${countColumns} FROM ${countFrom} WHERE c.workspace_id = ? AND c.id = ?`)
    .get(workspaceId, id) as Count | undefined;
  if (!count) throw new AppError(404, "COUNT_NOT_FOUND", "Depo sayımı bulunamadı.");
  return count;
}

function requireDraft(count: Count, revision: number): void {
  if (count.status !== "DRAFT") throw new AppError(409, "COUNT_CLOSED", "Bu sayım kapatılmış.");
  if (count.revision !== revision) {
    throw new AppError(409, "COUNT_UPDATED", "Sayım başka bir oturumda değişti. Güncel kayıtları kontrol edip tekrar dene.");
  }
}

function requireActiveWarehouse(archived: number): void {
  if (archived) throw new AppError(409, "WAREHOUSE_ARCHIVED", "Arşivlenmiş depoda sayım yapılamaz.");
}

export function listStockCounts(workspaceId: string, query: { page: number; pageSize: number }) {
  return pageRows({
    prefix: "", from: countFrom, where: "WHERE c.workspace_id = ?", order: "c.created_at DESC, c.id", values: [workspaceId],
  }, countColumns, query.page, query.pageSize);
}

export function startStockCount(workspaceId: string, warehouseId: string) {
  return db.transaction(() => {
    const warehouse = db.prepare("SELECT archived FROM warehouses WHERE id = ? AND workspace_id = ?")
      .get(warehouseId, workspaceId) as { archived: number } | undefined;
    if (!warehouse) throw new AppError(404, "WAREHOUSE_NOT_FOUND", "Depo bulunamadı.");
    requireActiveWarehouse(warehouse.archived);
    const existing = db.prepare("SELECT id FROM stock_counts WHERE workspace_id = ? AND warehouse_id = ? AND status = 'DRAFT'")
      .get(workspaceId, warehouseId) as { id: string } | undefined;
    if (existing) return { created: false, count: getCount(workspaceId, existing.id) };
    const id = randomUUID();
    db.prepare("INSERT INTO stock_counts (id, workspace_id, warehouse_id) VALUES (?, ?, ?)").run(id, workspaceId, warehouseId);
    return { created: true, count: getCount(workspaceId, id) };
  }).immediate();
}

export function listStockCountItems(workspaceId: string, id: string, query: z.infer<typeof countItemsQuerySchema>) {
  return db.transaction(() => {
    const count = getCount(workspaceId, id);
    const includeUncounted = query.filter === "all" && count.status === "DRAFT";
    const product = includeUncounted ? "p" : "e";
    const from = includeUncounted
      ? "products p LEFT JOIN stock_count_items e ON e.product_id = p.id AND e.count_id = ?"
      : "stock_count_items e LEFT JOIN products p ON p.id = e.product_id AND p.workspace_id = ?";
    const values = [includeUncounted ? id : workspaceId, workspaceId, count.warehouseId, includeUncounted ? workspaceId : id];
    const conditions = [includeUncounted ? "p.workspace_id = ? AND p.archived = 0" : "e.count_id = ?"];
    if (query.filter === "differences") conditions.push("e.counted_quantity <> e.expected_quantity");
    if (query.q) {
      const term = searchPattern(query.q);
      conditions.push(`(search_text(${product}.name) LIKE ? ESCAPE '\\' OR search_text(${product}.sku) LIKE ? ESCAPE '\\' OR search_text(p.barcode) LIKE ? ESCAPE '\\')`);
      values.push(term, term, term);
    }
    const productId = includeUncounted ? "p.id" : "e.product_id";
    const result = pageRows({
      prefix: "",
      from: `${from} LEFT JOIN inventory_balances b ON b.product_id = p.id AND b.workspace_id = ? AND b.warehouse_id = ?`,
      where: `WHERE ${conditions.join(" AND ")}`,
      order: `${product}.name COLLATE NOCASE, ${productId}`,
      values,
    }, `${productId} AS productId, ${product}.name, ${product}.sku, ${product}.unit, p.barcode,
      COALESCE(b.quantity, 0) AS systemQuantity, COALESCE(b.revision, 0) AS stockRevision,
      e.expected_quantity AS expectedQuantity, e.counted_quantity AS countedQuantity,
      (p.id IS NOT NULL AND p.archived = 0) AS available,
      (${count.status === "DRAFT" ? "e.product_id IS NOT NULL AND (p.id IS NULL OR p.archived = 1 OR "
        + "e.stock_revision <> COALESCE(b.revision, 0) OR e.expected_quantity <> COALESCE(b.quantity, 0))" : "0"}) AS conflict`,
    query.page, query.pageSize);
    return { count, ...result };
  })();
}

export function saveStockCountItems(workspaceId: string, id: string, input: z.infer<typeof saveCountItemsSchema>) {
  return db.transaction(() => {
    const count = getCount(workspaceId, id);
    requireDraft(count, input.revision);
    requireActiveWarehouse(count.warehouseArchived);
    const savedItem = db.prepare("SELECT counted_quantity AS quantity FROM stock_count_items WHERE count_id = ? AND product_id = ?");
    const remove = db.prepare("DELETE FROM stock_count_items WHERE count_id = ? AND product_id = ?");
    const current = db.prepare(`SELECT p.sku, p.name, p.unit,
        COALESCE(b.quantity, 0) AS quantity, COALESCE(b.revision, 0) AS revision
      FROM products p LEFT JOIN inventory_balances b ON b.product_id = p.id AND b.workspace_id = p.workspace_id AND b.warehouse_id = ?
      WHERE p.id = ? AND p.workspace_id = ? AND p.archived = 0`);
    const save = db.prepare(`INSERT INTO stock_count_items
        (count_id, product_id, sku, name, unit, expected_quantity, counted_quantity, stock_revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(count_id, product_id) DO UPDATE SET sku = excluded.sku, name = excluded.name, unit = excluded.unit,
        expected_quantity = excluded.expected_quantity, counted_quantity = excluded.counted_quantity, stock_revision = excluded.stock_revision`);
    for (const item of input.items) {
      const previous = savedItem.get(id, item.productId) as { quantity: number } | undefined;
      if ((previous?.quantity ?? null) !== item.previousCountedQuantity) {
        throw new AppError(409, "COUNT_UPDATED", "Bir ürünün sayımı başka bir oturumda değişti. Güncel satırı kontrol edip miktarı yeniden gir.");
      }
      if (item.countedQuantity === null) {
        remove.run(id, item.productId);
        continue;
      }
      const product = current.get(count.warehouseId, item.productId, workspaceId) as
        { sku: string; name: string; unit: string; quantity: number; revision: number } | undefined;
      if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Sayımda aktif olmayan bir ürün var. Listeyi yenile.");
      if (product.quantity !== item.expectedQuantity || product.revision !== item.stockRevision) {
        throw new AppError(409, "COUNT_STOCK_CHANGED", `${product.name} ürününün stoğu değişti. Güncel stoğu kontrol edip ürünü yeniden say.`);
      }
      save.run(id, item.productId, product.sku, product.name, product.unit, product.quantity, item.countedQuantity, product.revision);
    }
    db.prepare("UPDATE stock_counts SET revision = revision + 1 WHERE id = ?").run(id);
    return getCount(workspaceId, id);
  }).immediate();
}

export function finishStockCount(workspaceId: string, id: string, input: z.infer<typeof finishCountSchema>) {
  const nextStatus = input.action === "approve" ? "COMPLETED" : "CANCELLED";
  return db.transaction(() => {
    const count = getCount(workspaceId, id);
    if (count.status === nextStatus) return count;
    requireDraft(count, input.revision);
    if (input.action === "approve") {
      requireActiveWarehouse(count.warehouseArchived);
      if (!count.counted) throw new AppError(409, "COUNT_EMPTY", "Onaylamak için en az bir ürünün sayımını kaydet.");
      const conflict = db.prepare(`SELECT e.name FROM stock_count_items e
        LEFT JOIN products p ON p.id = e.product_id AND p.workspace_id = ?
        LEFT JOIN inventory_balances b ON b.product_id = p.id AND b.workspace_id = ? AND b.warehouse_id = ?
        WHERE e.count_id = ? AND (p.id IS NULL OR p.archived = 1 OR
          e.stock_revision <> COALESCE(b.revision, 0) OR e.expected_quantity <> COALESCE(b.quantity, 0))
        ORDER BY e.name, e.product_id LIMIT 1`).get(workspaceId, workspaceId, count.warehouseId, id) as { name: string } | undefined;
      if (conflict) {
        throw new AppError(409, "COUNT_STOCK_CHANGED", `${conflict.name} ürününün stok kaydı değişti. İncelemede bu satırı yeniden say veya çıkar.`);
      }
      const differences = db.prepare(`SELECT product_id AS productId, counted_quantity AS countedQuantity FROM stock_count_items
        WHERE count_id = ? AND counted_quantity <> expected_quantity`).all(id) as Array<{ productId: string; countedQuantity: number }>;
      for (const item of differences) {
        adjustInventory(workspaceId, { ...item, warehouseId: count.warehouseId, referenceId: id, note: "Depo sayımı" });
      }
    }
    db.prepare(`UPDATE stock_counts SET status = ?, revision = revision + 1,
      closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(nextStatus, id);
    return getCount(workspaceId, id);
  }).immediate();
}
