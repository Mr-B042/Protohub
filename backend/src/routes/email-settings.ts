import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendTestEmail } from "../lib/mailer.js";

const router = Router();
router.use(requireAuth);
router.use(requireRole("Owner", "Admin"));

// ── GET /api/email-settings ───────────────────────────────
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("email_settings")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .single();

  if (error && error.code !== "PGRST116") {
    res.status(500).json({ error: error.message });
    return;
  }

  if (!data) {
    // Return default structure when no settings exist yet
    res.json({
      org_id: req.user!.orgId,
      enabled: false,
      provider: "mailjet",
      api_key_public: "",
      api_key_private: "",
      resend_api_key: "",
      from_name: "",
      from_email: "",
      reply_to: "",
      triggers: {
        order_new: false,
        order_status_change: true,
        order_delivered: false,
        payroll_approved: false
      },
      templates: {
        order_new: {
          subject: "New order {{order_id}} received",
          body: "Hello,\n\nA new order {{order_id}} has been placed by {{customer}}.\n\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nPhone: {{phone}}\n\nThank you."
        },
        order_status_change: {
          subject: "Your order {{order_id}} has been updated",
          body: "Hello {{customer}},\n\nYour order {{order_id}} status has changed from {{from_status}} to {{status}}.\n\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\n\nThank you for your business."
        },
        order_delivered: {
          subject: "Your order {{order_id}} has been delivered!",
          body: "Hello {{customer}},\n\nGreat news! Your order {{order_id}} has been delivered successfully.\n\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\n\nThank you for shopping with us!"
        },
        payroll_approved: {
          subject: "Your payroll for {{period}} has been approved",
          body: "Hello {{name}},\n\nYour payroll for the period {{period}} has been approved.\n\nNet Amount: {{currency}} {{amount}}\n\nThank you."
        }
      },
      updated_at: null
    });
    return;
  }

  res.json(data);
});

// ── PUT /api/email-settings ───────────────────────────────
const TemplateSchema = z.object({
  subject: z.string(),
  body: z.string()
});

const SettingsSchema = z.object({
  enabled:         z.boolean(),
  provider:        z.enum(["mailjet", "resend"]).default("mailjet"),
  api_key_public:  z.string(),
  api_key_private: z.string(),
  resend_api_key:  z.string(),
  from_name:       z.string(),
  from_email:      z.string().email().or(z.literal("")),
  reply_to:        z.string().email().or(z.literal("")).optional(),
  triggers: z.object({
    order_new:           z.boolean(),
    order_status_change: z.boolean(),
    order_delivered:     z.boolean(),
    payroll_approved:    z.boolean()
  }),
  templates: z.object({
    order_new:           TemplateSchema,
    order_status_change: TemplateSchema,
    order_delivered:     TemplateSchema,
    payroll_approved:    TemplateSchema
  })
});

router.put("/", async (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const d = parsed.data;

  // Restore masked secret keys from DB rather than overwriting with placeholder
  const needsExisting =
    d.api_key_private === "••••••••" ||
    d.resend_api_key  === "••••••••";

  let privateKey   = d.api_key_private;
  let resendApiKey = d.resend_api_key;

  if (needsExisting) {
    const { data: existing } = await supabase
      .from("email_settings")
      .select("api_key_private, resend_api_key")
      .eq("org_id", req.user!.orgId)
      .single();
    if (d.api_key_private === "••••••••") privateKey   = existing?.api_key_private ?? "";
    if (d.resend_api_key  === "••••••••") resendApiKey = existing?.resend_api_key  ?? "";
  }

  const payload = {
    org_id:          req.user!.orgId,
    enabled:         d.enabled,
    provider:        d.provider,
    api_key_public:  d.api_key_public,
    api_key_private: privateKey,
    resend_api_key:  resendApiKey,
    from_name:       d.from_name,
    from_email:      d.from_email,
    reply_to:        d.reply_to ?? "",
    triggers:        d.triggers,
    templates:       d.templates,
    updated_at:      new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("email_settings")
    .upsert(payload, { onConflict: "org_id" })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(data);
});

// ── POST /api/email-settings/test ────────────────────────
router.post("/test", async (req, res) => {
  const { to } = req.body;
  if (!to || typeof to !== "string") {
    res.status(400).json({ error: "Provide a recipient email in { to }." });
    return;
  }

  const result = await sendTestEmail(req.user!.orgId, to);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ message: `Test email sent to ${to}.` });
});

export default router;
