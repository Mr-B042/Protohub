import { supabase } from "./supabase.js";
import { REPORT_ROW_CEILING, fetchAllRowsOrThrow } from "./query-limits.js";
import { computeTargetProgress, deliveredOrdersIn, type TargetOrder, type DatedAmount, type TargetProgress } from "./target-progress.js";
import { perOrderBonusMapForDeliveredRange } from "./sales-bonus-engine.js";
import { buildRecoveryPlan, type RecoveryPlan } from "./recovery-plan.js";
import { computeIncentive, type IncentiveOutcome } from "./manager-incentive.js";
import { lagosTodayKey } from "./salary-spread.js";

/**
 * Loads everything a target period needs and computes its progress.
 *
 * ⚠️ ONE LOADER, TWO CALLERS. The /progress endpoint and the nightly snapshot
 * job both go through here on purpose. Two copies of this fetch would be two
 * definitions of the same number, and the snapshot trail would slowly disagree
 * with the screen it is supposed to be a record of.
 *
 * ⚠️ COMMISSIONS ARE ATTRIBUTED PER ORDER, NOT PER REP. A rep earns bonus
 * across every product they sell, so a rep-level total cannot be charged to one
 * product's target - that would load this product's contribution with another
 * product's commission.
 */
export type LoadedTargetProgress = TargetProgress & {
  targetId: string;
  periodStart: string;
  periodEnd: string;
  commissionsIncluded: true;
  recoveryPlan: RecoveryPlan;
  incentive: IncentiveOutcome | null;
  incentiveStatus: string | null;
};

export async function loadTargetProgress(orgId: string, target: any, today: string = lagosTodayKey()): Promise<LoadedTargetProgress> {
  const start = String(target.period_start).slice(0, 10);
  const end = String(target.period_end).slice(0, 10);
  // created_at is a timestamp, so the upper bound is exclusive of the day AFTER
  // the period - `lte end` would drop everything after 00:00:00 on the last day.
  const endExclusive = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const ORDER_COLUMNS = "id, status, amount, quantity, cogs_snapshot, logistics_cost, created_at, delivered_date, review_hold";

    // ⚠️ TWO QUERIES, NOT ONE. An order created in July and delivered in August
    // belongs to August's throughput but not its placed cohort, so neither date
    // alone finds every row that matters. Merged by id below.
    const [placedRows, deliveredRows, adRows, deliveryExpenseRows] = await Promise.all([
      fetchAllRowsOrThrow<any>(() => supabase.from("orders").select(ORDER_COLUMNS)
        .eq("org_id", orgId).eq("product_id", target.product_id)
        .gte("created_at", `${start}T00:00:00.000Z`).lt("created_at", `${endExclusive}T00:00:00.000Z`)
        .order("created_at", { ascending: true }).order("id", { ascending: true })),
      fetchAllRowsOrThrow<any>(() => supabase.from("orders").select(ORDER_COLUMNS)
        .eq("org_id", orgId).eq("product_id", target.product_id).eq("status", "Delivered")
        .gte("delivered_date", start).lte("delivered_date", end)
        .order("delivered_date", { ascending: true }).order("id", { ascending: true })),
      // expenses.product_id is TEXT while products.id is uuid - the cast is
      // required or Postgres refuses the comparison outright.
      fetchAllRowsOrThrow<any>(() => supabase.from("expenses").select("date, amount")
        .eq("org_id", orgId).eq("product_id", String(target.product_id)).eq("category", "Ad Spend")
        .gte("date", start).lte("date", end)
        .order("date", { ascending: true }).order("id", { ascending: true })),
      fetchAllRowsOrThrow<any>(() => supabase.from("expenses").select("date, amount")
        .eq("org_id", orgId).eq("product_id", String(target.product_id))
        .in("category", ["Delivery", "Waybill", "Failed Delivery"])
        .gte("date", start).lte("date", end)
        .order("date", { ascending: true }).order("id", { ascending: true }))
    ]);

    const byId = new Map<string, TargetOrder>();
    for (const row of [...placedRows, ...deliveredRows]) byId.set(row.id, row as TargetOrder);

    // Bonus settled per order across the whole org for this delivered range,
    // then narrowed to this product's delivered orders only.
    const bonusByOrderId = await perOrderBonusMapForDeliveredRange(orgId, start, end);
    const productDelivered = deliveredOrdersIn(Array.from(byId.values()), start, end);
    let commissions = 0;
    const commissionsByDay = new Map<string, number>();
    for (const order of productDelivered) {
      const payable = Number(bonusByOrderId[String(order.id)] ?? 0);
      if (!payable) continue;
      commissions += payable;
      const day = String(order.delivered_date ?? "").slice(0, 10);
      if (day) commissionsByDay.set(day, (commissionsByDay.get(day) ?? 0) + payable);
    }

    const adSpendRows: DatedAmount[] = adRows.map((r: any) => ({ date: String(r.date), amount: Number(r.amount ?? 0) }));
    const deliveryExpenseFallback = deliveryExpenseRows.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);

    const progress = computeTargetProgress(
      {
        periodStart: start,
        periodEnd: end,
        contributionTarget: Number(target.contribution_target ?? 0),
        orderTarget: Number(target.order_target ?? 0),
        deliveredTarget: Number(target.delivered_target ?? 0),
        piecesTarget: Number(target.pieces_target ?? 0),
        deliveryRateTarget: Number(target.delivery_rate_target ?? 0),
        adSpendCeiling: Number(target.ad_spend_ceiling ?? 0)
      },
      Array.from(byId.values()),
      adSpendRows,
      commissions,
      deliveryExpenseFallback,
      commissionsByDay,
      today
    );

    const definition = {
      periodStart: start,
      periodEnd: end,
      contributionTarget: Number(target.contribution_target ?? 0),
      orderTarget: Number(target.order_target ?? 0),
      deliveredTarget: Number(target.delivered_target ?? 0),
      piecesTarget: Number(target.pieces_target ?? 0),
      deliveryRateTarget: Number(target.delivery_rate_target ?? 0),
      adSpendCeiling: Number(target.ad_spend_ceiling ?? 0)
    };
    const recoveryPlan = buildRecoveryPlan(definition, progress);

    // The incentive is optional: a target can exist before anyone is put on it.
    const { data: rule } = await supabase.from("incentive_rules")
      .select("*").eq("target_period_id", target.id).limit(1).maybeSingle();
    const incentive = rule
      ? computeIncentive(
          progress.breakdown.contribution,
          progress.forecast.projectedContribution,
          {
            minimum: Number(target.contribution_minimum ?? 0),
            target: Number(target.contribution_target ?? 0),
            exceptional: Number(target.contribution_exceptional ?? 0)
          },
          {
            baseReward: Number(rule.base_reward ?? 0),
            minimumMultiplier: Number(rule.minimum_multiplier ?? 50),
            targetMultiplier: Number(rule.target_multiplier ?? 100),
            exceptionalMultiplier: Number(rule.exceptional_multiplier ?? 125),
            verificationGates: rule.verification_gates ?? {},
            verificationStatus: rule.verification_status ?? "provisional"
          },
          progress.forecast.daysRemainingInclusive
        )
      : null;


    return {
      targetId: target.id,
      periodStart: start,
      periodEnd: end,
      commissionsIncluded: true,
      ...progress,
      recoveryPlan,
      incentive,
      incentiveStatus: rule?.verification_status ?? null
    };
}
