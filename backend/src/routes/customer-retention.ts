import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { resolveDateBounds } from "../lib/date-bounds.js";
import {
  dueStageFor, priorityBandFor, compareByPriority, dayKey, daysBetween, NEGATIVE_SATISFACTION_OUTCOMES,
  type RetentionTouchpointRecord
} from "../lib/customer-retention-logic.js";

const router = Router();
router.use(requireAuth);

const RETENTION_ROLES = ["Owner", "Admin", "Manager", "Recovery Rep"] as const;

const DEFAULT_BONUS_SETTINGS = {
  satisfactionCheckBonus: 200,
  writtenReviewBonus: 500,
  videoTestimonialBonus: 1500,
  referralBonus: 1000,
  retentionSaleBonusPct: 10,
  customerDiscountPct: 10,
  highValueOrderThreshold: 50000,
  monthlyBonusTarget: 30000
};

async function loadBonusSettings(orgId: string) {
  const { data } = await supabase
    .from("customer_retention_bonus_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) return DEFAULT_BONUS_SETTINGS;
  return {
    satisfactionCheckBonus: Number(data.satisfaction_check_bonus ?? DEFAULT_BONUS_SETTINGS.satisfactionCheckBonus),
    writtenReviewBonus: Number(data.written_review_bonus ?? DEFAULT_BONUS_SETTINGS.writtenReviewBonus),
    videoTestimonialBonus: Number(data.video_testimonial_bonus ?? DEFAULT_BONUS_SETTINGS.videoTestimonialBonus),
    referralBonus: Number(data.referral_bonus ?? DEFAULT_BONUS_SETTINGS.referralBonus),
    retentionSaleBonusPct: Number(data.retention_sale_bonus_pct ?? DEFAULT_BONUS_SETTINGS.retentionSaleBonusPct),
    customerDiscountPct: Number(data.customer_discount_pct ?? DEFAULT_BONUS_SETTINGS.customerDiscountPct),
    highValueOrderThreshold: Number(data.high_value_order_threshold ?? DEFAULT_BONUS_SETTINGS.highValueOrderThreshold),
    monthlyBonusTarget: Number(data.monthly_bonus_target ?? DEFAULT_BONUS_SETTINGS.monthlyBonusTarget)
  };
}

const SATISFACTION_OUTCOMES = [
  "satisfied", "has_not_used_it", "needs_usage_guidance", "wrong_damaged_or_incomplete",
  "not_satisfied", "potential_repeat_buyer", "potential_referral_customer"
] as const;

type WorklistRow = {
  orderId: string; customerName: string; phone: string; deliveredDate: string; daysSinceDelivery: number;
  dueStage: ReturnType<typeof dueStageFor>["dueStage"]; overdueBy: number; priorityBand: ReturnType<typeof priorityBandFor>;
  orderAmount: number; orderCurrency: string; productName: string;
  assignedRepId: string | null; assignedRepName: string | null;
  lastTouchpoint: { stage: string; loggedAt: string; satisfactionOutcome: string | null } | null;
  lastContactAt: string | null; nextActionAt: string | null; nextActionNote: string | null;
  discountOwed: boolean; reviewRequested: boolean; reviewCollected: boolean; referralRequested: boolean; referralCollected: boolean;
};

// Shared point-in-time worklist computation - used by both /worklist
// (filtered/sorted for the rep-facing queue) and /dashboard-summary (raw
// rows aggregated into KPI/lifecycle-pipeline counts). Kept as one function
// so both endpoints agree on exactly which orders are "in the retention
// lifecycle" and how their due-stage is derived.
async function loadWorklistRows(orgId: string, settings: Awaited<ReturnType<typeof loadBonusSettings>>): Promise<WorklistRow[]> {
  const today = dayKey(new Date().toISOString());
  const oldestRelevant = new Date();
  oldestRelevant.setUTCDate(oldestRelevant.getUTCDate() - 90);

  const { data: deliveredOrders, error: ordersError } = await supabase
    .from("orders")
    .select("id, customer, phone, delivered_date, product_id, package_id, amount, currency, product_name, assigned_rep_id")
    .eq("org_id", orgId)
    .eq("status", "Delivered")
    .gte("delivered_date", oldestRelevant.toISOString().slice(0, 10))
    .not("delivered_date", "is", null);
  if (ordersError) throw new Error(ordersError.message);
  let orders = deliveredOrders ?? [];
  if (orders.length === 0) return [];

  const repIds = [...new Set(orders.map((o) => o.assigned_rep_id).filter(Boolean))] as string[];
  const { data: repUsers } = repIds.length > 0
    ? await supabase.from("users").select("id, name").in("id", repIds)
    : { data: [] as { id: string; name: string }[] };
  const repNameById = new Map((repUsers ?? []).map((u) => [u.id, u.name]));

  // Opted-out customers must leave the worklist - blocks_followup already
  // suppresses follow-up obligations elsewhere (customers.ts), but the
  // retention worklist never checked it, so an opted-out phone stayed in
  // the queue forever.
  const { data: optOuts } = await supabase
    .from("customer_flags")
    .select("phone")
    .eq("org_id", orgId)
    .eq("blocks_followup", true);
  const optedOutPhones = new Set((optOuts ?? []).map((f) => f.phone));
  orders = orders.filter((o) => !optedOutPhones.has(String(o.phone).replace(/\D/g, "")));
  if (orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const { data: touchpointRows, error: touchpointsError } = await supabase
    .from("customer_retention_touchpoints")
    .select("order_id, stage, satisfaction_outcome, review_collected, referral_collected, review_is_video, review_requested_at, referral_requested_at, retention_outcome, customer_discount_owed, customer_discount_cleared_at, next_action, next_action_at, next_action_note, reach_status, logged_at")
    .eq("org_id", orgId)
    .in("order_id", orderIds)
    .order("logged_at", { ascending: true });
  if (touchpointsError) throw new Error(touchpointsError.message);

  const touchpointsByOrder = new Map<string, typeof touchpointRows>();
  for (const row of touchpointRows ?? []) {
    const list = touchpointsByOrder.get(row.order_id) ?? [];
    list.push(row);
    touchpointsByOrder.set(row.order_id, list);
  }

  return orders.map((order) => {
    const tps = (touchpointsByOrder.get(order.id) ?? []) as (RetentionTouchpointRecord & Record<string, any>)[];
    const deliveredKey = String(order.delivered_date).slice(0, 10);
    const { dueStage, overdueBy } = dueStageFor(deliveredKey, today, tps);
    const orderAmount = Number(order.amount ?? 0);
    const priorityBand = priorityBandFor({ dueStage, overdueBy, orderAmount }, settings);
    const last = tps.length > 0 ? tps[tps.length - 1] : null;
    const discountOwed = tps.some((t) => t.customer_discount_owed && !t.customer_discount_cleared_at);
    const reviewRequested = tps.some((t) => !!t.review_requested_at);
    const reviewCollected = tps.some((t) => t.review_collected);
    const referralRequested = tps.some((t) => !!t.referral_requested_at);
    const referralCollected = tps.some((t) => t.referral_collected);
    const lastContactAt = tps.length > 0 ? tps.reduce((max, t) => (t.logged_at > max ? t.logged_at : max), tps[0].logged_at) : null;
    return {
      orderId: order.id,
      customerName: order.customer,
      phone: order.phone,
      deliveredDate: deliveredKey,
      daysSinceDelivery: daysBetween(deliveredKey, today),
      dueStage,
      overdueBy,
      priorityBand,
      orderAmount,
      orderCurrency: order.currency,
      productName: order.product_name,
      assignedRepId: order.assigned_rep_id ?? null,
      assignedRepName: order.assigned_rep_id ? (repNameById.get(order.assigned_rep_id) ?? null) : null,
      lastTouchpoint: last ? { stage: last.stage, loggedAt: last.logged_at, satisfactionOutcome: last.satisfaction_outcome } : null,
      lastContactAt,
      nextActionAt: last?.next_action_at ?? null,
      nextActionNote: last?.next_action_note ?? null,
      discountOwed,
      reviewRequested, reviewCollected, referralRequested, referralCollected
    };
  });
}

router.get("/worklist", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const stageFilter = typeof req.query.stage === "string" ? req.query.stage : "all";
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const minValue = typeof req.query.minValue === "string" && !Number.isNaN(Number(req.query.minValue)) ? Number(req.query.minValue) : null;
    const priorityFilter = typeof req.query.priority === "string" && req.query.priority !== "all" ? req.query.priority : null;
    const productFilter = typeof req.query.product === "string" && req.query.product !== "all" ? req.query.product : null;
    const assignedRepFilter = typeof req.query.assignedRepId === "string" && req.query.assignedRepId !== "all" ? req.query.assignedRepId : null;

    const settings = await loadBonusSettings(orgId);
    const allRows = await loadWorklistRows(orgId, settings);

    const rows = allRows
      // "all" means "everything actionable" - rows with no due stage (fully
      // progressed / not yet eligible) are noise in a work queue and are
      // still reachable individually via the stage-specific filters.
      .filter((row) => (stageFilter === "all" ? row.dueStage !== null : row.dueStage === stageFilter))
      .filter((row) => !search || row.customerName.toLowerCase().includes(search) || String(row.phone).includes(search) || row.orderId.toLowerCase().includes(search))
      .filter((row) => minValue === null || row.orderAmount >= minValue)
      .filter((row) => !priorityFilter || row.priorityBand === priorityFilter)
      .filter((row) => !productFilter || row.productName === productFilter)
      .filter((row) => !assignedRepFilter || row.assignedRepId === assignedRepFilter)
      .sort(compareByPriority);

    res.json({ rows });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load the customer retention worklist." });
  }
});

router.get("/order/:orderId/retention-suggestion", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const { data: order } = await supabase
      .from("orders")
      .select("id, product_id, package_id")
      .eq("org_id", orgId)
      .eq("id", req.params.orderId)
      .maybeSingle();
    if (!order?.package_id) { res.json({ suggestion: null }); return; }
    const { data: pkg } = await supabase
      .from("product_packages")
      .select("companion_products")
      .eq("id", order.package_id)
      .maybeSingle();
    const companions = Array.isArray(pkg?.companion_products) ? pkg!.companion_products : [];
    const first = companions.find((c: any) => c?.active !== false && (c?.productId ?? c?.product_id));
    if (!first) { res.json({ suggestion: null }); return; }
    res.json({ suggestion: { productId: first.productId ?? first.product_id, packageId: first.packageId ?? first.package_id ?? null } });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load a retention suggestion." });
  }
});

// GET /customer/:phone - Customer Detail Drawer aggregation. No existing
// endpoint does this (customers.ts only does org-list-level aggregation);
// reuses its phone-digits-only normalization convention.
router.get("/customer/:phone", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const targetPhone = String(req.params.phone).replace(/\D/g, "");
    if (!targetPhone) { res.status(400).json({ error: "Invalid phone." }); return; }

    const { data: allOrders, error } = await supabase
      .from("orders")
      .select("id, customer, phone, city, state, product_name, package_name, amount, currency, status, delivered_date, created_at")
      .eq("org_id", orgId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    const orders = (allOrders ?? []).filter((o) => String(o.phone).replace(/\D/g, "") === targetPhone);
    if (orders.length === 0) { res.status(404).json({ error: "No orders found for this customer." }); return; }

    const byCreatedAsc = [...orders].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const byCreatedDesc = [...orders].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const first = byCreatedAsc[0];
    const latestOrder = byCreatedDesc[0];
    const delivered = orders.filter((o) => o.status === "Delivered");
    const totalSpent = delivered.reduce((sum, o) => sum + Number(o.amount ?? 0), 0);
    const latestDelivered = [...delivered].sort((a, b) => String(b.delivered_date ?? "").localeCompare(String(a.delivered_date ?? "")))[0] ?? null;

    const orderIds = orders.map((o) => o.id);
    const { data: touchpointRows } = await supabase
      .from("customer_retention_touchpoints")
      .select("order_id, stage, satisfaction_outcome, satisfaction_notes, review_collected, review_is_video, referral_collected, retention_outcome, resulting_order_id, logged_at, reach_status, review_requested_at, referral_requested_at")
      .eq("org_id", orgId)
      .in("order_id", orderIds)
      .order("logged_at", { ascending: true });
    const tps = touchpointRows ?? [];

    // Decision B: Protohub has no order-level "Returned" concept - this is
    // a real, defensible proxy, never silently labeled "Returns" on the
    // frontend.
    const wrongDamagedReportsCount = tps.filter((t) => t.stage === "satisfaction_check" && t.satisfaction_outcome === "wrong_damaged_or_incomplete").length;

    const timeline: Array<{ type: string; at: string; detail: string }> = [];
    for (const o of delivered) {
      if (o.delivered_date) timeline.push({ type: "order_delivered", at: `${o.delivered_date}T00:00:00`, detail: `Order #${o.id} delivered (${o.product_name})` });
    }
    for (const t of tps) {
      if (t.stage === "satisfaction_check" && t.satisfaction_outcome) {
        timeline.push({ type: "satisfaction_check", at: t.logged_at, detail: `Satisfaction check: ${String(t.satisfaction_outcome).replace(/_/g, " ")}${t.satisfaction_notes ? " — " + t.satisfaction_notes : ""}` });
      } else if (t.stage === "review_referral") {
        // A request and its eventual collection are two distinct moments
        // (Decision D) - show "requested" only while still outstanding, so
        // the exact scenario the spec describes ("Review requested;
        // customer agreed but hasn't sent it") renders correctly instead
        // of falling through to a generic contact-attempt line.
        if (t.review_requested_at && !t.review_collected) timeline.push({ type: "review_requested", at: t.review_requested_at, detail: "Review requested" });
        if (t.referral_requested_at && !t.referral_collected) timeline.push({ type: "referral_requested", at: t.referral_requested_at, detail: "Referral requested" });
        if (t.review_collected) timeline.push({ type: "review_collected", at: t.logged_at, detail: t.review_is_video ? "Video testimonial collected" : "Written review collected" });
        if (t.referral_collected) timeline.push({ type: "referral_collected", at: t.logged_at, detail: "Referral collected" });
        if (!t.review_collected && !t.referral_collected && !t.review_requested_at && !t.referral_requested_at && t.reach_status) {
          timeline.push({ type: "note", at: t.logged_at, detail: `Contact attempt (${String(t.reach_status).replace("_", " ")})` });
        }
      } else if (t.stage === "retention_sale" && t.retention_outcome) {
        timeline.push({ type: "retention_sale_attempt", at: t.logged_at, detail: `Retention sale ${t.retention_outcome}${t.resulting_order_id ? " — order #" + t.resulting_order_id : ""}` });
      }
    }
    timeline.sort((a, b) => b.at.localeCompare(a.at));

    let nextAction: { recommendedText: string; dueStage: string | null; orderId: string | null } = {
      recommendedText: "No delivered order to follow up on yet.", dueStage: null, orderId: null
    };
    if (latestDelivered?.delivered_date) {
      const today = dayKey(new Date().toISOString());
      const relevantTps = tps.filter((t) => t.order_id === latestDelivered.id) as any;
      const { dueStage, overdueBy } = dueStageFor(String(latestDelivered.delivered_date).slice(0, 10), today, relevantTps);
      const action =
        dueStage === "needs_resolution" ? "Resolve this customer's complaint"
        : dueStage === "satisfaction_check" ? "Run a satisfaction check"
        : dueStage === "review_referral" ? "Ask for a review or referral"
        : dueStage === "retention_sale" ? "Offer a repeat-purchase product"
        : dueStage === "win_back" ? "Attempt a win-back offer"
        : null;
      const recommendedText = action === null ? "No action currently due."
        : dueStage === "needs_resolution" ? `${action} now.`
        : overdueBy > 0 ? `${action} — ${overdueBy}d overdue.`
        : `${action} — due today.`;
      nextAction = { recommendedText, dueStage, orderId: latestDelivered.id };
    }

    // Simple, defensible status label (not a stored field) - "Needs
    // Attention" takes priority since an open complaint matters more than
    // order count.
    const customerStatus = nextAction.dueStage === "needs_resolution" ? "Needs Attention" : delivered.length > 1 ? "Repeat Buyer" : "New Customer";

    res.json({
      customer: { name: first.customer, phone: first.phone, city: first.city, state: first.state, customerSince: first.created_at, status: customerStatus },
      summary: { totalOrders: orders.length, totalSpent, delivered: delivered.length, wrongDamagedReportsCount, ltv: totalSpent },
      latestOrder: latestOrder ? {
        orderId: latestOrder.id, product: latestOrder.product_name, package: latestOrder.package_name,
        amount: Number(latestOrder.amount ?? 0), currency: latestOrder.currency, deliveredDate: latestOrder.delivered_date, status: latestOrder.status
      } : null,
      timeline,
      nextAction
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load customer detail." });
  }
});

const OutcomeFields = {
  reachStatus: z.enum(["reached", "not_reached", "not_reachable"]).optional(),
  customerResponse: z.enum(["satisfied", "neutral", "complaint"]).optional(),
  nextAction: z.enum([
    "request_review", "request_referral", "offer_another_product",
    "schedule_follow_up", "needs_resolution", "not_interested", "do_not_contact"
  ]).optional(),
  nextActionAt: z.string().optional(),
  nextActionNote: z.string().max(500).optional()
};

const TouchpointSchema = z.discriminatedUnion("stage", [
  z.object({
    orderId: z.string().min(1),
    stage: z.literal("satisfaction_check"),
    // Optional (not just for the original satisfaction-check flow) - a
    // "Not Reached" attempt against this stage logs reachStatus alone,
    // with no outcome yet.
    satisfactionOutcome: z.enum(SATISFACTION_OUTCOMES).optional(),
    satisfactionNotes: z.string().max(2000).optional(),
    ...OutcomeFields
  }),
  z.object({
    orderId: z.string().min(1),
    stage: z.literal("review_referral"),
    reviewCollected: z.boolean().optional(),
    reviewText: z.string().max(4000).optional(),
    reviewIsVideo: z.boolean().optional(),
    mediaUrls: z.array(z.string().url()).max(10).optional(),
    adPermissionGranted: z.boolean().optional(),
    referralCollected: z.boolean().optional(),
    referralContactName: z.string().max(160).optional(),
    referralContactPhone: z.string().max(40).optional(),
    customerDiscountOwed: z.boolean().optional(),
    customerDiscountNote: z.string().max(300).optional(),
    // Decision D: a request is its own lightweight signal, independent of
    // whether it was also collected in the same visit. Server sets the
    // *_requested_at timestamp itself - never trusts a client-supplied one.
    reviewRequested: z.boolean().optional(),
    referralRequested: z.boolean().optional(),
    ...OutcomeFields
  }),
  z.object({
    orderId: z.string().min(1),
    stage: z.literal("retention_sale"),
    offeredProductId: z.string().uuid().optional(),
    offeredPackageId: z.string().uuid().optional(),
    // Optional for the same reason as satisfactionOutcome above - a
    // "Not Reached" or "Schedule Follow-up" attempt against this stage
    // doesn't have an outcome yet.
    retentionOutcome: z.enum(["accepted", "declined", "no_response"]).optional(),
    resultingOrderId: z.string().optional(),
    ...OutcomeFields
  })
]);

router.post("/touchpoints", requireRole(...RETENTION_ROLES), async (req, res) => {
  const parsed = TouchpointSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const d = parsed.data;
  const orgId = req.user!.orgId;

  const { data: order } = await supabase
    .from("orders")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("id", d.orderId)
    .maybeSingle();
  if (!order) { res.status(404).json({ error: "Order not found." }); return; }
  if (order.status !== "Delivered") { res.status(400).json({ error: "Only Delivered orders can have a retention touchpoint logged." }); return; }

  const row: Record<string, unknown> = {
    org_id: orgId,
    order_id: d.orderId,
    stage: d.stage,
    logged_by: req.user!.id,
    logged_at: new Date().toISOString(),
    reach_status: d.reachStatus ?? null,
    customer_response: d.customerResponse ?? null,
    next_action: d.nextAction ?? null,
    next_action_at: d.nextActionAt ?? null,
    next_action_note: d.nextActionNote ?? null
  };
  if (d.stage === "satisfaction_check") {
    row.satisfaction_outcome = d.satisfactionOutcome ?? null;
    row.satisfaction_notes = d.satisfactionNotes ?? null;
  } else if (d.stage === "review_referral") {
    row.review_collected = d.reviewCollected ?? false;
    row.review_text = d.reviewText ?? null;
    row.review_is_video = d.reviewIsVideo ?? false;
    row.media_urls = d.mediaUrls ?? [];
    row.ad_permission_granted = d.adPermissionGranted ?? false;
    row.referral_collected = d.referralCollected ?? false;
    row.referral_contact_name = d.referralContactName ?? null;
    row.referral_contact_phone = d.referralContactPhone ?? null;
    row.customer_discount_owed = d.customerDiscountOwed ?? false;
    row.customer_discount_note = d.customerDiscountNote ?? null;
    const now = new Date().toISOString();
    row.review_requested_at = d.reviewRequested ? now : null;
    row.referral_requested_at = d.referralRequested ? now : null;
  } else {
    row.offered_product_id = d.offeredProductId ?? null;
    row.offered_package_id = d.offeredPackageId ?? null;
    row.retention_outcome = d.retentionOutcome ?? null;
    row.resulting_order_id = d.resultingOrderId ?? null;
  }

  const { data, error } = await supabase.from("customer_retention_touchpoints").insert(row).select("*").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json({ row: data });
});

const TouchpointPatchSchema = z.object({
  mediaUrls: z.array(z.string().url()).max(10).optional(),
  customerDiscountCleared: z.boolean().optional(),
  resultingOrderId: z.string().optional()
});

router.patch("/touchpoints/:id", requireRole(...RETENTION_ROLES), async (req, res) => {
  const parsed = TouchpointPatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const update: Record<string, unknown> = {};
  if (parsed.data.mediaUrls) update.media_urls = parsed.data.mediaUrls;
  if (parsed.data.customerDiscountCleared) update.customer_discount_cleared_at = new Date().toISOString();
  if (parsed.data.resultingOrderId) update.resulting_order_id = parsed.data.resultingOrderId;
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "Nothing to update." }); return; }

  const { data, error } = await supabase
    .from("customer_retention_touchpoints")
    .update(update)
    .eq("org_id", req.user!.orgId)
    .eq("id", req.params.id)
    .select("*")
    .maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(404).json({ error: "Touchpoint not found." }); return; }
  res.json({ row: data });
});

const VIDEO_MIME_EXT: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
const IMAGE_MIME_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp" };

router.post("/media/upload", requireRole(...RETENTION_ROLES), async (req, res) => {
  const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
  const match = dataUrl.match(/^data:((?:image|video)\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) { res.status(400).json({ error: "Invalid image/video data URL." }); return; }
  const mime = match[1].toLowerCase();
  const isVideo = mime.startsWith("video/");
  const ext = isVideo ? VIDEO_MIME_EXT[mime] : IMAGE_MIME_EXT[mime];
  if (!ext) { res.status(400).json({ error: `Unsupported media type: ${mime}.` }); return; }
  const buffer = Buffer.from(match[2], "base64");
  const maxBytes = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    res.status(413).json({ error: isVideo ? "Video exceeds 50MB limit." : "Image exceeds 10MB limit." });
    return;
  }
  const orgId = req.user!.orgId;
  const objectName = `${orgId}/${randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("retention-media")
    .upload(objectName, buffer, { contentType: mime, upsert: false });
  if (uploadError) {
    logger.error("retention media upload failed", { orgId, objectName, error: uploadError.message });
    res.status(500).json({ error: uploadError.message });
    return;
  }
  const { data: publicData } = supabase.storage.from("retention-media").getPublicUrl(objectName);
  res.status(201).json({ url: publicData.publicUrl, path: objectName });
});

// Shared bonus-breakdown computation - used by /bonus-summary (single rep,
// "my bonus this period") and /dashboard-summary (org-wide retention
// revenue/ROI, which needs the same total-payout figure as its "cost").
async function computeBonusBreakdown(
  orgId: string,
  settings: Awaited<ReturnType<typeof loadBonusSettings>>,
  start: string,
  exclusiveEnd: string,
  logged_by: string | null
) {
  let query = supabase
    .from("customer_retention_touchpoints")
    .select("stage, satisfaction_outcome, review_collected, review_is_video, referral_collected, retention_outcome, resulting_order_id, logged_by, logged_at")
    .eq("org_id", orgId)
    .gte("logged_at", `${start}T00:00:00`)
    .lt("logged_at", `${exclusiveEnd}T00:00:00`);
  if (logged_by) query = query.eq("logged_by", logged_by);
  const { data: touchpoints, error } = await query;
  if (error) throw new Error(error.message);
  const rows = touchpoints ?? [];

  const satisfactionChecksLogged = rows.filter((r) => r.stage === "satisfaction_check").length;
  const writtenReviewsCollected = rows.filter((r) => r.stage === "review_referral" && r.review_collected && !r.review_is_video).length;
  const videoTestimonialsCollected = rows.filter((r) => r.stage === "review_referral" && r.review_is_video).length;
  const referralsCollected = rows.filter((r) => r.stage === "review_referral" && r.referral_collected).length;
  const retentionSaleRows = rows.filter((r) => r.stage === "retention_sale" && r.retention_outcome === "accepted" && r.resulting_order_id);

  let retentionSaleBonus = 0;
  const retentionSalesConverted: Array<{ resultingOrderId: string; amount: number }> = [];
  if (retentionSaleRows.length > 0) {
    const resultingIds = retentionSaleRows.map((r) => r.resulting_order_id as string);
    const { data: resultOrders } = await supabase.from("orders").select("id, amount").in("id", resultingIds);
    for (const r of retentionSaleRows) {
      const matched = (resultOrders ?? []).find((o) => o.id === r.resulting_order_id);
      const amount = Number(matched?.amount ?? 0);
      retentionSalesConverted.push({ resultingOrderId: r.resulting_order_id as string, amount });
      retentionSaleBonus += Math.round(amount * (settings.retentionSaleBonusPct / 100));
    }
  }

  const satisfactionBonus = satisfactionChecksLogged * settings.satisfactionCheckBonus;
  const reviewBonus = writtenReviewsCollected * settings.writtenReviewBonus;
  const videoBonus = videoTestimonialsCollected * settings.videoTestimonialBonus;
  const referralBonus = referralsCollected * settings.referralBonus;
  const total = satisfactionBonus + reviewBonus + videoBonus + referralBonus + retentionSaleBonus;

  return {
    satisfactionChecksLogged, writtenReviewsCollected, videoTestimonialsCollected, referralsCollected,
    retentionSalesConverted,
    breakdown: { satisfactionBonus, reviewBonus, videoBonus, referralBonus, retentionSaleBonus, total }
  };
}

router.get("/bonus-summary", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const settings = await loadBonusSettings(orgId);
    const { start, exclusiveEnd } = resolveDateBounds(req.query as Record<string, unknown>);
    const inclusiveEndDate = new Date(`${exclusiveEnd}T00:00:00Z`);
    inclusiveEndDate.setUTCDate(inclusiveEndDate.getUTCDate() - 1);
    const dateTo = inclusiveEndDate.toISOString().slice(0, 10);
    const userId = typeof req.query.userId === "string" ? req.query.userId : req.user!.id;

    const result = await computeBonusBreakdown(orgId, settings, start, exclusiveEnd, userId);
    res.json({ dateFrom: start, dateTo, userId, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load the retention bonus summary." });
  }
});

router.get("/dashboard-summary", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const settings = await loadBonusSettings(orgId);
    const { start, exclusiveEnd } = resolveDateBounds(req.query as Record<string, unknown>);
    const repId = typeof req.query.repId === "string" && req.query.repId ? req.query.repId : null;

    // Point-in-time snapshot (NOT date-ranged) - "Due Today"/"Overdue" and
    // the lifecycle pipeline describe the current state of every order in
    // the retention window, same rows the worklist itself uses.
    const allRows = await loadWorklistRows(orgId, settings);
    const dueToday = allRows.filter((r) => r.dueStage !== null && r.dueStage !== "needs_resolution" && r.overdueBy === 0).length;
    const overdue = allRows.filter((r) => r.overdueBy > 0).length;
    const lifecyclePipeline = {
      delivered: allRows.length,
      satisfactionDue: allRows.filter((r) => r.dueStage === "satisfaction_check").length,
      reviewDue: allRows.filter((r) => r.dueStage === "review_referral" && !r.reviewCollected).length,
      // Referral has its own later window (Day 14-30, vs Review's Day 7-14)
      // per the spec's lifecycle model - it only counts as "due" once that
      // window opens, even though both share one underlying touchpoints
      // stage (Decision A).
      referralDue: allRows.filter((r) => r.dueStage === "review_referral" && !r.referralCollected && r.daysSinceDelivery >= 14).length,
      retentionSaleDue: allRows.filter((r) => r.dueStage === "retention_sale").length,
      winBack: allRows.filter((r) => r.dueStage === "win_back").length,
      needsResolution: allRows.filter((r) => r.dueStage === "needs_resolution").length
    };

    // Date-range-scoped activity (what actually happened in the selected
    // period), optionally scoped to one rep's own logged_by rows.
    const bonusResult = await computeBonusBreakdown(orgId, settings, start, exclusiveEnd, repId);

    let contactedQuery = supabase
      .from("customer_retention_touchpoints")
      .select("order_id, reach_status, satisfaction_outcome, stage, logged_at, logged_by, retention_outcome, resulting_order_id, review_collected, referral_collected, review_requested_at, referral_requested_at")
      .eq("org_id", orgId)
      .gte("logged_at", `${start}T00:00:00`)
      .lt("logged_at", `${exclusiveEnd}T00:00:00`);
    if (repId) contactedQuery = contactedQuery.eq("logged_by", repId);
    const { data: activityRows, error: activityError } = await contactedQuery;
    if (activityError) { res.status(500).json({ error: activityError.message }); return; }
    const activity = activityRows ?? [];

    // "Contacted" = a real reach happened (rows logged before this
    // migration have no reach_status and represent a real logged
    // touchpoint, so they count too - only an explicit not-reached/
    // not-reachable attempt is excluded).
    const contactedOrderIds = new Set(
      activity.filter((r) => r.reach_status !== "not_reached" && r.reach_status !== "not_reachable").map((r) => r.order_id)
    );

    // "Issues Resolved" = a positive satisfaction check logged in this
    // period, for an order that has ALSO had a negative satisfaction
    // outcome at some point (i.e. this check actually resolved a prior
    // complaint, not just a first-time check). Shared between the
    // org-wide figure and the rep-scoped "My Retention Performance" one.
    const deriveIssuesResolved = async (rows: typeof activity): Promise<number> => {
      const positiveIds = [...new Set(
        rows.filter((r) => r.stage === "satisfaction_check" && r.satisfaction_outcome && !NEGATIVE_SATISFACTION_OUTCOMES.has(r.satisfaction_outcome)).map((r) => r.order_id)
      )];
      if (positiveIds.length === 0) return 0;
      const { data: allSatisfactionRows } = await supabase
        .from("customer_retention_touchpoints")
        .select("order_id, satisfaction_outcome")
        .eq("org_id", orgId)
        .eq("stage", "satisfaction_check")
        .in("order_id", positiveIds);
      const everHadNegative = new Set(
        (allSatisfactionRows ?? []).filter((r) => r.satisfaction_outcome && NEGATIVE_SATISFACTION_OUTCOMES.has(r.satisfaction_outcome)).map((r) => r.order_id)
      );
      return positiveIds.filter((id) => everHadNegative.has(id)).length;
    };
    const issuesResolved = await deriveIssuesResolved(activity);

    const reviews = activity.filter((r) => r.stage === "review_referral" && r.review_collected).length;
    const referrals = activity.filter((r) => r.stage === "review_referral" && r.referral_collected).length;

    // Decision D: Reviews and Referrals tracked independently, each with
    // its own requested-to-received conversion rate (a real ask-to-get
    // ratio, not an estimate).
    const reviewsRequested = activity.filter((r) => r.stage === "review_referral" && r.review_requested_at).length;
    const referralsRequested = activity.filter((r) => r.stage === "review_referral" && r.referral_requested_at).length;
    const reviewConversionPct = reviewsRequested > 0 ? Math.round((reviews / reviewsRequested) * 100) : null;
    const referralConversionPct = referralsRequested > 0 ? Math.round((referrals / referralsRequested) * 100) : null;

    const repeatSaleRows = activity.filter((r) => r.stage === "retention_sale" && r.retention_outcome === "accepted" && r.resulting_order_id);
    const repeatSalesRevenue = bonusResult.retentionSalesConverted.reduce((sum, r) => sum + r.amount, 0);
    const repeatCustomers = repeatSaleRows.length;
    const avgRepeatOrder = repeatCustomers > 0 ? Math.round(repeatSalesRevenue / repeatCustomers) : 0;
    const retentionRepCost = bonusResult.breakdown.total;
    // ROI/"Retention Rep Cost" deliberately does NOT charge a second rep
    // salary - this isn't a new role, and repMonthlySalary is already
    // charged as a cost in the Recovery Rep Overview tab's own net-
    // contribution math. Cost here is the actual bonus paid out for this
    // period's retention work, so this never double-counts.
    const grossContribution = repeatSalesRevenue - retentionRepCost;
    const roi = retentionRepCost > 0 ? Math.round((repeatSalesRevenue / retentionRepCost) * 100) / 100 : null;

    // "My Retention Performance" - always scoped to a specific rep
    // (defaults to the caller), independent of whether the figures above
    // are org-wide (repId omitted) or already rep-scoped.
    const performanceRepId = repId ?? req.user!.id;
    const repActivity = activity.filter((r) => r.logged_by === performanceRepId);
    const repBonusResult = repId === performanceRepId ? bonusResult : await computeBonusBreakdown(orgId, settings, start, exclusiveEnd, performanceRepId);

    const tasksAssigned = new Set(repActivity.map((r) => r.order_id)).size;
    const completedStageOrderIds = new Set(
      repActivity.filter((r) =>
        (r.stage === "satisfaction_check" && r.satisfaction_outcome) ||
        (r.stage === "review_referral" && (r.review_collected || r.referral_collected)) ||
        (r.stage === "retention_sale" && r.retention_outcome)
      ).map((r) => r.order_id)
    );
    const tasksCompleted = completedStageOrderIds.size;
    const repCustomersReached = new Set(
      repActivity.filter((r) => r.reach_status !== "not_reached" && r.reach_status !== "not_reachable").map((r) => r.order_id)
    ).size;
    const repIssuesResolved = await deriveIssuesResolved(repActivity);
    const repReviewsReceived = repActivity.filter((r) => r.stage === "review_referral" && r.review_collected).length;
    const repReferralsGenerated = repActivity.filter((r) => r.stage === "review_referral" && r.referral_collected).length;

    const repRetentionSaleRows = repActivity.filter((r) => r.stage === "retention_sale" && r.retention_outcome === "accepted" && r.resulting_order_id);
    let revenueOverTime: Array<{ label: string; current: number }> = [];
    // "Revenue by Source" per the spec is Repeat Sales/Referrals/Other -
    // but only accepted retention-sale offers carry a resulting order's
    // revenue in this data model (referrals don't have their own tracked
    // resulting-order revenue yet). Broken down by the offered product
    // instead - a real, computable "what drives repeat revenue" view,
    // rather than fabricating a referral-revenue figure that isn't tracked.
    let revenueBySource: Array<{ label: string; amount: number; pct: number }> = [];
    let repRetentionRevenue = 0;
    if (repRetentionSaleRows.length > 0) {
      const resultingIds = repRetentionSaleRows.map((r) => r.resulting_order_id as string);
      const { data: resultOrders } = await supabase.from("orders").select("id, amount, product_name").in("id", resultingIds);
      const infoById = new Map((resultOrders ?? []).map((o) => [o.id, { amount: Number(o.amount ?? 0), productName: String(o.product_name ?? "Unknown product") }]));
      const byDay = new Map<string, number>();
      const byProduct = new Map<string, number>();
      for (const r of repRetentionSaleRows) {
        const info = infoById.get(r.resulting_order_id as string);
        if (!info) continue;
        const day = dayKey(r.logged_at);
        byDay.set(day, (byDay.get(day) ?? 0) + info.amount);
        byProduct.set(info.productName, (byProduct.get(info.productName) ?? 0) + info.amount);
        repRetentionRevenue += info.amount;
      }
      revenueOverTime = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([day, amount]) => ({ label: day.slice(5), current: amount }));
      revenueBySource = Array.from(byProduct.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([label, amount]) => ({ label, amount, pct: repRetentionRevenue > 0 ? Math.round((amount / repRetentionRevenue) * 100) : 0 }));
    }
    const repAvgRepeatOrder = repRetentionSaleRows.length > 0 ? Math.round(repRetentionRevenue / repRetentionSaleRows.length) : 0;
    const repRoi = repBonusResult.breakdown.total > 0 ? Math.round((repRetentionRevenue / repBonusResult.breakdown.total) * 100) / 100 : null;

    const repPerformance = {
      tasksAssigned, tasksCompleted,
      completionRatePct: tasksAssigned > 0 ? Math.round((tasksCompleted / tasksAssigned) * 100) : 0,
      customersReached: repCustomersReached,
      contactRatePct: tasksAssigned > 0 ? Math.round((repCustomersReached / tasksAssigned) * 100) : 0,
      issuesResolved: repIssuesResolved,
      reviewsReceived: repReviewsReceived,
      referralsGenerated: repReferralsGenerated,
      repeatPurchases: repRetentionSaleRows.length,
      retentionRevenue: repRetentionRevenue,
      avgRepeatOrder: repAvgRepeatOrder,
      roi: repRoi,
      revenueOverTime,
      revenueBySource
    };

    res.json({
      dateFrom: start,
      dateTo: exclusiveEnd,
      kpis: {
        dueToday, overdue,
        contacted: contactedOrderIds.size,
        issuesResolved,
        reviews, referrals,
        repeatCustomers, repeatSalesRevenue
      },
      lifecyclePipeline,
      reviewsReferrals: { reviewsRequested, reviewsReceived: reviews, reviewConversionPct, referralsRequested, referralsReceived: referrals, referralConversionPct },
      retentionRevenue: { repeatSalesRevenue, repeatCustomers, avgRepeatOrder, grossContribution, retentionRepCost, roi },
      repPerformance,
      bonus: {
        earned: bonusResult.breakdown.total,
        target: settings.monthlyBonusTarget,
        progressPct: settings.monthlyBonusTarget > 0 ? Math.min(100, Math.round((bonusResult.breakdown.total / settings.monthlyBonusTarget) * 100)) : 0
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load the customer retention dashboard summary." });
  }
});

router.get("/settings", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const settings = await loadBonusSettings(req.user!.orgId);
    res.json({ settings });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load retention bonus settings." });
  }
});

router.patch("/settings", requireRole("Owner"), async (req, res) => {
  const body = req.body ?? {};
  const payload = {
    org_id: req.user!.orgId,
    satisfaction_check_bonus: Number(body.satisfactionCheckBonus ?? DEFAULT_BONUS_SETTINGS.satisfactionCheckBonus),
    written_review_bonus: Number(body.writtenReviewBonus ?? DEFAULT_BONUS_SETTINGS.writtenReviewBonus),
    video_testimonial_bonus: Number(body.videoTestimonialBonus ?? DEFAULT_BONUS_SETTINGS.videoTestimonialBonus),
    referral_bonus: Number(body.referralBonus ?? DEFAULT_BONUS_SETTINGS.referralBonus),
    retention_sale_bonus_pct: Number(body.retentionSaleBonusPct ?? DEFAULT_BONUS_SETTINGS.retentionSaleBonusPct),
    customer_discount_pct: Number(body.customerDiscountPct ?? DEFAULT_BONUS_SETTINGS.customerDiscountPct),
    high_value_order_threshold: Number(body.highValueOrderThreshold ?? DEFAULT_BONUS_SETTINGS.highValueOrderThreshold),
    monthly_bonus_target: Number(body.monthlyBonusTarget ?? DEFAULT_BONUS_SETTINGS.monthlyBonusTarget),
    updated_by: req.user!.id,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase
    .from("customer_retention_bonus_settings")
    .upsert(payload, { onConflict: "org_id" });
  if (error) { res.status(500).json({ error: error.message }); return; }
  // Re-load through the same camelCase mapping GET uses, so both endpoints
  // return an identical shape - the raw upserted row is snake_case.
  const settings = await loadBonusSettings(req.user!.orgId);
  res.json({ settings });
});

export default router;
