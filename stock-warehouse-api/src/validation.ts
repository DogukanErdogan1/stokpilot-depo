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
const barcode = z.string().trim().min(1).max(80).refine(value => !/[\p{C}\p{Zl}\p{Zp}]/u.test(value), {
  message: "Barkod tek satır olmalıdır.",
});

export const idParamsSchema = z.object({ id: z.string().uuid() });
export const barcodeQuerySchema = z.object({ code: barcode });

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});
const userRoleSchema = z.enum(["admin", "operator", "viewer"]);
export type UserRole = z.infer<typeof userRoleSchema>;
export const createMemberSchema = loginSchema.extend({
  password: z.string().min(12, "Parola en az 12 karakter olmalıdır.").max(256),
  fullName: z.string().trim().min(1).max(100),
  role: userRoleSchema,
});
export const updateMemberSchema = z.object({
  role: userRoleSchema.optional(),
  active: z.boolean().optional(),
}).refine(input => input.role !== undefined || input.active !== undefined, { message: "Bir rol veya erişim durumu seç." });

export const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  barcode: barcode.nullable().optional(),
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
  barcode: barcode.nullable().optional(),
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
export const teamListQuerySchema = z.object(paginationShape);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Geçerli bir tarih seç.");
export const stockReportQuerySchema = z.object({
  ...paginationShape,
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  from: calendarDate,
  to: calendarDate,
  warehouseId: z.string().uuid().optional(),
  idleDays: z.coerce.number().int().min(1).max(365).default(30),
}).superRefine(({ from, to }, context) => {
  const duration = Date.parse(to) - Date.parse(from);
  if (duration < 0 || duration >= 366 * 86_400_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "Bitiş tarihini başlangıçtan önce seçme. En fazla 366 gün görüntülenebilir." });
  }
});
export const stockReportSectionSchema = z.object({ section: z.enum(["summary", "outbound", "idle"]) });

const supplierFields = z.object({
  name: z.string().trim().min(1).max(160),
  contact: optionalText(120),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: optionalText(60),
  note: optionalText(500),
});
const purchasingSearch = { ...paginationShape, q: z.string().trim().max(160).optional() };
export const supplierListQuery = z.object(purchasingSearch);
export const createSupplierSchema = supplierFields;
export const updateSupplierSchema = supplierFields.partial().refine(value => Object.keys(value).length > 0);
export const purchaseListQuery = z.object({
  ...purchasingSearch,
  status: z.enum(["OPEN", "PARTIAL", "RECEIVED", "CANCELLED"]).optional(),
});
const purchaseQuantity = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const createPurchaseSchema = z.object({
  requestId: z.string().uuid(),
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  expectedDate: calendarDate.nullable().optional(),
  note: optionalText(500),
  items: z.array(z.object({
    productId: z.string().uuid(), quantity: purchaseQuantity,
    unitPriceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })).min(1).max(100).refine(items => new Set(items.map(item => item.productId)).size === items.length, "Her ürün siparişe bir kez eklenebilir."),
});
export const receivePurchaseSchema = z.object({
  requestId: z.string().uuid(),
  items: z.array(z.object({ itemId: z.string().uuid(), quantity: purchaseQuantity })).min(1).max(100)
    .refine(items => new Set(items.map(item => item.itemId)).size === items.length, "Her teslimat kalemi bir kez girilebilir."),
});
export const stockListQuerySchema = z.object({
  ...paginationShape,
  q: z.string().trim().max(160).optional(),
  productId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(),
  archived: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  lowStockOnly: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  category: z.string().trim().max(80).optional(),
  status: z.enum(["all", "low", "empty", "ok", "overstock"]).default("all"),
  overstockFactor: z.coerce.number().int().min(2).max(5).default(3),
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
export const stockAlertQuerySchema = z.object({
  page: paginationShape.page,
  pageSize: z.coerce.number().int().min(1).max(6).default(6),
  type: z.enum(["all", "empty", "critical", "overstock"]).default("all"),
  warehouseId: z.string().uuid().optional(),
  category: z.string().trim().max(80).optional(),
  overstockFactor: z.coerce.number().int().min(2).max(5).default(3),
});

export const warehouseListQuerySchema = z.object({
  ...paginationShape,
  q: z.string().trim().max(160).optional(),
  location: z.string().trim().max(500).optional(),
  archived: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  sort: z.enum(["name", "quantity-desc", "products-desc", "critical-desc"]).default("name"),
});

export const createWarehouseSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(160),
  address: optionalText(500),
  location: optionalText(160),
});

export const updateWarehouseSchema = z.object({
  code: z.string().trim().min(1).max(32).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  address: optionalText(500),
  location: optionalText(160),
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

const countQuantity = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const startCountSchema = z.object({ warehouseId: z.string().uuid() });
export const countListQuerySchema = z.object(paginationShape);
export const countItemsQuerySchema = z.object({
  ...paginationShape,
  q: z.string().trim().max(160).optional(),
  filter: z.enum(["all", "counted", "differences"]).default("all"),
});
export const saveCountItemsSchema = z.object({
  revision: countQuantity,
  items: z.array(z.object({
    productId: z.string().uuid(),
    countedQuantity: countQuantity.nullable(),
    previousCountedQuantity: countQuantity.nullable(),
    expectedQuantity: countQuantity,
    stockRevision: countQuantity,
  })).min(1).max(250).refine(items => new Set(items.map(item => item.productId)).size === items.length, {
    message: "Her ürün bir kez gönderilmelidir.",
  }),
});
export const finishCountSchema = z.object({
  revision: countQuantity,
  action: z.enum(["approve", "cancel"]),
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
