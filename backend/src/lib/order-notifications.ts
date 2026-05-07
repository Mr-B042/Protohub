import { supabase } from "./supabase.js";
import { sendPushToUsers } from "./push.js";

type OrderContext = {
  id: string;
  customer: string;
  productName: string;
  assignedRepId?: string | null;
};

const STATUS_CONFIG: Record<string, { type: string; title: string; recipientRoles: string[]; includeRep: boolean }> = {
  New:       { type: "order_new",       title: "New Order",        recipientRoles: ["Owner"], includeRep: true },
  Confirmed: { type: "order_confirmed", title: "Order Confirmed",  recipientRoles: ["Owner"], includeRep: false },
  Delivered: { type: "order_delivered",  title: "Order Delivered",  recipientRoles: ["Owner"], includeRep: true },
  Cancelled: { type: "order_cancelled", title: "Order Cancelled",  recipientRoles: ["Owner"], includeRep: false },
};

/**
 * Create in-app notifications + send push for an order status event.
 * Awaited by the caller but never throws — logs errors internally.
 */
export async function notifyOrderEvent(orgId: string, order: OrderContext, toStatus: string) {
  const config = STATUS_CONFIG[toStatus];
  if (!config) return; // Postponed, Failed, etc. — no notification

  try {
    // Fetch owners (and optionally the assigned rep) in one query
    const recipientIds = new Set<string>();

    const { data: roleUsers } = await supabase
      .from("users")
      .select("id, role")
      .eq("org_id", orgId)
      .eq("active", true)
      .in("role", config.recipientRoles);

    if (roleUsers) {
      for (const u of roleUsers) recipientIds.add(u.id);
    }

    if (config.includeRep && order.assignedRepId) {
      recipientIds.add(order.assignedRepId);
    }

    if (recipientIds.size === 0) return;

    const body = `Order ${order.id} — ${order.customer} (${order.productName})`;
    const link = `/dashboard/admin/orders/${order.id}`;

    const rows = [...recipientIds].map((rid) => ({
      org_id:       orgId,
      recipient_id: rid,
      type:         config.type,
      title:        config.title,
      message:      body,
      link,
      order_id:     order.id,
      read:         false,
    }));

    const { error } = await supabase.from("system_notifications").insert(rows);
    if (error) console.error(`[order-notifications] insert failed for ${order.id}:`, error.message);

    // Fire push notifications (fire-and-forget, don't block the response)
    sendPushToUsers(orgId, [...recipientIds], {
      title: config.title,
      body,
      url: link,
      tag: `order-${order.id}-${toStatus}`,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png"
    }).catch((err) => console.warn("[order-notifications] push send error:", err));
  } catch (err) {
    console.error("[order-notifications] unexpected error:", err);
  }
}
