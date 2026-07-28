import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();
router.use(requireAuth);

const RETENTION_ROLES = ["Owner", "Admin", "Manager", "Recovery Rep"] as const;

const DEFAULT_BONUS_SETTINGS = {
  satisfactionCheckBonus: 200,
  writtenReviewBonus: 500,
  videoTestimonialBonus: 1500,
  referralBonus: 1000,
  retentionSaleBonusPct: 10,
  customerDiscountPct: 10
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
    customerDiscountPct: Number(data.customer_discount_pct ?? DEFAULT_BONUS_SETTINGS.customerDiscountPct)
  };
}

const SATISFACTION_OUTCOMES = [
  "satisfied", "has_not_used_it", "needs_usage_guidance", "wrong_damaged_or_incomplete",
  "not_satisfied", "potential_repeat_buyer", "potential_referral_customer"
] as const;
const NEGATIVE_SATISFACTION_OUTCOMES = new Set(["has_not_used_it", "needs_usage_guidance", "wrong_damaged_or_incomplete", "not_satisfied"]);

const dayKey = (isoOrDate: string) => isoOrDate.slice(0, 10);
const daysBetween = (fromKey: string, toKey: string) =>
  Math.floor((new Date(`${toKey}T00:00:00Z`).getTime() - new Date(`${fromKey}T00:00:00Z`).getTime()) / 86400000);

type Touchpoint = {
  order_id: string;
  stage: "satisfaction_check" | "review_referral" | "retention_sale";
  satisfaction_outcome: string | null;
  review_is_video: boolean;
  logged_at: string;
};

// Pure due-stage logic: derived entirely from delivered_date + which
// touchpoint rows already exist - no stored "next due" column. A negative
// satisfaction outcome routes an order to "needs_resolution" instead of
// progressing toward review/referral, matching the spec's own framing
// ("separates genuine customers from people who need assistance").
function dueStageFor(deliveredDateKey: string, todayKey: string, touchpoints: Touchpoint[]) {
  const age = daysBetween(deliveredDateKey, todayKey);
  const satisfaction = touchpoints.find((t) => t.stage === "satisfaction_check");
  const review = touchpoints.find((t) => t.stage === "review_referral");
  const retention = touchpoints.find((t) => t.stage === "retention_sale");

  if (!satisfaction) {
    return age >= 3 ? { dueStage: "satisfaction_check" as const, overdueBy: age - 3 } : { dueStage: null, overdueBy: 0 };
  }
  if (satisfaction.satisfaction_outcome && NEGATIVE_SATISFACTION_OUTCOMES.has(satisfaction.satisfaction_outcome)) {
    return { dueStage: "needs_resolution" as const, overdueBy: age };
  }
  if (!review) {
    return age >= 7 ? { dueStage: "review_referral" as const, overdueBy: age - 7 } : { dueStage: null, overdueBy: 0 };
  }
  if (!retention) {
    if (age >= 21 && age <= 45) return { dueStage: "retention_sale" as const, overdueBy: age - 21 };
    return { dueStage: null, overdueBy: 0 };
  }
  return { dueStage: null, overdueBy: 0 };
}

router.get("/worklist", requireRole(...RETENTION_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const stageFilter = typeof req.query.stage === "string" ? req.query.stage : "all";
    const today = dayKey(new Date().toISOString());
    const oldestRelevant = new Date();
    oldestRelevant.setUTCDate(oldestRelevant.getUTCDate() - 60);

    const { data: deliveredOrders, error: ordersError } = await supabase
      .from("orders")
      .select("id, customer, phone, delivered_date, product_id, package_id")
      .eq("org_id", orgId)
      .eq("status", "Delivered")
      .gte("delivered_date", oldestRelevant.toISOString().slice(0, 10))
      .not("delivered_date", "is", null);
    if (ordersError) { res.status(500).json({ error: ordersError.message }); return; }
    const orders = deliveredOrders ?? [];
    if (orders.length === 0) { res.json({ rows: [] }); return; }

    const orderIds = orders.map((o) => o.id);
    const { data: touchpointRows, error: touchpointsError } = await supabase
      .from("customer_retention_touchpoints")
      .select("order_id, stage, satisfaction_outcome, review_is_video, customer_discount_owed, customer_discount_cleared_at, logged_at")
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
      const tps = (touchpointsByOrder.get(order.id) ?? []) as Touchpoint[];
      const deliveredKey = String(order.delivered_date).slice(0, 10);
      const { dueStage, overdueBy } = dueStageFor(deliveredKey, today, tps);
      const last = tps.length > 0 ? tps[tps.length - 1] : null;
      const discountOwed = (touchpointsByOrder.get(order.id) ?? []).some(
        (t: any) => t.customer_discount_owed && !t.customer_discount_cleared_at
      );
      return {
        orderId: order.id,
        customerName: order.customer,
        phone: order.phone,
        deliveredDate: deliveredKey,
        daysSinceDelivery: daysBetween(deliveredKey, today),
        dueStage,
        overdueBy,
        lastTouchpoint: last ? { stage: last.stage, loggedAt: last.logged_at, satisfactionOutcome: last.satisfaction_outcome } : null,
        discountOwed
      };
    }).filter((row) => stageFilter === "all" || row.dueStage === stageFilter)
      .sort((a, b) => b.overdueBy - a.overdueBy);

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
    const now = new Date();
    const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : defaultFrom;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : dayKey(now.toISOString());
    const userId = typeof req.query.userId === "string" ? req.query.userId : req.user!.id;

    const { data: touchpoints, error } = await supabase
      .from("customer_retention_touchpoints")
      .select("stage, satisfaction_outcome, review_collected, review_is_video, referral_collected, retention_outcome, resulting_order_id, logged_by, logged_at")
      .eq("org_id", orgId)
      .eq("logged_by", userId)
      .gte("logged_at", `${dateFrom}T00:00:00`)
      .lt("logged_at", `${dateTo}T23:59:59.999`);
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
      dateFrom, dateTo, userId,
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
    updated_by: req.user!.id,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from("customer_retention_bonus_settings")
    .upsert(payload, { onConflict: "org_id" })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

export default router;
