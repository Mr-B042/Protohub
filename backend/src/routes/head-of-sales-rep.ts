import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  addDaysToDateKey,
  computeRepWeekMetrics,
  computeTeamWeekMetrics,
  computeTrailingBaseline,
  lagosDateKey,
  sundayWeekStartForDateKey,
  weekEndFromStart,
  type HeadOfSalesOrder,
  type TeamWeekMetrics,
  type TrailingBaseline
} from "../lib/head-of-sales-metrics.js";
import { DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS, evaluateHeadOfSalesBonus } from "../lib/head-of-sales-bonus.js";

const router = Router();
// Owner/Admin/Manager can browse any Head of Sales Rep's dashboard; a Sales
// Rep may only ever look at their own (enforced per-request below, since
// "own" depends on which repId was requested).
router.use(requireAuth, requireRole("Owner", "Admin", "Manager", "Sales Rep"));

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WeekQuerySchema = z.object({
  repId: z.string().min(1),
  weekStart: z.string().regex(DATE_KEY_PATTERN).optional()
});

// A rep is only ever compared against reps she doesn't oversee - herself
// excluded - matching "rewarded for making the OTHER reps better," not for
// her own personal sales. Demo accounts never enter the team either.
async function loadTeam(orgId: string, headOfSalesRepId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("role", "Sales Rep")
    .eq("active", true)
    .eq("is_demo", false)
    .neq("id", headOfSalesRepId);
  if (error) throw error;
  return data ?? [];
}

// Shared by every route here: resolve + authorize the target rep, then load
// her team. Throws a {status, message} the route handlers turn into the
// matching HTTP response, so this stays the one place that logic lives.
async function loadRepAndTeam(orgId: string, repId: string, requestingUser: { id: string; role: string }) {
  const { data: repRow, error: repError } = await supabase
    .from("users")
    .select("id, name, role, is_head_of_sales_rep, head_of_sales_rep_appointed_at")
    .eq("org_id", orgId)
    .eq("id", repId)
    .maybeSingle();
  if (repError) throw repError;
  if (!repRow || !repRow.is_head_of_sales_rep) {
    throw Object.assign(new Error("That person is not Head of Sales Rep."), { status: 404 });
  }
  if (requestingUser.role === "Sales Rep" && requestingUser.id !== repRow.id) {
    throw Object.assign(new Error("You can only view your own Head of Sales Rep dashboard."), { status: 403 });
  }
  const teamRows = await loadTeam(orgId, repRow.id);
  return {
    rep: repRow as { id: string; name: string; role: string; is_head_of_sales_rep: boolean; head_of_sales_rep_appointed_at: string | null },
    repIds: teamRows.map((row) => row.id),
    repNameById: new Map(teamRows.map((row) => [row.id, String(row.name ?? "")]))
  };
}

async function loadOrdersSince(orgId: string, repIds: string[], sinceDateKey: string, throughDateKey: string): Promise<HeadOfSalesOrder[]> {
  if (repIds.length === 0) return [];
  const { data, error } = await supabase
    .from("orders")
    .select("id, assigned_rep_id, status, amount, quantity, created_at, delivered_date, review_hold, upsell_from_qty, upsell_to_qty, original_amount, original_quantity, cross_sell_lines")
    .eq("org_id", orgId)
    .in("assigned_rep_id", repIds)
    .gte("created_at", `${sinceDateKey}T00:00:00Z`)
    .lte("created_at", `${throughDateKey}T23:59:59Z`);
  if (error) throw error;
  return (data ?? []) as HeadOfSalesOrder[];
}

const money = (value: number) => `₦${Math.round(Math.max(0, value)).toLocaleString("en-NG")}`;

const vsTarget = (actual: number, targetValue: number) =>
  targetValue > 0 ? Math.round((actual / targetValue) * 1000) / 10 : (actual > 0 ? 100 : 0);

// The 5-metric weighted scorecard, shared by Overview and Weekly Scorecard so
// the two pages can never show a different Total Weighted Score for the same
// week. Targets default to the team's own 4-week baseline until Owner-
// editable settings exist (a later stage) - never an invented number, per
// the Owner's own rule not to set weekly targets before a baseline exists.
// Uncapped by design: a metric run well past target should show as such
// (e.g. 131%), not clip at 100%, matching the supplied design's own
// 112.5/100 total.
function buildScorecard(thisWeek: TeamWeekMetrics, baseline: TrailingBaseline) {
  const target = baseline.team;
  const thisWeekIncremental = thisWeek.team.incrementalRevenueUpsell + thisWeek.team.incrementalRevenueCrossSell;
  const targetIncremental = target.incrementalRevenueUpsell + target.incrementalRevenueCrossSell;
  const baselineIncremental = baseline.team.incrementalRevenueUpsell + baseline.team.incrementalRevenueCrossSell;

  const scorecard = [
    { key: "teamAov", label: "Team AOV", weight: 35, actual: thisWeek.team.aov, target: target.aov, baseline: baseline.team.aov },
    { key: "upsellRate", label: "Upsell Rate", weight: 20, actual: thisWeek.team.upsellRate, target: target.upsellRate, baseline: baseline.team.upsellRate },
    { key: "crossSellRate", label: "Cross-sell Rate", weight: 15, actual: thisWeek.team.crossSellRate, target: target.crossSellRate, baseline: baseline.team.crossSellRate },
    { key: "incrementalRevenue", label: "Incremental Revenue", weight: 20, actual: thisWeekIncremental, target: targetIncremental, baseline: baselineIncremental },
    { key: "teamDeliveryRate", label: "Team Delivery Rate", weight: 10, actual: thisWeek.team.deliveryRate, target: target.deliveryRate, baseline: baseline.team.deliveryRate }
  ].map((row) => ({ ...row, vsTargetPct: vsTarget(row.actual, row.target) }));

  const totalWeightedScore = Math.round(
    scorecard.reduce((sum, row) => sum + row.weight * (row.vsTargetPct / 100), 0) * 10
  ) / 10;

  return { scorecard, totalWeightedScore, target };
}

function appointmentFromRow(appointedAt: string | null) {
  const appointedTime = appointedAt ? new Date(appointedAt).getTime() : null;
  const dayNumber = appointedTime ? Math.max(1, Math.floor((Date.now() - appointedTime) / 86_400_000) + 1) : null;
  const weekNumber = dayNumber ? Math.max(1, Math.ceil(dayNumber / 7)) : null;
  const nextReviewAt = appointedTime ? new Date(appointedTime + 28 * 86_400_000).toISOString() : null;
  const finalReviewAt = appointedTime ? new Date(appointedTime + 90 * 86_400_000).toISOString() : null;
  return { status: "Active" as const, dayNumber, totalDays: 90, weekNumber, appointedAt, nextReviewAt, finalReviewAt };
}

router.get("/overview", async (req, res) => {
  const parsed = WeekQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "repId is required." }); return; }
  const orgId = req.user!.orgId;

  try {
    const { rep, repIds, repNameById } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    const weekStart = parsed.data.weekStart ?? sundayWeekStartForDateKey(lagosDateKey());
    const weekEnd = weekEndFromStart(weekStart);

    // One query covers this week AND the 4 baseline weeks before it.
    const orders = await loadOrdersSince(orgId, repIds, addDaysToDateKey(weekStart, -28), weekEnd);

    const thisWeek = computeTeamWeekMetrics(orders, repIds, weekStart);
    const baseline = computeTrailingBaseline(orders, repIds, weekStart, 4);
    const { scorecard, totalWeightedScore, target } = buildScorecard(thisWeek, baseline);

    const repsMeetingTarget = thisWeek.reps.filter((rep2) =>
      target.aov > 0 ? rep2.aov >= target.aov : rep2.aov > 0
    ).length;

    // 4-week Team AOV trend, oldest to newest, ending with this week.
    const trend: Array<{ weekStart: string; aov: number }> = [];
    for (let offset = 3; offset >= 0; offset -= 1) {
      const ws = addDaysToDateKey(weekStart, -7 * offset);
      trend.push({ weekStart: ws, aov: computeTeamWeekMetrics(orders, repIds, ws).team.aov });
    }

    // Read-only preview - Stage 10 adds real Owner-editable settings and a
    // persisted Pending/Paid record. Qualitative checks default unconfirmed,
    // so a live preview can never show a rep as if Level 2/3 were already
    // signed off before anyone actually reviewed the week.
    const bonus = evaluateHeadOfSalesBonus(DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS, thisWeek.team.aov, thisWeek.team.deliveryRate);

    // Flagged at 90% of target rather than exactly at target, so someone a
    // hair under target isn't lumped in with someone genuinely struggling.
    const ATTENTION_THRESHOLD = 0.9;
    const repsNeedingAttention = thisWeek.reps
      .map((rep2) => {
        const reasons: string[] = [];
        if (target.aov > 0 && rep2.aov < target.aov * ATTENTION_THRESHOLD) {
          reasons.push(`AOV ${rep2.aov.toLocaleString()} is below target ${target.aov.toLocaleString()}`);
        }
        if (target.deliveryRate > 0 && rep2.deliveryRate < target.deliveryRate * ATTENTION_THRESHOLD) {
          reasons.push(`Delivery rate ${rep2.deliveryRate}% is below target ${target.deliveryRate}%`);
        }
        return { repId: rep2.repId, repName: repNameById.get(rep2.repId) ?? "Unknown", aov: rep2.aov, deliveryRate: rep2.deliveryRate, reasons };
      })
      .filter((rep2) => rep2.reasons.length > 0);

    res.json({
      rep: { id: rep.id, name: rep.name },
      appointment: appointmentFromRow(rep.head_of_sales_rep_appointed_at),
      weekStart,
      weekEnd,
      scorecard,
      totalWeightedScore,
      teamSize: repIds.length,
      repsMeetingTarget,
      team: thisWeek.team,
      baseline: baseline.team,
      reps: thisWeek.reps.map((rep2) => ({ ...rep2, name: repNameById.get(rep2.repId) ?? "Unknown" })),
      trend,
      repsNeedingAttention,
      bonus,
      // Placeholder until Stage 9 (Weekly Report) exists.
      weeklyReport: null
    });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load the Head of Sales Rep overview." });
  }
});

router.get("/scorecard", async (req, res) => {
  const parsed = WeekQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "repId is required." }); return; }
  const orgId = req.user!.orgId;
  const HISTORY_WEEKS = 8;

  try {
    const { rep, repIds, repNameById } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    const weekStart = parsed.data.weekStart ?? sundayWeekStartForDateKey(lagosDateKey());
    const weekEnd = weekEndFromStart(weekStart);

    // Covers this week, its own 4-week baseline, AND enough history weeks
    // (each of which needs ITS OWN 4-week trailing baseline) in one query.
    const earliestNeeded = addDaysToDateKey(weekStart, -7 * (HISTORY_WEEKS + 4));
    const orders = await loadOrdersSince(orgId, repIds, earliestNeeded, weekEnd);

    const thisWeek = computeTeamWeekMetrics(orders, repIds, weekStart);
    const baseline = computeTrailingBaseline(orders, repIds, weekStart, 4);
    const { scorecard, totalWeightedScore, target } = buildScorecard(thisWeek, baseline);
    const bonus = evaluateHeadOfSalesBonus(DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS, thisWeek.team.aov, thisWeek.team.deliveryRate);

    const teamAovByRep = thisWeek.reps
      .map((rep2) => ({
        repId: rep2.repId,
        name: repNameById.get(rep2.repId) ?? "Unknown",
        aov: rep2.aov,
        vsTargetPct: vsTarget(rep2.aov, target.aov)
      }))
      .sort((a, b) => b.aov - a.aov);

    // "Potential lost" is explicitly an ESTIMATE, not a hard number: no
    // record exists of what a non-upsold order WOULD have made if offered -
    // it is the count of orders that got neither times the average
    // incremental value THIS team actually achieved when it did happen.
    const avgIncrementalUpsell = thisWeek.team.upsellCount > 0 ? thisWeek.team.incrementalRevenueUpsell / thisWeek.team.upsellCount : 0;
    const avgIncrementalCrossSell = thisWeek.team.crossSellCount > 0 ? thisWeek.team.incrementalRevenueCrossSell / thisWeek.team.crossSellCount : 0;
    const incrementalRevenueBreakdown = {
      fromUpsell: thisWeek.team.incrementalRevenueUpsell,
      fromCrossSell: thisWeek.team.incrementalRevenueCrossSell,
      total: thisWeek.team.incrementalRevenueUpsell + thisWeek.team.incrementalRevenueCrossSell,
      potentialLostUpsell: Math.round(Math.max(0, thisWeek.team.ordersDelivered - thisWeek.team.upsellCount) * avgIncrementalUpsell),
      potentialLostCrossSell: Math.round(Math.max(0, thisWeek.team.ordersDelivered - thisWeek.team.crossSellCount) * avgIncrementalCrossSell),
      isEstimate: true
    };

    // Scorecard History: re-run the same engine for each of the past N
    // weeks - no separate table, this IS the record.
    const history: Array<{ weekStart: string; totalWeightedScore: number; bonusLevel: string; teamAov: number; deliveryRate: number }> = [];
    for (let offset = 0; offset < HISTORY_WEEKS; offset += 1) {
      const ws = addDaysToDateKey(weekStart, -7 * offset);
      const weekMetrics = computeTeamWeekMetrics(orders, repIds, ws);
      const weekBaseline = computeTrailingBaseline(orders, repIds, ws, 4);
      const weekScorecard = buildScorecard(weekMetrics, weekBaseline);
      const weekBonus = evaluateHeadOfSalesBonus(DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS, weekMetrics.team.aov, weekMetrics.team.deliveryRate);
      history.push({
        weekStart: ws,
        totalWeightedScore: weekScorecard.totalWeightedScore,
        bonusLevel: weekBonus.level,
        teamAov: weekMetrics.team.aov,
        deliveryRate: weekMetrics.team.deliveryRate
      });
    }
    history.reverse(); // oldest to newest, ending with this week

    res.json({
      rep: { id: rep.id, name: rep.name },
      weekStart,
      weekEnd,
      scorecard,
      totalWeightedScore,
      team: thisWeek.team,
      baseline: baseline.team,
      teamAovByRep,
      incrementalRevenueBreakdown,
      history,
      bonus
    });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load the Weekly Scorecard." });
  }
});

router.get("/team-performance", async (req, res) => {
  const parsed = WeekQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "repId is required." }); return; }
  const orgId = req.user!.orgId;
  const TREND_WEEKS = 4;

  try {
    const { repIds, repNameById } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    const weekStart = parsed.data.weekStart ?? sundayWeekStartForDateKey(lagosDateKey());
    const weekEnd = weekEndFromStart(weekStart);
    const lastWeekStart = addDaysToDateKey(weekStart, -7);

    // This week, its own 4-week baseline, the trend weeks, AND last week (for
    // the week-over-week delta) all fit inside one query.
    const earliestNeeded = addDaysToDateKey(weekStart, -7 * (TREND_WEEKS + 4));
    const orders = await loadOrdersSince(orgId, repIds, earliestNeeded, weekEnd);

    const thisWeek = computeTeamWeekMetrics(orders, repIds, weekStart);
    const lastWeek = computeTeamWeekMetrics(orders, repIds, lastWeekStart);
    const baseline = computeTrailingBaseline(orders, repIds, weekStart, 4);
    const lastWeekAovByRep = new Map(lastWeek.reps.map((rep) => [rep.repId, rep.aov]));

    const reps = thisWeek.reps.map((rep) => {
      const lastWeekAov = lastWeekAovByRep.get(rep.repId) ?? 0;
      const vsLastWeekAovPct = lastWeekAov > 0 ? Math.round(((rep.aov - lastWeekAov) / lastWeekAov) * 1000) / 10 : (rep.aov > 0 ? 100 : 0);
      const onTarget = baseline.team.aov > 0 ? rep.aov >= baseline.team.aov : rep.aov > 0;
      return {
        repId: rep.repId,
        name: repNameById.get(rep.repId) ?? "Unknown",
        ordersAssigned: rep.ordersAssigned,
        ordersDelivered: rep.ordersDelivered,
        deliveryRate: rep.deliveryRate,
        aov: rep.aov,
        upsellRate: rep.upsellRate,
        crossSellRate: rep.crossSellRate,
        vsLastWeekAovPct,
        status: onTarget ? "On Target" : "Needs Attention"
      };
    });

    const totalReps = repIds.length;
    const repsMeetingAovTarget = reps.filter((rep) => rep.status === "On Target").length;

    // Team Rep Improvement: THIS week's AOV vs the rep's OWN 4-week baseline
    // (not vs the team's baseline) - "improvement" means better than where
    // that specific person already was, matching the Owner's own framing
    // ("Rep A: N18,500 -> is Rep A getting better").
    const repBaselineAov = new Map(repIds.map((repId) => [repId, computeTrailingBaseline(orders, [repId], weekStart, 4).team.aov]));
    let improvedOver5 = 0, improved1to5 = 0, noChange = 0, declined = 0, improvingCount = 0;
    for (const rep of thisWeek.reps) {
      const repBaseline = repBaselineAov.get(rep.repId) ?? 0;
      const deltaPct = repBaseline > 0 ? ((rep.aov - repBaseline) / repBaseline) * 100 : 0;
      if (deltaPct > 5) { improvedOver5 += 1; improvingCount += 1; }
      else if (deltaPct > 1) { improved1to5 += 1; improvingCount += 1; }
      else if (deltaPct >= -1) { noChange += 1; }
      else { declined += 1; }
    }

    // 4-week AOV and Delivery Rate trend, PER REP, oldest to newest.
    const trendWeeks: string[] = [];
    for (let offset = TREND_WEEKS - 1; offset >= 0; offset -= 1) trendWeeks.push(addDaysToDateKey(weekStart, -7 * offset));
    const aovByRepTrend = repIds.map((repId) => ({
      repId,
      name: repNameById.get(repId) ?? "Unknown",
      series: trendWeeks.map((ws) => ({ weekStart: ws, value: computeRepWeekMetrics(orders, repId, ws).aov }))
    }));
    const deliveryRateByRepTrend = repIds.map((repId) => ({
      repId,
      name: repNameById.get(repId) ?? "Unknown",
      series: trendWeeks.map((ws) => ({ weekStart: ws, value: computeRepWeekMetrics(orders, repId, ws).deliveryRate }))
    }));

    res.json({
      weekStart,
      weekEnd,
      stats: {
        totalReps,
        repsMeetingAovTarget,
        teamAvgAov: thisWeek.team.aov,
        teamDeliveryRate: thisWeek.team.deliveryRate,
        teamOrders: thisWeek.team.ordersAssigned
      },
      reps,
      repImprovement: {
        improvingCount,
        totalReps,
        distribution: { improvedOver5, improved1to5, noChange, declined }
      },
      aovByRepTrend,
      deliveryRateByRepTrend
    });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load Team Performance." });
  }
});

type OfferLineRow = {
  attempt_id: string;
  order_id: string;
  offer_type: "upsell" | "cross_sell";
  response: "accepted" | "declined" | "consider_later" | "not_appropriate" | "waived_no_offer";
  offered_product_name?: string | null;
  offered_package_name?: string | null;
  accepted_amount?: number | null;
};

router.get("/upsell-cross-sell", async (req, res) => {
  const parsed = WeekQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "repId is required." }); return; }
  const orgId = req.user!.orgId;

  try {
    const { repIds, repNameById } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    const weekStart = parsed.data.weekStart ?? sundayWeekStartForDateKey(lagosDateKey());
    const weekEnd = weekEndFromStart(weekStart);
    const lastWeekStart = addDaysToDateKey(weekStart, -7);

    // Same headline Upsell Rate / Cross-sell Rate as Overview and Weekly
    // Scorecard - reused, not recomputed, so this page can't disagree with
    // the others about the same week. The offer-line data below adds what
    // those pages don't have: how many customers were actually OFFERED
    // something, not just how many delivered orders ended up upsold.
    const earliestNeeded = addDaysToDateKey(weekStart, -28);
    const orders = await loadOrdersSince(orgId, repIds, earliestNeeded, weekEnd);
    const thisWeek = computeTeamWeekMetrics(orders, repIds, weekStart);
    const lastWeek = computeTeamWeekMetrics(orders, repIds, lastWeekStart);
    const baseline = computeTrailingBaseline(orders, repIds, weekStart, 4);

    // order_sales_expansion_attempts carries rep_id directly (offer_lines
    // does not, so attempts is the scoping point) with its offer lines
    // embedded - one query per week rather than joining separately.
    let offerLines: OfferLineRow[] = [];
    let attemptRepById = new Map<string, string>();
    if (repIds.length > 0) {
      // Widened by a day either side, then filtered precisely in JS via
      // lagosDateKey - same WAT-boundary care as the orders engine.
      const { data: attempts, error: attemptsError } = await supabase
        .from("order_sales_expansion_attempts")
        .select("id, rep_id, order_id, created_at, offer_lines:order_sales_expansion_offer_lines(attempt_id, order_id, offer_type, response, offered_product_name, offered_package_name, accepted_amount)")
        .eq("org_id", orgId)
        .in("rep_id", repIds)
        .gte("created_at", `${addDaysToDateKey(weekStart, -1)}T00:00:00Z`)
        .lte("created_at", `${addDaysToDateKey(weekEnd, 1)}T23:59:59Z`);
      if (attemptsError) throw attemptsError;
      const inWeek = (attempts ?? []).filter((attempt: any) => {
        const key = lagosDateKey(attempt.created_at);
        return key >= weekStart && key <= weekEnd;
      });
      attemptRepById = new Map(inWeek.map((attempt: any) => [attempt.id, attempt.rep_id as string]));
      offerLines = inWeek.flatMap((attempt: any) => (Array.isArray(attempt.offer_lines) ? attempt.offer_lines : []) as OfferLineRow[]);
    }

    // Real offers only - "waived_no_offer" means nothing was actually
    // presented (nothing eligible to offer), so it is not a customer who
    // was offered something and said no.
    const realOffers = offerLines.filter((line) => line.response !== "waived_no_offer");
    const orderIds = Array.from(new Set(realOffers.map((line) => line.order_id)));
    const orderStatusById = new Map<string, string>();
    if (orderIds.length > 0) {
      const { data: statusRows, error: statusError } = await supabase
        .from("orders")
        .select("id, status")
        .eq("org_id", orgId)
        .in("id", orderIds);
      if (statusError) throw statusError;
      for (const row of statusRows ?? []) orderStatusById.set(row.id, row.status);
    }

    const isUpsell = (line: OfferLineRow) => line.offer_type === "upsell";
    const isCrossSell = (line: OfferLineRow) => line.offer_type === "cross_sell";
    const isAccepted = (line: OfferLineRow) => line.response === "accepted";
    const isDelivered = (line: OfferLineRow) => orderStatusById.get(line.order_id) === "Delivered";

    const customersOfferedUpsell = realOffers.filter(isUpsell).length;
    const customersUpgraded = realOffers.filter((line) => isUpsell(line) && isAccepted(line)).length;
    const customersOfferedCrossSell = realOffers.filter(isCrossSell).length;
    const customersCrossSold = realOffers.filter((line) => isCrossSell(line) && isAccepted(line)).length;

    // Per-rep breakdown, joined back through the attempt's rep_id.
    const byRep = new Map<string, { offered: number; accepted: number; revenue: number }>();
    for (const line of realOffers) {
      const repId = attemptRepById.get(line.attempt_id);
      if (!repId) continue;
      const bucket = byRep.get(repId) ?? { offered: 0, accepted: 0, revenue: 0 };
      bucket.offered += 1;
      if (isAccepted(line)) { bucket.accepted += 1; bucket.revenue += Number(line.accepted_amount ?? 0); }
      byRep.set(repId, bucket);
    }
    const byRepDetail = repIds.map((repId) => {
      const repMetrics = thisWeek.reps.find((rep) => rep.repId === repId);
      const offers = byRep.get(repId) ?? { offered: 0, accepted: 0, revenue: 0 };
      return {
        repId,
        name: repNameById.get(repId) ?? "Unknown",
        upsellRate: repMetrics?.upsellRate ?? 0,
        crossSellRate: repMetrics?.crossSellRate ?? 0,
        customersOffered: offers.offered,
        customersUpgraded: offers.accepted,
        incrementalRevenue: Math.round(offers.revenue)
      };
    });

    // Top Performing Offers: group by what was actually offered.
    const offerGroups = new Map<string, { label: string; type: string; offered: number; accepted: number; delivered: number; revenue: number }>();
    for (const line of realOffers) {
      const label = line.offered_package_name || line.offered_product_name || "Unnamed offer";
      const key = `${line.offer_type}::${label}`;
      const group = offerGroups.get(key) ?? { label, type: line.offer_type === "upsell" ? "Upsell" : "Cross-sell", offered: 0, accepted: 0, delivered: 0, revenue: 0 };
      group.offered += 1;
      if (isAccepted(line)) {
        group.accepted += 1;
        group.revenue += Number(line.accepted_amount ?? 0);
        if (isDelivered(line)) group.delivered += 1;
      }
      offerGroups.set(key, group);
    }
    const topOffers = Array.from(offerGroups.values())
      .map((group) => ({ ...group, revenue: Math.round(group.revenue), acceptanceRatePct: group.offered > 0 ? Math.round((group.accepted / group.offered) * 1000) / 10 : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const acceptedOffers = realOffers.filter(isAccepted);
    const deliveredOffers = acceptedOffers.filter(isDelivered);
    const funnel = {
      offered: realOffers.length,
      accepted: acceptedOffers.length,
      delivered: deliveredOffers.length,
      revenue: Math.round(deliveredOffers.reduce((sum, line) => sum + Number(line.accepted_amount ?? 0), 0))
    };

    // 4-week Upsell Rate / Cross-sell Rate trend, off the same engine every
    // other page uses.
    const trend: Array<{ weekStart: string; upsellRate: number; crossSellRate: number }> = [];
    for (let offset = 3; offset >= 0; offset -= 1) {
      const ws = addDaysToDateKey(weekStart, -7 * offset);
      const week = computeTeamWeekMetrics(orders, repIds, ws).team;
      trend.push({ weekStart: ws, upsellRate: week.upsellRate, crossSellRate: week.crossSellRate });
    }

    res.json({
      weekStart,
      weekEnd,
      team: {
        upsellRate: thisWeek.team.upsellRate,
        crossSellRate: thisWeek.team.crossSellRate,
        upsellRateTarget: baseline.team.upsellRate,
        crossSellRateTarget: baseline.team.crossSellRate,
        customersOffered: customersOfferedUpsell + customersOfferedCrossSell,
        customersUpgraded: customersUpgraded + customersCrossSold,
        additionalRevenue: thisWeek.team.incrementalRevenueUpsell + thisWeek.team.incrementalRevenueCrossSell,
        upsellRateDeltaVsLastWeek: Math.round((thisWeek.team.upsellRate - lastWeek.team.upsellRate) * 10) / 10,
        crossSellRateDeltaVsLastWeek: Math.round((thisWeek.team.crossSellRate - lastWeek.team.crossSellRate) * 10) / 10
      },
      byRep: byRepDetail,
      trend,
      topOffers,
      funnel
    });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load Upsell & Cross-sell." });
  }
});

const RepCoachingQuerySchema = z.object({
  repId: z.string().min(1),
  selectedRepId: z.string().min(1).optional(),
  weekStart: z.string().regex(DATE_KEY_PATTERN).optional()
});

router.get("/rep-coaching", async (req, res) => {
  const parsed = RepCoachingQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "repId is required." }); return; }
  const orgId = req.user!.orgId;

  try {
    const { repIds, repNameById } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    const weekStart = parsed.data.weekStart ?? sundayWeekStartForDateKey(lagosDateKey());
    const weekEnd = weekEndFromStart(weekStart);
    const lastWeekStart = addDaysToDateKey(weekStart, -7);
    const selectedRepId = parsed.data.selectedRepId && repIds.includes(parsed.data.selectedRepId)
      ? parsed.data.selectedRepId
      : repIds[0];

    const earliestNeeded = addDaysToDateKey(weekStart, -28);
    const orders = await loadOrdersSince(orgId, repIds, earliestNeeded, weekEnd);
    const thisWeek = computeTeamWeekMetrics(orders, repIds, weekStart);
    const baseline = computeTrailingBaseline(orders, repIds, weekStart, 4);
    const target = baseline.team;

    // Rep-picker strip: every team member's headline AOV + on-target status,
    // same "vs the team's own baseline" definition Overview and Team
    // Performance already use.
    const repStrip = thisWeek.reps.map((rep) => ({
      repId: rep.repId,
      name: repNameById.get(rep.repId) ?? "Unknown",
      aov: rep.aov,
      status: (target.aov > 0 ? rep.aov >= target.aov : rep.aov > 0) ? "On Target" : "Needs Attention"
    }));

    if (!selectedRepId) {
      res.json({ weekStart, weekEnd, reps: repStrip, snapshot: null, issuesIdentified: [] });
      return;
    }

    const selectedThisWeek = computeRepWeekMetrics(orders, selectedRepId, weekStart);
    const selectedLastWeek = computeRepWeekMetrics(orders, selectedRepId, lastWeekStart);
    const delta = (key: keyof typeof selectedThisWeek) => {
      const now = Number(selectedThisWeek[key] ?? 0);
      const before = Number(selectedLastWeek[key] ?? 0);
      return before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : (now > 0 ? 100 : 0);
    };

    const snapshot = {
      repId: selectedRepId,
      name: repNameById.get(selectedRepId) ?? "Unknown",
      aov: selectedThisWeek.aov,
      aovTarget: target.aov,
      aovDeltaVsLastWeekPct: delta("aov"),
      deliveryRate: selectedThisWeek.deliveryRate,
      deliveryRateTarget: target.deliveryRate,
      deliveryRateDeltaVsLastWeekPct: delta("deliveryRate"),
      upsellRate: selectedThisWeek.upsellRate,
      upsellRateTarget: target.upsellRate,
      upsellRateDeltaVsLastWeekPct: delta("upsellRate"),
      crossSellRate: selectedThisWeek.crossSellRate,
      crossSellRateTarget: target.crossSellRate,
      crossSellRateDeltaVsLastWeekPct: delta("crossSellRate"),
      ordersAssigned: selectedThisWeek.ordersAssigned,
      ordersDelivered: selectedThisWeek.ordersDelivered
    };

    // Rule-based flagging off the same numbers already on screen elsewhere -
    // no separate storage, this list just explains WHY a rep needs coaching
    // this week, not a new judgement about them.
    const issuesIdentified: Array<{ label: string; severity: "High" | "Medium" | "Low" }> = [];
    if (target.aov > 0 && selectedThisWeek.aov < target.aov * 0.9) {
      issuesIdentified.push({ label: `AOV below target (${money(selectedThisWeek.aov)} vs ${money(target.aov)})`, severity: "High" });
    }
    if (target.deliveryRate > 0 && selectedThisWeek.deliveryRate < target.deliveryRate * 0.9) {
      issuesIdentified.push({ label: `Low delivery rate (${selectedThisWeek.deliveryRate}% vs ${target.deliveryRate}%)`, severity: "High" });
    }
    if (target.upsellRate > 0 && selectedThisWeek.upsellRate < target.upsellRate * 0.75) {
      issuesIdentified.push({ label: `Low upsell attempts (${selectedThisWeek.upsellRate}% vs ${target.upsellRate}%)`, severity: "Medium" });
    }
    if (target.crossSellRate > 0 && selectedThisWeek.crossSellRate < target.crossSellRate * 0.75) {
      issuesIdentified.push({ label: `Low cross-sell attempts (${selectedThisWeek.crossSellRate}% vs ${target.crossSellRate}%)`, severity: "Medium" });
    }
    if (selectedThisWeek.ordersAssigned === 0) {
      issuesIdentified.push({ label: "No orders assigned this week", severity: "Low" });
    }

    res.json({ weekStart, weekEnd, reps: repStrip, snapshot, issuesIdentified });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load Rep Coaching." });
  }
});

export default router;
