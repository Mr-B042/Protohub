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

type MetaCapiSendResult = {
  status: "off" | "missing_config" | "dry_run" | "sent" | "rejected" | "failed" | "duplicate";
  duplicate?: boolean;
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

function deriveFbc(fbc?: string | null, fbclid?: string | null) {
  const cleanFbc = String(fbc ?? "").trim();
  if (cleanFbc) return cleanFbc;
  const cleanFbclid = String(fbclid ?? "").trim();
  return cleanFbclid ? `fb.1.${Math.floor(Date.now() / 1000)}.${cleanFbclid}` : undefined;
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
  if (!args.config.pixelId || !args.config.accessToken) {
    logger.warn("meta-capi: purchase not sent because config is incomplete", {
      orderId: args.orderId,
      mode: args.config.mode,
      hasPixelId: Boolean(args.config.pixelId),
      hasAccessToken: Boolean(args.config.accessToken),
      testMode: Boolean(args.config.testMode)
    });
    return { status: "missing_config" };
  }
  const duplicate = markDuplicate(args.config.pixelId, args.eventId, "Purchase");
  if (duplicate) {
    logger.warn("meta-capi: duplicate Purchase event_id blocked", {
      orderId: args.orderId,
      pixelId: args.config.pixelId,
      eventId: args.eventId,
      mode: args.config.mode,
      testMode: Boolean(args.config.testMode)
    });
    return { status: "duplicate", duplicate: true };
  }

  const { firstName, lastName } = splitName(args.customer);
  const fbc = deriveFbc(args.fbc, args.fbclid);
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
    fbc
  };

  for (const key of Object.keys(userData)) {
    if (userData[key] === undefined || userData[key] === "") delete userData[key];
  }

  const payload: Record<string, unknown> = {
    data: [{
      event_name: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      event_id: args.eventId,
      action_source: "website",
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
    logger.info("meta-capi: test-mode dry run, Purchase not sent to Meta", {
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
      logger.warn("meta-capi: purchase rejected", {
        orderId: args.orderId,
        status: response.status,
        testMode: Boolean(args.config.testMode),
        body: body.slice(0, 500)
      });
      return { status: "rejected" };
    }
    logger.info("meta-capi: purchase sent", {
      orderId: args.orderId,
      pixelId: args.config.pixelId,
      eventId: args.eventId,
      testMode: Boolean(args.config.testMode),
      testEventCode: Boolean(args.config.testEventCode)
    });
    return { status: "sent" };
  } catch (error: any) {
    logger.warn("meta-capi: purchase send failed", {
      orderId: args.orderId,
      testMode: Boolean(args.config.testMode),
      error: error?.message ?? String(error)
    });
    return { status: "failed" };
  }
}
