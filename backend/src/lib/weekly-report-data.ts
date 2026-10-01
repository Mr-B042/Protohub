import { supabase } from "./supabase.js";
import { buildHeadReview } from "../routes/sales-scripts.js";
import { addDaysToDateKey, lagosDateKey, sundayWeekStartForDateKey, weekEndFromStart } from "./sales-bonus-engine.js";
import { notifyHeadOfSales, notifyManagersOverdue, notifyReportReminder } from "./weekly-report-notifications.js";

// Shared by the weekly-report routes and the Tuesday/Wednesday reminder job.

const lagosDayStartIso = (dateKey: string) => new Date(`${dateKey}T00:00:00+01:00`).toISOString();
const lagosDayEndIso = (dateKey: string) => new Date(`${dateKey}T23:59:59.999+01:00`).toISOString();

/**
 * The reps whose report the week needs: active Sales Reps in this branch who
 * had at least one order placed or delivered that week. A rep with no orders
 * has nothing to report and must not block the week.
 *
 * ⚠️ The orders queries filter branch_id EXPLICITLY. Inside a request the
 * branch filter is added for us (branchScopedFetch), but the reminder job has
 * no request scope - without this it would count another branch's orders.
 * Repeat-order holds are left out, like every cohort report; `.or` rather than
 * `.neq` because `.neq("review_hold", true)` silently drops NULL rows.
 */
export async function expectedRepIdsForWeek(orgId: string, branchId: string, weekStart: string): Promise<string[]> {
  const weekEnd = weekEndFromStart(weekStart);
  const [{ data: members, error: membersError }, { data: reps, error: repsError }] = await Promise.all([
    supabase.from("branch_memberships").select("user_id").eq("branch_id", branchId),
    supabase.from("users").select("id").eq("org_id", orgId).eq("role", "Sales Rep").eq("active", true).eq("is_demo", false)
  ]);
  if (membersError) throw membersError;
  if (repsError) throw repsError;
  const memberIds = new Set((members ?? []).map((row: any) => row.user_id));
  const repIds = (reps ?? []).map((row: any) => row.id as string).filter((id) => memberIds.has(id));
  if (repIds.length === 0) return [];

  const [{ data: placed, error: placedError }, { data: delivered, error: deliveredError }] = await Promise.all([
    supabase.from("orders").select("assigned_rep_id")
      .eq("org_id", orgId).eq("branch_id", branchId).in("assigned_rep_id", repIds)
      .or("review_hold.is.null,review_hold.eq.false")
      .gte("created_at", lagosDayStartIso(weekStart)).lte("created_at", lagosDayEndIso(weekEnd))
      .limit(20000),
    supabase.from("orders").select("assigned_rep_id")
      .eq("org_id", orgId).eq("branch_id", branchId).in("assigned_rep_id", repIds)
      .gte("delivered_date", weekStart).lte("delivered_date", weekEnd)
      .limit(20000)
  ]);
  if (placedError) throw placedError;
  if (deliveredError) throw deliveredError;
  const active = new Set([...(placed ?? []), ...(delivered ?? [])].map((row: any) => row.assigned_rep_id as string));
  return repIds.filter((id) => active.has(id));
}

/** Reps (of those given) with a report the manager can see: submitted or beyond. */
export async function submittedRepIds(orgId: string, branchId: string, weekStart: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("rep_weekly_reports").select("rep_id, status")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart);
  if (error) throw error;
  return new Set((data ?? []).filter((row: any) => row.status !== "draft").map((row: any) => row.rep_id as string));
}

/**
 * Tuesday 09:00 Lagos: remind reps whose report for the week that just ended
 * is due today. Wednesday 09:00: tell the late reps it is overdue and give the
 * managers the list. One pass per active branch, since reports are per branch.
 */
export async function runWeeklyReportReminders(when: "due_today" | "overdue"): Promise<{ branches: number; reminded: number }> {
  const today = lagosDateKey();
  // Tuesday: the week that ended on Saturday. Wednesday: the same week (due yesterday).
  const weekStart = addDaysToDateKey(sundayWeekStartForDateKey(today), -7);
  const { data: branches, error } = await supabase.from("branches").select("id, org_id").eq("active", true);
  if (error) throw error;
  let reminded = 0;
  for (const branch of branches ?? []) {
    // Tuesday: tell the Owner if last week's Head of Sales bonus is on hold
    // (no script, or nobody used it) and still waiting for a decision.
    if (when === "due_today") {
      try {
        const review: any = await buildHeadReview(branch.org_id, branch.id, weekStart);
        if (review.head && review.hold?.held && !review.release) {
          await notifyHeadOfSales(branch.org_id, branch.id, { kind: "bonus_held", headName: review.head.name, weekStart, amount: review.evaluation.amount, reasons: review.hold.reasons });
        }
      } catch (error: any) {
        console.warn("[weekly-report-data] head of sales hold check failed:", error?.message ?? error);
      }
    }
    const expected = await expectedRepIdsForWeek(branch.org_id, branch.id, weekStart);
    if (expected.length === 0) continue;
    const submitted = await submittedRepIds(branch.org_id, branch.id, weekStart);
    const missing = expected.filter((id) => !submitted.has(id));
    if (missing.length === 0) continue;
    await notifyReportReminder(branch.org_id, branch.id, weekStart, missing, when);
    if (when === "overdue") {
      const { data: users } = await supabase.from("users").select("id, name").in("id", missing);
      await notifyManagersOverdue(branch.org_id, branch.id, weekStart, (users ?? []).map((user: any) => user.name as string));
    }
    reminded += missing.length;
  }
  return { branches: (branches ?? []).length, reminded };
}
