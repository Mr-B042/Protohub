import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  addSmsOptOut,
  DEFAULT_SMS_TEMPLATES,
  DEFAULT_SMS_TRIGGERS,
  getSmsBalance,
  listSmsInboundMessages,
  listSmsOptOuts,
  removeSmsOptOut,
  resendSmsMessage,
  rotateSmsInboundWebhookSecret,
  sendTestSms
} from "../lib/sms.js";

const router = Router();
router.use(requireAuth);
const requireOwner = requireRole("Owner");
const requireSmsHealthViewer = requireRole("Owner", "Admin");

const SECRET_MASK = "••••••••";

const toSnakeKey = (key: string) =>
  key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

function normalizeBooleanMap(value: unknown, defaults: Record<string, boolean>) {
  const out = { ...defaults };
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = toSnakeKey(key);
    if (normalizedKey in defaults) out[normalizedKey] = !!entry;
  }
  return out;
}

function normalizeTemplateMap(value: unknown, defaults: Record<string, { body: string }>) {
  const out = { ...defaults };
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = toSnakeKey(key);
    if (!(normalizedKey in defaults) || !entry || typeof entry !== "object") continue;
    const template = entry as Record<string, unknown>;
    out[normalizedKey] = {
      body: typeof template.body === "string" ? template.body : defaults[normalizedKey].body
    };
  }
  return out;
}

function presentSettings(row: Record<string, any>) {
  return {
    ...row,
    api_key: row?.api_key ? SECRET_MASK : "",
    triggers: normalizeBooleanMap(row?.triggers, { ...DEFAULT_SMS_TRIGGERS }),
    templates: normalizeTemplateMap(row?.templates, { ...DEFAULT_SMS_TEMPLATES }),
    quiet_hours_enabled: !!row?.quiet_hours_enabled,
    quiet_hours_start: row?.quiet_hours_start ?? "21:00",
    quiet_hours_end: row?.quiet_hours_end ?? "08:00",
    low_balance_threshold: Number(row?.low_balance_threshold ?? 200),
    auto_retry_enabled: row?.auto_retry_enabled !== false,
    max_retry_attempts: Number(row?.max_retry_attempts ?? 2),
    retry_backoff_minutes: Number(row?.retry_backoff_minutes ?? 30),
    inbound_webhook_secret: row?.inbound_webhook_secret ?? ""
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
    quiet_hours_enabled: false,
    quiet_hours_start: "21:00",
    quiet_hours_end: "08:00",
    low_balance_threshold: 200,
    auto_retry_enabled: true,
    max_retry_attempts: 2,
    retry_backoff_minutes: 30,
    inbound_webhook_secret: "",
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
  templates: z.record(TemplateSchema),
  quiet_hours_enabled: z.boolean().default(false),
  quiet_hours_start: z.string().trim().min(4).max(5).default("21:00"),
  quiet_hours_end: z.string().trim().min(4).max(5).default("08:00"),
  low_balance_threshold: z.number().int().min(0).max(100000).default(200),
  auto_retry_enabled: z.boolean().default(true),
  max_retry_attempts: z.number().int().min(0).max(10).default(2),
  retry_backoff_minutes: z.number().int().min(5).max(1440).default(30),
  inbound_webhook_secret: z.string().trim().optional()
});

const OptOutSchema = z.object({
  phone: z.string().trim().min(5).max(40),
  note: z.string().trim().max(240).optional()
});

function inboundWebhookUrl(req: any, orgId: string, secret: string) {
  const protocol = req.headers["x-forwarded-proto"]?.toString().split(",")[0] || req.protocol;
  return secret ? `${protocol}://${req.get("host")}/api/public/sms/inbound/${orgId}/${secret}` : "";
}

router.get("/", requireOwner, async (req, res) => {
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
    res.json({
      ...defaultSettings(req.user!.orgId),
      inbound_webhook_url: ""
    });
    return;
  }

  const presented = presentSettings(data);
  res.json({
    ...presented,
    inbound_webhook_url: inboundWebhookUrl(req, req.user!.orgId, presented.inbound_webhook_secret)
  });
});

router.put("/", requireOwner, async (req, res) => {
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
    triggers: normalizeBooleanMap(d.triggers, { ...DEFAULT_SMS_TRIGGERS }),
    templates: normalizeTemplateMap(d.templates, { ...DEFAULT_SMS_TEMPLATES }),
    quiet_hours_enabled: d.quiet_hours_enabled,
    quiet_hours_start: d.quiet_hours_start,
    quiet_hours_end: d.quiet_hours_end,
    low_balance_threshold: d.low_balance_threshold,
    auto_retry_enabled: d.auto_retry_enabled,
    max_retry_attempts: d.max_retry_attempts,
    retry_backoff_minutes: d.retry_backoff_minutes,
    inbound_webhook_secret: d.inbound_webhook_secret?.trim() || undefined,
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

  const presented = presentSettings(data);
  res.json({
    ...presented,
    inbound_webhook_url: inboundWebhookUrl(req, req.user!.orgId, presented.inbound_webhook_secret)
  });
});

router.post("/test", requireOwner, async (req, res) => {
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

router.get("/balance", requireSmsHealthViewer, async (req, res) => {
  try {
    const result = await getSmsBalance(req.user!.orgId);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Could not fetch SMS balance."
    });
  }
});

router.get("/messages", requireOwner, async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.limit ?? 10) || 10));
  const offset = (page - 1) * pageSize;
  const { data, error, count } = await supabase
    .from("sms_messages")
    .select("*", { count: "exact" })
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({
    data: data ?? [],
    total: count ?? 0,
    page,
    pageSize
  });
});

router.post("/messages/:id/resend", requireOwner, async (req, res) => {
  try {
    const result = await resendSmsMessage(req.user!.orgId, String(req.params.id));
    res.json({
      message: result.deferred
        ? "SMS queued until quiet hours end."
        : "SMS resent successfully.",
      deferred: result.deferred,
      logId: result.logId
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Could not resend SMS."
    });
  }
});

router.get("/opt-outs", requireOwner, async (req, res) => {
  try {
    res.json(await listSmsOptOuts(req.user!.orgId));
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not load SMS opt-outs."
    });
  }
});

router.post("/opt-outs", requireOwner, async (req, res) => {
  const parsed = OptOutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const record = await addSmsOptOut(req.user!.orgId, parsed.data.phone, "manual", null, parsed.data.note);
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Could not add SMS opt-out."
    });
  }
});

router.delete("/opt-outs/:phone", requireOwner, async (req, res) => {
  try {
    const normalizedPhone = await removeSmsOptOut(req.user!.orgId, String(req.params.phone));
    res.json({ normalizedPhone });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Could not remove SMS opt-out."
    });
  }
});

router.get("/inbound", requireOwner, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
  try {
    res.json(await listSmsInboundMessages(req.user!.orgId, limit));
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not load inbound SMS messages."
    });
  }
});

router.post("/webhook-secret/rotate", requireOwner, async (req, res) => {
  try {
    const secret = await rotateSmsInboundWebhookSecret(req.user!.orgId);
    res.json({
      inboundWebhookSecret: secret,
      inboundWebhookUrl: inboundWebhookUrl(req, req.user!.orgId, secret)
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not rotate inbound webhook secret."
    });
  }
});

export default router;
