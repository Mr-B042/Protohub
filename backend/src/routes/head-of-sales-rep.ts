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
  type HeadOfSalesOrder
} from "../lib/head-of-sales-metrics.js";
import { DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS, evaluateHeadOfSalesBonus } from "../lib/head-of-sales-bonus.js";

const router = Router();
// Owner/Admin/Manager can browse any Head of Sales Rep's dashboard; a Sales
// Rep may only ever look at their own (enforced per-request below, since
// "own" depends on which repId was requested).
router.use(requireAuth, requireRole("Owner", "Admin", "Manager", "Sales Rep"));

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OverviewQuerySchema = z.object({
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

router.get("/overview", async (req, res) => {
  const parsed = OverviewQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "repId is required." }); return; }
  const orgId = req.user!.orgId;

  try {
    const { data: repRow, error: repError } = await supabase
      .from("users")
      .select("id, name, role, is_head_of_sales_rep, head_of_sales_rep_appointed_at")
      .eq("org_id", orgId)
      .eq("id", parsed.data.repId)
      .maybeSingle();
    if (repError) throw repError;
    if (!repRow || !repRow.is_head_of_sales_rep) {
      res.status(404).json({ error: "That person is not Head of Sales Rep." });
      return;
    }
    if (req.user!.role === "Sales Rep" && req.user!.id !== repRow.id) {
      res.status(403).json({ error: "You can only view your own Head of Sales Rep dashboard." });
      return;
    }

    const weekStart = parsed.data.weekStart ?? sundayWeekStartForDateKey(lagosDateKey());
    const weekEnd = weekEndFromStart(weekStart);

    const teamRows = await loadTeam(orgId, repRow.id);
    const repIds = teamRows.map((row) => row.id);
    const repNameById = new Map(teamRows.map((row) => [row.id, String(row.name ?? "")]));

    // One query covers this week AND the 4 baseline weeks before it.
    const earliestNeeded = addDaysToDateKey(weekStart, -28);
    const { data: orderRows, error: ordersError } = repIds.length > 0
      ? await supabase
          .from("orders")
          .select("id, assigned_rep_id, status, amount, quantity, created_at, delivered_date, review_hold, upsell_from_qty, upsell_to_qty, original_amount, original_quantity, cross_sell_lines")
          .eq("org_id", orgId)
          .in("assigned_rep_id", repIds)
          .gte("created_at", `${earliestNeeded}T00:00:00Z`)
          .lte("created_at", `${weekEnd}T23:59:59Z`)
      : { data: [] as HeadOfSalesOrder[], error: null };
    if (ordersError) throw ordersError;
    const orders = (orderRows ?? []) as HeadOfSalesOrder[];

    const thisWeek = computeTeamWeekMetrics(orders, repIds, weekStart);
    const baseline = computeTrailingBaseline(orders, repIds, weekStart, 4);
    // Targets default to this week's own 4-week baseline until the Owner
    // configures real ones (Stage 10) - never an invented number. At the
    // baseline itself every "vs target" reads 100%, which is honest: there
    // is nothing to compare against yet beyond where the team already was.
    const target = baseline.team;

    const vsTarget = (actual: number, targetValue: number) =>
      targetValue > 0 ? Math.round((actual / targetValue) * 1000) / 10 : (actual > 0 ? 100 : 0);

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

    const repsMeetingTarget = thisWeek.reps.filter((rep) =>
      target.aov > 0 ? rep.aov >= target.aov : rep.aov > 0
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

    const appointedAt = repRow.head_of_sales_rep_appointed_at as string | null;
    const appointedTime = appointedAt ? new Date(appointedAt).getTime() : null;
    const dayNumber = appointedTime ? Math.max(1, Math.floor((Date.now() - appointedTime) / 86_400_000) + 1) : null;
    const weekNumber = dayNumber ? Math.max(1, Math.ceil(dayNumber / 7)) : null;
    const nextReviewAt = appointedTime ? new Date(appointedTime + 28 * 86_400_000).toISOString() : null;
    const finalReviewAt = appointedTime ? new Date(appointedTime + 90 * 86_400_000).toISOString() : null;

    // Flagged at 90% of target rather than exactly at target, so someone a
    // hair under target isn't lumped in with someone genuinely struggling.
    const ATTENTION_THRESHOLD = 0.9;
    const repsNeedingAttention = thisWeek.reps
      .map((rep) => {
        const reasons: string[] = [];
        if (target.aov > 0 && rep.aov < target.aov * ATTENTION_THRESHOLD) {
          reasons.push(`AOV ${rep.aov.toLocaleString()} is below target ${target.aov.toLocaleString()}`);
        }
        if (target.deliveryRate > 0 && rep.deliveryRate < target.deliveryRate * ATTENTION_THRESHOLD) {
          reasons.push(`Delivery rate ${rep.deliveryRate}% is below target ${target.deliveryRate}%`);
        }
        return { repId: rep.repId, repName: repNameById.get(rep.repId) ?? "Unknown", aov: rep.aov, deliveryRate: rep.deliveryRate, reasons };
      })
      .filter((rep) => rep.reasons.length > 0);

    res.json({
      rep: { id: repRow.id, name: repRow.name },
      appointment: { status: "Active", dayNumber, totalDays: 90, weekNumber, appointedAt, nextReviewAt, finalReviewAt },
      weekStart,
      weekEnd,
      scorecard,
      totalWeightedScore,
      teamSize: repIds.length,
      repsMeetingTarget,
      team: thisWeek.team,
      baseline: baseline.team,
      reps: thisWeek.reps.map((rep) => ({ ...rep, name: repNameById.get(rep.repId) ?? "Unknown" })),
      trend,
      repsNeedingAttention,
      bonus,
      // Placeholder until Stage 9 (Weekly Report) exists.
      weeklyReport: null
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load the Head of Sales Rep overview." });
  }
});

export default router;
