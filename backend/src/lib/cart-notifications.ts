import { sendInternalAbandonedCartEmail } from "./mailer.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUsers } from "./push.js";
import { supabase } from "./supabase.js";
import { alertRecipients } from "./notification-routing.js";

type AbandonedCartAlertContext = {
  id: string;
  customer: string;
  phone: string;
  product_name: string;
  package_name?: string | null;
  amount: number;
  currency: string;
  source?: string | null;
};

const cartDisplayName = (cart: AbandonedCartAlertContext) =>
  cart.package_name?.trim()
    ? `${cart.product_name} — ${cart.package_name}`
    : cart.product_name;

const formatCartMoney = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: currency?.trim() || "NGN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-NG")}`;
  }
};

export async function notifyNewAbandonedCart(orgId: string, cart: AbandonedCartAlertContext) {
  try {
    // Who gets it is the Owner's choice in Settings → Alert routing (the old
    // "Notify admins on new abandoned carts" switch is its default).
    const { recipients, push } = await alertRecipients(orgId, "cart_new");
    const recipientIds = [...recipients.keys()];
    if (!recipientIds.length) return;

    const title = `New Abandoned Cart #${cart.id}`;
    const message = [
      cart.phone?.trim() ? `${cart.customer} (${cart.phone.trim()})` : cart.customer,
      cartDisplayName(cart),
      formatCartMoney(cart.amount, cart.currency)
    ].filter(Boolean).join(" · ");
    const link = `/dashboard/admin/abandoned-carts/${cart.id}`;

    const rows = recipientIds.map((recipientId) => ({
      org_id: orgId,
      recipient_id: recipientId,
      type: "info",
      title,
      message,
      link,
      read: false
    }));

    const { error: notificationError } = await supabase.from("system_notifications").insert(rows);
    if (notificationError) {
      console.warn("[cart-notifications] insert failed:", notificationError.message);
    }

    const branding = await getOrgPushBranding(orgId);
    if (push) await sendPushToUsers(orgId, recipientIds, {
      title,
      body: message,
      kind: "abandoned_cart_new",
      url: link,
      tag: `abandoned-cart-${cart.id}`,
      brandName: branding.brandName,
      brandLogo: branding.brandLogo
    });

    await sendInternalAbandonedCartEmail(orgId, cart);
  } catch (err) {
    console.warn("[cart-notifications] abandoned cart alert error:", err);
  }
}

/**
 * A cart was handed to a rep by the automatic rotation.
 *
 * ⚠️ NOT THE SAME THING AS sendCartAssignedSms. That one texts the CUSTOMER to
 * say somebody will call. This is the internal one Bright asked for: the Owner,
 * Admins and Managers see that a cart landed on a rep, and the rep sees it too.
 *
 * ⚠️ NOT GATED ON admin_cart_notifications, unlike the alert above. That switch
 * controls how loud the "a cart was abandoned" firehose is. This fires once per
 * cart, only when work has actually been handed to a named person, and it is
 * the alert a manager needs in order to chase - silencing it with the firehose
 * would hide the one message that carries an owner and a deadline.
 *
 * Never throws: a cart that could not be announced is still a cart that was
 * assigned, and losing the assignment over a failed push would be far worse.
 */
export async function notifyCartAssignedToRep(
  orgId: string,
  cart: AbandonedCartAlertContext & { assignedRepId: string; assignedRepName: string }
) {
  try {
    const { recipients, push } = await alertRecipients(orgId, "cart_assigned", cart.assignedRepId);
    if (recipients.size === 0) return;

    const title = `Cart assigned to ${cart.assignedRepName || "a sales rep"}`;
    const message = [
      cart.phone?.trim() ? `${cart.customer} (${cart.phone.trim()})` : cart.customer,
      cartDisplayName(cart),
      formatCartMoney(cart.amount, cart.currency)
    ].filter(Boolean).join(" · ") + " — call within 10 minutes.";

    const linkFor = (role: string) =>
      role === "Sales Rep"
        ? "/dashboard/sales-rep/abandoned-carts"
        : `/dashboard/admin/abandoned-carts/${cart.id}`;

    const rows = [...recipients.entries()].map(([recipientId, role]) => ({
      org_id: orgId,
      recipient_id: recipientId,
      type: "info",
      title,
      message,
      link: linkFor(role),
      read: false
    }));
    const { error } = await supabase.from("system_notifications").insert(rows);
    if (error) console.warn("[cart-notifications] assigned insert failed:", error.message);

    const branding = await getOrgPushBranding(orgId);
    if (push) await Promise.all([...recipients.entries()].map(([recipientId, role]) =>
      sendPushToUsers(orgId, [recipientId], {
        title,
        body: message,
        kind: "abandoned_cart_assigned",
        url: linkFor(role),
        tag: `abandoned-cart-assigned-${cart.id}`,
        brandName: branding.brandName,
        brandLogo: branding.brandLogo
      }).catch((err) => console.warn("[cart-notifications] assigned push error:", err))
    ));
  } catch (err) {
    console.warn("[cart-notifications] assigned alert error:", err);
  }
}
