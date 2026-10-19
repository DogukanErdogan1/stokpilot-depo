import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { db } from "./db.js";
import { AppError } from "./errors.js";
import { adjustInventory, createStockMovement, transferStock } from "./inventory-service.js";
import {
  adjustmentSchema,
  createMovementSchema,
  createProductSchema,
  createWarehouseSchema,
  idParamsSchema,
  inventoryQuerySchema,
  movementListQuerySchema,
  productListQuerySchema,
  transferSchema,
  updateWarehouseSchema,
  updateProductSchema,
} from "./validation.js";
import { parse } from "./validation.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/products", async (request) => {
    const query = parse(productListQuerySchema, request.query);
    if (!query.q) {
      return db.prepare(`
        SELECT id, sku, name, category, description, unit, cost, symbol, archived,
               minimum_stock_quantity AS minimumStockQuantity,
               created_at AS createdAt, updated_at AS updatedAt
        FROM products ORDER BY name COLLATE NOCASE
      `).all();
    }

    const search = `%${query.q}%`;
    return db.prepare(`
      SELECT id, sku, name, category, description, unit, cost, symbol, archived,
             minimum_stock_quantity AS minimumStockQuantity,
             created_at AS createdAt, updated_at AS updatedAt
      FROM products
      WHERE sku LIKE ? OR name LIKE ?
      ORDER BY name COLLATE NOCASE
    `).all(search, search);
  });

  app.post("/api/products", async (request, reply) => {
    const input = parse(createProductSchema, request.body);
    const id = randomUUID();
    db.prepare(`
      INSERT INTO products (id, sku, name, category, description, unit, cost, symbol, minimum_stock_quantity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.sku, input.name, input.category, input.description ?? null, input.unit, input.cost, input.symbol, input.minimumStockQuantity);

    const product = db.prepare(`
      SELECT id, sku, name, category, description, unit, cost, symbol, archived,
             minimum_stock_quantity AS minimumStockQuantity,
             created_at AS createdAt, updated_at AS updatedAt
      FROM products WHERE id = ?
    `).get(id);
    return reply.code(201).send(product);
  });

  app.get("/api/products/:id", async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const product = db.prepare(`
      SELECT id, sku, name, category, description, unit, cost, symbol, archived,
             minimum_stock_quantity AS minimumStockQuantity,
             created_at AS createdAt, updated_at AS updatedAt
      FROM products WHERE id = ?
    `).get(id);
    if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Ürün bulunamadı.");
    return product;
  });

  app.patch("/api/products/:id", async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const input = parse(updateProductSchema, request.body);
    const existing = db.prepare(`
      SELECT sku, name, category, description, unit, cost, symbol,
             archived, minimum_stock_quantity AS minimumStockQuantity
      FROM products WHERE id = ?
    `).get(id) as {
      sku: string;
      name: string;
      category: string;
      description: string | null;
      unit: string;
      cost: number;
      symbol: string;
      archived: number;
      minimumStockQuantity: number;
    } | undefined;
    if (!existing) throw new AppError(404, "PRODUCT_NOT_FOUND", "Ürün bulunamadı.");

    const nextArchived = input.archived ?? Boolean(existing.archived);
    if (nextArchived && !existing.archived) {
      const stock = db.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_balances WHERE product_id = ?")
        .get(id) as { quantity: number };
      if (stock.quantity > 0) throw new AppError(409, "PRODUCT_HAS_STOCK", "Arşivlemeden önce ürünün tüm depolardaki stokunu sıfırlayın.");
    }

    db.prepare(`
      UPDATE products SET
        sku = ?, name = ?, category = ?, description = ?, unit = ?, cost = ?, symbol = ?, archived = ?, minimum_stock_quantity = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(
      input.sku ?? existing.sku,
      input.name ?? existing.name,
      input.category ?? existing.category,
      input.description === undefined ? existing.description : input.description,
      input.unit ?? existing.unit,
      input.cost ?? existing.cost,
      input.symbol ?? existing.symbol,
      nextArchived ? 1 : 0,
      input.minimumStockQuantity ?? existing.minimumStockQuantity,
      id,
    );

    return db.prepare(`
      SELECT id, sku, name, category, description, unit, cost, symbol, archived,
             minimum_stock_quantity AS minimumStockQuantity,
             created_at AS createdAt, updated_at AS updatedAt
      FROM products WHERE id = ?
    `).get(id);
  });

  app.delete("/api/products/:id", async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    const transaction = db.transaction(() => {
      const product = db.prepare("SELECT id FROM products WHERE id = ?").get(id);
      if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Ürün bulunamadı.");
      const movements = db.prepare("SELECT 1 FROM stock_movements WHERE product_id = ? LIMIT 1").get(id);
      if (movements) {
        throw new AppError(409, "PRODUCT_HAS_HISTORY", "Stok hareketi bulunan ürün silinemez.");
      }
      db.prepare("DELETE FROM inventory_balances WHERE product_id = ?").run(id);
      db.prepare("DELETE FROM products WHERE id = ?").run(id);
    });
    transaction.immediate();
    return reply.code(204).send();
  });

  app.get("/api/warehouses", async () => db.prepare(`
    SELECT id, code, name, address, archived, created_at AS createdAt
    FROM warehouses ORDER BY name COLLATE NOCASE
  `).all());

  app.post("/api/warehouses", async (request, reply) => {
    const input = parse(createWarehouseSchema, request.body);
    const id = randomUUID();
    db.prepare("INSERT INTO warehouses (id, code, name, address) VALUES (?, ?, ?, ?)")
      .run(id, input.code, input.name, input.address ?? null);
    const warehouse = db.prepare(`
      SELECT id, code, name, address, archived, created_at AS createdAt FROM warehouses WHERE id = ?
    `).get(id);
    return reply.code(201).send(warehouse);
  });

  app.patch("/api/warehouses/:id", async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const input = parse(updateWarehouseSchema, request.body);
    const existing = db.prepare("SELECT code, name, address, archived FROM warehouses WHERE id = ?").get(id) as {
      code: string; name: string; address: string | null; archived: number;
    } | undefined;
    if (!existing) throw new AppError(404, "WAREHOUSE_NOT_FOUND", "Depo bulunamadı.");

    const nextArchived = input.archived ?? Boolean(existing.archived);
    if (nextArchived && !existing.archived) {
      const stock = db.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_balances WHERE warehouse_id = ?")
        .get(id) as { quantity: number };
      if (stock.quantity > 0) throw new AppError(409, "WAREHOUSE_HAS_STOCK", "Arşivlemeden önce bu depodaki stokları sıfırlayın.");
    }

    db.prepare("UPDATE warehouses SET code = ?, name = ?, address = ?, archived = ? WHERE id = ?")
      .run(input.code ?? existing.code, input.name ?? existing.name,
        input.address === undefined ? existing.address : input.address, nextArchived ? 1 : 0, id);
    return db.prepare(`SELECT id, code, name, address, archived, created_at AS createdAt FROM warehouses WHERE id = ?`)
      .get(id);
  });

  app.get("/api/inventory", async (request) => {
    const query = parse(inventoryQuerySchema, request.query);
    const conditions: string[] = [];
    const values: Array<string> = [];
    if (query.productId) {
      conditions.push("p.id = ?");
      values.push(query.productId);
    }
    if (query.warehouseId) {
      conditions.push("w.id = ?");
      values.push(query.warehouseId);
    }
    if (query.lowStockOnly) conditions.push("ib.quantity <= p.minimum_stock_quantity");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    return db.prepare(`
      SELECT p.id AS productId, p.sku, p.name AS productName, p.unit,
             p.minimum_stock_quantity AS minimumStockQuantity,
             w.id AS warehouseId, w.code AS warehouseCode, w.name AS warehouseName,
             ib.quantity, ib.updated_at AS updatedAt,
             CASE WHEN ib.quantity <= p.minimum_stock_quantity THEN 1 ELSE 0 END AS isLowStock
      FROM inventory_balances ib
      JOIN products p ON p.id = ib.product_id
      JOIN warehouses w ON w.id = ib.warehouse_id
      ${where}
      ORDER BY p.name COLLATE NOCASE, w.name COLLATE NOCASE
    `).all(...values);
  });

  app.get("/api/stock-movements", async (request) => {
    const query = parse(movementListQuerySchema, request.query);
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (query.productId) {
      conditions.push("sm.product_id = ?");
      values.push(query.productId);
    }
    if (query.warehouseId) {
      conditions.push("sm.warehouse_id = ?");
      values.push(query.warehouseId);
    }
    if (query.type) {
      conditions.push("sm.type = ?");
      values.push(query.type);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    values.push(query.limit, query.offset);

    return db.prepare(`
      SELECT sm.id, sm.type, sm.quantity_delta AS quantityDelta, sm.reference_id AS referenceId,
             sm.note, sm.created_at AS createdAt,
             p.id AS productId, p.sku, p.name AS productName,
             w.id AS warehouseId, w.code AS warehouseCode, w.name AS warehouseName
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      JOIN warehouses w ON w.id = sm.warehouse_id
      ${where}
      ORDER BY sm.created_at DESC, sm.rowid DESC
      LIMIT ? OFFSET ?
    `).all(...values);
  });

  app.post("/api/stock-movements", async (request, reply) => {
    const input = parse(createMovementSchema, request.body);
    const result = createStockMovement(input);
    return reply.code(201).send(result);
  });

  app.post("/api/inventory/adjustments", async (request, reply) => {
    const input = parse(adjustmentSchema, request.body);
    const result = adjustInventory(input);
    return reply.code(201).send(result);
  });

  app.post("/api/transfers", async (request, reply) => {
    const input = parse(transferSchema, request.body);
    const result = transferStock(input);
    return reply.code(201).send(result);
  });
}
