import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { db } from "./db.js";
import { getRequestUser } from "./auth.js";
import { AppError } from "./errors.js";
import { createStockMovement, type MovementActor } from "./inventory-service.js";
import { pageRows, searchPattern } from "./listing-service.js";
import { createPurchaseSchema, createSupplierSchema, idParamsSchema, parse, purchaseListQuery, receivePurchaseSchema, supplierListQuery, updateSupplierSchema } from "./validation.js";

type Supplier = { id: string; name: string; contact: string | null; email: string | null; phone: string | null; note: string | null };
type Order = {
  id: string; number: number; supplierId: string; supplierName: string; warehouseId: string; warehouseName: string;
  status: "OPEN" | "PARTIAL" | "RECEIVED" | "CANCELLED"; expectedDate: string | null; note: string | null;
  createdAt: string; itemCount: number; pendingCount: number; totalCents: number;
};
type OrderItem = { id: string; productId: string; sku: string; name: string; unit: string; quantity: number; received: number; unitPriceCents: number };
type PurchaseInput = z.infer<typeof createPurchaseSchema>;
type ReceiptInput = z.infer<typeof receivePurchaseSchema>;

const supplierColumns = "id, name, contact, email, phone, note";
const orderFrom = `purchase_orders o JOIN suppliers s ON s.id = o.supplier_id AND s.workspace_id = o.workspace_id
  JOIN warehouses w ON w.id = o.warehouse_id AND w.workspace_id = o.workspace_id`;
const orderColumns = `o.id, o.order_number AS number, o.supplier_id AS supplierId, s.name AS supplierName,
  o.warehouse_id AS warehouseId, w.name AS warehouseName, o.status, o.expected_date AS expectedDate, o.note, o.created_at AS createdAt,
  (SELECT COUNT(*) FROM purchase_order_items i WHERE i.order_id = o.id) AS itemCount,
  (SELECT COUNT(*) FROM purchase_order_items i WHERE i.order_id = o.id AND i.received < i.quantity) AS pendingCount,
  (SELECT SUM(i.quantity * i.unit_price_cents) FROM purchase_order_items i WHERE i.order_id = o.id) AS totalCents`;
const orderItemColumns = "id, product_id AS productId, sku, name, unit, quantity, received, unit_price_cents AS unitPriceCents";
const orderNumber = (number: number) => `SA-${String(number).padStart(4, "0")}`;

function getSupplier(workspaceId: string, id: string): Supplier {
  const supplier = db.prepare(`SELECT ${supplierColumns} FROM suppliers WHERE workspace_id = ? AND id = ?`)
    .get(workspaceId, id) as Supplier | undefined;
  if (!supplier) throw new AppError(404, "SUPPLIER_NOT_FOUND", "Tedarikçi bulunamadı.");
  return supplier;
}

function getOrder(workspaceId: string, id: string): Order {
  const order = db.prepare(`SELECT ${orderColumns} FROM ${orderFrom} WHERE o.workspace_id = ? AND o.id = ?`)
    .get(workspaceId, id) as Order | undefined;
  if (!order) throw new AppError(404, "PURCHASE_NOT_FOUND", "Satın alma siparişi bulunamadı.");
  return order;
}

function orderItems(id: string): OrderItem[] {
  return db.prepare(`SELECT ${orderItemColumns} FROM purchase_order_items WHERE order_id = ? ORDER BY name COLLATE NOCASE, id`).all(id) as OrderItem[];
}

function requireOpenOrder(order: Order) {
  if (order.status === "RECEIVED" || order.status === "CANCELLED") {
    throw new AppError(409, "PURCHASE_CLOSED", "Bu sipariş kapatılmış.");
  }
}

function createOrder(workspaceId: string, input: PurchaseInput) {
  return db.transaction(() => {
    const existing = db.prepare("SELECT id FROM purchase_orders WHERE workspace_id = ? AND request_id = ?")
      .get(workspaceId, input.requestId) as { id: string } | undefined;
    if (existing) {
      const order = getOrder(workspaceId, existing.id);
      const items = new Map(orderItems(order.id).map(item => [item.productId, item]));
      const same = order.supplierId === input.supplierId && order.warehouseId === input.warehouseId
        && order.expectedDate === (input.expectedDate ?? null) && order.note === (input.note ?? null)
        && items.size === input.items.length && input.items.every(item => {
          const previous = items.get(item.productId);
          return previous?.quantity === item.quantity && previous.unitPriceCents === item.unitPriceCents;
        });
      if (!same) throw new AppError(409, "PURCHASE_REQUEST_USED", "Bu istekle daha önce farklı bir sipariş oluşturuldu. Listeyi kontrol et.");
      return { order, created: false };
    }
    getSupplier(workspaceId, input.supplierId);
    const warehouse = db.prepare("SELECT archived FROM warehouses WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, input.warehouseId) as { archived: number } | undefined;
    if (!warehouse) throw new AppError(404, "WAREHOUSE_NOT_FOUND", "Depo bulunamadı.");
    if (warehouse.archived) throw new AppError(409, "WAREHOUSE_ARCHIVED", "Arşivlenmiş depoya sipariş açılamaz.");
    const total = input.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
    if (!Number.isSafeInteger(total)) throw new AppError(400, "PURCHASE_TOTAL_LIMIT", "Sipariş tutarı desteklenen sınırı aşıyor.");
    const { number } = db.prepare("SELECT COALESCE(MAX(order_number), 0) + 1 AS number FROM purchase_orders WHERE workspace_id = ?")
      .get(workspaceId) as { number: number };
    const id = randomUUID();
    db.prepare(`INSERT INTO purchase_orders (id, workspace_id, order_number, request_id, supplier_id, warehouse_id, expected_date, note)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, workspaceId, number, input.requestId, input.supplierId, input.warehouseId, input.expectedDate ?? null, input.note ?? null);
    const find = db.prepare("SELECT sku, name, unit FROM products WHERE workspace_id = ? AND id = ? AND archived = 0");
    const add = db.prepare(`INSERT INTO purchase_order_items (id, order_id, product_id, sku, name, unit, quantity, unit_price_cents)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (const item of input.items) {
      const product = find.get(workspaceId, item.productId) as { sku: string; name: string; unit: string } | undefined;
      if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Siparişte bulunamayan veya arşivlenmiş ürün var.");
      add.run(randomUUID(), id, item.productId, product.sku, product.name, product.unit, item.quantity, item.unitPriceCents);
    }
    return { order: getOrder(workspaceId, id), created: true };
  }).immediate();
}

function receiveOrder(workspaceId: string, actor: MovementActor, id: string, input: ReceiptInput) {
  return db.transaction(() => {
    const order = getOrder(workspaceId, id);
    const existing = db.prepare("SELECT id FROM purchase_receipts WHERE order_id = ? AND request_id = ?")
      .get(id, input.requestId) as { id: string } | undefined;
    if (existing) {
      const rows = db.prepare("SELECT item_id AS itemId, quantity FROM purchase_receipt_items WHERE receipt_id = ?")
        .all(existing.id) as ReceiptInput["items"];
      const received = new Map(rows.map(item => [item.itemId, item.quantity]));
      if (received.size !== input.items.length || !input.items.every(item => received.get(item.itemId) === item.quantity)) {
        throw new AppError(409, "RECEIPT_REQUEST_USED", "Bu istekle farklı bir teslimat kaydedilmiş. Teslimat geçmişini kontrol et.");
      }
      return { order, receiptId: existing.id, created: false };
    }
    requireOpenOrder(order);
    const items = new Map(orderItems(id).map(item => [item.id, item]));
    const receiptId = randomUUID();
    db.prepare("INSERT INTO purchase_receipts (id, order_id, request_id, actor_name) VALUES (?, ?, ?, ?)")
      .run(receiptId, id, input.requestId, actor.fullName);
    const addLine = db.prepare("INSERT INTO purchase_receipt_items (receipt_id, item_id, quantity) VALUES (?,?,?)");
    const updateLine = db.prepare("UPDATE purchase_order_items SET received = received + ? WHERE id = ?");
    for (const line of input.items) {
      const item = items.get(line.itemId);
      if (!item) throw new AppError(404, "PURCHASE_ITEM_NOT_FOUND", "Teslimat kalemi bu siparişte bulunamadı.");
      if (line.quantity > item.quantity - item.received) {
        throw new AppError(409, "PURCHASE_OVERRUN", `${item.name} için kalan miktardan fazla teslimat girilemez.`);
      }
      createStockMovement(workspaceId, actor, {
        productId: item.productId, warehouseId: order.warehouseId, type: "INBOUND", quantity: line.quantity,
        referenceId: receiptId, note: `${orderNumber(order.number)} satın alma teslimatı`,
      });
      addLine.run(receiptId, item.id, line.quantity);
      updateLine.run(line.quantity, item.id);
    }
    db.prepare(`UPDATE purchase_orders SET status = CASE WHEN
      EXISTS (SELECT 1 FROM purchase_order_items WHERE order_id = ? AND received < quantity)
      THEN 'PARTIAL' ELSE 'RECEIVED' END WHERE id = ?`).run(id, id);
    return { order: getOrder(workspaceId, id), receiptId, created: true };
  }).immediate();
}

function getOrderDetail(workspaceId: string, id: string) {
  return db.transaction(() => {
    const order = getOrder(workspaceId, id);
    const receipts = db.prepare(`SELECT r.id, r.actor_name AS actorName, r.created_at AS createdAt,
      COUNT(ri.item_id) AS itemCount FROM purchase_receipts r JOIN purchase_receipt_items ri ON ri.receipt_id = r.id
      WHERE r.order_id = ? GROUP BY r.id ORDER BY r.created_at DESC, r.rowid DESC LIMIT 10`)
      .all(id) as Array<{ id: string; actorName: string; createdAt: string; itemCount: number }>;
    const receiptItems = db.prepare(`SELECT i.name, i.unit, ri.quantity FROM purchase_receipt_items ri
      JOIN purchase_order_items i ON i.id = ri.item_id WHERE ri.receipt_id = ? ORDER BY i.name COLLATE NOCASE, i.id`);
    const { total } = db.prepare("SELECT COUNT(*) AS total FROM purchase_receipts WHERE order_id = ?").get(id) as { total: number };
    return { order, items: orderItems(id), receipts: receipts.map(receipt => ({ ...receipt, items: receiptItems.all(receipt.id) })), receiptCount: total };
  })();
}

export async function registerPurchasingRoutes(app: FastifyInstance) {
  app.get("/api/suppliers", async request => {
    const { workspaceId } = getRequestUser(request);
    const { page, pageSize, q } = parse(supplierListQuery, request.query);
    const values = [workspaceId];
    if (q) values.push(searchPattern(q));
    return pageRows({
      prefix: "", from: "suppliers", order: "name COLLATE NOCASE, id", values,
      where: `WHERE workspace_id = ? ${q ? "AND search_text(name || ' ' || COALESCE(contact, '') || ' ' || COALESCE(email, '') || ' ' || COALESCE(phone, '')) LIKE ? ESCAPE '\\'" : ""}`,
    }, supplierColumns, page, pageSize);
  });
  app.post("/api/suppliers", async (request, reply) => {
    const { workspaceId } = getRequestUser(request);
    const { name, contact, email, phone, note } = parse(createSupplierSchema, request.body);
    const id = randomUUID();
    db.prepare("INSERT INTO suppliers (id, workspace_id, name, contact, email, phone, note) VALUES (?,?,?,?,?,?,?)")
      .run(id, workspaceId, name, contact ?? null, email ?? null, phone ?? null, note ?? null);
    return reply.code(201).send(getSupplier(workspaceId, id));
  });
  app.patch("/api/suppliers/:id", async request => {
    const { workspaceId } = getRequestUser(request);
    const { id } = parse(idParamsSchema, request.params);
    const input = parse(updateSupplierSchema, request.body);
    return db.transaction(() => {
      const next = { ...getSupplier(workspaceId, id), ...input };
      db.prepare("UPDATE suppliers SET name = ?, contact = ?, email = ?, phone = ?, note = ? WHERE id = ? AND workspace_id = ?")
        .run(next.name, next.contact, next.email, next.phone, next.note, id, workspaceId);
      return getSupplier(workspaceId, id);
    }).immediate();
  });
  app.get("/api/purchase-orders", async request => {
    const { workspaceId } = getRequestUser(request);
    const { page, pageSize, q, status } = parse(purchaseListQuery, request.query);
    const values = [workspaceId];
    if (status) values.push(status);
    if (q) values.push(searchPattern(q));
    return pageRows({
      prefix: "", from: orderFrom, order: "o.order_number DESC", values,
      where: `WHERE o.workspace_id = ? ${status ? "AND o.status = ?" : ""} ${q
        ? "AND search_text(s.name || ' ' || w.name || ' ' || printf('SA-%04d', o.order_number)) LIKE ? ESCAPE '\\'" : ""}`,
    }, orderColumns, page, pageSize);
  });
  app.post("/api/purchase-orders", async (request, reply) => {
    const { workspaceId } = getRequestUser(request);
    const { order, created } = createOrder(workspaceId, parse(createPurchaseSchema, request.body));
    return reply.code(created ? 201 : 200).send(order);
  });
  app.get("/api/purchase-orders/:id", async request => {
    const { workspaceId } = getRequestUser(request);
    return getOrderDetail(workspaceId, parse(idParamsSchema, request.params).id);
  });
  app.post("/api/purchase-orders/:id/receipts", async (request, reply) => {
    const actor = getRequestUser(request);
    const { id } = parse(idParamsSchema, request.params);
    const result = receiveOrder(actor.workspaceId, actor, id, parse(receivePurchaseSchema, request.body));
    return reply.code(result.created ? 201 : 200).send(result);
  });
  app.post("/api/purchase-orders/:id/cancel", async request => {
    const { workspaceId } = getRequestUser(request);
    const { id } = parse(idParamsSchema, request.params);
    return db.transaction(() => {
      const order = getOrder(workspaceId, id);
      if (order.status === "CANCELLED") return order;
      requireOpenOrder(order);
      db.prepare("UPDATE purchase_orders SET status = 'CANCELLED' WHERE id = ? AND workspace_id = ?").run(id, workspaceId);
      return getOrder(workspaceId, id);
    }).immediate();
  });
}
