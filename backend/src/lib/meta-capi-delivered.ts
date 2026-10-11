import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { addDaysToDateKey, lagosDateKey } from "./sales-bonus-engine.js";
import { serverEventsAllowed, withDataSource } from "./tracking-credentials.js";
import { extraPixelsForLink } from "./tracking-extra-pixels.js";
import { deliveredEventTime, fbclidSeenAt, metaIdsFromFormContext, recordMetaCapiEvent, sendMetaCapiDelivered, type MetaTrackingConfig } from "./meta-capi.js";

// The delivered-sale event for Meta (Bright, 1 Oct 2026).
//
// Purchase is sent when an order is created, so it counts every submitted
// order; with pay on delivery a large share never pay. This job sends one
// extra event per order once it is DELIVERED, with the collected amount, so
// ads can be optimised on customers who actually pay.
//
//  - Off unless it is switched on: "Send delivered sales to Meta" in Tracking
//    Hub settings (for the whole branch), or the older per-setting switch
//    "send_delivered_event". Tracking Hub links had no switch at all until
//    11 Oct 2026, so the event had never once been sent.
//  - Goes to the SAME Pixel the order's Purchase went to (one Pixel per
//    sale): the clicked ad set's Pixel when that is where the Purchase was
//    recorded, else the link's main Pixel. A delivered sale on a different
//    Pixel from its Purchase would teach the wrong ad set.
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

type BranchSwitch = { on: boolean; eventName: string };
type ExtraPixel = { pixelId: string; token: string | null; testing: boolean; testEventCode: string | null; paused: boolean };

/** Is the delivered-sale event on for this order, and under which name? */
export function deliveredSwitch(config: { send_delivered_event: boolean; delivered_event_name: string | null }, branch: BranchSwitch | undefined): { on: boolean; eventName: string } {
  const clean = (name: string | null | undefined) => (/^[A-Za-z][A-Za-z0-9_]{1,49}$/.test(String(name ?? "").trim()) ? String(name).trim() : "");
  if (config.send_delivered_event) return { on: true, eventName: clean(config.delivered_event_name) || "OrderDelivered" };
  if (branch?.on) return { on: true, eventName: clean(branch.eventName) || "OrderDelivered" };
  return { on: false, eventName: "OrderDelivered" };
}

/**
 * The Pixel a delivered sale goes to: where the order's Purchase was recorded.
 * If that is one of the link's other Pixels (the clicked ad set's) and it can
 * still send, use it with its own token; otherwise the link's main Pixel.
 */
export function deliveredPixel(
  main: { pixel_id: string | null; access_token: string | null; test_event_code: string | null },
  purchasePixelId: string | null | undefined,
  extras: ExtraPixel[]
): { pixelId: string | null; accessToken: string | null; testEventCode: string | null } {
  const mainTarget = { pixelId: main.pixel_id, accessToken: main.access_token, testEventCode: main.test_event_code };
  if (!purchasePixelId || purchasePixelId === main.pixel_id) return mainTarget;
  const extra = extras.find((pixel) => pixel.pixelId === purchasePixelId);
  if (!extra || !extra.token || extra.paused) return mainTarget;
  return { pixelId: extra.pixelId, accessToken: extra.token, testEventCode: extra.testing ? extra.testEventCode : null };
}

export async function runMetaDeliveredEvents(): Promise<{ sent: number; skipped: number }> {
  // Branches with "Send delivered sales to Meta" on in Tracking Hub settings.
  const { data: settingRows, error: settingsError } = await supabase.from("tracking_settings").select("org_id, branch_id, settings");
  if (settingsError) throw settingsError;
  const branchSwitch = new Map<string, BranchSwitch>();
  for (const row of settingRows ?? []) {
    const settings = (row.settings ?? {}) as { sendDelivered?: boolean; deliveredEventName?: string };
    if (settings.sendDelivered === true) branchSwitch.set(String(row.branch_id), { on: true, eventName: String(settings.deliveredEventName ?? "") });
  }
  let configQuery = supabase.from("meta_capi_configs")
    .select("org_id, branch_id, tracking_key, pixel_id, access_token, test_event_code, delivered_event_name, active, send_delivered_event, data_source_id")
    .eq("active", true);
  // Nothing switched on at branch level: only settings with their own switch matter.
  if (branchSwitch.size === 0) configQuery = configQuery.eq("send_delivered_event", true);
  const { data: configs, error } = await configQuery;
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
      .select("id, org_id, branch_id, customer, phone, email, city, state, amount, currency, product_id, product_name, package_id, package_name, quantity, delivered_date, review_hold, form_context, created_at")
      .eq("org_id", orgId).eq("status", "Delivered").gte("delivered_date", since)
      .order("delivered_date", { ascending: true }).limit(500);
    if (orderError) throw orderError;
    const candidates = (orders ?? []).filter((order: any) => order.review_hold !== true && order.form_context && Object.keys(order.form_context).length > 0);
    if (candidates.length === 0) continue;

    const ids = candidates.map((order: any) => String(order.id));
    const done = new Map<string, { status: string; attempts: number }>();
    const purchasePixel = new Map<string, string>();
    const extrasByKey = new Map<string, ExtraPixel[]>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: events, error: eventsError } = await supabase.from("meta_capi_events").select("order_id, event_name, status, attempts, pixel_id")
        .eq("org_id", orgId).in("event_name", ["Delivered", "Purchase"]).in("order_id", ids.slice(i, i + 200));
      if (eventsError) throw eventsError;
      for (const event of events ?? []) {
        if (event.event_name === "Delivered") done.set(String(event.order_id), { status: event.status, attempts: Number(event.attempts ?? 1) });
        else if (event.pixel_id) purchasePixel.set(String(event.order_id), String(event.pixel_id));
      }
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
      const switched = deliveredSwitch(config, branchSwitch.get(String(order.branch_id)));
      if (!switched.on) { skipped += 1; continue; }
      if (!(await serverEventsAllowed(orgId, order.branch_id, "Delivered"))) { skipped += 1; continue; }

      // The Pixel this order's Purchase went to.
      const purchasePixelId = purchasePixel.get(String(order.id)) ?? null;
      let extras = extrasByKey.get(config.tracking_key);
      if (!extras && purchasePixelId && purchasePixelId !== config.pixel_id) {
        extras = (await extraPixelsForLink(orgId, config.tracking_key, config.pixel_id)) as ExtraPixel[];
        extrasByKey.set(config.tracking_key, extras);
      }
      const target = deliveredPixel(config, purchasePixelId, extras ?? []);
      if (!target.pixelId || !target.accessToken) { skipped += 1; continue; }

      const metaConfig: MetaTrackingConfig = {
        mode: "hybrid", pixelId: target.pixelId, accessToken: target.accessToken,
        testEventCode: target.testEventCode ?? undefined, testMode: Boolean(target.testEventCode)
      };
      const ids = metaIdsFromFormContext(context);
      const eventName = switched.eventName;
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
        fbp: ids.fbp, fbc: ids.fbc, fbclid: ids.fbclid, fbclidSeenAtMs: fbclidSeenAt(context, order.created_at),
        visitorId: ids.visitorId,
        value, currency, orderId: String(order.id),
        productId: String(order.product_id ?? ""), productName: String(order.product_name ?? ""),
        packageId: String(order.package_id ?? ""), packageName: String(order.package_name ?? ""),
        quantity: Number(order.quantity) || 1
      });
      await recordMetaCapiEvent(supabase, {
        orgId, branchId: order.branch_id, orderId: String(order.id), eventName: "Delivered", metaEventName: eventName, eventId,
        result, testMode: Boolean(target.testEventCode), pixelId: target.pixelId, value, currency
      });
      if (result.status === "sent" || result.status === "dry_run") sent += 1;
    }
  }
  if (sent > 0) logger.info("meta-capi: delivered events sent", { sent, skipped });
  return { sent, skipped };
}
