import { supabase } from "./supabase.js";
import { addDaysToDateKey, lagosDateKey } from "./sales-bonus-engine.js";
import { assess, eventsFor, formOrders, kpisOf, ledgerRow, loadHubSettings, type Issue } from "./tracking-hub-data.js";
import { notifyTrackingIssue } from "./weekly-report-notifications.js";

// Tracking Hub alerts (Bright, 2 Oct 2026; Settings → Alert & Notifications).
// Hourly in the day: tells Owners about each issue once per day (deduped in
// tracking_alert_log), only for the kinds switched on. The daily summary goes
// once in the morning.

type Kind = "capiFailures" | "connection" | "duplicatePixel" | "lostParameters";

function kindOf(issue: Issue): Kind | null {
  if (issue.key.startsWith("capi:") || issue.key === "browser:missing") return "capiFailures";
  if (issue.key.startsWith("source:token:") || issue.key.startsWith("source:error:")) return "connection";
  if (issue.key.startsWith("site:") && issue.title === "Duplicate pixel detected") return "duplicatePixel";
  if (issue.key === "params:lost") return "lostParameters";
  return null;
}

/** True the first time this issue is claimed today (the unique index stops repeats). */
async function claim(orgId: string, branchId: string, issueKey: string, day: string) {
  const { error } = await supabase.from("tracking_alert_log").insert({ org_id: orgId, branch_id: branchId, issue_key: issueKey.slice(0, 200), day });
  return !error;
}

export async function runTrackingAlerts(now = new Date()): Promise<{ sent: number }> {
  const hour = Number(now.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Africa/Lagos" }));
  if (hour < 8 || hour > 20) return { sent: 0 };
  const { data: sources, error } = await supabase.from("tracking_data_sources").select("org_id, branch_id");
  if (error) throw error;
  const branches = Array.from(new Map((sources ?? []).map((row: any) => [`${row.org_id}|${row.branch_id}`, row])).values()) as Array<{ org_id: string; branch_id: string }>;
  const today = lagosDateKey(now.toISOString());
  let sent = 0;
  for (const { org_id: orgId, branch_id: branchId } of branches) {
    try {
      const settings = await loadHubSettings(orgId, branchId);
      if (!settings.enabled) continue;
      const assessment = await assess(orgId, branchId);
      for (const issue of assessment.issues) {
        const kind = kindOf(issue);
        if (!kind || !settings.notifications[kind]) continue;
        if (!(await claim(orgId, branchId, issue.key, today))) continue;
        await notifyTrackingIssue(orgId, branchId, { title: issue.title, detail: issue.detail, action: issue.action });
        sent += 1;
      }
      if (settings.notifications.dailySummary && hour >= 8 && (await claim(orgId, branchId, "daily-summary", today))) {
        const yesterday = addDaysToDateKey(today, -1);
        const orders = await formOrders(orgId, branchId, yesterday, yesterday);
        const events = await eventsFor(orgId, orders.map((order) => order.id));
        const k = kpisOf(orders.map((order) => ledgerRow(order, events)));
        await notifyTrackingIssue(orgId, branchId, {
          title: "Yesterday's tracking",
          detail: `${k.orders} form orders, ${k.serverEvents} sent to Meta by the server (${k.serverPct}%), ${k.browserEvents} browser Purchases (${k.browserPct}%), ${k.failed} failed. Health ${assessment.score}%.`,
          action: assessment.issues.length ? `${assessment.issues.length} issue${assessment.issues.length === 1 ? "" : "s"} open in Diagnostics.` : "No open issues."
        });
        sent += 1;
      }
    } catch (error: any) {
      console.warn("[tracking-alerts] branch failed:", branchId, error?.message ?? error);
    }
  }
  return { sent };
}
