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

// Every page that previews a bonus (Overview, Weekly Scorecard, Bonus &
// Payouts) reads through here rather than the hardcoded default, so an
// Owner edit to the tiers shows up everywhere at once - "five views of the
// same question must not each invent their own arithmetic" extends to
// settings too. Falls back to the shipped defaults before an Owner has ever
// saved a row, same bootstrapping manager-bonus.ts does.
async function loadHeadOfSalesBonusSettings(orgId: string) {
  const { data, error } = await supabase
    .from("head_of_sales_settings")
    .select("currency, tiers, updated_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return { currency: DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS.currency, tiers: DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS.tiers, updatedAt: null as string | null };
  }
  return { currency: data.currency as "NGN" | "USD" | "GBP", tiers: data.tiers as typeof DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS.tiers, updatedAt: data.updated_at as string | null };
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

    // Read-only preview off the persisted Owner-editable settings (Stage 10).
    // Qualitative checks default unconfirmed, so a live preview can never
    // show a rep as if Level 2/3 were already signed off before anyone
    // actually reviewed the week - that only happens on Bonus & Payouts.
    const bonusSettings = await loadHeadOfSalesBonusSettings(orgId);
    const bonus = evaluateHeadOfSalesBonus(bonusSettings, thisWeek.team.aov, thisWeek.team.deliveryRate);

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
    const bonusSettings = await loadHeadOfSalesBonusSettings(orgId);
    const bonus = evaluateHeadOfSalesBonus(bonusSettings, thisWeek.team.aov, thisWeek.team.deliveryRate);

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
      const weekBonus = evaluateHeadOfSalesBonus(bonusSettings, weekMetrics.team.aov, weekMetrics.team.deliveryRate);
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

// A lightweight version of the main route's offer-line fetch, used only for
// the "vs last week" delta on Customers Offered/Upgraded - just the two
// totals, not the full per-rep/per-offer breakdown the main week needs.
async function countRealOffersForWeek(orgId: string, repIds: string[], weekStart: string, weekEnd: string) {
  if (repIds.length === 0) return { offered: 0, upgraded: 0 };
  const { data: attempts, error } = await supabase
    .from("order_sales_expansion_attempts")
    .select("id, rep_id, created_at, offer_lines:order_sales_expansion_offer_lines(response)")
    .eq("org_id", orgId)
    .in("rep_id", repIds)
    .gte("created_at", `${addDaysToDateKey(weekStart, -1)}T00:00:00Z`)
    .lte("created_at", `${addDaysToDateKey(weekEnd, 1)}T23:59:59Z`);
  if (error) throw error;
  const inWeek = (attempts ?? []).filter((attempt: any) => {
    const key = lagosDateKey(attempt.created_at);
    return key >= weekStart && key <= weekEnd;
  });
  const lines = inWeek.flatMap((attempt: any) => (Array.isArray(attempt.offer_lines) ? attempt.offer_lines : []) as Array<{ response: string }>);
  const realOffers = lines.filter((line) => line.response !== "waived_no_offer");
  return { offered: realOffers.length, upgraded: realOffers.filter((line) => line.response === "accepted").length };
}

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
    // other page uses. Target is held flat at the CURRENT week's baseline
    // (the same target every other page already uses) rather than
    // recomputed per historical week - a dashed reference line, not a
    // second moving series.
    const trend: Array<{ weekStart: string; upsellRate: number; crossSellRate: number; upsellRateTarget: number; crossSellRateTarget: number }> = [];
    for (let offset = 3; offset >= 0; offset -= 1) {
      const ws = addDaysToDateKey(weekStart, -7 * offset);
      const week = computeTeamWeekMetrics(orders, repIds, ws).team;
      trend.push({
        weekStart: ws,
        upsellRate: week.upsellRate,
        crossSellRate: week.crossSellRate,
        upsellRateTarget: baseline.team.upsellRate,
        crossSellRateTarget: baseline.team.crossSellRate
      });
    }

    const lastWeekEnd = weekEndFromStart(lastWeekStart);
    const lastWeekOffers = await countRealOffersForWeek(orgId, repIds, lastWeekStart, lastWeekEnd);
    const thisWeekCustomersOffered = customersOfferedUpsell + customersOfferedCrossSell;
    const thisWeekCustomersUpgraded = customersUpgraded + customersCrossSold;
    const thisWeekAdditionalRevenue = thisWeek.team.incrementalRevenueUpsell + thisWeek.team.incrementalRevenueCrossSell;
    const lastWeekAdditionalRevenue = lastWeek.team.incrementalRevenueUpsell + lastWeek.team.incrementalRevenueCrossSell;
    const pctDelta = (current: number, previous: number) =>
      previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : (current > 0 ? 100 : 0);

    res.json({
      weekStart,
      weekEnd,
      team: {
        upsellRate: thisWeek.team.upsellRate,
        crossSellRate: thisWeek.team.crossSellRate,
        upsellRateTarget: baseline.team.upsellRate,
        crossSellRateTarget: baseline.team.crossSellRate,
        customersOffered: thisWeekCustomersOffered,
        customersOfferedLastWeek: lastWeekOffers.offered,
        customersOfferedDeltaPct: pctDelta(thisWeekCustomersOffered, lastWeekOffers.offered),
        customersUpgraded: thisWeekCustomersUpgraded,
        customersUpgradedLastWeek: lastWeekOffers.upgraded,
        customersUpgradedDeltaPct: pctDelta(thisWeekCustomersUpgraded, lastWeekOffers.upgraded),
        additionalRevenue: thisWeekAdditionalRevenue,
        additionalRevenueLastWeek: lastWeekAdditionalRevenue,
        additionalRevenueDeltaPct: pctDelta(thisWeekAdditionalRevenue, lastWeekAdditionalRevenue),
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

// Shared by the four routes below: resolve an action item's coaching plan
// and confirm that plan belongs to someone on the requesting Head of Sales
// Rep's own team, the same boundary loadRepAndTeam already draws elsewhere.
async function loadActionItemForTeam(orgId: string, itemId: string, repIds: string[]) {
  const { data: itemRow, error: itemError } = await supabase
    .from("rep_coaching_action_items")
    .select("id, coaching_plan_id")
    .eq("id", itemId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (itemError) throw itemError;
  if (!itemRow) throw Object.assign(new Error("Action item not found."), { status: 404 });
  const { data: planRow, error: planError } = await supabase
    .from("rep_coaching_plans")
    .select("rep_id")
    .eq("id", itemRow.coaching_plan_id)
    .maybeSingle();
  if (planError) throw planError;
  if (!planRow || !repIds.includes(planRow.rep_id)) {
    throw Object.assign(new Error("Action item not found."), { status: 404 });
  }
  return itemRow;
}

const CallReviewsQuerySchema = z.object({
  repId: z.string().min(1),
  selectedRepId: z.string().min(1),
  weekStart: z.string().regex(DATE_KEY_PATTERN).optional(),
  weekEnd: z.string().regex(DATE_KEY_PATTERN).optional()
});

router.get("/call-reviews", async (req, res) => {
  const parsed = CallReviewsQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "repId and selectedRepId are required." }); return; }
  const orgId = req.user!.orgId;
  try {
    const { repIds } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    if (!repIds.includes(parsed.data.selectedRepId)) {
      res.status(404).json({ error: "That rep is not on this team." });
      return;
    }
    let query = supabase
      .from("sales_call_reviews")
      .select("id, customer_name, called_at, duration_seconds, outcome, star_score, reviewer_notes, reviewer:users!sales_call_reviews_reviewer_id_fkey(name)")
      .eq("org_id", orgId)
      .eq("rep_id", parsed.data.selectedRepId);
    // Week-scoped when a week is given (Rep Coaching's "This Week" panel);
    // unscoped (last 25 overall) otherwise, matching prior behavior for any
    // other caller of this endpoint.
    if (parsed.data.weekStart && parsed.data.weekEnd) {
      query = query.gte("called_at", `${parsed.data.weekStart}T00:00:00Z`).lte("called_at", `${parsed.data.weekEnd}T23:59:59Z`);
    }
    const { data, error } = await query.order("called_at", { ascending: false }).limit(25);
    if (error) throw error;
    const reviews = (data ?? []).map((row: any) => ({
      id: row.id,
      customerName: row.customer_name,
      calledAt: row.called_at,
      durationSeconds: row.duration_seconds,
      outcome: row.outcome,
      starScore: row.star_score,
      reviewerNotes: row.reviewer_notes,
      reviewerName: row.reviewer?.name ?? null
    }));
    res.json({ reviews });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load call reviews." });
  }
});

const CreateCallReviewSchema = z.object({
  repId: z.string().min(1),
  selectedRepId: z.string().min(1),
  customerName: z.string().min(1).max(200),
  calledAt: z.string().min(1),
  durationSeconds: z.number().int().min(0).optional(),
  outcome: z.string().min(1).max(120),
  starScore: z.number().int().min(1).max(5).optional(),
  reviewerNotes: z.string().max(4000).optional()
});

router.post("/call-reviews", async (req, res) => {
  const parsed = CreateCallReviewSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Customer name, call time, and outcome are required." }); return; }
  const orgId = req.user!.orgId;
  try {
    const { repIds } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    if (!repIds.includes(parsed.data.selectedRepId)) {
      res.status(404).json({ error: "That rep is not on this team." });
      return;
    }
    const { data, error } = await supabase
      .from("sales_call_reviews")
      .insert({
        org_id: orgId,
        rep_id: parsed.data.selectedRepId,
        customer_name: parsed.data.customerName,
        called_at: parsed.data.calledAt,
        duration_seconds: parsed.data.durationSeconds ?? null,
        outcome: parsed.data.outcome,
        star_score: parsed.data.starScore ?? null,
        reviewer_id: req.user!.id,
        reviewer_notes: parsed.data.reviewerNotes ?? null
      })
      .select("id")
      .single();
    if (error) throw error;
    res.status(201).json({ id: data.id });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not log the call review." });
  }
});

const CoachingPlanQuerySchema = z.object({
  repId: z.string().min(1),
  selectedRepId: z.string().min(1)
});

router.get("/coaching-plan", async (req, res) => {
  const parsed = CoachingPlanQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "repId and selectedRepId are required." }); return; }
  const orgId = req.user!.orgId;
  try {
    const { repIds } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    if (!repIds.includes(parsed.data.selectedRepId)) {
      res.status(404).json({ error: "That rep is not on this team." });
      return;
    }
    const { data: planRow, error: planError } = await supabase
      .from("rep_coaching_plans")
      .select("id, created_at, updated_at")
      .eq("org_id", orgId)
      .eq("rep_id", parsed.data.selectedRepId)
      .maybeSingle();
    if (planError) throw planError;
    if (!planRow) { res.json({ plan: null, actionItems: [] }); return; }

    const { data: itemRows, error: itemError } = await supabase
      .from("rep_coaching_action_items")
      .select("id, description, target_count, completed_count, target_is_percentage, due_date, status, created_at")
      .eq("coaching_plan_id", planRow.id)
      .order("created_at", { ascending: true });
    if (itemError) throw itemError;

    res.json({
      plan: { id: planRow.id, createdAt: planRow.created_at, updatedAt: planRow.updated_at },
      actionItems: (itemRows ?? []).map((row) => ({
        id: row.id,
        description: row.description,
        targetCount: row.target_count,
        completedCount: row.completed_count,
        targetIsPercentage: row.target_is_percentage,
        dueDate: row.due_date,
        status: row.status
      }))
    });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load the coaching plan." });
  }
});

const CreateActionItemSchema = z.object({
  repId: z.string().min(1),
  selectedRepId: z.string().min(1),
  description: z.string().min(1).max(500),
  targetCount: z.number().int().min(0).optional(),
  targetIsPercentage: z.boolean().optional(),
  dueDate: z.string().regex(DATE_KEY_PATTERN).optional()
});

router.post("/coaching-plan/action-items", async (req, res) => {
  const parsed = CreateActionItemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A description is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    const { repIds } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    if (!repIds.includes(parsed.data.selectedRepId)) {
      res.status(404).json({ error: "That rep is not on this team." });
      return;
    }

    let planId: string;
    const { data: existingPlan, error: planLookupError } = await supabase
      .from("rep_coaching_plans")
      .select("id")
      .eq("org_id", orgId)
      .eq("rep_id", parsed.data.selectedRepId)
      .maybeSingle();
    if (planLookupError) throw planLookupError;
    if (existingPlan) {
      planId = existingPlan.id;
    } else {
      const { data: newPlan, error: createPlanError } = await supabase
        .from("rep_coaching_plans")
        .insert({ org_id: orgId, rep_id: parsed.data.selectedRepId, created_by: req.user!.id })
        .select("id")
        .single();
      if (createPlanError) throw createPlanError;
      planId = newPlan.id;
    }

    const { data: item, error: itemError } = await supabase
      .from("rep_coaching_action_items")
      .insert({
        coaching_plan_id: planId,
        org_id: orgId,
        description: parsed.data.description,
        target_count: parsed.data.targetCount ?? null,
        target_is_percentage: parsed.data.targetIsPercentage ?? false,
        due_date: parsed.data.dueDate ?? null,
        created_by: req.user!.id
      })
      .select("id")
      .single();
    if (itemError) throw itemError;
    res.status(201).json({ id: item.id, planId });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not add the action item." });
  }
});

const UpdateActionItemSchema = z.object({
  repId: z.string().min(1),
  status: z.enum(["Not Started", "In Progress", "Completed"]).optional(),
  completedCount: z.number().int().min(0).optional(),
  description: z.string().min(1).max(500).optional(),
  targetCount: z.number().int().min(0).optional(),
  targetIsPercentage: z.boolean().optional(),
  dueDate: z.string().regex(DATE_KEY_PATTERN).nullable().optional()
});

router.patch("/coaching-plan/action-items/:itemId", async (req, res) => {
  const parsed = UpdateActionItemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Nothing valid to update." }); return; }
  const orgId = req.user!.orgId;
  try {
    const { repIds } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    await loadActionItemForTeam(orgId, req.params.itemId, repIds);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;
    if (parsed.data.completedCount !== undefined) patch.completed_count = parsed.data.completedCount;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.targetCount !== undefined) patch.target_count = parsed.data.targetCount;
    if (parsed.data.targetIsPercentage !== undefined) patch.target_is_percentage = parsed.data.targetIsPercentage;
    if (parsed.data.dueDate !== undefined) patch.due_date = parsed.data.dueDate;

    const { error: updateError } = await supabase
      .from("rep_coaching_action_items")
      .update(patch)
      .eq("id", req.params.itemId);
    if (updateError) throw updateError;
    res.json({ ok: true });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not update the action item." });
  }
});

router.delete("/coaching-plan/action-items/:itemId", async (req, res) => {
  const repIdRaw = typeof req.query.repId === "string" ? req.query.repId : "";
  if (!repIdRaw) { res.status(400).json({ error: "repId is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    const { repIds } = await loadRepAndTeam(orgId, repIdRaw, req.user!);
    await loadActionItemForTeam(orgId, req.params.itemId, repIds);
    const { error: deleteError } = await supabase
      .from("rep_coaching_action_items")
      .delete()
      .eq("id", req.params.itemId);
    if (deleteError) throw deleteError;
    res.json({ ok: true });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not remove the action item." });
  }
});

const INITIATIVE_STATUSES = ["Idea", "Planned", "In Progress", "Completed", "Abandoned"] as const;
const TERMINAL_INITIATIVE_STATUSES = new Set(["Completed", "Abandoned"]);

// Unlike coaching (authored ABOUT a team member), an initiative is run BY
// the Head of Sales Rep herself - so she can read and write her own, not
// just read it. Owner/Admin/Manager can do both for anyone.
async function loadInitiativeForRep(orgId: string, initiativeId: string, requestingUser: { id: string; role: string }) {
  const { data: row, error } = await supabase
    .from("sales_initiatives")
    .select("id, head_of_sales_rep_id")
    .eq("id", initiativeId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw Object.assign(new Error("Initiative not found."), { status: 404 });
  if (requestingUser.role === "Sales Rep" && requestingUser.id !== row.head_of_sales_rep_id) {
    throw Object.assign(new Error("Initiative not found."), { status: 404 });
  }
  return row;
}

const INITIATIVE_TYPES = ["Upsell", "Cross-sell", "Retention", "Promotion", "Training", "Process", "Offer"] as const;
const INITIATIVE_IMPACT_BUCKETS = ["Upsell", "Cross-sell", "Retention"] as const;
const LEARNING_TAGS = ["Use & Scale", "Test More", "Adjust Approach", "Keep Doing"] as const;

// Promotion/Training/Process/Offer don't map to a funnel stage directly -
// folded into Retention for the Impact Summary donut since they're
// generally aimed at keeping or improving existing customer relationships
// rather than a specific upsell/cross-sell ask.
function impactBucketForType(type: string): typeof INITIATIVE_IMPACT_BUCKETS[number] {
  if (type === "Upsell" || type === "Cross-sell") return type;
  return "Retention";
}

const INITIATIVE_SELECT = "id, title, description, status, target_metric, started_at, target_date, completed_at, outcome_summary, was_successful, initiative_type, target_segment, customers_offered, customers_accepted, customers_delivered, incremental_revenue, impact_level, priority, expected_impact, created_at, updated_at";

function mapInitiativeRow(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    targetMetric: row.target_metric,
    startedAt: row.started_at,
    targetDate: row.target_date,
    completedAt: row.completed_at,
    outcomeSummary: row.outcome_summary,
    wasSuccessful: row.was_successful,
    initiativeType: row.initiative_type,
    targetSegment: row.target_segment,
    customersOffered: row.customers_offered,
    customersAccepted: row.customers_accepted,
    customersDelivered: row.customers_delivered,
    incrementalRevenue: Number(row.incremental_revenue),
    impactLevel: row.impact_level,
    priority: row.priority,
    expectedImpact: row.expected_impact
  };
}

const InitiativesQuerySchema = z.object({ repId: z.string().min(1), weekStart: z.string().regex(DATE_KEY_PATTERN).optional() });

router.get("/initiatives", async (req, res) => {
  const parsed = InitiativesQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "repId is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    const { rep } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    const weekStart = parsed.data.weekStart ?? sundayWeekStartForDateKey(lagosDateKey());
    const weekEnd = weekEndFromStart(weekStart);

    const { data, error } = await supabase
      .from("sales_initiatives")
      .select(INITIATIVE_SELECT)
      .eq("org_id", orgId)
      .eq("head_of_sales_rep_id", rep.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const initiatives = (data ?? []).map(mapInitiativeRow);

    const nonAbandoned = initiatives.filter((i) => i.status !== "Abandoned");
    const activeCount = initiatives.filter((i) => i.status !== "Completed" && i.status !== "Abandoned").length;
    const completedThisWeekCount = initiatives.filter((i) =>
      i.completedAt && String(i.completedAt).slice(0, 10) >= weekStart && String(i.completedAt).slice(0, 10) <= weekEnd
    ).length;
    const totalIncrementalRevenue = nonAbandoned.reduce((sum, i) => sum + i.incrementalRevenue, 0);
    const customersImpacted = nonAbandoned.reduce((sum, i) => sum + i.customersOffered, 0);
    const upgradesGenerated = nonAbandoned.reduce((sum, i) => sum + i.customersAccepted, 0);

    const impactByBucket = new Map<string, number>(INITIATIVE_IMPACT_BUCKETS.map((bucket) => [bucket, 0]));
    for (const initiative of nonAbandoned) {
      const bucket = impactBucketForType(initiative.initiativeType);
      impactByBucket.set(bucket, (impactByBucket.get(bucket) ?? 0) + initiative.incrementalRevenue);
    }
    const impactSummary = INITIATIVE_IMPACT_BUCKETS.map((bucket) => ({
      bucket,
      amount: impactByBucket.get(bucket) ?? 0,
      pct: totalIncrementalRevenue > 0 ? Math.round(((impactByBucket.get(bucket) ?? 0) / totalIncrementalRevenue) * 1000) / 10 : 0
    }));

    // "vs last week" is anchored to the last SUBMITTED weekly report's
    // frozen snapshot - a real prior checkpoint, not a fabricated
    // comparison. No submitted report yet for a prior week -> no delta.
    const { data: lastReportRow, error: lastReportError } = await supabase
      .from("head_of_sales_weekly_reports")
      .select("performance_snapshot")
      .eq("org_id", orgId)
      .eq("head_of_sales_rep_id", rep.id)
      .not("submitted_at", "is", null)
      .lt("week_start", weekStart)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastReportError) throw lastReportError;
    const lastSnapshot: any = lastReportRow?.performance_snapshot ?? null;
    const deltaPct = (current: number, previous: number) =>
      previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : (current > 0 ? 100 : 0);
    const vsLastWeek = lastSnapshot ? {
      totalIncrementalRevenue: { previous: lastSnapshot.incrementalRevenue ?? 0, deltaPct: deltaPct(totalIncrementalRevenue, lastSnapshot.incrementalRevenue ?? 0) },
      customersImpacted: { previous: lastSnapshot.customersOffered ?? 0, deltaPct: deltaPct(customersImpacted, lastSnapshot.customersOffered ?? 0) },
      upgradesGenerated: { previous: lastSnapshot.customersAccepted ?? 0, deltaPct: deltaPct(upgradesGenerated, lastSnapshot.customersAccepted ?? 0) }
    } : null;

    // Learnings across ALL of this rep's initiatives - the page-level
    // "Initiative Learnings" panel, not the per-initiative expand view.
    const initiativeIds = initiatives.map((i) => i.id);
    let recentLearnings: any[] = [];
    if (initiativeIds.length > 0) {
      const { data: learningRows, error: learningError } = await supabase
        .from("sales_initiative_learnings")
        .select("id, note, tag, created_at, initiative_id")
        .in("initiative_id", initiativeIds)
        .order("created_at", { ascending: false })
        .limit(6);
      if (learningError) throw learningError;
      const titleById = new Map(initiatives.map((i) => [i.id, i.title]));
      recentLearnings = (learningRows ?? []).map((row) => ({
        id: row.id, note: row.note, tag: row.tag, createdAt: row.created_at, initiativeTitle: titleById.get(row.initiative_id) ?? "Unknown"
      }));
    }

    res.json({
      weekStart,
      weekEnd,
      initiatives,
      stats: { activeCount, completedThisWeekCount, totalIncrementalRevenue, customersImpacted, upgradesGenerated },
      impactSummary,
      vsLastWeek,
      recentLearnings
    });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load Initiatives." });
  }
});

const CreateInitiativeSchema = z.object({
  repId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  targetMetric: z.string().max(200).optional(),
  startedAt: z.string().regex(DATE_KEY_PATTERN).optional(),
  targetDate: z.string().regex(DATE_KEY_PATTERN).optional(),
  initiativeType: z.enum(INITIATIVE_TYPES).optional(),
  targetSegment: z.string().max(200).optional(),
  priority: z.enum(["Low", "Medium", "High"]).optional(),
  expectedImpact: z.string().max(500).optional()
});

router.post("/initiatives", async (req, res) => {
  const parsed = CreateInitiativeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A title is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    const { rep } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    const { data, error } = await supabase
      .from("sales_initiatives")
      .insert({
        org_id: orgId,
        head_of_sales_rep_id: rep.id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        target_metric: parsed.data.targetMetric ?? null,
        started_at: parsed.data.startedAt ?? null,
        target_date: parsed.data.targetDate ?? null,
        initiative_type: parsed.data.initiativeType ?? "Promotion",
        target_segment: parsed.data.targetSegment ?? null,
        priority: parsed.data.priority ?? null,
        expected_impact: parsed.data.expectedImpact ?? null,
        created_by: req.user!.id
      })
      .select("id")
      .single();
    if (error) throw error;
    res.status(201).json({ id: data.id });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not create the initiative." });
  }
});

const UpdateInitiativeSchema = z.object({
  repId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(INITIATIVE_STATUSES).optional(),
  targetMetric: z.string().max(200).nullable().optional(),
  startedAt: z.string().regex(DATE_KEY_PATTERN).nullable().optional(),
  targetDate: z.string().regex(DATE_KEY_PATTERN).nullable().optional(),
  outcomeSummary: z.string().max(4000).nullable().optional(),
  wasSuccessful: z.boolean().nullable().optional(),
  initiativeType: z.enum(INITIATIVE_TYPES).optional(),
  targetSegment: z.string().max(200).nullable().optional(),
  customersOffered: z.number().int().min(0).optional(),
  customersAccepted: z.number().int().min(0).optional(),
  customersDelivered: z.number().int().min(0).optional(),
  incrementalRevenue: z.number().min(0).optional(),
  impactLevel: z.enum(["Low", "Medium", "High"]).nullable().optional(),
  priority: z.enum(["Low", "Medium", "High"]).nullable().optional(),
  expectedImpact: z.string().max(500).nullable().optional()
});

router.patch("/initiatives/:initiativeId", async (req, res) => {
  const parsed = UpdateInitiativeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Nothing valid to update." }); return; }
  const orgId = req.user!.orgId;
  try {
    await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    await loadInitiativeForRep(orgId, req.params.initiativeId, req.user!);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.targetMetric !== undefined) patch.target_metric = parsed.data.targetMetric;
    if (parsed.data.startedAt !== undefined) patch.started_at = parsed.data.startedAt;
    if (parsed.data.targetDate !== undefined) patch.target_date = parsed.data.targetDate;
    if (parsed.data.outcomeSummary !== undefined) patch.outcome_summary = parsed.data.outcomeSummary;
    if (parsed.data.wasSuccessful !== undefined) patch.was_successful = parsed.data.wasSuccessful;
    if (parsed.data.initiativeType !== undefined) patch.initiative_type = parsed.data.initiativeType;
    if (parsed.data.targetSegment !== undefined) patch.target_segment = parsed.data.targetSegment;
    if (parsed.data.customersOffered !== undefined) patch.customers_offered = parsed.data.customersOffered;
    if (parsed.data.customersAccepted !== undefined) patch.customers_accepted = parsed.data.customersAccepted;
    if (parsed.data.customersDelivered !== undefined) patch.customers_delivered = parsed.data.customersDelivered;
    if (parsed.data.incrementalRevenue !== undefined) patch.incremental_revenue = parsed.data.incrementalRevenue;
    if (parsed.data.impactLevel !== undefined) patch.impact_level = parsed.data.impactLevel;
    if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
    if (parsed.data.expectedImpact !== undefined) patch.expected_impact = parsed.data.expectedImpact;
    if (parsed.data.status !== undefined) {
      patch.status = parsed.data.status;
      // Moving into a terminal status timestamps the resolution automatically -
      // nobody has to remember to also set a completion date by hand.
      if (TERMINAL_INITIATIVE_STATUSES.has(parsed.data.status)) {
        patch.completed_at = new Date().toISOString();
      }
    }

    const { error: updateError } = await supabase
      .from("sales_initiatives")
      .update(patch)
      .eq("id", req.params.initiativeId);
    if (updateError) throw updateError;
    res.json({ ok: true });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not update the initiative." });
  }
});

router.delete("/initiatives/:initiativeId", async (req, res) => {
  const repIdRaw = typeof req.query.repId === "string" ? req.query.repId : "";
  if (!repIdRaw) { res.status(400).json({ error: "repId is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    await loadRepAndTeam(orgId, repIdRaw, req.user!);
    await loadInitiativeForRep(orgId, req.params.initiativeId, req.user!);
    const { error: deleteError } = await supabase
      .from("sales_initiatives")
      .delete()
      .eq("id", req.params.initiativeId);
    if (deleteError) throw deleteError;
    res.json({ ok: true });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not remove the initiative." });
  }
});

const LearningsQuerySchema = z.object({ repId: z.string().min(1) });

router.get("/initiatives/:initiativeId/learnings", async (req, res) => {
  const parsed = LearningsQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "repId is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    await loadInitiativeForRep(orgId, req.params.initiativeId, req.user!);
    const { data, error } = await supabase
      .from("sales_initiative_learnings")
      .select("id, note, tag, created_at, author:users!sales_initiative_learnings_created_by_fkey(name)")
      .eq("initiative_id", req.params.initiativeId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const learnings = (data ?? []).map((row: any) => ({
      id: row.id,
      note: row.note,
      tag: row.tag,
      createdAt: row.created_at,
      authorName: row.author?.name ?? null
    }));
    res.json({ learnings });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load learnings." });
  }
});

const CreateLearningSchema = z.object({
  repId: z.string().min(1),
  note: z.string().min(1).max(4000),
  tag: z.enum(LEARNING_TAGS).optional()
});

router.post("/initiatives/:initiativeId/learnings", async (req, res) => {
  const parsed = CreateLearningSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A note is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    await loadInitiativeForRep(orgId, req.params.initiativeId, req.user!);
    const { data, error } = await supabase
      .from("sales_initiative_learnings")
      .insert({
        initiative_id: req.params.initiativeId,
        org_id: orgId,
        note: parsed.data.note,
        tag: parsed.data.tag ?? null,
        created_by: req.user!.id
      })
      .select("id")
      .single();
    if (error) throw error;
    res.status(201).json({ id: data.id });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not add the learning." });
  }
});

// The frozen numbers that go into a Weekly Report - the same scorecard shape
// Overview/Weekly Scorecard already show, plus that week's initiative
// activity. Computed fresh every time a DRAFT is saved; computed one final
// time and then frozen into performance_snapshot when submitted, so a later
// edit to an order or an initiative can never rewrite a closed week.
async function computeWeeklyPerformanceSnapshot(orgId: string, repId: string, repIds: string[], weekStart: string) {
  const weekEnd = weekEndFromStart(weekStart);
  const earliestNeeded = addDaysToDateKey(weekStart, -28);
  const orders = await loadOrdersSince(orgId, repIds, earliestNeeded, weekEnd);
  const thisWeek = computeTeamWeekMetrics(orders, repIds, weekStart);
  const baseline = computeTrailingBaseline(orders, repIds, weekStart, 4);
  const { scorecard, totalWeightedScore } = buildScorecard(thisWeek, baseline);

  const { data: initiativeRows, error: initiativeError } = await supabase
    .from("sales_initiatives")
    .select("status, completed_at, was_successful, customers_offered, customers_accepted, customers_delivered, incremental_revenue")
    .eq("org_id", orgId)
    .eq("head_of_sales_rep_id", repId);
  if (initiativeError) throw initiativeError;
  const rows = initiativeRows ?? [];
  const completedThisWeek = rows.filter((row) => {
    if (!row.completed_at) return false;
    const dateKey = String(row.completed_at).slice(0, 10);
    return dateKey >= weekStart && dateKey <= weekEnd;
  });
  // Same non-Abandoned scope Initiatives' own stat cards use, so this
  // snapshot is a genuine "as of this week" checkpoint for that page's
  // "vs last week" delta to read back out later.
  const nonAbandoned = rows.filter((row) => row.status !== "Abandoned");

  return {
    weekStart,
    weekEnd,
    totalWeightedScore,
    scorecard,
    initiativesActive: rows.filter((row) => row.status !== "Completed" && row.status !== "Abandoned").length,
    initiativesCompletedThisWeek: completedThisWeek.length,
    initiativesSuccessfulThisWeek: completedThisWeek.filter((row) => row.was_successful === true).length,
    customersOffered: nonAbandoned.reduce((sum, row) => sum + (row.customers_offered ?? 0), 0),
    customersAccepted: nonAbandoned.reduce((sum, row) => sum + (row.customers_accepted ?? 0), 0),
    customersDelivered: nonAbandoned.reduce((sum, row) => sum + (row.customers_delivered ?? 0), 0),
    incrementalRevenue: nonAbandoned.reduce((sum, row) => sum + Number(row.incremental_revenue ?? 0), 0)
  };
}

const WeeklyReportQuerySchema = z.object({
  repId: z.string().min(1),
  weekStart: z.string().regex(DATE_KEY_PATTERN).optional()
});

router.get("/weekly-report", async (req, res) => {
  const parsed = WeeklyReportQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "repId is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    const { rep, repIds } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    const weekStart = parsed.data.weekStart ?? sundayWeekStartForDateKey(lagosDateKey());
    const weekEnd = weekEndFromStart(weekStart);

    const { data: reportRow, error: reportError } = await supabase
      .from("head_of_sales_weekly_reports")
      .select("id, week_start, summary_wins, summary_challenges, next_week_plan, key_learnings, additional_notes, focus_target_aov, focus_target_delivery_rate, focus_target_upsell_rate, performance_snapshot, submitted_at")
      .eq("org_id", orgId)
      .eq("head_of_sales_rep_id", rep.id)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (reportError) throw reportError;

    const report = reportRow ? {
      id: reportRow.id,
      weekStart: reportRow.week_start,
      summaryWins: reportRow.summary_wins,
      summaryChallenges: reportRow.summary_challenges,
      nextWeekPlan: reportRow.next_week_plan,
      keyLearnings: reportRow.key_learnings,
      additionalNotes: reportRow.additional_notes,
      focusTargetAov: reportRow.focus_target_aov,
      focusTargetDeliveryRate: reportRow.focus_target_delivery_rate,
      focusTargetUpsellRate: reportRow.focus_target_upsell_rate,
      performanceSnapshot: reportRow.performance_snapshot,
      submittedAt: reportRow.submitted_at
    } : null;

    // A live preview so she can see this week's numbers BEFORE a draft has
    // ever been saved - otherwise the report form would open blank.
    const livePreview = !report || !report.submittedAt
      ? await computeWeeklyPerformanceSnapshot(orgId, rep.id, repIds, weekStart)
      : null;

    // The 5-card Week Summary - same computeTeamWeekMetrics+baseline call
    // Overview already makes, just surfaced as all 5 metrics instead of a
    // subset.
    const earliestNeeded = addDaysToDateKey(weekStart, -28);
    const orders = await loadOrdersSince(orgId, repIds, earliestNeeded, weekEnd);
    const thisWeek = computeTeamWeekMetrics(orders, repIds, weekStart);
    const baseline = computeTrailingBaseline(orders, repIds, weekStart, 4);
    const pctDelta = (actual: number, base: number) => base > 0 ? Math.round(((actual - base) / base) * 1000) / 10 : (actual > 0 ? 100 : 0);
    const weekSummary = {
      teamAov: { actual: thisWeek.team.aov, baseline: baseline.team.aov, deltaPct: pctDelta(thisWeek.team.aov, baseline.team.aov) },
      deliveryRate: { actual: thisWeek.team.deliveryRate, baseline: baseline.team.deliveryRate, deltaPct: pctDelta(thisWeek.team.deliveryRate, baseline.team.deliveryRate) },
      upsellRate: { actual: thisWeek.team.upsellRate, baseline: baseline.team.upsellRate, deltaPct: pctDelta(thisWeek.team.upsellRate, baseline.team.upsellRate) },
      crossSellRate: { actual: thisWeek.team.crossSellRate, baseline: baseline.team.crossSellRate, deltaPct: pctDelta(thisWeek.team.crossSellRate, baseline.team.crossSellRate) },
      incrementalRevenue: {
        actual: thisWeek.team.incrementalRevenueUpsell + thisWeek.team.incrementalRevenueCrossSell,
        baseline: baseline.team.incrementalRevenueUpsell + baseline.team.incrementalRevenueCrossSell,
        deltaPct: pctDelta(
          thisWeek.team.incrementalRevenueUpsell + thisWeek.team.incrementalRevenueCrossSell,
          baseline.team.incrementalRevenueUpsell + baseline.team.incrementalRevenueCrossSell
        )
      }
    };

    // "What did we test this week?" / "Performance Results" are the SAME
    // Initiatives, not separate report data - active/planned/completed
    // initiatives whose window overlaps this week.
    const { data: initiativeRows, error: initiativeError } = await supabase
      .from("sales_initiatives")
      .select(INITIATIVE_SELECT)
      .eq("org_id", orgId)
      .eq("head_of_sales_rep_id", rep.id)
      .neq("status", "Idea")
      .neq("status", "Abandoned")
      .order("created_at", { ascending: false });
    if (initiativeError) throw initiativeError;
    const testsThisWeek = (initiativeRows ?? [])
      .map(mapInitiativeRow)
      .filter((row) => {
        const started = row.startedAt ? String(row.startedAt) : null;
        const completed = row.completedAt ? String(row.completedAt).slice(0, 10) : null;
        return (started && started <= weekEnd) || (completed && completed >= weekStart);
      });

    res.json({ weekStart, weekEnd, report, livePreview, weekSummary, testsThisWeek });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load the Weekly Report." });
  }
});

const SaveWeeklyReportSchema = z.object({
  repId: z.string().min(1),
  weekStart: z.string().regex(DATE_KEY_PATTERN),
  summaryWins: z.string().max(4000).optional(),
  summaryChallenges: z.string().max(4000).optional(),
  nextWeekPlan: z.string().max(4000).optional(),
  keyLearnings: z.string().max(4000).optional(),
  additionalNotes: z.string().max(4000).optional(),
  focusTargetAov: z.number().min(0).optional(),
  focusTargetDeliveryRate: z.number().min(0).max(100).optional(),
  focusTargetUpsellRate: z.number().min(0).max(100).optional()
});

router.put("/weekly-report", async (req, res) => {
  const parsed = SaveWeeklyReportSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "weekStart is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    const { rep, repIds } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);

    const { data: existing, error: existingError } = await supabase
      .from("head_of_sales_weekly_reports")
      .select("id, submitted_at")
      .eq("org_id", orgId)
      .eq("head_of_sales_rep_id", rep.id)
      .eq("week_start", parsed.data.weekStart)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.submitted_at) {
      res.status(409).json({ error: "This week's report is already submitted and locked." });
      return;
    }

    const snapshot = await computeWeeklyPerformanceSnapshot(orgId, rep.id, repIds, parsed.data.weekStart);
    const row = {
      org_id: orgId,
      head_of_sales_rep_id: rep.id,
      week_start: parsed.data.weekStart,
      summary_wins: parsed.data.summaryWins ?? null,
      summary_challenges: parsed.data.summaryChallenges ?? null,
      next_week_plan: parsed.data.nextWeekPlan ?? null,
      key_learnings: parsed.data.keyLearnings ?? null,
      additional_notes: parsed.data.additionalNotes ?? null,
      focus_target_aov: parsed.data.focusTargetAov ?? null,
      focus_target_delivery_rate: parsed.data.focusTargetDeliveryRate ?? null,
      focus_target_upsell_rate: parsed.data.focusTargetUpsellRate ?? null,
      performance_snapshot: snapshot,
      updated_at: new Date().toISOString()
    };

    if (existing) {
      const { error: updateError } = await supabase.from("head_of_sales_weekly_reports").update(row).eq("id", existing.id);
      if (updateError) throw updateError;
      res.json({ id: existing.id, saved: true });
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("head_of_sales_weekly_reports")
        .insert({ ...row, created_by: req.user!.id })
        .select("id")
        .single();
      if (insertError) throw insertError;
      res.status(201).json({ id: inserted.id, saved: true });
    }
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not save the Weekly Report." });
  }
});

const SubmitWeeklyReportSchema = z.object({
  repId: z.string().min(1),
  weekStart: z.string().regex(DATE_KEY_PATTERN)
});

router.post("/weekly-report/submit", async (req, res) => {
  const parsed = SubmitWeeklyReportSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "weekStart is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    const { rep, repIds } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    const { data: existing, error: existingError } = await supabase
      .from("head_of_sales_weekly_reports")
      .select("id, submitted_at")
      .eq("org_id", orgId)
      .eq("head_of_sales_rep_id", rep.id)
      .eq("week_start", parsed.data.weekStart)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) {
      res.status(404).json({ error: "Save a draft before submitting." });
      return;
    }
    if (existing.submitted_at) {
      res.status(409).json({ error: "This week's report is already submitted." });
      return;
    }

    const snapshot = await computeWeeklyPerformanceSnapshot(orgId, rep.id, repIds, parsed.data.weekStart);
    const { error: updateError } = await supabase
      .from("head_of_sales_weekly_reports")
      .update({ performance_snapshot: snapshot, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updateError) throw updateError;
    res.json({ ok: true });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not submit the Weekly Report." });
  }
});

// Confirming a bonus is a leadership call, not self-service - unlike
// Initiatives (Stage 8), which she runs herself, this is her own
// compensation being evaluated, so it never gets a Sales-Rep-self carve-out
// the way loadRepAndTeam's read gate does.
function requireBonusLeadership(user: { role: string }) {
  if (!["Owner", "Admin", "Manager"].includes(user.role)) {
    throw Object.assign(new Error("Only Owner, Admin, or Manager can confirm a bonus."), { status: 403 });
  }
}

const BonusSettingsQuerySchema = z.object({ repId: z.string().min(1) });

router.get("/bonus-settings", async (req, res) => {
  const parsed = BonusSettingsQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "repId is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    const settings = await loadHeadOfSalesBonusSettings(orgId);
    res.json({ settings });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load bonus settings." });
  }
});

const BonusTierSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  amount: z.number().min(0),
  minTeamAov: z.number().min(0),
  minDeliveryRate: z.number().min(0).max(100),
  requiresUpsellImprovement: z.boolean().optional(),
  requiresInitiativeSuccess: z.boolean().optional()
});
const UpdateBonusSettingsSchema = z.object({
  repId: z.string().min(1),
  currency: z.enum(["NGN", "USD", "GBP"]).optional(),
  tiers: z.array(BonusTierSchema).min(1)
});

router.patch("/bonus-settings", requireRole("Owner"), async (req, res) => {
  const parsed = UpdateBonusSettingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "At least one valid tier is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    const { data: existing, error: existingError } = await supabase
      .from("head_of_sales_settings")
      .select("id")
      .eq("org_id", orgId)
      .maybeSingle();
    if (existingError) throw existingError;

    const row = {
      currency: parsed.data.currency ?? "NGN",
      tiers: parsed.data.tiers,
      updated_by: req.user!.id,
      updated_at: new Date().toISOString()
    };

    if (existing) {
      const { error: updateError } = await supabase.from("head_of_sales_settings").update(row).eq("id", existing.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase.from("head_of_sales_settings").insert({ org_id: orgId, ...row });
      if (insertError) throw insertError;
    }
    const settings = await loadHeadOfSalesBonusSettings(orgId);
    res.json({ settings });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not save bonus settings." });
  }
});

router.get("/bonus-payouts", async (req, res) => {
  const parsed = WeekQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "repId is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    const { rep, repIds } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    const weekStart = parsed.data.weekStart ?? sundayWeekStartForDateKey(lagosDateKey());
    const bonusSettings = await loadHeadOfSalesBonusSettings(orgId);

    const { data: recordRow, error: recordError } = await supabase
      .from("head_of_sales_bonus_weekly_records")
      .select("id, week_start, team_aov, team_delivery_rate, upsell_improvement, initiative_success, bonus_level, amount, status, notes, paid_at")
      .eq("org_id", orgId)
      .eq("head_of_sales_rep_id", rep.id)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (recordError) throw recordError;

    const record = recordRow ? {
      id: recordRow.id,
      weekStart: recordRow.week_start,
      teamAov: recordRow.team_aov,
      teamDeliveryRate: recordRow.team_delivery_rate,
      upsellImprovement: recordRow.upsell_improvement,
      initiativeSuccess: recordRow.initiative_success,
      bonusLevel: recordRow.bonus_level,
      amount: recordRow.amount,
      status: recordRow.status,
      notes: recordRow.notes,
      paidAt: recordRow.paid_at
    } : null;

    // Always computed - the Weekly Bonus Breakdown table needs this week's
    // real numbers whether or not a record has been confirmed yet, and the
    // live preview (when nothing's confirmed) reads off the same numbers.
    const weekEnd = weekEndFromStart(weekStart);
    const orders = await loadOrdersSince(orgId, repIds, addDaysToDateKey(weekStart, -28), weekEnd);
    const thisWeek = computeTeamWeekMetrics(orders, repIds, weekStart);
    const baseline = computeTrailingBaseline(orders, repIds, weekStart, 4);
    const { scorecard, totalWeightedScore } = buildScorecard(thisWeek, baseline);

    let preview: any = null;
    if (!record) {
      const evaluation = evaluateHeadOfSalesBonus(bonusSettings, thisWeek.team.aov, thisWeek.team.deliveryRate);
      preview = { teamAov: thisWeek.team.aov, teamDeliveryRate: thisWeek.team.deliveryRate, ...evaluation };
    }

    const { data: historyRows, error: historyError } = await supabase
      .from("head_of_sales_bonus_weekly_records")
      .select("week_start, team_aov, team_delivery_rate, bonus_level, amount, status, paid_at")
      .eq("org_id", orgId)
      .eq("head_of_sales_rep_id", rep.id)
      .order("week_start", { ascending: false })
      .limit(12);
    if (historyError) throw historyError;

    // All-time, not just the 12-week history window above, so "Weeks Paid"
    // stays correct once more than 12 weeks of records exist.
    const { data: allRecords, error: allRecordsError } = await supabase
      .from("head_of_sales_bonus_weekly_records")
      .select("amount, status")
      .eq("org_id", orgId)
      .eq("head_of_sales_rep_id", rep.id);
    if (allRecordsError) throw allRecordsError;
    const paidAmounts = (allRecords ?? []).filter((row) => row.status === "Paid").map((row) => Number(row.amount));
    const summary = {
      totalEarned: paidAmounts.reduce((sum, amount) => sum + amount, 0),
      highestBonus: paidAmounts.length > 0 ? Math.max(...paidAmounts) : 0,
      averageBonus: paidAmounts.length > 0 ? Math.round(paidAmounts.reduce((sum, amount) => sum + amount, 0) / paidAmounts.length) : 0,
      weeksPaid: paidAmounts.length,
      weeksTotal: (allRecords ?? []).length
    };

    res.json({
      weekStart,
      weekEnd,
      settings: bonusSettings,
      appointment: appointmentFromRow(rep.head_of_sales_rep_appointed_at),
      record,
      preview,
      scorecard,
      totalWeightedScore,
      summary,
      history: (historyRows ?? []).map((row) => ({
        weekStart: row.week_start,
        teamAov: row.team_aov,
        teamDeliveryRate: row.team_delivery_rate,
        bonusLevel: row.bonus_level,
        amount: row.amount,
        status: row.status,
        paidAt: row.paid_at
      }))
    });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load Bonus & Payouts." });
  }
});

const SaveBonusPayoutSchema = z.object({
  repId: z.string().min(1),
  weekStart: z.string().regex(DATE_KEY_PATTERN),
  upsellImprovement: z.boolean().optional(),
  initiativeSuccess: z.boolean().optional(),
  notes: z.string().max(2000).optional()
});

router.put("/bonus-payouts", async (req, res) => {
  const parsed = SaveBonusPayoutSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "weekStart is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    requireBonusLeadership(req.user!);
    const { rep, repIds } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);

    const { data: existing, error: existingError } = await supabase
      .from("head_of_sales_bonus_weekly_records")
      .select("id, status")
      .eq("org_id", orgId)
      .eq("head_of_sales_rep_id", rep.id)
      .eq("week_start", parsed.data.weekStart)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === "Paid") {
      res.status(409).json({ error: "This week's bonus is already marked Paid and locked." });
      return;
    }

    const weekEnd = weekEndFromStart(parsed.data.weekStart);
    const orders = await loadOrdersSince(orgId, repIds, addDaysToDateKey(parsed.data.weekStart, -28), weekEnd);
    const thisWeek = computeTeamWeekMetrics(orders, repIds, parsed.data.weekStart);
    const bonusSettings = await loadHeadOfSalesBonusSettings(orgId);
    const qualitative = {
      upsellImprovement: parsed.data.upsellImprovement ?? false,
      initiativeSuccess: parsed.data.initiativeSuccess ?? false
    };
    const evaluation = evaluateHeadOfSalesBonus(bonusSettings, thisWeek.team.aov, thisWeek.team.deliveryRate, qualitative);

    const row = {
      org_id: orgId,
      head_of_sales_rep_id: rep.id,
      week_start: parsed.data.weekStart,
      team_aov: thisWeek.team.aov,
      team_delivery_rate: thisWeek.team.deliveryRate,
      upsell_improvement: qualitative.upsellImprovement,
      initiative_success: qualitative.initiativeSuccess,
      bonus_level: evaluation.level,
      amount: evaluation.amount,
      notes: parsed.data.notes ?? null,
      updated_at: new Date().toISOString()
    };

    if (existing) {
      const { error: updateError } = await supabase.from("head_of_sales_bonus_weekly_records").update(row).eq("id", existing.id);
      if (updateError) throw updateError;
      res.json({ id: existing.id, level: evaluation.level, amount: evaluation.amount });
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("head_of_sales_bonus_weekly_records")
        .insert({ ...row, created_by: req.user!.id })
        .select("id")
        .single();
      if (insertError) throw insertError;
      res.status(201).json({ id: inserted.id, level: evaluation.level, amount: evaluation.amount });
    }
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not save the bonus." });
  }
});

const MarkBonusPaidSchema = z.object({ repId: z.string().min(1), weekStart: z.string().regex(DATE_KEY_PATTERN) });

router.post("/bonus-payouts/mark-paid", async (req, res) => {
  const parsed = MarkBonusPaidSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "weekStart is required." }); return; }
  const orgId = req.user!.orgId;
  try {
    requireBonusLeadership(req.user!);
    const { rep } = await loadRepAndTeam(orgId, parsed.data.repId, req.user!);
    const { data: existing, error: existingError } = await supabase
      .from("head_of_sales_bonus_weekly_records")
      .select("id, status, amount")
      .eq("org_id", orgId)
      .eq("head_of_sales_rep_id", rep.id)
      .eq("week_start", parsed.data.weekStart)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) { res.status(404).json({ error: "Save the bonus before marking it paid." }); return; }
    if (existing.status === "Paid") { res.status(409).json({ error: "Already marked Paid." }); return; }
    if (Number(existing.amount) <= 0) {
      res.status(400).json({ error: "This week didn't qualify for a bonus - nothing to mark paid." });
      return;
    }

    const { error: updateError } = await supabase
      .from("head_of_sales_bonus_weekly_records")
      .update({ status: "Paid", paid_at: new Date().toISOString(), paid_by: req.user!.id, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updateError) throw updateError;
    res.json({ ok: true });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not mark the bonus paid." });
  }
});

export default router;
