import { sendInternalAbandonedCartEmail } from "./mailer.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUsers } from "./push.js";
import { supabase } from "./supabase.js";

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
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("admin_cart_notifications")
      .eq("id", orgId)
      .single();

    if (orgError || !org?.admin_cart_notifications) return;

    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id")
      .eq("org_id", orgId)
      .eq("active", true)
      .in("role", ["Owner", "Admin"]);

    if (usersError || !users?.length) return;

    const recipientIds = [...new Set(users.map((user) => user.id).filter(Boolean))];
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
    await sendPushToUsers(orgId, recipientIds, {
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
