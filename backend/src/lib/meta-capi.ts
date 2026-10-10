import { createHash } from "node:crypto";
import { logger } from "./logger.js";

export type MetaTrackingMode = "off" | "landing_page" | "protohub" | "hybrid";

export type MetaTrackingConfig = {
  mode: MetaTrackingMode;
  pixelId?: string;
  accessToken?: string;
  testEventCode?: string;
  testMode?: boolean;
};

type ResolveMetaTrackingConfigArgs = {
  productId: string;
  packageSet?: string | null;
  trackingKey?: string | null;
  modeOverride?: string | null;
  pixelIdOverride?: string | null;
  testModeOverride?: string | null;
  testEventCodeOverride?: string | null;
  configOverride?: Partial<MetaTrackingConfig> | null;
};

type SendMetaPurchaseArgs = {
  config: MetaTrackingConfig;
  eventId: string;
  eventSourceUrl?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  customer: string;
  phone: string;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  fbclid?: string | null;
  /** When the fbclid was first seen (ms), for an fbc built from it. */
  fbclidSeenAtMs?: number | null;
  /** The form's visitor id (64 hex characters), sent to Meta as external_id. */
  visitorId?: string | null;
  value: number;
  currency: string;
  orderId: string;
  productId: string;
  productName: string;
  packageId: string;
  packageName: string;
  quantity?: number | null;
};

const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION || process.env.FACEBOOK_GRAPH_VERSION || "v23.0").replace(/^\/+|\/+$/g, "");
const META_DEDUPE_TTL_MS = Math.max(60_000, Number(process.env.META_CAPI_DEDUPE_TTL_MS || 24 * 60 * 60 * 1000));
const sentMetaEventIds = new Map<string, number>();

export type MetaCapiSendResult = {
  status: "off" | "missing_config" | "dry_run" | "sent" | "rejected" | "failed" | "duplicate";
  duplicate?: boolean;
  /** Meta's HTTP status and error text, kept on the order's record. */
  httpStatus?: number;
  message?: string;
};

function parseMode(value: unknown): MetaTrackingMode | null {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "off" || normalized === "disabled" || normalized === "none") return "off";
  if (normalized === "landing" || normalized === "landing_page" || normalized === "landingpage") return "landing_page";
  if (normalized === "protohub" || normalized === "web_app" || normalized === "webapp" || normalized === "app") return "protohub";
  if (normalized === "hybrid" || normalized === "both") return "hybrid";
  return null;
}

function parseBoolean(value: unknown): boolean | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on", "test", "dry_run", "dry-run"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "live"].includes(normalized)) return false;
  return null;
}

function parseConfigJson() {
  const raw = process.env.META_CAPI_CONFIG_JSON || process.env.FACEBOOK_CAPI_CONFIG_JSON || "";
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch (error: any) {
    logger.warn("meta-capi: invalid META_CAPI_CONFIG_JSON", { error: error?.message ?? String(error) });
    return {};
  }
}

function configFromUnknown(value: unknown): Partial<MetaTrackingConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const mode = parseMode(record.mode ?? record.trackingMode);
  const pixelId = String(record.pixelId ?? record.pixel_id ?? record.metaPixelId ?? "").trim();
  const accessToken = String(record.accessToken ?? record.access_token ?? record.token ?? "").trim();
  const testEventCode = String(record.testEventCode ?? record.test_event_code ?? "").trim();
  const testMode = parseBoolean(record.testMode ?? record.test_mode ?? record.dryRun ?? record.dry_run);
  return {
    ...(mode ? { mode } : {}),
    ...(pixelId ? { pixelId } : {}),
    ...(accessToken ? { accessToken } : {}),
    ...(testEventCode ? { testEventCode } : {}),
    ...(testMode !== null ? { testMode } : {})
  };
}

function packageSetKey(productId: string, packageSet?: string | null) {
  const normalizedSet = String(packageSet ?? "").trim().toLowerCase();
  return normalizedSet ? `${productId}::${normalizedSet}` : "";
}

export function resolveMetaTrackingConfig(args: ResolveMetaTrackingConfigArgs): MetaTrackingConfig {
  const configMap = parseConfigJson();
  const storedConfig = configFromUnknown(args.configOverride);
  const keys = [
    args.trackingKey?.trim(),
    packageSetKey(args.productId, args.packageSet),
    args.productId,
    "default"
  ].filter(Boolean) as string[];

  const mapped = keys.reduce<Partial<MetaTrackingConfig>>((acc, key) => {
    if (Object.keys(acc).length > 0) return acc;
    return configFromUnknown(configMap[key]);
  }, {});

  const envMode = parseMode(process.env.META_CAPI_DEFAULT_MODE ?? process.env.FACEBOOK_CAPI_DEFAULT_MODE);
  const overrideMode = parseMode(args.modeOverride);
  const envTestMode = parseBoolean(process.env.META_CAPI_TEST_MODE ?? process.env.FACEBOOK_CAPI_TEST_MODE);
  const overrideTestMode = parseBoolean(args.testModeOverride);
  const overrideTestEventCode = String(args.testEventCodeOverride ?? "").trim();
  const fallbackMode = envMode ?? "landing_page";
  const fallbackPixelId = (process.env.META_PIXEL_ID || process.env.FACEBOOK_PIXEL_ID || process.env.FB_PIXEL_ID || "").trim();
  const fallbackAccessToken = (process.env.META_CAPI_ACCESS_TOKEN || process.env.FACEBOOK_CAPI_ACCESS_TOKEN || process.env.FB_CAPI_ACCESS_TOKEN || "").trim();
  const fallbackTestEventCode = (process.env.META_TEST_EVENT_CODE || process.env.FACEBOOK_TEST_EVENT_CODE || "").trim();

  return {
    mode: overrideMode ?? storedConfig.mode ?? mapped.mode ?? fallbackMode,
    pixelId: (args.pixelIdOverride?.trim() || storedConfig.pixelId || mapped.pixelId || fallbackPixelId || undefined),
    accessToken: storedConfig.accessToken || mapped.accessToken || fallbackAccessToken || undefined,
    testEventCode: overrideTestEventCode || storedConfig.testEventCode || mapped.testEventCode || fallbackTestEventCode || undefined,
    testMode: overrideTestMode ?? storedConfig.testMode ?? mapped.testMode ?? envTestMode ?? false
  };
}

export function shouldSendMetaCapi(config: MetaTrackingConfig) {
  return (config.mode === "protohub" || config.mode === "hybrid") && Boolean(config.pixelId && config.accessToken);
}

function sha256(value?: string | null) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  return createHash("sha256").update(normalized).digest("hex");
}

function normalizePhone(value?: string | null) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("234")) return digits;
  if (digits.startsWith("0")) return `234${digits.slice(1)}`;
  if (digits.length === 10) return `234${digits}`;
  return digits;
}

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : ""
  };
}

/**
 * The fbc Meta gets (fixed 10 Oct 2026 after two Events Manager errors).
 *
 * Meta's rule: fbc = fb.1.<creationTime in MILLISECONDS when the fbclid was
 * first seen>.<the fbclid exactly as in the address>.
 *   - "creationTime" error: with no _fbc cookie we built fb.1.<now in
 *     SECONDS>... - read as milliseconds that is January 1970, "before the
 *     click"; and "now" is the send time, days late for a delivered sale.
 *   - "modified fbclid" error: a customer's _fbc cookie can hold an OLDER
 *     click than the fbclid in the page address. Sending the cookie made the
 *     click id disagree with the click the event came from.
 * So: the address has an fbclid -> keep the cookie only if it is that same
 * click, otherwise build fbc from the fbclid and when it was first seen. No
 * fbclid -> the cookie as it is.
 */
export function deriveFbc(fbc?: string | null, fbclid?: string | null, seenAtMs?: number | null, now = Date.now()) {
  const cleanFbc = String(fbc ?? "").trim();
  const clickId = String(fbclid ?? "").trim();
  if (!clickId) return cleanFbc || undefined;
  const cookieClick = cleanFbc.match(/^fb\.\d+\.\d+\.(.+)$/)?.[1];
  if (cookieClick === clickId) return cleanFbc;
  const seen = Number(seenAtMs);
  const at = Number.isFinite(seen) && seen > 0 ? Math.min(Math.round(seen), now) : now;
  return `fb.1.${at}.${clickId}`;
}

/**
 * When the customer arrived with this click (ms): the order's time less how
 * long the form had been open (formContext.secondsSinceOpen).
 */
export function fbclidSeenAt(formContext: Record<string, unknown> | null | undefined, at?: string | number | null) {
  const base = at === undefined || at === null ? Date.now() : new Date(at).getTime();
  if (!Number.isFinite(base)) return null;
  const open = Number((formContext ?? {}).secondsSinceOpen);
  return Math.round(base - (Number.isFinite(open) && open > 0 ? open * 1000 : 0));
}

function markDuplicate(pixelId: string | undefined, eventId: string, eventName: string) {
  const now = Date.now();
  for (const [key, expiresAt] of sentMetaEventIds.entries()) {
    if (expiresAt <= now) sentMetaEventIds.delete(key);
  }
  const key = `${pixelId || "no_pixel"}:${eventName}:${eventId}`;
  if (sentMetaEventIds.has(key)) return true;
  sentMetaEventIds.set(key, now + META_DEDUPE_TTL_MS);
  return false;
}

// Verify a Pixel ID + access token actually work by posting a minimal test event to
// Meta's CAPI. Returns Meta's verdict so the UI can show "working / not working".
export async function testMetaCapiConnection(
  pixelId: string,
  accessToken: string,
  testEventCode?: string
): Promise<{ ok: boolean; message: string; eventsReceived?: number }> {
  if (!pixelId || !accessToken) {
    return { ok: false, message: "Pixel ID and access token are both required." };
  }
  const payload: Record<string, unknown> = {
    data: [{
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      event_id: `protohub_capi_verify_${Date.now()}`,
      action_source: "website",
      event_source_url: "https://protohub.app/capi-verify",
      user_data: { client_user_agent: "Protohub CAPI Verify", ph: sha256("0000000000") }
    }]
  };
  if (testEventCode) payload.test_event_code = testEventCode;
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || json?.error?.error_user_msg || `Meta returned HTTP ${res.status}`;
      return { ok: false, message: msg };
    }
    return { ok: true, message: "Connected — Meta accepted the test event.", eventsReceived: Number(json?.events_received ?? 0) };
  } catch (error: any) {
    return { ok: false, message: error?.message ?? "Could not reach Meta." };
  }
}

export async function sendMetaCapiPurchase(args: SendMetaPurchaseArgs): Promise<MetaCapiSendResult> {
  if (args.config.mode === "off" || args.config.mode === "landing_page") {
    return { status: "off" };
  }
  return sendMetaCapiEvent({ ...args, eventName: "Purchase", actionSource: "website" });
}

/**
 * The delivered sale (Bright, 1 Oct 2026). Sent from the server when an order
 * is marked Delivered, so ads can be optimised on customers who actually pay
 * rather than everyone who submits. Its own event name and event id, so Meta
 * never mixes it up with the Purchase sent at order creation.
 */
export async function sendMetaCapiDelivered(args: SendMetaPurchaseArgs & { eventName: string; eventTime: number }): Promise<MetaCapiSendResult> {
  return sendMetaCapiEvent({
    ...args,
    // A website event needs the browser it came from; without it Meta treats
    // the event as coming from our own system.
    actionSource: args.userAgent && args.eventSourceUrl ? "website" : "system_generated"
  });
}

async function sendMetaCapiEvent(args: SendMetaPurchaseArgs & { eventName: string; actionSource: string; eventTime?: number }): Promise<MetaCapiSendResult> {
  if (!args.config.pixelId || !args.config.accessToken) {
    logger.warn("meta-capi: purchase not sent because config is incomplete", {
      orderId: args.orderId,
      mode: args.config.mode,
      hasPixelId: Boolean(args.config.pixelId),
      hasAccessToken: Boolean(args.config.accessToken),
      testMode: Boolean(args.config.testMode)
    });
    return { status: "missing_config", message: "Pixel ID or access token missing." };
  }
  const duplicate = markDuplicate(args.config.pixelId, args.eventId, args.eventName);
  if (duplicate) {
    logger.warn(`meta-capi: duplicate ${args.eventName} event_id blocked`, {
      orderId: args.orderId,
      pixelId: args.config.pixelId,
      eventId: args.eventId,
      mode: args.config.mode,
      testMode: Boolean(args.config.testMode)
    });
    return { status: "duplicate", duplicate: true };
  }

  const { firstName, lastName } = splitName(args.customer);
  const fbc = deriveFbc(args.fbc, args.fbclid, args.fbclidSeenAtMs);
  const userData: Record<string, unknown> = {
    client_ip_address: args.clientIp || undefined,
    client_user_agent: args.userAgent || undefined,
    ph: sha256(normalizePhone(args.phone)),
    em: sha256(args.email),
    fn: sha256(firstName),
    ln: sha256(lastName),
    ct: sha256(args.city),
    st: sha256(args.state),
    country: sha256(args.country || "ng"),
    fbp: args.fbp || undefined,
    fbc,
    // Already the shape of a hashed value: sent as the browser sent it.
    external_id: cleanVisitorId(args.visitorId) || undefined
  };

  for (const key of Object.keys(userData)) {
    if (userData[key] === undefined || userData[key] === "") delete userData[key];
  }

  const payload: Record<string, unknown> = {
    data: [{
      event_name: args.eventName,
      event_time: args.eventTime ?? Math.floor(Date.now() / 1000),
      event_id: args.eventId,
      action_source: args.actionSource,
      event_source_url: args.eventSourceUrl || undefined,
      user_data: userData,
      custom_data: {
        currency: args.currency,
        value: Number(args.value || 0),
        order_id: args.orderId,
        content_name: `${args.productName} - ${args.packageName}`,
        content_ids: [args.productId, args.packageId],
        content_type: "product",
        contents: [{ id: args.packageId, quantity: args.quantity ?? 1 }]
      }
    }]
  };
  if (args.config.testEventCode) payload.test_event_code = args.config.testEventCode;

  if (args.config.testMode && !args.config.testEventCode) {
    logger.info(`meta-capi: test-mode dry run, ${args.eventName} not sent to Meta`, {
      orderId: args.orderId,
      pixelId: args.config.pixelId,
      eventId: args.eventId,
      mode: args.config.mode,
      value: Number(args.value || 0),
      currency: args.currency,
      dedupe: "unique_event_id"
    });
    return { status: "dry_run" };
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(args.config.pixelId!)}/events?access_token=${encodeURIComponent(args.config.accessToken!)}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.warn("meta-capi: event rejected", {
        orderId: args.orderId,
        eventName: args.eventName,
        status: response.status,
        testMode: Boolean(args.config.testMode),
        body: body.slice(0, 500)
      });
      let message = body.slice(0, 300);
      try { const parsed = JSON.parse(body); message = parsed?.error?.error_user_msg || parsed?.error?.message || message; } catch { /* keep the raw text */ }
      return { status: "rejected", httpStatus: response.status, message };
    }
    logger.info("meta-capi: event sent", {
      eventName: args.eventName,
      orderId: args.orderId,
      pixelId: args.config.pixelId,
      eventId: args.eventId,
      testMode: Boolean(args.config.testMode),
      testEventCode: Boolean(args.config.testEventCode)
    });
    return { status: "sent", httpStatus: response.status };
  } catch (error: any) {
    logger.warn("meta-capi: event send failed", {
      orderId: args.orderId,
      eventName: args.eventName,
      testMode: Boolean(args.config.testMode),
      error: error?.message ?? String(error)
    });
    // Nothing reached Meta, so let a later retry through the repeat guard.
    sentMetaEventIds.delete(`${args.config.pixelId || "no_pixel"}:${args.eventName}:${args.eventId}`);
    return { status: "failed", message: String(error?.message ?? error).slice(0, 300) };
  }
}

/**
 * One row per order per event (Purchase / Delivered) in meta_capi_events, so
 * the order shows whether Meta got it. "off" is not recorded: nothing was
 * meant to be sent. A later attempt for the same order and event replaces the
 * earlier result and counts the attempt.
 */
export async function recordMetaCapiEvent(supabase: any, args: {
  orgId: string; branchId: string | null | undefined; orderId: string;
  eventName: "Purchase" | "Delivered"; metaEventName: string; eventId: string;
  result: MetaCapiSendResult; testMode: boolean; value: number; currency: string; pixelId?: string | null;
}) {
  if (args.result.status === "off" || !args.branchId) return;
  try {
    const { data: existing } = await supabase.from("meta_capi_events").select("id, attempts")
      .eq("org_id", args.orgId).eq("order_id", args.orderId).eq("event_name", args.eventName).maybeSingle();
    const row = {
      org_id: args.orgId, branch_id: args.branchId, order_id: args.orderId,
      event_name: args.eventName, meta_event_name: args.metaEventName, event_id: args.eventId,
      status: args.result.status, http_status: args.result.httpStatus ?? null, message: args.result.message ?? null,
      test_mode: args.testMode, value: args.value, currency: args.currency, pixel_id: args.pixelId ?? null, sent_at: new Date().toISOString()
    };
    if (existing) {
      // A blocked repeat must not overwrite the real result it repeated.
      if (args.result.status === "duplicate") return;
      await supabase.from("meta_capi_events").update({ ...row, attempts: Number(existing.attempts ?? 1) + 1 }).eq("id", existing.id);
    } else {
      await supabase.from("meta_capi_events").insert(row);
    }
  } catch (error: any) {
    logger.warn("meta-capi: could not record the event", { orderId: args.orderId, eventName: args.eventName, error: error?.message ?? String(error) });
  }
}

/**
 * Meta's browser id (fbp), click id (fbc) and fbclid for an order. The
 * WordPress embed passes them in the form's address; forms opened before the
 * 1 Oct 2026 fix dropped fbp/fbc on the way into formContext, so fall back to
 * reading them from the saved address (search part or the #/route?query part).
 */
/** The form's visitor id, only when it is the 64 hex characters the form makes. */
export function cleanVisitorId(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-f0-9]{64}$/.test(text) ? text : null;
}

export function metaIdsFromFormContext(formContext: Record<string, unknown> | null | undefined) {
  const context = formContext ?? {};
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = context[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  const fromAddress = (() => {
    const raw = pick("landingUrl");
    if (!raw) return new URLSearchParams();
    try {
      const url = new URL(raw);
      const merged = new URLSearchParams(url.search);
      new URLSearchParams(url.hash.split("?")[1] ?? "").forEach((value, key) => merged.set(key, value));
      return merged;
    } catch {
      return new URLSearchParams();
    }
  })();
  const address = (...keys: string[]) => keys.map((key) => fromAddress.get(key)?.trim() ?? "").find(Boolean) ?? "";
  return {
    fbp: pick("fbp", "_fbp", "Fbp") || address("fbp", "_fbp") || null,
    fbc: pick("fbc", "_fbc", "Fbc") || address("fbc", "_fbc") || null,
    fbclid: pick("fbclid") || address("fbclid") || null,
    visitorId: cleanVisitorId(context.visitorId)
  };
}

/** Noon (Lagos) on the delivered date, never in the future. */
export function deliveredEventTime(deliveredDate: string | null | undefined, nowMs = Date.now()) {
  const day = (deliveredDate ?? "").slice(0, 10);
  const noon = day ? Date.parse(`${day}T12:00:00+01:00`) : NaN;
  const ms = Number.isFinite(noon) ? Math.min(noon, nowMs) : nowMs;
  return Math.floor(ms / 1000);
}
