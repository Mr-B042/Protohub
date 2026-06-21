import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  addWhatsAppOptOut,
  DEFAULT_WHATSAPP_TEMPLATES,
  DEFAULT_WHATSAPP_TRIGGERS,
  LEGACY_WHATSAPP_TEMPLATE_BODIES,
  getWhatsAppSummary,
  listWhatsAppInboxMessages,
  listWhatsAppOptOuts,
  removeWhatsAppOptOut,
  sendCustomWhatsApp,
  sendTestWhatsApp
} from "../lib/whatsapp.js";
import { beginWhatsAppConnection, disconnectWhatsAppConnection, sendConnectedWhatsApp, type WhatsAppPairingMode } from "../lib/whatsapp-runtime.js";
import { generateOrderReceiptPdf } from "../lib/order-receipt-pdf.js";

const router = Router();
router.use(requireAuth);
const requireOwner = requireRole("Owner");
const requireWhatsAppHealthViewer = requireRole("Owner", "Admin");

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
    const incomingBody = typeof template.body === "string" ? template.body : defaults[normalizedKey].body;
    const maybeLegacyBody =
      normalizedKey in LEGACY_WHATSAPP_TEMPLATE_BODIES
      && incomingBody === LEGACY_WHATSAPP_TEMPLATE_BODIES[normalizedKey as keyof typeof LEGACY_WHATSAPP_TEMPLATE_BODIES]
        ? defaults[normalizedKey].body
        : incomingBody;
    out[normalizedKey] = {
      body: maybeLegacyBody
    };
  }
  return out;
}

function defaultSettings(orgId: string) {
  return {
    org_id: orgId,
    enabled: false,
    assistant_outcome_autofill_enabled: true,
    provider: "baileys",
    connection_status: "disconnected",
    connected_phone: "",
    connected_name: "",
    last_connected_at: null,
    last_error: "",
    pairing_mode: null,
    pairing_phone: "",
    pairing_code: "",
    qr_code_data_url: "",
    triggers: { ...DEFAULT_WHATSAPP_TRIGGERS },
    templates: { ...DEFAULT_WHATSAPP_TEMPLATES },
    updated_at: null
  };
}

const TemplateSchema = z.object({
  body: z.string().trim().min(1, "Template body is required.")
});

const UpsellItemSchema = z.object({
  id: z.string().optional(),
  enabled: z.boolean().optional(),
  name: z.string(),
  price: z.number(),
  strikePrice: z.number().nullable().optional(),
  currency: z.string().default("NGN"),
  imageUrl: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  packageId: z.string().nullable().optional(),
  delayMinutes: z.number().optional()
});

const SettingsSchema = z.object({
  enabled: z.boolean(),
  assistant_outcome_autofill_enabled: z.boolean().default(true),
  provider: z.enum(["baileys"]).default("baileys"),
  triggers: z.record(z.boolean()),
  templates: z.record(TemplateSchema),
  upsell_config: z.union([z.array(UpsellItemSchema), UpsellItemSchema]).nullable().optional()
});

const ConnectSchema = z.object({
  mode: z.enum(["qr", "pairing_code"]),
  phone: z.string().optional()
});

const CustomSendSchema = z.object({
  phone: z.string().trim().min(7).max(20),
  body: z.string().trim().min(1).max(4000),
  recipient_name: z.string().trim().max(120).optional(),
  order_id: z.string().trim().max(120).optional()
});

const OptOutSchema = z.object({
  phone: z.string().trim().min(5).max(40),
  note: z.string().trim().max(240).optional()
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadNormalizedSettings(orgId: string) {
  const { data, error } = await supabase
    .from("whatsapp_settings")
    .select("*")
    .eq("org_id", orgId)
    .single();

  if (error) {
    throw error;
  }

  return {
    ...data,
    assistant_outcome_autofill_enabled: data.assistant_outcome_autofill_enabled !== false,
    triggers: normalizeBooleanMap(data.triggers, { ...DEFAULT_WHATSAPP_TRIGGERS }),
    templates: normalizeTemplateMap(data.templates, { ...DEFAULT_WHATSAPP_TEMPLATES })
  };
}

router.get("/", requireWhatsAppHealthViewer, async (req, res) => {
  const { data, error } = await supabase
    .from("whatsapp_settings")
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
  res.json({
    ...data,
    assistant_outcome_autofill_enabled: data.assistant_outcome_autofill_enabled !== false,
    triggers: normalizeBooleanMap(data.triggers, { ...DEFAULT_WHATSAPP_TRIGGERS }),
    templates: normalizeTemplateMap(data.templates, { ...DEFAULT_WHATSAPP_TEMPLATES })
  });
});

router.put("/", requireOwner, async (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const d = parsed.data;
  const payload: Record<string, unknown> = {
    org_id: req.user!.orgId,
    enabled: d.enabled,
    assistant_outcome_autofill_enabled: d.assistant_outcome_autofill_enabled,
    provider: d.provider,
    triggers: normalizeBooleanMap(d.triggers, { ...DEFAULT_WHATSAPP_TRIGGERS }),
    templates: normalizeTemplateMap(d.templates, { ...DEFAULT_WHATSAPP_TEMPLATES }),
    updated_at: new Date().toISOString()
  };
  if (d.upsell_config !== undefined) payload.upsell_config = d.upsell_config;

  const { data, error } = await supabase
    .from("whatsapp_settings")
    .upsert(payload, { onConflict: "org_id" })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({
    ...data,
    assistant_outcome_autofill_enabled: data.assistant_outcome_autofill_enabled !== false,
    triggers: normalizeBooleanMap(data.triggers, { ...DEFAULT_WHATSAPP_TRIGGERS }),
    templates: normalizeTemplateMap(data.templates, { ...DEFAULT_WHATSAPP_TEMPLATES })
  });
});

router.post("/connect", requireOwner, async (req, res) => {
  const parsed = ConnectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const mode = parsed.data.mode as WhatsAppPairingMode;
    await beginWhatsAppConnection(req.user!.orgId, mode, parsed.data.phone ?? null);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Could not start WhatsApp connection."
    });
    return;
  }
  let settings = await loadNormalizedSettings(req.user!.orgId);
  const started = Date.now();
  while (
    Date.now() - started < 6000 &&
    settings.connection_status === "pairing" &&
    !settings.qr_code_data_url &&
    !settings.pairing_code
  ) {
    await sleep(500);
    settings = await loadNormalizedSettings(req.user!.orgId);
  }

  res.json(settings);
});

router.post("/disconnect", requireOwner, async (req, res) => {
  try {
    await disconnectWhatsAppConnection(req.user!.orgId);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Could not disconnect WhatsApp."
    });
    return;
  }

  const settings = defaultSettings(req.user!.orgId);
  res.json(settings);
});

router.post("/test", requireOwner, async (req, res) => {
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  if (!phone) {
    res.status(400).json({ error: "Provide a recipient phone in { phone }." });
    return;
  }

  // Stage 1: plain text (lands in inbox, not Message Requests)
  const result = await sendTestWhatsApp(req.user!.orgId, phone);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  // Stage 2: PDF receipt + (optional) product image — 3s after text
  // This tests that the full 2-stage media delivery works end-to-end.
  if (!result.deferred) {
    setTimeout(async () => {
      try {
        const pdf = await generateOrderReceiptPdf({
          id: "TEST-001",
          customer: "Test Customer",
          phone,
          productName: "Edge Brusher Max",
          packageName: "Trial Pack",
          amount: 16500,
          currency: "NGN",
          city: "Lagos",
          state: "Lagos",
          source: "Test"
        });
        await sendConnectedWhatsApp(req.user!.orgId, phone.replace(/\D/g, ""), "📋 Test PDF receipt attached — your customers will receive this after their order confirmation.", {
          pdfBuffer: pdf,
          pdfFileName: "Order-Receipt-TEST.pdf"
        });
      } catch (err) {
        // Stage 2 errors are non-fatal — log but don't affect the test response
        console.error("Test stage-2 PDF send failed:", (err as Error).message);
      }
    }, 3000);
  }

  res.json({
    message: result.deferred
      ? `Test deferred to next send window. PDF follow-up will also be deferred.`
      : `Stage 1 sent ✓ — PDF receipt follows in ~3 seconds to ${phone}.`,
    provider: result.provider,
    providerMessageId: result.providerMessageId,
    deferred: !!result.deferred,
    scheduledFor: result.scheduledFor ?? null,
    stage2: "PDF receipt queued — arrives 3s after text"
  });
});

router.post("/custom-send", requireOwner, async (req, res) => {
  const parsed = CustomSendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const result = await sendCustomWhatsApp(
    req.user!.orgId,
    parsed.data.phone,
    parsed.data.body,
    {
      recipientName: parsed.data.recipient_name,
      orderId: parsed.data.order_id ?? null
    }
  );

  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({
    message: result.deferred
      ? `Custom WhatsApp deferred for the next allowed send window to ${parsed.data.phone}.`
      : `Custom WhatsApp queued to ${parsed.data.phone}.`,
    provider: result.provider,
    providerMessageId: result.providerMessageId,
    deferred: !!result.deferred,
    scheduledFor: result.scheduledFor ?? null
  });
});

router.get("/summary", requireWhatsAppHealthViewer, async (req, res) => {
  try {
    res.json(await getWhatsAppSummary(req.user!.orgId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Could not load WhatsApp summary."
    });
  }
});

router.get("/messages", requireWhatsAppHealthViewer, async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.limit ?? 10) || 10));
  const offset = (page - 1) * pageSize;
  const { data, error, count } = await supabase
    .from("whatsapp_messages")
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

router.get("/inbox", requireWhatsAppHealthViewer, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
  try {
    res.json(await listWhatsAppInboxMessages(req.user!.orgId, limit));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Could not load WhatsApp inbox."
    });
  }
});

router.get("/opt-outs", requireOwner, async (req, res) => {
  try {
    res.json(await listWhatsAppOptOuts(req.user!.orgId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Could not load WhatsApp opt-outs."
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
    const record = await addWhatsAppOptOut(req.user!.orgId, parsed.data.phone, "manual", null, parsed.data.note);
    res.status(201).json(record);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Could not add WhatsApp opt-out."
    });
  }
});

router.delete("/opt-outs/:phone", requireOwner, async (req, res) => {
  try {
    const normalizedPhone = await removeWhatsAppOptOut(req.user!.orgId, String(req.params.phone));
    res.json({ normalizedPhone });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Could not remove WhatsApp opt-out."
    });
  }
});

export default router;
