import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  DEFAULT_SMS_TEMPLATES,
  DEFAULT_SMS_TRIGGERS,
  getSmsBalance,
  sendTestSms
} from "../lib/sms.js";

const router = Router();
router.use(requireAuth);
router.use(requireRole("Owner", "Admin"));

const SECRET_MASK = "••••••••";

function presentSettings(row: Record<string, any>) {
  return {
    ...row,
    api_key: row?.api_key ? SECRET_MASK : "",
    triggers: {
      ...DEFAULT_SMS_TRIGGERS,
      ...(row?.triggers ?? {})
    },
    templates: {
      ...DEFAULT_SMS_TEMPLATES,
      ...(row?.templates ?? {})
    }
  };
}

function defaultSettings(orgId: string) {
  return {
    org_id: orgId,
    enabled: false,
    provider: "multitexter",
    api_key: "",
    sender_name: "Protohub",
    triggers: { ...DEFAULT_SMS_TRIGGERS },
    templates: { ...DEFAULT_SMS_TEMPLATES },
    updated_at: null
  };
}

const TemplateSchema = z.object({
  body: z.string()
});

const SettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["multitexter"]).default("multitexter"),
  api_key: z.string(),
  sender_name: z.string().trim().min(1).max(11),
  triggers: z.record(z.boolean()),
  templates: z.record(TemplateSchema)
});

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("sms_settings")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .single();

  if (error && error.code !== "PGRST116") {
    res.status(500).json({ error: error.message });
    return;
  }

  if (!data) {
    res.json(defaultSettings(req.user!.orgId));
    return;
  }

  res.json(presentSettings(data));
});

router.put("/", async (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const d = parsed.data;
  let apiKey = d.api_key;

  if (apiKey === SECRET_MASK) {
    const { data: existing } = await supabase
      .from("sms_settings")
      .select("api_key")
      .eq("org_id", req.user!.orgId)
      .single();
    apiKey = existing?.api_key ?? "";
  }

  const payload = {
    org_id: req.user!.orgId,
    enabled: d.enabled,
    provider: d.provider,
    api_key: apiKey,
    sender_name: d.sender_name,
    triggers: {
      ...DEFAULT_SMS_TRIGGERS,
      ...d.triggers
    },
    templates: {
      ...DEFAULT_SMS_TEMPLATES,
      ...d.templates
    },
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("sms_settings")
    .upsert(payload, { onConflict: "org_id" })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(presentSettings(data));
});

router.post("/test", async (req, res) => {
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  if (!phone) {
    res.status(400).json({ error: "Provide a recipient phone in { phone }." });
    return;
  }

  const result = await sendTestSms(req.user!.orgId, phone);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({
    message: `Test SMS sent to ${phone} via ${result.provider}.`,
    provider: result.provider,
    providerMessageId: result.providerMessageId,
    units: result.units,
    segments: result.segments
  });
});

router.get("/balance", async (req, res) => {
  try {
    const result = await getSmsBalance(req.user!.orgId);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Could not fetch SMS balance."
    });
  }
});

router.get("/messages", async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100) || 100));
  const { data, error } = await supabase
    .from("sms_messages")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(data ?? []);
});

export default router;
