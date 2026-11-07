import { supabase } from "./supabase.js";
import { LEVEL_LABEL, addDays, cleanAmounts, payrollMonthOfWeek, type ReviewAmounts, type ReviewLevel } from "./customer-review-rules.js";

// Customer Reviews (Bright, 7 Nov 2026): reads shared by the route, the
// weekly reports and payroll. The bonus ledger (customer_review_incentives)
// is the only source of what was paid: one row per amount, each in one week.

export async function readAmounts(orgId: string): Promise<ReviewAmounts> {
  const { data, error } = await supabase.from("customer_review_settings")
    .select("written_amount, photo_amount, video_amount, premium_amount").eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  return cleanAmounts(data ? { written: data.written_amount, photo: data.photo_amount, video: data.video_amount, premium: data.premium_amount } : null);
}

export async function saveAmounts(orgId: string, amounts: ReviewAmounts, user: { id: string; name: string | null }) {
  const { error } = await supabase.from("customer_review_settings").upsert({
    org_id: orgId, written_amount: amounts.written, photo_amount: amounts.photo, video_amount: amounts.video, premium_amount: amounts.premium,
    updated_by: user.id, updated_by_name: user.name ?? "", updated_at: new Date().toISOString()
  }, { onConflict: "org_id" });
  if (error) throw error;
}

export type ReviewBonusLine = { id: string; repId: string; label: string; amount: number; date: string; orderId: string; level: ReviewLevel };

/** A week's review bonus lines, for the weekly report (paid in the week of approval). */
export async function reviewBonusesForWeek(orgId: string, branchId: string, repIds: string[] | null, weekStart: string): Promise<ReviewBonusLine[]> {
  let query = supabase.from("customer_review_incentives").select("id, rep_id, order_id, level, amount, kind, created_at")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("pay_week_start", weekStart).order("created_at");
  if (repIds) query = query.in("rep_id", repIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).filter((row: any) => row.rep_id).map((row: any) => ({
    id: `review:${row.id}`,
    repId: String(row.rep_id),
    orderId: String(row.order_id),
    level: row.level as ReviewLevel,
    amount: Math.round(Number(row.amount ?? 0)),
    date: String(row.created_at).slice(0, 10),
    label: `${row.kind === "reversal" ? "Taken back: " : ""}${LEVEL_LABEL[row.level as ReviewLevel] ?? "Review"} · order ${row.order_id}`
  }));
}

/**
 * Each rep's review bonus for a payroll month: the weeks that END in that
 * month (the Saturday), the same rule as the payout changes on the weekly
 * reports, so every amount is in exactly one month.
 */
export async function reviewBonusByRepForMonth(orgId: string, monthKey: string): Promise<Map<string, number>> {
  const [year, month] = monthKey.split("-").map(Number);
  const from = addDays(`${monthKey}-01`, -6);
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const { data, error } = await supabase.from("customer_review_incentives").select("rep_id, amount, pay_week_start")
    .eq("org_id", orgId).gte("pay_week_start", from).lte("pay_week_start", to).limit(20000);
  if (error) throw error;
  const out = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.rep_id || payrollMonthOfWeek(String(row.pay_week_start)) !== monthKey) continue;
    out.set(String(row.rep_id), (out.get(String(row.rep_id)) ?? 0) + Math.round(Number(row.amount ?? 0)));
  }
  return out;
}
