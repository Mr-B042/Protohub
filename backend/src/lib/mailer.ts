import Mailjet from "node-mailjet";
import { Resend } from "resend";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

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

function brandName(settings: EmailSettings) {
  return settings.from_name?.trim() || "Protohub";
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
    reply_to: settings.reply_to || process.env.EMAIL_REPLY_TO || ""
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

function buildEmailContent(settings: EmailSettings, subject: string, body: string): EmailContent {
  const brandedText = ensureBrandSignature(body, settings);
  const sections = brandedText.split(/\n\s*\n/).filter((section) => section.trim());
  const preview = sections.find((section) => section.trim())?.replace(/\s+/g, " ").slice(0, 140) ?? subject;
  const sectionsHtml = sections.map(renderSectionHtml).join("");
  const sender = escapeHtml(brandName(settings));
  const escapedSubject = escapeHtml(subject);
  const escapedPreview = escapeHtml(preview);
  const replyTo = settings.reply_to || settings.from_email;
  const replyToHtml = replyTo
    ? `<a href="mailto:${escapeHtml(replyTo)}" style="color:#15803d;text-decoration:none;">${escapeHtml(replyTo)}</a>`
    : sender;

  return {
    text: brandedText,
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
  const { data, error } = await supabase
    .from("email_settings")
    .select("*")
    .eq("org_id", orgId)
    .single();

  if (error || !data) return null;
  return applyEnvFallbacks(data as EmailSettings);
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
  body: string
): Promise<void> {
  const content = buildEmailContent(settings, subject, body);
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
  body: string
): Promise<void> {
  const content = buildEmailContent(settings, subject, body);
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
  body: string
): Promise<void> {
  if (provider === "resend") {
    await sendViaResend(settings, to, subject, body);
    return;
  }
  await sendViaMailjet(settings, to, subject, body);
}

// ── Dispatch to correct provider with fallback ────────────
async function dispatch(
  orgId: string,
  settings: EmailSettings,
  to: { email: string; name?: string },
  subject: string,
  body: string
): Promise<ProviderDispatchResult> {
  const providers = sendOrder(settings, orgId);
  if (!providers.length) {
    throw new EmailDispatchError(settings.provider ?? DEFAULT_EMAIL_PROVIDER, "No email providers are configured.");
  }

  let lastError: EmailDispatchError | null = null;
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    try {
      await sendViaProvider(provider, settings, to, subject, body);
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
): Promise<{ email: string; name: string }[]> {
  const { data } = await supabase
    .from("users")
    .select("email, name")
    .eq("org_id", orgId)
    .eq("active", true)
    .in("role", roles);

  return (data ?? []).filter((u: any) => !!u.email);
}

async function insertEmailLog(payload: Record<string, unknown>) {
  const { error } = await supabase.from("email_messages").insert(payload);
  if (error) {
    logger.warn("email log insert failed", { error: error.message });
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
  body: string
) {
  const basePayload = {
    org_id: orgId,
    trigger,
    audience,
    recipient_name: to.name ?? null,
    recipient_email: to.email,
    subject,
    body,
    metadata: vars
  };

  try {
    const result = await dispatch(orgId, settings, to, subject, body);
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
  to: { email: string; name?: string }
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
    await deliverAndLogEmail(orgId, settings, trigger, "customer", vars, to, subject, body);
  } catch {
    // already logged
  }
}

// ── Core: send to staff by role ───────────────────────────
export async function sendToStaff(
  orgId: string,
  trigger: EmailTrigger,
  vars: Record<string, string>,
  roles: string[]
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
    const subject = interpolate(tpl.subject, vars);
    const body    = interpolate(tpl.body, { ...vars, recipient_name: r.name });
    try {
      await deliverAndLogEmail(orgId, settings, trigger, "staff", { ...vars, recipient_name: r.name }, r, subject, body);
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
  vars: Record<string, string>
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
    .select("email, name")
    .eq("id", userId)
    .eq("org_id", orgId)
    .single();

  if (!user?.email) return;

  const subject = interpolate(tpl.subject, vars);
  const body    = interpolate(tpl.body, { ...vars, recipient_name: user.name });

  try {
    await deliverAndLogEmail(orgId, settings, trigger, "staff", { ...vars, recipient_name: user.name }, user, subject, body);
  } catch {
    // already logged
  }
}

// ══════════════════════════════════════════════════════════
// Convenience helpers
// ══════════════════════════════════════════════════════════

// ── Customer: order status change ────────────────────────
export async function sendOrderStatusEmail(
  orgId: string,
  order: {
    id: string; customer: string; email?: string | null;
    product_name: string; amount: number; currency: string;
  },
  fromStatus: string | null,
  toStatus: string
): Promise<void> {
  if (!order.email) return;
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer,
    product_name: order.product_name, amount: String(order.amount),
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
    product_name: string; amount: number; currency: string; source?: string;
  }
): Promise<void> {
  if (!order.email) return;
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer, phone: order.phone,
    product_name: order.product_name, amount: String(order.amount),
    currency: order.currency, source: order.source ?? "—"
  };
  await sendEmail(orgId, "order_new", vars, { email: order.email, name: order.customer });
}

// ── Staff: new order alert → owner + admins ───────────────
export async function sendInternalNewOrderEmail(
  orgId: string,
  order: {
    id: string; customer: string; phone: string;
    product_name: string; amount: number; currency: string;
    source?: string; rep_name: string;
  }
): Promise<void> {
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer, phone: order.phone,
    product_name: order.product_name, amount: String(order.amount),
    currency: order.currency, source: order.source ?? "—", rep_name: order.rep_name
  };
  await sendToStaff(orgId, "internal_order_new", vars, ["Owner", "Admin"]);
}

// ── Staff: order assigned → assigned rep ──────────────────
export async function sendOrderAssignedEmail(
  orgId: string,
  repId: string,
  order: {
    id: string; customer: string; phone: string;
    product_name: string; amount: number; currency: string; source?: string;
  }
): Promise<void> {
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer, phone: order.phone,
    product_name: order.product_name, amount: String(order.amount),
    currency: order.currency, source: order.source ?? "—"
  };
  await sendToUser(orgId, repId, "internal_order_assigned", vars);
}

// ── Staff: order delivered → owner + admins ───────────────
export async function sendInternalDeliveredEmail(
  orgId: string,
  order: {
    id: string; customer: string;
    product_name: string; amount: number; currency: string;
  },
  repName: string
): Promise<void> {
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer,
    product_name: order.product_name, amount: String(order.amount),
    currency: order.currency, rep_name: repName
  };
  await sendToStaff(orgId, "internal_order_delivered", vars, ["Owner", "Admin"]);
}

// ── Staff: order rescheduled → owner + admins + rep ───────
export async function sendOrderRescheduledEmail(
  orgId: string,
  order: {
    id: string; customer: string; phone: string;
    product_name: string; scheduled_date?: string | null;
    call_outcome?: string | null; response?: string | null;
    assigned_rep_id?: string | null;
  }
): Promise<void> {
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer, phone: order.phone,
    product_name: order.product_name,
    scheduled_date: order.scheduled_date ?? "Not set",
    call_outcome: order.call_outcome ?? "—",
    response: order.response ?? "—"
  };
  await sendToStaff(orgId, "internal_order_rescheduled", vars, ["Owner", "Admin"]);
  if (order.assigned_rep_id) {
    await sendToUser(orgId, order.assigned_rep_id, "internal_order_rescheduled", vars);
  }
}

// ── Staff: order cancelled/failed → owner + admins ────────
export async function sendOrderTerminalEmail(
  orgId: string,
  order: {
    id: string; customer: string; phone: string;
    product_name: string; amount: number; currency: string;
    response?: string | null;
  },
  status: "Cancelled" | "Failed"
): Promise<void> {
  const trigger: EmailTrigger = status === "Cancelled" ? "internal_order_cancelled" : "internal_order_failed";
  const vars: Record<string, string> = {
    order_id: order.id, customer: order.customer, phone: order.phone,
    product_name: order.product_name, amount: String(order.amount),
    currency: order.currency, status, response: order.response ?? "—"
  };
  await sendToStaff(orgId, trigger, vars, ["Owner", "Admin"]);
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
      body
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
      body
    );
    return { ok: true, provider: result.provider, fallbackFrom: result.fallbackFrom };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}
