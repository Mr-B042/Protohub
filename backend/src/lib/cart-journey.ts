import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

export type BackofficeCartJourneyEventType =
  | "cart_date_changed"
  | "order_date_changed"
  | "order_assigned"
  | "order_reassigned"
  | "delivery_agent_assigned"
  | "delivery_agent_reassigned"
  | "order_status_changed"
  | "contact_attempt_logged";

type CompactableCartJourneyEvent = {
  cart_id?: string | null;
  event_type?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

// Overview analytics needs exact counts for these operational events. For the
// remaining high-frequency signals, one latest row per cart/event type is
// enough to preserve funnel presence, latest context, and recovery guidance.
const ANALYTICS_KEEP_ALL_EVENT_TYPES = new Set([
  "additional_item_preview_opened",
  "additional_item_added",
  "additional_item_removed",
  "contact_attempt_logged",
  "order_assigned",
  "order_reassigned",
  "delivery_agent_assigned",
  "delivery_agent_reassigned",
  "order_status_changed"
]);

const isAnalyticsCountedJourneyType = (eventType: string) =>
  ANALYTICS_KEEP_ALL_EVENT_TYPES.has(eventType) || eventType.startsWith("submit_blocked_");

const ANALYTICS_METADATA_KEYS = new Set([
  "productName",
  "packageName",
  "package",
  "state",
  "quantity",
  "variants",
  "customerName",
  "additionalItems",
  "totalAfterAdd",
  "offerAmount",
  "currency",
  "placement",
  "action",
  "actorName",
  "repName",
  "agentName",
  "fromStatus",
  "toStatus",
  "channel",
  "outcomeCode",
  "nextActionType",
  "fromDate",
  "toDate",
  "reason",
  "message",
  "status",
  "secondsOnPage",
  "lastFieldTouched",
  "fromPackageName",
  "toPackageName",
  "direction",
  "imageIndex",
  "totalImages",
  "field",
  "clearedAfterChars",
  "orderId",
  "order_id",
  "linkedOrderId",
  "linked_order_id",
  "source",
  "embedLabel"
]);

const compactJourneyMetadata = (metadata: Record<string, unknown> | null | undefined) => {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (ANALYTICS_METADATA_KEYS.has(key)) compact[key] = value;
  }
  return compact;
};

export const compactCartJourneyEventsForAnalytics = <T extends CompactableCartJourneyEvent>(events: T[]): T[] => {
  const latestByCartAndType = new Map<string, T>();
  const latestByCart = new Map<string, T>();

  for (const event of events) {
    const cartId = String(event.cart_id ?? "");
    const eventType = String(event.event_type ?? "");
    if (!cartId || !eventType) continue;

    if (!isAnalyticsCountedJourneyType(eventType)) {
      latestByCartAndType.set(`${cartId}:${eventType}`, event);
    }
    latestByCart.set(cartId, event);
  }

  return events.filter((event) => {
    const cartId = String(event.cart_id ?? "");
    const eventType = String(event.event_type ?? "");
    if (!cartId || !eventType) return false;
    return isAnalyticsCountedJourneyType(eventType)
      || latestByCartAndType.get(`${cartId}:${eventType}`) === event
      || latestByCart.get(cartId) === event;
  }).map((event) => ({
    ...event,
    metadata: compactJourneyMetadata(event.metadata)
  }));
};

type AppendCartJourneyEventArgs = {
  orgId: string;
  cartId: string;
  eventType: BackofficeCartJourneyEventType;
  productId?: string | null;
  packageId?: string | null;
  state?: string | null;
  companionProductId?: string | null;
  companionPackageId?: string | null;
  metadata?: Record<string, unknown>;
};

const sanitizeJourneyMetadata = (metadata: Record<string, unknown> | undefined) => {
  const next: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (
      typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
      || value === null
    ) {
      next[key] = value;
    }
  }
  return next;
};

export const appendCartJourneyEvent = async (args: AppendCartJourneyEventArgs) => {
  const payload = {
    org_id: args.orgId,
    cart_id: args.cartId,
    product_id: args.productId ?? null,
    package_id: args.packageId ?? null,
    state: args.state ?? null,
    event_type: args.eventType,
    companion_product_id: args.companionProductId ?? null,
    companion_package_id: args.companionPackageId ?? null,
    metadata: sanitizeJourneyMetadata(args.metadata)
  };
  const { error } = await supabase.from("cart_journey_events").insert(payload);
  if (error) {
    throw error;
  }
};

// cart_journey_events is an append-only log that grows ~1,400 rows/day with no
// bound — it had reached 120 MB (62% of the whole DB) with nothing pruning it.
// Keep a rolling window (default 60 days; env-tunable) so it stops running away.
// The Live-Pulse overview reads this table over a user-selected range, so the
// window is generous — lower CART_JOURNEY_RETENTION_DAYS to reclaim more if that
// view is never used beyond a shorter lookback. Floor of 14 days as a guard.
const CART_JOURNEY_RETENTION_DAYS = Math.max(14, Number(process.env.CART_JOURNEY_RETENTION_DAYS) || 30);
export async function pruneOldCartJourneyEvents(): Promise<number> {
  const cutoff = new Date(Date.now() - CART_JOURNEY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("cart_journey_events")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);
  if (error) {
    logger.warn("cart journey prune failed", { error: error.message });
    return 0;
  }
  return count ?? 0;
}
