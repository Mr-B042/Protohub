import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildAgentAssignmentSnapshot } from "../lib/agent-coverage.js";
import { buildAgentLocationSnapshot, resolveAgentLocationForOrder, syncAgentStockAggregate } from "../lib/agent-locations.js";
import { appendCartJourneyEvent } from "../lib/cart-journey.js";
import { cancelActiveFollowUpTasksForOrder, recordContactAttemptAndNextAction, syncOrderFollowUpTask, taskStatusFor } from "../lib/follow-up-workflow.js";
import { FOLLOW_UP_RECOVERY_BUCKETS } from "../lib/follow-up-outcomes.js";
import { buildPackageComponentSnapshot, orderInventoryLinesFromRow, primaryInventoryProductId, type OrderInventoryLine } from "../lib/order-inventory.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  sendOrderStatusEmail, sendNewOrderEmail,
  sendInternalNewOrderEmail, sendOrderAssignedEmail,
  sendInternalDeliveredEmail
} from "../lib/mailer.js";
import { notifyOrderEvent } from "../lib/order-notifications.js";
import { sendNewOrderSms, sendOrderStatusSms } from "../lib/sms.js";

const router = Router();
router.use(requireAuth);

const TimelineNoteSchema = z.object({
  id: z.string().min(1).max(120),
  text: z.string().min(1),
  by: z.string().min(1).max(120),
  date: z.string().min(1).max(80),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  followUpAt: z.string().min(1).max(80).optional()
});
const parsePlannedOrderMetadata = (value: unknown) => {
  if (!value) {
    return {} as { scheduledAt?: string; timelineNotes?: unknown[]; legacyText?: string };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      scheduledAt: typeof record.scheduledAt === "string" ? record.scheduledAt : undefined,
      timelineNotes: Array.isArray(record.timelineNotes) ? record.timelineNotes : undefined,
      legacyText: typeof record.legacyText === "string" ? record.legacyText : undefined
    };
  }
  if (typeof value !== "string" || !value.trim()) {
    return {} as { scheduledAt?: string; timelineNotes?: unknown[]; legacyText?: string };
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { legacyText: value } as { scheduledAt?: string; timelineNotes?: unknown[]; legacyText?: string };
    }
    const record = parsed as Record<string, unknown>;
    return {
      scheduledAt: typeof record.scheduledAt === "string" ? record.scheduledAt : undefined,
      timelineNotes: Array.isArray(record.timelineNotes) ? record.timelineNotes : undefined,
      legacyText: typeof record.legacyText === "string" ? record.legacyText : undefined
    };
  } catch {
    return { legacyText: value } as { scheduledAt?: string; timelineNotes?: unknown[]; legacyText?: string };
  }
};

const queueCartJourneyEvent = (args: Parameters<typeof appendCartJourneyEvent>[0]) =>
  appendCartJourneyEvent(args).catch(() => undefined);
const serializePlannedOrderMetadata = (
  currentNotes: unknown,
  next: { scheduledAt?: string | null; timelineNotes?: unknown[] | null }
) => {
  const existing = parsePlannedOrderMetadata(currentNotes);
  const payload: Record<string, unknown> = {};
  const scheduledAt = next.scheduledAt !== undefined ? next.scheduledAt ?? undefined : existing.scheduledAt;
  const timelineNotes = next.timelineNotes !== undefined ? next.timelineNotes ?? [] : existing.timelineNotes;
  if (scheduledAt) payload.scheduledAt = scheduledAt;
  if (Array.isArray(timelineNotes) && timelineNotes.length > 0) payload.timelineNotes = timelineNotes;
  if (existing.legacyText) payload.legacyText = existing.legacyText;
  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : null;
};
const isMissingPlannedColumnsError = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === "42703" || /scheduled_at|timeline_notes|confirmation_checked|preferred_delivery/i.test(error?.message ?? "");
const isMissingDateAuditColumnsError = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === "42703" || /original_created_at|created_at_corrected_at|created_at_corrected_by|created_at_correction_reason|original_delivered_date|delivered_date_corrected_at|delivered_date_corrected_by|delivered_date_correction_reason/i.test(error?.message ?? "");
const isMissingRemittanceSnapshotColumnsError = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === "42703" || /order_created_at_snapshot|order_delivered_date_snapshot|product_id_snapshot|product_name_snapshot|package_name_snapshot|customer_snapshot|assigned_rep_id_snapshot|agent_id_snapshot|order_amount_snapshot|logistics_cost_snapshot|expected_remittance_snapshot/i.test(error?.message ?? "");

const numericAmount = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const remittanceReceivedAtToIso = (value: unknown) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return null;
  }
  const iso = new Date(`${value.trim()}T12:00:00+01:00`).toISOString();
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
};

const normalizeEditableCreatedAt = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const inferredDateKey = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(trimmed)
    ? trimmed.slice(0, 10)
    : parsed.toISOString().slice(0, 10);
  return {
    iso: parsed.toISOString(),
    dateKey: inferredDateKey
  };
};

const DATE_AUDIT_UPDATE_KEYS = [
  "original_created_at",
  "created_at_corrected_at",
  "created_at_corrected_by",
  "created_at_correction_reason",
  "original_delivered_date",
  "delivered_date_corrected_at",
  "delivered_date_corrected_by",
  "delivered_date_correction_reason"
] as const;

const stripUpdateKeys = <T extends Record<string, unknown>>(source: T, keys: readonly string[]) => {
  const clone = { ...source };
  for (const key of keys) delete clone[key];
  return clone;
};

const buildCreatedAtCorrectionAuditUpdates = (
  current: Record<string, any> | null | undefined,
  nextCreatedAtIso: string,
  reason: string,
  userId: string
) => {
  const updates: Record<string, unknown> = {
    created_at_corrected_at: new Date().toISOString(),
    created_at_corrected_by: userId,
    created_at_correction_reason: reason
  };
  const currentCreatedAt = typeof current?.created_at === "string" ? current.created_at : null;
  const originalCreatedAt = typeof current?.original_created_at === "string" ? current.original_created_at : null;
  if (!originalCreatedAt && currentCreatedAt && currentCreatedAt !== nextCreatedAtIso) {
    updates.original_created_at = currentCreatedAt;
  }
  return updates;
};

const buildDeliveredDateCorrectionAuditUpdates = (
  current: Record<string, any> | null | undefined,
  nextDeliveredDate: string,
  reason: string | undefined,
  userId: string
) => {
  const updates: Record<string, unknown> = {
    delivered_date_corrected_at: new Date().toISOString(),
    delivered_date_corrected_by: userId,
    delivered_date_correction_reason: (reason ?? "Delivered date corrected").trim().slice(0, 500)
  };
  const currentDeliveredDate = typeof current?.delivered_date === "string" ? current.delivered_date : null;
  const originalDeliveredDate = typeof current?.original_delivered_date === "string" ? current.original_delivered_date : null;
  if (!originalDeliveredDate && currentDeliveredDate && currentDeliveredDate !== nextDeliveredDate) {
    updates.original_delivered_date = currentDeliveredDate;
  }
  return updates;
};

const logRemittanceDelta = async (args: {
  orgId: string;
  orderId: string;
  previousAmountRemitted: unknown;
  nextAmountRemitted: unknown;
  userId?: string | null;
  userName?: string | null;
  reason: string;
  receivedAt?: string;
  snapshot?: {
    orderCreatedAt?: unknown;
    orderDeliveredDate?: unknown;
    productId?: unknown;
    productName?: unknown;
    packageName?: unknown;
    customer?: unknown;
    assignedRepId?: unknown;
    agentId?: unknown;
    orderAmount?: unknown;
    logisticsCost?: unknown;
  };
}) => {
  const previous = numericAmount(args.previousAmountRemitted);
  const next = numericAmount(args.nextAmountRemitted);
  const delta = Math.round((next - previous) * 100) / 100;
  if (delta === 0) return;

  const payload: Record<string, unknown> = {
    org_id: args.orgId,
    order_id: args.orderId,
    delta_amount: delta,
    previous_amount_remitted: previous,
    running_amount_remitted: next,
    logged_by_user_id: args.userId ?? null,
    logged_by_name: args.userName ?? null,
    reason: args.reason
  };
  if (args.receivedAt) {
    payload.received_at = args.receivedAt;
  }
  if (args.snapshot) {
    const orderAmount = numericAmount(args.snapshot.orderAmount);
    const logisticsCost = numericAmount(args.snapshot.logisticsCost);
    payload.order_created_at_snapshot = typeof args.snapshot.orderCreatedAt === "string" ? args.snapshot.orderCreatedAt : null;
    payload.order_delivered_date_snapshot = typeof args.snapshot.orderDeliveredDate === "string" ? args.snapshot.orderDeliveredDate : null;
    payload.product_id_snapshot = args.snapshot.productId ?? null;
    payload.product_name_snapshot = typeof args.snapshot.productName === "string" ? args.snapshot.productName : null;
    payload.package_name_snapshot = typeof args.snapshot.packageName === "string" ? args.snapshot.packageName : null;
    payload.customer_snapshot = typeof args.snapshot.customer === "string" ? args.snapshot.customer : null;
    payload.assigned_rep_id_snapshot = args.snapshot.assignedRepId ?? null;
    payload.agent_id_snapshot = args.snapshot.agentId ?? null;
    payload.order_amount_snapshot = orderAmount;
    payload.logistics_cost_snapshot = logisticsCost;
    payload.expected_remittance_snapshot = Math.max(0, Math.round((orderAmount - logisticsCost) * 100) / 100);
  }

  let { error } = await supabase.from("remittance_transactions").insert(payload);
  if (error && isMissingRemittanceSnapshotColumnsError(error)) {
    ({ error } = await supabase
      .from("remittance_transactions")
      .insert(stripUpdateKeys(payload, [
        "order_created_at_snapshot",
        "order_delivered_date_snapshot",
        "product_id_snapshot",
        "product_name_snapshot",
        "package_name_snapshot",
        "customer_snapshot",
        "assigned_rep_id_snapshot",
        "agent_id_snapshot",
        "order_amount_snapshot",
        "logistics_cost_snapshot",
        "expected_remittance_snapshot"
      ])));
  }

  if (error) {
    logger.error("remittance: failed to log remittance transaction", {
      orderId: args.orderId,
      orgId: args.orgId,
      delta,
      error: error.message
    });
  }
};

const inventoryAvailabilityMap = async (
  agentId: string,
  locationId: string | null | undefined,
  productIds: string[]
) => {
  if (productIds.length === 0) return new Map<string, number>();
  const query = locationId
    ? supabase
        .from("agent_location_stock")
        .select("product_id, quantity")
        .eq("agent_location_id", locationId)
        .in("product_id", productIds)
    : supabase
        .from("agent_stock")
        .select("product_id, quantity")
        .eq("agent_id", agentId)
        .in("product_id", productIds);
  const { data } = await query;
  return new Map<string, number>(
    (data ?? []).map((row: any) => [String(row.product_id), Number(row.quantity ?? 0)])
  );
};

const applyLocationInventoryDelta = async (
  orgId: string,
  agentId: string,
  agentLocationId: string,
  line: OrderInventoryLine,
  nextQuantity: number
) => {
  await supabase
    .from("agent_location_stock")
    .upsert({
      org_id: orgId,
      agent_id: agentId,
      agent_location_id: agentLocationId,
      product_id: line.productId,
      quantity: nextQuantity
    }, { onConflict: "agent_location_id,product_id" });
  await syncAgentStockAggregate(orgId, agentId, line.productId);
};

// ── GET /api/orders ───────────────────────────────────────
// Supports: ?status=Delivered&source=TikTok&search=Kemi&page=1&limit=25
router.get("/", async (req, res) => {
  const { status, source, search, page = "1", limit = "25", repId, since, updatedSince, dateFrom, dateTo } = req.query;
  const pageNum  = Math.max(1, parseInt(page as string, 10));
  const pageSize = Math.min(2000, parseInt(limit as string, 10));
  const from = (pageNum - 1) * pageSize;
  const to   = from + pageSize - 1;

  // updatedSince polling needs the result sorted by updated_at so the client
  // can read result.data[0].updated_at as the next high-water mark. Default
  // listing keeps newest-by-created_at order for the UI table.
  const sortColumn = updatedSince ? "updated_at" : "created_at";

  let query = supabase
    .from("orders")
    .select("*", { count: "exact" })
    .eq("org_id", req.user!.orgId)
    .order(sortColumn, { ascending: false })
    .range(from, to);

  // Sales Reps only see their own orders
  if (req.user!.role === "Sales Rep") {
    query = query.eq("assigned_rep_id", req.user!.id);
  } else if (repId) {
    query = query.eq("assigned_rep_id", repId as string);
  }

  if (status && status !== "All Orders") query = query.eq("status", status);
  if (source && source !== "All Sources") query = query.eq("source", source);
  if (search) {
    // Escape PostgREST filter special characters to prevent filter injection
    const safe = (search as string).replace(/[.,()"\\%_]/g, (ch) => `\\${ch}`);
    query = query.or(`customer.ilike.%${safe}%,phone.ilike.%${safe}%,id.ilike.%${safe}%`);
  }
  // since=ISO8601 — orders created after this timestamp (initial new-order polling).
  if (since) query = query.gt("created_at", since as string);
  // updatedSince=ISO8601 — orders changed after this timestamp. Catches status
  // updates and edits that don't bump created_at, so collaborating reps see
  // each other's changes within the poll interval instead of waiting for a
  // full reload. orders.updated_at is auto-bumped by the set_updated_at trigger.
  if (updatedSince) query = query.gt("updated_at", updatedSince as string);
  // dateFrom / dateTo — server-side date range filter (YYYY-MM-DD)
  if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  if (dateTo)   query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);

  const { data, error, count } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data, total: count ?? 0, page: pageNum, pageSize });
});

// ── POST /api/orders ──────────────────────────────────────
const OrderSchema = z.object({
  id:             z.string().min(1).max(50).regex(/^[A-Za-z0-9\-_]+$/, "Order ID must be alphanumeric (hyphens and underscores allowed)").optional(),
  customer:       z.string().min(1),
  phone:          z.string().min(1),
  whatsapp:       z.string().optional(),
  email:          z.string().email().optional().or(z.literal("")),
  address:        z.string().optional(),
  city:           z.string().optional(),
  state:          z.string().optional(),
  productId:      z.string().uuid().optional(),
  packageId:      z.string().uuid().optional(),
  productName:    z.string().min(1),
  packageName:    z.string().optional(),
  quantity:       z.number().int().min(1).default(1),
  amount:         z.number().min(0),
  currency:       z.enum(["NGN", "USD", "GBP"]).default("NGN"),
  source:         z.enum(["TikTok", "Facebook", "WhatsApp", "Website", "Direct"]).optional(),
  sourceCartId:   z.string().min(1).max(80).regex(/^[A-Za-z0-9\-_]+$/, "Cart ID must be alphanumeric (hyphens and underscores allowed)").optional(),
  location:       z.string().optional(),
  assignedRepId:  z.string().uuid().optional(),
  agentId:        z.string().uuid().optional().nullable(),
  agentLocationId:z.string().uuid().optional().nullable(),
  utmSource:      z.string().optional(),
  utmCampaign:    z.string().optional(),
  utmMedium:      z.string().optional(),
  utmContent:     z.string().optional(),
  utmTerm:        z.string().optional(),
  referrer:       z.string().optional(),
  confirmationChecked: z.boolean().optional(),
  preferredDelivery:   z.string().optional(),
  scheduledDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheduledAt:    z.string().min(1).max(80).optional(),
  date:           z.string().optional(),
  response:       z.string().optional(),
  notes:          z.array(TimelineNoteSchema).max(200).optional(),
  timelineNotes:  z.array(TimelineNoteSchema).max(200).optional()
});

router.post("/", async (req, res) => {
  const parsed = OrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const d = parsed.data;
  let packageComponentsSource: unknown = [];

  // Validate productId belongs to this org
  if (d.productId) {
    const { data: productCheck } = await supabase
      .from("products").select("id").eq("id", d.productId).eq("org_id", req.user!.orgId).single();
    if (!productCheck) {
      res.status(400).json({ error: "Product not found in your organization." });
      return;
    }
  }

  // Validate packageId belongs to this org (via its parent product)
  if (d.packageId) {
    const { data: pkgCheck } = await supabase
      .from("product_packages")
      .select("id, product_id, package_components")
      .eq("id", d.packageId)
      .single();
    if (!pkgCheck) {
      res.status(400).json({ error: "Package not found." });
      return;
    }
    // Verify the package's product belongs to this org
    const { data: pkgProductCheck } = await supabase
      .from("products").select("id").eq("id", pkgCheck.product_id).eq("org_id", req.user!.orgId).single();
    if (!pkgProductCheck) {
      res.status(400).json({ error: "Package does not belong to your organization." });
      return;
    }
    packageComponentsSource = pkgCheck.package_components ?? [];
  }

  // Validate assignedRepId belongs to this org
  if (d.assignedRepId) {
    const { data: repCheck } = await supabase
      .from("users").select("id").eq("id", d.assignedRepId).eq("org_id", req.user!.orgId).single();
    if (!repCheck) {
      res.status(400).json({ error: "Assigned rep not found in your organization." });
      return;
    }
  }

  if (d.agentId) {
    const { data: agentCheck } = await supabase
      .from("agents").select("id").eq("id", d.agentId).eq("org_id", req.user!.orgId).single();
    if (!agentCheck) {
      res.status(400).json({ error: "Agent not found in your organization." });
      return;
    }
  }

  if (d.agentLocationId) {
    if (!d.agentId) {
      res.status(400).json({ error: "Choose an agent before assigning a stock location." });
      return;
    }
    const { data: locationCheck } = await supabase
      .from("agent_locations")
      .select("id")
      .eq("id", d.agentLocationId)
      .eq("agent_id", d.agentId)
      .eq("org_id", req.user!.orgId)
      .single();
    if (!locationCheck) {
      res.status(400).json({ error: "Agent location not found in your organization." });
      return;
    }
  }

  const agentSnapshot = d.agentId
    ? await buildAgentAssignmentSnapshot(req.user!.orgId, d.agentId, { state: d.state, city: d.city })
    : {
        agent_name_snapshot: null,
        agent_phone_snapshot: null,
        agent_base_state_snapshot: null,
        agent_coverage_state_snapshot: null,
        agent_coverage_city_snapshot: null
      };
  const agentLocationSnapshot = d.agentId
    ? await buildAgentLocationSnapshot(req.user!.orgId, d.agentId, {
        desiredState: d.state,
        desiredCity: d.city,
        productId: d.productId,
        explicitLocationId: d.agentLocationId ?? null
      })
    : {
        agent_location_id: null,
        agent_location_name_snapshot: null,
        agent_location_state_snapshot: null,
        agent_location_city_snapshot: null
      };
  const packageComponentsSnapshot = await buildPackageComponentSnapshot(req.user!.orgId, packageComponentsSource);

  const timelineNotes = d.timelineNotes ?? d.notes ?? [];
  const legacyNotes = serializePlannedOrderMetadata(null, {
    scheduledAt: d.scheduledAt ?? null,
    timelineNotes
  });
  const baseInsert = {
    ...(d.id ? { id: d.id } : {}),
    org_id:          req.user!.orgId,
    customer:        d.customer,
    phone:           d.phone,
    whatsapp:        d.whatsapp,
    email:           d.email || null,
    address:         d.address,
    city:            d.city,
    state:           d.state,
    product_id:      d.productId,
    package_id:      d.packageId,
    product_name:    d.productName,
    package_name:    d.packageName,
    quantity:          d.quantity,
    original_quantity: d.quantity,
    amount:          d.amount,
    original_amount: d.amount,
    currency:        d.currency,
    package_components_snapshot: packageComponentsSnapshot,
    source:          d.source,
    source_cart_id:  d.sourceCartId ?? null,
    location:        d.location,
    assigned_rep_id: d.assignedRepId ?? req.user!.id,
    assigned_by_user_id: req.user!.id,
    assigned_by_name_snapshot: req.user!.name,
    agent_id:        d.agentId ?? null,
    ...agentSnapshot,
    ...agentLocationSnapshot,
    utm_source:      d.utmSource,
    utm_campaign:    d.utmCampaign,
    utm_medium:      d.utmMedium,
    utm_content:     d.utmContent,
    utm_term:        d.utmTerm,
    referrer:        d.referrer,
    confirmation_checked: d.confirmationChecked ?? null,
    preferred_delivery:   d.preferredDelivery ?? null,
    scheduled_date:  d.scheduledDate ?? null,
    notes:           legacyNotes,
    date:            d.date,
    response:        d.response,
    status:          "New"
  };
  const legacyInsert = {
    ...baseInsert
  } as Record<string, unknown>;
  delete legacyInsert.assigned_by_user_id;
  delete legacyInsert.assigned_by_name_snapshot;
  delete legacyInsert.confirmation_checked;
  delete legacyInsert.preferred_delivery;

  let { data, error } = await supabase
    .from("orders")
    .insert({
      ...baseInsert,
      scheduled_at:   d.scheduledAt ?? null,
      timeline_notes: timelineNotes
    })
    .select()
    .single();

  if (error && isMissingPlannedColumnsError(error)) {
    ({ data, error } = await supabase
      .from("orders")
      .insert(legacyInsert)
      .select()
      .single());
  }

  if (error) {
    if (error.code === "23505") {
      res.status(409).json({ error: d.id ? `Order ID "${d.id}" already exists.` : "Order ID already exists." });
    } else {
      res.status(500).json({ error: error.message });
    }
    return;
  }

  // Audit: creation event
  await supabase.from("order_audit").insert({
    order_id:    data.id,
    org_id:      req.user!.orgId,
    changed_by:  req.user!.id,
    from_status: null,
    to_status:   "New",
    note:        "Order created"
  });

  // In-app notifications
  await notifyOrderEvent(req.user!.orgId, {
    id: data.id, customer: data.customer, phone: data.phone, amount: data.amount, currency: data.currency,
    productName: data.product_name, packageName: data.package_name,
    assignedRepId: data.assigned_rep_id
  }, "New");

  // Fire-and-forget emails
  // Customer confirmation (only if email in order form)
  sendNewOrderEmail(req.user!.orgId, {
    id: data.id, customer: data.customer, email: data.email,
    phone: data.phone, product_name: data.product_name, package_name: data.package_name,
    amount: data.amount, currency: data.currency, source: data.source
  });
  sendNewOrderSms(req.user!.orgId, {
    id: data.id,
    customer: data.customer,
    phone: data.phone,
    assignedRepId: data.assigned_rep_id,
    product_name: data.product_name,
    package_name: data.package_name,
    amount: data.amount,
    currency: data.currency
  });

  // Internal: notify owner + admins
  sendInternalNewOrderEmail(req.user!.orgId, {
    id: data.id, customer: data.customer, phone: data.phone,
    product_name: data.product_name, package_name: data.package_name, amount: data.amount,
    currency: data.currency, source: data.source, rep_name: req.user!.name
  });

  // Internal: notify assigned rep (only if someone else assigned the order)
  if (data.assigned_rep_id && data.assigned_rep_id !== req.user!.id) {
    sendOrderAssignedEmail(req.user!.orgId, data.assigned_rep_id, {
      id: data.id, customer: data.customer, phone: data.phone,
      product_name: data.product_name, package_name: data.package_name, amount: data.amount,
      currency: data.currency, source: data.source
    });
  }

  await syncOrderFollowUpTask({
    orgId: req.user!.orgId,
    orderId: data.id,
    assignedRepId: data.assigned_rep_id ?? null,
    status: data.status ?? null,
    scheduledDate: d.scheduledDate ?? data.scheduled_date ?? null,
    scheduledAt: d.scheduledAt ?? data.scheduled_at ?? null,
    timelineNotes: Array.isArray(timelineNotes) && timelineNotes.length > 0 ? timelineNotes : data.timeline_notes
  }).catch(() => undefined);

  if (data.source_cart_id && data.assigned_rep_id) {
    const { data: assignedRep } = await supabase
      .from("users")
      .select("id, name")
      .eq("id", data.assigned_rep_id)
      .eq("org_id", req.user!.orgId)
      .maybeSingle();
    void queueCartJourneyEvent({
      orgId: req.user!.orgId,
      cartId: data.source_cart_id,
      productId: data.product_id ?? null,
      packageId: data.package_id ?? null,
      state: data.state ?? null,
      eventType: "order_assigned",
      metadata: {
        orderId: data.id,
        repId: data.assigned_rep_id,
        repName: assignedRep?.name ?? null,
        actorName: req.user!.name,
        customerName: data.customer,
        productName: data.product_name,
        packageName: data.package_name ?? null
      }
    });
  }
  if (data.source_cart_id && data.agent_id) {
    void queueCartJourneyEvent({
      orgId: req.user!.orgId,
      cartId: data.source_cart_id,
      productId: data.product_id ?? null,
      packageId: data.package_id ?? null,
      state: data.state ?? null,
      eventType: "delivery_agent_assigned",
      metadata: {
        orderId: data.id,
        agentId: data.agent_id,
        agentName: data.agent_name_snapshot ?? null,
        actorName: req.user!.name,
        customerName: data.customer,
        productName: data.product_name,
        packageName: data.package_name ?? null
      }
    });
  }

  res.status(201).json(data);
});

// ── PATCH /api/orders/:id/status ──────────────────────────
const StatusSchema = z.object({
  status:      z.enum(["New","Confirmed","In Process","Dispatched","Delivered","Cancelled","Postponed","Failed"]),
  callOutcome: z.string().trim().min(1).max(120).nullable().optional(),
  response:    z.string().optional(),
  deliveredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  scheduledAt: z.string().min(1).max(80).nullable().optional(),
  timelineNotes: z.array(TimelineNoteSchema).max(200).optional(),
  agentId:     z.string().uuid().optional().nullable(),
  agentLocationId: z.string().uuid().optional().nullable()
});

router.patch("/:id/status", async (req, res) => {
  const parsed = StatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { status, callOutcome, response, deliveredDate, scheduledDate, scheduledAt, timelineNotes, agentId, agentLocationId } = parsed.data;

  // Fetch current order for audit trail + delivery logic
  const { data: existing } = await supabase
    .from("orders")
    .select("*")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .single();

  if (!existing) { res.status(404).json({ error: "Order not found." }); return; }

  // Sales Reps can only change status on their own orders
  if (req.user!.role === "Sales Rep" && existing.assigned_rep_id !== req.user!.id) {
    res.status(403).json({ error: "You can only update orders assigned to you." });
    return;
  }

  const isDeliveredDateCorrection = existing.status === "Delivered" && status === "Delivered";
  const inventoryLines = orderInventoryLinesFromRow(existing);
  const inventoryProductId = primaryInventoryProductId(inventoryLines, existing.product_id);

  // Validate agentId belongs to this org
  if (agentId) {
    const { data: agentCheck } = await supabase
      .from("agents").select("id").eq("id", agentId).eq("org_id", req.user!.orgId).single();
    if (!agentCheck) {
      res.status(400).json({ error: "Agent not found in your organization." });
      return;
    }
  }
  if (agentLocationId) {
    const owningAgentId = agentId ?? existing?.agent_id;
    if (!owningAgentId) {
      res.status(400).json({ error: "Choose an agent before assigning a stock location." });
      return;
    }
    const { data: locationCheck } = await supabase
      .from("agent_locations").select("id")
      .eq("id", agentLocationId)
      .eq("agent_id", owningAgentId)
      .eq("org_id", req.user!.orgId)
      .single();
    if (!locationCheck) {
      res.status(400).json({ error: "Agent location not found in your organization." });
      return;
    }
  }

  // Resolve the effective agent (request may override)
  const effectiveAgentId = agentId !== undefined ? agentId : existing?.agent_id;
  const effectiveAgentLocationId = agentLocationId !== undefined ? agentLocationId : existing?.agent_location_id;
  const orderQty = existing?.quantity ?? 1;

  // Pre-check: if marking Delivered and an agent is assigned, verify stock
  if (!isDeliveredDateCorrection && status === "Delivered" && effectiveAgentId && inventoryLines.length > 0) {
    const resolvedLocation = effectiveAgentLocationId
      ? { id: effectiveAgentLocationId }
      : await resolveAgentLocationForOrder(req.user!.orgId, effectiveAgentId, {
          desiredState: existing.state,
          desiredCity: existing.city,
          productId: inventoryProductId
        });
    const availability = await inventoryAvailabilityMap(
      effectiveAgentId,
      resolvedLocation?.id,
      inventoryLines.map((line) => line.productId)
    );
    const shortfall = inventoryLines.find((line) => (availability.get(line.productId) ?? 0) < line.quantity);
    if (shortfall) {
      const { data: agentRow } = await supabase
        .from("agents").select("name").eq("id", effectiveAgentId).single();
      const agentName = agentRow?.name ?? effectiveAgentId;
      const available = availability.get(shortfall.productId) ?? 0;
      res.status(400).json({
        error: `Cannot mark delivered — agent ${agentName} only has ${available} units of ${shortfall.productName}. This order needs ${shortfall.quantity}.`
      });
      return;
    }
  }

  const updates: Record<string, unknown> = { status };
  if (callOutcome !== undefined)  updates.call_outcome    = callOutcome || null;
  if (response)     updates.response        = response;
  if (scheduledDate !== undefined) updates.scheduled_date = scheduledDate;
  if (scheduledAt !== undefined) updates.scheduled_at = scheduledAt;
  if (timelineNotes !== undefined) {
    updates.timeline_notes = timelineNotes;
    updates.notes = serializePlannedOrderMetadata(existing?.notes, {
      scheduledAt: updates.scheduled_at as string | null | undefined,
      timelineNotes
    });
  } else if (scheduledAt !== undefined) {
    updates.notes = serializePlannedOrderMetadata(existing?.notes, {
      scheduledAt: scheduledAt,
      timelineNotes: undefined
    });
  }
  if (agentId !== undefined) updates.agent_id = agentId;
  if (agentLocationId !== undefined) updates.agent_location_id = agentLocationId;
  if (effectiveAgentId) {
    Object.assign(
      updates,
      await buildAgentAssignmentSnapshot(req.user!.orgId, effectiveAgentId, {
        state: existing.state,
        city: existing.city
      })
    );
    Object.assign(
      updates,
      await buildAgentLocationSnapshot(req.user!.orgId, effectiveAgentId, {
        desiredState: existing.state,
        desiredCity: existing.city,
        productId: existing.product_id,
        explicitLocationId: effectiveAgentLocationId
      })
    );
  } else if (agentId !== undefined) {
    updates.agent_name_snapshot = null;
    updates.agent_phone_snapshot = null;
    updates.agent_base_state_snapshot = null;
    updates.agent_coverage_state_snapshot = null;
    updates.agent_coverage_city_snapshot = null;
    updates.agent_location_id = null;
    updates.agent_location_name_snapshot = null;
    updates.agent_location_state_snapshot = null;
    updates.agent_location_city_snapshot = null;
  }

  const watDate = new Date(Date.now() + 60 * 60 * 1000).toISOString().split("T")[0];

  if (status === "Delivered") {
    if (deliveredDate) {
      updates.delivered_date = deliveredDate;
    } else if (isDeliveredDateCorrection) {
      updates.delivered_date = existing.delivered_date ?? new Date(Date.now() + 60 * 60 * 1000).toISOString().split("T")[0];
    } else {
      // Use WAT (UTC+1) so the date is correct for Nigeria even near midnight UTC
      const watDate = new Date(Date.now() + 60 * 60 * 1000);
      updates.delivered_date = watDate.toISOString().split("T")[0];
    }
    if (!isDeliveredDateCorrection) {
      updates.stock_deducted = true;
    }
    if (isDeliveredDateCorrection && typeof updates.delivered_date === "string") {
      Object.assign(
        updates,
        buildDeliveredDateCorrectionAuditUpdates(
          existing,
          updates.delivered_date,
          typeof req.body.reason === "string" ? req.body.reason : undefined,
          req.user!.id
        )
      );
    }
  } else if (existing?.status === "Delivered") {
    updates.delivered_date    = null;
    updates.stock_deducted    = false;
    // Clear remittance so a un-delivered order is not flagged as overdue by
    // the remittance cron or shown as outstanding in the finance dashboard.
    updates.amount_remitted   = 0;
    updates.logistics_cost    = 0;
    updates.remittance_status = "Pending";
  }

  let { data, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();

  if (error && (isMissingPlannedColumnsError(error) || isMissingDateAuditColumnsError(error))) {
    const legacyUpdates = stripUpdateKeys(updates, [
      "scheduled_at",
      "timeline_notes",
      ...DATE_AUDIT_UPDATE_KEYS
    ]);
    ({ data, error } = await supabase
      .from("orders")
      .update(legacyUpdates)
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single());
  }

  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data)  { res.status(404).json({ error: "Order not found." }); return; }

  await logRemittanceDelta({
    orgId: req.user!.orgId,
    orderId: req.params.id,
    previousAmountRemitted: existing.amount_remitted,
    nextAmountRemitted: (data as any).amount_remitted,
    userId: req.user!.id,
    userName: req.user!.name,
    reason: status === "Delivered"
      ? "Status update while delivered"
      : existing?.status === "Delivered"
        ? `Status changed from Delivered to ${status}`
        : `Status updated to ${status}`,
    snapshot: {
      orderCreatedAt: (data as any).created_at,
      orderDeliveredDate: (data as any).delivered_date,
      productId: (data as any).product_id,
      productName: (data as any).product_name,
      packageName: (data as any).package_name,
      customer: (data as any).customer,
      assignedRepId: (data as any).assigned_rep_id,
      agentId: (data as any).agent_id,
      orderAmount: (data as any).amount,
      logisticsCost: (data as any).logistics_cost
    }
  });

  if (["Delivered", "Cancelled", "Failed"].includes(status)) {
    await cancelActiveFollowUpTasksForOrder(req.user!.orgId, req.params.id, `Order moved to ${status}.`).catch(() => undefined);
  } else {
    await syncOrderFollowUpTask({
      orgId: req.user!.orgId,
      orderId: req.params.id,
      assignedRepId: data.assigned_rep_id ?? null,
      status: data.status ?? status,
      scheduledDate: scheduledDate !== undefined ? scheduledDate : data.scheduled_date ?? null,
      scheduledAt: scheduledAt !== undefined ? scheduledAt : data.scheduled_at ?? null,
      timelineNotes: timelineNotes !== undefined ? timelineNotes : data.timeline_notes
    }).catch(() => undefined);
  }

  if (!isDeliveredDateCorrection && existing?.source_cart_id && existing.status !== status) {
    void queueCartJourneyEvent({
      orgId: req.user!.orgId,
      cartId: existing.source_cart_id,
      productId: existing.product_id ?? null,
      packageId: existing.package_id ?? null,
      state: existing.state ?? null,
      eventType: "order_status_changed",
      metadata: {
        orderId: req.params.id,
        customerName: existing.customer ?? null,
        productName: existing.product_name ?? null,
        packageName: existing.package_name ?? null,
        fromStatus: existing.status ?? null,
        toStatus: status,
        actorName: req.user!.name
      }
    });
  }

  // ── Delivery side-effects: deduct agent stock, create waybill, log movement ──
  if (!isDeliveredDateCorrection && status === "Delivered" && effectiveAgentId && inventoryLines.length > 0) {
    const today = new Date().toISOString().split("T")[0];
    const resolvedLocation = effectiveAgentLocationId
      ? await resolveAgentLocationForOrder(req.user!.orgId, effectiveAgentId, {
          desiredState: existing.state,
          desiredCity: existing.city,
          productId: inventoryProductId,
          explicitLocationId: effectiveAgentLocationId
        })
      : await resolveAgentLocationForOrder(req.user!.orgId, effectiveAgentId, {
          desiredState: existing.state,
          desiredCity: existing.city,
          productId: inventoryProductId
        });

    if (!resolvedLocation) {
      res.status(400).json({ error: "No stock location is configured for this agent yet." });
      return;
    }

    const stockMap = await inventoryAvailabilityMap(
      effectiveAgentId,
      resolvedLocation.id,
      inventoryLines.map((line) => line.productId)
    );

    const agentName = data.agent_name_snapshot ?? existing.agent_name_snapshot ?? "Agent";
    const agentBaseState = data.agent_base_state_snapshot ?? existing.agent_base_state_snapshot ?? "";
    const agentCoverageState = data.agent_coverage_state_snapshot ?? existing.agent_coverage_state_snapshot ?? "";
    const agentLocationName = data.agent_location_name_snapshot ?? existing.agent_location_name_snapshot ?? resolvedLocation.name ?? "";
    const originState = agentBaseState || agentCoverageState;
    const serviceStateNote = agentCoverageState && agentCoverageState !== agentBaseState
      ? ` · serving ${agentCoverageState}`
      : "";

    // 2. Create waybill record (agent → customer)
    const waybillId = `WB-${Date.now()}`;
    const customerLocation = [existing.city, existing.state].filter(Boolean).join(", ") || "Customer";
    await supabase.from("waybill_records").insert({
      id:              waybillId,
      org_id:          req.user!.orgId,
      product_id:      existing.product_id,
      product_name:    existing.product_name,
      quantity:        orderQty,
      waybill_fee:     0,
      from_location:   agentLocationName || originState,
      to_location:     `Customer:${req.params.id}`,
      agent_id:        effectiveAgentId,
      from_agent_id:   effectiveAgentId,
      from_agent_location_id: resolvedLocation.id,
      status:          "Received",
      dispatched_date: today,
      received_date:   today,
      notes:           `Auto-created on order delivery (${existing.customer})`
    });

    for (const line of inventoryLines) {
      const currentQty = stockMap.get(line.productId) ?? 0;
      const nextQty = Math.max(0, currentQty - line.quantity);
      await applyLocationInventoryDelta(req.user!.orgId, effectiveAgentId, resolvedLocation.id, line, nextQty);
      await supabase.from("stock_movements").insert({
        id:            `MOV-${randomUUID()}`,
        org_id:        req.user!.orgId,
        product_id:    line.productId,
        product_name:  line.productName,
        type:          "Order Fulfilled",
        qty:           line.quantity,
        balance_after: nextQty,
        agent_id:      effectiveAgentId,
        order_id:      req.params.id,
        by_name:       req.user!.name,
        by_user_id:    req.user!.id,
        waybill_id:    waybillId,
        from_location: agentLocationName || originState,
        to_location:   customerLocation,
        from_agent_location_id: resolvedLocation.id,
        note:          `Delivered to ${existing.customer} — ${line.productName}${line.isFreeGift ? " (gift)" : ""} deducted ${currentQty} → ${nextQty} by agent ${agentName}${serviceStateNote}`
      });
    }
  }

  // ── Un-delivery side-effects: restore agent stock, delete waybill, log reversal ──
  if (existing?.status === "Delivered" && status !== "Delivered" && existing?.stock_deducted && existing?.agent_id && inventoryLines.length > 0) {
    const reversalLocation = existing.agent_location_id
      ? await resolveAgentLocationForOrder(req.user!.orgId, existing.agent_id, {
          desiredState: existing.state,
          desiredCity: existing.city,
          productId: inventoryProductId,
          explicitLocationId: existing.agent_location_id
        })
      : await resolveAgentLocationForOrder(req.user!.orgId, existing.agent_id, {
          desiredState: existing.state,
          desiredCity: existing.city,
          productId: inventoryProductId
        });

    if (reversalLocation) {
      const stockMap = await inventoryAvailabilityMap(
        existing.agent_id,
        reversalLocation.id,
        inventoryLines.map((line) => line.productId)
      );
      const { data: agentInfo } = await supabase
        .from("agents").select("name").eq("id", existing.agent_id).single();
      for (const line of inventoryLines) {
        const currentQty = stockMap.get(line.productId) ?? 0;
        const restoredQty = currentQty + line.quantity;
        await applyLocationInventoryDelta(req.user!.orgId, existing.agent_id, reversalLocation.id, line, restoredQty);
        await supabase.from("stock_movements").insert({
          id:            `MOV-${randomUUID()}`,
          org_id:        req.user!.orgId,
          product_id:    line.productId,
          product_name:  line.productName,
          type:          "Status Reversal",
          qty:           line.quantity,
          balance_after: restoredQty,
          agent_id:      existing.agent_id,
          order_id:      req.params.id,
          by_name:       req.user!.name,
          by_user_id:    req.user!.id,
          to_agent_location_id: reversalLocation.id,
          to_location:   reversalLocation.name,
          note:          `Delivery reversed — ${line.productName}${line.isFreeGift ? " (gift)" : ""} restored ${currentQty} → ${restoredQty} for order ${req.params.id} (agent ${agentInfo?.name ?? existing.agent_id})`
        });
      }
    }

    await supabase.from("waybill_records")
      .delete()
      .eq("org_id", req.user!.orgId)
      .eq("to_location", `Customer:${req.params.id}`);
  }

  // Audit log — awaited so failures are visible
  const { error: auditErr } = await supabase.from("order_audit").insert({
    order_id:    req.params.id,
    org_id:      req.user!.orgId,
    changed_by:  req.user!.id,
    from_status: existing?.status ?? null,
    to_status:   status,
    note:        isDeliveredDateCorrection
      ? (req.body.reason ?? `Delivered date corrected to ${updates.delivered_date}`)
      : (req.body.reason ?? null)
  });
  if (auditErr) console.error("Audit insert failed:", auditErr.message);

  if (isDeliveredDateCorrection) {
    res.json(data);
    return;
  }

  // In-app notifications
  await notifyOrderEvent(req.user!.orgId, {
    id: data.id, customer: data.customer, phone: data.phone, amount: data.amount, currency: data.currency,
    productName: data.product_name, packageName: data.package_name,
    assignedRepId: data.assigned_rep_id
  }, status);

  // Customer: status change email
  sendOrderStatusEmail(req.user!.orgId, {
    id: data.id, customer: data.customer, email: data.email,
    product_name: data.product_name, package_name: data.package_name, amount: data.amount, currency: data.currency
  }, existing?.status ?? null, status);
  sendOrderStatusSms(req.user!.orgId, {
    id: data.id,
    customer: data.customer,
    phone: data.phone,
    assignedRepId: data.assigned_rep_id,
    product_name: data.product_name,
    package_name: data.package_name,
    amount: data.amount,
    currency: data.currency,
    scheduled_date: data.scheduled_date,
    call_outcome: data.call_outcome,
    response: data.response
  }, existing?.status ?? null, status);

  // Internal: notify owner + admins when delivered
  if (status === "Delivered") {
    sendInternalDeliveredEmail(req.user!.orgId, {
      id: data.id, customer: data.customer,
      product_name: data.product_name, package_name: data.package_name, amount: data.amount, currency: data.currency
    }, req.user!.name);
  }

  res.json(data);
});

// ── GET /api/orders/:id/audit ─────────────────────────────
router.get("/:id/audit", async (req, res) => {
  const { data, error } = await supabase
    .from("order_audit")
    .select("id, from_status, to_status, note, created_at, changed_by")
    .eq("order_id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  type OrderAuditRow = {
    id: string;
    from_status: string | null;
    to_status: string | null;
    note: string | null;
    created_at: string;
    changed_by: string | null;
  };
  type AuditActorRow = { id: string; name: string | null; role: string | null };
  const rows = (data ?? []) as OrderAuditRow[];
  const actorIds = Array.from(new Set(rows.map((row) => row.changed_by).filter((id): id is string => Boolean(id))));
  const actorById = new Map<string, AuditActorRow>();

  if (actorIds.length > 0) {
    const { data: actors, error: actorsError } = await supabase
      .from("users")
      .select("id, name, role")
      .eq("org_id", req.user!.orgId)
      .in("id", actorIds);
    if (!actorsError) {
      for (const actor of (actors ?? []) as AuditActorRow[]) {
        actorById.set(actor.id, actor);
      }
    }
  }

  res.json(rows.map((row) => {
    const actor = row.changed_by ? actorById.get(row.changed_by) : undefined;
    return {
      ...row,
      changed_by_name: actor?.name ?? null,
      changed_by_role: actor?.role ?? null
    };
  }));
});

// ── PATCH /api/orders/:id ─────────────────────────────────
// Fields that may be written even after an order is Delivered/Cancelled.
// Everything else is locked on terminal orders.
const POST_TERMINAL_FIELDS = new Set([
  "response",
  "logistics_cost", "logisticsCost",
  "amount_remitted", "amountRemitted",
  "remittance_status", "remittanceStatus",
  "remittance_received_at", "remittanceReceivedAt",
  "remittance_reason", "remittanceReason",
  "bonus_paid", "bonusPaid",
  "manual_bonus_override", "manualBonusOverride",
  "manual_bonus_reason", "manualBonusReason",
  "bonus_manually_adjusted", "bonusManuallyAdjusted",
  "call_outcome", "callOutcome",
  "delivered_date", "deliveredDate",
  "notes",
  "timeline_notes", "timelineNotes",
]);

const MANUAL_BONUS_FIELDS = new Set([
  "manual_bonus_override", "manualBonusOverride",
  "manual_bonus_reason", "manualBonusReason",
  "bonus_manually_adjusted", "bonusManuallyAdjusted",
]);

const OrderDatePatchSchema = z.object({
  createdAt: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(3).max(500)
}).strict();

router.patch("/:id/date", requireRole("Owner", "Admin"), async (req, res) => {
  const parsed = OrderDatePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const normalizedCreatedAt = normalizeEditableCreatedAt(parsed.data.createdAt);
  if (!normalizedCreatedAt) {
    res.status(400).json({ error: "Choose a valid order date and time." });
    return;
  }

  const { data: current, error: currentError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .maybeSingle();

  if (currentError) {
    res.status(500).json({ error: currentError.message });
    return;
  }
  if (!current) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  if (!current.source_cart_id) {
    res.status(400).json({ error: "Only orders converted from abandoned carts can have their order date adjusted here." });
    return;
  }

  const dateCorrectionUpdates = buildCreatedAtCorrectionAuditUpdates(
    current,
    normalizedCreatedAt.iso,
    parsed.data.reason,
    req.user!.id
  );

  let { data, error } = await supabase
    .from("orders")
    .update({
      created_at: normalizedCreatedAt.iso,
      date: normalizedCreatedAt.dateKey,
      ...dateCorrectionUpdates
    })
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();

  if (error && isMissingDateAuditColumnsError(error)) {
    ({ data, error } = await supabase
      .from("orders")
      .update({
        created_at: normalizedCreatedAt.iso,
        date: normalizedCreatedAt.dateKey
      })
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single());
  }

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Order not found." });
    return;
  }

  await supabase.from("order_audit").insert({
    order_id: req.params.id,
    org_id: req.user!.orgId,
    changed_by: req.user!.id,
    from_status: current.status,
    to_status: current.status,
    note: `Order date changed from ${current.created_at ?? current.date ?? "unknown"} to ${normalizedCreatedAt.iso}. Reason: ${parsed.data.reason}`
  });

  await appendCartJourneyEvent({
    orgId: req.user!.orgId,
    cartId: current.source_cart_id,
    productId: current.product_id ?? null,
    packageId: current.package_id ?? null,
    state: current.state ?? null,
    eventType: "order_date_changed",
    metadata: {
      orderId: String(req.params.id),
      customerName: current.customer ?? null,
      productName: current.product_name ?? null,
      packageName: current.package_name ?? null,
      actorName: req.user!.name,
      fromDate: current.created_at ?? current.date ?? null,
      toDate: normalizedCreatedAt.iso,
      reason: parsed.data.reason
    }
  }).catch(() => undefined);

  res.json(data);
});

router.patch("/:id", async (req, res) => {
  const remittanceReceivedAt = remittanceReceivedAtToIso(
    req.body.remittance_received_at ?? req.body.remittanceReceivedAt
  );
  const remittanceReason = typeof (req.body.remittance_reason ?? req.body.remittanceReason) === "string"
    ? String(req.body.remittance_reason ?? req.body.remittanceReason).trim().slice(0, 240)
    : "";
  if (remittanceReceivedAt === null) {
    res.status(400).json({ error: "Remittance received date must be in YYYY-MM-DD format." });
    return;
  }

  const { data: current } = await supabase
    .from("orders")
    .select("*")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .single();
  if (!current) { res.status(404).json({ error: "Order not found." }); return; }

  const isTerminal = current.status === "Delivered";
  const requestedKeys = Object.keys(req.body);
  const touchesManualBonus = requestedKeys.some((k) => MANUAL_BONUS_FIELDS.has(k));

  if (req.user!.role === "Sales Rep" && touchesManualBonus) {
    res.status(403).json({ error: "Sales reps cannot manually adjust bonuses." });
    return;
  }

  if (req.body.delivered_date !== undefined || req.body.deliveredDate !== undefined) {
    const requestedDeliveredDate = req.body.delivered_date ?? req.body.deliveredDate;
    if (req.user!.role === "Sales Rep") {
      res.status(403).json({ error: "Sales reps cannot directly edit delivered dates." });
      return;
    }
    if (current.status !== "Delivered") {
      res.status(400).json({ error: "Delivered date can only be edited after the order is marked Delivered." });
      return;
    }
    if (typeof requestedDeliveredDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDeliveredDate)) {
      res.status(400).json({ error: "Delivered date must be in YYYY-MM-DD format." });
      return;
    }
  }

  // DB column → list of accepted input keys (snake + common camel aliases).
  // The frontend's snake_case-only call sites still work; new camelCase
  // payloads (which are natural after the snake→camel normalize boundary in
  // api.ts) no longer silently no-op.
  const allowed: Record<string, string[]> = {
    customer:                  ["customer"],
    phone:                     ["phone"],
    whatsapp:                  ["whatsapp"],
    email:                     ["email"],
    address:                   ["address"],
    city:                      ["city"],
    state:                     ["state"],
    response:                  ["response"],
    notes:                     ["notes"],
    assigned_rep_id:           ["assigned_rep_id", "assignedRepId"],
    agent_id:                  ["agent_id", "agentId"],
    agent_location_id:         ["agent_location_id", "agentLocationId"],
    call_outcome:              ["call_outcome", "callOutcome"],
    delivered_date:            ["delivered_date", "deliveredDate"],
    scheduled_date:            ["scheduled_date", "scheduledDate"],
    scheduled_at:              ["scheduled_at", "scheduledAt"],
    amount:                    ["amount"],
    quantity:                  ["quantity"],
    product_id:                ["product_id", "productId"],
    package_id:                ["package_id", "packageId"],
    product_name:              ["product_name", "productName"],
    package_name:              ["package_name", "packageName"],
    source:                    ["source"],
    location:                  ["location"],
    currency:                  ["currency"],
    logistics_cost:            ["logistics_cost", "logisticsCost"],
    amount_remitted:           ["amount_remitted", "amountRemitted"],
    remittance_status:         ["remittance_status", "remittanceStatus"],
    upsell_from_qty:           ["upsell_from_qty", "upsellFromQty"],
    upsell_to_qty:             ["upsell_to_qty", "upsellToQty"],
    upsell_note:               ["upsell_note", "upsellNote"],
    manual_bonus_override:     ["manual_bonus_override", "manualBonusOverride"],
    manual_bonus_reason:       ["manual_bonus_reason", "manualBonusReason"],
    bonus_manually_adjusted:   ["bonus_manually_adjusted", "bonusManuallyAdjusted"],
    bonus_paid:                ["bonus_paid", "bonusPaid"],
    timeline_notes:            ["timeline_notes", "timelineNotes"],
    cross_sell_lines:          ["cross_sell_lines", "crossSellLines"],
    free_gift_lines:           ["free_gift_lines", "freeGiftLines"]
  };
  const updates: Record<string, unknown> = {};
  for (const [dbKey, inputKeys] of Object.entries(allowed)) {
    for (const inKey of inputKeys) {
      if (req.body[inKey] !== undefined) { updates[dbKey] = req.body[inKey]; break; }
    }
  }
  const requestedTerminalSafeKeys = new Set(Object.keys(updates));
  if (req.body.remittance_reason !== undefined || req.body.remittanceReason !== undefined) {
    requestedTerminalSafeKeys.add("remittance_reason");
  }
  const hasNonTerminalField = Array.from(requestedTerminalSafeKeys).some((key) => !POST_TERMINAL_FIELDS.has(key));
  if (isTerminal && hasNonTerminalField) {
    res.status(403).json({ error: "This order is in a terminal state and cannot be edited." });
    return;
  }
  if (updates.scheduled_at !== undefined || updates.timeline_notes !== undefined) {
    updates.notes = serializePlannedOrderMetadata(current.notes, {
      scheduledAt: updates.scheduled_at as string | null | undefined,
      timelineNotes: updates.timeline_notes as unknown[] | null | undefined
    });
  }
  if (typeof updates.delivered_date === "string") {
    Object.assign(
      updates,
      buildDeliveredDateCorrectionAuditUpdates(
        current,
        updates.delivered_date,
        typeof req.body.reason === "string" ? req.body.reason : undefined,
        req.user!.id
      )
    );
  }
  if (Object.prototype.hasOwnProperty.call(updates, "assigned_rep_id")) {
    const nextAssignedRepId = updates.assigned_rep_id ? String(updates.assigned_rep_id) : null;
    const currentAssignedRepId = current.assigned_rep_id ? String(current.assigned_rep_id) : null;
    if (nextAssignedRepId !== currentAssignedRepId) {
      if (nextAssignedRepId) {
        updates.assigned_by_user_id = req.user!.id;
        updates.assigned_by_name_snapshot = req.user!.name;
      } else {
        updates.assigned_by_user_id = null;
        updates.assigned_by_name_snapshot = null;
      }
    }
  }

  // Validate cross-org references
  if (updates.agent_id) {
    const { data: agentCheck } = await supabase.from("agents").select("id").eq("id", updates.agent_id).eq("org_id", req.user!.orgId).single();
    if (!agentCheck) { res.status(400).json({ error: "Agent not found in your organization." }); return; }
  }
  if (updates.agent_location_id) {
    const owningAgentId = updates.agent_id === undefined ? current.agent_id : updates.agent_id;
    if (!owningAgentId) {
      res.status(400).json({ error: "Choose an agent before assigning a stock location." });
      return;
    }
    const { data: locationCheck } = await supabase
      .from("agent_locations").select("id")
      .eq("id", updates.agent_location_id)
      .eq("agent_id", owningAgentId)
      .eq("org_id", req.user!.orgId)
      .single();
    if (!locationCheck) { res.status(400).json({ error: "Agent location not found in your organization." }); return; }
  }
  if (updates.assigned_rep_id) {
    const { data: repCheck } = await supabase.from("users").select("id").eq("id", updates.assigned_rep_id).eq("org_id", req.user!.orgId).single();
    if (!repCheck) { res.status(400).json({ error: "Rep not found in your organization." }); return; }
  }
  if (updates.product_id) {
    const { data: productCheck } = await supabase.from("products").select("id").eq("id", updates.product_id).eq("org_id", req.user!.orgId).single();
    if (!productCheck) { res.status(400).json({ error: "Product not found in your organization." }); return; }
  }
  if (updates.package_id) {
    const { data: packageCheck } = await supabase
      .from("product_packages")
      .select("id, product_id, package_components")
      .eq("id", updates.package_id)
      .single();
    if (!packageCheck) { res.status(400).json({ error: "Package not found." }); return; }
    const { data: pkgProductCheck } = await supabase
      .from("products")
      .select("id")
      .eq("id", packageCheck.product_id)
      .eq("org_id", req.user!.orgId)
      .single();
    if (!pkgProductCheck) { res.status(400).json({ error: "Package does not belong to your organization." }); return; }
    updates.package_components_snapshot = await buildPackageComponentSnapshot(req.user!.orgId, packageCheck.package_components ?? []);
    if (updates.product_id === undefined) updates.product_id = packageCheck.product_id;
  }
  if (updates.agent_id !== undefined || updates.agent_location_id !== undefined || updates.city !== undefined || updates.state !== undefined || updates.product_id !== undefined) {
    const effectiveAgentId = updates.agent_id === undefined
      ? current.agent_id
      : (updates.agent_id ? String(updates.agent_id) : null);
    if (effectiveAgentId) {
      Object.assign(
        updates,
        await buildAgentAssignmentSnapshot(req.user!.orgId, effectiveAgentId, {
          state: (updates.state as string | undefined) ?? current.state ?? undefined,
          city: (updates.city as string | undefined) ?? current.city ?? undefined
        })
      );
      Object.assign(
        updates,
        await buildAgentLocationSnapshot(req.user!.orgId, effectiveAgentId, {
          desiredState: (updates.state as string | undefined) ?? current.state ?? undefined,
          desiredCity: (updates.city as string | undefined) ?? current.city ?? undefined,
          productId: (updates.product_id as string | undefined) ?? current.product_id ?? undefined,
          explicitLocationId: (updates.agent_location_id as string | null | undefined) ?? current.agent_location_id ?? undefined
        })
      );
    } else {
      updates.agent_name_snapshot = null;
      updates.agent_phone_snapshot = null;
      updates.agent_base_state_snapshot = null;
      updates.agent_coverage_state_snapshot = null;
      updates.agent_coverage_city_snapshot = null;
      updates.agent_location_id = null;
      updates.agent_location_name_snapshot = null;
      updates.agent_location_state_snapshot = null;
      updates.agent_location_city_snapshot = null;
    }
  }

  let { data, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();

  if (error && (isMissingPlannedColumnsError(error) || isMissingDateAuditColumnsError(error))) {
    const legacyUpdates = stripUpdateKeys(updates, [
      "scheduled_at",
      "timeline_notes",
      ...DATE_AUDIT_UPDATE_KEYS
    ]);
    ({ data, error } = await supabase
      .from("orders")
      .update(legacyUpdates)
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single());
  }

  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data)  { res.status(404).json({ error: "Order not found." }); return; }

  await logRemittanceDelta({
    orgId: req.user!.orgId,
    orderId: req.params.id,
    previousAmountRemitted: current.amount_remitted,
    nextAmountRemitted: (data as any).amount_remitted,
    userId: req.user!.id,
    userName: req.user!.name,
    reason: remittanceReason || "Manual remittance update",
    receivedAt: remittanceReceivedAt,
    snapshot: {
      orderCreatedAt: (data as any).created_at,
      orderDeliveredDate: (data as any).delivered_date,
      productId: (data as any).product_id,
      productName: (data as any).product_name,
      packageName: (data as any).package_name,
      customer: (data as any).customer,
      assignedRepId: (data as any).assigned_rep_id,
      agentId: (data as any).agent_id,
      orderAmount: (data as any).amount,
      logisticsCost: (data as any).logistics_cost
    }
  });
  await syncOrderFollowUpTask({
    orgId: req.user!.orgId,
    orderId: req.params.id,
    assignedRepId: data.assigned_rep_id ?? null,
    status: data.status ?? null,
    scheduledDate: updates.scheduled_date !== undefined ? updates.scheduled_date as string | null : data.scheduled_date ?? null,
    scheduledAt: updates.scheduled_at !== undefined ? updates.scheduled_at as string | null : data.scheduled_at ?? null,
    timelineNotes: updates.timeline_notes !== undefined ? updates.timeline_notes : data.timeline_notes
  }).catch(() => undefined);
  if (updates.delivered_date !== undefined) {
    await supabase.from("order_audit").insert({
      order_id:    req.params.id,
      org_id:      req.user!.orgId,
      changed_by:  req.user!.id,
      from_status: current.status,
      to_status:   current.status,
      note:        `Delivered date corrected to ${updates.delivered_date}`
    });
  }

  if (current.source_cart_id && updates.assigned_rep_id !== undefined && current.assigned_rep_id !== data.assigned_rep_id) {
    const { data: assignedRep } = data.assigned_rep_id
      ? await supabase
          .from("users")
          .select("id, name")
          .eq("id", data.assigned_rep_id)
          .eq("org_id", req.user!.orgId)
          .maybeSingle()
      : { data: null };
    void queueCartJourneyEvent({
      orgId: req.user!.orgId,
      cartId: current.source_cart_id,
      productId: current.product_id ?? null,
      packageId: current.package_id ?? null,
      state: (data.state ?? current.state) ?? null,
      eventType: current.assigned_rep_id ? "order_reassigned" : "order_assigned",
      metadata: {
        orderId: req.params.id,
        customerName: data.customer ?? current.customer ?? null,
        productName: data.product_name ?? current.product_name ?? null,
        packageName: data.package_name ?? current.package_name ?? null,
        fromRepId: current.assigned_rep_id ?? null,
        toRepId: data.assigned_rep_id ?? null,
        repName: assignedRep?.name ?? null,
        actorName: req.user!.name
      }
    });
  }

  if (current.source_cart_id && updates.agent_id !== undefined && current.agent_id !== data.agent_id) {
    void queueCartJourneyEvent({
      orgId: req.user!.orgId,
      cartId: current.source_cart_id,
      productId: current.product_id ?? null,
      packageId: current.package_id ?? null,
      state: (data.state ?? current.state) ?? null,
      eventType: current.agent_id ? "delivery_agent_reassigned" : "delivery_agent_assigned",
      metadata: {
        orderId: req.params.id,
        customerName: data.customer ?? current.customer ?? null,
        productName: data.product_name ?? current.product_name ?? null,
        packageName: data.package_name ?? current.package_name ?? null,
        fromAgentId: current.agent_id ?? null,
        toAgentId: data.agent_id ?? null,
        agentName: data.agent_name_snapshot ?? null,
        actorName: req.user!.name
      }
    });
  }
  res.json(data);
});

router.get("/:id/follow-up-tasks", async (req, res) => {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, assigned_rep_id")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .maybeSingle();

  if (orderError) { res.status(500).json({ error: orderError.message }); return; }
  if (!order) { res.status(404).json({ error: "Order not found." }); return; }
  if (req.user!.role === "Sales Rep" && order.assigned_rep_id !== req.user!.id) {
    res.status(403).json({ error: "You can only view follow-up work on your own orders." });
    return;
  }

  const { data, error } = await supabase
    .from("follow_up_tasks")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .eq("order_id", req.params.id)
    .order("due_at", { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json((data ?? []).map((task) => ({
    ...task,
    effective_status: taskStatusFor(task)
  })));
});

router.get("/:id/contact-attempts", async (req, res) => {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, assigned_rep_id")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .maybeSingle();

  if (orderError) { res.status(500).json({ error: orderError.message }); return; }
  if (!order) { res.status(404).json({ error: "Order not found." }); return; }
  if (req.user!.role === "Sales Rep" && order.assigned_rep_id !== req.user!.id) {
    res.status(403).json({ error: "You can only view follow-up attempts on your own orders." });
    return;
  }

  const { data, error } = await supabase
    .from("order_contact_attempts")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .eq("order_id", req.params.id)
    .order("attempted_at", { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});

const ContactAttemptSchema = z.object({
  taskId: z.string().uuid().optional().nullable(),
  channel: z.enum(["call", "whatsapp", "sms", "manual"]).default("call"),
  attemptType: z.enum(["scheduled_callback", "fresh_follow_up", "delivery_confirmation", "payment_follow_up", "waybill_follow_up"]).default("scheduled_callback"),
  outcomeCode: z.string().trim().min(1).max(120),
  recoveryBucket: z.enum(FOLLOW_UP_RECOVERY_BUCKETS).optional().nullable(),
  outcomeNote: z.string().trim().max(1000).optional().nullable(),
  nextActionType: z.enum(["callback", "payment_check", "delivery_confirmation", "waybill_follow_up"]).optional().nullable(),
  nextActionAt: z.string().min(1).max(80).optional().nullable(),
  nextActionNote: z.string().trim().max(1000).optional().nullable()
});

router.post("/:id/contact-attempts", async (req, res) => {
  const parsed = ContactAttemptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, source_cart_id, assigned_rep_id, product_id, package_id, state, product_name, package_name, customer")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .maybeSingle();

  if (orderError) { res.status(500).json({ error: orderError.message }); return; }
  if (!order) { res.status(404).json({ error: "Order not found." }); return; }
  if (req.user!.role === "Sales Rep" && order.assigned_rep_id !== req.user!.id) {
    res.status(403).json({ error: "You can only log follow-ups on your own orders." });
    return;
  }

  try {
    const attempt = await recordContactAttemptAndNextAction({
      orgId: req.user!.orgId,
      orderId: req.params.id,
      repId: req.user!.role === "Sales Rep" ? req.user!.id : (order.assigned_rep_id ?? req.user!.id),
      actorName: req.user!.name,
      channel: parsed.data.channel,
      attemptType: parsed.data.attemptType,
      outcomeCode: parsed.data.outcomeCode,
      recoveryBucket: parsed.data.recoveryBucket ?? null,
      outcomeNote: parsed.data.outcomeNote ?? null,
      taskId: parsed.data.taskId ?? null,
      nextActionType: parsed.data.nextActionType ?? null,
      nextActionAt: parsed.data.nextActionAt ?? null,
      nextActionNote: parsed.data.nextActionNote ?? null
    });
    if (order.source_cart_id) {
      void queueCartJourneyEvent({
        orgId: req.user!.orgId,
        cartId: order.source_cart_id,
        productId: order.product_id ?? null,
        packageId: order.package_id ?? null,
        state: order.state ?? null,
        eventType: "contact_attempt_logged",
        metadata: {
          orderId: req.params.id,
          customerName: order.customer ?? null,
          productName: order.product_name ?? null,
          packageName: order.package_name ?? null,
          actorName: req.user!.name,
          channel: parsed.data.channel,
          outcomeCode: parsed.data.outcomeCode,
          nextActionType: parsed.data.nextActionType ?? null
        }
      });
    }
    res.status(201).json(attempt);
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Could not log this follow-up attempt." });
  }
});

// ── DELETE /api/orders/:id ────────────────────────────────
router.delete("/:id", requireRole("Owner", "Admin"), async (req, res) => {
  // Fetch before deleting so we can log context and reverse side-effects
  const { data: existing } = await supabase
    .from("orders").select("status, customer, product_name, product_id, amount, agent_id, agent_location_id, quantity, stock_deducted, state, city, package_components_snapshot, cross_sell_lines, free_gift_lines")
    .eq("id", req.params.id).eq("org_id", req.user!.orgId).single();

  if (!existing) { res.status(404).json({ error: "Order not found." }); return; }

  const inventoryLines = orderInventoryLinesFromRow(existing);
  const inventoryProductId = primaryInventoryProductId(inventoryLines, existing.product_id);

  // Reverse stock deduction if order was Delivered with an agent
  if (existing.status === "Delivered" && existing.stock_deducted && existing.agent_id && inventoryLines.length > 0) {

    const reversalLocation = existing.agent_location_id
      ? await resolveAgentLocationForOrder(req.user!.orgId, existing.agent_id, {
          desiredState: existing.state,
          desiredCity: existing.city,
          productId: inventoryProductId,
          explicitLocationId: existing.agent_location_id
        })
      : await resolveAgentLocationForOrder(req.user!.orgId, existing.agent_id, {
          desiredState: existing.state,
          desiredCity: existing.city,
          productId: inventoryProductId
        });

    if (reversalLocation) {
      const stockMap = await inventoryAvailabilityMap(
        existing.agent_id,
        reversalLocation.id,
        inventoryLines.map((line) => line.productId)
      );
      const { data: agentInfo } = await supabase
        .from("agents").select("name").eq("id", existing.agent_id).single();
      for (const line of inventoryLines) {
        const currentQty = stockMap.get(line.productId) ?? 0;
        const restoredQty = currentQty + line.quantity;
        await applyLocationInventoryDelta(req.user!.orgId, existing.agent_id, reversalLocation.id, line, restoredQty);
        await supabase.from("stock_movements").insert({
          id:            `MOV-${randomUUID()}`,
          org_id:        req.user!.orgId,
          product_id:    line.productId,
          product_name:  line.productName,
          type:          "Delete Reversal",
          qty:           line.quantity,
          balance_after: restoredQty,
          agent_id:      existing.agent_id,
          order_id:      req.params.id,
          by_name:       req.user!.name,
          by_user_id:    req.user!.id,
          to_agent_location_id: reversalLocation.id,
          to_location:   reversalLocation.name,
          note:          `Stock restored — ${line.productName}${line.isFreeGift ? " (gift)" : ""} returned because order ${req.params.id} was deleted (${currentQty} → ${restoredQty}, agent ${agentInfo?.name ?? existing.agent_id})`
        });
      }
    }

    // Remove the auto-created waybill for this order
    await supabase.from("waybill_records")
      .delete()
      .eq("org_id", req.user!.orgId)
      .eq("to_location", `Customer:${req.params.id}`);
  }

  // Audit log before delete (so FK is still valid)
  await supabase.from("order_audit").insert({
    order_id:    req.params.id,
    org_id:      req.user!.orgId,
    changed_by:  req.user!.id,
    from_status: existing.status,
    to_status:   "Deleted",
    note:        `Order deleted (was ${existing.status}). Customer: ${existing.customer}, Product: ${existing.product_name}, Amount: ${existing.amount}`
  });

  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }

  res.status(204).send();
});

export default router;
