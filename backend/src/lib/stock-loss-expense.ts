// Turning lost stock into a real cost.
//
// Protohub already had two ways to record shrinkage - the agent reconcile
// (defective / missing) and the stock-count write-off - and BOTH only adjusted
// quantities. Neither ever created an expense, so damaged or stolen goods never
// reached the P&L and net profit read better than reality. Audited 2026-08-01:
// every agent location showed 0 defective and 0 missing, and no stock count had
// ever been run, so nothing had been written off at all.
//
// Units lost this way were never sold, so their cost was never recognised as
// COGS (that happens per delivered order). Expensing them here is the only
// place that cost is ever booked - it is not a double count.
//
// Follows the same server-created-expense pattern as waybills (EXP-WB-<id>):
// a deterministic id so re-running an adjustment updates one canonical row
// instead of stacking duplicates.
import { supabase } from "./supabase.js";

/** Reasons that represent stock genuinely leaving the business at a loss. */
export type StockLossReason = "Damaged" | "Theft" | "Unreported Sale" | "Other";

/**
 * "Return to Warehouse" is deliberately NOT a loss - those units came back and
 * are still ours, so charging for them would invent a cost that never happened.
 */
export function isCostedLossReason(reason: string): boolean {
  return reason !== "Return to Warehouse";
}

/** Cheapest unit cost lookup - same source the order COGS math uses. */
export async function unitCostFor(productId: string): Promise<number> {
  const { data } = await supabase
    .from("product_pricings")
    .select("unit_cost")
    .eq("product_id", productId);
  const costs = (data ?? [])
    .map((row: any) => Number(row.unit_cost ?? 0))
    .filter((cost) => Number.isFinite(cost) && cost > 0);
  return costs.length > 0 ? Math.max(...costs) : 0;
}

export type StockLossInput = {
  orgId: string;
  /** Stable per-source key, e.g. the count entry id or reconcile movement id. */
  reference: string;
  productId: string;
  productName: string;
  units: number;
  reason: string;
  context: string;
  date?: string;
};

/**
 * Books the cost of lost units. Returns the amount booked (0 when nothing was
 * charged, e.g. a return, no units, or a product with no unit cost on file).
 *
 * A product with no unit cost books NOTHING rather than a zero-value write-off,
 * so a silent 0 is never mistaken for "this loss was free".
 */
export async function recordStockLossExpense(input: StockLossInput): Promise<number> {
  const units = Math.max(0, Math.floor(input.units));
  if (units === 0) return 0;
  if (!isCostedLossReason(input.reason)) return 0;

  const unitCost = await unitCostFor(input.productId);
  if (unitCost <= 0) return 0;

  const amount = Math.round(units * unitCost);
  const id = `EXP-SL-${input.reference}`;
  const date = input.date ?? new Date().toISOString().split("T")[0];
  const description = `Stock loss — ${input.productName} x${units} — ${input.reason} (${input.context})`;

  const { data: existing } = await supabase
    .from("expenses")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("id", id)
    .maybeSingle();

  if (existing) {
    await supabase.from("expenses")
      .update({ amount, category: "Stock Loss", description, date, product_id: input.productId })
      .eq("org_id", input.orgId).eq("id", id);
  } else {
    await supabase.from("expenses").insert({
      id,
      org_id: input.orgId,
      date,
      category: "Stock Loss",
      description,
      amount,
      currency: "NGN",
      product_id: input.productId
    });
  }
  return amount;
}
