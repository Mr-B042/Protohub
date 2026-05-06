import Mailjet from "node-mailjet";
import { Resend } from "resend";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

// ── Types ─────────────────────────────────────────────────
export type EmailTrigger =
  | "order_new"
  | "order_status_change"
  | "order_delivered"
  | "payroll_approved";

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

// ── Template variable interpolation ───────────────────────
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ── Load org email settings from DB ───────────────────────
async function loadSettings(orgId: string): Promise<EmailSettings | null> {
  const { data, error } = await supabase
    .from("email_settings")
    .select("*")
    .eq("org_id", orgId)
    .single();

  if (error || !data) return null;
  return data as EmailSettings;
}

// ── Send via Mailjet ──────────────────────────────────────
async function sendViaMailjet(
  settings: EmailSettings,
  to: { email: string; name?: string },
  subject: string,
  body: string
): Promise<void> {
  const client = new Mailjet({
    apiKey:    settings.api_key_public,
    apiSecret: settings.api_key_private
  });

  const message: Record<string, unknown> = {
    From:     { Email: settings.from_email, Name: settings.from_name || settings.from_email },
    To:       [{ Email: to.email, Name: to.name || to.email }],
    Subject:  subject,
    TextPart: body
  };

  if (settings.reply_to) message.ReplyTo = { Email: settings.reply_to };

  await (client.post("send", { version: "v3.1" }) as any).request({ Messages: [message] });
}

// ── Send via Resend ───────────────────────────────────────
async function sendViaResend(
  settings: EmailSettings,
  to: { email: string; name?: string },
  subject: string,
  body: string
): Promise<void> {
  const client = new Resend(settings.resend_api_key);

  const from = settings.from_name
    ? `${settings.from_name} <${settings.from_email}>`
    : settings.from_email;

  const payload: Parameters<typeof client.emails.send>[0] = {
    from,
    to:      [to.email],
    subject,
    text:    body,
    ...(settings.reply_to ? { reply_to: settings.reply_to } : {})
  };

  const { error } = await client.emails.send(payload);
  if (error) throw new Error(error.message);
}

// ── Core send function ────────────────────────────────────
export async function sendEmail(
  orgId: string,
  trigger: EmailTrigger,
  vars: Record<string, string>,
  to: { email: string; name?: string }
): Promise<void> {
  const settings = await loadSettings(orgId);

  if (!settings || !settings.enabled) return;
  if (!settings.triggers[trigger]) return;
  if (!settings.from_email) return;
  if (!to.email) return;

  // Provider key check
  const provider: EmailProvider = settings.provider ?? "mailjet";
  if (provider === "mailjet" && (!settings.api_key_public || !settings.api_key_private)) return;
  if (provider === "resend"  && !settings.resend_api_key) return;

  const tpl = settings.templates?.[trigger];
  if (!tpl?.subject || !tpl?.body) return;

  const subject = interpolate(tpl.subject, vars);
  const body    = interpolate(tpl.body, vars);

  try {
    if (provider === "resend") {
      await sendViaResend(settings, to, subject, body);
    } else {
      await sendViaMailjet(settings, to, subject, body);
    }
    logger.info("email sent", { orgId, trigger, provider, to: to.email });
  } catch (err: any) {
    logger.error("email send failed", { orgId, trigger, provider, to: to.email, error: err?.message });
  }
}

// ── Convenience: order status change ─────────────────────
export async function sendOrderStatusEmail(
  orgId: string,
  order: {
    id: string;
    customer: string;
    email?: string | null;
    product_name: string;
    amount: number;
    currency: string;
  },
  fromStatus: string | null,
  toStatus: string
): Promise<void> {
  if (!order.email) return;

  const vars: Record<string, string> = {
    order_id:     order.id,
    customer:     order.customer,
    product_name: order.product_name,
    amount:       String(order.amount),
    currency:     order.currency,
    from_status:  fromStatus ?? "—",
    status:       toStatus
  };

  const trigger: EmailTrigger =
    toStatus === "Delivered" ? "order_delivered" : "order_status_change";

  await sendEmail(orgId, trigger, vars, { email: order.email, name: order.customer });
}

// ── Convenience: new order ────────────────────────────────
export async function sendNewOrderEmail(
  orgId: string,
  order: {
    id: string;
    customer: string;
    email?: string | null;
    phone: string;
    product_name: string;
    amount: number;
    currency: string;
    source?: string;
  }
): Promise<void> {
  if (!order.email) return;

  const vars: Record<string, string> = {
    order_id:     order.id,
    customer:     order.customer,
    phone:        order.phone,
    product_name: order.product_name,
    amount:       String(order.amount),
    currency:     order.currency,
    source:       order.source ?? "—"
  };

  await sendEmail(orgId, "order_new", vars, { email: order.email, name: order.customer });
}

// ── Convenience: send test email ─────────────────────────
export async function sendTestEmail(
  orgId: string,
  toEmail: string
): Promise<{ ok: boolean; error?: string }> {
  const settings = await loadSettings(orgId);
  if (!settings) return { ok: false, error: "Email settings not configured." };
  if (!settings.from_email) return { ok: false, error: "From email not set." };

  const provider: EmailProvider = settings.provider ?? "mailjet";
  if (provider === "mailjet" && (!settings.api_key_public || !settings.api_key_private)) {
    return { ok: false, error: "Mailjet API keys not set." };
  }
  if (provider === "resend" && !settings.resend_api_key) {
    return { ok: false, error: "Resend API key not set." };
  }

  const subject = "Test email from ProtoHub";
  const body    = `This is a test email from your ProtoHub email integration.\nProvider: ${provider}\n\nIf you received this, your configuration is working correctly.`;

  try {
    if (provider === "resend") {
      await sendViaResend(settings, { email: toEmail }, subject, body);
    } else {
      await sendViaMailjet(settings, { email: toEmail }, subject, body);
    }
    logger.info("test email sent", { orgId, provider, to: toEmail });
    return { ok: true };
  } catch (err: any) {
    const msg = err?.message ?? "Unknown error";
    logger.error("test email failed", { orgId, provider, to: toEmail, error: msg });
    return { ok: false, error: msg };
  }
}
