import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { addDaysToDateKey, lagosDateKey } from "./sales-bonus-engine.js";
import { withDataSource } from "./tracking-credentials.js";
import { deliveredEventTime, metaIdsFromFormContext, recordMetaCapiEvent, sendMetaCapiDelivered, type MetaTrackingConfig } from "./meta-capi.js";

// The delivered-sale event for Meta (Bright, 1 Oct 2026).
//
// Purchase is sent when an order is created, so it counts every submitted
// order; with pay on delivery a large share never pay. This job sends one
// extra event per order once it is DELIVERED, with the collected amount, so
// ads can be optimised on customers who actually pay.
//
//  - Off unless a Meta setting has "send_delivered_event" switched on.
//  - Only orders that came through a Protohub form (they carry the ad ids).
//  - Meta only accepts events up to 7 days old, so only orders delivered in
//    the last 7 days.
//  - One per order: meta_capi_events remembers it. A failed send is retried
//    on later runs, up to 3 attempts.
// Runs every 10 minutes from index.ts. Not branch-scoped (background job).

const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set(["failed", "missing_config"]);

type ConfigRow = {
  org_id: string; branch_id: string | null; tracking_key: string; pixel_id: string | null; access_token: string | null;
  test_event_code: string | null; delivered_event_name: string | null; active: boolean; send_delivered_event: boolean;
};

export async function runMetaDeliveredEvents(): Promise<{ sent: number; skipped: number }> {
  const { data: configs, error } = await supabase.from("meta_capi_configs")
    .select("org_id, branch_id, tracking_key, pixel_id, access_token, test_event_code, delivered_event_name, active, send_delivered_event, data_source_id")
    .eq("active", true).eq("send_delivered_event", true);
  if (error) throw error;
  // Tracking Hub links take their Pixel + token from their data source.
  const resolved = await Promise.all(((configs ?? []) as ConfigRow[]).map((row) => withDataSource(row as any)));
  const usable = (resolved.filter(Boolean) as ConfigRow[]).filter((row) => row.pixel_id && row.access_token);
  if (usable.length === 0) return { sent: 0, skipped: 0 };

  const since = addDaysToDateKey(lagosDateKey(), -6);
  let sent = 0;
  let skipped = 0;
  for (const orgId of Array.from(new Set(usable.map((row) => row.org_id)))) {
    const orgConfigs = usable.filter((row) => row.org_id === orgId);
    const { data: orders, error: orderError } = await supabase.from("orders")
      .select("id, org_id, branch_id, customer, phone, email, city, state, amount, currency, product_id, product_name, package_id, package_name, quantity, delivered_date, review_hold, form_context")
      .eq("org_id", orgId).eq("status", "Delivered").gte("delivered_date", since)
      .order("delivered_date", { ascending: true }).limit(500);
    if (orderError) throw orderError;
    const candidates = (orders ?? []).filter((order: any) => order.review_hold !== true && order.form_context && Object.keys(order.form_context).length > 0);
    if (candidates.length === 0) continue;

    const ids = candidates.map((order: any) => String(order.id));
    const done = new Map<string, { status: string; attempts: number }>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: events } = await supabase.from("meta_capi_events").select("order_id, status, attempts")
        .eq("org_id", orgId).eq("event_name", "Delivered").in("order_id", ids.slice(i, i + 200));
      for (const event of events ?? []) done.set(String(event.order_id), { status: event.status, attempts: Number(event.attempts ?? 1) });
    }

    for (const order of candidates as any[]) {
      const previous = done.get(String(order.id));
      if (previous && (!RETRYABLE.has(previous.status) || previous.attempts >= MAX_ATTEMPTS)) { skipped += 1; continue; }
      const context = order.form_context as Record<string, unknown>;
      const key = String(context.metaTrackingKey ?? "").trim().toLowerCase();
      const sameBranch = (row: ConfigRow) => !row.branch_id || row.branch_id === order.branch_id;
      const config = (key ? orgConfigs.find((row) => row.tracking_key === key && sameBranch(row)) : undefined)
        ?? orgConfigs.find((row) => row.tracking_key === "__default__" && sameBranch(row));
      if (!config) { skipped += 1; continue; }

      const metaConfig: MetaTrackingConfig = {
        mode: "hybrid", pixelId: config.pixel_id ?? undefined, accessToken: config.access_token ?? undefined,
        testEventCode: config.test_event_code ?? undefined, testMode: Boolean(config.test_event_code)
      };
      const ids = metaIdsFromFormContext(context);
      const eventName = (config.delivered_event_name ?? "").trim() || "OrderDelivered";
      const eventId = `protohub_delivered_${order.id}`;
      const value = Number(order.amount) || 0;
      const currency = String(order.currency ?? "NGN");
      const pageUrl = typeof context.landingPageUrl === "string" && context.landingPageUrl ? context.landingPageUrl
        : typeof context.landingUrl === "string" ? context.landingUrl : null;
      const result = await sendMetaCapiDelivered({
        config: metaConfig, eventName, eventId, eventTime: deliveredEventTime(order.delivered_date),
        eventSourceUrl: pageUrl, clientIp: null,
        userAgent: typeof context.userAgent === "string" ? context.userAgent : null,
        customer: String(order.customer ?? ""), phone: String(order.phone ?? ""), email: order.email ?? null,
        city: order.city ?? null, state: order.state ?? null, country: "ng",
        fbp: ids.fbp, fbc: ids.fbc, fbclid: ids.fbclid,
        value, currency, orderId: String(order.id),
        productId: String(order.product_id ?? ""), productName: String(order.product_name ?? ""),
        packageId: String(order.package_id ?? ""), packageName: String(order.package_name ?? ""),
        quantity: Number(order.quantity) || 1
      });
      await recordMetaCapiEvent(supabase, {
        orgId, branchId: order.branch_id, orderId: String(order.id), eventName: "Delivered", metaEventName: eventName, eventId,
        result, testMode: Boolean(config.test_event_code), value, currency
      });
      if (result.status === "sent" || result.status === "dry_run") sent += 1;
    }
  }
  if (sent > 0) logger.info("meta-capi: delivered events sent", { sent, skipped });
  return { sent, skipped };
}
