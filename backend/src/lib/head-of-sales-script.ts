// Head of Sales weekly script + bonus release (Bright, 1 Oct 2026). Pure,
// tested in head-of-sales-script.test.ts.
//
// Bright's question before the Head of Sales bonus is released: did she make
// the team better, or did the reps do it on their own? Each week she submits
// an upsell + cross-sell script. When a rep adds an upsell or cross-sell to an
// order, they tick "I used this week's script". So for every rep:
//   improved vs their own last 4 weeks, mostly on ticked orders -> her influence
//   improved, but on orders without the tick                    -> own effort
// If she reaches a bonus level but no script was submitted, or no rep used it,
// the bonus is HELD for the Owner to release or withhold.

export type RepInfluenceInput = {
  upsellRate: number;
  crossSellRate: number;
  baselineUpsellRate: number;
  baselineCrossSellRate: number;
  /** Orders this week with an upsell or a rep-added cross-sell. */
  expansionOrders: number;
  /** Of those, how many the rep ticked "used this week's script". */
  scriptOrders: number;
};

export type RepInfluence = "influenced" | "mixed" | "own_effort" | "no_improvement" | "no_sales";

export function classifyRepInfluence(input: RepInfluenceInput): { verdict: RepInfluence; label: string } {
  if (input.expansionOrders <= 0) return { verdict: "no_sales", label: "No upsells or cross-sells this week" };
  const improved = input.upsellRate > input.baselineUpsellRate || input.crossSellRate > input.baselineCrossSellRate;
  const used = Math.min(input.scriptOrders, input.expansionOrders);
  if (!improved) {
    return {
      verdict: "no_improvement",
      label: used > 0 ? `No better than their last 4 weeks, even with the script on ${used} order${used === 1 ? "" : "s"}` : "No better than their last 4 weeks"
    };
  }
  if (used === 0) return { verdict: "own_effort", label: "Improved on their own (script not used)" };
  if (used * 2 >= input.expansionOrders) return { verdict: "influenced", label: `Improved using the script (${used} of ${input.expansionOrders} orders)` };
  return { verdict: "mixed", label: `Improved, partly with the script (${used} of ${input.expansionOrders} orders)` };
}

export type HoldReason = "no_script" | "script_not_used";

/** Held only when there is a bonus to hold. */
export function headBonusHold(input: { amount: number; scriptSubmitted: boolean; scriptUses: number }): { held: boolean; reasons: HoldReason[] } {
  if (input.amount <= 0) return { held: false, reasons: [] };
  const reasons: HoldReason[] = [];
  if (!input.scriptSubmitted) reasons.push("no_script");
  else if (input.scriptUses <= 0) reasons.push("script_not_used");
  return { held: reasons.length > 0, reasons };
}

export const HOLD_REASON_TEXT: Record<HoldReason, string> = {
  no_script: "No upsell & cross-sell script was submitted for this week.",
  script_not_used: "A script was submitted, but no rep ticked that they used it on an order."
};

type CrossSellLineLike = { selectionSource?: unknown; selection_source?: unknown } | null | undefined;

/**
 * Whether a rep could have used the script on this order: a recorded upsell,
 * or a cross-sell the REP added. Add-ons the customer picked on the public
 * form are not the rep's sale.
 */
export function orderHasRepExpansion(order: { upsell_from_qty?: number | null; upsell_to_qty?: number | null; cross_sell_lines?: unknown }): boolean {
  const upsell = Boolean(order.upsell_from_qty && order.upsell_to_qty && Number(order.upsell_to_qty) > Number(order.upsell_from_qty));
  if (upsell) return true;
  const lines = Array.isArray(order.cross_sell_lines) ? (order.cross_sell_lines as CrossSellLineLike[]) : [];
  return lines.some((line) => {
    const source = String(line?.selectionSource ?? line?.selection_source ?? "");
    return source !== "public_form" && source !== "public_upsell";
  });
}
