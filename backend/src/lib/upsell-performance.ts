import { lagosDateKey } from "./sales-bonus-engine.js";

/**
 * Upsell & Cross-Selling Performance page: the call-side facts only.
 *
 * The page's money (extra revenue, contribution profit, rep bonus) is worked
 * out in the browser by the SAME function the Upsell & Cross-Sell Bonus tab
 * uses, so the two pages can never disagree. This module only shapes what the
 * browser cannot see: what the rep offered on each confirmation call, and how
 * the customer answered.
 *
 * ⚠️ UPSELL OFFERS ONLY. Reps tick "no cross-sell offered" on every call (598
 * of 598 from 30 Aug to 1 Oct 2026), including 17 orders that DO carry a
 * cross-sell, so a cross-sell attempt rate would read ~0% and be false. Bright
 * chose upsell attempts only until that logging is fixed. Cross-sells still
 * count as sales, profit and bonus - those come from the orders, not this log.
 */

export type UpsellPerformanceOffer = {
  response: "accepted" | "declined" | "consider_later" | "not_appropriate" | "waived_no_offer";
  refusalReason: string | null;
  offeredQuantity: number | null;
  offeredPackageName: string | null;
  offeredProductName: string | null;
};

export type UpsellPerformanceLogRow = {
  orderId: string;
  repId: string;
  attemptedAt: string;
  /** The Lagos day of the call - the page's date filter works in Lagos days. */
  attemptedKey: string;
  eligible: boolean;
  exemptionReason: string | null;
  productId: string | null;
  productName: string;
  originalQuantity: number;
  /** null when the call logged no upsell line at all. */
  upsell: UpsellPerformanceOffer | null;
};

export type UpsellPerformanceTarget = { repId: string; targetPct: number; weekStart: string };

const OFFER_RESPONSES = new Set(["accepted", "declined", "consider_later", "not_appropriate", "waived_no_offer"]);

export function performanceLogRowFromAttempt(row: any): UpsellPerformanceLogRow {
  const lines: any[] = Array.isArray(row?.offer_lines) ? row.offer_lines : [];
  // One upsell line per attempt is enforced by a unique index
  // (idx_sales_expansion_one_upsell_per_attempt), so find() is exact.
  const upsellLine = lines.find((line) => line?.offer_type === "upsell") ?? null;
  const response = String(upsellLine?.response ?? "");
  const offeredQuantity = Number(upsellLine?.offered_quantity);
  return {
    orderId: String(row.order_id),
    repId: String(row.rep_id),
    attemptedAt: String(row.attempted_at),
    attemptedKey: lagosDateKey(String(row.attempted_at)),
    eligible: row.eligibility === "eligible",
    exemptionReason: row.exemption_reason ?? null,
    productId: row.original_product_id ?? null,
    productName: String(row.original_product_name ?? ""),
    originalQuantity: Math.max(1, Number(row.original_quantity) || 1),
    upsell: upsellLine && OFFER_RESPONSES.has(response)
      ? {
          response: response as UpsellPerformanceOffer["response"],
          refusalReason: upsellLine.refusal_reason ?? null,
          offeredQuantity: Number.isFinite(offeredQuantity) && offeredQuantity > 0 ? offeredQuantity : null,
          offeredPackageName: upsellLine.offered_package_name ?? null,
          offeredProductName: upsellLine.offered_product_name ?? null
        }
      : null
  };
}

/**
 * Each rep's target for a period: the most recent weekly target set on or
 * before the period ends. Targets are set week by week on the bonus tab and
 * then left alone (the last ones were set for 9 Aug 2026), so a strict
 * "this week only" lookup would show most periods with no target at all.
 */
export function latestTargetsByRep(rows: Array<{ rep_id: string; week_start: string; target_pct: unknown }>, dateTo: string): UpsellPerformanceTarget[] {
  const latest = new Map<string, UpsellPerformanceTarget>();
  for (const row of rows) {
    if (!row?.rep_id || !row.week_start || row.week_start > dateTo) continue;
    const current = latest.get(row.rep_id);
    if (!current || row.week_start > current.weekStart) {
      latest.set(row.rep_id, { repId: row.rep_id, weekStart: row.week_start, targetPct: Number(row.target_pct ?? 0) });
    }
  }
  return [...latest.values()];
}
