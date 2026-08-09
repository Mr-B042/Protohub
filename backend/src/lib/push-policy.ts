export type PushPolicyInput = {
  title?: string;
  kind?: string;
  tag?: string;
  timestamp?: number;
};

export type PushDeliveryPolicy = {
  collapseGroup: "orders" | "customer" | "operations" | "general";
  ttlSeconds: number;
};

const PUSH_SLOTS_PER_GROUP = 4;
const BOUNDED_TAG_PATTERN = /^protohub-(orders|customer|operations|general)-[0-3]$/;

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

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function deliveryPolicyForPush(payload: PushPolicyInput): PushDeliveryPolicy {
  const kind = String(payload.kind ?? "info").trim().toLowerCase();

  if (kind === "test_push") {
    return { collapseGroup: "general", ttlSeconds: 2 * 60 };
  }

  if (ORDER_KINDS.has(kind)) {
    // An order alert is actionable now. If a phone was offline for hours, the
    // in-app notification remains the record; an old tray banner is misleading.
    return { collapseGroup: "orders", ttlSeconds: 30 * 60 };
  }

  if (CUSTOMER_KINDS.has(kind)) {
    return { collapseGroup: "customer", ttlSeconds: 60 * 60 };
  }

  if (OPERATIONS_KINDS.has(kind)) {
    return { collapseGroup: "operations", ttlSeconds: 6 * 60 * 60 };
  }

  return { collapseGroup: "general", ttlSeconds: 60 * 60 };
}

export function boundedPushTag(payload: PushPolicyInput): string {
  if (payload.tag && BOUNDED_TAG_PATTERN.test(payload.tag)) {
    return payload.tag;
  }

  const policy = deliveryPolicyForPush(payload);
  const eventKey = String(payload.tag ?? `${payload.kind ?? "info"}:${payload.title ?? "protohub"}`);
  const slot = stableHash(eventKey) % PUSH_SLOTS_PER_GROUP;
  return `protohub-${policy.collapseGroup}-${slot}`;
}

export function preparePushPayload<T extends PushPolicyInput>(payload: T, now = Date.now()): T & { tag: string; timestamp: number } {
  const timestamp = Number.isFinite(payload.timestamp) ? Number(payload.timestamp) : now;
  return {
    ...payload,
    tag: boundedPushTag(payload),
    timestamp
  };
}
