import type { z } from "zod";
import { db } from "./db.js";
import { AppError } from "./errors.js";
import type { stockReportQuerySchema, stockReportSectionSchema } from "./validation.js";

type ReportQuery = z.infer<typeof stockReportQuerySchema>;
type Section = z.infer<typeof stockReportSectionSchema>["section"];
type Params = Record<string, string | number>;
const dayMs = 86_400_000;
const reportOffsetMs = 3 * 3_600_000;

function localDay(epoch: number): string {
  return new Date(epoch + reportOffsetMs).toISOString().slice(0, 10);
}

function warehouseFilter(alias: string, query: ReportQuery): string {
  return query.warehouseId ? `AND ${alias}.warehouse_id = @warehouseId` : "";
}

// Each historical balance is reconstructed only if the movement ledger agrees with today's balance.
function balancesSql(query: ReportQuery) {
  return `WITH activity AS (
    SELECT m.product_id, m.warehouse_id,
      SUM(m.quantity_delta) AS net,
      SUM(CASE WHEN m.created_at >= @end THEN m.quantity_delta ELSE 0 END) AS later,
      MAX(CASE WHEN m.created_at < @end THEN m.created_at END) AS last_movement
    FROM stock_movements m
    WHERE m.workspace_id = @workspace ${warehouseFilter("m", query)}
    GROUP BY m.product_id, m.warehouse_id
  ), balances AS (
    SELECT b.product_id, b.warehouse_id, b.quantity, b.updated_at, p.cost,
      a.last_movement, b.quantity - COALESCE(a.later, 0) AS end_quantity,
      b.quantity = COALESCE(a.net, 0) AS reconciled
    FROM inventory_balances b
    JOIN products p ON p.id = b.product_id AND p.workspace_id = @workspace
    JOIN warehouses w ON w.id = b.warehouse_id AND w.workspace_id = @workspace
    LEFT JOIN activity a ON a.product_id = b.product_id AND a.warehouse_id = b.warehouse_id
    WHERE b.workspace_id = @workspace ${warehouseFilter("b", query)}
  )`;
}

function reportPage(prefix: string, columns: string, from: string, order: string, params: Params, query: ReportQuery) {
  const { total } = db.prepare(`${prefix} SELECT COUNT(*) AS total FROM ${from}`).get(params) as { total: number };
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const items = db.prepare(`${prefix} SELECT ${columns} FROM ${from} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: query.pageSize, offset: (page - 1) * query.pageSize });
  return { items, pagination: { page, totalPages, total, pageSize: query.pageSize } };
}

function outboundReport(query: ReportQuery, params: Params) {
  const prefix = `WITH outbound AS (
    SELECT m.product_id, -SUM(m.quantity_delta) AS quantity, COUNT(*) AS movements
    FROM stock_movements m WHERE m.workspace_id = @workspace AND m.type = 'OUTBOUND'
      AND m.created_at >= @start AND m.created_at < @end ${warehouseFilter("m", query)}
    GROUP BY m.product_id
  )`;
  return reportPage(prefix, "p.id, p.name, p.sku, p.unit, o.quantity, o.movements",
    "outbound o JOIN products p ON p.id = o.product_id AND p.workspace_id = @workspace",
    "o.quantity DESC, p.name COLLATE NOCASE, p.id", params, query);
}

function idleStockReport(query: ReportQuery, params: Params, today: boolean) {
  const prefix = `${balancesSql(query)}, aged AS (
    SELECT b.*,
      CASE WHEN b.reconciled THEN b.end_quantity ELSE b.quantity END AS stock,
      CASE WHEN b.reconciled THEN b.last_movement ELSE MAX(COALESCE(b.last_movement, b.updated_at), b.updated_at) END AS last_activity
    FROM balances b WHERE b.reconciled = 1 OR @today = 1
  )`;
  const cutoff = new Date(Date.parse(String(params.end)) - query.idleDays * dayMs).toISOString();
  return reportPage(prefix, `p.id AS productId, w.id AS warehouseId, p.name, p.sku, p.unit, w.name AS warehouseName,
    a.stock AS quantity, a.last_movement AS lastMovement,
    CAST(julianday(@date) - julianday(date(a.last_activity, '+3 hours')) AS INTEGER) AS daysIdle`,
    `aged a JOIN products p ON p.id = a.product_id JOIN warehouses w ON w.id = a.warehouse_id
    WHERE a.stock > 0 AND a.last_activity < @cutoff`,
    "a.last_activity, p.name COLLATE NOCASE, p.id, w.id",
    { ...params, cutoff, date: query.to, today: Number(today) }, query);
}

function valueReport(query: ReportQuery, params: Params) {
  const base = balancesSql(query);
  const rows = db.prepare(`${base}
    SELECT NULL AS day, COUNT(*) AS amount FROM balances WHERE reconciled = 0
    UNION ALL
    SELECT CASE WHEN m.created_at < @start THEN '' ELSE date(m.created_at, '+3 hours') END AS day,
      SUM(m.quantity_delta * (1.0 * b.cost)) AS amount
    FROM stock_movements m JOIN balances b ON b.product_id = m.product_id AND b.warehouse_id = m.warehouse_id AND b.reconciled = 1
    WHERE m.workspace_id = @workspace AND m.created_at < @end ${warehouseFilter("m", query)}
    GROUP BY 1`).all(params) as Array<{ day: string | null; amount: number }>;
  const daily = new Map(rows.map(row => [row.day, row.amount]));
  const openingValue = daily.get("") ?? 0;
  let value = openingValue;
  const trend: Array<{ day: string; value: number }> = [];
  for (let day = Date.parse(String(params.start)); day < Date.parse(String(params.end)); day += dayMs) {
    const date = localDay(day);
    value += daily.get(date) ?? 0;
    trend.push({ day: date, value });
  }
  return { trend, openingValue, closingValue: value, unreconciledRows: daily.get(null) ?? 0 };
}

export function stockReport(workspace: string, section: Section, query: ReportQuery) {
  const today = localDay(Date.now());
  if (query.to > today) throw new AppError(400, "REPORT_DATE_IN_FUTURE", "Bitiş tarihi bugünden sonra olamaz.");
  return db.transaction(() => {
    const params: Params = {
      workspace,
      start: new Date(`${query.from}T00:00:00+03:00`).toISOString(),
      end: new Date(Date.parse(`${query.to}T00:00:00+03:00`) + dayMs).toISOString(),
    };
    if (query.warehouseId) {
      if (!db.prepare("SELECT 1 FROM warehouses WHERE id = ? AND workspace_id = ?").get(query.warehouseId, workspace)) {
        throw new AppError(404, "WAREHOUSE_NOT_FOUND", "Depo bulunamadı.");
      }
      params.warehouseId = query.warehouseId;
    }
    if (section === "outbound") return outboundReport(query, params);
    if (section === "idle") return idleStockReport(query, params, query.to === today);
    return valueReport(query, params);
  })();
}
