import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendTestEmail } from "../lib/mailer.js";

const router = Router();
router.use(requireAuth);
router.use(requireRole("Owner"));

const SECRET_MASK = "••••••••";

const DEFAULT_EMAIL_TRIGGERS = {
  order_new: false,
  order_status_change: true,
  order_delivered: false,
  payroll_approved: false,
  internal_order_new: true,
  internal_order_assigned: true,
  internal_order_delivered: true,
  internal_order_rescheduled: true,
  internal_order_cancelled: true,
  internal_order_failed: true,
  internal_low_stock: true,
  internal_weekly_report: true,
  internal_waybill_dispatched: false,
  internal_new_team_member: false
} as const;

export const DEFAULT_EMAIL_TEMPLATES = {
  order_new:           { subject: "Protohub order confirmation — {{order_id}}", body: "Hello {{customer}},\n\nWe have received your order and our team is already reviewing it.\n\nOrder ID: {{order_id}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nPhone: {{phone}}\n\nWe will keep you updated as your order moves forward." },
  order_status_change: { subject: "Protohub update — order {{order_id}} is now {{status}}", body: "Hello {{customer}},\n\nYour order status has been updated.\n\nOrder ID: {{order_id}}\nPrevious Status: {{from_status}}\nCurrent Status: {{status}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\n\nThank you for choosing Protohub." },
  order_delivered:     { subject: "Protohub delivery confirmed — {{order_id}}", body: "Hello {{customer}},\n\nGreat news. Your order has been delivered successfully.\n\nOrder ID: {{order_id}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\n\nThank you for shopping with us." },
  payroll_approved:    { subject: "Protohub payroll approved — {{period}}", body: "Hello {{name}},\n\nYour payroll has been approved for the selected period.\n\nPeriod: {{period}}\nNet Amount: {{currency}} {{amount}}\n\nThe finance record is now ready for your review." },
  internal_order_new:           { subject: "Protohub alert — new order {{order_id}}", body: "A new order has entered the workspace.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nSource: {{source}}\nAssigned to: {{rep_name}}\n\nLog in to review and take action." },
  internal_order_assigned:      { subject: "Protohub assigned order {{order_id}} to you", body: "Hi {{recipient_name}},\n\nA new order has been assigned to you.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nSource: {{source}}\n\nOpen Protohub to begin follow-up." },
  internal_order_delivered:     { subject: "Protohub delivered order — {{order_id}}", body: "An order has been marked as delivered.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nDelivered by: {{rep_name}}\n\nGreat work closing this one out." },
  internal_order_rescheduled:   { subject: "Protohub rescheduled order {{order_id}}", body: "An order has been postponed and needs follow-up.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nScheduled Date: {{scheduled_date}}\nCall Outcome: {{call_outcome}}\nNotes: {{response}}\n\nPlease return to the workspace at the scheduled time." },
  internal_order_cancelled:     { subject: "Protohub cancelled order {{order_id}}", body: "An order has been cancelled.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nReason: {{response}}\n\nLog in for full context." },
  internal_order_failed:        { subject: "Protohub failed order {{order_id}}", body: "An order has been marked as failed.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nReason: {{response}}\n\nPlease review the case and decide the next step." },
  internal_low_stock:           { subject: "Protohub low stock alert — {{product_name}}", body: "A product has reached its low stock threshold.\n\nProduct: {{product_name}}\nCurrent Stock: {{current_stock}}\nReorder Point: {{reorder_point}}\n\nPlease restock as soon as possible." },
  internal_weekly_report:       { subject: "Protohub weekly report — w/e {{week_end}}", body: "Weekly Performance Report\n{{org_name}}\nPeriod: {{week_start}} to {{week_end}}\n\n── ORDERS ──────────────────────────\nTotal Orders:    {{total_orders}}\nDelivered:       {{delivered}}\nCancelled:       {{cancelled}}\nFailed:          {{failed}}\nDelivery Rate:   {{delivery_rate}}%\n\n── REVENUE & FINANCIALS ────────────\nRevenue:         {{currency}} {{revenue}}\nAds Spent:       {{currency}} {{ads_spent}}\nOther Expenses:  {{currency}} {{other_expenses}}\nTotal Expenses:  {{currency}} {{total_expenses}}\nNet Profit:      {{currency}} {{net_profit}}\n\n── TOP PRODUCTS ────────────────────\n{{top_products}}\n\nHere is the latest snapshot from your Protohub workspace." },
  internal_waybill_dispatched:  { subject: "Protohub waybill dispatched — {{waybill_id}}", body: "A waybill has been dispatched.\n\nWaybill ID: {{waybill_id}}\nDestination: {{destination}}\nItems: {{items}}\nDispatched by: {{rep_name}}\n\nLog in to track progress." },
  internal_new_team_member:     { subject: "Welcome to Protohub, {{recipient_name}}", body: "Hi {{recipient_name}},\n\nYou have been added to {{org_name}} on Protohub as {{role}}.\n\nLog in to get started and explore your workspace." }
} as const;

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
    from_name: "Protohub",
    from_email: "",
    reply_to: "",
    triggers: { ...DEFAULT_EMAIL_TRIGGERS },
    templates: { ...DEFAULT_EMAIL_TEMPLATES },
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

router.get("/messages", async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.limit ?? 10) || 10));
  const offset = (page - 1) * pageSize;

  const { data, error, count } = await supabase
    .from("email_messages")
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

export default router;
