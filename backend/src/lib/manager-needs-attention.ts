import { supabase } from "./supabase.js";
import { orderInventoryLinesFromRow } from "./order-inventory.js";
import { listSalesBonusPrograms } from "./sales-bonus-engine.js";

// Server-side counterpart to every check in the Manager Dashboard's "Needs
// Attention" tab (src/App.tsx, renderNeedsAttentionPanel) - that tab is
// entirely client-side, only visible when someone has it open, so nothing
// ever proactively told an Owner/Admin/Manager a leak had shown up. This
// recomputes the same conditions here so a daily digest notification can
// fire instead. Approximates the client's exact edge-case handling (e.g.
// business-hours-aware minute counting) with plain wall-clock time where the
// difference doesn't matter for a once-a-day digest.

const CLOSED_ORDER_STATUSES = new Set(["Delivered", "Cancelled", "Failed"]);
const STOCK_MISMATCH_WINDOW_DAYS = 60;
const STUCK_IN_NEW_MINUTES = 20;
const FAILED_NOTE_MIN_WORDS = 3;
const FEE_TYPO_MULTIPLE = 10;
const DELIVERY_LEAK_MIN_FINALIZED = 5;
const DELIVERY_LEAK_RATE_THRESHOLD = 60;

export type NeedsAttentionSummary = {
  reviewHold: number;
  skippedDeduction: number;
  stockMismatch: number;
  unassigned: number;
  stuckInNew: number;
  thinFailedNotes: number;
  feeTypos: number;
  upgradeGaps: number;
  deliveryLeaks: number;
  total: number;
};

type NeedsAttentionOrderRow = {
  id: string;
  status?: string | null;
  review_hold?: boolean | null;
  assigned_rep_id?: string | null;
  stock_deducted?: boolean | null;
  call_outcome?: string | null;
  logistics_cost?: number | null;
  upsell_from_qty?: number | null;
  upsell_to_qty?: number | null;
  product_id?: string | null;
  product_name?: string | null;
  state?: string | null;
  created_at?: string | null;
  delivered_date?: string | null;
  quantity?: number | null;
  package_components_snapshot?: unknown;
  cross_sell_lines?: unknown;
  free_gift_lines?: unknown;
};

export const computeNeedsAttentionSummary = async (orgId: string): Promise<NeedsAttentionSummary> => {
  const { data, error } = await supabase
    .from("orders")
    .select("id, status, review_hold, assigned_rep_id, stock_deducted, call_outcome, logistics_cost, upsell_from_qty, upsell_to_qty, product_id, product_name, state, created_at, delivered_date, quantity, package_components_snapshot, cross_sell_lines, free_gift_lines")
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as NeedsAttentionOrderRow[];

  const reviewHold = rows.filter((order) => order.review_hold).length;

  const skippedDeduction = rows.filter((order) => order.status === "Delivered" && !order.stock_deducted).length;

  const stockMismatch = await countStockMismatches(orgId, rows);

  const unassigned = rows.filter((order) => {
    const status = order.status ?? "New";
    return !CLOSED_ORDER_STATUSES.has(status) && !order.review_hold && !order.assigned_rep_id;
  }).length;

  const nowMs = Date.now();
  const stuckInNew = rows.filter((order) => {
    if ((order.status ?? "New") !== "New" || !order.assigned_rep_id || !order.created_at) return false;
    const createdMs = new Date(order.created_at).getTime();
    return Number.isFinite(createdMs) && (nowMs - createdMs) / 60000 >= STUCK_IN_NEW_MINUTES;
  }).length;

  const thinFailedNotes = rows.filter((order) => {
    if (order.status !== "Failed") return false;
    const text = (order.call_outcome ?? "").trim();
    const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
    return wordCount < FAILED_NOTE_MIN_WORDS;
  }).length;

  const feeTypos = countFeeTypos(rows);

  const upgradeGaps = await countUpgradeGaps(orgId, rows);

  const deliveryLeaks = countDeliveryLeaks(rows);

  const total = reviewHold + skippedDeduction + stockMismatch + unassigned + stuckInNew + thinFailedNotes + feeTypos + upgradeGaps + deliveryLeaks;

  return { reviewHold, skippedDeduction, stockMismatch, unassigned, stuckInNew, thinFailedNotes, feeTypos, upgradeGaps, deliveryLeaks, total };
};

async function countStockMismatches(orgId: string, rows: NeedsAttentionOrderRow[]): Promise<number> {
  const since = new Date(Date.now() - STOCK_MISMATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const candidates = rows.filter((order) =>
    order.status === "Delivered" && order.stock_deducted && (order.delivered_date ?? "") >= since
  );
  if (candidates.length === 0) return 0;

  const orderIds = candidates.map((order) => order.id);
  const { data: movements, error } = await supabase
    .from("stock_movements")
    .select("order_id, product_id, type, qty")
    .eq("org_id", orgId)
    .in("order_id", orderIds)
    .in("type", ["Order Fulfilled", "Status Reversal", "Delete Reversal"]);
  if (error) throw new Error(error.message);

  const netDeductedByOrderProduct = new Map<string, number>();
  for (const movement of movements ?? []) {
    const key = `${movement.order_id}::${movement.product_id}`;
    const qty = Number(movement.qty ?? 0);
    const delta = movement.type === "Order Fulfilled" ? qty : -qty;
    netDeductedByOrderProduct.set(key, (netDeductedByOrderProduct.get(key) ?? 0) + delta);
  }

  const mismatchedOrderIds = new Set<string>();
  for (const order of candidates) {
    const lines = orderInventoryLinesFromRow(order);
    for (const line of lines) {
      const deducted = netDeductedByOrderProduct.get(`${order.id}::${line.productId}`) ?? 0;
      if (deducted < line.quantity) mismatchedOrderIds.add(order.id);
    }
  }
  return mismatchedOrderIds.size;
}

function countFeeTypos(rows: NeedsAttentionOrderRow[]): number {
  const fees = rows
    .filter((order) => order.status === "Delivered" && (order.logistics_cost ?? 0) > 0 && order.assigned_rep_id)
    .map((order) => Math.round(order.logistics_cost ?? 0));
  if (fees.length === 0) return 0;
  const sorted = [...fees].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const typicalFee = sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
  if (typicalFee <= 0) return 0;
  return fees.filter((fee) => fee >= typicalFee * FEE_TYPO_MULTIPLE).length;
}

async function countUpgradeGaps(orgId: string, rows: NeedsAttentionOrderRow[]): Promise<number> {
  const programs = await listSalesBonusPrograms(orgId, false);
  const activeUpgradeRules = programs
    .filter((program) => program.status === "active")
    .flatMap((program) => (program.rules ?? []).filter((rule: any) => rule.status === "active" && rule.type === "upgrade_count"));
  if (activeUpgradeRules.length === 0) {
    // No upgrade rules configured at all means nothing to gap-check against -
    // that's a setup question for Sales Bonus admin, not a per-order leak.
    return 0;
  }

  return rows.filter((order) => {
    if (order.review_hold || (order.status ?? "New") !== "Delivered") return false;
    const from = order.upsell_from_qty;
    const to = order.upsell_to_qty;
    if (typeof from !== "number" || typeof to !== "number" || to <= from) return false;
    return !activeUpgradeRules.some((rule: any) => {
      const cfg = rule.config ?? {};
      const scopeProductId = typeof cfg.scopeProductId === "string" ? cfg.scopeProductId.trim() : "";
      if (scopeProductId && scopeProductId !== order.product_id) return false;
      const fromQty = Math.max(1, Math.round(Number(cfg.fromQty ?? 3)));
      const toQtyMin = Math.max(fromQty + 1, Math.round(Number(cfg.toQtyMin ?? cfg.toQty ?? fromQty + 1)));
      return from === fromQty && to >= toQtyMin;
    });
  }).length;
}

function countDeliveryLeaks(rows: NeedsAttentionOrderRow[]): number {
  const groups = new Map<string, { delivered: number; finalized: number }>();
  for (const order of rows) {
    if (order.review_hold) continue;
    const status = order.status ?? "New";
    if (!CLOSED_ORDER_STATUSES.has(status)) continue;
    const key = `${order.product_id ?? ""}::${(order.state ?? "").trim() || "Unknown"}`;
    const existing = groups.get(key) ?? { delivered: 0, finalized: 0 };
    existing.finalized += 1;
    if (status === "Delivered") existing.delivered += 1;
    groups.set(key, existing);
  }
  let count = 0;
  for (const group of groups.values()) {
    if (group.finalized < DELIVERY_LEAK_MIN_FINALIZED) continue;
    const ratePct = (group.delivered / group.finalized) * 100;
    if (ratePct < DELIVERY_LEAK_RATE_THRESHOLD) count += 1;
  }
  return count;
}
