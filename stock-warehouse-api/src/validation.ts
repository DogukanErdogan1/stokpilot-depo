import { z } from "zod";
import { AppError } from "./errors.js";

export function parse<TSchema extends z.ZodTypeAny>(schema: TSchema, input: unknown): z.infer<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
      .join("; ");
    throw new AppError(400, "VALIDATION_ERROR", message);
  }
  return result.data;
}

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const idParamsSchema = z.object({ id: z.string().uuid() });

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});

export const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80).default("Genel"),
  description: optionalText(1000),
  unit: z.string().trim().min(1).max(24).default("adet"),
  cost: z.coerce.number().int().nonnegative().default(0),
  symbol: z.string().trim().min(1).max(8).default("□"),
  minimumStockQuantity: z.coerce.number().int().nonnegative().default(0),
});

export const updateProductSchema = z.object({
  sku: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  description: optionalText(1000),
  unit: z.string().trim().min(1).max(24).optional(),
  cost: z.coerce.number().int().nonnegative().optional(),
  symbol: z.string().trim().min(1).max(8).optional(),
  archived: z.boolean().optional(),
  minimumStockQuantity: z.coerce.number().int().nonnegative().optional(),
}).refine((data) => Object.values(data).some((value) => value !== undefined), {
  message: "En az bir alan göndermelisiniz.",
});

const optionalNumber = z.coerce.number().finite().nonnegative().optional();
const paginationShape = {
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};
export const stockListQuerySchema = z.object({
  ...paginationShape,
  q: z.string().trim().max(160).optional(),
  productId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(),
  archived: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  lowStockOnly: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  category: z.string().trim().max(80).optional(),
  status: z.enum(["all", "low", "empty", "ok"]).default("all"),
  sort: z.enum(["name", "quantity-desc", "quantity-asc", "cost-desc", "cost-asc", "warehouses-desc"]).default("name"),
  scope: z.enum(["warehouse", "total"]).default("warehouse"),
  minCost: optionalNumber, maxCost: optionalNumber,
  minQuantity: optionalNumber, maxQuantity: optionalNumber,
  minWarehouses: z.coerce.number().int().nonnegative().optional(),
  maxWarehouses: z.coerce.number().int().nonnegative().optional(),
}).superRefine((query, context) => {
  for (const key of ["Cost", "Quantity", "Warehouses"] as const) {
    const min = query[`min${key}`], max = query[`max${key}`];
    if (min !== undefined && max !== undefined && min > max) context.addIssue({code: z.ZodIssueCode.custom, path:[`min${key}`], message:"Alt sınır üst sınırdan büyük olamaz."});
  }
});
export const productListQuerySchema = stockListQuerySchema;

export const createWarehouseSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(160),
  address: optionalText(500),
});

export const updateWarehouseSchema = z.object({
  code: z.string().trim().min(1).max(32).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  address: optionalText(500),
  archived: z.boolean().optional(),
}).refine((data) => Object.values(data).some((value) => value !== undefined), {
  message: "En az bir alan göndermelisiniz.",
});

export const createMovementSchema = z.object({
  type: z.enum(["INBOUND", "OUTBOUND"]),
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  note: optionalText(500),
});

export const adjustmentSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  countedQuantity: z.coerce.number().int().nonnegative(),
  note: optionalText(500),
});

export const transferSchema = z.object({
  productId: z.string().uuid(),
  sourceWarehouseId: z.string().uuid(),
  targetWarehouseId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  note: optionalText(500),
});

export const inventoryQuerySchema = stockListQuerySchema;
export const movementListQuerySchema = z.object({
  ...paginationShape,
  q: z.string().trim().max(160).optional(),
  productId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(),
  type: z.enum(["INBOUND", "OUTBOUND", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT"]).optional(),
});
export const exportQuerySchema = z.object({view:z.enum(["products", "inventory", "movements"]).default("inventory")});
