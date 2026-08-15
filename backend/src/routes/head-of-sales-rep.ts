import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  addDaysToDateKey,
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

export default router;
