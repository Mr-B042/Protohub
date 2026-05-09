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
  | "internal_new_team_member";

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

type ProviderDispatchResult = {
  provider: EmailProvider;
  fallbackFrom?: EmailProvider;
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
    const result = await dispatch(orgId, settings, to, subject, body);
    logger.info("email sent", { orgId, trigger, provider: result.provider, fallbackFrom: result.fallbackFrom ?? null, to: to.email });
  } catch (err: any) {
    logger.error("email send failed", { orgId, trigger, to: to.email, error: err?.message });
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
      const result = await dispatch(orgId, settings, r, subject, body);
      logger.info("staff email sent", { orgId, trigger, provider: result.provider, fallbackFrom: result.fallbackFrom ?? null, to: r.email });
    } catch (err: any) {
      logger.error("staff email failed", { orgId, trigger, to: r.email, error: err?.message });
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
    const result = await dispatch(orgId, settings, user, subject, body);
    logger.info("user email sent", { orgId, trigger, provider: result.provider, fallbackFrom: result.fallbackFrom ?? null, to: user.email });
  } catch (err: any) {
    logger.error("user email failed", { orgId, trigger, to: user.email, error: err?.message });
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
    const result = await dispatch(orgId, settings, { email: member.email, name: member.name }, subject, body);
    logger.info("welcome email sent", { orgId, provider: result.provider, fallbackFrom: result.fallbackFrom ?? null, to: member.email });
  } catch (err: any) {
    logger.error("welcome email failed", { orgId, to: member.email, error: err?.message });
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

  const subject = "Test email from ProtoHub";
  const body    = `This is a test email from your ProtoHub email integration.\nProvider: ${settings.provider ?? DEFAULT_EMAIL_PROVIDER}\n\nIf you received this, your configuration is working correctly.`;

  try {
    const result = await dispatch(orgId, settings, { email: toEmail }, subject, body);
    logger.info("test email sent", { orgId, provider: result.provider, fallbackFrom: result.fallbackFrom ?? null, to: toEmail });
    return { ok: true, provider: result.provider, fallbackFrom: result.fallbackFrom };
  } catch (err: any) {
    logger.error("test email failed", { orgId, to: toEmail, error: err?.message });
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}
