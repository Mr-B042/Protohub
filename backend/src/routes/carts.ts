import { Router } from "express";
import { z } from "zod";
import { appendCartJourneyEvent } from "../lib/cart-journey.js";
import { notifyNewAbandonedCart } from "../lib/cart-notifications.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendCartAssignedSms } from "../lib/sms.js";
import { applyCartMarketingScope } from "../lib/marketing-attribution.js";

const router = Router();
router.use(requireAuth);

// ── GET /api/carts ───────────────────────────────────────
router.get("/", async (req, res) => {
  let query = supabase
    .from("abandoned_carts")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });
  // Sales Reps see assigned carts; Marketers see only attributed cart traffic.
  if (req.user!.role === "Marketer") {
    query = applyCartMarketingScope(query, req.user!.marketingAttributionTags, req.user!.id);
  } else if (req.user!.role === "Sales Rep") {
    query = query.eq("assigned_rep_id", req.user!.id);
  }
  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
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
  ).max(500)
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
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
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
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
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
    .eq("org_id", req.user!.orgId)
    .in("id", requestedIds);

  if (req.user!.role === "Sales Rep") {
    allowedCartQuery = allowedCartQuery.eq("assigned_rep_id", req.user!.id);
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

  const { data: events, error } = await supabase
    .from("cart_journey_events")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .in("cart_id", allowedIds)
    .order("created_at", { ascending: true });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const grouped = Object.fromEntries(allowedIds.map((id) => [id, [] as any[]]));
  for (const event of events ?? []) {
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
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
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
  ).slice(0, 50);
  const rawEmbedLabels = typeof req.query.embedLabels === "string" ? req.query.embedLabels : "";
  const embedLabels = Array.from(
    new Set(
      rawEmbedLabels
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => value.slice(0, 120))
    )
  ).slice(0, 50);
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

  let rangeQuery = supabase
    .from("cart_journey_events")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .gte("created_at", selectedRange.startIso)
    .lt("created_at", selectedRange.endExclusiveIso)
    .order("created_at", { ascending: true })
    // Explicit ceiling — without this, PostgREST silently caps at 1000 rows
    // and a busy day (323+ carts × multiple events) gets truncated to the
    // oldest events, making "viewed today" undercount and "last seen at"
    // report the latest event in the first 1000 (often ~1h into the day).
    .limit(10000);
  let rangeFeedQuery = supabase
    .from("cart_journey_events")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .gte("created_at", selectedRange.startIso)
    .lt("created_at", selectedRange.endExclusiveIso)
    .order("created_at", { ascending: false })
    .limit(250);
  let liveWindowQuery = supabase
    .from("cart_journey_events")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .gte("created_at", recentSinceIso)
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
        .select("id, cart_id, product_id, package_id, event_type, metadata, created_at")
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
        .eq("org_id", req.user!.orgId)
        .in("id", cartIdBatch);
      if (cartRes.error && (cartRes.error.code === "42703" || /embed_label/i.test(cartRes.error.message ?? ""))) {
        cartRes = await supabase
          .from("abandoned_carts")
          .select("id, source, product_name, package_name, last_activity")
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
  const rangeByCart = new Map<string, any[]>();
  const liveByCart = new Map<string, any[]>();

  for (const event of rangeEvents ?? []) {
    if (!LIVE_PULSE_EVENT_TYPES.has(String(event.event_type ?? ""))) continue;
    const cartId = typeof event.cart_id === "string" ? event.cart_id.trim() : "";
    if (!cartId) continue;
    const metadata = event.metadata && typeof event.metadata === "object" ? (event.metadata as Record<string, unknown>) : {};
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
    const metadata = event.metadata && typeof event.metadata === "object" ? (event.metadata as Record<string, unknown>) : {};
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
    const metadata = event?.metadata && typeof event.metadata === "object" ? (event.metadata as Record<string, unknown>) : {};
    const cartRow = cartId ? cartById.get(cartId) : undefined;
    const source = normalizePulseSource(metadata.source ?? cartRow?.source);
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
      const metadata = event.metadata && typeof event.metadata === "object" ? (event.metadata as Record<string, unknown>) : {};
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
      const metadata = event.metadata && typeof event.metadata === "object" ? (event.metadata as Record<string, unknown>) : {};
      const cartRow = cartById.get(cartId);
      const source = normalizePulseSource(metadata.source ?? cartRow?.source);
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

      const metadata = event?.metadata && typeof event.metadata === "object" ? (event.metadata as Record<string, unknown>) : {};
      const cartRow = cartId ? cartById.get(cartId) : undefined;
      const source = normalizePulseSource(metadata.source ?? cartRow?.source);
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
  };

  for (const [cartId, events] of rangeByCart.entries()) {
    const cartRow = cartById.get(cartId);
    const latestSource = normalizePulseSource(
      [...events].reverse().map((event) => event?.metadata?.source).find((value) => typeof value === "string" && value.trim()) ?? cartRow?.source
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

  res.json({
    generatedAt: new Date().toISOString(),
    activeWindowMinutes,
    dateFrom: selectedRange.dateFrom,
    dateTo: selectedRange.dateTo,
    summary,
    health,
    sources: [...sourceStats.values()].sort((a, b) => b.viewed - a.viewed || b.submitted - a.submitted),
    embeds: [...embedStats.values()].sort((a, b) => b.viewed - a.viewed || b.submitted - a.submitted),
    recentEvents: pulseFeed
  });
});

// ── GET /api/carts/:id/journey ──────────────────────────
// Returns the public-form activity timeline for a draft/converted cart.
router.get("/:id/journey", async (req, res) => {
  let cartQuery = supabase
    .from("abandoned_carts")
    .select("id, org_id, assigned_rep_id")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId);

  if (req.user!.role === "Sales Rep") {
    cartQuery = cartQuery.eq("assigned_rep_id", req.user!.id);
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

router.patch("/:id",
  requireRole("Owner", "Admin", "Sales Rep"),
  async (req, res) => {
    const parsed = CartPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
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
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
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

export default router;
