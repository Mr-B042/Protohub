import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendTestEmail } from "../lib/mailer.js";

const router = Router();
router.use(requireAuth);
router.use(requireRole("Owner", "Admin"));

const SECRET_MASK = "••••••••";

function presentSettings(row: Record<string, any>) {
  return {
    ...row,
    api_key_private: row?.api_key_private ? SECRET_MASK : "",
    resend_api_key: row?.resend_api_key ? SECRET_MASK : ""
  };
}

function defaultSettings(orgId: string) {
  return {
    org_id: orgId,
    enabled: false,
    provider: "resend",
    api_key_public: "",
    api_key_private: "",
    resend_api_key: "",
    from_name: "",
    from_email: "",
    reply_to: "",
    triggers: {
      // Customer emails
      order_new: false, order_status_change: true, order_delivered: false, payroll_approved: false,
      // Staff / internal emails
      internal_order_new: true, internal_order_assigned: true, internal_order_delivered: true,
      internal_order_rescheduled: true, internal_order_cancelled: true, internal_order_failed: true,
      internal_low_stock: true, internal_weekly_report: true,
      internal_waybill_dispatched: false, internal_new_team_member: false
    },
    templates: {
      order_new:           { subject: "New order {{order_id}} received", body: "Hello,\n\nA new order {{order_id}} has been placed by {{customer}}.\n\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nPhone: {{phone}}\n\nThank you." },
      order_status_change: { subject: "Your order {{order_id}} has been updated", body: "Hello {{customer}},\n\nYour order {{order_id}} status has changed from {{from_status}} to {{status}}.\n\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\n\nThank you for your business." },
      order_delivered:     { subject: "Your order {{order_id}} has been delivered!", body: "Hello {{customer}},\n\nGreat news! Your order {{order_id}} has been delivered successfully.\n\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\n\nThank you for shopping with us!" },
      payroll_approved:    { subject: "Your payroll for {{period}} has been approved", body: "Hello {{name}},\n\nYour payroll for the period {{period}} has been approved.\n\nNet Amount: {{currency}} {{amount}}\n\nThank you." },
      internal_order_new:           { subject: "New order {{order_id}} — {{customer}}", body: "A new order has come in.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nSource: {{source}}\nAssigned to: {{rep_name}}\n\nLog in to review it." },
      internal_order_assigned:      { subject: "You've been assigned order {{order_id}}", body: "Hi {{recipient_name}},\n\nAn order just came in and you've been assigned to it.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nSource: {{source}}\n\nLog in to follow up." },
      internal_order_delivered:     { subject: "Delivered ✓ — Order {{order_id}} ({{currency}} {{amount}})", body: "Order {{order_id}} has been marked as delivered.\n\nCustomer: {{customer}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nDelivered by: {{rep_name}}\n\nGreat work!" },
      internal_order_rescheduled:   { subject: "Order {{order_id}} rescheduled — {{customer}}", body: "Order {{order_id}} has been postponed/rescheduled.\n\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nScheduled Date: {{scheduled_date}}\nCall Outcome: {{call_outcome}}\nNotes: {{response}}\n\nPlease follow up at the scheduled time." },
      internal_order_cancelled:     { subject: "Order {{order_id}} cancelled — {{customer}}", body: "Order {{order_id}} has been cancelled.\n\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nReason: {{response}}\n\nLog in for details." },
      internal_order_failed:        { subject: "Order {{order_id}} failed — {{customer}}", body: "Order {{order_id}} has been marked as failed.\n\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nReason: {{response}}\n\nPlease review and take action." },
      internal_low_stock:           { subject: "Low stock alert — {{product_name}}", body: "Stock alert: {{product_name}} is running low.\n\nCurrent Stock: {{current_stock}}\nReorder Point: {{reorder_point}}\n\nPlease restock as soon as possible." },
      internal_weekly_report:       { subject: "Weekly Report — w/e {{week_end}}", body: "Weekly Performance Report\n{{org_name}}\nPeriod: {{week_start}} to {{week_end}}\n\n── ORDERS ──────────────────────────\nTotal Orders:    {{total_orders}}\nDelivered:       {{delivered}}\nCancelled:       {{cancelled}}\nFailed:          {{failed}}\nDelivery Rate:   {{delivery_rate}}%\n\n── REVENUE & FINANCIALS ────────────\nRevenue:         {{currency}} {{revenue}}\nAds Spent:       {{currency}} {{ads_spent}}\nOther Expenses:  {{currency}} {{other_expenses}}\nTotal Expenses:  {{currency}} {{total_expenses}}\nNet Profit:      {{currency}} {{net_profit}}\n\n── TOP PRODUCTS ────────────────────\n{{top_products}}\n\nHave a great week!" },
      internal_waybill_dispatched:  { subject: "Waybill dispatched — {{waybill_id}}", body: "Waybill {{waybill_id}} has been dispatched.\n\nDestination: {{destination}}\nItems: {{items}}\nDispatched by: {{rep_name}}\n\nLog in to track it." },
      internal_new_team_member:     { subject: "Welcome to {{org_name}}, {{recipient_name}}!", body: "Hi {{recipient_name}},\n\nYou've been added to {{org_name}} on ProtoHub as {{role}}.\n\nLog in to get started.\n\nWelcome aboard!" }
    },
    updated_at: null
  };
}

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
    res.json(defaultSettings(req.user!.orgId));
    return;
  }

  res.json(presentSettings(data));
});

// ── PUT /api/email-settings ───────────────────────────────
const TemplateSchema = z.object({
  subject: z.string(),
  body: z.string()
});

const SettingsSchema = z.object({
  enabled:         z.boolean(),
  provider:        z.enum(["mailjet", "resend"]).default("resend"),
  api_key_public:  z.string(),
  api_key_private: z.string(),
  resend_api_key:  z.string(),
  from_name:       z.string(),
  from_email:      z.string().email().or(z.literal("")),
  reply_to:        z.string().email().or(z.literal("")).optional(),
  // Accept any trigger keys (passthrough so new triggers don't break validation)
  triggers:  z.record(z.boolean()),
  templates: z.record(TemplateSchema)
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

  res.json(presentSettings(data));
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

  const via = result.fallbackFrom
    ? `${result.provider} (fallback from ${result.fallbackFrom})`
    : result.provider;
  res.json({ message: `Test email sent to ${to}${via ? ` via ${via}` : ""}.`, provider: result.provider, fallbackFrom: result.fallbackFrom ?? null });
});

export default router;
