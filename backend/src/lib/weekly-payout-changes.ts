import { supabase } from "./supabase.js";
import { addDaysToDateKey, weekEndFromStart } from "./sales-bonus-engine.js";

// Kept apart from weekly-report-data.ts so payroll can read approved payout
// changes without pulling in the weekly-report routes.

export type ApprovedPayoutChange = { repId: string; weekStart: string; date: string; amount: number; systemAmount: number; reason: string };

/**
 * Payout changes that count: the manager's change on a rep's weekly report,
 * once the Owner has approved and LOCKED that week (migration 299). Until
 * then, and again if the Owner reopens the week, the change is only a proposal.
 *
 * Each is dated on the LAST day of its week (the Saturday): the week's bonus
 * is settled when the week ends, so a month or a custom period counts the
 * change if that Saturday falls inside it.
 *
 * Inside a request the branch filter is added for us; payroll runs for the
 * whole organisation and gets every branch.
 */
export async function approvedPayoutChanges(orgId: string, options: { from?: string; to?: string; repId?: string | null } = {}): Promise<ApprovedPayoutChange[]> {
  let query = supabase.from("weekly_report_payout_changes")
    .select("rep_id, rep_report_id, week_start, system_amount, amount, reason")
    .eq("org_id", orgId).limit(5000);
  // week_start is 6 days before the date the change counts on.
  if (options.from) query = query.gte("week_start", addDaysToDateKey(options.from, -6));
  if (options.to) query = query.lte("week_start", addDaysToDateKey(options.to, -6));
  if (options.repId) query = query.eq("rep_id", options.repId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const locked = new Set<string>();
  const reportIds = rows.map((row: any) => row.rep_report_id as string);
  for (let index = 0; index < reportIds.length; index += 150) {
    const { data: reports, error: reportError } = await supabase.from("rep_weekly_reports").select("id")
      .eq("org_id", orgId).in("id", reportIds.slice(index, index + 150)).eq("status", "locked");
    if (reportError) throw reportError;
    for (const report of reports ?? []) locked.add(report.id as string);
  }
  return rows.filter((row: any) => locked.has(row.rep_report_id)).map((row: any) => ({
    repId: row.rep_id as string,
    weekStart: row.week_start as string,
    date: weekEndFromStart(row.week_start as string),
    amount: Number(row.amount ?? 0),
    systemAmount: Number(row.system_amount ?? 0),
    reason: row.reason ?? ""
  }));
}
