import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { testMetaCapiConnection } from "../lib/meta-capi.js";
import { testTikTokConnection } from "../lib/tiktok-events.js";

const router = Router();
router.use(requireAuth);
router.use(requireRole("Owner"));

const SECRET_MASK = "••••••••";

const ConfigSchema = z.object({
  // Leading char may be a letter, digit, or underscore — the latter for the reserved
  // org-wide sentinel key "__default__" used by server-side auto-submits.
  trackingKey:     z.string().trim().min(2).max(120).regex(/^[A-Za-z0-9_][A-Za-z0-9_.:\-]*$/),
  label:           z.string().trim().min(1).max(200),
  mode:            z.enum(["protohub", "hybrid", "landing_page", "off"]).default("hybrid"),
  pixelId:         z.string().trim().max(80).optional().default(""),
  accessToken:     z.string().trim().max(5000).optional().default(""),
  tiktokPixelId:     z.string().trim().max(80).optional().default(""),
  tiktokAccessToken: z.string().trim().max(5000).optional().default(""),
  redirectUrl:     z.string().trim().max(2000).optional().default(""),
  landingPageUrl:  z.string().trim().max(2000).optional().default(""),
  productId:       z.string().uuid().optional().nullable(),
  utmSource:       z.string().trim().max(120).optional().default(""),
  utmMedium:       z.string().trim().max(120).optional().default(""),
  utmCampaign:     z.string().trim().max(120).optional().default(""),
  testEventCode:   z.string().trim().max(80).optional().default(""),
  active:          z.boolean().default(true)
});

function cleanTrackingKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function presentConfig(row: Record<string, any>) {
  return {
    id:             row.id,
    trackingKey:    row.tracking_key,
    label:          row.label,
    mode:           row.mode,
    pixelId:        row.pixel_id ?? "",
    accessToken:    row.access_token ? SECRET_MASK : "",
    hasAccessToken: Boolean(row.access_token),
    tiktokPixelId:        row.tiktok_pixel_id ?? "",
    tiktokAccessToken:    row.tiktok_access_token ? SECRET_MASK : "",
    hasTiktokAccessToken: Boolean(row.tiktok_access_token),
    redirectUrl:    row.redirect_url ?? "",
    landingPageUrl: row.landing_page_url ?? "",
    productId:      row.product_id ?? null,
    utmSource:      row.utm_source ?? "",
    utmMedium:      row.utm_medium ?? "",
    utmCampaign:    row.utm_campaign ?? "",
    testEventCode:  row.test_event_code ?? "",
    active:         row.active !== false,
    createdAt:      row.created_at ?? null,
    updatedAt:      row.updated_at ?? null
  };
}

// ── GET /api/meta-capi-settings ─────────────────────────
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("meta_capi_configs")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("label", { ascending: true });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json((data ?? []).map(presentConfig));
});

// ── POST /api/meta-capi-settings ────────────────────────
router.post("/", async (req, res) => {
  const parsed = ConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const d = parsed.data;
  const trackingKey = cleanTrackingKey(d.trackingKey);

  const { data: existing } = await supabase
    .from("meta_capi_configs")
    .select("id, access_token, tiktok_access_token")
    .eq("org_id", req.user!.orgId)
    .eq("tracking_key", trackingKey)
    .maybeSingle();

  let accessToken = d.accessToken.trim();
  if (!accessToken || accessToken === SECRET_MASK) {
    accessToken = existing?.access_token ?? "";
  }
  // Preserve the saved TikTok token when the field is blank or masked.
  let tiktokAccessToken = (d.tiktokAccessToken ?? "").trim();
  if (!tiktokAccessToken || tiktokAccessToken === SECRET_MASK) {
    tiktokAccessToken = existing?.tiktok_access_token ?? "";
  }

  const payload: Record<string, unknown> = {
    ...(existing?.id ? { id: existing.id } : {}),
    org_id:           req.user!.orgId,
    tracking_key:     trackingKey,
    label:            d.label,
    mode:             d.mode,
    pixel_id:         d.pixelId || null,
    active:           d.active,
    tiktok_pixel_id:  d.tiktokPixelId || null,
    redirect_url:     d.redirectUrl || null,
    landing_page_url: d.landingPageUrl || null,
    product_id:       d.productId ?? null,
    utm_source:       d.utmSource || null,
    utm_medium:       d.utmMedium || null,
    utm_campaign:     d.utmCampaign || null,
    test_event_code:  d.testEventCode || null,
    created_by:       req.user!.id,
    updated_at:       new Date().toISOString()
  };
  if (accessToken) payload.access_token = accessToken;
  if (tiktokAccessToken) payload.tiktok_access_token = tiktokAccessToken;

  const { data, error } = await supabase
    .from("meta_capi_configs")
    .upsert(payload, { onConflict: "org_id,tracking_key" })
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(presentConfig(data));
});

// ── PATCH /api/meta-capi-settings/:id/toggle ────────────
router.patch("/:id/toggle", async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const active = Boolean(req.body?.active);
  const { error } = await supabase
    .from("meta_capi_configs")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("org_id", req.user!.orgId)
    .eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true, active });
});

// ── POST /api/meta-capi-settings/test ───────────────────
// Verify a config actually works by posting a test event to Meta. Accepts either a
// saved config id (uses its stored token) or an inline pixelId + token.
const TestSchema = z.object({
  id: z.string().uuid().optional(),
  trackingKey: z.string().optional(),
  pixelId: z.string().trim().optional(),
  accessToken: z.string().trim().optional(),
  testEventCode: z.string().trim().optional()
});
router.post("/test", async (req, res) => {
  const parsed = TestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const d = parsed.data;

  let pixelId = d.pixelId ?? "";
  let accessToken = d.accessToken ?? "";
  const testEventCode = d.testEventCode || undefined;

  // If a saved config is referenced (or no inline token given), load its stored values.
  if ((d.id || d.trackingKey) && (!accessToken || accessToken === SECRET_MASK)) {
    let q = supabase.from("meta_capi_configs").select("pixel_id, access_token").eq("org_id", req.user!.orgId);
    q = d.id ? q.eq("id", d.id) : q.eq("tracking_key", String(d.trackingKey));
    const { data } = await q.maybeSingle();
    if (data) {
      pixelId = pixelId || data.pixel_id || "";
      accessToken = data.access_token || "";
    }
  }

  const result = await testMetaCapiConnection(pixelId, accessToken, testEventCode);
  res.json(result);
});

// ── POST /api/meta-capi-settings/test-tiktok ────────────
router.post("/test-tiktok", async (req, res) => {
  const parsed = TestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const d = parsed.data;

  let pixelId = d.pixelId ?? "";
  let accessToken = d.accessToken ?? "";
  const testEventCode = d.testEventCode || undefined;

  if ((d.id || d.trackingKey) && (!accessToken || accessToken === SECRET_MASK)) {
    let q = supabase.from("meta_capi_configs").select("tiktok_pixel_id, tiktok_access_token").eq("org_id", req.user!.orgId);
    q = d.id ? q.eq("id", d.id) : q.eq("tracking_key", String(d.trackingKey));
    const { data } = await q.maybeSingle();
    if (data) {
      pixelId = pixelId || data.tiktok_pixel_id || "";
      accessToken = data.tiktok_access_token || "";
    }
  }

  const result = await testTikTokConnection(pixelId, accessToken, testEventCode);
  res.json(result);
});

// ── DELETE /api/meta-capi-settings/:id ──────────────────
router.delete("/:id", async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) { res.status(400).json({ error: "Missing config id." }); return; }
  const { error } = await supabase
    .from("meta_capi_configs")
    .delete()
    .eq("org_id", req.user!.orgId)
    .eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

export default router;
