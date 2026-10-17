import { supabase } from "./supabase.js";
import { addDaysToDateKey, lagosDateKey, sundayWeekStartForDateKey } from "./sales-bonus-engine.js";
import { deliver } from "./weekly-report-notifications.js";

// ── Low delivery rate → tell the Head of Sales (Bright, 17 Oct 2026) ────────
// "If any sales rep has a [low] delivery rate, notify her to push them."
// Every day at 10:00 Lagos, Monday to Saturday, the Head of Sales of each
// branch gets up to two alerts: reps under 60% (urgent - they lose half of
// everything, base included) and reps from 60% to under 65% (they lose half
// of their upsell and cross-sell). Same rate as the weekly bonus rule and the
// Manager Dashboard: this week's orders that are delivered.
//
// Fairness: an order placed an hour ago cannot be delivered yet, so only
// orders placed at least 48 hours ago count, and a rep is judged only once
// they have 10 such orders this week. Monday 10:00 therefore usually sends
// nothing; the week is judged from Tuesday.

const WARN_BELOW = 65;
const URGENT_BELOW = 60;
const MIN_AGED_ORDERS = 10;
const AGE_HOURS = 48;
const LINK = "/dashboard/admin/head-of-sales-rep";

export type RepDeliveryLine = { repId: string; name: string; counted: number; delivered: number; rate: number; notDelivered: number };

/** Pure: which reps go in which alert. */
export function sortRepsByRate(lines: RepDeliveryLine[]) {
  const judged = lines.filter((line) => line.counted >= MIN_AGED_ORDERS);
  const byRate = (a: RepDeliveryLine, b: RepDeliveryLine) => a.rate - b.rate;
  return {
    urgent: judged.filter((line) => line.rate < URGENT_BELOW).sort(byRate),
    warning: judged.filter((line) => line.rate >= URGENT_BELOW && line.rate < WARN_BELOW).sort(byRate)
  };
}

const lineText = (line: RepDeliveryLine) => `${line.name} ${line.rate}% (${line.notDelivered} of ${line.counted} not delivered)`;

export async function runHeadOfSalesDeliveryAlerts(now = new Date()): Promise<{ branches: number; alerts: number }> {
  const today = lagosDateKey(now);
  const weekStart = sundayWeekStartForDateKey(today);
  const cutoff = new Date(now.getTime() - AGE_HOURS * 60 * 60 * 1000).toISOString();
  const { data: branches, error } = await supabase.from("branches").select("id, org_id").eq("active", true);
  if (error) throw error;
  let alerts = 0;
  for (const branch of branches ?? []) {
    try {
      const [{ data: heads }, { data: members }, { data: reps }] = await Promise.all([
        supabase.from("users").select("id, name").eq("org_id", branch.org_id).eq("active", true).eq("is_head_of_sales_rep", true),
        supabase.from("branch_memberships").select("user_id").eq("branch_id", branch.id),
        supabase.from("users").select("id, name").eq("org_id", branch.org_id).eq("active", true).eq("is_demo", false).eq("role", "Sales Rep")
      ]);
      const inBranch = new Set((members ?? []).map((row: any) => row.user_id as string));
      const head = (heads ?? []).find((row: any) => inBranch.has(row.id));
      if (!head) continue;
      const branchReps = (reps ?? []).filter((row: any) => inBranch.has(row.id));
      if (branchReps.length === 0) continue;
      // Orders placed this week (Lagos), at least 48 hours ago, not held for review.
      const { data: orders, error: ordersError } = await supabase.from("orders")
        .select("assigned_rep_id, status, review_hold")
        .eq("org_id", branch.org_id).eq("branch_id", branch.id)
        .in("assigned_rep_id", branchReps.map((row: any) => row.id))
        .gte("created_at", `${weekStart}T00:00:00+01:00`)
        .lt("created_at", `${addDaysToDateKey(weekStart, 7)}T00:00:00+01:00`)
        .lte("created_at", cutoff)
        .limit(20000);
      if (ordersError) throw ordersError;
      const lines: RepDeliveryLine[] = branchReps.map((rep: any) => {
        const own = (orders ?? []).filter((row: any) => row.assigned_rep_id === rep.id && row.review_hold !== true);
        const delivered = own.filter((row: any) => row.status === "Delivered").length;
        return {
          repId: rep.id, name: String(rep.name ?? "A rep"), counted: own.length, delivered,
          rate: own.length > 0 ? Math.round((delivered / own.length) * 100) : 0,
          notDelivered: own.length - delivered
        };
      });
      const { urgent, warning } = sortRepsByRate(lines);
      const recipient = [{ id: head.id as string, role: "Sales Rep" }];
      if (urgent.length > 0) {
        await deliver(branch.org_id, branch.id, recipient, {
          title: `Urgent: ${urgent.length} rep${urgent.length === 1 ? "" : "s"} under 60% delivery this week`,
          message: `${urgent.map(lineText).join(" · ")}. Under 60% they lose half of their whole bonus. Push their open orders today.`,
          kind: "hos_delivery_urgent",
          tag: `hos-delivery-urgent-${today}`,
          type: "warning",
          link: LINK
        });
        alerts += 1;
      }
      if (warning.length > 0) {
        await deliver(branch.org_id, branch.id, recipient, {
          title: `${warning.length} rep${warning.length === 1 ? "" : "s"} under 65% delivery this week`,
          message: `${warning.map(lineText).join(" · ")}. Under 65% they lose half of their upsell and cross-sell bonus. Help them close their open orders.`,
          kind: "hos_delivery_warning",
          tag: `hos-delivery-warning-${today}`,
          type: "warning",
          link: LINK
        });
        alerts += 1;
      }
    } catch (branchError: any) {
      console.warn("[hos-delivery-alerts] branch failed:", branch.id, branchError?.message ?? branchError);
    }
  }
  return { branches: (branches ?? []).length, alerts };
}
