import Mailjet from "node-mailjet";
import { Resend } from "resend";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { DEFAULT_WORKING_DAYS, isWithinWorkingSchedule, nextWorkingScheduleAt, normalizeWorkingDays } from "./business-schedule.js";

// ── Types ─────────────────────────────────────────────────
export type EmailTrigger =
  // Customer-facing
  | "order_new"
  | "order_status_change"
  | "order_delivered"
  | "payroll_approved"
  // Internal / staff
  | "internal_order_new"
  | "internal_order_assigned"
  | "internal_order_delivered"
  | "internal_order_rescheduled"
  | "internal_order_cancelled"
  | "internal_order_failed"
  | "internal_abandoned_cart_new"
  | "internal_low_stock"
  | "internal_weekly_report"
  | "internal_waybill_dispatched"
  | "internal_new_team_member"
  | "test_email";

export type EmailProvider = "mailjet" | "resend";

interface EmailSettings {
  enabled: boolean;
  provider: EmailProvider;
  api_key_public: string;
  api_key_private: string;
  resend_api_key: string;
  from_name: string;
  from_email: string;
  reply_to: string;
  triggers: Record<string, boolean>;
  templates: Record<string, { subject: string; body: string }>;
  timezone?: string;
  working_schedule_enabled?: boolean;
  working_days?: string[];
  working_day_start?: string;
  working_day_end?: string;
}

type EmailContent = {
  text: string;
  html: string;
};

type ProviderDispatchResult = {
  provider: EmailProvider;
  fallbackFrom?: EmailProvider;
};

type EmailLogAudience = "customer" | "staff";

type StaffRecipient = {
  email: string;
  name: string;
  role: string;
};

type EmailActionOptions = {
  actionLabel?: string;
  actionPathForRole?: (role: string) => string | null | undefined;
};

type DeliverEmailOptions = {
  recipientRole?: string | null;
  ignoreWorkingSchedule?: boolean;
};

class EmailDispatchError extends Error {
  provider: EmailProvider;
  statusCode?: number;
  code?: string;
  quotaLike: boolean;
  raw?: unknown;

  constructor(
    provider: EmailProvider,
    message: string,
    opts?: { statusCode?: number; code?: string; quotaLike?: boolean; raw?: unknown }
  ) {
    super(message);
    this.name = "EmailDispatchError";
    this.provider = provider;
    this.statusCode = opts?.statusCode;
    this.code = opts?.code;
    this.quotaLike = !!opts?.quotaLike;
    this.raw = opts?.raw;
  }
}

const DEFAULT_EMAIL_PROVIDER: EmailProvider =
  process.env.EMAIL_PROVIDER === "mailjet" ? "mailjet" : "resend";

const providerQuotaBackoff = new Map<string, number>();

const DEFAULT_EMAIL_TRIGGER_MAP: Record<EmailTrigger, boolean> = {
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
  internal_abandoned_cart_new: true,
  internal_low_stock: true,
  internal_weekly_report: true,
  internal_waybill_dispatched: false,
  internal_new_team_member: false,
  test_email: true
};

const LEGACY_DEFAULT_EMAIL_TEMPLATE_MAP: Partial<Record<string, { subject: string; body: string }>> = {
  internal_order_new:           { subject: "Protohub alert — new order {{order_id}}", body: "A new order has entered the workspace.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nSource: {{source}}\nAssigned to: {{rep_name}}\n\nLog in to review and take action." },
  internal_order_assigned:      { subject: "Protohub assigned order {{order_id}} to you", body: "Hi {{recipient_name}},\n\nA new order has been assigned to you.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nSource: {{source}}\n\nOpen Protohub to begin follow-up." },
  internal_order_delivered:     { subject: "Protohub delivered order — {{order_id}}", body: "An order has been marked as delivered.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nDelivered by: {{rep_name}}\n\nGreat work closing this one out." },
  internal_order_rescheduled:   { subject: "Protohub rescheduled order {{order_id}}", body: "An order has been postponed and needs follow-up.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nScheduled Date: {{scheduled_date}}\nCall Outcome: {{call_outcome}}\nNotes: {{response}}\n\nPlease return to the workspace at the scheduled time." },
  internal_order_cancelled:     { subject: "Protohub cancelled order {{order_id}}", body: "An order has been cancelled.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nReason: {{response}}\n\nLog in for full context." },
  internal_order_failed:        { subject: "Protohub failed order {{order_id}}", body: "An order has been marked as failed.\n\nOrder ID: {{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nReason: {{response}}\n\nPlease review the case and decide the next step." },
  internal_abandoned_cart_new:  { subject: "Protohub abandoned cart captured — {{cart_id}}", body: "A new abandoned cart has been captured.\n\nCart ID: {{cart_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nSource: {{source}}\n\nOpen Protohub to review and follow up quickly." }
};

const DEFAULT_EMAIL_TEMPLATE_MAP: Record<string, { subject: string; body: string }> = {
  order_new:           { subject: "Protohub order confirmation — {{order_id}}", body: "Hello {{customer}},\n\nWe have received your order and our team is already reviewing it.\n\nOrder ID: {{order_id}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nPhone: {{phone}}\n\nWe will keep you updated as your order moves forward." },
  order_status_change: { subject: "Protohub update — order {{order_id}} is now {{status}}", body: "Hello {{customer}},\n\nYour order status has been updated.\n\nOrder ID: {{order_id}}\nPrevious Status: {{from_status}}\nCurrent Status: {{status}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\n\nThank you for choosing Protohub." },
  order_delivered:     { subject: "Protohub delivery confirmed — {{order_id}}", body: "Hello {{customer}},\n\nGreat news. Your order has been delivered successfully.\n\nOrder ID: {{order_id}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\n\nThank you for shopping with us." },
  payroll_approved:    { subject: "Protohub payroll approved — {{period}}", body: "Hello {{name}},\n\nYour payroll has been approved for the selected period.\n\nPeriod: {{period}}\nNet Amount: {{currency}} {{amount}}\n\nThe finance record is now ready for your review." },
  internal_order_new:           { subject: "New Order #{{order_id}}", body: "{{customer}} ({{phone}}) just placed a new order worth {{currency}} {{amount}}.\n\nProduct: {{product_name}}\nSource: {{source}}\nAssigned to: {{rep_name}}\n\nOpen the order to review and take the next step." },
  internal_order_assigned:      { subject: "Order #{{order_id}} assigned to you", body: "Hi {{recipient_name}},\n\nOrder #{{order_id}} has been assigned to you.\n\nCustomer: {{customer}} ({{phone}})\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nSource: {{source}}\n\nOpen the order to start follow-up." },
  internal_order_delivered:     { subject: "Order #{{order_id}} delivered", body: "Order #{{order_id}} for {{customer}} has been marked as delivered.\n\nCustomer: {{customer}}\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nDelivered by: {{rep_name}}\n\nOpen the order to review the final record." },
  internal_order_rescheduled:   { subject: "Order #{{order_id}} rescheduled", body: "Order #{{order_id}} has been rescheduled and needs follow-up.\n\nCustomer: {{customer}} ({{phone}})\nProduct: {{product_name}}\nScheduled Date: {{scheduled_date}}\nCall Outcome: {{call_outcome}}\nNotes: {{response}}\n\nOpen the order to plan the next contact." },
  internal_order_cancelled:     { subject: "Order #{{order_id}} cancelled", body: "Order #{{order_id}} has been cancelled.\n\nCustomer: {{customer}} ({{phone}})\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nReason: {{response}}\n\nOpen the order to review the full context." },
  internal_order_failed:        { subject: "Order #{{order_id}} failed", body: "Order #{{order_id}} has been marked as failed.\n\nCustomer: {{customer}} ({{phone}})\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nReason: {{response}}\n\nOpen the order to decide the next step." },
  internal_abandoned_cart_new:  { subject: "New Abandoned Cart #{{cart_id}}", body: "{{customer}} ({{phone}}) left without completing checkout.\n\nProduct: {{product_name}}\nEstimated Amount: {{currency}} {{amount}}\nSource: {{source}}\n\nOpen the cart to review and follow up quickly." },
  internal_low_stock:           { subject: "Protohub low stock alert — {{product_name}}", body: "A product has reached its low stock threshold.\n\nProduct: {{product_name}}\nCurrent Stock: {{current_stock}}\nReorder Point: {{reorder_point}}\n\nPlease restock as soon as possible." },
  internal_weekly_report:       { subject: "Protohub weekly report — w/e {{week_end}}", body: "Weekly Performance Report\n{{org_name}}\nPeriod: {{week_start}} to {{week_end}}\n\n── ORDERS ──────────────────────────\nTotal Orders:    {{total_orders}}\nDelivered:       {{delivered}}\nCancelled:       {{cancelled}}\nFailed:          {{failed}}\nDelivery Rate:   {{delivery_rate}}%\n\n── REVENUE & FINANCIALS ────────────\nRevenue:         {{currency}} {{revenue}}\nAds Spent:       {{currency}} {{ads_spent}}\nOther Expenses:  {{currency}} {{other_expenses}}\nTotal Expenses:  {{currency}} {{total_expenses}}\nNet Profit:      {{currency}} {{net_profit}}\n\n── TOP PRODUCTS ────────────────────\n{{top_products}}\n\nHere is the latest snapshot from your Protohub workspace." },
  internal_waybill_dispatched:  { subject: "Protohub waybill dispatched — {{waybill_id}}", body: "A waybill has been dispatched.\n\nWaybill ID: {{waybill_id}}\nDestination: {{destination}}\nItems: {{items}}\nDispatched by: {{rep_name}}\n\nLog in to track progress." },
  internal_new_team_member:     { subject: "Welcome to Protohub, {{recipient_name}}", body: "Hi {{recipient_name}},\n\nYou have been added to {{org_name}} on Protohub as {{role}}.\n\nLog in to get started and explore your workspace." }
};

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

function normalizeTemplateMap(value: unknown, defaults: Record<string, { subject: string; body: string }>) {
  const out = { ...defaults };
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = toSnakeKey(key);
    if (!(normalizedKey in defaults) || !entry || typeof entry !== "object") continue;
    const template = entry as Record<string, unknown>;
    const legacyTemplate = LEGACY_DEFAULT_EMAIL_TEMPLATE_MAP[normalizedKey];
    const subject = typeof template.subject === "string" ? template.subject : defaults[normalizedKey].subject;
    const body = typeof template.body === "string" ? template.body : defaults[normalizedKey].body;
    out[normalizedKey] = {
      subject: legacyTemplate && subject === legacyTemplate.subject ? defaults[normalizedKey].subject : subject,
      body: legacyTemplate && body === legacyTemplate.body ? defaults[normalizedKey].body : body
    };
  }
  return out;
}

function brandName(settings: EmailSettings) {
  return settings.from_name?.trim() || "Protohub";
}

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL?.trim() || "http://localhost:5173").replace(/\/+$/, "");
}

function absoluteAppUrl(hashPath: string) {
  const normalized = hashPath.startsWith("#") ? hashPath : `#${hashPath}`;
  return `${frontendBaseUrl()}/${normalized}`;
}

function internalOrderHashForRole(role: string, orderId: string) {
  return role === "Sales Rep"
    ? `#/dashboard/sales-rep/orders/${orderId}`
    : `#/dashboard/admin/orders/${orderId}`;
}

function internalCartHashForRole(role: string, cartId: string) {
  return role === "Sales Rep"
    ? `#/dashboard/sales-rep/abandoned-carts/${cartId}`
    : `#/dashboard/admin/abandoned-carts/${cartId}`;
}

function applyEnvFallbacks(settings: EmailSettings): EmailSettings {
  return {
    ...settings,
    provider: settings.provider ?? DEFAULT_EMAIL_PROVIDER,
    api_key_public: settings.api_key_public || process.env.MAILJET_API_PUBLIC || "",
    api_key_private: settings.api_key_private || process.env.MAILJET_API_PRIVATE || "",
    resend_api_key: settings.resend_api_key || process.env.RESEND_API_KEY || "",
    from_name: settings.from_name || process.env.EMAIL_FROM_NAME || "",
    from_email: settings.from_email || process.env.EMAIL_FROM_EMAIL || "",
    reply_to: settings.reply_to || process.env.EMAIL_REPLY_TO || "",
    timezone: settings.timezone?.trim() || "Africa/Lagos",
    working_schedule_enabled: !!settings.working_schedule_enabled,
    working_days: normalizeWorkingDays(settings.working_days ?? DEFAULT_WORKING_DAYS),
    working_day_start: settings.working_day_start || "08:00",
    working_day_end: settings.working_day_end || "18:00",
    triggers: normalizeBooleanMap(settings.triggers, DEFAULT_EMAIL_TRIGGER_MAP),
    templates: normalizeTemplateMap(settings.templates, DEFAULT_EMAIL_TEMPLATE_MAP)
  };
}

function providerKey(orgId: string, provider: EmailProvider) {
  return `${orgId}:${provider}`;
}

function nextUtcMidnightTimestamp() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
}

function isProviderBackedOff(orgId: string, provider: EmailProvider) {
  const until = providerQuotaBackoff.get(providerKey(orgId, provider));
  if (!until) return false;
  if (until <= Date.now()) {
    providerQuotaBackoff.delete(providerKey(orgId, provider));
    return false;
  }
  return true;
}

function setProviderQuotaBackoff(orgId: string, provider: EmailProvider) {
  providerQuotaBackoff.set(providerKey(orgId, provider), nextUtcMidnightTimestamp());
}

function clearProviderQuotaBackoff(orgId: string, provider: EmailProvider) {
  providerQuotaBackoff.delete(providerKey(orgId, provider));
}

function hasKeysForProvider(settings: EmailSettings, provider: EmailProvider): boolean {
  if (provider === "mailjet") return !!(settings.api_key_public && settings.api_key_private);
  return !!settings.resend_api_key;
}

function configuredProviders(settings: EmailSettings): EmailProvider[] {
  const primary = settings.provider ?? DEFAULT_EMAIL_PROVIDER;
  const secondary = primary === "resend" ? "mailjet" : "resend";
  const ordered: EmailProvider[] = [primary, secondary];
  return ordered.filter((provider, index, list) =>
    list.indexOf(provider) === index && hasKeysForProvider(settings, provider)
  );
}

function sendOrder(settings: EmailSettings, orgId: string): EmailProvider[] {
  const configured = configuredProviders(settings);
  const ready = configured.filter((provider) => !isProviderBackedOff(orgId, provider));
  return ready.length ? ready : configured;
}

function looksQuotaLike(raw: unknown): boolean {
  const text = typeof raw === "string"
    ? raw
    : JSON.stringify(raw ?? "");
  const normalized = text.toLowerCase();
  return [
    "quota",
    "rate limit",
    "rate-limit",
    "too many requests",
    "daily limit",
    "hourly limit",
    "monthly limit",
    "credits",
    "limit exceeded",
    "throttl"
  ].some((fragment) => normalized.includes(fragment));
}

function normalizeDispatchError(provider: EmailProvider, err: any): EmailDispatchError {
  if (err instanceof EmailDispatchError) return err;
  if (provider === "mailjet") {
    const payload = err?.response?.body ?? err?.response?.data ?? err;
    const nested = payload?.Messages?.[0]?.Errors?.[0];
    const message = nested?.ErrorMessage ?? payload?.ErrorMessage ?? err?.message ?? "Mailjet send failed.";
    const statusCode = Number(err?.statusCode ?? err?.response?.status ?? err?.response?.statusCode) || undefined;
    const code = nested?.ErrorCode ?? payload?.ErrorCode ?? err?.code;
    return new EmailDispatchError(provider, message, {
      statusCode,
      code: code ? String(code) : undefined,
      quotaLike: looksQuotaLike([message, code, statusCode, payload]),
      raw: payload
    });
  }

  const message = err?.message ?? err?.error?.message ?? "Resend send failed.";
  const statusCode = Number(err?.statusCode ?? err?.status ?? err?.error?.statusCode) || undefined;
  const code = err?.code ?? err?.name ?? err?.error?.name;
  return new EmailDispatchError(provider, message, {
    statusCode,
    code: code ? String(code) : undefined,
    quotaLike: looksQuotaLike([message, code, statusCode, err]),
    raw: err
  });
}

// ── Template variable interpolation ───────────────────────
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensureBrandSignature(text: string, settings: EmailSettings): string {
  const trimmed = text.trim();
  if (!trimmed) return `Team ${brandName(settings)}`;
  const normalized = trimmed.toLowerCase();
  if (normalized.includes(`team ${brandName(settings).toLowerCase()}`)) return trimmed;
  return `${trimmed}\n\nWarm regards,\nTeam ${brandName(settings)}`;
}

function renderSectionHtml(section: string): string {
  const lines = section
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return "";

  const colonLines = lines.filter((line) => line.includes(":"));
  const shouldRenderAsFacts =
    colonLines.length >= 2 &&
    colonLines.length === lines.length &&
    !lines.some((line) => line.startsWith("http"));

  if (shouldRenderAsFacts) {
    const rows = lines.map((line) => {
      const separator = line.indexOf(":");
      const label = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;font-weight:600;vertical-align:top;width:38%;">${escapeHtml(label)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;vertical-align:top;">${escapeHtml(value)}</td>
        </tr>
      `;
    }).join("");

    return `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:14px;border-collapse:separate;border-spacing:0;overflow:hidden;margin:18px 0;">
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  if (section.includes("──")) {
    return `
      <pre style="margin:18px 0;padding:16px 18px;background:#0f172a;color:#e2e8f0;border-radius:14px;font-size:13px;line-height:1.6;white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace;">${escapeHtml(section)}</pre>
    `;
  }

  return lines
    .map((line) => `<p style="margin:0 0 14px;color:#111827;font-size:15px;line-height:1.7;">${escapeHtml(line)}</p>`)
    .join("");
}

function buildEmailContent(
  settings: EmailSettings,
  subject: string,
  body: string,
  vars?: Record<string, string>
): EmailContent {
  const brandedText = ensureBrandSignature(body, settings);
  const sections = brandedText.split(/\n\s*\n/).filter((section) => section.trim());
  const preview = sections.find((section) => section.trim())?.replace(/\s+/g, " ").slice(0, 140) ?? subject;
  const sectionsHtml = sections.map(renderSectionHtml).join("");
  const sender = escapeHtml(brandName(settings));
  const escapedSubject = escapeHtml(subject);
  const escapedPreview = escapeHtml(preview);
  const replyTo = settings.reply_to || settings.from_email;
  const actionUrl = vars?.action_url?.trim();
  const actionLabel = vars?.action_label?.trim() || "Open in Protohub";
  const replyToHtml = replyTo
    ? `<a href="mailto:${escapeHtml(replyTo)}" style="color:#15803d;text-decoration:none;">${escapeHtml(replyTo)}</a>`
    : sender;
  const actionHtml = actionUrl
    ? `
                <div style="margin:28px 0 8px;">
                  <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:14px 22px;border-radius:14px;background:#15803d;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(actionLabel)}</a>
                </div>
                <p style="margin:14px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">If the button does not open, copy this link into your browser:<br /><a href="${escapeHtml(actionUrl)}" style="color:#15803d;text-decoration:none;word-break:break-all;">${escapeHtml(actionUrl)}</a></p>
    `
    : "";
  const textWithAction = actionUrl
    ? `${brandedText}\n\n${actionLabel}: ${actionUrl}`
    : brandedText;

  return {
    text: textWithAction,
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapedSubject}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7f5;font-family:Inter,Segoe UI,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapedPreview}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7f5;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;">
            <tr>
              <td style="padding-bottom:16px;text-align:left;">
                <div style="display:inline-block;padding:10px 16px;border-radius:999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${sender}</div>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:22px;padding:34px 28px 28px;box-shadow:0 18px 48px rgba(15, 23, 42, 0.08);">
                <p style="margin:0 0 10px;color:#166534;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Protohub Email Update</p>
                <h1 style="margin:0 0 18px;color:#111827;font-size:28px;line-height:1.2;">${escapedSubject}</h1>
                ${sectionsHtml}
                ${actionHtml}
                <div style="margin-top:26px;padding-top:18px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;line-height:1.7;">
                  Sent by ${sender} via Protohub.<br />
                  Reply to ${replyToHtml}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
  };
}

// ── Load org email settings from DB ───────────────────────
async function loadSettings(orgId: string): Promise<EmailSettings | null> {
  const [{ data, error }, { data: org }] = await Promise.all([
    supabase
      .from("email_settings")
      .select("*")
      .eq("org_id", orgId)
      .single(),
    supabase
      .from("organizations")
      .select("timezone, working_schedule_enabled, working_days, working_day_start, working_day_end")
      .eq("id", orgId)
      .single()
  ]);

  if (error || !data) return null;
  return applyEnvFallbacks({
    ...(data as EmailSettings),
    timezone: typeof org?.timezone === "string" && org.timezone.trim() ? org.timezone.trim() : "Africa/Lagos",
    working_schedule_enabled: !!org?.working_schedule_enabled,
    working_days: normalizeWorkingDays(org?.working_days),
    working_day_start: typeof org?.working_day_start === "string" && org.working_day_start.trim() ? org.working_day_start.trim() : "08:00",
    working_day_end: typeof org?.working_day_end === "string" && org.working_day_end.trim() ? org.working_day_end.trim() : "18:00"
  });
}

// ── Check provider keys are configured ────────────────────
function hasValidKeys(settings: EmailSettings): boolean {
  return configuredProviders(settings).length > 0;
}

// ── Send via Mailjet ──────────────────────────────────────
async function sendViaMailjet(
  settings: EmailSettings,
  to: { email: string; name?: string },
  subject: string,
  body: string,
  vars?: Record<string, string>
): Promise<void> {
  const content = buildEmailContent(settings, subject, body, vars);
  const client = new Mailjet({
    apiKey:    settings.api_key_public,
    apiSecret: settings.api_key_private
  });

  const message: Record<string, unknown> = {
    From:     { Email: settings.from_email, Name: settings.from_name || settings.from_email },
    To:       [{ Email: to.email, Name: to.name || to.email }],
    Subject:  subject,
    TextPart: content.text,
    HTMLPart: content.html
  };

  if (settings.reply_to) message.ReplyTo = { Email: settings.reply_to };

  try {
    await (client.post("send", { version: "v3.1" }) as any).request({ Messages: [message] });
  } catch (err: any) {
    throw normalizeDispatchError("mailjet", err);
  }
}

// ── Send via Resend ───────────────────────────────────────
async function sendViaResend(
  settings: EmailSettings,
  to: { email: string; name?: string },
  subject: string,
  body: string,
  vars?: Record<string, string>
): Promise<void> {
  const content = buildEmailContent(settings, subject, body, vars);
  const client = new Resend(settings.resend_api_key);

  const from = settings.from_name
    ? `${settings.from_name} <${settings.from_email}>`
    : settings.from_email;

  const payload: Parameters<typeof client.emails.send>[0] = {
    from,
    to:      [to.email],
    subject,
    text:    content.text,
    html:    content.html,
    ...(settings.reply_to ? { reply_to: settings.reply_to } : {})
  };

  const { error } = await client.emails.send(payload);
  if (error) throw normalizeDispatchError("resend", error);
}

async function sendViaProvider(
  provider: EmailProvider,
  settings: EmailSettings,
  to: { email: string; name?: string },
  subject: string,
  body: string,
  vars?: Record<string, string>
): Promise<void> {
  if (provider === "resend") {
    await sendViaResend(settings, to, subject, body, vars);
    return;
  }
  await sendViaMailjet(settings, to, subject, body, vars);
}

// ── Dispatch to correct provider with fallback ────────────
async function dispatch(
  orgId: string,
  settings: EmailSettings,
  to: { email: string; name?: string },
  subject: string,
  body: string,
  vars?: Record<string, string>
): Promise<ProviderDispatchResult> {
  const providers = sendOrder(settings, orgId);
  if (!providers.length) {
    throw new EmailDispatchError(settings.provider ?? DEFAULT_EMAIL_PROVIDER, "No email providers are configured.");
  }

  let lastError: EmailDispatchError | null = null;
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    try {
      await sendViaProvider(provider, settings, to, subject, body, vars);
      clearProviderQuotaBackoff(orgId, provider);
      return {
        provider,
        ...(index > 0 ? { fallbackFrom: providers[0] } : {})
      };
    } catch (err: any) {
      const normalized = normalizeDispatchError(provider, err);
      if (normalized.quotaLike) setProviderQuotaBackoff(orgId, provider);
      logger.warn("email provider failed", {
        orgId,
        provider,
        to: to.email,
        statusCode: normalized.statusCode,
        code: normalized.code,
        quotaLike: normalized.quotaLike,
        error: normalized.message
      });
      lastError = normalized;
    }
  }

  throw lastError ?? new EmailDispatchError(settings.provider ?? DEFAULT_EMAIL_PROVIDER, "Email send failed.");
}

// ── Get staff emails by role ──────────────────────────────
async function getStaffRecipients(
  orgId: string,
  roles: string[]
): Promise<StaffRecipient[]> {
  const { data } = await supabase
    .from("users")
    .select("email, name, role")
    .eq("org_id", orgId)
    .eq("active", true)
    .in("role", roles);

  return (data ?? []).filter((u: any) => !!u.email);
}

function shouldRespectWorkingSchedule(
  trigger: EmailTrigger,
  audience: EmailLogAudience,
  recipientRole?: string | null
) {
  if (trigger === "test_email") return false;
  if (audience === "customer") return true;
  if (!recipientRole) return false;
  return !["Owner", "Admin", "Manager"].includes(recipientRole);
}

async function insertEmailLog(payload: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("email_messages")
    .insert(payload)
    .select("id")
    .single();
  if (error) {
    logger.warn("email log insert failed", { error: error.message });
    return null;
  }
  return data?.id as string | null;
}

async function updateEmailLog(id: string | null, payload: Record<string, unknown>) {
  if (!id) return;
  const { error } = await supabase.from("email_messages").update(payload).eq("id", id);
  if (error) {
    logger.warn("email log update failed", { id, error: error.message });
  }
}

async function deliverAndLogEmail(
  orgId: string,
  settings: EmailSettings,
  trigger: EmailTrigger,
  audience: EmailLogAudience,
  vars: Record<string, string>,
  to: { email: string; name?: string },
  subject: string,
  body: string,
  options: DeliverEmailOptions = {}
) {
  const basePayload = {
    org_id: orgId,
    trigger,
    audience,
    recipient_name: to.name ?? null,
    recipient_email: to.email,
    subject,
    body,
    metadata: {
      ...vars,
      recipient_role: options.recipientRole ?? null
    }
  };

  if (!options.ignoreWorkingSchedule && shouldRespectWorkingSchedule(trigger, audience, options.recipientRole)) {
    if (!isWithinWorkingSchedule(settings)) {
      const scheduledFor = nextWorkingScheduleAt(settings) ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await insertEmailLog({
        ...basePayload,
        provider: settings.provider ?? DEFAULT_EMAIL_PROVIDER,
        fallback_from: null,
        status: "deferred",
        scheduled_for: scheduledFor
      });
      logger.info("email deferred: outside working schedule", {
        orgId,
        trigger,
        to: to.email,
        recipientRole: options.recipientRole ?? null,
        scheduledFor
      });
      return {
        provider: settings.provider ?? DEFAULT_EMAIL_PROVIDER
      };
    }
  }

  try {
    const result = await dispatch(orgId, settings, to, subject, body, vars);
    await insertEmailLog({
      ...basePayload,
      provider: result.provider,
      fallback_from: result.fallbackFrom ?? null,
      status: "sent",
      sent_at: new Date().toISOString()
    });
    logger.info("email sent", {
      orgId,
      trigger,
      provider: result.provider,
      fallbackFrom: result.fallbackFrom ?? null,
      to: to.email
      });
    return result;
  } catch (err: any) {
    const normalized = normalizeDispatchError(settings.provider ?? DEFAULT_EMAIL_PROVIDER, err);
    await insertEmailLog({
      ...basePayload,
      provider: normalized.provider ?? settings.provider ?? DEFAULT_EMAIL_PROVIDER,
      fallback_from: null,
      status: "failed",
      error_message: normalized.message
    });
    logger.error("email send failed", {
      orgId,
      trigger,
      to: to.email,
      error: normalized.message
    });
    throw normalized;
  }
}

// ── Core: send to a single customer/address ───────────────
export async function sendEmail(
  orgId: string,
  trigger: EmailTrigger,
  vars: Record<string, string>,
  to: { email: string; name?: string },
  options?: DeliverEmailOptions
): Promise<void> {
  const settings = await loadSettings(orgId);
  if (!settings || !settings.enabled) return;
  if (!settings.triggers[trigger]) return;
  if (!hasValidKeys(settings)) return;
  if (!settings.from_email || !to.email) return;

  const tpl = settings.templates?.[trigger];
  if (!tpl?.subject || !tpl?.body) return;

  const subject = interpolate(tpl.subject, vars);
  const body    = interpolate(tpl.body, vars);

  try {
    await deliverAndLogEmail(orgId, settings, trigger, "customer", vars, to, subject, body, options);
  } catch {
    // already logged
  }
}

// ── Core: send to staff by role ───────────────────────────
export async function sendToStaff(
  orgId: string,
  trigger: EmailTrigger,
  vars: Record<string, string>,
  roles: string[],
  options?: EmailActionOptions
): Promise<void> {
  const settings = await loadSettings(orgId);
  if (!settings || !settings.enabled) return;
  if (!settings.triggers[trigger]) return;
  if (!hasValidKeys(settings)) return;
  if (!settings.from_email) return;

  const tpl = settings.templates?.[trigger];
  if (!tpl?.subject || !tpl?.body) return;

  const recipients = await getStaffRecipients(orgId, roles);
  for (const r of recipients) {
    const actionPath = options?.actionPathForRole?.(r.role);
    const scopedVars: Record<string, string> = {
      ...vars,
      recipient_name: r.name,
      ...(actionPath
        ? {
            action_url: absoluteAppUrl(actionPath),
            action_label: options?.actionLabel ?? "Open in Protohub"
          }
        : {})
    };
    const subject = interpolate(tpl.subject, scopedVars);
    const body    = interpolate(tpl.body, scopedVars);
    try {
      await deliverAndLogEmail(orgId, settings, trigger, "staff", scopedVars, r, subject, body, {
        recipientRole: r.role
      });
    } catch {
      // already logged
    }
  }
}

// ── Core: send to a specific user by ID ──────────────────
export async function sendToUser(
  orgId: string,
  userId: string,
  trigger: EmailTrigger,
  vars: Record<string, string>,
  options?: EmailActionOptions
): Promise<void> {
  const settings = await loadSettings(orgId);
  if (!settings || !settings.enabled) return;
  if (!settings.triggers[trigger]) return;
  if (!hasValidKeys(settings)) return;
  if (!settings.from_email) return;

  const tpl = settings.templates?.[trigger];
  if (!tpl?.subject || !tpl?.body) return;

  const { data: user } = await supabase
    .from("users")
    .select("email, name, role")
    .eq("id", userId)
    .eq("org_id", orgId)
    .single();

  if (!user?.email) return;

  const actionPath = options?.actionPathForRole?.(user.role ?? "");
  const scopedVars: Record<string, string> = {
    ...vars,
    recipient_name: user.name,
    ...(actionPath
      ? {
          action_url: absoluteAppUrl(actionPath),
          action_label: options?.actionLabel ?? "Open in Protohub"
        }
      : {})
  };
  const subject = interpolate(tpl.subject, scopedVars);
  const body    = interpolate(tpl.body, scopedVars);

  try {
    await deliverAndLogEmail(orgId, settings, trigger, "staff", scopedVars, user, subject, body, {
      recipientRole: user.role ?? null
    });
  } catch {
    // already logged
  }
}

// ══════════════════════════════════════════════════════════
// Convenience helpers
// ══════════════════════════════════════════════════════════

// ── Customer: order status change ────────────────────────
const orderDisplayName = (order: { product_name: string; package_name?: string | null }) =>
  order.package_name?.trim()
    ? `${order.product_name} — ${order.package_name}`
    : order.product_name;

export async function sendOrderStatusEmail(
  orgId: string,
  order: {
    id: string; customer: string; email?: string | null;
    product_name: string; package_name?: string | null; amount: number; currency: string;
  },
  fromStatus: string | null,
  toStatus: string
): Promise<void> {
  if (!order.email) return;
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer,
    product_name: orderDisplayName(order), amount: String(order.amount),
    currency: order.currency, from_status: fromStatus ?? "—", status: toStatus
  };
  const trigger: EmailTrigger = toStatus === "Delivered" ? "order_delivered" : "order_status_change";
  await sendEmail(orgId, trigger, vars, { email: order.email, name: order.customer });
}

// ── Customer: new order confirmation ─────────────────────
export async function sendNewOrderEmail(
  orgId: string,
  order: {
    id: string; customer: string; email?: string | null; phone: string;
    product_name: string; package_name?: string | null; amount: number; currency: string; source?: string;
  }
): Promise<void> {
  if (!order.email) return;
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer, phone: order.phone,
    product_name: orderDisplayName(order), amount: String(order.amount),
    currency: order.currency, source: order.source ?? "—"
  };
  await sendEmail(orgId, "order_new", vars, { email: order.email, name: order.customer });
}

// ── Staff: new order alert → owner + admins ───────────────
export async function sendInternalNewOrderEmail(
  orgId: string,
  order: {
    id: string; customer: string; phone: string;
    product_name: string; package_name?: string | null; amount: number; currency: string;
    source?: string; rep_name: string;
  }
): Promise<void> {
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer, phone: order.phone,
    product_name: orderDisplayName(order), amount: String(order.amount),
    currency: order.currency, source: order.source ?? "—", rep_name: order.rep_name
  };
  await sendToStaff(orgId, "internal_order_new", vars, ["Owner", "Admin"], {
    actionLabel: "Open Order",
    actionPathForRole: (role) => internalOrderHashForRole(role, order.id)
  });
}

// ── Staff: order assigned → assigned rep ──────────────────
export async function sendOrderAssignedEmail(
  orgId: string,
  repId: string,
  order: {
    id: string; customer: string; phone: string;
    product_name: string; package_name?: string | null; amount: number; currency: string; source?: string;
  }
): Promise<void> {
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer, phone: order.phone,
    product_name: orderDisplayName(order), amount: String(order.amount),
    currency: order.currency, source: order.source ?? "—"
  };
  await sendToUser(orgId, repId, "internal_order_assigned", vars, {
    actionLabel: "Open Order",
    actionPathForRole: (role) => internalOrderHashForRole(role, order.id)
  });
}

// ── Staff: order delivered → owner + admins ───────────────
export async function sendInternalDeliveredEmail(
  orgId: string,
  order: {
    id: string; customer: string;
    product_name: string; package_name?: string | null; amount: number; currency: string;
  },
  repName: string
): Promise<void> {
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer,
    product_name: orderDisplayName(order), amount: String(order.amount),
    currency: order.currency, rep_name: repName
  };
  await sendToStaff(orgId, "internal_order_delivered", vars, ["Owner", "Admin"], {
    actionLabel: "Open Order",
    actionPathForRole: (role) => internalOrderHashForRole(role, order.id)
  });
}

// ── Staff: order rescheduled → owner + admins + rep ───────
export async function sendOrderRescheduledEmail(
  orgId: string,
  order: {
    id: string; customer: string; phone: string;
    product_name: string; package_name?: string | null; scheduled_date?: string | null;
    call_outcome?: string | null; response?: string | null;
    assigned_rep_id?: string | null;
  }
): Promise<void> {
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer, phone: order.phone,
    product_name: orderDisplayName(order),
    scheduled_date: order.scheduled_date ?? "Not set",
    call_outcome: order.call_outcome ?? "—",
    response: order.response ?? "—"
  };
  await sendToStaff(orgId, "internal_order_rescheduled", vars, ["Owner", "Admin"], {
    actionLabel: "Open Order",
    actionPathForRole: (role) => internalOrderHashForRole(role, order.id)
  });
  if (order.assigned_rep_id) {
    await sendToUser(orgId, order.assigned_rep_id, "internal_order_rescheduled", vars, {
      actionLabel: "Open Order",
      actionPathForRole: (role) => internalOrderHashForRole(role, order.id)
    });
  }
}

// ── Staff: order cancelled/failed → owner + admins ────────
export async function sendOrderTerminalEmail(
  orgId: string,
  order: {
    id: string; customer: string; phone: string;
    product_name: string; package_name?: string | null; amount: number; currency: string;
    response?: string | null;
  },
  status: "Cancelled" | "Failed"
): Promise<void> {
  const trigger: EmailTrigger = status === "Cancelled" ? "internal_order_cancelled" : "internal_order_failed";
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer, phone: order.phone,
    product_name: orderDisplayName(order), amount: String(order.amount),
    currency: order.currency, status, response: order.response ?? "—"
  };
  await sendToStaff(orgId, trigger, vars, ["Owner", "Admin"], {
    actionLabel: "Open Order",
    actionPathForRole: (role) => internalOrderHashForRole(role, order.id)
  });
}

export async function sendInternalAbandonedCartEmail(
  orgId: string,
  cart: {
    id: string;
    customer: string;
    phone: string;
    product_name: string;
    package_name?: string | null;
    amount: number;
    currency: string;
    source?: string | null;
  }
): Promise<void> {
  const vars: Record<string, string> = {
    cart_id: cart.id,
    customer: cart.customer,
    phone: cart.phone,
    product_name: orderDisplayName({ product_name: cart.product_name, package_name: cart.package_name }),
    amount: String(cart.amount),
    currency: cart.currency,
    source: cart.source ?? "Website"
  };
  await sendToStaff(orgId, "internal_abandoned_cart_new", vars, ["Owner", "Admin"], {
    actionLabel: "Open Cart",
    actionPathForRole: (role) => internalCartHashForRole(role, cart.id)
  });
}

// ── Staff: low stock alert → owner + admins + inventory ───
export async function sendLowStockEmail(
  orgId: string,
  product: { name: string; currentStock: number; reorderPoint: number }
): Promise<void> {
  const vars: Record<string, string> = {
    product_name:  product.name,
    current_stock: String(product.currentStock),
    reorder_point: String(product.reorderPoint)
  };
  await sendToStaff(orgId, "internal_low_stock", vars, ["Owner", "Admin", "Inventory Manager"]);
}

export async function sendLowSmsBalanceEmail(
  orgId: string,
  details: { balance: number; threshold: number }
): Promise<void> {
  const settings = await loadSettings(orgId);
  if (!settings || !settings.enabled) return;
  if (!hasValidKeys(settings)) return;
  if (!settings.from_email) return;

  const recipients = await getStaffRecipients(orgId, ["Owner", "Admin"]);
  if (!recipients.length) return;

  const unitLabel = details.balance === 1 ? "unit" : "units";
  const thresholdLabel = details.threshold === 1 ? "unit" : "units";
  const subject = `Protohub low SMS balance — ${details.balance} ${unitLabel} left`;

  for (const recipient of recipients) {
    const body = [
      `Hello ${recipient.name},`,
      "",
      `Protohub has detected that your Multitexter SMS balance is low.`,
      "",
      `Current Balance: ${details.balance} ${unitLabel}`,
      `Alert Threshold: ${details.threshold} ${thresholdLabel}`,
      "",
      "Please top up your SMS credits soon so customer order updates and reminders keep sending without interruption."
    ].join("\n");

    try {
      const result = await dispatch(orgId, settings, recipient, subject, body);
      logger.info("low sms balance email sent", {
        orgId,
        provider: result.provider,
        fallbackFrom: result.fallbackFrom ?? null,
        to: recipient.email
      });
    } catch (err: any) {
      logger.error("low sms balance email failed", {
        orgId,
        to: recipient.email,
        error: err?.message
      });
    }
  }
}

// ── Staff: weekly report → owner ──────────────────────────
export async function sendWeeklyReport(orgId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const now     = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekStartStr = weekAgo.toISOString().split("T")[0];
    const weekEndStr   = now.toISOString().split("T")[0];

    const [{ data: orders }, { data: expenses }, { data: org }] = await Promise.all([
      supabase.from("orders").select("status, amount, currency, product_name")
        .eq("org_id", orgId).gte("created_at", weekAgo.toISOString()),
      supabase.from("expenses").select("category, amount")
        .eq("org_id", orgId).gte("date", weekStartStr),
      supabase.from("organizations").select("name").eq("id", orgId).single()
    ]);

    const totalOrders    = orders?.length ?? 0;
    const delivered      = orders?.filter(o => o.status === "Delivered").length  ?? 0;
    const cancelled      = orders?.filter(o => o.status === "Cancelled").length  ?? 0;
    const failed         = orders?.filter(o => o.status === "Failed").length     ?? 0;
    const deliveryRate   = totalOrders > 0 ? Math.round((delivered / totalOrders) * 100) : 0;
    const currency       = orders?.find(o => o.currency)?.currency ?? "NGN";
    const revenue        = orders?.filter(o => o.status === "Delivered")
                                   .reduce((s, o) => s + o.amount, 0) ?? 0;

    const adKeywords     = ["ad", "ads", "advertising", "marketing", "meta", "facebook", "google", "tiktok"];
    const adsSpent       = expenses?.filter(e =>
                             adKeywords.some(kw => e.category?.toLowerCase().includes(kw))
                           ).reduce((s, e) => s + e.amount, 0) ?? 0;
    const totalExpenses  = expenses?.reduce((s, e) => s + e.amount, 0) ?? 0;
    const otherExpenses  = totalExpenses - adsSpent;
    const netProfit      = revenue - totalExpenses;

    const productCounts: Record<string, number> = {};
    orders?.filter(o => o.status === "Delivered")
           .forEach(o => { productCounts[o.product_name] = (productCounts[o.product_name] ?? 0) + 1; });
    const topProducts = Object.entries(productCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => `  ${name}: ${count} delivered`)
      .join("\n") || "  No deliveries this week";

    const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0 });

    const vars: Record<string, string> = {
      org_name:       org?.name ?? "Your Organisation",
      week_start:     weekStartStr,
      week_end:       weekEndStr,
      total_orders:   String(totalOrders),
      delivered:      String(delivered),
      cancelled:      String(cancelled),
      failed:         String(failed),
      delivery_rate:  String(deliveryRate),
      currency,
      revenue:        fmt(revenue),
      ads_spent:      fmt(adsSpent),
      other_expenses: fmt(otherExpenses),
      total_expenses: fmt(totalExpenses),
      net_profit:     fmt(netProfit),
      top_products:   topProducts
    };

    await sendToStaff(orgId, "internal_weekly_report", vars, ["Owner", "Admin"]);
    return { ok: true };
  } catch (err: any) {
    logger.error("weekly report failed", { orgId, error: err?.message });
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}

export async function processQueuedEmails(limit = 100) {
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from("email_messages")
    .select("id, org_id, trigger, audience, recipient_name, recipient_email, subject, body, provider, status, metadata, scheduled_for")
    .eq("status", "deferred")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (error) {
    logger.error("email queue query failed", { error: error.message });
    return;
  }

  for (const row of rows ?? []) {
    const settings = await loadSettings(row.org_id);
    if (!settings || !settings.enabled || !settings.from_email || !hasValidKeys(settings)) continue;

    const vars =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, string>)
        : {};
    const recipientRole = typeof vars.recipient_role === "string" ? vars.recipient_role : null;

    if (shouldRespectWorkingSchedule(row.trigger as EmailTrigger, row.audience as EmailLogAudience, recipientRole)) {
      if (!isWithinWorkingSchedule(settings)) {
        await updateEmailLog(row.id, {
          scheduled_for: nextWorkingScheduleAt(settings) ?? new Date(Date.now() + 60 * 60 * 1000).toISOString()
        });
        continue;
      }
    }

    try {
      const result = await dispatch(
        row.org_id,
        settings,
        { email: row.recipient_email, name: row.recipient_name ?? undefined },
        row.subject,
        row.body,
        vars
      );
      await updateEmailLog(row.id, {
        provider: result.provider,
        fallback_from: result.fallbackFrom ?? null,
        status: "sent",
        sent_at: new Date().toISOString(),
        scheduled_for: null,
        error_message: null
      });
      logger.info("queued email sent", {
        orgId: row.org_id,
        trigger: row.trigger,
        to: row.recipient_email,
        provider: result.provider,
        fallbackFrom: result.fallbackFrom ?? null
      });
    } catch (err: any) {
      const normalized = normalizeDispatchError(settings.provider ?? DEFAULT_EMAIL_PROVIDER, err);
      await updateEmailLog(row.id, {
        provider: normalized.provider ?? settings.provider ?? DEFAULT_EMAIL_PROVIDER,
        fallback_from: null,
        status: "failed",
        scheduled_for: null,
        error_message: normalized.message
      });
      logger.error("queued email send failed", {
        orgId: row.org_id,
        trigger: row.trigger,
        to: row.recipient_email,
        error: normalized.message
      });
    }
  }
}

// ── Staff: new team member welcome ────────────────────────
export async function sendWelcomeEmail(
  orgId: string,
  member: { email: string; name: string; role: string; orgName: string }
): Promise<void> {
  const settings = await loadSettings(orgId);
  if (!settings || !settings.enabled) return;
  if (!settings.triggers["internal_new_team_member"]) return;
  if (!hasValidKeys(settings)) return;

  const tpl = settings.templates?.["internal_new_team_member"];
  if (!tpl?.subject || !tpl?.body) return;

  const vars: Record<string, string> = {
    recipient_name: member.name,
    role:           member.role,
    org_name:       member.orgName
  };
  const subject = interpolate(tpl.subject, vars);
  const body    = interpolate(tpl.body, vars);

  try {
    await deliverAndLogEmail(
      orgId,
      settings,
      "internal_new_team_member",
      "staff",
      vars,
      { email: member.email, name: member.name },
      subject,
      body,
      {
        recipientRole: member.role
      }
    );
  } catch {
    // already logged
  }
}

// ── Convenience: send test email ─────────────────────────
export async function sendTestEmail(
  orgId: string,
  toEmail: string
): Promise<{ ok: boolean; error?: string; provider?: EmailProvider; fallbackFrom?: EmailProvider }> {
  const settings = await loadSettings(orgId);
  if (!settings) return { ok: false, error: "Email settings not configured." };
  if (!settings.from_email) return { ok: false, error: "From email not set." };
  if (!hasValidKeys(settings)) {
    return { ok: false, error: "Add a Resend API key or Mailjet API keys first." };
  }

  const subject = "Test email from Protohub";
  const body    = `This is a live test email from your Protohub workspace.\nProvider: ${settings.provider ?? DEFAULT_EMAIL_PROVIDER}\nSender: ${brandName(settings)}\n\nIf you received this, your email integration is ready for customer and internal workflows.`;

  try {
    const result = await deliverAndLogEmail(
      orgId,
      settings,
      "test_email",
      "staff",
      { recipient_name: "Test recipient", email_test: "true" },
      { email: toEmail },
      subject,
      body,
      { ignoreWorkingSchedule: true }
    );
    return { ok: true, provider: result.provider, fallbackFrom: result.fallbackFrom };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}
