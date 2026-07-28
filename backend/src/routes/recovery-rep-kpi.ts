import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { orderInventoryLinesFromRow } from "../lib/order-inventory.js";
import { buildProductBonusConfigMap, computeOrderBonus, type PayrollOrder, type ProductRecord } from "../lib/payroll-calculator.js";
import { salesExpansionComplianceForRepWeek } from "../lib/sales-expansion.js";
import { sundayWeekStartForDateKey, addDaysToDateKey, lagosDateKey } from "../lib/sales-bonus-engine.js";
import { scoreOrderDocumentation, type DocumentationScoreOrder } from "../lib/recovery-rep-documentation-score.js";

const router = Router();
router.use(requireAuth);

const DEFAULT_KPI_SETTINGS = {
  monthlyTargetMin: 380000,
  monthlyTargetPreferred: 400000,
  weeklyPaceTarget: 95000,
  minDeliveryRatePct: 65,
  upsellAttemptRatePct: 85,
  documentationRatePct: 95,
  repMonthlySalary: 70000,
  surplusBonusPct: 20
};

async function loadKpiSettings(orgId: string) {
  const { data } = await supabase
    .from("recovery_rep_kpi_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) return DEFAULT_KPI_SETTINGS;
  return {
    monthlyTargetMin: Number(data.monthly_target_min ?? DEFAULT_KPI_SETTINGS.monthlyTargetMin),
    monthlyTargetPreferred: Number(data.monthly_target_preferred ?? DEFAULT_KPI_SETTINGS.monthlyTargetPreferred),
    weeklyPaceTarget: Number(data.weekly_pace_target ?? DEFAULT_KPI_SETTINGS.weeklyPaceTarget),
    minDeliveryRatePct: Number(data.min_delivery_rate_pct ?? DEFAULT_KPI_SETTINGS.minDeliveryRatePct),
    upsellAttemptRatePct: Number(data.upsell_attempt_rate_pct ?? DEFAULT_KPI_SETTINGS.upsellAttemptRatePct),
    documentationRatePct: Number(data.documentation_rate_pct ?? DEFAULT_KPI_SETTINGS.documentationRatePct),
    repMonthlySalary: Number(data.rep_monthly_salary ?? DEFAULT_KPI_SETTINGS.repMonthlySalary),
    surplusBonusPct: Number(data.surplus_bonus_pct ?? DEFAULT_KPI_SETTINGS.surplusBonusPct)
  };
}

const monthBounds = (month: string | undefined) => {
  const key = /^\d{4}-\d{2}$/.test(month ?? "") ? (month as string) : lagosDateKey().slice(0, 7);
  const start = `${key}-01`;
  const startDate = new Date(`${start}T00:00:00Z`);
  const nextMonth = new Date(startDate);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const exclusiveEnd = nextMonth.toISOString().slice(0, 10);
  return { monthKey: key, start, exclusiveEnd };
};

// Real COGS per delivered order: expand every inventory-consuming line
// (base product, package components, cross-sells, free gifts - mirrors
// src/App.tsx's costForOrder) and cost it against that product's unit_cost
// in the order's currency.
async function costForOrders(orders: Array<{ id: string; currency?: string | null; product_id?: string | null; product_name?: string | null; quantity?: number | null; package_components_snapshot?: unknown; cross_sell_lines?: unknown; free_gift_lines?: unknown }>) {
  const linesByOrder = new Map(orders.map((order) => [order.id, orderInventoryLinesFromRow(order)]));
  const productIds = new Set<string>();
  for (const lines of linesByOrder.values()) {
    for (const line of lines) productIds.add(line.productId);
  }
  const pricingByProductCurrency = new Map<string, number>();
  if (productIds.size > 0) {
    const { data: pricings } = await supabase
      .from("product_pricings")
      .select("product_id, currency, unit_cost")
      .in("product_id", Array.from(productIds));
    for (const row of (pricings ?? []) as Array<{ product_id: string; currency: string; unit_cost: number }>) {
      pricingByProductCurrency.set(`${row.product_id}::${row.currency}`, Number(row.unit_cost ?? 0));
    }
  }
  const costByOrderId = new Map<string, number>();
  for (const order of orders) {
    const currency = order.currency ?? "NGN";
    const lines = linesByOrder.get(order.id) ?? [];
    let total = 0;
    for (const line of lines) {
      const unitCost = pricingByProductCurrency.get(`${line.productId}::${currency}`) ?? 0;
      total += Math.max(0, Number(line.quantity) || 0) * unitCost;
    }
    costByOrderId.set(order.id, total);
  }
  return costByOrderId;
}

router.get("/summary", requireRole("Owner", "Admin", "Manager", "Recovery Rep"), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const scopeRole = req.user!.effectiveUserRole ?? req.user!.role;
    const scopeId = req.user!.effectiveUserId ?? req.user!.id;
    const repId = scopeRole === "Recovery Rep" ? scopeId : (typeof req.query.repId === "string" ? req.query.repId : "");
    if (!repId) { res.status(400).json({ error: "repId is required." }); return; }

    const settings = await loadKpiSettings(orgId);
    const { monthKey, start, exclusiveEnd } = monthBounds(typeof req.query.month === "string" ? req.query.month : undefined);

    // A Recovery Rep's orders never arrive as fresh leads - every order in
    // their queue is an OLD order (cancelled/postponed/rejected weeks or
    // months earlier) reassigned to them, so its created_at is almost never
    // in the month being viewed. Scoping this cohort by created_at (like a
    // normal Sales Rep's month) would silently exclude nearly everything a
    // Recovery Rep actually works. Scope by what happened THIS month instead:
    // delivered orders by delivered_date, cancelled/failed by updated_at
    // (when they most recently reached that terminal status) - matching the
    // same "delivered in period" convention Weekly Pace already uses below.
    const ORDER_COLUMNS = "id, status, currency, amount, logistics_cost, product_id, product_name, quantity, package_components_snapshot, cross_sell_lines, free_gift_lines, manual_bonus_override, bonus_manually_adjusted, upsell_from_qty, upsell_to_qty, source, delivered_date, created_at, call_outcome, next_follow_up_at, scheduled_at, scheduled_date, review_hold";
    const [deliveredThisMonthResult, closedNonDeliveredResult] = await Promise.all([
      supabase
        .from("orders")
        .select(ORDER_COLUMNS)
        .eq("org_id", orgId)
        .eq("assigned_rep_id", repId)
        .eq("status", "Delivered")
        .gte("delivered_date", start)
        .lt("delivered_date", exclusiveEnd)
        .neq("review_hold", true),
      supabase
        .from("orders")
        .select(ORDER_COLUMNS)
        .eq("org_id", orgId)
        .eq("assigned_rep_id", repId)
        .in("status", ["Cancelled", "Failed"])
        .gte("updated_at", `${start}T00:00:00`)
        .lt("updated_at", `${exclusiveEnd}T00:00:00`)
        .neq("review_hold", true)
    ]);
    if (deliveredThisMonthResult.error) { res.status(500).json({ error: deliveredThisMonthResult.error.message }); return; }
    if (closedNonDeliveredResult.error) { res.status(500).json({ error: closedNonDeliveredResult.error.message }); return; }
    const delivered = deliveredThisMonthResult.data ?? [];
    const closedNonDelivered = closedNonDeliveredResult.data ?? [];
    // Documentation completeness scores every order that reached a final
    // outcome this month - the rep's full "did I leave a proper trail"
    // cohort, not just the delivered slice.
    const assigned = [...delivered, ...closedNonDelivered];

    const deliveredCount = delivered.length;
    const closedCount = assigned.length;
    const deliveryRatePct = closedCount > 0 ? Math.round((deliveredCount / closedCount) * 1000) / 10 : 0;

    // Net contribution = revenue - product cost - delivery/logistics -
    // commission, reusing the same components as the existing per-rep
    // "contribution margin" in the Finance tab (financeRepRows,
    // src/App.tsx:17726-17742). Packaging/discount/payment-charge aren't
    // tracked anywhere in Protohub yet - shown as ₦0 below rather than
    // silently folded into another line.
    const revenue = delivered.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
    const logisticsCost = delivered.reduce((sum, order) => sum + Number(order.logistics_cost ?? 0), 0);
    const costByOrderId = await costForOrders(delivered);
    const productCost = Array.from(costByOrderId.values()).reduce((sum, cost) => sum + cost, 0);

    const { data: products } = await supabase
      .from("products")
      .select("id, bonus_config")
      .eq("org_id", orgId);
    const bonusConfigMap = buildProductBonusConfigMap((products ?? []) as ProductRecord[]);
    // Commission cost per order re-uses the existing legacy bonus formula
    // (computeOrderBonus) as the modeled "order commission" overhead - this
    // is the same number this codebase already uses as both rep pay AND a
    // cost line elsewhere; it isn't the same as the Recovery Rep's own
    // ₦70k fixed salary, which is deducted separately below.
    const commissionCost = delivered.reduce((sum, order) => {
      const bonus = computeOrderBonus(order as unknown as PayrollOrder, bonusConfigMap, deliveryRatePct, 0, deliveredCount);
      return sum + Math.max(0, bonus);
    }, 0);

    const netContribution = revenue - productCost - logisticsCost - commissionCost;

    // Weekly pace: the CURRENT Sunday-anchored week's net contribution,
    // independent of which month is being viewed - "pace" is a live,
    // right-now figure, not a historical one.
    const currentWeekStart = sundayWeekStartForDateKey(lagosDateKey());
    const currentWeekEnd = addDaysToDateKey(currentWeekStart, 7);
    const { data: weekOrders } = await supabase
      .from("orders")
      .select("id, status, currency, amount, logistics_cost, product_id, product_name, quantity, package_components_snapshot, cross_sell_lines, free_gift_lines, manual_bonus_override, bonus_manually_adjusted, upsell_from_qty, upsell_to_qty, source, delivered_date, review_hold")
      .eq("org_id", orgId)
      .eq("assigned_rep_id", repId)
      .eq("status", "Delivered")
      .gte("delivered_date", currentWeekStart)
      .lt("delivered_date", currentWeekEnd)
      .neq("review_hold", true);
    const weekDelivered = weekOrders ?? [];
    const weekRevenue = weekDelivered.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
    const weekLogistics = weekDelivered.reduce((sum, order) => sum + Number(order.logistics_cost ?? 0), 0);
    const weekCostByOrderId = await costForOrders(weekDelivered);
    const weekProductCost = Array.from(weekCostByOrderId.values()).reduce((sum, cost) => sum + cost, 0);
    const weekCommission = weekDelivered.reduce((sum, order) => {
      const bonus = computeOrderBonus(order as unknown as PayrollOrder, bonusConfigMap, deliveryRatePct, 0, weekDelivered.length);
      return sum + Math.max(0, bonus);
    }, 0);
    const weeklyPace = weekRevenue - weekProductCost - weekLogistics - weekCommission;

    // Upsell/cross-sell attempt rate: reuse the EXISTING Sales Expansion Log
    // compliance system rather than a parallel tracker - average each
    // Sunday-week's compliancePct that overlaps the requested month,
    // weighted by that week's eligible-order count.
    let cursor = sundayWeekStartForDateKey(start);
    const weekStarts: string[] = [];
    while (cursor < exclusiveEnd) {
      weekStarts.push(cursor);
      cursor = addDaysToDateKey(cursor, 7);
    }
    const complianceWeeks = await Promise.all(
      weekStarts.map((weekStart) => salesExpansionComplianceForRepWeek(orgId, repId, weekStart).catch(() => null))
    );
    let eligibleTotal = 0;
    let loggedTotal = 0;
    for (const week of complianceWeeks) {
      if (!week) continue;
      eligibleTotal += week.eligibleConfirmedCount;
      loggedTotal += week.loggedCount;
    }
    const upsellAttemptRatePct = eligibleTotal > 0 ? Math.round((loggedTotal / eligibleTotal) * 1000) / 10 : 100;

    // Documentation completeness - pure scoring over the same assigned-in-
    // month order set, no new data-entry UI.
    const orderIds = assigned.map((order) => order.id);
    const { data: attemptRows } = orderIds.length
      ? await supabase.from("order_contact_attempts").select("order_id").eq("org_id", orgId).in("order_id", orderIds)
      : { data: [] as Array<{ order_id: string }> };
    const orderIdsWithContactAttempt = new Set((attemptRows ?? []).map((row: { order_id: string }) => row.order_id));
    const documentation = scoreOrderDocumentation(assigned as DocumentationScoreOrder[], orderIdsWithContactAttempt);

    const companyLevelContribution = netContribution - settings.repMonthlySalary;

    // Surplus bonus: a real, direct payout on net contribution ABOVE the
    // monthly floor - not just a pass/fail gate. The floor (₦380k) already
    // covers the rep's own salary + their share of existing staff cost, so
    // everything past it is genuine upside for the company; sharing a cut
    // of that with the rep gives them a direct, personal reason to keep
    // pushing past the minimum instead of stopping once they clear it.
    // Gated on the other 3 quality KPIs so the surplus can't be chased by
    // neglecting delivery rate, upsell attempts, or documentation.
    const surplusGatesMet = deliveryRatePct >= settings.minDeliveryRatePct
      && upsellAttemptRatePct >= settings.upsellAttemptRatePct
      && documentation.ratePct >= settings.documentationRatePct;
    const netContributionSurplus = Math.max(0, netContribution - settings.monthlyTargetMin);
    const surplusBonusValue = surplusGatesMet ? Math.round(netContributionSurplus * (settings.surplusBonusPct / 100)) : 0;

    res.json({
      month: monthKey,
      repId,
      netContribution: {
        value: Math.round(netContribution),
        targetMin: settings.monthlyTargetMin,
        targetPreferred: settings.monthlyTargetPreferred,
        revenue: Math.round(revenue),
        productCost: Math.round(productCost),
        logisticsCost: Math.round(logisticsCost),
        commissionCost: Math.round(commissionCost),
        packagingCost: 0,
        discountCost: 0,
        paymentChargeCost: 0,
        untrackedCostNote: "Packaging cost, discounts, and payment/transaction charges aren't tracked anywhere in Protohub yet - shown as ₦0."
      },
      weeklyPace: {
        value: Math.round(weeklyPace),
        target: settings.weeklyPaceTarget,
        weekStart: currentWeekStart
      },
      deliveryRate: {
        pct: deliveryRatePct,
        target: settings.minDeliveryRatePct,
        deliveredCount,
        closedCount
      },
      upsellAttemptRate: {
        pct: upsellAttemptRatePct,
        target: settings.upsellAttemptRatePct,
        eligibleCount: eligibleTotal,
        loggedCount: loggedTotal
      },
      documentation: {
        pct: documentation.ratePct,
        target: settings.documentationRatePct,
        scoredCount: documentation.scoredCount,
        passingCount: documentation.passingCount
      },
      repMonthlySalary: settings.repMonthlySalary,
      companyLevelContribution: {
        value: Math.round(companyLevelContribution),
        note: "For company reporting only - not the rep-facing metric."
      },
      surplusBonus: {
        value: surplusBonusValue,
        pct: settings.surplusBonusPct,
        surplusBase: Math.round(netContributionSurplus),
        gatesMet: surplusGatesMet,
        note: surplusGatesMet
          ? `${settings.surplusBonusPct}% of net contribution above the ${settings.monthlyTargetMin.toLocaleString()} floor.`
          : "Withheld - delivery rate, upsell attempt rate, and documentation must all meet their targets first."
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load recovery rep KPI summary." });
  }
});

router.patch("/settings", requireRole("Owner"), async (req, res) => {
  const body = req.body ?? {};
  const payload = {
    org_id: req.user!.orgId,
    monthly_target_min: Number(body.monthlyTargetMin ?? DEFAULT_KPI_SETTINGS.monthlyTargetMin),
    monthly_target_preferred: Number(body.monthlyTargetPreferred ?? DEFAULT_KPI_SETTINGS.monthlyTargetPreferred),
    weekly_pace_target: Number(body.weeklyPaceTarget ?? DEFAULT_KPI_SETTINGS.weeklyPaceTarget),
    min_delivery_rate_pct: Number(body.minDeliveryRatePct ?? DEFAULT_KPI_SETTINGS.minDeliveryRatePct),
    upsell_attempt_rate_pct: Number(body.upsellAttemptRatePct ?? DEFAULT_KPI_SETTINGS.upsellAttemptRatePct),
    documentation_rate_pct: Number(body.documentationRatePct ?? DEFAULT_KPI_SETTINGS.documentationRatePct),
    rep_monthly_salary: Number(body.repMonthlySalary ?? DEFAULT_KPI_SETTINGS.repMonthlySalary),
    surplus_bonus_pct: Number(body.surplusBonusPct ?? DEFAULT_KPI_SETTINGS.surplusBonusPct),
    updated_by: req.user!.id,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from("recovery_rep_kpi_settings")
    .upsert(payload, { onConflict: "org_id" })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

export default router;
