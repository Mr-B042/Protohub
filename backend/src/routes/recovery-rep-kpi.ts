import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { orderInventoryLinesFromRow } from "../lib/order-inventory.js";
import { buildProductBonusConfigMap, computeOrderBonus, type PayrollOrder, type ProductRecord } from "../lib/payroll-calculator.js";
import { salesExpansionComplianceForRepWeek } from "../lib/sales-expansion.js";
import { sundayWeekStartForDateKey, addDaysToDateKey, lagosDateKey } from "../lib/sales-bonus-engine.js";
import { isWorkingDay } from "../lib/follow-up-kpi.js";
import { scoreOrderDocumentation, type DocumentationScoreOrder } from "../lib/recovery-rep-documentation-score.js";
import { REPORT_ROW_CEILING } from "../lib/query-limits.js";

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
  surplusBonusPct: 20,
  // Migration 183 - the rep-facing pay model.
  bonusPerRecoveredOrder: 1000,
  weeklyRecoveredTarget: 15,
  monthlyRecoveredTarget: 60,
  // Migration 185 - minimum orders to pick up and work each day.
  dailyFollowUpPickTarget: 10,
  dailyRetentionPickTarget: 10,
  // Migration 205 - how many unfinished orders one rep may hold at once.
  maxOpenClaims: 20
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
    surplusBonusPct: Number(data.surplus_bonus_pct ?? DEFAULT_KPI_SETTINGS.surplusBonusPct),
    bonusPerRecoveredOrder: Number(data.bonus_per_recovered_order ?? DEFAULT_KPI_SETTINGS.bonusPerRecoveredOrder),
    weeklyRecoveredTarget: Number(data.weekly_recovered_target ?? DEFAULT_KPI_SETTINGS.weeklyRecoveredTarget),
    monthlyRecoveredTarget: Number(data.monthly_recovered_target ?? DEFAULT_KPI_SETTINGS.monthlyRecoveredTarget),
    dailyFollowUpPickTarget: Number(data.daily_follow_up_pick_target ?? DEFAULT_KPI_SETTINGS.dailyFollowUpPickTarget),
    dailyRetentionPickTarget: Number(data.daily_retention_pick_target ?? DEFAULT_KPI_SETTINGS.dailyRetentionPickTarget),
    maxOpenClaims: Number(data.max_open_claims ?? DEFAULT_KPI_SETTINGS.maxOpenClaims)
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

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Owner-editable "any date range" filter (replaces the old month-only
// picker on the Recovery Rep Dashboard's Overview tab). dateFrom/dateTo
// take precedence when both are present and valid; falls back to the
// existing month-based bounds otherwise, so nothing else calling this
// endpoint (or an older frontend build) breaks.
const resolveBounds = (query: Record<string, unknown>) => {
  const dateFrom = typeof query.dateFrom === "string" && DATE_KEY_PATTERN.test(query.dateFrom) ? query.dateFrom : null;
  const dateTo = typeof query.dateTo === "string" && DATE_KEY_PATTERN.test(query.dateTo) ? query.dateTo : null;
  if (dateFrom && dateTo && dateFrom <= dateTo) {
    const exclusiveEndDate = new Date(`${dateTo}T00:00:00Z`);
    exclusiveEndDate.setUTCDate(exclusiveEndDate.getUTCDate() + 1);
    return { monthKey: `${dateFrom}..${dateTo}`, start: dateFrom, exclusiveEnd: exclusiveEndDate.toISOString().slice(0, 10) };
  }
  return monthBounds(typeof query.month === "string" ? query.month : undefined);
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
    const { monthKey, start, exclusiveEnd } = resolveBounds(req.query as Record<string, unknown>);

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
        .limit(REPORT_ROW_CEILING)
        .eq("org_id", orgId)
        .eq("assigned_rep_id", repId)
        .eq("status", "Delivered")
        .gte("delivered_date", start)
        .lt("delivered_date", exclusiveEnd)
        .neq("review_hold", true),
      supabase
        .from("orders")
        .select(ORDER_COLUMNS)
        .limit(REPORT_ROW_CEILING)
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
      .limit(REPORT_ROW_CEILING)
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
    // The same measure over the REQUESTED range is netContribution, already
    // computed above - revenue less product cost, logistics and commission. It
    // is aliased rather than recomputed so the two can never drift, and kept
    // alongside weeklyPace rather than replacing it: the dashboard's own "this
    // week" card promises a fixed current week and must keep meaning that.
    const rangePace = netContribution;

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
    // Gated on the quality KPIs the rep actually controls, so the bonus can't
    // be chased by neglecting upsell attempts or documentation.
    //
    // Delivery rate is deliberately NOT a gate for a Recovery Rep. Bright's
    // reasoning: no new leads reach them - every order they touch already
    // died once, so their delivery rate is structurally far below a Sales
    // Rep's on fresh demand. Gating pay on it withheld the bonus for the
    // nature of the work rather than the quality of it. Still measured and
    // shown, just not a condition of getting paid.
    const surplusGatesMet = upsellAttemptRatePct >= settings.upsellAttemptRatePct
      && documentation.ratePct >= settings.documentationRatePct;
    const netContributionSurplus = Math.max(0, netContribution - settings.monthlyTargetMin);
    const surplusBonusValue = surplusGatesMet ? Math.round(netContributionSurplus * (settings.surplusBonusPct / 100)) : 0;

    // The rep-facing pay model (migration 183): a flat amount per RECOVERED
    // order, against weekly and monthly volume targets. A delivered order in
    // this rep's queue IS a recovery - every order they hold arrived already
    // dead - so deliveredCount is the recovered count, no separate tracking.
    // Still gated on the same three quality KPIs, so volume cannot be chased
    // by dropping documentation or skipping upsell attempts.
    // Daily picks (migration 185). Counted as DISTINCT ORDERS THE REP ACTUALLY
    // WORKED today, not orders merely claimed - a claim with no follow-up is
    // not work, and counting claims would let the target be hit by clicking
    // Claim ten times. Follow-up picks come from logged contact attempts,
    // retention picks from logged retention touchpoints.
    const todayKey = lagosDateKey();
    // ⚠️ The pick counters follow the REQUESTED RANGE, not a hard-coded today.
    // They were pinned to today while the bonus beside them moved with the
    // filter, so half the panel answered the date control and half ignored it -
    // which is what made the filter look absent rather than partial.
    // A request with no range still resolves to a window (the month), so
    // "today" is now just the case where that window happens to be one day.
    const rangeIsSingleDay = start === todayKey && exclusiveEnd === addDaysToDateKey(todayKey, 1);
    // Whether the window is exactly one Sunday-week, which is the only shape a
    // WEEKLY target legitimately applies to.
    const rangeIsSingleWeek = start === sundayWeekStartForDateKey(start)
      && exclusiveEnd === addDaysToDateKey(start, 7);
    const pickStart = `${start}T00:00:00`;
    const pickEnd = `${exclusiveEnd}T00:00:00`;
    const [followUpTodayResult, retentionTodayResult] = await Promise.all([
      supabase.from("order_contact_attempts").select("order_id")
        .eq("org_id", orgId).eq("rep_id", repId)
        .gte("attempted_at", pickStart).lt("attempted_at", pickEnd),
      supabase.from("customer_retention_touchpoints").select("order_id")
        .eq("org_id", orgId).eq("logged_by", repId)
        .gte("logged_at", pickStart).lt("logged_at", pickEnd)
    ]);
    const followUpPicksToday = new Set((followUpTodayResult.data ?? []).map((r: any) => r.order_id)).size;
    const retentionPicksToday = new Set((retentionTodayResult.data ?? []).map((r: any) => r.order_id)).size;
    // Sundays are a rest day for this business - the follow-up KPI already
    // skips them (isWorkingDay in follow-up-kpi.ts). Reusing that same rule
    // rather than writing a second one, so there is one definition of "a day
    // we work". On a Sunday the daily target is 0: anything logged still
    // counts and shows, it simply is not owed.
    const isWorkingToday = isWorkingDay(todayKey);

    const recoveredThisMonth = deliveredCount;
    const recoveredThisWeek = weekDelivered.length;
    const recoveryBonusValue = surplusGatesMet
      ? Math.round(recoveredThisMonth * settings.bonusPerRecoveredOrder)
      : 0;
    const failedGates = [
      upsellAttemptRatePct >= settings.upsellAttemptRatePct ? null : "upsell attempt rate",
      documentation.ratePct >= settings.documentationRatePct ? null : "documentation"
    ].filter(Boolean) as string[];

    const recovery = {
      recoveredThisMonth,
      recoveredThisWeek,
      followUpPicksToday,
      retentionPicksToday,
      // ⚠️ A DAILY target only means something over a single day. Across a week
      // or a month it is not a target the rep has failed - it is the wrong
      // denominator entirely, and showing "4 / 10" against a month would invent
      // a shortfall that does not exist. Zero tells the client to render the
      // count with no target beside it.
      dailyFollowUpTarget: rangeIsSingleDay && isWorkingToday ? settings.dailyFollowUpPickTarget : 0,
      dailyRetentionTarget: rangeIsSingleDay && isWorkingToday ? settings.dailyRetentionPickTarget : 0,
      isWorkingDayToday: isWorkingToday,
      // Echoed back so the client can label what it is showing rather than
      // guessing, and can tell "today" from a one-day custom range.
      rangeStart: start,
      rangeEnd: addDaysToDateKey(exclusiveEnd, -1),
      rangeIsSingleDay,
      rangeIsSingleWeek,
      weeklyTarget: settings.weeklyRecoveredTarget,
      monthlyTarget: settings.monthlyRecoveredTarget,
      bonusPerOrder: settings.bonusPerRecoveredOrder,
      bonusValue: recoveryBonusValue,
      // What they WOULD earn if the gates were met - so a rep can see exactly
      // what the quality gates are costing them right now.
      bonusAtRisk: surplusGatesMet ? 0 : Math.round(recoveredThisMonth * settings.bonusPerRecoveredOrder),
      gatesMet: surplusGatesMet,
      failedGates,
      note: surplusGatesMet
        ? `${settings.bonusPerRecoveredOrder.toLocaleString()} per recovered order.`
        : `Held back until ${failedGates.join(", ")} meet target.`
    };

    // A Recovery Rep never receives company revenue, cost, margin or salary -
    // stripped SERVER-SIDE, so it is not merely hidden in the UI. Supervisors
    // get the full picture.
    //
    // ONE exception, added on Bright's instruction: weeklyPace. A rep asked for
    // a naira weekly target and now gets that single figure. The surrounding
    // breakdown it was grouped with - revenue, product cost, logistics,
    // commission, salary, margin - stays stripped, so this exposes a number to
    // aim at without exposing the cost structure behind it.
    const isSupervisorView = scopeRole !== "Recovery Rep";
    if (!isSupervisorView) {
      res.json({
        month: monthKey,
        repId,
        viewerScope: "rep",
        recovery,
        weeklyPace: {
          value: Math.round(weeklyPace),
          target: settings.weeklyPaceTarget,
          weekStart: currentWeekStart,
          // Same measure over the requested range, so a panel with its own
          // period can show that instead without a second endpoint.
          rangeValue: Math.round(rangePace),
          rangeIsSingleWeek
        },
        deliveryRate: { pct: deliveryRatePct, target: settings.minDeliveryRatePct, deliveredCount, closedCount },
        upsellAttemptRate: { pct: upsellAttemptRatePct, target: settings.upsellAttemptRatePct, eligibleCount: eligibleTotal, loggedCount: loggedTotal },
        documentation: {
          pct: documentation.ratePct,
          target: settings.documentationRatePct,
          scoredCount: documentation.scoredCount,
          passingCount: documentation.passingCount,
          criteria: documentation.criteria
        }
      });
      return;
    }

    res.json({
      viewerScope: "supervisor",
      recovery,
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
        weekStart: currentWeekStart,
        rangeValue: Math.round(rangePace),
        rangeIsSingleWeek
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
        passingCount: documentation.passingCount,
        criteria: documentation.criteria
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
          : "Withheld - upsell attempt rate and documentation must both meet their targets first."
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load recovery rep KPI summary." });
  }
});


// ── Recovery candidates ───────────────────────────────────
// Orders that actually died and are worth another conversation.
//
// This has to be its own endpoint because GET /api/orders scopes a frontline
// rep to their OWN orders (isFrontlineRepRole covers Recovery Rep). The
// candidate list was built client-side from that scoped list, so a Recovery Rep
// with no orders saw no candidates, could claim nothing, and therefore stayed
// at no orders forever. Management never hit it because they receive
// everything.
const CANDIDATE_STATUSES = ["Failed", "Cancelled"];
const REJECTION_PATTERN = /reject|refus|not interested|no longer/i;
// Statuses that still count against a rep's open workload. Taken from the
// order_status enum (New, Confirmed, In Process, Dispatched, Delivered,
// Cancelled, Postponed, Failed) - everything except the three that mean the
// order reached a final outcome. Postponed counts: it is still the rep's to
// chase, which is exactly the kind of holding the cap exists to limit.
const OPEN_STATUSES = ["New", "Confirmed", "In Process", "Dispatched", "Postponed"];

async function openClaimCount(orgId: string, repId: string) {
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("assigned_rep_id", repId)
    .in("status", OPEN_STATUSES);
  return count ?? 0;
}

router.get("/candidates", requireRole("Owner", "Admin", "Manager", "Recovery Rep"), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const scopeRole = req.user!.effectiveUserRole ?? req.user!.role;
    const scopeId = req.user!.effectiveUserId ?? req.user!.id;
    const repId = scopeRole === "Recovery Rep" ? scopeId : (typeof req.query.repId === "string" ? req.query.repId : "");

    const settings = await loadKpiSettings(orgId);
    const [{ data, error }, held] = await Promise.all([
      supabase
        .from("orders")
        // state/city/address are here because the candidate card renders them
        // BEFORE a claim. A Recovery Rep's GET /api/orders is scoped to orders
        // already assigned to her, so an unclaimed candidate is absent from
        // that list entirely and every field the card could not get from this
        // endpoint rendered blank ("No state") until she claimed it. This
        // endpoint is her authorised window onto candidates, so it has to carry
        // what the card shows.
        .select("id, customer, phone, status, amount, currency, product_name, package_name, quantity, cross_sell_lines, free_gift_lines, upsell_from_qty, upsell_to_qty, location, state, city, address, call_outcome, response, created_at, updated_at, delivered_date, assigned_rep_id, review_hold")
        .eq("org_id", orgId)
        .or(`status.in.(${CANDIDATE_STATUSES.join(",")}),call_outcome.eq.Product Unavailable`)
        .neq("review_hold", true)
        .order("updated_at", { ascending: false })
        .limit(500),
      repId ? openClaimCount(orgId, repId) : Promise.resolve(0)
    ]);
    if (error) { res.status(500).json({ error: error.message }); return; }

    const rows = (data ?? [])
      // An order already on this rep is their work, not a candidate.
      .filter((order: any) => !repId || order.assigned_rep_id !== repId)
      .map((order: any) => ({
        id: order.id,
        customer: order.customer,
        phone: order.phone,
        status: order.status,
        amount: Number(order.amount ?? 0),
        currency: order.currency ?? "NGN",
        // Both, not one or the other. The card previously showed only the
        // package - "Home Pack" with no clue what product it was a pack of -
        // which is not enough to open a recovery call on.
        productName: order.product_name ?? null,
        packageName: order.package_name ?? null,
        quantity: Number(order.quantity ?? 0) || null,
        // What else was on the order. A customer who added items or upgraded
        // was more committed than the amount alone suggests, and that changes
        // how the call should go.
        addOns: (Array.isArray(order.cross_sell_lines) ? order.cross_sell_lines : [])
          .map((line: any) => ({ name: line?.productName ?? "Add-on", quantity: Number(line?.quantity ?? 0) }))
          .filter((line: any) => line.name),
        freeGifts: (Array.isArray(order.free_gift_lines) ? order.free_gift_lines : [])
          .map((line: any) => ({ name: line?.productName ?? "Gift", quantity: Number(line?.quantity ?? 0) }))
          .filter((line: any) => line.name),
        upgradedFrom: order.upsell_from_qty ? Number(order.upsell_from_qty) : null,
        upgradedTo: order.upsell_to_qty ? Number(order.upsell_to_qty) : null,
        location: order.location ?? null,
        state: order.state ?? null,
        city: order.city ?? null,
        address: order.address ?? null,
        callOutcome: order.call_outcome ?? null,
        response: order.response ?? null,
        closedAt: order.delivered_date ?? order.updated_at ?? order.created_at,
        createdAt: order.created_at,
        reason: CANDIDATE_STATUSES.includes(order.status)
          ? (REJECTION_PATTERN.test(order.call_outcome ?? "") ? "Rejected" : order.status)
          : "Product Unavailable"
      }));

    const cap = Math.max(0, Number(settings.maxOpenClaims ?? 0));
    res.json({
      rows,
      cap,
      held,
      // Said plainly so the UI never has to guess why the button is off.
      remaining: cap === 0 ? 0 : Math.max(0, cap - held),
      canClaim: cap > 0 && held < cap
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load recovery candidates." });
  }
});

// Claiming is its own endpoint rather than a plain order PATCH so the cap is
// enforced on the server. A cap only checked in the browser is a suggestion.
router.post("/claim", requireRole("Owner", "Admin", "Manager", "Recovery Rep"), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const scopeRole = req.user!.effectiveUserRole ?? req.user!.role;
    const scopeId = req.user!.effectiveUserId ?? req.user!.id;
    const orderId = typeof req.body?.orderId === "string" ? req.body.orderId : "";
    const bodyRepId = typeof req.body?.repId === "string" ? req.body.repId : "";
    // A rep may only claim for themselves. Management may claim on behalf of a
    // named rep, which is how a supervisor hands work over.
    const repId = scopeRole === "Recovery Rep" ? scopeId : bodyRepId;
    if (!orderId || !repId) { res.status(400).json({ error: "An order and a rep are required." }); return; }

    const { data: rep } = await supabase.from("users")
      .select("id, name, role, active").eq("org_id", orgId).eq("id", repId).maybeSingle();
    if (!rep || !rep.active || rep.role !== "Recovery Rep") {
      res.status(400).json({ error: "Claims can only go to an active Recovery Rep." });
      return;
    }

    const { data: order } = await supabase.from("orders")
      .select("id, status, call_outcome, assigned_rep_id").eq("org_id", orgId).eq("id", orderId).maybeSingle();
    if (!order) { res.status(404).json({ error: "Order not found." }); return; }
    if (order.assigned_rep_id === repId) { res.status(409).json({ error: "That order is already theirs." }); return; }

    const isCandidate = CANDIDATE_STATUSES.includes(order.status) || order.call_outcome === "Product Unavailable";
    if (!isCandidate) {
      // A live order belongs to the sales rep working it. Claiming it would put
      // two people on the same customer - the exact thing the candidate rules
      // were narrowed to prevent.
      res.status(409).json({ error: "Only failed, cancelled or rejected orders can be claimed for recovery." });
      return;
    }

    const settings = await loadKpiSettings(orgId);
    const cap = Math.max(0, Number(settings.maxOpenClaims ?? 0));
    const held = await openClaimCount(orgId, repId);
    if (cap === 0) { res.status(409).json({ error: "Claiming is switched off. Set an open-order limit in Recovery settings." }); return; }
    if (held >= cap) {
      res.status(409).json({
        error: `${rep.name} already holds ${held} open orders, the limit is ${cap}. Close some before claiming more.`
      });
      return;
    }

    const { error } = await supabase.from("orders")
      .update({ assigned_rep_id: repId, assigned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("org_id", orgId).eq("id", orderId);
    if (error) { res.status(500).json({ error: error.message }); return; }

    res.json({ ok: true, held: held + 1, cap, remaining: Math.max(0, cap - (held + 1)) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not claim that order." });
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
    bonus_per_recovered_order: Number(body.bonusPerRecoveredOrder ?? DEFAULT_KPI_SETTINGS.bonusPerRecoveredOrder),
    weekly_recovered_target: Number(body.weeklyRecoveredTarget ?? DEFAULT_KPI_SETTINGS.weeklyRecoveredTarget),
    monthly_recovered_target: Number(body.monthlyRecoveredTarget ?? DEFAULT_KPI_SETTINGS.monthlyRecoveredTarget),
    daily_follow_up_pick_target: Number(body.dailyFollowUpPickTarget ?? DEFAULT_KPI_SETTINGS.dailyFollowUpPickTarget),
    daily_retention_pick_target: Number(body.dailyRetentionPickTarget ?? DEFAULT_KPI_SETTINGS.dailyRetentionPickTarget),
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

// ── GET /worklist ─────────────────────────────────────────
// Bright's brief: "Do not randomly call everyone. Work from the customers most
// likely to produce money first." One ranked queue, split into the eight
// categories he named, ordered by his five priority tiers.
//
// Everything is derived from orders already in the table - no new columns, and
// nothing a rep has to remember to fill in. Where a category cannot be proven
// from the data it says so rather than guessing (see NOT_TRACKED below).
const WORKLIST_CATEGORIES = {
  failed_delivery: { code: "A", label: "Failed Delivery", blurb: "Delivery was attempted and failed." },
  rescheduled: { code: "B", label: "Rescheduled (lapsed)", blurb: "Agreed a new date, then it passed with no follow-up." },
  not_picking: { code: "C", label: "Not Picking Calls", blurb: "Died unreached - rang out and was never picked up." },
  unreachable: { code: "D", label: "Number Not Reachable", blurb: "Died unreached - switched off, unavailable or wrong number." },
  cancelled: { code: "E", label: "Cancelled", blurb: "Customer cancelled the order." },
  interested_no_order: { code: "F", label: "Interested, Never Ordered", blurb: "Showed interest but never completed an order." },
  dormant: { code: "H", label: "Dormant Customer", blurb: "Has not bought in a long time." }
} as const;
type WorklistCategory = keyof typeof WORKLIST_CATEGORIES;

// Bright's tiers, in his order. Anything he did not rank is tier 6 so it still
// appears - it is just worked after the money.
const CATEGORY_PRIORITY: Record<WorklistCategory, number> = {
  rescheduled: 1,
  failed_delivery: 2,
  cancelled: 3,
  dormant: 4,
  not_picking: 5,
  unreachable: 5,
  interested_no_order: 5
};

const NOT_PICKING_PATTERN = /no answer|not picking|didn'?t pick|did not pick|no response|unanswered|rang out/i;
const UNREACHABLE_PATTERN = /switched off|switch off|unreachable|not reachable|out of coverage|number busy|line busy|wrong number|does not exist/i;

router.get("/worklist", requireRole("Owner", "Admin", "Manager", "Recovery Rep"), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const dormantDays = Math.max(1, Number(req.query.dormantDays) || 60);
    const todayMs = Date.now();
    const daysSince = (value?: string | null) =>
      value ? Math.floor((todayMs - new Date(value).getTime()) / 86400000) : null;

    const { data, error } = await supabase
      .from("orders")
      .select("id, customer, phone, status, amount, currency, product_name, state, city, call_outcome, response, scheduled_date, next_follow_up_at, created_at, updated_at, delivered_date, assigned_rep_id, review_hold")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(4000);
    if (error) throw error;

    const orders = (data ?? []).filter((order: any) => !order.review_hold);

    // Customer-level facts first: G and H are about a person's history, not one
    // order, so they cannot be decided row by row.
    const byPhone = new Map<string, { delivered: number; total: number; lastDeliveredAt: string | null }>();
    for (const order of orders) {
      const key = String(order.phone ?? "").replace(/\D/g, "").slice(-10);
      if (key.length < 7) continue;
      const entry = byPhone.get(key) ?? { delivered: 0, total: 0, lastDeliveredAt: null };
      entry.total += 1;
      if (order.status === "Delivered") {
        entry.delivered += 1;
        const when = order.delivered_date ?? order.updated_at ?? order.created_at;
        if (when && (!entry.lastDeliveredAt || when > entry.lastDeliveredAt)) entry.lastDeliveredAt = when;
      }
      byPhone.set(key, entry);
    }

    // Recovery works orders that ACTUALLY DIED. A live order still belongs to
    // the sales rep working it, and putting it here puts two people on the same
    // customer - the exact problem that kept open orders out of Recovery in the
    // first place.
    //
    // The first cut of this leaked badly: 22 live orders sat in Rescheduled,
    // and Not Picking / Not Reachable matched on call_outcome with no status
    // guard at all, so they pulled in 24 live orders AND 35 already-DELIVERED
    // ones. A delivered order in a "not picking calls" queue is nonsense.
    const OPEN_STATUSES = new Set(["New", "Confirmed", "In Process", "Dispatched"]);

    // Postponed is NOT a dead status - it is a live order with a promise
    // attached, and treating it as recoverable was the remaining leak. All 76
    // Postponed orders in production are actively worked: every one has either
    // a future delivery date, a future follow-up, or a touch in the last week.
    // Handing those to Recovery puts a second rep on a customer the sales rep
    // has already agreed a date with.
    //
    // It only becomes recovery work once the promise LAPSES - the agreed date
    // has passed, no follow-up is booked, and nobody has touched it. Until
    // then it belongs to whoever made the promise.
    const STALE_AFTER_DAYS = 7;
    const isLapsedPostponement = (order: any) => {
      const today = lagosDateKey();
      const scheduled = typeof order.scheduled_date === "string" ? order.scheduled_date.slice(0, 10) : null;
      const nextFollowUp = typeof order.next_follow_up_at === "string" ? order.next_follow_up_at.slice(0, 10) : null;
      const touchedDaysAgo = daysSince(order.updated_at);
      if (scheduled && scheduled >= today) return false;      // still due
      if (nextFollowUp && nextFollowUp >= today) return false; // still booked
      return touchedDaysAgo !== null && touchedDaysAgo > STALE_AFTER_DAYS;
    };

    const categorize = (order: any): WorklistCategory | null => {
      const status = order.status ?? "New";
      const outcome = String(order.call_outcome ?? "");
      const phoneKey = String(order.phone ?? "").replace(/\D/g, "").slice(-10);
      const history = byPhone.get(phoneKey);

      // Live orders are never recovery work, whatever the last note says.
      if (OPEN_STATUSES.has(status)) return null;

      // A delivered order that went fine is NOT recovery work. Every past
      // customer would qualify - 638 of them - which is a customer list, not a
      // queue of things to fix. Those belong to Customer Retention, which
      // already ranks them by lifecycle. The only delivered customer worth
      // surfacing here is one who has gone quiet long enough to be a win-back.
      if (status === "Delivered") {
        if (!history) return null;
        const idleDays = daysSince(history.lastDeliveredAt);
        return idleDays !== null && idleDays >= dormantDays ? "dormant" : null;
      }

      if (status === "Postponed") return isLapsedPostponement(order) ? "rescheduled" : null;

      // Everything below here is Failed or Cancelled. The outcome decides WHY
      // it died, which is what the rep needs before dialling - so unreachable
      // and not-picking are sub-classes of dead, not their own status bucket.
      if (UNREACHABLE_PATTERN.test(outcome)) return "unreachable";
      if (NOT_PICKING_PATTERN.test(outcome)) return "not_picking";
      if (status === "Cancelled") return "cancelled";
      if (status === "Failed") return "failed_delivery";
      return null;
    };

    // One row per customer per category - calling the same person twice about
    // the same thing is exactly the "randomly call everyone" problem.
    const seen = new Set<string>();
    const rows = orders
      .map((order: any) => {
        const category = categorize(order);
        if (!category) return null;
        const phoneKey = String(order.phone ?? "").replace(/\D/g, "").slice(-10);
        const dedupeKey = `${phoneKey}|${category}`;
        if (seen.has(dedupeKey)) return null;
        seen.add(dedupeKey);
        const history = byPhone.get(phoneKey);
        const closedAt = order.delivered_date ?? order.updated_at ?? order.created_at;
        return {
          orderId: order.id,
          customer: order.customer,
          phone: order.phone,
          state: order.state ?? null,
          city: order.city ?? null,
          productName: order.product_name ?? null,
          amount: Number(order.amount ?? 0),
          currency: order.currency ?? "NGN",
          status: order.status,
          category,
          categoryCode: WORKLIST_CATEGORIES[category].code,
          categoryLabel: WORKLIST_CATEGORIES[category].label,
          priority: CATEGORY_PRIORITY[category],
          lastOutcome: String(order.call_outcome ?? "").split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean).slice(-1)[0] ?? null,
          scheduledDate: order.scheduled_date ?? null,
          daysSinceClosed: daysSince(closedAt),
          // Shown so a rep can see an order is already someone's before ringing
          // it. Rescheduled deliveries were previously kept out of Recovery
          // precisely because two reps could land on the same live order; they
          // are back in as tier 1 per Bright, with the owner visible instead of
          // the whole category hidden.
          assignedRepId: order.assigned_rep_id ?? null,
          customerOrders: history?.total ?? 0,
          customerDelivered: history?.delivered ?? 0
        };
      })
      .filter(Boolean) as any[];

    // Freshest first inside a tier: a customer who died yesterday is far more
    // recoverable than one who died in March.
    rows.sort((a, b) => a.priority - b.priority || (a.daysSinceClosed ?? 9999) - (b.daysSinceClosed ?? 9999));

    const counts = Object.keys(WORKLIST_CATEGORIES).reduce((acc, key) => {
      acc[key] = rows.filter((row) => row.category === key).length;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      rows,
      counts,
      dormantDays,
      categories: WORKLIST_CATEGORIES,
      // Said out loud rather than shipped as a silent zero: "interested but
      // never ordered" is a person who never became an order, so it cannot be
      // derived from the orders table. It lives in abandoned carts and sales
      // leads, and wiring those in is its own piece of work.
      notTracked: ["interested_no_order"]
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load the recovery worklist." });
  }
});

export default router;
