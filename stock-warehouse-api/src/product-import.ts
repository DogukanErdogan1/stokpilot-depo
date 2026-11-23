import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRequestUser } from "./auth.js";
import { barcodeKey, barcodeKeySql, db } from "./db.js";
import { AppError } from "./errors.js";
import { insertProduct } from "./product-service.js";
import { createProductSchema, parse } from "./validation.js";

const maxBytes = 500 * 1024;
const maxRows = 2000;
const bodyOptions = { bodyLimit: maxBytes * 6 + 1024 };
const csvBody = z.object({ csv: z.string().min(1).max(maxBytes) });
const importBody = csvBody.extend({ requestId: z.string().uuid() });
type CsvRow = { line: number; cells: string[] };
type Product = z.infer<typeof createProductSchema>;

function invalidCsv(message: string): never {
  throw new AppError(400, "INVALID_PRODUCT_CSV", message);
}

function readRows(csv: string): CsvRow[] {
  if (Buffer.byteLength(csv, "utf8") > maxBytes) invalidCsv("CSV dosyası en fazla 500 KB olabilir.");
  const source = csv.replace(/^\uFEFF/, "");
  const directive = /^sep=([;,\t])(?=\r\n|\r|\n)/i.exec(source);
  const text = directive ? source.slice(directive[0].length) : source;
  const header = (text.split(/\r\n|\r|\n/).find(line => line.trim()) ?? "").replace(/"(?:[^"]|"")*"/g, "");
  const separators = [";", ",", "\t"];
  const delimiter = directive?.[1] ?? separators.reduce((best, next) => header.split(next).length > header.split(best).length ? next : best);
  const rows: CsvRow[] = [];
  let line = 1;
  let start = 1;
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let closedQuote = false;

  const endField = () => {
    cells.push(field.trim());
    field = "";
    closedQuote = false;
    if (cells.length > 50) invalidCsv(`${start}. satırda çok fazla sütun var. Ürün CSV şablonunu kullan.`);
  };
  const endRow = () => {
    endField();
    if (cells.some(Boolean)) rows.push({ line: start, cells });
    if (rows.length > maxRows + 1) invalidCsv("Bir CSV dosyasına en fazla 2.000 ürün satırı eklenebilir.");
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      if (inQuotes) field += "\n";
      else endRow();
      line++;
      if (!inQuotes) start = line;
    } else if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; closedQuote = true; }
      else field += char;
    } else if (char === delimiter) {
      endField();
    } else if (closedQuote) {
      if (char !== " " && char !== "\t") invalidCsv(`${line}. satırda tırnaktan sonra sütun ayracı bekleniyor.`);
    } else if (char === '"') {
      if (field.trim()) invalidCsv(`${line}. satırdaki tırnakları kontrol et.`);
      field = "";
      inQuotes = true;
    } else {
      field += char;
    }
  }
  if (inQuotes) invalidCsv(`${start}. satırda açılan tırnak kapanmamış.`);
  endRow();
  return rows;
}

const columnNames = {
  sku: ["SKU", "Ürün kodu", "Stok kodu", "SKU / Ürün kodu"],
  name: ["Ürün adı", "Ürün", "Name", "Product name"],
  category: ["Kategori", "Category"],
  unit: ["Birim", "Unit"],
  barcode: ["Barkod", "Barcode"],
  cost: ["Birim maliyet", "Birim maliyet (₺)", "Maliyet", "Cost"],
  minimumStockQuantity: ["Minimum stok", "Minimum", "Minimum stock", "minimumStockQuantity"],
  description: ["Açıklama", "Description"],
  symbol: ["Simge", "Symbol"],
} satisfies Record<keyof Product, string[]>;
type Column = keyof typeof columnNames;

function headerKey(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/[^a-z0-9]/g, "");
}

const aliases = new Map(Object.entries(columnNames).flatMap(([key, names]) => names.map(name => [headerKey(name), key as Column] as const)));
const skuKey = (sku: string) => sku.replace(/[A-Z]/g, char => char.toLowerCase());

function wholeNumber(text: string | undefined): number | undefined {
  if (!text) return undefined;
  if (!/^\d+(?:[.,]0{1,2})?$/.test(text)) return NaN;
  const value = Number(text.replace(",", "."));
  return Number.isSafeInteger(value) ? value : NaN;
}

function parseProducts(csv: string) {
  const [header, ...rows] = readRows(csv);
  if (!header) invalidCsv("CSV dosyasında başlık satırı bulunamadı.");
  const columns = header.cells.map(cell => aliases.get(headerKey(cell)));
  if (!columns.includes("sku") || !columns.includes("name")) invalidCsv("Başlık satırında SKU ve Ürün adı sütunları bulunmalı.");
  const known = columns.filter(Boolean);
  if (new Set(known).size !== known.length) invalidCsv("Bir ürün alanı birden fazla sütunda yer alıyor.");
  if (!rows.length) invalidCsv("CSV dosyasında ürün satırı bulunamadı.");
  const ignoredColumns = header.cells.filter((cell, index) => !columns[index] && cell).map(cell => cell.slice(0, 80));
  const products = rows.map(({ line, cells }) => {
    const data: Partial<Record<Column, string>> = {};
    columns.forEach((column, index) => { if (column && cells[index]) data[column] = cells[index]; });
    const messages = cells.length > columns.length && cells.slice(columns.length).some(Boolean)
      ? ["Satırdaki sütun sayısı başlıkla uyuşmuyor."] : [];
    const validated = createProductSchema.safeParse({
      ...data, name: data.name ?? "", sku: data.sku ?? "", cost: wholeNumber(data.cost),
      minimumStockQuantity: wholeNumber(data.minimumStockQuantity),
    });
    if (!validated.success) {
      for (const issue of validated.error.issues) {
        const column = issue.path[0] as Column;
        const label = columnNames[column][0];
        if (column === "cost" || column === "minimumStockQuantity") messages.push(`${label} sıfır veya pozitif tam sayı olmalı.`);
        else if (!data[column]) messages.push(`${label} zorunlu.`);
        else messages.push(`${label} geçersiz veya çok uzun.`);
      }
    }
    return {
      line, messages, product: validated.success ? validated.data : null, sku: data.sku || "", barcode: data.barcode || "",
      name: data.name || "", category: data.category || "Genel", unit: data.unit || "adet",
    };
  });
  return { products, ignoredColumns };
}

function reviewProducts(workspaceId: string, parsed: ReturnType<typeof parseProducts>) {
  const skuCounts = new Map<string, number>();
  const barcodeCounts = new Map<string, number>();
  for (const { sku, barcode } of parsed.products) {
    if (sku) skuCounts.set(skuKey(sku), (skuCounts.get(skuKey(sku)) ?? 0) + 1);
    if (barcode) barcodeCounts.set(barcodeKey(barcode), (barcodeCounts.get(barcodeKey(barcode)) ?? 0) + 1);
  }
  const usedSku = db.prepare("SELECT 1 FROM products WHERE sku = ?"); // Matches the catalogue's existing SKU constraint.
  const usedBarcode = db.prepare(`SELECT 1 FROM products WHERE workspace_id = ? AND barcode IS NOT NULL AND (${barcodeKeySql}) = ?`);
  const rows = parsed.products.map(({ line, product, messages, sku, barcode, name, category, unit }) => {
    const issues = [...messages];
    if (sku && (skuCounts.get(skuKey(sku)) ?? 0) > 1) issues.push("SKU dosyada yineleniyor.");
    if (sku && usedSku.get(sku)) issues.push("Bu SKU kullanılamıyor. Farklı bir ürün kodu gir.");
    if (barcode && (barcodeCounts.get(barcodeKey(barcode)) ?? 0) > 1) issues.push("Barkod dosyada yineleniyor.");
    if (barcode && usedBarcode.get(workspaceId, barcodeKey(barcode))) issues.push("Barkod başka bir ürüne kayıtlı.");
    return { line, sku: sku.slice(0, 65), name: name.slice(0, 161), barcode: barcode.slice(0, 81),
      category: category.slice(0, 81), unit: unit.slice(0, 25), cost: product?.cost ?? null,
      minimumStockQuantity: product?.minimumStockQuantity ?? null, issues };
  });
  const invalid = rows.filter(row => row.issues.length).length;
  return { rows, total: rows.length, valid: rows.length - invalid, invalid, ignoredColumns: parsed.ignoredColumns };
}

export async function registerProductImport(app: FastifyInstance) {
  app.get("/api/products/import/template", async (_request, reply) => reply.type("text/csv; charset=utf-8")
    .header("Content-Disposition", 'attachment; filename="stokpilot-urun-sablonu.csv"')
    .send("\uFEFFSKU;Ürün adı;Kategori;Birim;Barkod;Birim maliyet (₺);Minimum stok;Açıklama\r\n"));
  app.post("/api/products/import/preview", bodyOptions, async request => {
    const { workspaceId } = getRequestUser(request);
    const parsed = parseProducts(parse(csvBody, request.body).csv);
    return db.transaction(() => reviewProducts(workspaceId, parsed))();
  });
  app.post("/api/products/import", bodyOptions, async (request, reply) => {
    const { workspaceId } = getRequestUser(request);
    const { csv, requestId } = parse(importBody, request.body);
    const parsed = parseProducts(csv);
    const digest = createHash("sha256").update(csv).digest("hex");
    const result = db.transaction(() => {
      const existing = db.prepare("SELECT csv_digest AS digest, imported FROM product_imports WHERE workspace_id = ? AND request_id = ?")
        .get(workspaceId, requestId) as { digest: string; imported: number } | undefined;
      if (existing) {
        if (existing.digest !== digest) throw new AppError(409, "IMPORT_REQUEST_USED", "Bu istekle farklı bir CSV aktarılmış. Dosyayı yeniden seç.");
        return { imported: existing.imported, replayed: true };
      }
      const preview = reviewProducts(workspaceId, parsed);
      if (preview.invalid) return { preview };
      for (const { product } of parsed.products) insertProduct(workspaceId, product!);
      db.prepare("INSERT INTO product_imports (workspace_id, request_id, csv_digest, imported) VALUES (?,?,?,?)")
        .run(workspaceId, requestId, digest, preview.valid);
      return { imported: preview.valid, replayed: false };
    }).immediate();
    if ("preview" in result) return reply.code(409).send({
      error: { code: "IMPORT_VALIDATION_FAILED", message: "Dosyada düzeltilmesi gereken satırlar var." }, preview: result.preview,
    });
    return reply.code(result.replayed ? 200 : 201).send(result);
  });
}
