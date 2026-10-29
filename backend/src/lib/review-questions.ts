import { supabase } from "./supabase.js";
import { deliver, leadershipRecipients } from "./weekly-report-notifications.js";

/**
 * Questions to the manager on a rep's weekly figures (Bright, 29 Oct 2026).
 *
 * The Owner asks by hand, and Protohub asks by itself when a figure does not
 * add up (autoChecks). The manager answers; the Owner accepts or asks again.
 * While any question waits for the manager the week cannot go to the Owner
 * (routes/weekly-reports.ts, company/submit) or be locked.
 *
 * An auto question's check_key carries the figure it was raised on (e.g. the
 * payout change amount), so a changed figure raises a fresh question and the
 * old one closes itself with a note.
 */

export type QuestionMessage = {
  kind: "question" | "answer" | "follow_up" | "accepted" | "closed";
  text: string;
  byId: string | null;
  byName: string;
  byRole: string;
  at: string;
};
export type QuestionStatus = "open" | "answered" | "accepted";

export const QUESTION_COLUMNS = "id, week_start, rep_id, source, check_key, status, messages, created_at, updated_at, closed_at";

export const mapQuestion = (row: any) => ({
  id: String(row.id),
  weekStart: String(row.week_start),
  repId: String(row.rep_id),
  source: row.source as "owner" | "auto",
  checkKey: row.check_key ?? null,
  status: row.status as QuestionStatus,
  messages: (Array.isArray(row.messages) ? row.messages : []) as QuestionMessage[],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  closedAt: row.closed_at ?? null
});

const missingTable = (error: any) => error?.code === "42P01" || error?.code === "PGRST205";
const naira = (value: number) => `₦${Math.round(Math.abs(value)).toLocaleString("en-NG")}`;
const signed = (value: number) => `${value < 0 ? "-" : "+"}${naira(value)}`;

/** A payout change is "big" from this share of the system bonus, and at least BIG_CHANGE_MIN. */
export const BIG_CHANGE_SHARE = 0.2;
export const BIG_CHANGE_MIN = 1000;

type SnapshotLike = {
  repName?: string;
  weekStart?: string;
  weekEnd?: string;
  totals?: Record<string, any>;
  orders?: Array<{ status?: string; deliveredDate?: string | null; placedThisWeek?: boolean; bonus?: number }>;
};
type PayoutLike = { amount: number; systemAmount: number; reason: string } | null;

/**
 * What does not add up on one rep's report. Pure: the same snapshot and
 * payout change always give the same checks (and the same keys).
 */
export function autoChecks(snapshot: SnapshotLike | null, payout: PayoutLike): Array<{ key: string; text: string }> {
  if (!snapshot?.totals) return [];
  const t = snapshot.totals;
  const name = snapshot.repName || "this rep";
  const weekStart = String(snapshot.weekStart ?? "");
  const weekEnd = String(snapshot.weekEnd ?? "");
  const inWeek = (key: string | null | undefined) => !!key && key.slice(0, 10) >= weekStart && key.slice(0, 10) <= weekEnd;
  const paidOrders = (snapshot.orders ?? []).filter((order) => order.status === "Delivered" && inWeek(order.deliveredDate));
  const paidThisWeek = paidOrders.filter((order) => order.placedThisWeek).length;
  const paidCarried = paidOrders.length - paidThisWeek;
  const paidCount = Number(t.deliveredForBonus ?? paidOrders.length);
  const checks: Array<{ key: string; text: string }> = [];

  if (payout && Math.round(payout.amount) !== 0) {
    const amount = Math.round(payout.amount);
    // 1. The reason gives an order count that is not the deliveries the bonus is paid on.
    const counts = Array.from(payout.reason.matchAll(/(\d{1,4})\s*(?:orders?|deliver(?:ies|y|ed))/gi)).map((match) => Number(match[1]));
    const wrong = counts.find((count) => count !== paidCount);
    if (wrong !== undefined) {
      checks.push({
        key: `payout_count:${amount}`,
        // Short lines with the numbers to check (Bright: "simple ABC").
        text: [
          `You changed ${name}'s pay by ${signed(amount)}.`,
          `Your reason says ${wrong} orders.`,
          `But ${name}'s bonus is paid on ${paidCount} deliveries:`,
          `• ${paidThisWeek} placed this week`,
          `• ${paidCarried} from earlier weeks`,
          ...(Number(t.delivered ?? 0) === wrong ? [`(${wrong} is the delivery-rate count. It includes orders delivered after the week, which are paid next week.)`] : []),
          `Please check and say why ${signed(amount)} is right.`
        ].join("\n")
      });
    }
    // 2. A big change either way.
    const system = Math.max(0, Math.round(payout.systemAmount));
    if (Math.abs(amount) >= BIG_CHANGE_MIN && Math.abs(amount) >= system * BIG_CHANGE_SHARE) {
      const share = system > 0 ? Math.round((Math.abs(amount) / system) * 100) : 100;
      checks.push({
        key: `payout_size:${amount}`,
        text: [
          `${name}'s bonus from the system: ${naira(system)}.`,
          `You changed it by ${signed(amount)} (${share}%).`,
          `Your reason: "${payout.reason}"`,
          `Please show how you got ${naira(amount)}.`
        ].join("\n")
      });
    }
  }

  // 3. The orders do not add up to the report's bonus.
  const earned = Math.round(Number(t.baseBonus ?? 0) + Number(t.upsellBonus ?? 0) + Number(t.crossSellBonus ?? 0));
  const fromOrders = Math.round(paidOrders.reduce((sum, order) => sum + Number(order.bonus ?? 0), 0));
  const gap = earned - fromOrders;
  if (paidOrders.length > 0 && Math.abs(gap) >= 1) {
    checks.push({
      key: `orders_sum:${gap}`,
      text: [
        `${name}'s orders add up to ${naira(fromOrders)}.`,
        `The report's bonus says ${naira(earned)}.`,
        `Difference: ${signed(gap)}.`,
        `Please say which order or rule the ${naira(gap)} is for.`
      ].join("\n")
    });
  }
  return checks;
}

const systemMessage = (kind: QuestionMessage["kind"], text: string): QuestionMessage =>
  ({ kind, text, byId: null, byName: "Protohub", byRole: "System", at: new Date().toISOString() });

/**
 * Raise the auto questions this week's reports call for, and close the ones
 * that no longer apply. Only reports with the manager (submitted / approved).
 * Returns false when the table does not exist yet.
 */
export async function syncAutoQuestions(orgId: string, branchId: string, weekStart: string,
  reports: Array<{ id: string; rep_id: string; status: string; snapshot: any }>,
  payouts: Array<{ repReportId: string | null; repId: string; amount: number; systemAmount: number; reason: string }>): Promise<boolean> {
  const { data: existing, error } = await supabase.from("weekly_report_questions").select("id, rep_id, check_key, status, messages")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart).eq("source", "auto");
  if (error) { if (missingTable(error)) return false; throw error; }

  const wanted = new Map<string, { repId: string; key: string; text: string }>();
  for (const report of reports) {
    if (report.status !== "submitted" && report.status !== "manager_approved") continue;
    const payout = payouts.find((row) => row.repReportId === report.id || (!row.repReportId && row.repId === report.rep_id)) ?? null;
    for (const check of autoChecks(report.snapshot, payout)) wanted.set(`${report.rep_id}|${check.key}`, { repId: report.rep_id, ...check });
  }
  const have = new Map((existing ?? []).map((row: any) => [`${row.rep_id}|${row.check_key}`, row]));

  const toInsert = Array.from(wanted.entries()).filter(([key]) => !have.has(key)).map(([, item]) => ({
    org_id: orgId, branch_id: branchId, week_start: weekStart, rep_id: item.repId, source: "auto", check_key: item.key,
    status: "open", messages: [systemMessage("question", item.text)]
  }));
  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from("weekly_report_questions").upsert(toInsert, { onConflict: "org_id,branch_id,week_start,rep_id,check_key", ignoreDuplicates: true });
    if (insertError) throw insertError;
    await notifyManagers(orgId, branchId, weekStart, toInsert.length, "Protohub");
  }
  // A figure that changed or went away: its question no longer applies.
  for (const row of existing ?? []) {
    if (row.status === "accepted" || wanted.has(`${row.rep_id}|${row.check_key}`)) continue;
    const messages = [...(Array.isArray(row.messages) ? row.messages : []), systemMessage("closed", "Closed by itself: the figure this was about has changed or been removed.")];
    const now = new Date().toISOString();
    const { error: closeError } = await supabase.from("weekly_report_questions")
      .update({ status: "accepted", messages, closed_at: now, updated_at: now }).eq("id", row.id).neq("status", "accepted");
    if (closeError) throw closeError;
  }
  return true;
}

export async function questionsForWeek(orgId: string, branchId: string, weekStart: string) {
  const { data, error } = await supabase.from("weekly_report_questions").select(QUESTION_COLUMNS)
    .eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart).order("created_at", { ascending: true });
  if (error) { if (missingTable(error)) return null; throw error; }
  return (data ?? []).map(mapQuestion);
}

/** Questions still waiting for the manager this week (0 when the table is missing). */
export async function openQuestionCount(orgId: string, branchId: string, weekStart: string) {
  const { count, error } = await supabase.from("weekly_report_questions").select("id", { count: "exact", head: true })
    .eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart).eq("status", "open");
  if (error) { if (missingTable(error)) return 0; throw error; }
  return count ?? 0;
}

const weekText = (weekStart: string) => {
  const date = new Date(`${weekStart}T12:00:00Z`);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

export async function notifyManagers(orgId: string, branchId: string, weekStart: string, count: number, askedBy: string) {
  try {
    const recipients = await leadershipRecipients(orgId, branchId, ["Manager", "Admin"]);
    await deliver(orgId, branchId, recipients, {
      title: count === 1 ? "A question on this week's report" : `${count} questions on this week's report`,
      message: `${askedBy} asked about the week of ${weekText(weekStart)}. Answer before you submit to the owner.`,
      kind: "weekly_report_question", tag: `weekly-question-${weekStart}`, type: "warning"
    });
  } catch (error) {
    console.warn("[review-questions] notify managers failed:", error);
  }
}

export async function notifyOwner(orgId: string, branchId: string, weekStart: string, byName: string) {
  try {
    const recipients = await leadershipRecipients(orgId, branchId, ["Owner"]);
    await deliver(orgId, branchId, recipients, {
      title: "The manager answered your question",
      message: `${byName} answered a question on the week of ${weekText(weekStart)}. Accept it or ask again.`,
      kind: "weekly_report_question", tag: `weekly-question-answer-${weekStart}`
    });
  } catch (error) {
    console.warn("[review-questions] notify owner failed:", error);
  }
}
