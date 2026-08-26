import { Router } from "express";
import { humanFieldErrors } from "../lib/validation-message.js";
import { z } from "zod";
import { appendCartJourneyEvent, compactCartJourneyEventsForAnalytics } from "../lib/cart-journey.js";
import { notifyNewAbandonedCart } from "../lib/cart-notifications.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";
import { sendCartAssignedSms } from "../lib/sms.js";
import { applyCartMarketingScope } from "../lib/marketing-attribution.js";
import { lagosDateKey, lagosStartOfDayUtc, mondayOfWeek, addDays, dowOf } from "../lib/follow-up-kpi.js";
import {
  CART_LOG_MISS_AMOUNT, CART_LOG_PENALTY_START_DATE, chargeableDaysIn, dayPenaltyAmount,
  missedCartCount, penaltyPhase,
  mondayOf, RANGE_PRESETS, repDayStatus, resolveRange, summariseRepPenalties, todayStanding,
  type RangePreset, type RepDayInput
} from "../lib/cart-log-penalty.js";
import { REPORT_ROW_CEILING } from "../lib/query-limits.js";

const router = Router();
router.use(requireAuth);

// ── GET /api/carts ───────────────────────────────────────
// Returns ALL carts for the org. Supabase caps a single select at 1000 rows, so we
// page with .range() until exhausted — otherwise the oldest carts silently drop once
// the org crosses 1000, breaking link-repair and the returned-conversion badges.
router.get("/", async (req, res) => {
  const PAGE = 1000;
  const SAFETY_CAP = 50_000; // hard ceiling so a runaway never loads unbounded memory
  const all: any[] = [];
  for (let from = 0; from < SAFETY_CAP; from += PAGE) {
    let query = supabase
      .from("abandoned_carts")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .is("merged_into", null)  // hide carts absorbed into another (the "Merged" state)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    // Sales Reps see assigned carts; Marketers see only attributed cart traffic.
    if (req.user!.role === "Marketer") {
      query = applyCartMarketingScope(query, req.user!.marketingAttributionTags, req.user!.id);
    } else if (scopeOf(req).role === "Sales Rep") {
      query = query.eq("assigned_rep_id", scopeOf(req).id);
    }
    const { data, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < PAGE) break; // last page reached
  }
  res.json(all);
});

// ── GET /api/carts/changes ───────────────────────────────
// Small reconciliation feed for websocket gaps. The abandoned-cart screen used
// to download every historical cart every five minutes; that was both slow and
// expensive, and still left a long period where a missed realtime event was not
// visible. This endpoint returns only rows whose activity changed after the
// caller's cursor. Rows absorbed by deduplication are intentionally included so
// the browser can remove the old card immediately.
router.get("/changes", async (req, res) => {
  const rawAfter = typeof req.query.after === "string" ? req.query.after.trim() : "";
  const afterMs = Date.parse(rawAfter);
  if (!rawAfter || !Number.isFinite(afterMs)) {
    res.status(400).json({ error: "A valid after timestamp is required." });
    return;
  }

  // Capture the cursor before querying. Any write that lands after this point
  // will have a later last_activity and is therefore guaranteed to appear in
  // the next request rather than falling into a request/response race.
  const serverTime = new Date().toISOString();
  const PAGE = 1000;
  const SAFETY_CAP = 10_000;
  const rows: any[] = [];

  for (let from = 0; from < SAFETY_CAP; from += PAGE) {
    let query = supabase
      .from("abandoned_carts")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .gt("last_activity", new Date(afterMs).toISOString())
      .lte("last_activity", serverTime)
      .order("last_activity", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (req.user!.role === "Marketer") {
      query = applyCartMarketingScope(query, req.user!.marketingAttributionTags, req.user!.id);
    } else if (scopeOf(req).role === "Sales Rep") {
      query = query.eq("assigned_rep_id", scopeOf(req).id);
    }

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  res.setHeader("Cache-Control", "private, no-store");
  res.json({ rows, serverTime, truncated: rows.length >= SAFETY_CAP });
});

// ── GET /api/carts/by-label/:label ───────────────────────
// Returns carts + linked order status for a specific embed_label.
// Powers the link detail drill-down in Links & Tracking.
router.get("/by-label/:label", async (req, res) => {
  const label = String(req.params.label ?? "").trim();
  if (!label) { res.status(400).json({ error: "Missing label." }); return; }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: carts, error } = await supabase
    .from("abandoned_carts")
    .select("id, customer, phone, address, city, state, status, amount, currency, product_name, package_name, created_at, last_activity")
    .eq("org_id", req.user!.orgId)
    .eq("embed_label", label)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) { res.status(500).json({ error: error.message }); return; }

  const cartIds = (carts ?? []).map((c: any) => c.id);
  const { data: orders } = cartIds.length
    ? await supabase.from("orders").select("id, source_cart_id, status, amount, created_at").eq("org_id", req.user!.orgId).in("source_cart_id", cartIds)
    : { data: [] };

  const orderByCart = Object.fromEntries((orders ?? []).map((o: any) => [o.source_cart_id, o]));

  res.json((carts ?? []).map((c: any) => ({
    ...c,
    order: orderByCart[c.id] ?? null
  })));
});

// ── POST /api/carts ──────────────────────────────────────
// Upsert a draft from the embed order form. Called every time the
// customer touches a field (the frontend debounces). Idempotent on `id`.
const CartUpsertSchema = z.object({
  id:           z.string().min(1),
  customer:     z.string().optional(),
  phone:        z.string().min(1),
  whatsapp:     z.string().optional(),
  email:        z.string().email().optional().or(z.literal("")),
  address:      z.string().optional(),
  city:         z.string().optional(),
  state:        z.string().optional(),
  productId:    z.string().uuid().optional(),
  packageId:    z.string().uuid().optional(),
  productName:  z.string().min(1),
  packageName:  z.string().min(1),
  amount:       z.number().min(0),
  currency:     z.enum(["NGN", "USD", "GBP"]),
  source:       z.string().optional(),
  embedLabel:   z.string().max(120).optional(),
  preferredDelivery: z.string().optional(),
  capturePayload: z.record(z.string(), z.unknown()).optional(),
  status:       z.string().optional()  // accepted iff present in cart_status enum (DB will reject otherwise)
});

const JourneyBulkSchema = z.object({
  cartIds: z.array(
    z.string().min(1).max(80).regex(/^[A-Za-z0-9\-_]+$/, "Cart ID must be alphanumeric")
  ).max(500),
  createdAfter: z.string().datetime({ offset: true }).optional(),
  snapshot: z.boolean().optional()
});

const ConvertedCartLinkRepairOneSchema = z.object({
  cartId: z.string().min(1).max(80).regex(/^[A-Za-z0-9\-_]+$/, "Cart ID must be alphanumeric"),
  orderId: z.string().min(1).max(80)
});

type ConvertedCartLinkRepairStatus =
  | "already_linked"
  | "repairable"
  | "manual_review:no_journey_order_id"
  | "manual_review:journey_order_missing"
  | "manual_review:order_linked_to_another_cart";

type ConvertedCartLinkRepairOrderPreview = {
  id: string;
  customer: string;
  phone: string;
  productName: string;
  packageName: string;
  amount: number;
  currency: string;
  status: string;
  date: string | null;
  createdAt: string | null;
  sourceCartId: string | null;
};

type ConvertedCartLinkRepairRow = {
  cartId: string;
  orderId: string | null;
  repairStatus: ConvertedCartLinkRepairStatus;
  customer: string;
  phone: string;
  productName: string;
  packageName: string;
  amount: number;
  currency: string;
  source: string;
  embedLabel: string;
  lastActivity: string | null;
  submittedAt: string | null;
  alreadyLinkedOrderId: string | null;
  journeyOrderSourceCartId: string | null;
  order: ConvertedCartLinkRepairOrderPreview | null;
  canApply: boolean;
  manualReviewMessage: string;
};

const CART_LINK_ORDER_PREVIEW_SELECT = "id, customer, phone, product_name, package_name, amount, currency, status, date, created_at, source_cart_id";

const sourceCartIdFromOrderRow = (order: any): string | null =>
  typeof order?.source_cart_id === "string" && order.source_cart_id.trim()
    ? order.source_cart_id.trim()
    : null;

const orderPreviewFromRow = (order: any): ConvertedCartLinkRepairOrderPreview | null => {
  const id = typeof order?.id === "string" ? order.id : String(order?.id ?? "");
  if (!id) return null;
  return {
    id,
    customer: typeof order.customer === "string" ? order.customer : "",
    phone: typeof order.phone === "string" ? order.phone : "",
    productName: typeof order.product_name === "string" ? order.product_name : "",
    packageName: typeof order.package_name === "string" ? order.package_name : "",
    amount: Number(order.amount ?? 0),
    currency: typeof order.currency === "string" ? order.currency : "NGN",
    status: typeof order.status === "string" ? order.status : "",
    date: typeof order.date === "string" ? order.date : null,
    createdAt: typeof order.created_at === "string" ? order.created_at : null,
    sourceCartId: sourceCartIdFromOrderRow(order)
  };
};

const convertedCartLinkRepairMessage = (
  repairStatus: ConvertedCartLinkRepairStatus,
  orderId: string | null,
  sourceCartId: string | null
) => {
  if (repairStatus === "already_linked") return "This cart is already attached to an order.";
  if (repairStatus === "repairable") return "Exact journey order found and still unlinked.";
  if (repairStatus === "manual_review:no_journey_order_id") {
    return "The cart is converted, but its journey did not save the submitted order number.";
  }
  if (repairStatus === "manual_review:journey_order_missing") {
    return orderId
      ? `The cart journey mentions order #${orderId}, but that order could not be verified in this org.`
      : "The cart journey mentions an order, but it could not be verified.";
  }
  if (repairStatus === "manual_review:order_linked_to_another_cart") {
    return sourceCartId
      ? `Order #${orderId ?? "?"} is already linked to ${sourceCartId}.`
      : `Order #${orderId ?? "?"} is already linked to another cart.`;
  }
  return "Manual review is needed before this cart can be linked.";
};

const submittedOrderIdFromMetadata = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  for (const key of ["orderId", "order_id", "linkedOrderId", "linked_order_id"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
};

const summarizeConvertedCartLinkRows = (rows: ConvertedCartLinkRepairRow[]) => {
  const summary = rows.reduce<Record<ConvertedCartLinkRepairStatus, number>>((acc, row) => {
    acc[row.repairStatus] = (acc[row.repairStatus] ?? 0) + 1;
    return acc;
  }, {
    already_linked: 0,
    repairable: 0,
    "manual_review:no_journey_order_id": 0,
    "manual_review:journey_order_missing": 0,
    "manual_review:order_linked_to_another_cart": 0
  });

  return {
    total: rows.length,
    summary,
    repairableCount: summary.repairable ?? 0,
    manualReviewCount:
      (summary["manual_review:no_journey_order_id"] ?? 0) +
      (summary["manual_review:journey_order_missing"] ?? 0) +
      (summary["manual_review:order_linked_to_another_cart"] ?? 0)
  };
};

const buildConvertedCartLinkRepairReport = async (orgId: string) => {
  const { data: carts, error: cartsError } = await supabase
    .from("abandoned_carts")
    .select("id, customer, phone, product_name, package_name, amount, currency, source, embed_label, status, last_activity")
    .eq("org_id", orgId)
    .eq("status", "Converted")
    .order("last_activity", { ascending: false });

  if (cartsError) throw cartsError;

  const cartRows = (carts ?? []).filter((cart: any) => typeof cart.id === "string" && cart.id.trim());
  if (cartRows.length === 0) {
    const rows: ConvertedCartLinkRepairRow[] = [];
    return { rows, ...summarizeConvertedCartLinkRows(rows) };
  }

  const cartIds = cartRows.map((cart: any) => cart.id as string);
  const { data: linkedOrders, error: linkedOrdersError } = await supabase
    .from("orders")
    .select(CART_LINK_ORDER_PREVIEW_SELECT)
    .limit(REPORT_ROW_CEILING)
    .eq("org_id", orgId)
    .in("source_cart_id", cartIds);

  if (linkedOrdersError) throw linkedOrdersError;

  const linkedOrderByCartId = new Map<string, any>();
  for (const order of linkedOrders ?? []) {
    const cartId = typeof order.source_cart_id === "string" ? order.source_cart_id.trim() : "";
    if (!cartId || linkedOrderByCartId.has(cartId)) continue;
    linkedOrderByCartId.set(cartId, order);
  }

  const { data: submittedEvents, error: eventsError } = await supabase
    .from("cart_journey_events")
    .select("cart_id, metadata, created_at")
    .eq("org_id", orgId)
    .in("cart_id", cartIds)
    .eq("event_type", "order_submitted")
    .order("created_at", { ascending: false });

  if (eventsError) throw eventsError;

  const submittedOrderIdByCartId = new Map<string, string>();
  const submittedAtByCartId = new Map<string, string>();
  for (const event of submittedEvents ?? []) {
    const cartId = typeof event.cart_id === "string" ? event.cart_id.trim() : "";
    if (!cartId || submittedOrderIdByCartId.has(cartId)) continue;
    const orderId = submittedOrderIdFromMetadata(event.metadata);
    if (orderId) submittedOrderIdByCartId.set(cartId, orderId);
    if (typeof event.created_at === "string") submittedAtByCartId.set(cartId, event.created_at);
  }

  const submittedOrderIds = Array.from(new Set(Array.from(submittedOrderIdByCartId.values())));
  const submittedOrdersById = new Map<string, any>();
  if (submittedOrderIds.length > 0) {
    const { data: submittedOrders, error: submittedOrdersError } = await supabase
      .from("orders")
      .select(CART_LINK_ORDER_PREVIEW_SELECT)
      .limit(REPORT_ROW_CEILING)
      .eq("org_id", orgId)
      .in("id", submittedOrderIds);

    if (submittedOrdersError) throw submittedOrdersError;

    for (const order of submittedOrders ?? []) {
      const id = typeof order.id === "string" ? order.id : String(order.id ?? "");
      if (!id) continue;
      submittedOrdersById.set(id, order);
    }
  }

  const rows: ConvertedCartLinkRepairRow[] = cartRows.map((cart: any) => {
    const cartId = cart.id as string;
    const alreadyLinkedOrder = linkedOrderByCartId.get(cartId);
    const orderId = submittedOrderIdByCartId.get(cartId) ?? null;
    const submittedOrder = orderId ? submittedOrdersById.get(orderId) : null;
    const submittedOrderSourceCartId = sourceCartIdFromOrderRow(submittedOrder);

    let repairStatus: ConvertedCartLinkRepairStatus = "repairable";
    if (alreadyLinkedOrder) {
      repairStatus = "already_linked";
    } else if (!orderId) {
      repairStatus = "manual_review:no_journey_order_id";
    } else if (!submittedOrder) {
      repairStatus = "manual_review:journey_order_missing";
    } else if (submittedOrderSourceCartId && submittedOrderSourceCartId !== cartId) {
      repairStatus = "manual_review:order_linked_to_another_cart";
    }

    return {
      cartId,
      orderId,
      repairStatus,
      customer: typeof cart.customer === "string" ? cart.customer : "",
      phone: typeof cart.phone === "string" ? cart.phone : "",
      productName: typeof cart.product_name === "string" ? cart.product_name : "",
      packageName: typeof cart.package_name === "string" ? cart.package_name : "",
      amount: Number(cart.amount ?? 0),
      currency: typeof cart.currency === "string" ? cart.currency : "NGN",
      source: typeof cart.source === "string" ? cart.source : "Website",
      embedLabel: typeof cart.embed_label === "string" ? cart.embed_label : "",
      lastActivity: typeof cart.last_activity === "string" ? cart.last_activity : null,
      submittedAt: submittedAtByCartId.get(cartId) ?? null,
      alreadyLinkedOrderId: alreadyLinkedOrder?.id ? String(alreadyLinkedOrder.id) : null,
      journeyOrderSourceCartId: submittedOrderSourceCartId,
      order: orderPreviewFromRow(alreadyLinkedOrder ?? submittedOrder),
      canApply: repairStatus === "repairable",
      manualReviewMessage: convertedCartLinkRepairMessage(repairStatus, orderId, submittedOrderSourceCartId)
    };
  });

  // Phone fallback: a converted cart whose journey order id can't be verified may
  // still belong to a customer who actually ordered — under a DIFFERENT cart id from
  // the same session (multi-cart re-keying). The order isn't "missing", it just isn't
  // the exact id the journey recorded. Match by normalized phone so these resolve
  // instead of sitting forever as "needs review".
  const normPhone = (p: string) => {
    const digits = (p ?? "").replace(/\D/g, "");
    return digits.length >= 10 ? digits.slice(-10) : digits;
  };
  const unresolved = rows.filter((r) =>
    r.repairStatus === "manual_review:no_journey_order_id" ||
    r.repairStatus === "manual_review:journey_order_missing"
  );
  if (unresolved.length > 0) {
    const { data: phoneOrders } = await supabase
      .from("orders")
      .select(CART_LINK_ORDER_PREVIEW_SELECT)
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(5000);

    const orderByPhone = new Map<string, any>();
    for (const order of phoneOrders ?? []) {
      const key = normPhone(typeof order.phone === "string" ? order.phone : "");
      if (!key || orderByPhone.has(key)) continue; // first = most recent (ordered desc)
      orderByPhone.set(key, order);
    }

    for (const row of unresolved) {
      const match = orderByPhone.get(normPhone(row.phone));
      if (!match) continue;
      const matchSourceCart = sourceCartIdFromOrderRow(match);
      row.repairStatus = "already_linked";
      row.canApply = false;
      row.order = orderPreviewFromRow(match);
      row.alreadyLinkedOrderId = String(match.id);
      row.manualReviewMessage = `Customer ordered as #${match.id}${matchSourceCart && matchSourceCart !== row.cartId ? ` (recorded under ${matchSourceCart})` : ""} — verified by phone, no action needed.`;
    }
  }

  return { rows, ...summarizeConvertedCartLinkRows(rows) };
};

const LIVE_PULSE_EVENT_TYPES = new Set([
  "form_opened",
  "first_interaction",
  "package_selected",
  "state_selected",
  "additional_item_preview_opened",
  "additional_item_added",
  "additional_item_removed",
  "submit_attempted",
  "submit_blocked_missing_name",
  "submit_blocked_missing_phone",
  "submit_blocked_invalid_phone",
  "submit_blocked_missing_whatsapp",
  "submit_blocked_invalid_whatsapp",
  "submit_blocked_missing_address",
  "submit_blocked_missing_city",
  "submit_blocked_missing_state",
  "submit_blocked_missing_delivery",
  "submit_blocked_missing_confirmation",
  "submit_blocked_missing_commitment",
  "order_submitted",
  "redirect_triggered",
  "form_exited"
]);

const PULSE_FEED_EVENT_TYPES = new Set([
  "form_opened",
  "first_interaction",
  "submit_attempted",
  "order_submitted",
  "redirect_triggered"
]);
const PULSE_METRIC_EVENT_TYPES = [
  "form_opened",
  "first_interaction",
  "submit_attempted",
  "order_submitted",
  "redirect_triggered"
] as const;
const PULSE_METRIC_EVENT_TYPE_SET = new Set<string>(PULSE_METRIC_EVENT_TYPES);
const LIVE_PULSE_EVENT_SELECT = "id, cart_id, product_id, package_id, event_type, metadata, created_at";
const LIVE_PULSE_CACHE_TTL_MS = 20_000;
const livePulseCache = new Map<string, { expiresAt: number; payload: unknown }>();
const pruneLivePulseCache = () => {
  if (livePulseCache.size < 250) return;
  const now = Date.now();
  for (const [key, value] of livePulseCache.entries()) {
    if (value.expiresAt <= now) livePulseCache.delete(key);
  }
};

const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const lagosTodayDateKey = () => new Date(Date.now() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);

const lagosDateKeyToRange = (dateKey: string) => {
  if (!DATE_KEY_RE.test(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  if (!year || !month || !day) return null;
  const startUtcMs = Date.UTC(year, month - 1, day) - LAGOS_OFFSET_MS;
  return {
    startIso: new Date(startUtcMs).toISOString(),
    endExclusiveIso: new Date(startUtcMs + 24 * 60 * 60 * 1000).toISOString()
  };
};

const lagosDateRangeToBounds = (dateFrom?: string, dateTo?: string) => {
  const normalizedFrom = typeof dateFrom === "string" && DATE_KEY_RE.test(dateFrom) ? dateFrom : lagosTodayDateKey();
  const normalizedTo = typeof dateTo === "string" && DATE_KEY_RE.test(dateTo) ? dateTo : normalizedFrom;
  const dateStart = normalizedFrom <= normalizedTo ? normalizedFrom : normalizedTo;
  const dateEnd = normalizedFrom <= normalizedTo ? normalizedTo : normalizedFrom;
  const startRange = lagosDateKeyToRange(dateStart);
  const endRange = lagosDateKeyToRange(dateEnd);
  if (!startRange || !endRange) {
    const today = lagosTodayDateKey();
    const fallback = lagosDateKeyToRange(today)!;
    return { dateFrom: today, dateTo: today, startIso: fallback.startIso, endExclusiveIso: fallback.endExclusiveIso };
  }
  return {
    dateFrom: dateStart,
    dateTo: dateEnd,
    startIso: startRange.startIso,
    endExclusiveIso: endRange.endExclusiveIso
  };
};

const normalizeEditableCreatedAt = (value: string) => {
  const trimmed = value.trim();
  const parsed = new Date(trimmed);
  if (!trimmed || Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
};

const normalizePulseSource = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return "Unknown";
  return value.trim();
};

const normalizePulseProductName = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return "";
  return value.trim();
};

const resolvePulseEmbedLabel = (embedLabelValue: unknown, productNameValue: unknown) => {
  if (typeof embedLabelValue === "string" && embedLabelValue.trim()) {
    return embedLabelValue.trim();
  }
  const productName = normalizePulseProductName(productNameValue);
  if (productName) {
    return `Unlabelled · ${productName}`;
  }
  return "Unlabelled embed";
};

const isInteractionEvent = (eventType: string) =>
  eventType === "first_interaction"
  || eventType === "package_selected"
  || eventType === "tier_switched"
  || eventType === "state_selected"
  || eventType === "additional_item_preview_opened"
  || eventType === "additional_item_added"
  || eventType === "additional_item_removed"
  || eventType === "image_viewed"
  || eventType === "field_hesitated"
  || eventType === "submit_idle"
  || eventType === "back_button_pressed"
  || eventType === "submit_attempted"
  || eventType.startsWith("submit_blocked_");

// DB enum only allows: Open abandoned | Assigned | Contacted | Converted | Lost.
// Frontend draft states ("In progress", "Abandoned") are coerced to "Open abandoned".
router.post("/", async (req, res) => {
  const parsed = CartUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  const d = parsed.data;

  const row = {
    id:           d.id,
    org_id:       req.user!.orgId,
    customer:     d.customer ?? "Partial lead",
    phone:        d.phone,
    whatsapp:     d.whatsapp ?? null,
    email:        d.email?.trim() || null,
    address:      d.address?.trim() || null,
    city:         d.city ?? null,
    state:        d.state ?? null,
    product_id:   d.productId ?? null,
    package_id:   d.packageId ?? null,
    product_name: d.productName,
    package_name: d.packageName,
    amount:       d.amount,
    currency:     d.currency,
    source:       d.source ?? "Website",
    embed_label:  (d.embedLabel ?? "").trim().slice(0, 120) || null,
    preferred_delivery: d.preferredDelivery?.trim() || null,
    capture_payload:
      d.capturePayload && typeof d.capturePayload === "object" && !Array.isArray(d.capturePayload)
        ? d.capturePayload
        : {},
    last_activity: new Date().toISOString()
  };

  // Insert if new, update fields (preserve original status / created_at) if it
  // already exists for this org.
  const { data: existing } = await supabase
    .from("abandoned_carts")
    .select("id, status")
    .eq("id", d.id)
    .eq("org_id", req.user!.orgId)
    .maybeSingle();

  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id")
    .eq("org_id", req.user!.orgId)
    .eq("source_cart_id", d.id)
    .maybeSingle();

  if (existingOrder) {
    if (existing && (existing.status !== "Converted" || row.embed_label)) {
      const convertedUpdate: Record<string, unknown> = { status: "Converted", last_activity: new Date().toISOString() };
      if (row.embed_label) convertedUpdate.embed_label = row.embed_label;
      await supabase
        .from("abandoned_carts")
        .update(convertedUpdate)
        .eq("id", d.id)
        .eq("org_id", req.user!.orgId);
    }
    res.status(200).json({ id: d.id, ignored: true, converted: true, orderId: existingOrder.id });
    return;
  }

  if (existing) {
    const { data, error } = await supabase
      .from("abandoned_carts")
      .update(row)
      .eq("id", d.id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
    return;
  }

  const { data, error } = await supabase
    .from("abandoned_carts")
    .insert({ ...row, status: "Open abandoned" })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  void notifyNewAbandonedCart(req.user!.orgId, {
    id: data.id,
    customer: data.customer ?? "Partial lead",
    phone: data.phone,
    product_name: data.product_name ?? "your requested item",
    package_name: data.package_name ?? null,
    amount: Number(data.amount ?? 0),
    currency: data.currency ?? "NGN",
    source: data.source ?? "Website"
  });
  res.status(201).json(data);
});

// ── POST /api/carts/journey-bulk ───────────────────────
// Returns grouped journey timelines for multiple carts at once. Useful for
// abandoned-cart analytics and rep follow-up hints without opening each cart.
router.post("/journey-bulk", async (req, res) => {
  const parsed = JourneyBulkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }

  const requestedIds = Array.from(new Set(parsed.data.cartIds.map((id) => id.trim()).filter(Boolean)));
  if (requestedIds.length === 0) {
    res.json({});
    return;
  }

  let allowedCartQuery = supabase
    .from("abandoned_carts")
    .select("id")
    .limit(REPORT_ROW_CEILING)
    .eq("org_id", req.user!.orgId)
    .in("id", requestedIds);

  if (scopeOf(req).role === "Sales Rep") {
    allowedCartQuery = allowedCartQuery.eq("assigned_rep_id", scopeOf(req).id);
  }

  const { data: allowedCarts, error: cartError } = await allowedCartQuery;
  if (cartError) {
    res.status(500).json({ error: cartError.message });
    return;
  }

  const allowedIds = (allowedCarts ?? [])
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (allowedIds.length === 0) {
    res.json({});
    return;
  }

  const events: any[] = [];
  const EVENT_PAGE_SIZE = 1000;
  for (let from = 0; ; from += EVENT_PAGE_SIZE) {
    let eventsQuery = supabase
      .from("cart_journey_events")
      .select("id, cart_id, product_id, package_id, state, event_type, companion_product_id, companion_package_id, metadata, created_at")
      .eq("org_id", req.user!.orgId)
      .in("cart_id", allowedIds)
      .order("created_at", { ascending: true })
      .range(from, from + EVENT_PAGE_SIZE - 1);
    if (parsed.data.createdAfter) {
      // Include the boundary and deduplicate by id so same-time events are not lost.
      eventsQuery = eventsQuery.gte("created_at", parsed.data.createdAfter);
    }
    const { data: batch, error } = await eventsQuery;

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    events.push(...(batch ?? []));
    if (!batch || batch.length < EVENT_PAGE_SIZE) break;
  }

  const responseEvents = parsed.data.snapshot
    ? compactCartJourneyEventsForAnalytics(events)
    : events;
  const grouped = Object.fromEntries(allowedIds.map((id) => [id, [] as any[]]));
  for (const event of responseEvents) {
    const cartId = typeof event.cart_id === "string" ? event.cart_id : "";
    if (!cartId || !grouped[cartId]) continue;
    grouped[cartId].push(event);
  }

  res.json(grouped);
});

// ── Converted cart link repair ───────────────────────────
// Owner/Admin-only safety tool: backfills source_cart_id for converted carts
// only when the cart journey recorded the exact submitted order id and that
// order is still unlinked. Ambiguous rows are reported for manual review.
router.get("/converted-link-repairs", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const report = await buildConvertedCartLinkRepairReport(req.user!.orgId);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Could not scan converted cart links." });
  }
});

router.post("/converted-link-repairs/apply", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const before = await buildConvertedCartLinkRepairReport(req.user!.orgId);
    const repairableRows = before.rows.filter((row) => row.repairStatus === "repairable" && row.orderId);
    const repaired: { cartId: string; orderId: string }[] = [];

    for (const row of repairableRows) {
      const { data, error } = await supabase
        .from("orders")
        .update({ source_cart_id: row.cartId })
        .eq("org_id", req.user!.orgId)
        .eq("id", row.orderId)
        .is("source_cart_id", null)
        .select("id, source_cart_id");

      if (error) throw error;

      const updatedOrder = (data ?? [])[0];
      if (updatedOrder?.id) {
        repaired.push({ cartId: row.cartId, orderId: String(updatedOrder.id) });
      }
    }

    const report = await buildConvertedCartLinkRepairReport(req.user!.orgId);
    res.json({ repaired, repairedCount: repaired.length, report });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Could not repair converted cart links." });
  }
});

router.post("/converted-link-repairs/apply-one", requireRole("Owner", "Admin"), async (req, res) => {
  const parsed = ConvertedCartLinkRepairOneSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }

  const cartId = parsed.data.cartId.trim();
  const orderId = parsed.data.orderId.trim();

  try {
    const { data: cart, error: cartError } = await supabase
      .from("abandoned_carts")
      .select("id, status")
      .eq("org_id", req.user!.orgId)
      .eq("id", cartId)
      .maybeSingle();

    if (cartError) throw cartError;
    if (!cart) {
      res.status(404).json({ error: "Cart not found in this organization." });
      return;
    }
    if (cart.status !== "Converted") {
      res.status(409).json({ error: "Only converted carts can be linked to a finished order." });
      return;
    }

    const { data: alreadyLinkedOrders, error: alreadyLinkedError } = await supabase
      .from("orders")
      .select("id, source_cart_id")
      .eq("org_id", req.user!.orgId)
      .eq("source_cart_id", cartId);

    if (alreadyLinkedError) throw alreadyLinkedError;
    const conflictingCartOrder = (alreadyLinkedOrders ?? []).find((order: any) => String(order.id) !== orderId);
    if (conflictingCartOrder) {
      res.status(409).json({ error: `This cart is already linked to order #${conflictingCartOrder.id}.` });
      return;
    }

    const { data: journeyRows, error: journeyError } = await supabase
      .from("cart_journey_events")
      .select("metadata")
      .eq("org_id", req.user!.orgId)
      .eq("cart_id", cartId)
      .eq("event_type", "order_submitted")
      .order("created_at", { ascending: false })
      .limit(1);

    if (journeyError) throw journeyError;
    const journeyOrderId = submittedOrderIdFromMetadata((journeyRows ?? [])[0]?.metadata);
    if (!journeyOrderId) {
      res.status(409).json({ error: "This cart did not save a submitted order number, so it needs manual order matching." });
      return;
    }
    if (String(journeyOrderId) !== String(orderId)) {
      res.status(409).json({ error: `This cart points to order #${journeyOrderId}, not #${orderId}. Refresh and review again.` });
      return;
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(CART_LINK_ORDER_PREVIEW_SELECT)
      .eq("org_id", req.user!.orgId)
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order) {
      res.status(404).json({ error: `Order #${orderId} could not be found in this organization.` });
      return;
    }

    const existingOrderCartId = sourceCartIdFromOrderRow(order);
    if (existingOrderCartId && existingOrderCartId !== cartId) {
      res.status(409).json({ error: `Order #${orderId} is already linked to ${existingOrderCartId}.` });
      return;
    }

    const repaired: { cartId: string; orderId: string }[] = [];
    if (!existingOrderCartId) {
      const { data: updatedRows, error: updateError } = await supabase
        .from("orders")
        .update({ source_cart_id: cartId })
        .eq("org_id", req.user!.orgId)
        .eq("id", orderId)
        .is("source_cart_id", null)
        .select("id, source_cart_id");

      if (updateError) throw updateError;
      const updatedOrder = (updatedRows ?? [])[0];
      if (!updatedOrder?.id) {
        res.status(409).json({ error: "The order link changed while reviewing. Please scan again." });
        return;
      }
      repaired.push({ cartId, orderId: String(updatedOrder.id) });
    }

    const report = await buildConvertedCartLinkRepairReport(req.user!.orgId);
    res.json({ repaired, repairedCount: repaired.length, report });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Could not repair this converted cart link." });
  }
});

// ── GET /api/carts/live-pulse ───────────────────────────
// Live health view for customer-facing order forms. Uses cart journey events
// so owners/admins can see views, clicks, submits, redirects, and last-seen
// timestamps without refreshing the whole page.
router.get("/live-pulse", requireRole("Owner", "Admin"), async (req, res) => {
  const rawProductIds = typeof req.query.productIds === "string" ? req.query.productIds : "";
  const productIds = Array.from(
    new Set(
      rawProductIds
        .split(",")
        .map((id) => id.trim())
        .filter((id) => /^[0-9a-fA-F-]{36}$/.test(id))
    )
  ).slice(0, 50).sort();
  const rawEmbedLabels = typeof req.query.embedLabels === "string" ? req.query.embedLabels : "";
  const embedLabels = Array.from(
    new Set(
      rawEmbedLabels
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => value.slice(0, 120))
    )
  ).slice(0, 50).sort();
  const activeWindowMinutes = Math.max(
    3,
    Math.min(
      30,
      Number.isFinite(Number(req.query.activeWindowMinutes))
        ? Math.round(Number(req.query.activeWindowMinutes))
        : 10
    )
  );
  const selectedRange = lagosDateRangeToBounds(
    typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined,
    typeof req.query.dateTo === "string" ? req.query.dateTo : undefined
  );
  const activeSinceIso = new Date(Date.now() - activeWindowMinutes * 60 * 1000).toISOString();
  const recentSinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const cacheKey = JSON.stringify({
    orgId: req.user!.orgId,
    activeWindowMinutes,
    dateFrom: selectedRange.dateFrom,
    dateTo: selectedRange.dateTo,
    productIds,
    embedLabels
  });
  pruneLivePulseCache();
  const cached = livePulseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "private, max-age=20");
    res.setHeader("X-Protohub-Cache", "HIT");
    res.json(cached.payload);
    return;
  }
  livePulseCache.delete(cacheKey);

  let rangeQuery = supabase
    .from("cart_journey_events")
    .select(LIVE_PULSE_EVENT_SELECT)
    .eq("org_id", req.user!.orgId)
    .gte("created_at", selectedRange.startIso)
    .lt("created_at", selectedRange.endExclusiveIso)
    .in("event_type", [...LIVE_PULSE_EVENT_TYPES])
    .order("created_at", { ascending: true })
    // Explicit ceiling — without this, PostgREST silently caps at 1000 rows
    // and a busy day (323+ carts × multiple events) gets truncated to the
    // oldest events, making "viewed today" undercount and "last seen at"
    // report the latest event in the first 1000 (often ~1h into the day).
    .limit(10000);
  let rangeFeedQuery = supabase
    .from("cart_journey_events")
    .select(LIVE_PULSE_EVENT_SELECT)
    .eq("org_id", req.user!.orgId)
    .gte("created_at", selectedRange.startIso)
    .lt("created_at", selectedRange.endExclusiveIso)
    .in("event_type", [...PULSE_FEED_EVENT_TYPES])
    .order("created_at", { ascending: false })
    .limit(250);
  let liveWindowQuery = supabase
    .from("cart_journey_events")
    .select(LIVE_PULSE_EVENT_SELECT)
    .eq("org_id", req.user!.orgId)
    .gte("created_at", recentSinceIso)
    .in("event_type", [...LIVE_PULSE_EVENT_TYPES])
    .order("created_at", { ascending: false })
    .limit(250);

  if (productIds.length > 0) {
    rangeQuery = rangeQuery.in("product_id", productIds);
    rangeFeedQuery = rangeFeedQuery.in("product_id", productIds);
    liveWindowQuery = liveWindowQuery.in("product_id", productIds);
  }

  const loadMetricEvents = async () => {
    const allEvents: any[] = [];
    // Supabase/PostgREST can enforce a 1,000-row max per request even when
    // the client asks for a larger range. Keep the page size at that ceiling
    // so busy days continue past the first 1,000 metric events.
    const pageSize = 1000;
    const maxRows = 50000;
    for (let from = 0; from < maxRows; from += pageSize) {
      let metricQuery = supabase
        .from("cart_journey_events")
        .select(LIVE_PULSE_EVENT_SELECT)
        .eq("org_id", req.user!.orgId)
        .gte("created_at", selectedRange.startIso)
        .lt("created_at", selectedRange.endExclusiveIso)
        .in("event_type", [...PULSE_METRIC_EVENT_TYPES])
        .order("created_at", { ascending: true })
        .range(from, from + pageSize - 1);
      if (productIds.length > 0) {
        metricQuery = metricQuery.in("product_id", productIds);
      }
      const { data, error } = await metricQuery;
      if (error) return { data: allEvents, error };
      const page = data ?? [];
      allEvents.push(...page);
      if (page.length < pageSize) return { data: allEvents, error: null };
    }
    return { data: allEvents, error: null };
  };

  const [
    { data: rangeEvents, error: rangeError },
    { data: rangeFeedEvents, error: rangeFeedError },
    { data: liveWindowEvents, error: liveWindowError },
    { data: metricEvents, error: metricError }
  ] = await Promise.all([rangeQuery, rangeFeedQuery, liveWindowQuery, loadMetricEvents()]);

  if (rangeError || rangeFeedError || liveWindowError || metricError) {
    res.status(500).json({ error: rangeError?.message ?? rangeFeedError?.message ?? liveWindowError?.message ?? metricError?.message ?? "Could not load live pulse." });
    return;
  }

  const combinedCartIds = Array.from(
    new Set(
      [...(rangeEvents ?? []), ...(rangeFeedEvents ?? []), ...(liveWindowEvents ?? []), ...(metricEvents ?? [])]
        .map((event) => (typeof event.cart_id === "string" ? event.cart_id.trim() : ""))
        .filter(Boolean)
    )
  );

  let cartRows: any[] = [];
  if (combinedCartIds.length > 0) {
    const cartLookupBatchSize = 100;
    for (let index = 0; index < combinedCartIds.length; index += cartLookupBatchSize) {
      const cartIdBatch = combinedCartIds.slice(index, index + cartLookupBatchSize);
      let cartRes: any = await supabase
        .from("abandoned_carts")
        .select("id, source, product_name, package_name, last_activity, embed_label")
        .limit(REPORT_ROW_CEILING)
        .eq("org_id", req.user!.orgId)
        .in("id", cartIdBatch);
      if (cartRes.error && (cartRes.error.code === "42703" || /embed_label/i.test(cartRes.error.message ?? ""))) {
        cartRes = await supabase
          .from("abandoned_carts")
          .select("id, source, product_name, package_name, last_activity")
          .limit(REPORT_ROW_CEILING)
          .eq("org_id", req.user!.orgId)
          .in("id", cartIdBatch);
      }
      if (cartRes.error) {
        res.status(500).json({ error: cartRes.error.message });
        return;
      }
      cartRows.push(...(cartRes.data ?? []));
    }
  }

  const cartById = new Map(cartRows.map((row) => [row.id, row]));
  const eventMetadata = (event: any): Record<string, unknown> =>
    event?.metadata && typeof event.metadata === "object"
      ? event.metadata as Record<string, unknown>
      : {};
  const sourceQualityScore = (source: string) => {
    const normalized = source.trim().toLowerCase();
    if (!normalized || normalized === "unknown") return 0;
    if (normalized === "website" || normalized === "direct") return 1;
    return 2;
  };
  const sourceEventPriority = (eventType: string) => {
    if (eventType === "order_submitted") return 4;
    if (eventType === "submit_attempted") return 3;
    if (eventType === "form_opened") return 2;
    if (eventType === "first_interaction") return 1;
    return 0;
  };
  const canonicalSourceByCart = new Map<string, { source: string; score: number; createdAt: string }>();
  const considerCanonicalSource = (event: any) => {
    const cartId = typeof event?.cart_id === "string" ? event.cart_id.trim() : "";
    if (!cartId) return;
    const metadata = eventMetadata(event);
    const cartRow = cartById.get(cartId);
    const source = normalizePulseSource(metadata.source ?? cartRow?.source);
    const eventType = String(event?.event_type ?? "");
    const createdAt = typeof event?.created_at === "string" ? event.created_at : "";
    const score = sourceEventPriority(eventType) * 10 + sourceQualityScore(source);
    const current = canonicalSourceByCart.get(cartId);
    if (!current || score > current.score || (score === current.score && createdAt > current.createdAt)) {
      canonicalSourceByCart.set(cartId, { source, score, createdAt });
    }
  };
  [...(rangeEvents ?? []), ...(rangeFeedEvents ?? []), ...(liveWindowEvents ?? []), ...(metricEvents ?? [])].forEach(considerCanonicalSource);
  const pulseSourceForEvent = (event: any) => {
    const cartId = typeof event?.cart_id === "string" ? event.cart_id.trim() : "";
    if (cartId && canonicalSourceByCart.has(cartId)) {
      return canonicalSourceByCart.get(cartId)!.source;
    }
    const metadata = eventMetadata(event);
    const cartRow = cartId ? cartById.get(cartId) : undefined;
    return normalizePulseSource(metadata.source ?? cartRow?.source);
  };
  const rangeByCart = new Map<string, any[]>();
  const liveByCart = new Map<string, any[]>();

  for (const event of rangeEvents ?? []) {
    if (!LIVE_PULSE_EVENT_TYPES.has(String(event.event_type ?? ""))) continue;
    const cartId = typeof event.cart_id === "string" ? event.cart_id.trim() : "";
    if (!cartId) continue;
    const metadata = eventMetadata(event);
    const cartRow = cartById.get(cartId);
    const embedLabel = resolvePulseEmbedLabel(
      metadata.embedLabel ?? cartRow?.embed_label,
      metadata.productName ?? cartRow?.product_name
    );
    if (embedLabels.length > 0 && !embedLabels.includes(embedLabel)) continue;
    const bucket = rangeByCart.get(cartId) ?? [];
    bucket.push(event);
    rangeByCart.set(cartId, bucket);
  }

  for (const event of [...(liveWindowEvents ?? [])].reverse()) {
    if (!LIVE_PULSE_EVENT_TYPES.has(String(event.event_type ?? ""))) continue;
    const cartId = typeof event.cart_id === "string" ? event.cart_id.trim() : "";
    if (!cartId) continue;
    const metadata = eventMetadata(event);
    const cartRow = cartById.get(cartId);
    const embedLabel = resolvePulseEmbedLabel(
      metadata.embedLabel ?? cartRow?.embed_label,
      metadata.productName ?? cartRow?.product_name
    );
    if (embedLabels.length > 0 && !embedLabels.includes(embedLabel)) continue;
    const bucket = liveByCart.get(cartId) ?? [];
    bucket.push(event);
    liveByCart.set(cartId, bucket);
  }

  const sourceStats = new Map<string, { source: string; viewed: number; interacted: number; submitted: number; lastSeenAt: string | null }>();
  const embedStats = new Map<string, { embedLabel: string; viewed: number; interacted: number; submitted: number; lastSeenAt: string | null }>();
  const touchSourceAndEmbedLastSeen = (event: any) => {
    const createdAt = typeof event?.created_at === "string" ? event.created_at : null;
    if (!createdAt || createdAt < selectedRange.startIso || createdAt >= selectedRange.endExclusiveIso) return;

    const cartId = typeof event?.cart_id === "string" ? event.cart_id.trim() : "";
    const metadata = eventMetadata(event);
    const cartRow = cartId ? cartById.get(cartId) : undefined;
    const source = pulseSourceForEvent(event);
    const embedLabel = resolvePulseEmbedLabel(
      metadata.embedLabel ?? cartRow?.embed_label,
      metadata.productName ?? cartRow?.product_name
    );
    if (embedLabels.length > 0 && !embedLabels.includes(embedLabel)) return;

    const sourceBucket = sourceStats.get(source) ?? { source, viewed: 0, interacted: 0, submitted: 0, lastSeenAt: null };
    if (!sourceBucket.lastSeenAt || createdAt > sourceBucket.lastSeenAt) {
      sourceBucket.lastSeenAt = createdAt;
      sourceStats.set(source, sourceBucket);
    }

    const embedBucket = embedStats.get(embedLabel) ?? { embedLabel, viewed: 0, interacted: 0, submitted: 0, lastSeenAt: null };
    if (!embedBucket.lastSeenAt || createdAt > embedBucket.lastSeenAt) {
      embedBucket.lastSeenAt = createdAt;
      embedStats.set(embedLabel, embedBucket);
    }
  };
  const pulseFeed = [...(rangeFeedEvents ?? [])]
    .filter((event) => PULSE_FEED_EVENT_TYPES.has(String(event.event_type ?? "")))
    .filter((event) => {
      if (embedLabels.length === 0) return true;
      const cartId = typeof event.cart_id === "string" ? event.cart_id.trim() : "";
      const metadata = eventMetadata(event);
      const cartRow = cartById.get(cartId);
      const embedLabel = resolvePulseEmbedLabel(
        metadata.embedLabel ?? cartRow?.embed_label,
        metadata.productName ?? cartRow?.product_name
      );
      return embedLabels.includes(embedLabel);
    })
    .slice(0, 12)
    .map((event) => {
      const cartId = typeof event.cart_id === "string" ? event.cart_id.trim() : "";
      const metadata = eventMetadata(event);
      const cartRow = cartById.get(cartId);
      const source = pulseSourceForEvent(event);
      const embedLabel = resolvePulseEmbedLabel(
        metadata.embedLabel ?? cartRow?.embed_label,
        metadata.productName ?? cartRow?.product_name
      );
      return {
        cartId,
        eventType: String(event.event_type ?? ""),
        source,
        embedLabel,
        productName: typeof metadata.productName === "string" && metadata.productName.trim()
          ? metadata.productName.trim()
          : (cartRow?.product_name ?? "Order form"),
        packageName: typeof metadata.packageName === "string" && metadata.packageName.trim()
          ? metadata.packageName.trim()
          : (cartRow?.package_name ?? null),
        createdAt: event.created_at
      };
    });

  const summary = {
    activeNow: 0,
    viewedToday: 0,
    interactedToday: 0,
    submitAttemptsToday: 0,
    conversionsToday: 0,
    redirectsToday: 0,
    viewedLiveWindow: 0,
    interactedLiveWindow: 0,
    submitAttemptsLiveWindow: 0,
    conversionsLiveWindow: 0,
    redirectsLiveWindow: 0,
    interactionRate: 0,
    submitRate: 0,
    conversionRate: 0,
    lastViewedAt: null as string | null,
    lastInteractionAt: null as string | null,
    lastSubmitAttemptAt: null as string | null,
    lastConversionAt: null as string | null,
    lastRedirectAt: null as string | null
  };
  const recountPulseMetricEvents = () => {
    const countedEventIds = new Set<string>();
    const convertedOrderKeys = new Set<string>();
    const metricCartStates = new Map<string, {
      source: string;
      embedLabel: string;
      hasView: boolean;
      hasInteraction: boolean;
      hasSubmitLike: boolean;
      latestSeenAt: string | null;
    }>();
    summary.viewedToday = 0;
    summary.interactedToday = 0;
    summary.submitAttemptsToday = 0;
    summary.conversionsToday = 0;
    summary.redirectsToday = 0;
    summary.lastViewedAt = null;
    summary.lastInteractionAt = null;
    summary.lastSubmitAttemptAt = null;
    summary.lastConversionAt = null;
    summary.lastRedirectAt = null;
    sourceStats.clear();
    embedStats.clear();

    for (const event of metricEvents ?? []) {
      const eventType = String(event?.event_type ?? "");
      const createdAt = typeof event?.created_at === "string" ? event.created_at : null;
      if (!createdAt || createdAt < selectedRange.startIso || createdAt >= selectedRange.endExclusiveIso) continue;
      if (!PULSE_METRIC_EVENT_TYPE_SET.has(eventType)) continue;

      const cartId = typeof event?.cart_id === "string" ? event.cart_id.trim() : "";
      const eventId = typeof event?.id === "string" ? event.id : "";
      const dedupeKey = eventId || `${cartId}:${eventType}:${createdAt}`;
      if (countedEventIds.has(dedupeKey)) continue;
      countedEventIds.add(dedupeKey);

      const metadata = eventMetadata(event);
      const cartRow = cartId ? cartById.get(cartId) : undefined;
      const source = pulseSourceForEvent(event);
      const embedLabel = resolvePulseEmbedLabel(
        metadata.embedLabel ?? cartRow?.embed_label,
        metadata.productName ?? cartRow?.product_name
      );
      if (embedLabels.length > 0 && !embedLabels.includes(embedLabel)) continue;

      const sourceBucket = sourceStats.get(source) ?? { source, viewed: 0, interacted: 0, submitted: 0, lastSeenAt: null };
      const embedBucket = embedStats.get(embedLabel) ?? { embedLabel, viewed: 0, interacted: 0, submitted: 0, lastSeenAt: null };
      if (!sourceBucket.lastSeenAt || createdAt > sourceBucket.lastSeenAt) {
        sourceBucket.lastSeenAt = createdAt;
      }
      if (!embedBucket.lastSeenAt || createdAt > embedBucket.lastSeenAt) {
        embedBucket.lastSeenAt = createdAt;
      }
      if (cartId) {
        const metricCartState = metricCartStates.get(cartId) ?? {
          source,
          embedLabel,
          hasView: false,
          hasInteraction: false,
          hasSubmitLike: false,
          latestSeenAt: null as string | null
        };
        metricCartState.source = source;
        metricCartState.embedLabel = embedLabel;
        metricCartState.latestSeenAt = !metricCartState.latestSeenAt || createdAt > metricCartState.latestSeenAt ? createdAt : metricCartState.latestSeenAt;
        if (eventType === "form_opened") metricCartState.hasView = true;
        if (eventType === "first_interaction") metricCartState.hasInteraction = true;
        if (eventType === "submit_attempted" || eventType === "order_submitted") metricCartState.hasSubmitLike = true;
        metricCartStates.set(cartId, metricCartState);
      }

      if (eventType === "form_opened") {
        summary.viewedToday += 1;
        sourceBucket.viewed += 1;
        embedBucket.viewed += 1;
        summary.lastViewedAt = !summary.lastViewedAt || createdAt > summary.lastViewedAt ? createdAt : summary.lastViewedAt;
      }
      if (eventType === "first_interaction") {
        summary.interactedToday += 1;
        sourceBucket.interacted += 1;
        embedBucket.interacted += 1;
        summary.lastInteractionAt = !summary.lastInteractionAt || createdAt > summary.lastInteractionAt ? createdAt : summary.lastInteractionAt;
      }
      if (eventType === "submit_attempted") {
        summary.submitAttemptsToday += 1;
        summary.lastSubmitAttemptAt = !summary.lastSubmitAttemptAt || createdAt > summary.lastSubmitAttemptAt ? createdAt : summary.lastSubmitAttemptAt;
      }
      if (eventType === "order_submitted") {
        // Count DISTINCT orders, not raw order_submitted events. The form can log
        // order_submitted more than once for the SAME order (network retry,
        // outage re-send, upsell accept), which previously inflated "Orders"
        // above the submit-tries / redirects counts (an impossible funnel).
        // Dedupe on the order id (then cart id) so one order = one conversion.
        const orderKey = String(
          (metadata as Record<string, unknown>).orderId
            ?? (metadata as Record<string, unknown>).order_id
            ?? cartId
            ?? eventId
            ?? ""
        ).trim();
        if (orderKey && !convertedOrderKeys.has(orderKey)) {
          convertedOrderKeys.add(orderKey);
          summary.conversionsToday += 1;
          sourceBucket.submitted += 1;
          embedBucket.submitted += 1;
        }
        summary.lastConversionAt = !summary.lastConversionAt || createdAt > summary.lastConversionAt ? createdAt : summary.lastConversionAt;
      }
      if (eventType === "redirect_triggered") {
        summary.redirectsToday += 1;
        summary.lastRedirectAt = !summary.lastRedirectAt || createdAt > summary.lastRedirectAt ? createdAt : summary.lastRedirectAt;
      }

      sourceStats.set(source, sourceBucket);
      embedStats.set(embedLabel, embedBucket);
    }

    // Some embeds, ad browsers, and cached landing pages can miss the early
    // browser pulse while the backend still receives the final order. Keep the
    // funnel truthful at source level: a cart with an interaction/submit/order
    // necessarily had at least one view, and a cart with a submit/order
    // necessarily had at least one interaction.
    for (const metricCartState of metricCartStates.values()) {
      const sourceBucket = sourceStats.get(metricCartState.source) ?? {
        source: metricCartState.source,
        viewed: 0,
        interacted: 0,
        submitted: 0,
        lastSeenAt: metricCartState.latestSeenAt
      };
      const embedBucket = embedStats.get(metricCartState.embedLabel) ?? {
        embedLabel: metricCartState.embedLabel,
        viewed: 0,
        interacted: 0,
        submitted: 0,
        lastSeenAt: metricCartState.latestSeenAt
      };
      if (metricCartState.latestSeenAt && (!sourceBucket.lastSeenAt || metricCartState.latestSeenAt > sourceBucket.lastSeenAt)) {
        sourceBucket.lastSeenAt = metricCartState.latestSeenAt;
      }
      if (metricCartState.latestSeenAt && (!embedBucket.lastSeenAt || metricCartState.latestSeenAt > embedBucket.lastSeenAt)) {
        embedBucket.lastSeenAt = metricCartState.latestSeenAt;
      }
      if ((metricCartState.hasInteraction || metricCartState.hasSubmitLike) && !metricCartState.hasView) {
        summary.viewedToday += 1;
        sourceBucket.viewed += 1;
        embedBucket.viewed += 1;
        summary.lastViewedAt = metricCartState.latestSeenAt && (!summary.lastViewedAt || metricCartState.latestSeenAt > summary.lastViewedAt)
          ? metricCartState.latestSeenAt
          : summary.lastViewedAt;
      }
      if (metricCartState.hasSubmitLike && !metricCartState.hasInteraction) {
        summary.interactedToday += 1;
        sourceBucket.interacted += 1;
        embedBucket.interacted += 1;
        summary.lastInteractionAt = metricCartState.latestSeenAt && (!summary.lastInteractionAt || metricCartState.latestSeenAt > summary.lastInteractionAt)
          ? metricCartState.latestSeenAt
          : summary.lastInteractionAt;
      }
      sourceStats.set(metricCartState.source, sourceBucket);
      embedStats.set(metricCartState.embedLabel, embedBucket);
    }
  };

  for (const [cartId, events] of rangeByCart.entries()) {
    const cartRow = cartById.get(cartId);
    const latestSource = canonicalSourceByCart.get(cartId)?.source ?? normalizePulseSource(
      [...events].reverse().map((event) => eventMetadata(event).source).find((value) => typeof value === "string" && value.trim()) ?? cartRow?.source
    );
    const sourceBucket = sourceStats.get(latestSource) ?? { source: latestSource, viewed: 0, interacted: 0, submitted: 0, lastSeenAt: null };
    const latestEmbedLabel = resolvePulseEmbedLabel(
      [...events].reverse().map((event) => event?.metadata?.embedLabel).find((value) => typeof value === "string" && value.trim()) ?? cartRow?.embed_label,
      [...events].reverse().map((event) => event?.metadata?.productName).find((value) => typeof value === "string" && value.trim()) ?? cartRow?.product_name
    );
    const embedBucket = embedStats.get(latestEmbedLabel) ?? { embedLabel: latestEmbedLabel, viewed: 0, interacted: 0, submitted: 0, lastSeenAt: null };

    let hasView = false;
    let hasInteraction = false;
    let hasSubmitAttempt = false;
    let hasConversion = false;
    let hasRedirect = false;

    for (const event of events) {
      const eventType = String(event.event_type ?? "");
      const createdAt = typeof event.created_at === "string" ? event.created_at : null;
      if (eventType === "form_opened") {
        hasView = true;
        summary.lastViewedAt = createdAt && (!summary.lastViewedAt || createdAt > summary.lastViewedAt) ? createdAt : summary.lastViewedAt;
      }
      if (isInteractionEvent(eventType)) {
        hasInteraction = true;
        summary.lastInteractionAt = createdAt && (!summary.lastInteractionAt || createdAt > summary.lastInteractionAt) ? createdAt : summary.lastInteractionAt;
      }
      if (eventType === "submit_attempted") {
        hasSubmitAttempt = true;
        summary.lastSubmitAttemptAt = createdAt && (!summary.lastSubmitAttemptAt || createdAt > summary.lastSubmitAttemptAt) ? createdAt : summary.lastSubmitAttemptAt;
      }
      if (eventType === "order_submitted") {
        hasConversion = true;
        summary.lastConversionAt = createdAt && (!summary.lastConversionAt || createdAt > summary.lastConversionAt) ? createdAt : summary.lastConversionAt;
      }
      if (eventType === "redirect_triggered") {
        hasRedirect = true;
        summary.lastRedirectAt = createdAt && (!summary.lastRedirectAt || createdAt > summary.lastRedirectAt) ? createdAt : summary.lastRedirectAt;
      }
      if (createdAt && (!sourceBucket.lastSeenAt || createdAt > sourceBucket.lastSeenAt)) {
        sourceBucket.lastSeenAt = createdAt;
      }
      if (createdAt && (!embedBucket.lastSeenAt || createdAt > embedBucket.lastSeenAt)) {
        embedBucket.lastSeenAt = createdAt;
      }
    }

    if (hasView) {
      summary.viewedToday += 1;
      sourceBucket.viewed += 1;
      embedBucket.viewed += 1;
    }
    if (hasInteraction) {
      summary.interactedToday += 1;
      sourceBucket.interacted += 1;
      embedBucket.interacted += 1;
    }
    if (hasSubmitAttempt) summary.submitAttemptsToday += 1;
    if (hasConversion) {
      summary.conversionsToday += 1;
      sourceBucket.submitted += 1;
      embedBucket.submitted += 1;
    }
    if (hasRedirect) summary.redirectsToday += 1;

    sourceStats.set(latestSource, sourceBucket);
    embedStats.set(latestEmbedLabel, embedBucket);
  }

  // The live pulse is a traffic meter, so visible counts must reflect actual
  // journey events. The cart-group pass above is kept for active-cart context,
  // but it undercounts repeat page opens on the same cart.
  recountPulseMetricEvents();

  for (const [, events] of liveByCart.entries()) {
    const lastEvent = events[events.length - 1];
    const latestCreatedAt = typeof lastEvent?.created_at === "string" ? lastEvent.created_at : null;
    const latestEventType = String(lastEvent?.event_type ?? "");
    const inActiveWindow = Boolean(latestCreatedAt && latestCreatedAt >= activeSinceIso);
    if (inActiveWindow && latestEventType !== "form_exited" && latestEventType !== "order_submitted" && latestEventType !== "redirect_triggered") {
      summary.activeNow += 1;
    }

    const liveEventTypes = new Set(events.filter((event) => typeof event.created_at === "string" && event.created_at >= activeSinceIso).map((event) => String(event.event_type ?? "")));
    if (liveEventTypes.has("form_opened")) summary.viewedLiveWindow += 1;
    if ([...liveEventTypes].some((eventType) => isInteractionEvent(eventType))) summary.interactedLiveWindow += 1;
    if (liveEventTypes.has("submit_attempted")) summary.submitAttemptsLiveWindow += 1;
    if (liveEventTypes.has("order_submitted")) summary.conversionsLiveWindow += 1;
    if (liveEventTypes.has("redirect_triggered")) summary.redirectsLiveWindow += 1;

    // Overlay the freshest event timestamps on summary.last*At. The earlier
    // pass over rangeByCart can miss the most recent events on busy days
    // because the range query has no .limit() and Supabase silently caps it
    // at 1000 rows ascending — meaning busy orgs only see the oldest 1000
    // events of the day and summary.lastViewedAt ends up ~1h after the
    // day started. liveByCart comes from a DESC-ordered, last-24h query
    // that always carries the truly latest events, so we use it to keep
    // "Last seen live" honest even when rangeEvents is truncated.
    // Clipped to selectedRange so a quiet "Today" doesn't inherit yesterday's
    // last activity from the broader 24h window.
    for (const event of events) {
      const eventType = String(event.event_type ?? "");
      const createdAt = typeof event.created_at === "string" ? event.created_at : null;
      if (!createdAt) continue;
      if (createdAt < selectedRange.startIso || createdAt >= selectedRange.endExclusiveIso) continue;
      touchSourceAndEmbedLastSeen(event);
      if (eventType === "form_opened" && (!summary.lastViewedAt || createdAt > summary.lastViewedAt)) {
        summary.lastViewedAt = createdAt;
      }
      if (isInteractionEvent(eventType) && (!summary.lastInteractionAt || createdAt > summary.lastInteractionAt)) {
        summary.lastInteractionAt = createdAt;
      }
      if (eventType === "submit_attempted" && (!summary.lastSubmitAttemptAt || createdAt > summary.lastSubmitAttemptAt)) {
        summary.lastSubmitAttemptAt = createdAt;
      }
      if (eventType === "order_submitted" && (!summary.lastConversionAt || createdAt > summary.lastConversionAt)) {
        summary.lastConversionAt = createdAt;
      }
      if (eventType === "redirect_triggered" && (!summary.lastRedirectAt || createdAt > summary.lastRedirectAt)) {
        summary.lastRedirectAt = createdAt;
      }
    }
  }

  summary.interactionRate = summary.viewedToday > 0 ? Math.round((summary.interactedToday / summary.viewedToday) * 100) : 0;
  summary.submitRate = summary.interactedToday > 0 ? Math.round((summary.submitAttemptsToday / summary.interactedToday) * 100) : 0;
  summary.conversionRate = summary.viewedToday > 0 ? Math.round((summary.conversionsToday / summary.viewedToday) * 100) : 0;

  const health = (() => {
    if (summary.viewedLiveWindow === 0 && summary.lastViewedAt) {
      return { status: "quiet", message: "No fresh form views in the live window. Check ad traffic or landing-page reach." };
    }
    if (summary.viewedLiveWindow > 0 && summary.interactedLiveWindow === 0) {
      return { status: "attention", message: "Views are coming in, but almost nobody is interacting yet." };
    }
    if (summary.submitAttemptsLiveWindow > 0 && summary.conversionsLiveWindow === 0) {
      return { status: "attention", message: "Customers are trying to submit, but no completed orders have landed in the live window." };
    }
    if (summary.viewedLiveWindow > 0) {
      return { status: "healthy", message: "The order form is receiving live traffic and still moving customers forward." };
    }
    return { status: "idle", message: "Waiting for fresh landing-page traffic." };
  })();

  const payload = {
    generatedAt: new Date().toISOString(),
    activeWindowMinutes,
    dateFrom: selectedRange.dateFrom,
    dateTo: selectedRange.dateTo,
    summary,
    health,
    sources: [...sourceStats.values()].sort((a, b) => b.viewed - a.viewed || b.submitted - a.submitted),
    embeds: [...embedStats.values()].sort((a, b) => b.viewed - a.viewed || b.submitted - a.submitted),
    recentEvents: pulseFeed
  };

  livePulseCache.set(cacheKey, { expiresAt: Date.now() + LIVE_PULSE_CACHE_TTL_MS, payload });
  res.setHeader("Cache-Control", "private, max-age=20");
  res.setHeader("X-Protohub-Cache", "MISS");
  res.json(payload);
});

// ── GET /api/carts/:id/journey ──────────────────────────
// Returns the public-form activity timeline for a draft/converted cart.
router.get("/:id/journey", async (req, res) => {
  let cartQuery = supabase
    .from("abandoned_carts")
    .select("id, org_id, assigned_rep_id")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId);

  if (scopeOf(req).role === "Sales Rep") {
    cartQuery = cartQuery.eq("assigned_rep_id", scopeOf(req).id);
  }

  const { data: cart, error: cartError } = await cartQuery.maybeSingle();
  if (cartError) {
    res.status(500).json({ error: cartError.message });
    return;
  }
  if (!cart) {
    res.status(404).json({ error: "Cart not found." });
    return;
  }

  const { data, error } = await supabase
    .from("cart_journey_events")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .eq("cart_id", req.params.id)
    .order("created_at", { ascending: true });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(data ?? []);
});

// ── PATCH /api/carts/:id ─────────────────────────────────
// Update status, assigned rep, etc.
//
// Accepts both snake_case (assigned_rep_id) and camelCase (assignedRepId).
// The frontend hydrates carts as camelCase via the snake→camel normalizer,
// so callers naturally hold camelCase ids — making the schema accept both
// avoids a class of "patch silently noop'd" bugs.
const CartPatchSchema = z.object({
  status:          z.enum(["Open abandoned", "Assigned", "Contacted", "Converted", "Lost"]).optional(),
  assigned_rep_id: z.string().uuid().optional().nullable(),
  assignedRepId:   z.string().uuid().optional().nullable(),
  last_activity:   z.string().optional(),
  lastActivity:    z.string().optional()
}).strict();

const CartDatePatchSchema = z.object({
  createdAt: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(3).max(500)
}).strict();

// ── Cart follow-up log (migration 202) ────────────────────
const CART_ATTEMPTS = "cart_contact_attempts";

/** Outcomes that end the chase, so the cart's status can follow the last call. */
const CART_OUTCOME_STATUS: Record<string, string> = {
  "Not interested": "Not interested",
  "Wrong number": "No response",
  "Unresponsive": "No response",
  "Number not reachable": "No response",
  "Interested": "Contacted",
  "Wants to order now": "Contacted",
  "Asked to call back": "Contacted",
  "Price concern": "Contacted"
};

const AttemptSchema = z.object({
  channel: z.enum(["Call", "WhatsApp", "SMS", "Email", "Other"]).default("Call"),
  outcomeCode: z.enum([
    "Interested", "Not interested", "Unresponsive", "Number not reachable",
    "Asked to call back", "Wants to order now", "Price concern", "Wrong number", "Other"
  ]),
  customOutcome: z.string().trim().max(160).optional(),
  outcomeNote: z.string().trim().max(1000).optional(),
  customerReached: z.boolean().optional(),
  nextActionAt: z.string().trim().max(40).optional()
}).superRefine((value, ctx) => {
  // "Other" with no words is unreportable - it tells the next person nothing.
  if (value.outcomeCode === "Other" && !value.customOutcome?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customOutcome"], message: "Describe the outcome." });
  }
});

router.get("/:id/contact-attempts",
  requireRole("Owner", "Admin", "Manager", "Sales Rep"),
  async (req, res) => {
    const { data, error } = await supabase.from(CART_ATTEMPTS)
      .select("*").eq("org_id", req.user!.orgId).eq("cart_id", req.params.id)
      .order("attempted_at", { ascending: false });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ rows: data ?? [] });
  }
);

router.post("/:id/contact-attempts",
  requireRole("Owner", "Admin", "Manager", "Sales Rep"),
  async (req, res) => {
    const parsed = AttemptSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    try {
      const orgId = req.user!.orgId;
      const { data: cart } = await supabase.from("abandoned_carts")
        .select("id, status, assigned_rep_id").eq("org_id", orgId).eq("id", req.params.id).maybeSingle();
      if (!cart) { res.status(404).json({ error: "Cart not found." }); return; }

      // A rep may only log against their own cart. Otherwise one rep's work
      // could land on another's record and their follow-up numbers would be
      // someone else's.
      const { role: scopeRole, id: scopeId } = scopeOf(req);
      if (scopeRole === "Sales Rep" && cart.assigned_rep_id !== scopeId) {
        res.status(403).json({ error: "That cart is not assigned to you." });
        return;
      }

      const { data, error } = await supabase.from(CART_ATTEMPTS).insert({
        org_id: orgId,
        cart_id: req.params.id,
        rep_id: cart.assigned_rep_id ?? scopeId,
        rep_name: req.user!.name,
        channel: parsed.data.channel,
        outcome_code: parsed.data.outcomeCode,
        custom_outcome: parsed.data.customOutcome ?? null,
        outcome_note: parsed.data.outcomeNote ?? null,
        customer_reached: parsed.data.customerReached ?? false,
        next_action_at: parsed.data.nextActionAt || null
      }).select("*").single();
      if (error) { res.status(500).json({ error: error.message }); return; }

      // Move the cart's status to match the latest outcome, but never overwrite
      // Converted - a sale already made is not undone by a later phone call.
      const nextStatus = CART_OUTCOME_STATUS[parsed.data.outcomeCode];
      if (nextStatus && cart.status !== "Converted") {
        await supabase.from("abandoned_carts")
          .update({ status: nextStatus, last_activity: new Date().toISOString() })
          .eq("org_id", orgId).eq("id", req.params.id);
      } else {
        await supabase.from("abandoned_carts")
          .update({ last_activity: new Date().toISOString() })
          .eq("org_id", orgId).eq("id", req.params.id);
      }

      res.status(201).json({ row: data, statusMovedTo: cart.status === "Converted" ? null : nextStatus ?? null });
    } catch (error: any) {
      res.status(500).json({ error: error?.message ?? "Could not log that follow-up." });
    }
  }
);

// ── GET /api/carts/follow-up-grid ─────────────────────────
// Assigned carts as rows, the week's working days as columns - the same
// day-by-day shape as the order follow-up grid, so a rep reads one layout.
//
// Deliberately WITHOUT the miss/penalty machinery. The N50-a-day KPI is defined
// for orders; carts have no such rule, and inventing one here would charge reps
// against a target nobody set.
const CART_WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
router.get("/follow-up-grid",
  requireRole("Owner", "Admin", "Manager", "Sales Rep"),
  async (req, res) => {
    try {
      const orgId = req.user!.orgId;
      const scopeRepId = scopeOf(req).role === "Sales Rep" ? scopeOf(req).id : null;
      const requestedRep = typeof req.query.repId === "string" && req.query.repId ? req.query.repId : null;
      const repFilter = scopeRepId ?? requestedRep;

      const todayKey = lagosDateKey(new Date());
      const weekStart = typeof req.query.weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.weekStart)
        ? req.query.weekStart
        : mondayOfWeek(todayKey);
      // Mon-Sat, matching the order grid. Sundays are off.
      const days = Array.from({ length: 6 }, (_, i) => {
        const key = addDays(weekStart, i);
        return { key, label: `${CART_WEEKDAY_SHORT[dowOf(key)]} ${Number(key.slice(8, 10))}`, isToday: key === todayKey };
      });

      let cartQuery = supabase.from("abandoned_carts")
        .select("id, customer, phone, whatsapp, status, amount, currency, product_name, package_name, city, state, assigned_rep_id, assigned_at, created_at, last_activity, left_at, quantity:capture_payload->>packageQuantity")
        .eq("org_id", orgId)
        .not("assigned_rep_id", "is", null);
      if (repFilter) cartQuery = cartQuery.eq("assigned_rep_id", repFilter);
      const { data: carts } = await cartQuery.order("created_at", { ascending: false }).limit(500);
      const rows = carts ?? [];
      const cartIds = rows.map((row: any) => row.id);

      if (cartIds.length === 0) {
        res.json({ weekStart, isCurrentWeek: weekStart === mondayOfWeek(todayKey), todayKey, days, rows: [] });
        return;
      }

      const { data: attempts } = await supabase.from(CART_ATTEMPTS)
        .select("cart_id, channel, outcome_code, custom_outcome, outcome_note, customer_reached, attempted_at, rep_name")
        .eq("org_id", orgId).in("cart_id", cartIds)
        .gte("attempted_at", lagosStartOfDayUtc(weekStart))
        .lt("attempted_at", lagosStartOfDayUtc(addDays(weekStart, 6)))
        .order("attempted_at", { ascending: true });

      // One bucket per cart+day. Ascending order means the last write wins, so a
      // cell shows the day's FINAL outcome rather than its first.
      const byCartDay = new Map<string, any>();
      for (const a of (attempts ?? []) as any[]) {
        const key = `${a.cart_id}|${lagosDateKey(a.attempted_at)}`;
        const cell = byCartDay.get(key) ?? { attempts: 0, channels: [] as string[], reached: false, outcome: null, entries: [] as any[] };
        cell.attempts++;
        if (a.channel && !cell.channels.includes(a.channel)) cell.channels.push(a.channel);
        if (a.customer_reached) cell.reached = true;
        const label = a.outcome_code === "Other" ? (a.custom_outcome || "Other") : a.outcome_code;
        cell.outcome = label;
        cell.entries.push({
          attemptedAt: a.attempted_at, outcome: label, channel: a.channel,
          reached: Boolean(a.customer_reached), note: a.outcome_note ?? null, repName: a.rep_name ?? null
        });
        byCartDay.set(key, cell);
      }

      const { data: users } = await supabase.from("users").select("id, name").eq("org_id", orgId);
      const nameById = new Map((users ?? []).map((u: any) => [u.id, u.name]));

      const { data: linkedOrders } = await supabase.from("orders")
        .select("id, source_cart_id, status").eq("org_id", orgId).in("source_cart_id", cartIds);
      const orderByCart = new Map((linkedOrders ?? []).map((o: any) => [o.source_cart_id, o]));

      // The grid's own attempts query is scoped to the displayed week, which is
      // right for drawing the cells and wrong for deciding whether a cart is
      // finished. A customer who said "not interested" last month is still not
      // interested this week. So the closed/stale signals need the latest
      // attempt whenever it happened, not just one week of them.
      const { data: latestAttempts } = await supabase.from(CART_ATTEMPTS)
        .select("cart_id, outcome_code, custom_outcome, outcome_note, attempted_at, next_action_at, rep_name")
        .eq("org_id", orgId).in("cart_id", cartIds)
        .order("attempted_at", { ascending: false });
      const latestEverByCart = new Map<string, any>();
      // Every attempt ever, not just this week's - a cart carried in from an
      // earlier week would otherwise read as untouched on the row, and a rep
      // would call someone who already told them the price was too high.
      const attemptsEverByCart = new Map<string, number>();
      for (const attempt of (latestAttempts ?? []) as any[]) {
        if (!latestEverByCart.has(attempt.cart_id)) latestEverByCart.set(attempt.cart_id, attempt);
        attemptsEverByCart.set(attempt.cart_id, (attemptsEverByCart.get(attempt.cart_id) ?? 0) + 1);
      }

      res.json({
        weekStart,
        isCurrentWeek: weekStart === mondayOfWeek(todayKey),
        todayKey,
        days,
        rows: rows.map((row: any) => {
          const cells: Record<string, any> = {};
          for (const day of days) {
            const cell = byCartDay.get(`${row.id}|${day.key}`);
            if (cell) cells[day.key] = cell;
          }
          const order = orderByCart.get(row.id) ?? null;
          // Same rule as the overview endpoint: a cart stops asking for logs
          // once the order landed, the customer said no, or the number was
          // never theirs. Everything else stays workable and keeps asking.
          const latestEver = latestEverByCart.get(row.id) ?? null;
          const lastOutcomeCode = latestEver?.outcome_code ?? null;
          const closedReason = order?.status === "Delivered" ? "Delivered"
            : lastOutcomeCode === "Interested" ? "Interested"
            : (lastOutcomeCode === "Not interested" || row.status === "Not interested") ? "Not interested"
            : lastOutcomeCode === "Wrong number" ? "Wrong number"
            : null;
          const lastTouch = latestEver?.attempted_at ?? row.assigned_at ?? row.created_at ?? null;
          const staleDays = closedReason || !lastTouch
            ? 0
            : Math.max(0, Math.floor((Date.now() - new Date(lastTouch).getTime()) / 86400000));

          // A promised callback is a different kind of debt from a cart nobody
          // has got to yet. The customer was TOLD someone would ring on a day,
          // so missing it costs more than a generically stale row - it is
          // ranked accordingly rather than lumped in with "needs a log".
          const nextActionAt = latestEver?.next_action_at ?? null;
          const nextActionKey = nextActionAt ? lagosDateKey(nextActionAt) : null;
          const urgency = closedReason ? null
            : nextActionKey && nextActionKey < todayKey ? "promise-overdue"
            : nextActionKey && nextActionKey === todayKey ? "promise-today"
            : !latestEver ? "never-contacted"
            : staleDays >= 2 ? "stale"
            : null;
          return {
            id: row.id,
            customer: row.customer,
            phone: row.phone,
            whatsapp: row.whatsapp ?? null,
            productName: row.product_name ?? null,
            packageName: row.package_name ?? null,
            amount: Number(row.amount ?? 0),
            currency: row.currency ?? "NGN",
            city: row.city ?? null,
            state: row.state ?? null,
            status: row.status,
            repId: row.assigned_rep_id,
            repName: nameById.get(row.assigned_rep_id) ?? "Unknown rep",
            assignedAt: row.assigned_at ?? null,
            createdAt: row.created_at,
            // How many pieces they were trying to buy. Comes from the form
            // capture, so it is what the customer actually chose - a 6-piece
            // cart is worth a different call to a 1-piece one.
            quantity: row.quantity ? Number(row.quantity) : null,
            // The cart's own arrival day, so a cell before it can be shown as
            // "not yet a cart" rather than a day the rep failed to call.
            createdKey: lagosDateKey(row.left_at || row.created_at),
            convertedOrderId: order?.id ?? null,
            convertedOrderStatus: order?.status ?? null,
            closed: Boolean(closedReason),
            closedReason,
            neverContacted: !latestEver && !closedReason,
            staleDays,
            nextActionAt,
            urgency,
            // What was already said, carried onto the row so the history is
            // readable without opening every cart. The modal still holds the
            // full trail.
            attempts: attemptsEverByCart.get(row.id) ?? 0,
            lastOutcome: latestEver?.custom_outcome || latestEver?.outcome_code || null,
            lastOutcomeNote: latestEver?.outcome_note ?? null,
            lastAttemptAt: latestEver?.attempted_at ?? null,
            lastAttemptBy: latestEver?.rep_name ?? null,
            // A promised callback that is due or missed needs working even if
            // the cart was touched yesterday, so it counts as needing a log.
            needsLog: Boolean(urgency),
            cells
          };
        })
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message ?? "Could not load the cart follow-up grid." });
    }
  }
);

// ── GET /api/carts/follow-up-overview ─────────────────────
// Two audiences, one shape. A supervisor sees every assigned cart, so "is this
// rep updating their own carts" is answerable without opening them one by one.
// A Sales Rep sees only their own - this is their work list.
router.get("/follow-up-overview",
  requireRole("Owner", "Admin", "Manager", "Sales Rep"),
  async (req, res) => {
    try {
      const orgId = req.user!.orgId;
      // Scoped HERE, not in the browser. A rep's own carts are decided by the
      // server so no client can ask for somebody else's follow-up record.
      const scopeRepId = scopeOf(req).role === "Sales Rep" ? scopeOf(req).id : null;

      // The whole cart, not a summary. A rep about to call needs the contact
      // details and what was in the cart in front of them; a supervisor
      // deciding whether the follow-up was any good needs the same context.
      let cartQuery = supabase.from("abandoned_carts")
        .select("id, customer, phone, whatsapp, email, city, state, address, preferred_delivery, status, amount, currency, product_id, product_name, package_name, source, embed_label, assigned_rep_id, assigned_at, created_at, last_activity, left_at, recovery_sent_at, quantity:capture_payload->>packageQuantity")
        .eq("org_id", orgId)
        .not("assigned_rep_id", "is", null);
      if (scopeRepId) cartQuery = cartQuery.eq("assigned_rep_id", scopeRepId);
      const { data: carts } = await cartQuery
        .order("last_activity", { ascending: false })
        .limit(500);
      const rows = carts ?? [];
      const cartIds = rows.map((row: any) => row.id);

      const { data: attempts } = cartIds.length
        ? await supabase.from(CART_ATTEMPTS)
            .select("cart_id, outcome_code, custom_outcome, outcome_note, attempted_at, rep_name, customer_reached, next_action_at")
            .eq("org_id", orgId).in("cart_id", cartIds)
            .order("attempted_at", { ascending: false })
        : { data: [] as any[] };

      const latestByCart = new Map<string, any>();
      const countByCart = new Map<string, number>();
      for (const attempt of (attempts ?? []) as any[]) {
        countByCart.set(attempt.cart_id, (countByCart.get(attempt.cart_id) ?? 0) + 1);
        if (!latestByCart.has(attempt.cart_id)) latestByCart.set(attempt.cart_id, attempt);
      }

      const { data: users } = await supabase.from("users").select("id, name").eq("org_id", orgId);
      const nameById = new Map((users ?? []).map((u: any) => [u.id, u.name]));

      const { data: linkedOrders } = cartIds.length
        ? await supabase.from("orders")
            .select("id, source_cart_id, status, amount, currency, created_at")
            .limit(REPORT_ROW_CEILING)
            .eq("org_id", orgId).in("source_cart_id", cartIds)
        : { data: [] as any[] };
      const orderByCart = new Map((linkedOrders ?? []).map((o: any) => [o.source_cart_id, o]));

      res.json({
        rows: rows.map((row: any) => {
          const latest = latestByCart.get(row.id) ?? null;
          const order = orderByCart.get(row.id) ?? null;

          // A cart stops asking for follow-up logs once it has actually
          // finished: the order landed, the customer said no, or the number was
          // never theirs. Everything else - price concern, call back, silence -
          // is still workable and keeps asking, because those are the ones a
          // rep is supposed to come back to.
          //
          // Deliberately NOT a lock. The flag only changes what the row shows;
          // logging stays available, because a "not interested" who rings back
          // next month must be recordable without an admin unpicking anything.
          const lastOutcomeCode = latest?.outcome_code ?? null;
          const closedReason = order?.status === "Delivered" ? "Delivered"
            : (lastOutcomeCode === "Not interested" || row.status === "Not interested") ? "Not interested"
            : lastOutcomeCode === "Wrong number" ? "Wrong number"
            : null;

          // How long this cart has gone untouched. Drives the nudge in the UI -
          // the whole problem being that fresh carts get worked and older ones
          // quietly rot.
          const lastTouch = latest?.attempted_at ?? row.assigned_at ?? row.created_at ?? null;
          const staleDays = closedReason || !lastTouch
            ? 0
            : Math.max(0, Math.floor((Date.now() - new Date(lastTouch).getTime()) / 86400000));

          return {
            id: row.id,
            customer: row.customer,
            phone: row.phone,
            whatsapp: row.whatsapp ?? null,
            email: row.email ?? null,
            city: row.city ?? null,
            state: row.state ?? null,
            address: row.address ?? null,
            preferredDelivery: row.preferred_delivery ?? null,
            productId: row.product_id ?? null,
            productName: row.package_name || row.product_name,
            baseProductName: row.product_name ?? null,
            packageName: row.package_name ?? null,
            amount: Number(row.amount ?? 0),
            currency: row.currency ?? "NGN",
            quantity: row.quantity ? Number(row.quantity) : null,
            source: row.source ?? null,
            embedLabel: row.embed_label ?? null,
            leftAt: row.left_at ?? null,
            recoverySentAt: row.recovery_sent_at ?? null,
            status: row.status,
            repId: row.assigned_rep_id,
            repName: nameById.get(row.assigned_rep_id) ?? "Unknown rep",
            assignedAt: row.assigned_at ?? null,
            createdAt: row.created_at,
            lastActivity: row.last_activity,
            attempts: countByCart.get(row.id) ?? 0,
            lastOutcome: latest
              ? (latest.outcome_code === "Other" ? latest.custom_outcome : latest.outcome_code)
              : null,
            lastOutcomeNote: latest?.outcome_note ?? null,
            lastAttemptAt: latest?.attempted_at ?? null,
            lastAttemptBy: latest?.rep_name ?? null,
            nextActionAt: latest?.next_action_at ?? null,
            closed: Boolean(closedReason),
            closedReason,
            neverContacted: !latest && !closedReason,
            staleDays,
            // Nothing logged yet, or nothing for two days.
            needsLog: !closedReason && (!latest || staleDays >= 2),
            convertedOrderId: order?.id ?? null,
            convertedOrderStatus: order?.status ?? null,
            convertedOrderAmount: order ? Number(order.amount ?? 0) : null,
            convertedOrderCurrency: order?.currency ?? null,
            convertedOrderAt: order?.created_at ?? null
          };
        })
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message ?? "Could not load cart follow-ups." });
    }
  }
);

router.patch("/:id",
  requireRole("Owner", "Admin", "Sales Rep"),
  async (req, res) => {
    const parsed = CartPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: humanFieldErrors(parsed.error) });
      return;
    }
    const updates: Record<string, unknown> = {};
    const { data: existing, error: existingError } = await supabase
      .from("abandoned_carts")
      .select("id, customer, phone, product_name, package_name, amount, currency, assigned_rep_id, status")
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .single();
    if (existingError || !existing) {
      res.status(404).json({ error: "Cart not found." });
      return;
    }
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    const repId = parsed.data.assigned_rep_id ?? parsed.data.assignedRepId;
    if (repId !== undefined) {
      // Validate assigned rep belongs to this org
      if (repId) {
        const { data: repCheck } = await supabase
          .from("users").select("id").eq("id", repId).eq("org_id", req.user!.orgId).single();
        if (!repCheck) {
          res.status(400).json({ error: "Rep not found in your organization." });
          return;
        }
      }
      updates.assigned_rep_id = repId;
      // Stamp WHEN, not only who. Only set on a genuine change of hands, so
      // re-saving a cart does not reset the clock a supervisor is reading; and
      // cleared on unassign, since a cart back in the pool has no owner to
      // have been holding it.
      if (repId && repId !== existing.assigned_rep_id) {
        updates.assigned_at = new Date().toISOString();
      } else if (!repId) {
        updates.assigned_at = null;
      }
    }

    // Keep status and assignee honest about each other. A cart reading
    // "Assigned" with nobody assigned is worse than an unassigned one: it looks
    // handled, so nobody picks it up. Production had exactly one of these.
    const resultingRepId = repId !== undefined ? repId : existing.assigned_rep_id;
    const resultingStatus = (updates.status as string | undefined) ?? existing.status;
    if (resultingStatus === "Assigned" && !resultingRepId) {
      if (repId !== undefined && !repId) {
        // Unassigning: send it back to the pool rather than refusing.
        updates.status = "Open abandoned";
      } else {
        res.status(400).json({ error: "Choose a sales rep before marking a cart assigned." });
        return;
      }
    }

    updates.last_activity = new Date().toISOString();

    const { data, error } = await supabase
      .from("abandoned_carts")
      .update(updates)
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "Cart not found." }); return; }

    const repChanged = repId !== undefined && repId && repId !== existing.assigned_rep_id;
    const newlyAssigned = data.status === "Assigned" || updates.status === "Assigned";
    if (repChanged && newlyAssigned && data.phone?.trim()) {
      void sendCartAssignedSms(req.user!.orgId, {
        id: data.id,
        customer: data.customer ?? "Customer",
        phone: data.phone,
        product_name: data.product_name ?? "your requested item",
        package_name: data.package_name ?? null,
        amount: Number(data.amount ?? 0),
        currency: data.currency ?? "NGN",
        assignedRepId: data.assigned_rep_id ?? null
      });
    }

    res.json(data);
  }
);

router.patch("/:id/date",
  requireRole("Owner", "Admin"),
  async (req, res) => {
    const parsed = CartDatePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: humanFieldErrors(parsed.error) });
      return;
    }

    const createdAtIso = normalizeEditableCreatedAt(parsed.data.createdAt);
    if (!createdAtIso) {
      res.status(400).json({ error: "Choose a valid cart date and time." });
      return;
    }

    const { data: existing, error: existingError } = await supabase
      .from("abandoned_carts")
      .select("id, created_at, customer, product_id, package_id, product_name, package_name, state")
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .single();
    if (existingError || !existing) {
      res.status(404).json({ error: "Cart not found." });
      return;
    }

    const { data, error } = await supabase
      .from("abandoned_carts")
      .update({ created_at: createdAtIso })
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ error: "Cart not found." });
      return;
    }

    await appendCartJourneyEvent({
      orgId: req.user!.orgId,
      cartId: existing.id,
      productId: existing.product_id ?? null,
      packageId: existing.package_id ?? null,
      state: existing.state ?? null,
      eventType: "cart_date_changed",
      metadata: {
        customerName: existing.customer ?? null,
        productName: existing.product_name ?? null,
        packageName: existing.package_name ?? null,
        actorName: req.user!.name,
        fromDate: existing.created_at ?? null,
        toDate: createdAtIso,
        reason: parsed.data.reason
      }
    }).catch(() => undefined);

    res.json(data);
  }
);

// ── DELETE /api/carts/:id ────────────────────────────────
// Permanent cleanup for abandoned carts. Owner/Admin only so reps cannot
// erase lead history from the pipeline.
router.delete("/:id",
  requireRole("Owner", "Admin"),
  async (req, res) => {
    const { error } = await supabase
      .from("abandoned_carts")
      .delete()
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(204).send();
  }
);

// ── GET /api/carts/:id/live ─── Admin polls live_status of a specific cart ──
router.get("/:id/live", async (req, res) => {
  const cartId = String(req.params.id).trim();
  const { data, error } = await supabase
    .from("abandoned_carts")
    .select("id, live_status, last_activity")
    .eq("org_id", req.user!.orgId)
    .eq("id", cartId)
    .maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(404).json({ error: "Cart not found." }); return; }
  res.json({ id: data.id, liveStatus: data.live_status, lastActivity: data.last_activity });
});

// ══ Cart daily-log penalties ══════════════════════════════
//
// ₦500 a day for a rep who logs nothing on their assigned carts.
//
// ⚠️ Per REP per DAY, not per cart - a rep with 61 carts and one with 6 have
// committed the same offence by not logging. Deliberately different from the
// order follow-up KPI's ₦50 per order per day.
//
// ⚠️ Misses are DERIVED live from the attempts, never written by a job. The
// cart_log_misses table stores only the Owner's decision, so a pending miss
// cannot drift out of step with the board and nothing is ever auto-deducted.

// ── GET /api/carts/log-penalties?range= ───────────────────
router.get("/log-penalties",
  requireRole("Owner", "Admin", "Manager", "Sales Rep"),
  async (req, res) => {
    try {
      const orgId = req.user!.orgId;
      const scope = scopeOf(req);
      const scopeRepId = scope.role === "Sales Rep" ? scope.id : null;
      const requestedRep = typeof req.query.repId === "string" && req.query.repId ? req.query.repId : null;
      const repFilter = scopeRepId ?? requestedRep;

      const todayKey = lagosDateKey(new Date());
      const preset = (RANGE_PRESETS as string[]).includes(String(req.query.range))
        ? (String(req.query.range) as RangePreset)
        : "this_week";
      const range = resolveRange(preset, todayKey);
      // Nothing before go-live is chargeable, so the window never starts earlier.
      const from = range.from && range.from > CART_LOG_PENALTY_START_DATE
        ? range.from
        : CART_LOG_PENALTY_START_DATE;
      const to = range.to;
      const days = to >= from ? chargeableDaysIn(from, to) : [];

      let cartQuery = supabase.from("abandoned_carts")
        .select("id, status, assigned_rep_id, assigned_at, created_at")
        .eq("org_id", orgId).not("assigned_rep_id", "is", null);
      if (repFilter) cartQuery = cartQuery.eq("assigned_rep_id", repFilter);
      const { data: cartRows } = await cartQuery.limit(REPORT_ROW_CEILING);
      const carts = (cartRows ?? []) as any[];
      const cartIds = carts.map((row) => row.id);

      const [{ data: repRows }, { data: attemptRows }, { data: orderRows }, { data: decisionRows }] =
        await Promise.all([
          supabase.from("users").select("id, name").eq("org_id", orgId).limit(REPORT_ROW_CEILING),
          days.length > 0
            ? supabase.from(CART_ATTEMPTS)
              .select("cart_id, attempted_at, rep_id")
              .eq("org_id", orgId)
              .gte("attempted_at", lagosStartOfDayUtc(from))
              .lt("attempted_at", lagosStartOfDayUtc(addDays(to, 1)))
              .limit(REPORT_ROW_CEILING)
            : Promise.resolve({ data: [] } as any),
          supabase.from("orders").select("source_cart_id, status")
            .eq("org_id", orgId).not("source_cart_id", "is", null).limit(REPORT_ROW_CEILING),
          supabase.from("cart_log_misses")
            .select("*").eq("org_id", orgId)
            .gte("miss_date", from).lte("miss_date", to).limit(REPORT_ROW_CEILING)
        ]);

      // An Interested outcome is a valid completed follow-up, not an untouched
      // cart. Keep this lookup outside the selected date range: once a cart has
      // been positively qualified, it must not create a ₦500 charge tomorrow,
      // and any earlier pending/approved cart charge must be waived too.
      const { data: allOutcomeRows } = await supabase.from(CART_ATTEMPTS)
        .select("cart_id, outcome_code")
        .eq("org_id", orgId).in("cart_id", cartIds)
        .eq("outcome_code", "Interested");
      const interestedCartIds = new Set((allOutcomeRows ?? []).map((row: any) => row.cart_id));

      const repName = new Map(((repRows ?? []) as any[]).map((row) => [row.id, row.name]));
      const deliveredCart = new Set(((orderRows ?? []) as any[])
        .filter((row) => row.status === "Delivered").map((row) => row.source_cart_id));

      // ⚠️ A cart currently closed is exempt from EVERY day in the range, not
      // just the days after it closed. There is no reliable timestamp for when
      // a cart went closed, so this errs toward the rep rather than inventing
      // one - a penalty built on a guessed date would not survive a dispute.
      const openCarts = carts.filter((row) =>
        !deliveredCart.has(row.id)
        && !interestedCartIds.has(row.id)
        && row.status !== "Not interested"
        && row.status !== "Wrong number");

      // Logs per rep per day, counted BOTH ways. The charge is per cart, so it
      // needs distinct carts touched - five attempts on one cart clears one
      // cart, not five - while the raw attempt count still drives the
      // activity figures shown alongside it.
      const logged = new Map<string, number>();
      const loggedCarts = new Map<string, Set<string>>();
      ((attemptRows ?? []) as any[]).forEach((row) => {
        if (!row.rep_id) return;
        const key = `${row.rep_id}|${lagosDateKey(row.attempted_at)}`;
        logged.set(key, (logged.get(key) ?? 0) + 1);
        if (!row.cart_id) return;
        const seen = loggedCarts.get(key);
        if (seen) seen.add(row.cart_id);
        else loggedCarts.set(key, new Set([row.cart_id]));
      });

      const repIds = [...new Set(openCarts.map((row) => row.assigned_rep_id).filter(Boolean))] as string[];
      const inputs: RepDayInput[] = [];
      // ⚠️ cartsLogged MUST be the intersection with the due set, not a raw
      // count of everything the rep touched. The two are different populations:
      // a rep logs carts that later convert or close, and those drop out of
      // "due" while remaining in the attempts table. Chelsea logged 37 distinct
      // carts on 24 Aug 2026 against 11 due, of which only 8 were actually
      // hers-and-due - a raw count cleared all 11 and hid a real ₦1,500 debt on
      // the 3 she never touched.
      const dueCartIdsFor = (theirCarts: any[], dateKey: string) => new Set(
        theirCarts
          .filter((row) => lagosDateKey(row.assigned_at ?? row.created_at) <= dateKey)
          .map((row) => row.id as string)
      );
      const loggedDueCount = (repId: string, dateKey: string, dueIds: Set<string>) => {
        const touched = loggedCarts.get(`${repId}|${dateKey}`);
        if (!touched) return 0;
        let count = 0;
        touched.forEach((cartId) => { if (dueIds.has(cartId)) count += 1; });
        return count;
      };
      repIds.forEach((repId) => {
        const theirCarts = openCarts.filter((row) => row.assigned_rep_id === repId);
        days.forEach((dateKey) => {
          // Only carts they already had that day count against them.
          const dueIds = dueCartIdsFor(theirCarts, dateKey);
          inputs.push({
            repId,
            repName: repName.get(repId) ?? "Unknown",
            dateKey,
            cartsDue: dueIds.size,
            logsMade: logged.get(`${repId}|${dateKey}`) ?? 0,
            cartsLogged: loggedDueCount(repId, dateKey, dueIds)
          });
        });
      });

      const decisions = new Map(((decisionRows ?? []) as any[])
        .map((row) => [`${row.rep_id}|${row.miss_date}`, row]));

      const misses = inputs
        .filter((input) => repDayStatus(input) === "missed")
        .map((input) => {
          const decision = decisions.get(`${input.repId}|${input.dateKey}`);
          return {
            id: decision?.id ?? null,
            repId: input.repId,
            repName: input.repName,
            missDate: input.dateKey,
            cartsDue: input.cartsDue,
            cartsLogged: input.cartsLogged ?? 0,
            cartsMissed: missedCartCount(input),
            // A saved decision keeps the amount it was reviewed at. The Owner
            // approved a specific figure; recomputing it here would silently
            // change what was already agreed if the board or the rate moved.
            // Recalculate against the now-exempt due set. This waives the
            // Interested cart's share without erasing a same-day charge for
            // other carts still assigned to the rep.
            amount: decision ? Math.min(Number(decision.amount ?? 0), dayPenaltyAmount(input)) : dayPenaltyAmount(input),
            status: decision && dayPenaltyAmount(input) === 0 ? "waived" : (decision?.status ?? "pending") as "pending" | "approved" | "waived",
            reviewedByName: decision?.reviewed_by_name ?? "",
            reviewedAt: decision?.reviewed_at ?? null,
            reviewNote: decision?.review_note ?? ""
          };
        })
        .sort((left, right) => right.missDate.localeCompare(left.missDate));

      // ⚠️ Closed days in the CURRENT week, computed OUTSIDE the range filter -
      // the same reason `today` is. A rep who switches the filter to "Today"
      // must not have Monday's debt disappear off their screen; that is exactly
      // the figure Bright wants them unable to miss. Costs one extra attempts
      // query over at most six days.
      const weekStart = mondayOf(todayKey);
      const owedDayKeys = chargeableDaysIn(weekStart, addDays(todayKey, -1))
        .filter((key) => key >= CART_LOG_PENALTY_START_DATE);
      let owedThisWeek: typeof misses = [];
      if (owedDayKeys.length > 0) {
        const { data: weekAttempts } = await supabase.from(CART_ATTEMPTS)
          .select("cart_id, attempted_at, rep_id")
          .eq("org_id", orgId)
          .gte("attempted_at", lagosStartOfDayUtc(owedDayKeys[0]))
          .lt("attempted_at", lagosStartOfDayUtc(todayKey))
          .limit(REPORT_ROW_CEILING);
        const weekLogged = new Map<string, Set<string>>();
        ((weekAttempts ?? []) as any[]).forEach((row) => {
          if (!row.rep_id || !row.cart_id) return;
          const key = `${row.rep_id}|${lagosDateKey(row.attempted_at)}`;
          const seen = weekLogged.get(key);
          if (seen) seen.add(row.cart_id);
          else weekLogged.set(key, new Set([row.cart_id]));
        });
        const weekInputs: RepDayInput[] = [];
        repIds.forEach((repId) => {
          const theirCarts = openCarts.filter((row) => row.assigned_rep_id === repId);
          owedDayKeys.forEach((dateKey) => {
            const dueIds = dueCartIdsFor(theirCarts, dateKey);
            const touched = weekLogged.get(`${repId}|${dateKey}`);
            let loggedDue = 0;
            touched?.forEach((cartId) => { if (dueIds.has(cartId)) loggedDue += 1; });
            weekInputs.push({
              repId,
              repName: repName.get(repId) ?? "Unknown",
              dateKey,
              cartsDue: dueIds.size,
              logsMade: touched?.size ?? 0,
              cartsLogged: loggedDue
            });
          });
        });
        owedThisWeek = weekInputs
          .filter((input) => repDayStatus(input) === "missed")
          .map((input) => {
            const decision = decisions.get(`${input.repId}|${input.dateKey}`);
            return {
              id: decision?.id ?? null,
              repId: input.repId,
              repName: input.repName,
              missDate: input.dateKey,
              cartsDue: input.cartsDue,
              cartsLogged: input.cartsLogged ?? 0,
              cartsMissed: missedCartCount(input),
              amount: decision ? Math.min(Number(decision.amount ?? 0), dayPenaltyAmount(input)) : dayPenaltyAmount(input),
              status: decision && dayPenaltyAmount(input) === 0 ? "waived" : (decision?.status ?? "pending") as "pending" | "approved" | "waived",
              reviewedByName: decision?.reviewed_by_name ?? "",
              reviewedAt: decision?.reviewed_at ?? null,
              reviewNote: decision?.review_note ?? ""
            };
          })
          .sort((left, right) => right.missDate.localeCompare(left.missDate));
      }

      const approved = misses.filter((row) => row.status === "approved");
      const pending = misses.filter((row) => row.status === "pending");

      // ⚠️ Today is computed OUTSIDE the selected range. A rep looking at last
      // month still needs to know they have not logged today - the one thing
      // they can still act on - and hiding it behind a date filter would make
      // the warning disappear exactly when someone is browsing history.
      const myRepId = scopeRepId ?? requestedRep;
      const todaysCarts = openCarts.filter((row) =>
        (!myRepId || row.assigned_rep_id === myRepId)
        && lagosDateKey(row.assigned_at ?? row.created_at) <= todayKey);
      let todayAttempts = 0;
      if (myRepId) {
        todayAttempts = logged.get(`${myRepId}|${todayKey}`) ?? 0;
      }
      const standing = myRepId
        ? todayStanding({
          repId: myRepId, repName: repName.get(myRepId) ?? "You",
          dateKey: todayKey, cartsDue: todaysCarts.length, logsMade: todayAttempts,
          // Intersected with the board, same as the historical rows above.
          cartsLogged: loggedDueCount(myRepId, todayKey, new Set(todaysCarts.map((row) => row.id as string)))
        })
        : null;

      // For a supervisor: how many reps have logged nothing yet today.
      // ⚠️ Now catches a PARTIALLY worked board, not just an untouched one. Under
      // the per-cart rate a rep who logged 5 of 40 is still exposed to ₦17,500,
      // and the old "logsMade === 0" filter would have shown them as fine.
      const repsAtRiskToday = myRepId ? [] : [...new Set(todaysCarts.map((row) => row.assigned_rep_id))]
        .filter((repId): repId is string => Boolean(repId))
        .map((repId) => {
          const theirDueIds = new Set(todaysCarts
            .filter((row) => row.assigned_rep_id === repId)
            .map((row) => row.id as string));
          const input: RepDayInput = {
            repId,
            repName: repName.get(repId) ?? "Unknown",
            dateKey: todayKey,
            cartsDue: theirDueIds.size,
            logsMade: logged.get(`${repId}|${todayKey}`) ?? 0,
            cartsLogged: loggedDueCount(repId, todayKey, theirDueIds)
          };
          const cartsRemaining = missedCartCount(input);
          return { ...input, cartsRemaining, atRisk: dayPenaltyAmount(input) };
        })
        .filter((row) => row.cartsRemaining > 0)
        .sort((left, right) => right.atRisk - left.atRisk);

      res.json({
        range: preset,
        from, to, todayKey,
        phase: penaltyPhase(todayKey),
        missAmount: CART_LOG_MISS_AMOUNT,
        chargeableDays: days.length,
        misses,
        owedThisWeek,
        byRep: summariseRepPenalties(inputs),
        /** Present tense, for the person reading. Null for a supervisor. */
        today: standing,
        /** Supervisor view: who has logged nothing yet today. */
        repsAtRiskToday,
        totals: {
          pendingCount: pending.length,
          pendingAmount: pending.reduce((sum, row) => sum + row.amount, 0),
          approvedCount: approved.length,
          approvedAmount: approved.reduce((sum, row) => sum + row.amount, 0),
          waivedCount: misses.filter((row) => row.status === "waived").length
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message ?? "Could not load log penalties." });
    }
  });

const ReviewSchema = z.object({
  repId: z.string().uuid(),
  missDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["approved", "waived"]),
  note: z.string().trim().max(250).default("")
}).strict();

// ── POST /api/carts/log-penalties/review ──────────────────
router.post("/log-penalties/review", requireRole("Owner"), async (req, res) => {
  try {
    const parsed = ReviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    const body = parsed.data;

    // ⚠️ Owner only, and only ever on a day at or after go-live. A charge for a
    // day the reps were never warned about must not be creatable even by hand.
    if (body.missDate < CART_LOG_PENALTY_START_DATE) {
      res.status(400).json({ error: `Penalties only apply from ${CART_LOG_PENALTY_START_DATE}.` });
      return;
    }

    const [{ data: actor }, { data: rep }] = await Promise.all([
      supabase.from("users").select("name").eq("id", req.user!.id).maybeSingle(),
      supabase.from("users").select("name").eq("id", body.repId).eq("org_id", orgId).maybeSingle()
    ]);
    if (!rep) { res.status(400).json({ error: "That rep is not in this organisation." }); return; }

    const { error } = await supabase.from("cart_log_misses").upsert({
      org_id: orgId,
      rep_id: body.repId,
      rep_name: String(rep.name ?? "").trim(),
      miss_date: body.missDate,
      amount: CART_LOG_MISS_AMOUNT,
      status: body.status,
      reviewed_by: req.user!.id,
      reviewed_by_name: String(actor?.name ?? "").trim() || "Unknown",
      reviewed_at: new Date().toISOString(),
      review_note: body.note
    }, { onConflict: "org_id,rep_id,miss_date" });
    if (error) { res.status(500).json({ error: error.message }); return; }

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save that decision." });
  }
});

export default router;
