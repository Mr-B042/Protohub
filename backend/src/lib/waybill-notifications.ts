import { sendPushToUsers } from "./push.js";
import { getOrgPushBranding } from "./push-branding.js";
import { supabase } from "./supabase.js";

type WaybillContext = {
  id: string;
  productName: string;
  quantity: number;
  // For multi-item waybills, a pre-built "Item x3, Item2 x2" label. When set it
  // replaces the single productName x quantity summary.
  itemsLabel?: string | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  carrier?: string | null;
  status?: string | null;
};

type WaybillEvent = "dispatched" | "updated" | "status_changed";

const RECIPIENT_ROLES = ["Owner", "Admin", "Inventory Manager"];

function buildRouteLabel(waybill: WaybillContext): string {
  const route = [waybill.fromLocation, waybill.toLocation].filter(Boolean).join(" -> ");
  return route ? ` | ${route}` : "";
}

function buildEventPayload(waybill: WaybillContext, event: WaybillEvent): { title: string; body: string; tag: string; kind: string } {
  const summary = `${waybill.itemsLabel || `${waybill.productName} x${waybill.quantity}`}${buildRouteLabel(waybill)}`;
  if (event === "dispatched") {
    const carrier = waybill.carrier ? ` via ${waybill.carrier}` : "";
    return {
      title: "Waybill Dispatched",
      body: `Waybill ${waybill.id} was dispatched for ${summary}${carrier}.`,
      tag: `waybill-${waybill.id}-dispatched`,
      kind: "waybill_dispatched"
    };
  }
  if (event === "updated") {
    return {
      title: "Waybill Updated",
      body: `Waybill ${waybill.id} details were updated for ${summary}.`,
      tag: `waybill-${waybill.id}-updated`,
      kind: "waybill_updated"
    };
  }
  const status = waybill.status ?? "updated";
  return {
    title: `Waybill ${status}`,
    body: `Waybill ${waybill.id} is now ${status} for ${summary}.`,
    tag: `waybill-${waybill.id}-${String(status).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    kind: "waybill_status_changed"
  };
}

/**
 * Create recipient-scoped in-app notifications and fire background push for
 * waybill events without blocking the main request path on delivery issues.
 */
export async function notifyWaybillEvent(orgId: string, waybill: WaybillContext, event: WaybillEvent): Promise<void> {
  try {
    const { data: roleUsers } = await supabase
      .from("users")
      .select("id")
      .eq("org_id", orgId)
      .eq("active", true)
      .in("role", RECIPIENT_ROLES);

    const recipientIds = [...new Set((roleUsers ?? []).map((user) => user.id))];
    if (recipientIds.length === 0) return;

    const { title, body, tag, kind } = buildEventPayload(waybill, event);
    const link = "/dashboard/admin/waybill";
    const branding = await getOrgPushBranding(orgId);

    const rows = recipientIds.map((recipientId) => ({
      org_id: orgId,
      recipient_id: recipientId,
      type: "info",
      title,
      message: body,
      link,
      read: false
    }));

    const { error } = await supabase.from("system_notifications").insert(rows);
    if (error) {
      console.error(`[waybill-notifications] insert failed for ${waybill.id}:`, error.message);
    }

    sendPushToUsers(orgId, recipientIds, {
      title,
      body,
      kind,
      url: link,
      tag,
      brandName: branding.brandName,
      brandLogo: branding.brandLogo
    }).catch((err) => console.warn("[waybill-notifications] push send error:", err));
  } catch (err) {
    console.error("[waybill-notifications] unexpected error:", err);
  }
}
