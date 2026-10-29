import { supabase } from "./supabase.js";
import { FIRST_REPORT_WEEK } from "./weekly-report-workflow.js";

/**
 * Deliveries recorded too late for their own week's report (Bright, 29 Oct
 * 2026). An order marked Delivered AFTER the rep sent that week's report, but
 * dated inside that week, was in no report: the sent one did not have it and
 * the next one only takes orders delivered in its own week. One order (paid
 * nothing) was found that way.
 *
 * Such an order is now paid in the rep's NEXT report that has not been sent,
 * marked "lateRecorded" so the breakdown can say why. Once a report carrying
 * it is sent, the order counts as paid and is never offered again.
 */

const SENT = new Set(["submitted", "manager_approved", "owner_approved", "locked"]);

export type LateDelivery = { repId: string; orderId: string; deliveredDate: string; deliveredWeek: string; placedAt?: string | null; recordedAt?: string | null };

const sundayOf = (dateKey: string) => {
  const date = new Date(`${dateKey.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
};
const addDays = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

type ReportRow = { rep_id: string; week_start: string; status: string; orders: any[] | null };
type OrderRow = { id: string | number; assigned_rep_id: string; delivered_date: string };

/**
 * Pure: which delivered orders were missed by every sent report, and the week
 * each one is now paid in (the first week after its delivery whose report the
 * rep has not sent).
 */
export function findLateDeliveries(reports: ReportRow[], orders: OrderRow[]): Array<LateDelivery & { payWeek: string }> {
  const sentWeeks = new Map<string, Set<string>>();
  const paid = new Map<string, Set<string>>();
  for (const report of reports) {
    if (!SENT.has(report.status)) continue;
    const weekEnd = addDays(report.week_start, 6);
    (sentWeeks.get(report.rep_id) ?? sentWeeks.set(report.rep_id, new Set()).get(report.rep_id)!).add(report.week_start);
    const set = paid.get(report.rep_id) ?? paid.set(report.rep_id, new Set()).get(report.rep_id)!;
    for (const order of Array.isArray(report.orders) ? report.orders : []) {
      const delivered = String(order?.deliveredDate ?? "").slice(0, 10);
      const inWeek = order?.status === "Delivered" && delivered >= report.week_start && delivered <= weekEnd;
      if (inWeek || order?.lateRecorded) set.add(String(order.id));
    }
  }
  const result: Array<LateDelivery & { payWeek: string }> = [];
  for (const order of orders) {
    const repId = order.assigned_rep_id;
    const deliveredDate = String(order.delivered_date).slice(0, 10);
    const deliveredWeek = sundayOf(deliveredDate);
    const sent = sentWeeks.get(repId);
    // Its own week not sent yet: that report will take it in the normal way.
    if (!sent?.has(deliveredWeek)) continue;
    if (paid.get(repId)?.has(String(order.id))) continue;
    let payWeek = addDays(deliveredWeek, 7);
    while (sent.has(payWeek)) payWeek = addDays(payWeek, 7);
    result.push({ repId, orderId: String(order.id), deliveredDate, deliveredWeek, payWeek });
  }
  return result;
}

/** The late deliveries paid in this week's reports (all reps, or one). */
export async function lateDeliveriesFor(orgId: string, branchId: string, weekStart: string, repId: string | null = null): Promise<LateDelivery[]> {
  let reportsQuery = supabase.from("rep_weekly_reports").select("rep_id, week_start, status, orders:snapshot->orders")
    .eq("org_id", orgId).eq("branch_id", branchId).gte("week_start", FIRST_REPORT_WEEK).lt("week_start", weekStart);
  let ordersQuery = supabase.from("orders").select("id, assigned_rep_id, delivered_date")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("status", "Delivered")
    .gte("delivered_date", FIRST_REPORT_WEEK).lt("delivered_date", weekStart)
    .not("assigned_rep_id", "is", null).or("review_hold.is.null,review_hold.eq.false");
  if (repId) {
    reportsQuery = reportsQuery.eq("rep_id", repId);
    ordersQuery = ordersQuery.eq("assigned_rep_id", repId);
  }
  // This week's own reports too: a rep who already sent this week is past it.
  let thisWeekQuery = supabase.from("rep_weekly_reports").select("rep_id, week_start, status")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart);
  if (repId) thisWeekQuery = thisWeekQuery.eq("rep_id", repId);
  const [reports, orders, thisWeek] = await Promise.all([reportsQuery, ordersQuery.limit(20000), thisWeekQuery]);
  if (reports.error) throw reports.error;
  if (orders.error) throw orders.error;
  if (thisWeek.error) throw thisWeek.error;
  const all = [...(reports.data ?? []) as any[], ...((thisWeek.data ?? []) as any[]).map((row) => ({ ...row, orders: [] }))];
  const late = findLateDeliveries(all, (orders.data ?? []) as any[])
    .filter((item) => item.payWeek === weekStart)
    .map(({ payWeek: _payWeek, ...item }) => item);
  if (late.length === 0) return late;
  // When it was placed and when it was marked Delivered: the second is why
  // its own week's report missed it.
  const ids = late.map((item) => item.orderId);
  const [{ data: placed, error: placedError }, { data: marks, error: marksError }] = await Promise.all([
    supabase.from("orders").select("id, created_at").eq("org_id", orgId).in("id", ids),
    supabase.from("order_audit").select("order_id, created_at").eq("org_id", orgId).eq("to_status", "Delivered").in("order_id", ids)
  ]);
  if (placedError) throw placedError;
  if (marksError) throw marksError;
  const placedAt = new Map((placed ?? []).map((row: any) => [String(row.id), row.created_at as string]));
  const recordedAt = new Map<string, string>();
  for (const row of (marks ?? []) as any[]) {
    const key = String(row.order_id);
    if (!recordedAt.has(key) || String(row.created_at) > recordedAt.get(key)!) recordedAt.set(key, String(row.created_at));
  }
  return late.map((item) => ({ ...item, placedAt: placedAt.get(item.orderId) ?? null, recordedAt: recordedAt.get(item.orderId) ?? null }));
}
