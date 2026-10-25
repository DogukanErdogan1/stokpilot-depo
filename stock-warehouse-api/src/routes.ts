import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { db } from "./db.js";
import { enrichProducts, exportRows, listInventory, listMovements, listProducts, listWarehouses, overview } from "./listing-service.js";
import { AppError } from "./errors.js";
import { adjustInventory, createStockMovement, transferStock } from "./inventory-service.js";
import {
  adjustmentSchema,
  exportQuerySchema,
  createMovementSchema,
  createProductSchema,
  createWarehouseSchema,
  warehouseListQuerySchema,
  idParamsSchema,
  inventoryQuerySchema,
  movementListQuerySchema,
  productListQuerySchema,
  transferSchema,
  updateWarehouseSchema,
  updateProductSchema,
} from "./validation.js";
import { parse } from "./validation.js";

function getWorkspaceId(request: FastifyRequest): string {
  const workspaceId = request.authUser?.workspaceId;
  if (!workspaceId) throw new AppError(401, "UNAUTHENTICATED", "Oturumunuz sona ermiş. Yeniden giriş yapın.");
  return workspaceId;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/overview", async request => overview(getWorkspaceId(request)));
  app.get("/api/export", async (request, reply) => {
    const { view } = parse(exportQuerySchema, request.query);
    const filters = view === "movements" ? parse(movementListQuerySchema, request.query) : parse(productListQuerySchema, request.query);
    return reply.type("text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="stokpilot-${view}.csv"`)
      .send(exportRows(getWorkspaceId(request), view, filters));
  });
  app.get("/api/products", async request => listProducts(getWorkspaceId(request), parse(productListQuerySchema, request.query)));

  app.post("/api/products", async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const input = parse(createProductSchema, request.body);
    const id = randomUUID();
    db.prepare(`
      INSERT INTO products (id, workspace_id, sku, name, category, description, unit, cost, symbol, minimum_stock_quantity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, input.sku, input.name, input.category, input.description ?? null, input.unit, input.cost, input.symbol, input.minimumStockQuantity);

    const product = db.prepare(`
      SELECT id, sku, name, category, description, unit, cost, symbol, archived,
             minimum_stock_quantity AS minimumStockQuantity,
             created_at AS createdAt, updated_at AS updatedAt
      FROM products WHERE id = ? AND workspace_id = ?
    `).get(id, workspaceId);
    return reply.code(201).send(product);
  });

  app.get("/api/products/:id", async (request) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = parse(idParamsSchema, request.params);
    const product = db.prepare(`
      SELECT id, sku, name, category, description, unit, cost, symbol, archived,
             minimum_stock_quantity AS minimumStockQuantity,
             created_at AS createdAt, updated_at AS updatedAt
      FROM products WHERE id = ? AND workspace_id = ?
    `).get(id, workspaceId);
    if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Ürün bulunamadı.");
    return enrichProducts(workspaceId, [product as Record<string, any>])[0];
  });

  app.patch("/api/products/:id", async (request) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = parse(idParamsSchema, request.params);
    const input = parse(updateProductSchema, request.body);
    const existing = db.prepare(`
      SELECT sku, name, category, description, unit, cost, symbol,
             archived, minimum_stock_quantity AS minimumStockQuantity
      FROM products WHERE id = ? AND workspace_id = ?
    `).get(id, workspaceId) as {
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
      const stock = db.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_balances WHERE workspace_id = ? AND product_id = ?")
        .get(workspaceId, id) as { quantity: number };
      if (stock.quantity > 0) throw new AppError(409, "PRODUCT_HAS_STOCK", "Arşivlemeden önce ürünün tüm depolardaki stokunu sıfırlayın.");
    }

    db.prepare(`
      UPDATE products SET
        sku = ?, name = ?, category = ?, description = ?, unit = ?, cost = ?, symbol = ?, archived = ?, minimum_stock_quantity = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND workspace_id = ?
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
      workspaceId,
    );

    return db.prepare(`
      SELECT id, sku, name, category, description, unit, cost, symbol, archived,
             minimum_stock_quantity AS minimumStockQuantity,
             created_at AS createdAt, updated_at AS updatedAt
      FROM products WHERE id = ? AND workspace_id = ?
    `).get(id, workspaceId);
  });

  app.delete("/api/products/:id", async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = parse(idParamsSchema, request.params);
    const transaction = db.transaction(() => {
      const product = db.prepare("SELECT id FROM products WHERE id = ? AND workspace_id = ?").get(id, workspaceId);
      if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Ürün bulunamadı.");
      const movements = db.prepare("SELECT 1 FROM stock_movements WHERE workspace_id = ? AND product_id = ? LIMIT 1").get(workspaceId, id);
      if (movements) {
        throw new AppError(409, "PRODUCT_HAS_HISTORY", "Stok hareketi bulunan ürün silinemez.");
      }
      db.prepare("DELETE FROM inventory_balances WHERE workspace_id = ? AND product_id = ?").run(workspaceId, id);
      db.prepare("DELETE FROM products WHERE id = ? AND workspace_id = ?").run(id, workspaceId);
    });
    transaction.immediate();
    return reply.code(204).send();
  });

  app.get("/api/warehouses", async request => listWarehouses(getWorkspaceId(request), parse(warehouseListQuerySchema, request.query)));

  app.post("/api/warehouses", async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const input = parse(createWarehouseSchema, request.body);
    const id = randomUUID();
    db.prepare("INSERT INTO warehouses (id, workspace_id, code, name, address, location) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, workspaceId, input.code, input.name, input.address ?? null, input.location ?? null);
    const warehouse = db.prepare(`
      SELECT id, code, name, address, location, archived, created_at AS createdAt FROM warehouses WHERE id = ? AND workspace_id = ?
    `).get(id, workspaceId);
    return reply.code(201).send(warehouse);
  });

  app.patch("/api/warehouses/:id", async (request) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = parse(idParamsSchema, request.params);
    const input = parse(updateWarehouseSchema, request.body);
    const existing = db.prepare("SELECT code, name, address, location, archived FROM warehouses WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as {
      code: string; name: string; address: string | null; location: string | null; archived: number;
    } | undefined;
    if (!existing) throw new AppError(404, "WAREHOUSE_NOT_FOUND", "Depo bulunamadı.");

    const nextArchived = input.archived ?? Boolean(existing.archived);
    if (nextArchived && !existing.archived) {
      const stock = db.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_balances WHERE workspace_id = ? AND warehouse_id = ?")
        .get(workspaceId, id) as { quantity: number };
      if (stock.quantity > 0) throw new AppError(409, "WAREHOUSE_HAS_STOCK", "Arşivlemeden önce bu depodaki stokları sıfırlayın.");
    }

    db.prepare("UPDATE warehouses SET code = ?, name = ?, address = ?, location = ?, archived = ? WHERE id = ? AND workspace_id = ?")
      .run(input.code ?? existing.code, input.name ?? existing.name,
        input.address === undefined ? existing.address : input.address,
        input.location === undefined ? existing.location : input.location, nextArchived ? 1 : 0, id, workspaceId);
    return db.prepare(`SELECT id, code, name, address, location, archived, created_at AS createdAt FROM warehouses WHERE id = ? AND workspace_id = ?`)
      .get(id, workspaceId);
  });

  app.get("/api/inventory", async request => listInventory(getWorkspaceId(request), parse(inventoryQuerySchema, request.query)));
  app.get("/api/stock-movements", async request => listMovements(getWorkspaceId(request), parse(movementListQuerySchema, request.query)));

  app.post("/api/stock-movements", async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const input = parse(createMovementSchema, request.body);
    const result = createStockMovement(workspaceId, input);
    return reply.code(201).send(result);
  });

  app.post("/api/inventory/adjustments", async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const input = parse(adjustmentSchema, request.body);
    const result = adjustInventory(workspaceId, input);
    return reply.code(201).send(result);
  });

  app.post("/api/transfers", async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const input = parse(transferSchema, request.body);
    const result = transferStock(workspaceId, input);
    return reply.code(201).send(result);
  });
}
