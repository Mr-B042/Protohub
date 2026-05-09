import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

export type SmsProvider = "multitexter";
export type SmsTrigger =
  | "order_new"
  | "order_status_change"
  | "order_delivered"
  | "order_failed"
  | "order_cancelled"
  | "order_rescheduled"
  | "order_not_picking"
  | "order_not_ready"
  | "order_follow_up";

export const DEFAULT_SMS_TRIGGERS: Record<SmsTrigger, boolean> = {
  order_new: true,
  order_status_change: false,
  order_delivered: true,
  order_failed: true,
  order_cancelled: true,
  order_rescheduled: true,
  order_not_picking: true,
  order_not_ready: true,
  order_follow_up: false
};

export const DEFAULT_SMS_TEMPLATES: Record<SmsTrigger, { body: string }> = {
  order_new: {
    body: "Hi {{customer}}, your order {{order_id}} for {{product_name}} has been received. Total: {{currency}} {{amount}}. We will contact you shortly."
  },
  order_status_change: {
    body: "Hi {{customer}}, your order {{order_id}} is now {{status}}. Product: {{product_name}}. Protohub will keep you updated."
  },
  order_delivered: {
    body: "Hi {{customer}}, your order {{order_id}} has been delivered successfully. Thank you for choosing Protohub."
  },
  order_failed: {
    body: "Hi {{customer}}, we could not complete order {{order_id}} for {{product_name}}. Our team will follow up shortly."
  },
  order_cancelled: {
    body: "Hi {{customer}}, your order {{order_id}} has been cancelled. If this was unexpected, please contact Protohub."
  },
  order_rescheduled: {
    body: "Hi {{customer}}, your order {{order_id}} has been rescheduled for {{scheduled_date}}. We will follow up again."
  },
  order_not_picking: {
    body: "Hi {{customer}}, we tried reaching you about order {{order_id}} but could not get through. Please expect another follow-up from Protohub."
  },
  order_not_ready: {
    body: "Hi {{customer}}, we understand you are not ready for order {{order_id}} yet. We will follow up again on {{scheduled_date}}."
  },
  order_follow_up: {
    body: "Hi {{customer}}, this is a follow-up on your order {{order_id}} for {{product_name}}. Next follow-up: {{scheduled_date}}. {{note_text}}"
  }
};

interface SmsSettings {
  enabled: boolean;
  provider: SmsProvider;
  api_key: string;
  sender_name: string;
  triggers: Record<string, boolean>;
  templates: Record<string, { body: string }>;
}

type SendSmsOptions = {
  orderId?: string | null;
  audience?: "customer" | "staff";
  recipientName?: string;
  sendAt?: string | null;
  metadata?: Record<string, unknown>;
  ignoreEnabled?: boolean;
  ignoreTrigger?: boolean;
};

type SmsDispatchResult = {
  provider: SmsProvider;
  providerMessageId?: string;
  providerStatus?: string;
  units?: number;
  balance?: number;
  segments: number;
  normalizedPhone: string;
};

class SmsDispatchError extends Error {
  provider: SmsProvider;
  statusCode?: number;
  code?: string;
  raw?: unknown;

  constructor(
    provider: SmsProvider,
    message: string,
    opts?: { statusCode?: number; code?: string; raw?: unknown }
  ) {
    super(message);
    this.name = "SmsDispatchError";
    this.provider = provider;
    this.statusCode = opts?.statusCode;
    this.code = opts?.code;
    this.raw = opts?.raw;
  }
}

const DEFAULT_SMS_PROVIDER: SmsProvider = "multitexter";
const MULTITEXTER_SEND_URL = "https://app.multitexter.com/v2/app/sendsms";
const MULTITEXTER_BALANCE_URL = "https://app.multitexter.com/v2/app/balance";
const MULTITEXTER_REPORT_URL = "https://app.multitexter.com/v2/app/message/report";

function applyEnvFallbacks(settings: SmsSettings): SmsSettings {
  return {
    ...settings,
    provider: settings.provider ?? DEFAULT_SMS_PROVIDER,
    api_key: settings.api_key || process.env.MULTITEXTER_API_KEY || "",
    sender_name: settings.sender_name || process.env.SMS_SENDER_NAME || "Protohub",
    triggers: {
      ...DEFAULT_SMS_TRIGGERS,
      ...(settings.triggers ?? {})
    },
    templates: {
      ...DEFAULT_SMS_TEMPLATES,
      ...(settings.templates ?? {})
    }
  };
}

function interpolate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function fieldFromRecord(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null) return record[name];
  }
  const lowered = names.map((name) => name.toLowerCase());
  for (const [key, value] of Object.entries(record)) {
    if (lowered.includes(key.toLowerCase()) && value !== undefined && value !== null) return value;
  }
  return undefined;
}

function normalizePhoneForSms(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("234") && digits.length >= 13 && digits.length <= 15) {
    return digits;
  }
  if (digits.startsWith("0") && digits.length === 11) {
    return `234${digits.slice(1)}`;
  }
  if (!digits.startsWith("0") && digits.length === 10) {
    return `234${digits}`;
  }
  if (!digits.startsWith("0") && digits.length >= 11 && digits.length <= 15) {
    return digits;
  }
  return null;
}

function estimateSmsSegments(message: string) {
  const isUnicode = /[^\u0000-\u007f]/.test(message);
  const single = isUnicode ? 70 : 160;
  const multi = isUnicode ? 67 : 153;
  if (message.length <= single) return 1;
  return Math.ceil(message.length / multi);
}

async function loadSettings(orgId: string): Promise<SmsSettings | null> {
  const { data, error } = await supabase
    .from("sms_settings")
    .select("*")
    .eq("org_id", orgId)
    .single();

  if (error || !data) return null;
  return applyEnvFallbacks(data as SmsSettings);
}

function hasValidSettings(settings: SmsSettings | null): settings is SmsSettings {
  return !!settings?.api_key && !!settings.sender_name;
}

async function insertSmsLog(payload: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("sms_messages")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    logger.warn("sms log insert failed", { error: error.message });
    return null;
  }

  return data?.id as string | null;
}

async function updateSmsLog(id: string | null, payload: Record<string, unknown>) {
  if (!id) return;
  const { error } = await supabase.from("sms_messages").update(payload).eq("id", id);
  if (error) logger.warn("sms log update failed", { id, error: error.message });
}

function normalizeSmsError(err: unknown): SmsDispatchError {
  if (err instanceof SmsDispatchError) return err;
  const record = (typeof err === "object" && err) ? err as Record<string, unknown> : {};
  const message = String(
    fieldFromRecord(record, "msg", "message", "error", "ErrorMessage")
    ?? (err instanceof Error ? err.message : "SMS send failed.")
  );
  const statusCode = Number(fieldFromRecord(record, "statusCode", "status")) || undefined;
  const codeValue = fieldFromRecord(record, "code", "ErrorCode");
  return new SmsDispatchError(DEFAULT_SMS_PROVIDER, message, {
    statusCode,
    code: codeValue ? String(codeValue) : undefined,
    raw: err
  });
}

async function sendViaMultitexter(
  settings: SmsSettings,
  phone: string,
  body: string,
  sendAt?: string | null
): Promise<{
  providerMessageId?: string;
  providerStatus?: string;
  units?: number;
  balance?: number;
}> {
  const payload: Record<string, unknown> = {
    Message: body,
    message: body,
    Sender_name: settings.sender_name,
    sender_name: settings.sender_name,
    Recipients: phone,
    recipients: phone
  };
  if (sendAt) payload.sendtime = sendAt;

  const response = await fetch(MULTITEXTER_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.api_key}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const rawText = await response.text();
  const parsed = safeJsonParse<Record<string, unknown>>(rawText) ?? { raw: rawText };

  if (!response.ok) {
    throw new SmsDispatchError("multitexter", String(fieldFromRecord(parsed, "msg", "message", "error") ?? response.statusText), {
      statusCode: response.status,
      raw: parsed
    });
  }

  const statusValue = Number(fieldFromRecord(parsed, "status"));
  if (statusValue !== 1) {
    throw new SmsDispatchError("multitexter", String(fieldFromRecord(parsed, "msg", "message", "error") ?? "SMS send failed."), {
      statusCode: response.status,
      code: Number.isFinite(statusValue) ? String(statusValue) : undefined,
      raw: parsed
    });
  }

  return {
    providerMessageId: fieldFromRecord(parsed, "msgid", "Msgid", "message_id", "messageid")
      ? String(fieldFromRecord(parsed, "msgid", "Msgid", "message_id", "messageid"))
      : undefined,
    providerStatus: String(fieldFromRecord(parsed, "msg", "message") ?? "Sent"),
    units: Number(fieldFromRecord(parsed, "units", "Units")) || undefined,
    balance: Number(fieldFromRecord(parsed, "balance", "Balance")) || undefined
  };
}

async function dispatchSms(
  orgId: string,
  trigger: SmsTrigger,
  vars: Record<string, string>,
  recipientPhone: string,
  options: SendSmsOptions = {}
): Promise<SmsDispatchResult | null> {
  const settings = await loadSettings(orgId);
  if (!settings) return null;
  if (!options.ignoreEnabled && !settings.enabled) return null;
  if (!options.ignoreTrigger && !settings.triggers?.[trigger]) return null;
  if (!hasValidSettings(settings)) return null;

  const normalizedPhone = normalizePhoneForSms(recipientPhone);
  if (!normalizedPhone) {
    logger.warn("sms skipped: invalid phone", { orgId, trigger, phone: recipientPhone });
    return null;
  }

  const template = settings.templates?.[trigger];
  if (!template?.body) return null;

  const messageBody = interpolate(template.body, vars).trim();
  if (!messageBody) return null;

  const segments = estimateSmsSegments(messageBody);
  const logId = await insertSmsLog({
    org_id: orgId,
    order_id: options.orderId ?? null,
    trigger,
    audience: options.audience ?? "customer",
    recipient_name: options.recipientName ?? null,
    recipient_phone: recipientPhone,
    normalized_phone: normalizedPhone,
    body: messageBody,
    sender_name: settings.sender_name,
    provider: settings.provider,
    status: "queued",
    segments,
    scheduled_for: options.sendAt ?? null,
    metadata: options.metadata ?? {}
  });

  try {
    const result = await sendViaMultitexter(settings, normalizedPhone, messageBody, options.sendAt);
    await updateSmsLog(logId, {
      status: "sent",
      provider_message_id: result.providerMessageId ?? null,
      provider_status: result.providerStatus ?? null,
      units: result.units ?? 0,
      sent_at: new Date().toISOString()
    });
    logger.info("sms sent", {
      orgId,
      trigger,
      provider: settings.provider,
      to: normalizedPhone,
      providerMessageId: result.providerMessageId ?? null
    });
    return {
      provider: settings.provider,
      providerMessageId: result.providerMessageId,
      providerStatus: result.providerStatus,
      units: result.units,
      balance: result.balance,
      segments,
      normalizedPhone
    };
  } catch (err) {
    const normalized = normalizeSmsError(err);
    await updateSmsLog(logId, {
      status: "failed",
      error_code: normalized.code ?? null,
      error_message: normalized.message,
      provider_status: normalized.message
    });
    logger.error("sms send failed", {
      orgId,
      trigger,
      to: normalizedPhone,
      statusCode: normalized.statusCode,
      code: normalized.code,
      error: normalized.message
    });
    if (options.ignoreEnabled) throw normalized;
    return null;
  }
}

function resolvePostponedTrigger(callOutcome?: string | null, response?: string | null): SmsTrigger {
  const combined = `${callOutcome ?? ""} ${response ?? ""}`.toLowerCase();
  if (
    combined.includes("not ready")
    || combined.includes("later")
    || combined.includes("travel")
    || combined.includes("travell")
  ) {
    return "order_not_ready";
  }
  if (
    combined.includes("no answer")
    || combined.includes("not reached")
    || combined.includes("not picking")
    || combined.includes("switched off")
    || combined.includes("busy")
    || combined.includes("unreachable")
  ) {
    return "order_not_picking";
  }
  return "order_rescheduled";
}

type DueReminderOrder = {
  id: string;
  org_id: string;
  customer: string;
  phone: string;
  product_name: string;
  amount: number;
  currency: string;
  status: string;
  scheduled_date?: string | null;
  scheduled_at?: string | null;
  call_outcome?: string | null;
  response?: string | null;
  notes?: unknown;
  timeline_notes?: unknown;
};

type TimelineReminderNote = {
  id: string;
  text: string;
  followUpDate?: string;
  followUpAt?: string;
};

function parseLegacyPlannedMetadata(value: unknown): { timelineNotes?: unknown[] } {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return { timelineNotes: Array.isArray(record.timelineNotes) ? record.timelineNotes : undefined };
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    return { timelineNotes: Array.isArray(record.timelineNotes) ? record.timelineNotes : undefined };
  } catch {
    return {};
  }
}

function normalizeTimelineReminderNotes(order: DueReminderOrder): TimelineReminderNote[] {
  const source = Array.isArray(order.timeline_notes)
    ? order.timeline_notes
    : parseLegacyPlannedMetadata(order.notes).timelineNotes ?? [];

  return source
    .filter((note): note is Record<string, unknown> => !!note && typeof note === "object" && !Array.isArray(note))
    .map((note, index) => ({
      id: typeof note.id === "string" && note.id ? note.id : `note-${index + 1}`,
      text: typeof note.text === "string" ? note.text : "",
      followUpDate: typeof note.followUpDate === "string" ? note.followUpDate : undefined,
      followUpAt: typeof note.followUpAt === "string" ? note.followUpAt : undefined
    }))
    .filter((note) => Boolean(note.followUpAt || note.followUpDate));
}

function toDateKey(value: string) {
  return value.slice(0, 10);
}

function dueIsoMoment(value: string | null | undefined, now: Date): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getTime() <= now.getTime() ? parsed.toISOString() : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value <= toDateKey(now.toISOString())) {
    return `${value}T08:00:00.000Z`;
  }
  return null;
}

function withinReminderWindow(iso: string, now: Date, maxAgeHours = 36) {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return false;
  return ts <= now.getTime() && ts >= now.getTime() - maxAgeHours * 60 * 60 * 1000;
}

async function reminderAlreadyLogged(orgId: string, orderId: string, dedupeKey: string) {
  const { data, error } = await supabase
    .from("sms_messages")
    .select("id")
    .eq("org_id", orgId)
    .eq("order_id", orderId)
    .eq("trigger", "order_follow_up")
    .neq("status", "failed")
    .contains("metadata", { dedupeKey })
    .limit(1);

  if (error) {
    logger.warn("sms reminder dedupe check failed", { orgId, orderId, dedupeKey, error: error.message });
    return false;
  }

  return (data?.length ?? 0) > 0;
}

async function sendFollowUpReminderSms(
  orgId: string,
  order: DueReminderOrder,
  options: {
    dedupeKey: string;
    scheduledLabel: string;
    noteText?: string;
    metadata?: Record<string, unknown>;
  }
) {
  return dispatchSms(
    orgId,
    "order_follow_up",
    {
      order_id: order.id,
      customer: order.customer,
      product_name: order.product_name,
      amount: String(order.amount),
      currency: order.currency,
      from_status: order.status ?? "—",
      status: order.status ?? "—",
      scheduled_date: options.scheduledLabel,
      call_outcome: order.call_outcome ?? "—",
      response: order.response ?? "Follow-up reminder",
      note_text: options.noteText ?? ""
    },
    order.phone,
    {
      orderId: order.id,
      audience: "customer",
      recipientName: order.customer,
      metadata: {
        event: "order_follow_up",
        dedupeKey: options.dedupeKey,
        ...(options.metadata ?? {})
      }
    }
  );
}

export async function getSmsBalance(orgId: string): Promise<{ balance: number | null; raw?: unknown }> {
  const settings = await loadSettings(orgId);
  if (!hasValidSettings(settings)) {
    throw new SmsDispatchError("multitexter", "SMS provider is not configured yet.");
  }

  const response = await fetch(MULTITEXTER_BALANCE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.api_key}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });

  const rawText = await response.text();
  const parsed = safeJsonParse<Record<string, unknown>>(rawText) ?? { raw: rawText };
  if (!response.ok) {
    throw new SmsDispatchError("multitexter", String(fieldFromRecord(parsed, "msg", "message", "error") ?? response.statusText), {
      statusCode: response.status,
      raw: parsed
    });
  }

  const balance = Number(fieldFromRecord(parsed, "balance", "Balance"));
  return { balance: Number.isFinite(balance) ? balance : null, raw: parsed };
}

export async function sendTestSms(orgId: string, phone: string) {
  const settings = await loadSettings(orgId);
  if (!settings) return { ok: false, error: "SMS settings not configured." };
  if (!hasValidSettings(settings)) return { ok: false, error: "Add your Multitexter API key first." };

  const result = await dispatchSms(
    orgId,
    "order_status_change",
    {
      customer: "Protohub Test",
      order_id: "TEST-SMS",
      from_status: "Pending",
      status: "Connected",
      product_name: "SMS Diagnostics",
      amount: "0",
      currency: "NGN"
    },
    phone,
    {
      ignoreEnabled: true,
      ignoreTrigger: true,
      audience: "customer",
      recipientName: "Protohub Test",
      metadata: { kind: "test_sms" }
    }
  ).catch((err: unknown) => {
    const normalized = normalizeSmsError(err);
    return { error: normalized.message };
  });

  if (!result || "error" in result) {
    return { ok: false, error: result?.error ?? "SMS test failed." };
  }

  return {
    ok: true,
    provider: result.provider,
    providerMessageId: result.providerMessageId ?? null,
    units: result.units ?? 0,
    segments: result.segments
  };
}

export async function sendNewOrderSms(
  orgId: string,
  order: {
    id: string;
    customer: string;
    phone: string;
    product_name: string;
    amount: number;
    currency: string;
  }
) {
  return dispatchSms(
    orgId,
    "order_new",
    {
      order_id: order.id,
      customer: order.customer,
      product_name: order.product_name,
      amount: String(order.amount),
      currency: order.currency
    },
    order.phone,
    {
      orderId: order.id,
      audience: "customer",
      recipientName: order.customer,
      metadata: { event: "order_new" }
    }
  );
}

export async function sendOrderStatusSms(
  orgId: string,
  order: {
    id: string;
    customer: string;
    phone: string;
    product_name: string;
    amount: number;
    currency: string;
    scheduled_date?: string | null;
    call_outcome?: string | null;
    response?: string | null;
  },
  fromStatus: string | null,
  toStatus: string
) {
  let trigger: SmsTrigger;
  if (toStatus === "Delivered") trigger = "order_delivered";
  else if (toStatus === "Failed") trigger = "order_failed";
  else if (toStatus === "Cancelled") trigger = "order_cancelled";
  else if (toStatus === "Postponed") trigger = resolvePostponedTrigger(order.call_outcome, order.response);
  else trigger = "order_status_change";

  return dispatchSms(
    orgId,
    trigger,
    {
      order_id: order.id,
      customer: order.customer,
      product_name: order.product_name,
      amount: String(order.amount),
      currency: order.currency,
      from_status: fromStatus ?? "—",
      status: toStatus,
      scheduled_date: order.scheduled_date ?? "soon",
      call_outcome: order.call_outcome ?? "—",
      response: order.response ?? "—"
    },
    order.phone,
    {
      orderId: order.id,
      audience: "customer",
      recipientName: order.customer,
      metadata: { event: "order_status", fromStatus, toStatus, trigger }
    }
  );
}

function normalizeDeliveryStatus(rawStatus: unknown): "sent" | "delivered" | "failed" | null {
  const value = String(rawStatus ?? "").toLowerCase();
  if (!value) return null;
  if (value.includes("deliver")) return "delivered";
  if (value.includes("fail") || value.includes("undeliver") || value.includes("reject")) return "failed";
  if (value.includes("sent") || value.includes("submit") || value.includes("queued") || value.includes("pending")) return "sent";
  return null;
}

export async function syncSmsDeliveryReports(limit = 200) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: messages, error } = await supabase
    .from("sms_messages")
    .select("id, org_id, provider_message_id")
    .eq("provider", "multitexter")
    .in("status", ["queued", "sent"])
    .not("provider_message_id", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error("sms DLR query failed", { error: error.message });
    return;
  }

  const groups = new Map<string, { id: string; providerMessageId: string }[]>();
  for (const row of messages ?? []) {
    if (!row.provider_message_id) continue;
    const current = groups.get(row.org_id) ?? [];
    current.push({ id: row.id, providerMessageId: row.provider_message_id });
    groups.set(row.org_id, current);
  }

  for (const [orgId, rows] of groups.entries()) {
    const settings = await loadSettings(orgId);
    if (!hasValidSettings(settings)) continue;

    const msgIds = rows.map((row) => row.providerMessageId);
    try {
      const response = await fetch(MULTITEXTER_REPORT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.api_key}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          Msgids: msgIds.join(","),
          msgids: msgIds.join(",")
        })
      });

      const rawText = await response.text();
      const parsed = safeJsonParse<Record<string, unknown>>(rawText) ?? { raw: rawText };
      if (!response.ok) {
        logger.warn("sms DLR request failed", { orgId, status: response.status, body: parsed });
        continue;
      }

      const data = fieldFromRecord(parsed, "data");
      const reports = Array.isArray(data) ? data : [];
      for (const report of reports) {
        if (!report || typeof report !== "object") continue;
        const record = report as Record<string, unknown>;
        const providerMessageId = fieldFromRecord(record, "msgid", "Msgid", "message_id", "messageid", "msg_id");
        const nextStatus = normalizeDeliveryStatus(fieldFromRecord(record, "status", "delivery_status", "dlr_status", "message_status"));
        if (!providerMessageId || !nextStatus) continue;

        const local = rows.find((row) => row.providerMessageId === String(providerMessageId));
        if (!local) continue;

        await updateSmsLog(local.id, {
          status: nextStatus,
          provider_status: String(fieldFromRecord(record, "status", "delivery_status", "dlr_status", "message_status") ?? nextStatus),
          delivered_at: nextStatus === "delivered" ? new Date().toISOString() : null
        });
      }
    } catch (err) {
      logger.warn("sms DLR sync failed", {
        orgId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
}

export async function syncDueFollowUpSms(limitPerOrg = 300) {
  const { data: settingsRows, error } = await supabase
    .from("sms_settings")
    .select("org_id, enabled, triggers");

  if (error) {
    logger.error("sms follow-up sync settings query failed", { error: error.message });
    return;
  }

  const eligibleOrgIds = (settingsRows ?? [])
    .filter((row) => row.enabled && (row.triggers as Record<string, boolean> | null)?.order_follow_up)
    .map((row) => row.org_id as string)
    .filter(Boolean);

  if (!eligibleOrgIds.length) return;

  const now = new Date();

  for (const orgId of eligibleOrgIds) {
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, org_id, customer, phone, product_name, amount, currency, status, scheduled_date, scheduled_at, call_outcome, response, notes, timeline_notes")
      .eq("org_id", orgId)
      .in("status", ["Confirmed", "In Process", "Dispatched", "Postponed"])
      .limit(limitPerOrg);

    if (ordersError) {
      logger.warn("sms follow-up sync order query failed", { orgId, error: ordersError.message });
      continue;
    }

    for (const order of (orders ?? []) as DueReminderOrder[]) {
      if (!order.phone?.trim()) continue;

      const scheduledDue = dueIsoMoment(order.scheduled_at ?? order.scheduled_date ?? null, now);
      if (scheduledDue && withinReminderWindow(scheduledDue, now)) {
        const dedupeKey = `scheduled:${order.scheduled_at ?? order.scheduled_date}`;
        if (!(await reminderAlreadyLogged(orgId, order.id, dedupeKey))) {
          await sendFollowUpReminderSms(orgId, order, {
            dedupeKey,
            scheduledLabel: order.scheduled_at ?? order.scheduled_date ?? toDateKey(scheduledDue),
            metadata: {
              kind: "scheduled_delivery_reminder",
              scheduledAt: order.scheduled_at ?? null,
              scheduledDate: order.scheduled_date ?? null
            }
          });
        }
      }

      for (const note of normalizeTimelineReminderNotes(order)) {
        const noteDue = dueIsoMoment(note.followUpAt ?? note.followUpDate ?? null, now);
        if (!noteDue || !withinReminderWindow(noteDue, now)) continue;

        const dedupeKey = `note:${note.id}:${note.followUpAt ?? note.followUpDate}`;
        if (await reminderAlreadyLogged(orgId, order.id, dedupeKey)) continue;

        await sendFollowUpReminderSms(orgId, order, {
          dedupeKey,
          scheduledLabel: note.followUpAt ?? note.followUpDate ?? toDateKey(noteDue),
          noteText: note.text,
          metadata: {
            kind: "timeline_follow_up",
            noteId: note.id,
            followUpAt: note.followUpAt ?? null,
            followUpDate: note.followUpDate ?? null
          }
        });
      }
    }
  }
}
