export type PushPolicyInput = {
  title?: string;
  kind?: string;
  tag?: string;
  timestamp?: number;
};

export type PushDeliveryPolicy = {
  /** The kind of alert. A label only - since 30 Sept it no longer collapses anything. */
  collapseGroup: "orders" | "customer" | "operations" | "general";
  ttlSeconds: number;
};

/**
 * ⚠️ DELIVER LIKE WHATSAPP, NOT "NEWEST ONLY" (Bright, 30 Sept 2026: "oldens
 * wont pop up rather the recent ones ... is not working as whatsapp").
 *
 * From 9 Aug to 30 Sept three rules thinned alerts out:
 *   - an alert for an offline phone expired after 30-60 minutes;
 *   - while offline, the push service kept only the NEWEST alert of each type
 *     (web push Topic / FCM collapseKey / APNs collapse-id);
 *   - each type had 4 tray places, so a new alert replaced an older one.
 * With data off for an hour, the older alerts never arrived at all.
 *
 * Now every alert waits up to 24 hours, nothing is collapsed, and each alert
 * takes the next of 40 tray places on that phone - so the 41st replaces the
 * oldest, never a recent one. 40 stays under Android's cap of about 50 live
 * notifications per app, past which it silently stops showing new ones (the
 * reason for the old limits). 24 hours, not the four weeks that preceded 9 Aug,
 * so a phone switched off for days does not wake to last week's orders.
 */
export const ALERT_TTL_SECONDS = 24 * 60 * 60;
export const TRAY_PLACES = 40;
const TRAY_TAG_PATTERN = /^protohub-slot-\d{1,2}$/;

const ORDER_KINDS = new Set([
  "order_new",
  "order_assigned",
  "order_confirmed",
  "order_delivered",
  "order_failed",
  "order_cancelled",
  "order_rescheduled"
]);

const CUSTOMER_KINDS = new Set([
  "abandoned_cart_new",
  "order_follow_up",
  "stale_carts"
]);

const OPERATIONS_KINDS = new Set([
  "low_stock",
  "remittance_overdue",
  "needs_attention",
  "waybill_dispatched",
  "waybill_updated",
  "waybill_status_changed"
]);

export function deliveryPolicyForPush(payload: PushPolicyInput): PushDeliveryPolicy {
  const kind = String(payload.kind ?? "info").trim().toLowerCase();

  if (kind === "test_push") {
    return { collapseGroup: "general", ttlSeconds: 2 * 60 };
  }
  if (ORDER_KINDS.has(kind)) return { collapseGroup: "orders", ttlSeconds: ALERT_TTL_SECONDS };
  if (CUSTOMER_KINDS.has(kind)) return { collapseGroup: "customer", ttlSeconds: ALERT_TTL_SECONDS };
  if (OPERATIONS_KINDS.has(kind)) return { collapseGroup: "operations", ttlSeconds: ALERT_TTL_SECONDS };
  return { collapseGroup: "general", ttlSeconds: ALERT_TTL_SECONDS };
}

/**
 * The tray place for the next alert on ONE phone (a web push endpoint or a
 * native device). Places are taken in turn, so an alert only ever replaces the
 * one 40 alerts older.
 *
 * Kept in memory: after a server restart the count starts at a time-derived
 * place rather than 0, so the first alerts do not all land on the same few
 * places. The worst case is one alert replacing a not-quite-oldest one just
 * after a deploy.
 */
const nextTrayPlace = new Map<string, number>();

export function trayTagFor(phoneKey: string): string {
  const place = nextTrayPlace.get(phoneKey) ?? Math.floor(Date.now() / 1000) % TRAY_PLACES;
  nextTrayPlace.set(phoneKey, (place + 1) % TRAY_PLACES);
  if (nextTrayPlace.size > 5000) nextTrayPlace.delete(nextTrayPlace.keys().next().value as string);
  return `protohub-slot-${place}`;
}

export const isTrayTag = (tag?: string | null) => Boolean(tag && TRAY_TAG_PATTERN.test(tag));

/**
 * Stamps the event time once. The tray place is NOT set here: it belongs to
 * each phone, so the senders assign it per subscription or device with
 * trayTagFor.
 */
export function preparePushPayload<T extends PushPolicyInput>(payload: T, now = Date.now()): T & { tag: string; timestamp: number } {
  const timestamp = Number.isFinite(payload.timestamp) ? Number(payload.timestamp) : now;
  return {
    ...payload,
    tag: typeof payload.tag === "string" ? payload.tag : "",
    timestamp
  };
}
