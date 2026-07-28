import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { resolveDateBounds } from "../lib/date-bounds.js";
import {
  dueStageFor, priorityBandFor, compareByPriority, dayKey, daysBetween,
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

router.get("/worklist", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const stageFilter = typeof req.query.stage === "string" ? req.query.stage : "all";
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const minValue = typeof req.query.minValue === "string" && !Number.isNaN(Number(req.query.minValue)) ? Number(req.query.minValue) : null;
    const today = dayKey(new Date().toISOString());
    const oldestRelevant = new Date();
    oldestRelevant.setUTCDate(oldestRelevant.getUTCDate() - 90);

    const settings = await loadBonusSettings(orgId);

    const { data: deliveredOrders, error: ordersError } = await supabase
      .from("orders")
      .select("id, customer, phone, delivered_date, product_id, package_id, amount, currency, product_name")
      .eq("org_id", orgId)
      .eq("status", "Delivered")
      .gte("delivered_date", oldestRelevant.toISOString().slice(0, 10))
      .not("delivered_date", "is", null);
    if (ordersError) { res.status(500).json({ error: ordersError.message }); return; }
    let orders = deliveredOrders ?? [];
    if (orders.length === 0) { res.json({ rows: [] }); return; }

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
    if (orders.length === 0) { res.json({ rows: [] }); return; }

    const orderIds = orders.map((o) => o.id);
    const { data: touchpointRows, error: touchpointsError } = await supabase
      .from("customer_retention_touchpoints")
      .select("order_id, stage, satisfaction_outcome, review_collected, referral_collected, review_is_video, review_requested_at, referral_requested_at, retention_outcome, customer_discount_owed, customer_discount_cleared_at, next_action, next_action_at, next_action_note, reach_status, logged_at")
      .eq("org_id", orgId)
      .in("order_id", orderIds)
      .order("logged_at", { ascending: true });
    if (touchpointsError) { res.status(500).json({ error: touchpointsError.message }); return; }

    const touchpointsByOrder = new Map<string, typeof touchpointRows>();
    for (const row of touchpointRows ?? []) {
      const list = touchpointsByOrder.get(row.order_id) ?? [];
      list.push(row);
      touchpointsByOrder.set(row.order_id, list);
    }

    const rows = orders.map((order) => {
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
        lastTouchpoint: last ? { stage: last.stage, loggedAt: last.logged_at, satisfactionOutcome: last.satisfaction_outcome } : null,
        lastContactAt,
        nextActionAt: last?.next_action_at ?? null,
        nextActionNote: last?.next_action_note ?? null,
        discountOwed,
        reviewRequested, reviewCollected, referralRequested, referralCollected
      };
    })
      // "all" means "everything actionable" - rows with no due stage (fully
      // progressed / not yet eligible) are noise in a work queue and are
      // still reachable individually via the stage-specific filters.
      .filter((row) => (stageFilter === "all" ? row.dueStage !== null : row.dueStage === stageFilter))
      .filter((row) => !search || row.customerName.toLowerCase().includes(search) || String(row.phone).includes(search) || row.orderId.toLowerCase().includes(search))
      .filter((row) => minValue === null || row.orderAmount >= minValue)
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

const TouchpointSchema = z.discriminatedUnion("stage", [
  z.object({
    orderId: z.string().min(1),
    stage: z.literal("satisfaction_check"),
    satisfactionOutcome: z.enum(SATISFACTION_OUTCOMES),
    satisfactionNotes: z.string().max(2000).optional()
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
    customerDiscountNote: z.string().max(300).optional()
  }),
  z.object({
    orderId: z.string().min(1),
    stage: z.literal("retention_sale"),
    offeredProductId: z.string().uuid().optional(),
    offeredPackageId: z.string().uuid().optional(),
    retentionOutcome: z.enum(["accepted", "declined", "no_response"]),
    resultingOrderId: z.string().optional()
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
    logged_at: new Date().toISOString()
  };
  if (d.stage === "satisfaction_check") {
    row.satisfaction_outcome = d.satisfactionOutcome;
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
  } else {
    row.offered_product_id = d.offeredProductId ?? null;
    row.offered_package_id = d.offeredPackageId ?? null;
    row.retention_outcome = d.retentionOutcome;
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

router.get("/bonus-summary", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const settings = await loadBonusSettings(orgId);
    const { start, exclusiveEnd } = resolveDateBounds(req.query as Record<string, unknown>);
    const inclusiveEndDate = new Date(`${exclusiveEnd}T00:00:00Z`);
    inclusiveEndDate.setUTCDate(inclusiveEndDate.getUTCDate() - 1);
    const dateTo = inclusiveEndDate.toISOString().slice(0, 10);
    const userId = typeof req.query.userId === "string" ? req.query.userId : req.user!.id;

    const { data: touchpoints, error } = await supabase
      .from("customer_retention_touchpoints")
      .select("stage, satisfaction_outcome, review_collected, review_is_video, referral_collected, retention_outcome, resulting_order_id, logged_by, logged_at")
      .eq("org_id", orgId)
      .eq("logged_by", userId)
      .gte("logged_at", `${start}T00:00:00`)
      .lt("logged_at", `${exclusiveEnd}T00:00:00`);
    if (error) { res.status(500).json({ error: error.message }); return; }
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

    res.json({
      dateFrom: start, dateTo, userId,
      satisfactionChecksLogged, writtenReviewsCollected, videoTestimonialsCollected, referralsCollected,
      retentionSalesConverted,
      breakdown: { satisfactionBonus, reviewBonus, videoBonus, referralBonus, retentionSaleBonus, total }
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load the retention bonus summary." });
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
