import { createHash } from "node:crypto";
import { logger } from "./logger.js";

// TikTok Events API (server-side conversions). Mirrors the Meta CAPI flow but posts to
// TikTok's Events API 2.0. Critical for server-side auto-submits (customer left, no
// browser pixel) and for matching TikTok ad clicks via ttclid.
const TIKTOK_API_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

type TikTokConfig = {
  pixelId?: string | null;
  accessToken?: string | null;
  testEventCode?: string | null;
};

type SendTikTokArgs = {
  config: TikTokConfig;
  eventId: string;
  eventSourceUrl?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  phone?: string | null;
  email?: string | null;
  ttclid?: string | null;
  value: number;
  currency: string;
  orderId: string;
  productId?: string | null;
  productName?: string | null;
  packageId?: string | null;
  packageName?: string | null;
  quantity?: number | null;
};

type TikTokSendResult = {
  status: "off" | "missing_config" | "sent" | "rejected" | "failed" | "duplicate";
};

const sentTikTokEventIds = new Map<string, number>();
const TIKTOK_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

function markTikTokDuplicate(pixelId: string, eventId: string): boolean {
  const now = Date.now();
  // prune
  for (const [key, ts] of sentTikTokEventIds) {
    if (now - ts > TIKTOK_DEDUPE_TTL_MS) sentTikTokEventIds.delete(key);
  }
  const key = `${pixelId}:${eventId}`;
  if (sentTikTokEventIds.has(key)) return true;
  sentTikTokEventIds.set(key, now);
  return false;
}

function sha256(value?: string | null): string | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  return createHash("sha256").update(normalized).digest("hex");
}

// E.164 for Nigerian numbers, then it's the caller's hashed form TikTok expects.
function toE164(value?: string | null): string | undefined {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return undefined;
  if (digits.startsWith("234")) return `+${digits}`;
  if (digits.startsWith("0")) return `+234${digits.slice(1)}`;
  if (digits.length === 10) return `+234${digits}`;
  return `+${digits}`;
}

export function shouldSendTikTok(config: TikTokConfig | null | undefined): boolean {
  return Boolean(config?.pixelId && config?.accessToken);
}

export async function sendTikTokConversion(args: SendTikTokArgs): Promise<TikTokSendResult> {
  const pixelId = args.config.pixelId?.trim();
  const accessToken = args.config.accessToken?.trim();
  if (!pixelId || !accessToken) return { status: "missing_config" };

  if (markTikTokDuplicate(pixelId, args.eventId)) {
    logger.warn("tiktok-events: duplicate event_id blocked", { orderId: args.orderId, eventId: args.eventId });
    return { status: "duplicate" };
  }

  const user: Record<string, unknown> = {
    ttclid: args.ttclid || undefined,
    phone: sha256(toE164(args.phone)),
    email: sha256(args.email),
    ip: args.clientIp || undefined,
    user_agent: args.userAgent || undefined
  };
  for (const k of Object.keys(user)) if (user[k] === undefined || user[k] === "") delete user[k];

  const body: Record<string, unknown> = {
    event_source: "web",
    event_source_id: pixelId,
    data: [{
      event: "CompletePayment",
      event_time: Math.floor(Date.now() / 1000),
      event_id: args.eventId,
      user,
      properties: {
        currency: args.currency,
        value: Number(args.value || 0),
        content_type: "product",
        contents: [{
          content_id: args.packageId || args.productId || undefined,
          content_name: `${args.productName ?? ""}${args.packageName ? ` - ${args.packageName}` : ""}`.trim() || undefined,
          quantity: args.quantity ?? 1,
          price: Number(args.value || 0)
        }],
        order_id: args.orderId
      },
      page: args.eventSourceUrl ? { url: args.eventSourceUrl } : undefined
    }]
  };
  if (args.config.testEventCode) (body as any).test_event_code = args.config.testEventCode;

  try {
    const res = await fetch(TIKTOK_API_URL, {
      method: "POST",
      headers: { "Access-Token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const json: any = await res.json().catch(() => ({}));
    // TikTok returns { code: 0, message: "OK" } on success; non-zero code = error.
    if (!res.ok || (json?.code !== undefined && json.code !== 0)) {
      logger.warn("tiktok-events: rejected", { orderId: args.orderId, status: res.status, code: json?.code, message: json?.message });
      return { status: "rejected" };
    }
    logger.info("tiktok-events: sent", { orderId: args.orderId, pixelId, eventId: args.eventId });
    return { status: "sent" };
  } catch (error: any) {
    logger.warn("tiktok-events: send failed", { orderId: args.orderId, error: error?.message ?? String(error) });
    return { status: "failed" };
  }
}

// Verify a TikTok Pixel ID + access token by posting a minimal test event.
export async function testTikTokConnection(
  pixelId: string,
  accessToken: string,
  testEventCode?: string
): Promise<{ ok: boolean; message: string }> {
  if (!pixelId || !accessToken) {
    return { ok: false, message: "TikTok Pixel ID and access token are both required." };
  }
  const body: Record<string, unknown> = {
    event_source: "web",
    event_source_id: pixelId,
    data: [{
      event: "CompletePayment",
      event_time: Math.floor(Date.now() / 1000),
      event_id: `protohub_tt_verify_${Date.now()}`,
      user: { user_agent: "Protohub TikTok Verify", phone: sha256("+2340000000000") },
      properties: { currency: "NGN", value: 0, content_type: "product" },
      page: { url: "https://protohub.app/tiktok-verify" }
    }]
  };
  if (testEventCode) (body as any).test_event_code = testEventCode;
  try {
    const res = await fetch(TIKTOK_API_URL, {
      method: "POST",
      headers: { "Access-Token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: `TikTok returned HTTP ${res.status}` };
    if (json?.code !== undefined && json.code !== 0) {
      return { ok: false, message: json?.message || `TikTok error code ${json?.code}` };
    }
    return { ok: true, message: "Connected — TikTok accepted the test event." };
  } catch (error: any) {
    return { ok: false, message: error?.message ?? "Could not reach TikTok." };
  }
}
