import jwt from "jsonwebtoken";
import webpush from "web-push";
import { supabase } from "./supabase.js";

// VAPID config — set these in .env
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? "mailto:admin@protohub.app";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log(`[push] VAPID configured — pubKey length=${VAPID_PUBLIC_KEY.length}, privKey length=${VAPID_PRIVATE_KEY.length}, email=${VAPID_EMAIL}`);
} else {
  console.warn(`[push] VAPID NOT configured — VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY ? `(len ${VAPID_PUBLIC_KEY.length})` : "EMPTY"}, VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY ? `(len ${VAPID_PRIVATE_KEY.length})` : "EMPTY"}, VAPID_EMAIL=${VAPID_EMAIL}`);
}

type FirebaseAccountConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function parseFirebaseAccountConfig(): FirebaseAccountConfig | null {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id.trim(),
          clientEmail: parsed.client_email.trim(),
          privateKey: parsed.private_key.replace(/\\n/g, "\n")
        };
      }
    } catch (error) {
      console.warn("[push] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:", error);
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim() ?? "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim() ?? "";
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return { projectId, clientEmail, privateKey };
}

const FIREBASE_ACCOUNT = parseFirebaseAccountConfig();
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

if (FIREBASE_ACCOUNT) {
  console.log(`[push] Native FCM configured — project=${FIREBASE_ACCOUNT.projectId}, client=${FIREBASE_ACCOUNT.clientEmail}`);
} else {
  console.warn("[push] Native FCM NOT configured — mobile app push delivery will stay inactive until Firebase service-account env vars are set.");
}

let cachedFcmAccessToken: { token: string; expiresAt: number } | null = null;

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

export function isNativePushConfigured(): boolean {
  return Boolean(FIREBASE_ACCOUNT?.projectId && FIREBASE_ACCOUNT?.clientEmail && FIREBASE_ACCOUNT?.privateKey);
}

export type PushPayload = {
  title: string;
  body: string;
  kind?: string;
  icon?: string;
  badge?: string;
  image?: string;
  url?: string;
  tag?: string;
  color?: string;
  brandName?: string;
  brandLogo?: string;
  requireInteraction?: boolean;
  vibrate?: number[];
  timestamp?: number;
};

export type PushDeliveryStats = {
  attempted: number;
  delivered: number;
  failed: number;
};

type StoredPushSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type StoredNativePushDevice = {
  id: string;
  token: string;
  platform: string;
  provider: string;
  user_id?: string;
};

function pushTopicForPayload(payload: PushPayload): string {
  const raw = payload.tag ?? payload.kind ?? payload.title ?? "protohub";
  const sanitized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
  return sanitized || "protohub";
}

function pushPayloadData(payload: PushPayload): Record<string, string> {
  const data: Record<string, string> = {};
  const assign = (key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      data[key] = JSON.stringify(value);
      return;
    }
    data[key] = String(value);
  };

  assign("kind", payload.kind);
  assign("icon", payload.icon);
  assign("badge", payload.badge);
  assign("image", payload.image);
  assign("url", payload.url);
  assign("tag", payload.tag);
  assign("color", payload.color);
  assign("brandName", payload.brandName);
  assign("brandLogo", payload.brandLogo);
  assign("requireInteraction", payload.requireInteraction);
  assign("vibrate", payload.vibrate);
  assign("timestamp", payload.timestamp);

  return data;
}

function nativePushShouldPrune(status: number, errorText: string): boolean {
  if (status === 404 || status === 410) return true;
  return (
    errorText.includes("unregistered") ||
    errorText.includes("registration-token-not-registered") ||
    errorText.includes("requested entity was not found")
  );
}

async function getFcmAccessToken(): Promise<string> {
  if (!FIREBASE_ACCOUNT) {
    throw new Error("Native push is not configured on this server yet.");
  }

  if (cachedFcmAccessToken && cachedFcmAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedFcmAccessToken.token;
  }

  const assertion = jwt.sign(
    {
      iss: FIREBASE_ACCOUNT.clientEmail,
      sub: FIREBASE_ACCOUNT.clientEmail,
      aud: "https://oauth2.googleapis.com/token",
      scope: FCM_SCOPE
    },
    FIREBASE_ACCOUNT.privateKey,
    {
      algorithm: "RS256",
      expiresIn: "1h"
    }
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const data = await res.json().catch(() => null) as { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
  if (!res.ok || !data?.access_token) {
    throw new Error(data?.error_description ?? data?.error ?? "Failed to obtain Firebase access token.");
  }

  cachedFcmAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 120) * 1000
  };

  return cachedFcmAccessToken.token;
}

async function getActiveUserIdsByRoles(orgId: string, roles: string[]): Promise<string[]> {
  if (roles.length === 0) return [];
  const { data: users } = await supabase
    .from("users")
    .select("id")
    .eq("org_id", orgId)
    .eq("active", true)
    .in("role", roles);
  return [...new Set((users ?? []).map((user) => user.id))];
}

/**
 * Send push notification to a set of stored subscriptions.
 * Silently removes stale/expired subscriptions (410 Gone).
 */
export async function sendPushToSubscriptions(
  subscriptions: StoredPushSubscription[] | null | undefined,
  payload: PushPayload,
  logLabel = "subscriptions"
): Promise<PushDeliveryStats> {
  if (!isPushConfigured()) return { attempted: 0, delivered: 0, failed: 0 };
  if (!subscriptions || subscriptions.length === 0) return { attempted: 0, delivered: 0, failed: 0 };

  const message = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const endpointHost = (() => {
        try { return new URL(sub.endpoint).host; } catch { return "unknown"; }
      })();
      try {
        const sendResult = await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
          message,
          {
            // FCM/Mozilla/Apple drop the message silently if TTL elapses
            // before the device wakes. Samsung One UI's Adaptive Battery
            // can keep a device in deep doze for hours; the previous
            // 1-hour TTL meant pushes were silently dropped while the
            // phone was asleep. 28 days (= 2419200s) is FCM's maximum;
            // urgency:high asks the push service to wake the device.
            // Topic header intentionally omitted — it triggers FCM
            // collapse/replace behavior that can drop pushes when
            // multiple share a topic, and the comparison app
            // (ordellocrm) doesn't send one.
            TTL: 28 * 24 * 60 * 60,
            urgency: "high"
          }
        );
        // Verbose logging — every attempt prints the push-service response so
        // we can see whether FCM/Mozilla/Apple actually accepted the push.
        // statusCode is what the push service returned (201 = accepted, 410
        // = gone, 403 = vapid mismatch, etc.). body is any error detail.
        console.log(
          `[push] OK label=${logLabel} sub=${sub.id} host=${endpointHost} ` +
          `status=${sendResult?.statusCode ?? "?"} ` +
          `body=${(sendResult?.body ?? "").toString().slice(0, 200)}`
        );
      } catch (err: any) {
        const body = typeof err?.body === "string" ? err.body : "";
        const bodyLower = body.toLowerCase();
        const vapidMismatch = err?.statusCode === 403 && bodyLower.includes("vapid credentials");
        console.error(
          `[push] FAIL label=${logLabel} sub=${sub.id} host=${endpointHost} ` +
          `status=${err?.statusCode ?? "?"} ` +
          `name=${err?.name ?? "?"} ` +
          `message=${(err?.message ?? "").toString().slice(0, 300)} ` +
          `body=${body.slice(0, 300)}`
        );
        if (err.statusCode === 410 || err.statusCode === 404 || vapidMismatch) {
          console.warn(`[push] cleaning up stale/mismatch subscription sub=${sub.id} reason=${err.statusCode}${vapidMismatch ? "/vapid" : ""}`);
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
        throw err;
      }
    })
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  const attempted = subscriptions.length;
  const delivered = attempted - failed;
  if (failed > 0) {
    console.warn(`[push] ${failed}/${subscriptions.length} web push deliveries failed for ${logLabel}`);
  } else {
    console.log(`[push] ${delivered}/${attempted} web push deliveries accepted by push service for ${logLabel}`);
  }
  return { attempted, delivered, failed };
}

// Per-event accent colour — FCM tints the brand status-bar small icon + the app
// name with this, giving each notification type its own recognisable premium look.
const NOTIFICATION_ACCENT: Record<string, string> = {
  order_new: "#1F8FE0",        // blue
  order_assigned: "#1F8FE0",   // blue
  order_confirmed: "#0EA5A4",  // teal
  order_delivered: "#16A34A",  // green
  order_failed: "#DC2626",     // red
  order_cancelled: "#DC2626",  // red
  order_rescheduled: "#F59E0B",// amber
  order_follow_up: "#7C3AED",  // violet
  abandoned_cart_new: "#F59E0B", // amber
  low_stock: "#EA580C",        // orange
  remittance_overdue: "#DC2626" // red
};
const DEFAULT_ACCENT = "#1F8FE0";
const accentForKind = (kind?: string): string => (kind && NOTIFICATION_ACCENT[kind]) || DEFAULT_ACCENT;

// Brand logo shown as the notification image. FCM must be able to DOWNLOAD it, so a
// relative per-org logo path (/api/public/branding/...) is made absolute against the
// backend's public URL; falls back to the committed brand asset served by the web CDN.
const PUBLIC_BACKEND_URL = (process.env.PUBLIC_BACKEND_URL || "https://protohub-production.up.railway.app").replace(/\/+$/, "");
const DEFAULT_BRAND_IMAGE = "https://protohub-zeta.vercel.app/brand/company-logo.png";
const brandPushImage = (brandLogo?: string): string => {
  if (brandLogo && /^https?:\/\//i.test(brandLogo)) return brandLogo;
  if (brandLogo && brandLogo.startsWith("/")) return PUBLIC_BACKEND_URL + brandLogo;
  return DEFAULT_BRAND_IMAGE;
};

// Per-event monochrome status-bar glyph (a drawable baked into the app by
// scripts/gen-android-icons.mjs). Unmapped kinds — or a name an older installed
// app doesn't have — safely fall back to the manifest default (ic_stat_notify,
// the brand diamond), so this never breaks notification delivery.
const NATIVE_ICON: Record<string, string> = {
  order_new: "ic_stat_order_new",
  order_assigned: "ic_stat_order_assigned",
  order_confirmed: "ic_stat_order_confirmed",
  order_delivered: "ic_stat_order_delivered",
  order_cancelled: "ic_stat_order_cancelled",
  order_failed: "ic_stat_order_failed",
  order_rescheduled: "ic_stat_order_rescheduled",
  low_stock: "ic_stat_low_stock",
  remittance_overdue: "ic_stat_remittance_overdue",
  abandoned_cart_new: "ic_stat_stale_carts",
  waybill_dispatched: "ic_stat_waybill",
  waybill_updated: "ic_stat_waybill",
  waybill_status_changed: "ic_stat_waybill",
  info: "ic_stat_info"
};
const nativeIconForKind = (kind?: string): string | undefined => (kind ? NATIVE_ICON[kind] : undefined);

export async function sendNativePushToDevices(
  devices: StoredNativePushDevice[] | null | undefined,
  payload: PushPayload,
  logLabel = "native devices"
): Promise<PushDeliveryStats> {
  if (!isNativePushConfigured()) return { attempted: 0, delivered: 0, failed: 0 };
  if (!devices || devices.length === 0) return { attempted: 0, delivered: 0, failed: 0 };

  const fcmDevices = devices.filter((device) => device.provider === "fcm");
  if (fcmDevices.length === 0) return { attempted: 0, delivered: 0, failed: 0 };

  const accessToken = await getFcmAccessToken();
  const data = pushPayloadData(payload);

  const results = await Promise.allSettled(
    fcmDevices.map(async (device) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FIREBASE_ACCOUNT!.projectId}/messages:send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: {
            token: device.token,
            notification: {
              title: payload.title,
              body: payload.body
            },
            data,
            android: {
              priority: "high",
              notification: {
                // MUST match the channel the app registers in src/lib/native-push.ts
                // (createChannel id "protohub-alerts", importance MAX). Posting to a
                // non-existent channel ("default") makes Android 8+ route the push to a
                // silent fallback channel or drop it — FCM still returns 200, so it
                // looks "delivered" while the phone shows nothing.
                channelId: "protohub-alerts",
                tag: payload.tag,
                // Per-event status-bar glyph + accent colour (tints it) + the brand
                // logo as the image — premium, recognisable per notification type.
                icon: nativeIconForKind(payload.kind),
                color: accentForKind(payload.kind),
                image: payload.image ?? brandPushImage(payload.brandLogo)
              }
            },
            apns: {
              headers: {
                "apns-priority": "10"
              },
              payload: {
                aps: {
                  sound: "default"
                }
              }
            }
          }
        })
      });

      if (!res.ok) {
        const text = await res.text();
        const lowered = text.toLowerCase();
        if (nativePushShouldPrune(res.status, lowered)) {
          await supabase.from("native_push_devices").delete().eq("id", device.id);
        }
        throw new Error(text || `Native push failed with status ${res.status}`);
      }
    })
  );

  const failed = results.filter((result) => result.status === "rejected").length;
  const attempted = fcmDevices.length;
  const delivered = attempted - failed;
  if (failed > 0) {
    console.warn(`[push] ${failed}/${attempted} native push deliveries failed for ${logLabel}`);
  }
  return { attempted, delivered, failed };
}

/**
 * Send push notification to a specific user across web + native registrations.
 */
export async function sendPushToUser(orgId: string, userId: string, payload: PushPayload): Promise<PushDeliveryStats> {
  const [webRows, nativeRows] = await Promise.all([
    isPushConfigured()
      ? supabase
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth")
          .eq("org_id", orgId)
          .eq("user_id", userId)
      : Promise.resolve({ data: [] as StoredPushSubscription[] }),
    supabase
      .from("native_push_devices")
      .select("id, token, platform, provider, user_id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .is("disabled_at", null)
  ]);

  const [webStats, nativeStats] = await Promise.all([
    sendPushToSubscriptions(webRows.data as StoredPushSubscription[] | null | undefined, payload, `user ${userId}`),
    sendNativePushToDevices(nativeRows.data as StoredNativePushDevice[] | null | undefined, payload, `user ${userId}`)
  ]);

  return {
    attempted: webStats.attempted + nativeStats.attempted,
    delivered: webStats.delivered + nativeStats.delivered,
    failed: webStats.failed + nativeStats.failed
  };
}

export async function sendPushToUsers(orgId: string, userIds: string[], payload: PushPayload): Promise<PushDeliveryStats> {
  if (userIds.length === 0) return { attempted: 0, delivered: 0, failed: 0 };
  const results = await Promise.allSettled(userIds.map((uid) => sendPushToUser(orgId, uid, payload)));
  return results.reduce<PushDeliveryStats>((acc, result) => {
    if (result.status === "fulfilled") {
      acc.attempted += result.value.attempted;
      acc.delivered += result.value.delivered;
      acc.failed += result.value.failed;
    } else {
      acc.failed += 1;
    }
    return acc;
  }, { attempted: 0, delivered: 0, failed: 0 });
}

export async function sendPushToRoles(orgId: string, roles: string[], payload: PushPayload): Promise<PushDeliveryStats> {
  if (roles.length === 0) return { attempted: 0, delivered: 0, failed: 0 };
  const userIds = await getActiveUserIdsByRoles(orgId, roles);
  if (userIds.length === 0) return { attempted: 0, delivered: 0, failed: 0 };
  return sendPushToUsers(orgId, userIds, payload);
}
