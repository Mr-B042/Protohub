import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUser } from "./push.js";

// Reminders for a Recovery Rep's scheduled next actions.
//
// ⚠️ The existing order follow-up notifier does NOT cover these, for two
// separate reasons, and both had to be true for the gap to exist:
//   - it selects on status in (Confirmed, In Process, Dispatched, Postponed),
//     which excludes Failed and Cancelled - i.e. every order a Recovery Rep
//     owns
//   - it fires on scheduled_at / scheduled_date, the DELIVERY schedule, not on
//     next_follow_up_at, which is what a recovery callback is booked against
//
// So a rep could promise a customer a call back on Thursday and nothing
// anywhere would remind them. Delight had twelve of those, all overdue.

const RECOVERY_NEXT_ACTION_TYPE = "recovery_next_action";

/** How far past due to keep nagging. Beyond this the Next actions list owns it. */
const OVERDUE_GRACE_HOURS = 48;

export type DueNextAction = {
  id: string;
  customer: string;
  phone?: string | null;
  assigned_rep_id?: string | null;
  product_name?: string | null;
  next_follow_up_at: string;
  status: string;
};

const trim = (value: string, max = 180) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/**
 * One reminder per order per due time.
 *
 * ⚠️ Keyed on the DUE TIMESTAMP, not just the order. Re-scheduling a callback
 * has to be able to remind again, while a job running every ten minutes must
 * not send ten reminders for the same promise.
 */
async function alreadyReminded(orgId: string, recipientId: string, orderId: string, dueIso: string) {
  const { data } = await supabase.from("system_notifications")
    .select("id")
    .eq("org_id", orgId)
    .eq("recipient_id", recipientId)
    .eq("order_id", orderId)
    .eq("type", RECOVERY_NEXT_ACTION_TYPE)
    .ilike("message", `%${dueIso.slice(0, 16)}%`)
    .limit(1);
  return (data ?? []).length > 0;
}

export async function syncRecoveryNextActionReminders(limitPerOrg = 500) {
  const { data: orgRows, error } = await supabase.from("organizations").select("id");
  if (error) {
    logger.error("recovery next-action org query failed", { error: error.message });
    return { sent: 0 };
  }

  const now = Date.now();
  const graceFrom = new Date(now - OVERDUE_GRACE_HOURS * 3600_000).toISOString();
  const dueUntil = new Date(now).toISOString();
  let sent = 0;

  for (const org of orgRows ?? []) {
    const orgId = org.id as string;

    // Only reps who actually hold recovery work, so the reminder cannot be
    // sent to someone who has no way to action it.
    const { data: repRows } = await supabase.from("users")
      .select("id, name").eq("org_id", orgId).eq("role", "Recovery Rep").eq("active", true);
    const repIds = ((repRows ?? []) as any[]).map((row) => row.id as string);
    if (repIds.length === 0) continue;

    const { data: orders, error: orderError } = await supabase.from("orders")
      .select("id, customer, phone, assigned_rep_id, product_name, next_follow_up_at, status")
      .eq("org_id", orgId)
      .in("assigned_rep_id", repIds)
      .neq("status", "Delivered")
      .not("next_follow_up_at", "is", null)
      .gte("next_follow_up_at", graceFrom)
      .lte("next_follow_up_at", dueUntil)
      .limit(limitPerOrg);
    if (orderError) {
      logger.warn("recovery next-action order query failed", { orgId, error: orderError.message });
      continue;
    }

    const branding = await getOrgPushBranding(orgId);

    for (const order of (orders ?? []) as DueNextAction[]) {
      const repId = order.assigned_rep_id;
      if (!repId) continue;
      const dueIso = order.next_follow_up_at;
      if (await alreadyReminded(orgId, repId, order.id, dueIso)) continue;

      const dueAt = new Date(dueIso);
      const overdueHours = Math.floor((now - dueAt.getTime()) / 3600_000);
      const whenLabel = dueAt.toLocaleString("en-NG", {
        weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit"
      });
      const title = overdueHours >= 1
        ? `Callback overdue · #${order.id}`
        : `Callback due now · #${order.id}`;
      const message = trim([
        order.customer,
        order.product_name ?? "",
        `promised ${whenLabel}`,
        overdueHours >= 1 ? `${overdueHours}h late` : null,
        dueIso.slice(0, 16)
      ].filter(Boolean).join(" · "));

      const { error: insertError } = await supabase.from("system_notifications").insert({
        org_id: orgId,
        recipient_id: repId,
        type: RECOVERY_NEXT_ACTION_TYPE,
        title,
        message,
        link: "#/dashboard/recovery-rep",
        order_id: order.id,
        read: false
      });
      if (insertError) {
        logger.warn("recovery next-action insert failed", { orgId, orderId: order.id, error: insertError.message });
        continue;
      }
      sent += 1;

      // Push is best-effort. A failed push must never stop the in-app
      // notification that was already written.
      await sendPushToUser(orgId, repId, {
        title,
        body: message,
        kind: RECOVERY_NEXT_ACTION_TYPE,
        url: "#/dashboard/recovery-rep",
        tag: `recovery-next-action-${order.id}-${dueIso}`,
        brandName: branding.brandName,
        brandLogo: branding.brandLogo
      }).catch((pushError) => {
        logger.warn("recovery next-action push failed", {
          orgId, orderId: order.id, recipientId: repId,
          error: pushError instanceof Error ? pushError.message : String(pushError)
        });
      });
    }
  }

  return { sent };
}
