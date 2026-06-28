import { supabase } from "./supabase.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUser } from "./push.js";

type OrderContext = {
  id: string;
  customer: string;
  productName: string;
  packageName?: string | null;
  phone?: string | null;
  amount?: number | null;
  currency?: string | null;
  assignedRepId?: string | null;
};

const orderDisplayName = (order: OrderContext) =>
  order.packageName?.trim()
    ? `${order.productName} — ${order.packageName}`
    : order.productName;

const formatNotificationMoney = (amount?: number | null, currency?: string | null) => {
  if (typeof amount !== "number" || Number.isNaN(amount)) return null;
  const safeCurrency = currency?.trim() || "NGN";
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `${safeCurrency} ${Math.round(amount).toLocaleString("en-NG")}`;
  }
};

const orderLinkForRole = (role: string, orderId: string) =>
  role === "Sales Rep"
    ? `/dashboard/sales-rep/orders/${orderId}`
    : `/dashboard/admin/orders/${orderId}`;

const orderNotificationSummary = (order: OrderContext) => {
  const customer = order.phone?.trim()
    ? `${order.customer} (${order.phone.trim()})`
    : order.customer;
  return [
    customer,
    orderDisplayName(order),
    formatNotificationMoney(order.amount, order.currency)
  ].filter(Boolean).join(" · ");
};

const STATUS_CONFIG: Record<string, { type: string; title: string; recipientRoles: string[]; includeRep: boolean }> = {
  New:          { type: "order_new",          title: "New Order",          recipientRoles: ["Owner", "Admin"], includeRep: true },
  Confirmed:    { type: "order_confirmed",    title: "Order Confirmed",    recipientRoles: ["Owner"], includeRep: false },
  Delivered:    { type: "order_delivered",    title: "Order Delivered",    recipientRoles: ["Owner"], includeRep: true },
  Cancelled:    { type: "order_cancelled",    title: "Order Cancelled",    recipientRoles: ["Owner"], includeRep: false },
  Failed:       { type: "order_failed",       title: "Order Failed",       recipientRoles: ["Owner"], includeRep: false },
  Rescheduled:  { type: "order_rescheduled",  title: "Order Rescheduled",  recipientRoles: ["Owner"], includeRep: true },
  Assigned:     { type: "order_assigned",     title: "Order Assigned",     recipientRoles: [],        includeRep: true },
};

/**
 * Create in-app notifications + send push for an order status event.
 * Awaited by the caller but never throws — logs errors internally.
 */
export async function notifyOrderEvent(orgId: string, order: OrderContext, toStatus: string) {
  const config = STATUS_CONFIG[toStatus];
  if (!config) return; // Postponed and other untracked statuses — no notification

  try {
    // Fetch owners (and optionally the assigned rep) in one query
    const recipients = new Map<string, string>();

    const { data: roleUsers } = await supabase
      .from("users")
      .select("id, role")
      .eq("org_id", orgId)
      .eq("active", true)
      .in("role", config.recipientRoles);

    if (roleUsers) {
      for (const u of roleUsers) recipients.set(u.id, u.role);
    }

    if (config.includeRep && order.assignedRepId && !recipients.has(order.assignedRepId)) {
      const { data: repUser } = await supabase
        .from("users")
        .select("id, role")
        .eq("org_id", orgId)
        .eq("active", true)
        .eq("id", order.assignedRepId)
        .maybeSingle();
      if (repUser?.id) recipients.set(repUser.id, repUser.role);
    }

    if (recipients.size === 0) return;

    const title = `${config.title} #${order.id}`;
    const body = orderNotificationSummary(order);
    const branding = await getOrgPushBranding(orgId);

    const rows = [...recipients.entries()].map(([recipientId, role]) => ({
      org_id:       orgId,
      recipient_id: recipientId,
      type:         config.type,
      title,
      message:      body,
      link:         orderLinkForRole(role, order.id),
      order_id:     order.id,
      read:         false,
    }));

    const { error } = await supabase.from("system_notifications").insert(rows);
    if (error) console.error(`[order-notifications] insert failed for ${order.id}:`, error.message);

    // Fire push notifications (fire-and-forget, don't block the response)
    await Promise.all(
      [...recipients.entries()].map(([recipientId, role]) =>
        sendPushToUser(orgId, recipientId, {
          title,
          body,
          kind: config.type,
          url: orderLinkForRole(role, order.id),
          tag: `order-${order.id}-${toStatus}`,
          brandName: branding.brandName,
          brandLogo: branding.brandLogo
        }).catch((err) => console.warn("[order-notifications] push send error:", err))
      )
    );
  } catch (err) {
    console.error("[order-notifications] unexpected error:", err);
  }
}

/**
 * Alert Owners/Admins (+ the assigned rep) that an order was RECOVERED from an
 * outage capture — it came in while the API was down and was reconciled later, so
 * there was no live confirmation at submit time. Distinct title so it stands out
 * from a normal "New Order"; uses the order_new type so the client renders it with
 * the order link. In-app notification + push. Never throws.
 */
export async function notifyOutageRecoveredOrder(orgId: string, order: OrderContext) {
  try {
    const recipients = new Map<string, string>();
    const { data: roleUsers } = await supabase
      .from("users")
      .select("id, role")
      .eq("org_id", orgId)
      .eq("active", true)
      .in("role", ["Owner", "Admin"]);
    if (roleUsers) {
      for (const u of roleUsers) recipients.set(u.id, u.role);
    }
    if (order.assignedRepId && !recipients.has(order.assignedRepId)) {
      const { data: repUser } = await supabase
        .from("users")
        .select("id, role")
        .eq("org_id", orgId)
        .eq("active", true)
        .eq("id", order.assignedRepId)
        .maybeSingle();
      if (repUser?.id) recipients.set(repUser.id, repUser.role);
    }
    if (recipients.size === 0) return;

    const title = `⚡ Recovered Order #${order.id}`;
    const body = `${orderNotificationSummary(order)} — came in during a system outage. Please verify with the customer before dispatch.`;
    const branding = await getOrgPushBranding(orgId);

    const rows = [...recipients.entries()].map(([recipientId, role]) => ({
      org_id:       orgId,
      recipient_id: recipientId,
      type:         "order_new",
      title,
      message:      body,
      link:         orderLinkForRole(role, order.id),
      order_id:     order.id,
      read:         false,
    }));
    const { error } = await supabase.from("system_notifications").insert(rows);
    if (error) console.error(`[order-notifications] outage-recovered insert failed for ${order.id}:`, error.message);

    await Promise.all(
      [...recipients.entries()].map(([recipientId, role]) =>
        sendPushToUser(orgId, recipientId, {
          title,
          body,
          kind: "order_new",
          url: orderLinkForRole(role, order.id),
          tag: `order-${order.id}-outage-recovered`,
          brandName: branding.brandName,
          brandLogo: branding.brandLogo
        }).catch((err) => console.warn("[order-notifications] outage push error:", err))
      )
    );
  } catch (err) {
    console.error("[order-notifications] notifyOutageRecoveredOrder failed:", err);
  }
}
