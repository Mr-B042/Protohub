import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { REPORT_ROW_CEILING } from "./query-limits.js";
import { loadTargetProgress } from "./target-progress-loader.js";
import { lagosTodayKey } from "./salary-spread.js";

/**
 * Writes one row per live target per day into daily_target_snapshots.
 *
 * ⚠️ THE TAB DOES NOT READ THIS TABLE, AND THAT IS DELIBERATE. Progress is
 * computed live from orders so it is correct whether or not this job has ever
 * run - a screen that depended on a cron would show yesterday's numbers after
 * any missed night. The snapshots exist for the TREND: a dated record of what
 * was true each day, which survives later edits to costs, targets or delivery
 * dates. That is exactly what a live recomputation cannot give you, because
 * recomputing August next month would use November's costs.
 *
 * ⚠️ VARIANCES ARE NOT STORED, by the same reasoning as migration 242:
 * actual - expected is exact and free to compute, and a stored copy is a
 * second source of truth that drifts the moment either side is corrected.
 */

/** Days after a period ends during which we still write its final snapshot. */
const CLOSING_GRACE_DAYS = 2;

export async function runDailyTargetSnapshots(today: string = lagosTodayKey()) {
  const graceStart = new Date(Date.parse(`${today}T00:00:00Z`) - CLOSING_GRACE_DAYS * 86_400_000)
    .toISOString().slice(0, 10);

  const { data: targets, error } = await supabase
    .from("target_periods")
    .select("*")
    .limit(REPORT_ROW_CEILING)
    // A settled period is a closed book - re-snapshotting it would append rows
    // to a record that has already been paid against.
    .neq("status", "settled")
    .lte("period_start", today)
    .gte("period_end", graceStart)
    .order("period_start", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    logger.error("target snapshots: could not list target periods", { error: error.message });
    return { written: 0, failed: 0, targets: 0 };
  }

  let written = 0;
  let failed = 0;
  for (const target of targets ?? []) {
    try {
      const progress = await loadTargetProgress(target.org_id, target, today);
      const { error: upsertError } = await supabase.from("daily_target_snapshots").upsert({
        org_id: target.org_id,
        target_period_id: target.id,
        snapshot_date: today,
        actual_contribution: progress.breakdown.contribution,
        actual_orders: progress.ordersPlaced.actual,
        actual_delivered: progress.delivered.actual,
        actual_pieces: progress.pieces.actual,
        actual_delivery_rate: progress.deliveryRate.actual,
        actual_ad_spend: progress.breakdown.adSpend,
        expected_contribution: progress.contribution.expectedByToday,
        expected_orders: progress.ordersPlaced.expectedByToday,
        expected_delivered: progress.delivered.expectedByToday,
        expected_pieces: progress.pieces.expectedByToday,
        projected_contribution: progress.forecast.projectedContribution,
        projected_orders: progress.forecast.projectedOrders,
        projected_delivered: progress.forecast.projectedDelivered,
        projected_pieces: progress.forecast.projectedPieces,
        required_daily_contribution: progress.requiredPace.contributionPerDay,
        required_daily_orders: progress.requiredPace.ordersPerDay,
        required_daily_delivered: progress.requiredPace.deliveredPerDay,
        required_daily_pieces: progress.requiredPace.piecesPerDay,
        days_elapsed: progress.forecast.daysElapsed,
        days_remaining: progress.forecast.daysRemainingInclusive,
        status: progress.forecast.status
      }, { onConflict: "target_period_id,snapshot_date" });

      if (upsertError) throw new Error(upsertError.message);
      written += 1;
    } catch (e) {
      failed += 1;
      // One bad target must not stop the rest - each is an independent record.
      logger.warn("target snapshots: one target failed", {
        targetId: target.id, error: (e as Error).message
      });
    }
  }

  return { written, failed, targets: (targets ?? []).length };
}
