import type { UserRole } from "../types/index.js";
import { sendPushToUsers } from "./push.js";
import { getOrgPushBranding } from "./push-branding.js";
import { supabase } from "./supabase.js";

// Weekly Report alerts (Bright, 1 Oct 2026): every submission, approval,
// return, flag, lock and bonus query reaches the people who act on it, as a
// bell entry AND a phone push - the same pair waybill and cart alerts use.
//
// ⚠️ A failed alert must never fail the action that caused it: everything
// here is caught and logged. The report itself is the record; the alert is a
// nudge.

// Typed so an invented role can't 400 the whole recipient query
// ([[project-delivery-agent-role-gap]]).
const LEADERSHIP: readonly UserRole[] = ["Owner", "Admin", "Manager"];
const MANAGERS: readonly UserRole[] = ["Admin", "Manager"];

// Where each person lands: managers review inside the Manager Dashboard tab;
// reps and the Owner use the Weekly Reports page.
const LINK_FOR_ROLE = (role: string) =>
  role === "Admin" || role === "Manager" ? "/dashboard/admin/manager-overview/weekly-reports" : "/dashboard/admin/weekly-reports";

type Recipient = { id: string; role: string };

/**
 * Active people in these roles who work in this branch. The Owner sees every
 * branch without a membership row, so the Owner is never filtered out.
 */
export async function leadershipRecipients(orgId: string, branchId: string, roles: readonly UserRole[] = LEADERSHIP): Promise<Recipient[]> {
  const [{ data: users, error }, { data: members, error: membersError }] = await Promise.all([
    supabase.from("users").select("id, role").eq("org_id", orgId).eq("active", true).eq("is_demo", false).in("role", roles as UserRole[]),
    supabase.from("branch_memberships").select("user_id").eq("branch_id", branchId)
  ]);
  if (error) throw error;
  if (membersError) throw membersError;
  const memberIds = new Set((members ?? []).map((row: any) => row.user_id));
  return (users ?? [])
    .filter((user: any) => user.role === "Owner" || memberIds.has(user.id))
    .map((user: any) => ({ id: user.id as string, role: String(user.role) }));
}

async function deliver(orgId: string, branchId: string, recipients: Recipient[], alert: { title: string; message: string; kind: string; tag: string; type?: "info" | "warning" | "success" }) {
  const unique = Array.from(new Map(recipients.map((recipient) => [recipient.id, recipient])).values());
  if (unique.length === 0) return;
  const rows = unique.map((recipient) => ({
    org_id: orgId,
    branch_id: branchId,
    recipient_id: recipient.id,
    type: alert.type ?? "info",
    title: alert.title,
    message: alert.message,
    link: LINK_FOR_ROLE(recipient.role),
    read: false
  }));
  const { error } = await supabase.from("system_notifications").insert(rows);
  if (error) console.warn("[weekly-report-notifications] insert failed:", error.message);

  const branding = await getOrgPushBranding(orgId);
  await Promise.all(unique.map((recipient) => sendPushToUsers(orgId, [recipient.id], {
    title: alert.title,
    body: alert.message,
    kind: alert.kind,
    url: LINK_FOR_ROLE(recipient.role),
    tag: alert.tag,
    brandName: branding.brandName,
    brandLogo: branding.brandLogo
  })));
}

const weekLabel = (weekStart: string) => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const start = new Date(`${weekStart}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${start.getUTCDate()} ${months[start.getUTCMonth()]} – ${end.getUTCDate()} ${months[end.getUTCMonth()]}`;
};

export type WeeklyReportEvent =
  | { kind: "rep_submitted"; repId: string; repName: string; resubmitted: boolean; late: boolean }
  | { kind: "manager_approved"; repId: string }
  | { kind: "manager_returned"; repId: string; problem: string; orderRef?: string | null }
  | { kind: "rep_flagged"; repName: string; problem: string }
  | { kind: "company_submitted"; resubmitted: boolean }
  | { kind: "owner_returned"; problem: string }
  | { kind: "owner_locked"; repIds: string[] }
  | { kind: "owner_reopened"; reason: string }
  | { kind: "bonus_query_opened"; repName: string; despiteAccurate: boolean; findings: number }
  | { kind: "bonus_query_resolved"; repId: string; corrected: boolean; amount: number; paidWeekStart: string | null };

export async function notifyWeeklyReport(orgId: string, branchId: string, weekStart: string, event: WeeklyReportEvent): Promise<void> {
  try {
    const week = weekLabel(weekStart);
    const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
    switch (event.kind) {
      case "rep_submitted":
        return await deliver(orgId, branchId, await leadershipRecipients(orgId, branchId), {
          title: `${event.repName} ${event.resubmitted ? "resubmitted" : "submitted"} their weekly report`,
          message: `Week ${week}${event.late ? " · submitted late" : ""}. Ready for review.`,
          kind: "weekly_report_submitted",
          tag: `weekly-report-${weekStart}-${event.repId}-submitted`,
          type: event.late ? "warning" : "info"
        });
      case "manager_approved":
        return await deliver(orgId, branchId, [{ id: event.repId, role: "Sales Rep" }], {
          title: "Your weekly report was approved",
          message: `Week ${week} was approved by your manager. It now goes to the owner.`,
          kind: "weekly_report_approved",
          tag: `weekly-report-${weekStart}-${event.repId}-approved`,
          type: "success"
        });
      case "manager_returned":
        return await deliver(orgId, branchId, [{ id: event.repId, role: "Sales Rep" }], {
          title: "Your weekly report was returned",
          message: `Week ${week}: ${event.problem}${event.orderRef ? ` (${event.orderRef})` : ""}. Fix it, answer the comment and resubmit.`,
          kind: "weekly_report_returned",
          tag: `weekly-report-${weekStart}-${event.repId}-returned`,
          type: "warning"
        });
      case "rep_flagged":
        return await deliver(orgId, branchId, (await leadershipRecipients(orgId, branchId)).filter((user) => user.role === "Owner"), {
          title: `Issue flagged on ${event.repName}'s weekly report`,
          message: `Week ${week}: ${event.problem}.`,
          kind: "weekly_report_flagged",
          tag: `weekly-report-${weekStart}-flag-${Date.now()}`,
          type: "warning"
        });
      case "company_submitted":
        return await deliver(orgId, branchId, (await leadershipRecipients(orgId, branchId)).filter((user) => user.role === "Owner"), {
          title: `Weekly report ${event.resubmitted ? "resubmitted" : "submitted"} for your approval`,
          message: `Week ${week}: every rep's report is approved by the manager. Ready to approve and lock.`,
          kind: "weekly_report_company_submitted",
          tag: `weekly-report-${weekStart}-company-submitted`
        });
      case "owner_returned":
        return await deliver(orgId, branchId, await leadershipRecipients(orgId, branchId, MANAGERS), {
          title: "The owner returned the weekly report",
          message: `Week ${week}: ${event.problem}. Correct it and resubmit.`,
          kind: "weekly_report_owner_returned",
          tag: `weekly-report-${weekStart}-owner-returned`,
          type: "warning"
        });
      case "owner_locked":
        return await deliver(orgId, branchId, [
          ...(await leadershipRecipients(orgId, branchId, MANAGERS)),
          ...event.repIds.map((id) => ({ id, role: "Sales Rep" }))
        ], {
          title: "Weekly report approved and locked",
          message: `Week ${week} is approved by the owner. Bonuses are final.`,
          kind: "weekly_report_locked",
          tag: `weekly-report-${weekStart}-locked`,
          type: "success"
        });
      case "owner_reopened":
        return await deliver(orgId, branchId, await leadershipRecipients(orgId, branchId, MANAGERS), {
          title: "The owner reopened a locked week",
          message: `Week ${week}: ${event.reason}`,
          kind: "weekly_report_reopened",
          tag: `weekly-report-${weekStart}-reopened`,
          type: "warning"
        });
      case "bonus_query_opened":
        return await deliver(orgId, branchId, await leadershipRecipients(orgId, branchId), {
          title: `${event.repName} raised a bonus query`,
          message: event.despiteAccurate
            ? `Week ${week}: the system check found nothing missing, but the rep still disagrees.`
            : `Week ${week}: the system check found ${event.findings} problem${event.findings === 1 ? "" : "s"}. Needs your review.`,
          kind: "weekly_bonus_query",
          tag: `weekly-bonus-query-${weekStart}-${Date.now()}`,
          type: "warning"
        });
      case "bonus_query_resolved":
        return await deliver(orgId, branchId, [{ id: event.repId, role: "Sales Rep" }], {
          title: event.corrected ? "Your bonus query was corrected" : "Your bonus query was answered",
          message: event.corrected
            ? `Week ${week}: ${naira(event.amount)} will be added to your bonus for the week of ${event.paidWeekStart ? weekLabel(event.paidWeekStart) : "this week"}.`
            : `Week ${week}: your manager checked it and made no change. Open the report to see why.`,
          kind: "weekly_bonus_query_resolved",
          tag: `weekly-bonus-query-resolved-${Date.now()}`,
          type: event.corrected ? "success" : "info"
        });
    }
  } catch (error: any) {
    console.warn("[weekly-report-notifications] failed:", error?.message ?? error);
  }
}

/** Reminder to one rep (Tuesday "due today" / Wednesday "overdue"). */
export async function notifyReportReminder(orgId: string, branchId: string, weekStart: string, repIds: string[], when: "due_today" | "overdue"): Promise<void> {
  try {
    if (repIds.length === 0) return;
    const week = weekLabel(weekStart);
    await deliver(orgId, branchId, repIds.map((id) => ({ id, role: "Sales Rep" })), when === "due_today"
      ? {
          title: "Your weekly report is due today",
          message: `Week ${week}: submit it by the end of today (Tuesday).`,
          kind: "weekly_report_due",
          tag: `weekly-report-${weekStart}-due`
        }
      : {
          title: "Your weekly report is overdue",
          message: `Week ${week} was due yesterday. Submit it now; it will be marked late.`,
          kind: "weekly_report_overdue",
          tag: `weekly-report-${weekStart}-overdue`,
          type: "warning"
        });
  } catch (error: any) {
    console.warn("[weekly-report-notifications] reminder failed:", error?.message ?? error);
  }
}

/** Wednesday: tell managers who has not submitted. */
export async function notifyManagersOverdue(orgId: string, branchId: string, weekStart: string, repNames: string[]): Promise<void> {
  try {
    if (repNames.length === 0) return;
    await deliver(orgId, branchId, await leadershipRecipients(orgId, branchId), {
      title: `${repNames.length} weekly report${repNames.length === 1 ? " is" : "s are"} overdue`,
      message: `Week ${weekLabel(weekStart)}: ${repNames.join(", ")} did not submit by Tuesday.`,
      kind: "weekly_report_overdue_summary",
      tag: `weekly-report-${weekStart}-overdue-summary`,
      type: "warning"
    });
  } catch (error: any) {
    console.warn("[weekly-report-notifications] overdue summary failed:", error?.message ?? error);
  }
}

export type FundsEvent =
  | { kind: "adjustment_requested"; managerName: string; amountFrom: number; amountTo: number; weekStart: string }
  | { kind: "adjustment_decided"; managerId: string; approved: boolean; amountTo: number; weekStart: string };

/** Manager Funds & Expenses alerts. */
export async function notifyFunds(orgId: string, branchId: string, event: FundsEvent): Promise<void> {
  try {
    const naira = (value: number) => `\u20a6${Math.round(value).toLocaleString("en-NG")}`;
    const week = weekLabel(event.weekStart);
    if (event.kind === "adjustment_requested") {
      await deliver(orgId, branchId, (await leadershipRecipients(orgId, branchId)).filter((user) => user.role === "Owner"), {
        title: `${event.managerName} asked to change a locked entry`,
        message: `Week ${week}: ${naira(event.amountFrom)} -> ${naira(event.amountTo)}. Needs your decision.`,
        kind: "manager_funds_adjustment",
        tag: `manager-funds-adjustment-${Date.now()}`,
        type: "warning"
      });
      return;
    }
    await deliver(orgId, branchId, [{ id: event.managerId, role: "Manager" }], {
      title: event.approved ? "Your adjustment was approved" : "Your adjustment was rejected",
      message: event.approved ? `Week ${week}: the entry is now ${naira(event.amountTo)}.` : `Week ${week}: the entry stays as it was.`,
      kind: "manager_funds_adjustment_decided",
      tag: `manager-funds-adjustment-decided-${Date.now()}`,
      type: event.approved ? "success" : "info"
    });
  } catch (error: any) {
    console.warn("[weekly-report-notifications] funds alert failed:", error?.message ?? error);
  }
}
