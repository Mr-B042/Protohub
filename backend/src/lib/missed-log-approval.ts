// ── Missed logs approved automatically (Bright, 6 Nov 2026) ────────────────
// "Always approve so it enters the weekly report" (missed follow-ups), then
// "use auto" (missed cart logs too). The weekly report only takes off
// APPROVED misses, and every miss used to wait for the Owner: no follow-up
// miss was ever approved and no cart-log day either (one waived, 26 Aug), so
// nothing ever came off a report.
//
// Follow-up misses are approved in lib/follow-up-kpi.ts as the 10pm check
// records them. Cart-log misses are worked out live (routes/carts.ts
// computeCartLogBoard) and only a decision is stored, so they are approved
// here once their day has closed (Lagos midnight). A rep who thinks one is
// wrong still disputes it (rep → manager → Owner).

import { supabase } from "./supabase.js";
import { CART_LOG_PENALTY_START_DATE } from "./cart-log-penalty.js";
import { snapshotWithApprovedMisses } from "./missed-log-snapshot.js";

export const AUTO_APPROVED_BY = "Automatic (approved when recorded)";

/** One approved miss, as the weekly report knows it: a follow-up miss by its id, a cart-log day by "repId|date". */
export type ApprovedMiss = { repId: string | null; missDate: string; branchId: string | null; ref: string };

const SENT_REPORT_STATUSES = ["submitted", "manager_approved", "returned"];
const addDays = (key: string, days: number) => new Date(Date.parse(`${key}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const weekSundayOf = (key: string) => addDays(key, -new Date(`${key}T12:00:00Z`).getUTCDay());
const lagosToday = () => new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 10);

/**
 * A miss approved after its week's report was sent goes into that report's
 * saved figures, as a fine appeal does (routes/fine-appeals.ts). A report the
 * Owner has approved and locked is never changed; a draft is rebuilt when sent.
 */
export async function reflectApprovedMisses(orgId: string, misses: ApprovedMiss[]): Promise<void> {
  const groups = new Map<string, { repId: string; weekStart: string; branchId: string | null; refs: string[] }>();
  for (const miss of misses) {
    if (!miss.repId) continue;
    const weekStart = weekSundayOf(String(miss.missDate).slice(0, 10));
    const key = `${miss.repId}|${weekStart}|${miss.branchId ?? ""}`;
    const group = groups.get(key) ?? { repId: miss.repId, weekStart, branchId: miss.branchId, refs: [] };
    group.refs.push(miss.ref);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    let query = supabase.from("rep_weekly_reports").select("id, status, snapshot")
      .eq("org_id", orgId).eq("rep_id", group.repId).eq("week_start", group.weekStart);
    if (group.branchId) query = query.eq("branch_id", group.branchId);
    const { data: reports, error } = await query;
    if (error) throw error;
    for (const report of (reports ?? []) as Array<{ id: string; status: string; snapshot: unknown }>) {
      if (!SENT_REPORT_STATUSES.includes(String(report.status))) continue;
      const next = snapshotWithApprovedMisses(report.snapshot, group.refs);
      if (next === report.snapshot) continue;
      const { error: updateError } = await supabase.from("rep_weekly_reports")
        .update({ snapshot: next, updated_at: new Date().toISOString() }).eq("id", report.id);
      if (updateError) throw updateError;
    }
  }
}

/** Days looked back each run, so a night the job did not run is caught up. */
const CART_CATCH_UP_DAYS = 14;
const SALES_ROLES = new Set(["Sales Rep", "Recovery Rep", "Sales Closer"]);

/**
 * Approve every closed cart-log day still waiting (yesterday and the 13 days
 * before), at the day's full charge (₦500 a cart missed). Days the board
 * already flags as probably innocent - the customer's duplicate cart logged,
 * another rep logged it, or logged just after midnight - stay with the Owner
 * (Bright, 8 Oct 2026: "not charging for charging's sake"). So do days of
 * people who are switched off or not in sales.
 */
export async function approvePendingCartLogMisses(orgId: string, todayKey = lagosToday()): Promise<{ approved: number; held: number }> {
  const yesterday = addDays(todayKey, -1);
  const windowStart = addDays(todayKey, -CART_CATCH_UP_DAYS);
  const from = windowStart > CART_LOG_PENALTY_START_DATE ? windowStart : CART_LOG_PENALTY_START_DATE;
  if (yesterday < from) return { approved: 0, held: 0 };
  const { computeCartLogBoard } = await import("../routes/carts.js");
  const board = await computeCartLogBoard(orgId, null, from, yesterday);
  const waiting = (board.misses as any[]).filter((miss) => miss.status === "pending" && Number(miss.amount) > 0);
  if (waiting.length === 0) return { approved: 0, held: 0 };
  const repIds = Array.from(new Set(waiting.map((miss) => String(miss.repId))));
  const { data: reps, error: repError } = await supabase.from("users").select("id, active, role").eq("org_id", orgId).in("id", repIds);
  if (repError) throw repError;
  const chargeable = new Set(((reps ?? []) as any[]).filter((rep) => rep.active !== false && SALES_ROLES.has(String(rep.role))).map((rep) => String(rep.id)));

  const approved: ApprovedMiss[] = [];
  let held = 0;
  for (const miss of waiting) {
    const flagged = ((miss.affectedCarts ?? []) as any[]).some((cart) =>
      Boolean(cart.duplicateCartLogged) || (cart.loggedThatDayBy ?? []).length > 0 || Boolean(cart.loggedJustAfterMidnightAt));
    if (flagged || !chargeable.has(String(miss.repId))) { held += 1; continue; }
    const carts = Number(miss.cartsMissed) || 0;
    // Insert only: a decision the Owner already saved is never overwritten.
    const { data, error } = await supabase.from("cart_log_misses").upsert({
      org_id: orgId,
      rep_id: miss.repId,
      rep_name: String(miss.repName ?? "").trim(),
      miss_date: miss.missDate,
      amount: Math.round(Number(miss.amount)),
      carts_due: Number(miss.cartsDue) || 0,
      status: "approved",
      reviewed_by: null,
      reviewed_by_name: AUTO_APPROVED_BY,
      reviewed_at: new Date().toISOString(),
      review_note: `${carts} cart${carts === 1 ? "" : "s"} not logged`
    }, { onConflict: "org_id,rep_id,miss_date", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    if ((data ?? []).length > 0) approved.push({ repId: String(miss.repId), missDate: miss.missDate, branchId: null, ref: `${miss.repId}|${miss.missDate}` });
  }
  await reflectApprovedMisses(orgId, approved);
  return { approved: approved.length, held };
}
