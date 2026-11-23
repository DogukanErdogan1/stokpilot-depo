import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { db } from "./db.js";
import type { createProductSchema } from "./validation.js";

const insert = db.prepare(`
  INSERT INTO products (id, workspace_id, sku, barcode, name, category, description, unit, cost, symbol, minimum_stock_quantity)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function insertProduct(workspaceId: string, input: z.infer<typeof createProductSchema>): string {
  const id = randomUUID();
  insert.run(id, workspaceId, input.sku, input.barcode ?? null, input.name, input.category, input.description ?? null,
    input.unit, input.cost, input.symbol, input.minimumStockQuantity);
  return id;
}
