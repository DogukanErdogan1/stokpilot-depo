import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { AppError } from "./errors.js";

type MovementType = "INBOUND" | "OUTBOUND" | "ADJUSTMENT" | "TRANSFER_IN" | "TRANSFER_OUT";

type StockChange = {
  productId: string;
  warehouseId: string;
  quantityDelta: number;
  type: MovementType;
  note?: string | null;
  referenceId?: string | null;
};

function ensureProductAndWarehouse(workspaceId: string, productId: string, warehouseId: string): void {
  const product = db.prepare("SELECT id, archived FROM products WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, productId) as { id: string; archived: number } | undefined;
  if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Ürün bulunamadı.");
  if (product.archived) throw new AppError(409, "PRODUCT_ARCHIVED", "Arşivlenmiş üründe stok işlemi yapılamaz.");

  const warehouse = db.prepare("SELECT id, archived FROM warehouses WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, warehouseId) as { id: string; archived: number } | undefined;
  if (!warehouse) throw new AppError(404, "WAREHOUSE_NOT_FOUND", "Depo bulunamadı.");
  if (warehouse.archived) throw new AppError(409, "WAREHOUSE_ARCHIVED", "Arşivlenmiş depoda stok işlemi yapılamaz.");
}

function applyStockChange(workspaceId: string, change: StockChange): { movementId: string; balance: number } {
  ensureProductAndWarehouse(workspaceId, change.productId, change.warehouseId);

  const current = db.prepare(`
    SELECT quantity FROM inventory_balances WHERE workspace_id = ? AND product_id = ? AND warehouse_id = ?
  `).get(workspaceId, change.productId, change.warehouseId) as { quantity: number } | undefined;

  const nextQuantity = (current?.quantity ?? 0) + change.quantityDelta;
  if (nextQuantity < 0) {
    throw new AppError(409, "INSUFFICIENT_STOCK", "İşlem için depoda yeterli stok yok.");
  }

  db.prepare(`
    INSERT INTO inventory_balances (workspace_id, product_id, warehouse_id, quantity)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(product_id, warehouse_id) DO UPDATE SET
      quantity = excluded.quantity,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).run(workspaceId, change.productId, change.warehouseId, nextQuantity);

  const movementId = randomUUID();
  db.prepare(`
    INSERT INTO stock_movements (id, workspace_id, product_id, warehouse_id, type, quantity_delta, reference_id, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    movementId,
    workspaceId,
    change.productId,
    change.warehouseId,
    change.type,
    change.quantityDelta,
    change.referenceId ?? null,
    change.note ?? null,
  );

  return { movementId, balance: nextQuantity };
}

export function createStockMovement(workspaceId: string, input: {
  productId: string;
  warehouseId: string;
  type: "INBOUND" | "OUTBOUND";
  quantity: number;
  note?: string | null;
}) {
  const quantityDelta = input.type === "INBOUND" ? input.quantity : -input.quantity;
  const transaction = db.transaction(() => applyStockChange(workspaceId, {
    ...input,
    quantityDelta,
  }));
  return transaction.immediate();
}

export function adjustInventory(workspaceId: string, input: {
  productId: string;
  warehouseId: string;
  countedQuantity: number;
  note?: string | null;
}) {
  const transaction = db.transaction(() => {
    ensureProductAndWarehouse(workspaceId, input.productId, input.warehouseId);
    const current = db.prepare(`
      SELECT quantity FROM inventory_balances WHERE workspace_id = ? AND product_id = ? AND warehouse_id = ?
    `).get(workspaceId, input.productId, input.warehouseId) as { quantity: number } | undefined;
    const quantityDelta = input.countedQuantity - (current?.quantity ?? 0);

    if (quantityDelta === 0) {
      throw new AppError(409, "NO_ADJUSTMENT_REQUIRED", "Sayım miktarı mevcut stokla aynı.");
    }

    return applyStockChange(workspaceId, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantityDelta,
      type: "ADJUSTMENT",
      note: input.note,
    });
  });
  return transaction.immediate();
}

export function transferStock(workspaceId: string, input: {
  productId: string;
  sourceWarehouseId: string;
  targetWarehouseId: string;
  quantity: number;
  note?: string | null;
}) {
  if (input.sourceWarehouseId === input.targetWarehouseId) {
    throw new AppError(400, "SAME_WAREHOUSE", "Kaynak ve hedef depo aynı olamaz.");
  }

  const transaction = db.transaction(() => {
    const referenceId = randomUUID();
    const source = applyStockChange(workspaceId, {
      productId: input.productId,
      warehouseId: input.sourceWarehouseId,
      quantityDelta: -input.quantity,
      type: "TRANSFER_OUT",
      note: input.note,
      referenceId,
    });
    const target = applyStockChange(workspaceId, {
      productId: input.productId,
      warehouseId: input.targetWarehouseId,
      quantityDelta: input.quantity,
      type: "TRANSFER_IN",
      note: input.note,
      referenceId,
    });
    return { referenceId, source, target };
  });

  return transaction.immediate();
}
