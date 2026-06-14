import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
router.use(requireRole("Owner"));

const SECRET_MASK = "••••••••";

const ConfigSchema = z.object({
  trackingKey: z.string().trim().min(2).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  label: z.string().trim().min(1).max(120),
  mode: z.enum(["protohub", "hybrid", "landing_page", "off"]).default("protohub"),
  pixelId: z.string().trim().min(5).max(80),
  accessToken: z.string().trim().max(5000).optional().default(""),
  active: z.boolean().default(true)
});

function cleanTrackingKey(value: string) {
  return value.trim().toLowerCase();
}

function presentConfig(row: Record<string, any>) {
  return {
    id: row.id,
    trackingKey: row.tracking_key,
    label: row.label,
    mode: row.mode,
    pixelId: row.pixel_id,
    accessToken: row.access_token ? SECRET_MASK : "",
    hasAccessToken: Boolean(row.access_token),
    active: row.active !== false,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null
  };
}

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("meta_capi_configs")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("label", { ascending: true });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json((data ?? []).map(presentConfig));
});

router.post("/", async (req, res) => {
  const parsed = ConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const d = parsed.data;
  const trackingKey = cleanTrackingKey(d.trackingKey);
  const { data: existing, error: existingError } = await supabase
    .from("meta_capi_configs")
    .select("id, access_token")
    .eq("org_id", req.user!.orgId)
    .eq("tracking_key", trackingKey)
    .maybeSingle();

  if (existingError) {
    res.status(500).json({ error: existingError.message });
    return;
  }

  let accessToken = d.accessToken.trim();
  if (!accessToken || accessToken === SECRET_MASK) {
    accessToken = existing?.access_token ?? "";
  }
  if (!accessToken) {
    res.status(400).json({ error: "Paste the Meta CAPI access token for this Pixel before saving." });
    return;
  }

  const payload = {
    ...(existing?.id ? { id: existing.id } : {}),
    org_id: req.user!.orgId,
    tracking_key: trackingKey,
    label: d.label,
    mode: d.mode,
    pixel_id: d.pixelId,
    access_token: accessToken,
    active: d.active,
    created_by: req.user!.id,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("meta_capi_configs")
    .upsert(payload, { onConflict: "org_id,tracking_key" })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(presentConfig(data));
});

router.delete("/:id", async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "Missing config id." });
    return;
  }

  const { error } = await supabase
    .from("meta_capi_configs")
    .delete()
    .eq("org_id", req.user!.orgId)
    .eq("id", id);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ ok: true });
});

export default router;
