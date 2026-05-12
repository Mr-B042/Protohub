import fs from "node:fs";
import admin from "firebase-admin";
import apn from "apn";
import webpush from "web-push";
import { supabase } from "./supabase.js";

// ── Web Push (VAPID) ──────────────────────────────────────
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? "mailto:admin@protohub.app";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log(
    `[push] web push configured — pubKey length=${VAPID_PUBLIC_KEY.length}, privKey length=${VAPID_PRIVATE_KEY.length}, email=${VAPID_EMAIL}`
  );
} else {
  console.warn(
    `[push] web push not configured — VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY ? `(len ${VAPID_PUBLIC_KEY.length})` : "EMPTY"}, VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY ? `(len ${VAPID_PRIVATE_KEY.length})` : "EMPTY"}, VAPID_EMAIL=${VAPID_EMAIL}`
  );
}

// ── Native Push (Android FCM / iOS APNs) ─────────────────
function readTextFileIfExists(filePath: string): string {
  try {
    return filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8").trim() : "";
  } catch {
    return "";
  }
}

function decodeBase64(value: string): string {
  try {
    return value ? Buffer.from(value, "base64").toString("utf8").trim() : "";
  } catch {
    return "";
  }
}

function normalizeMultilineSecret(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function readSecretValue(raw: string, base64: string, filePath: string): string {
  const fromFile = readTextFileIfExists(filePath);
  if (fromFile) return normalizeMultilineSecret(fromFile);
  const fromBase64 = decodeBase64(base64);
  if (fromBase64) return normalizeMultilineSecret(fromBase64);
  return normalizeMultilineSecret(raw);
}

type FirebaseServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function readFirebaseServiceAccount(): FirebaseServiceAccount | null {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "";
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 ?? "";
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_PATH ?? "";
  const fromFile = readTextFileIfExists(serviceAccountPath);
  const fromBase64 = decodeBase64(serviceAccountBase64);
  const source = fromFile || fromBase64 || serviceAccountRaw;

  if (source) {
    try {
      const parsed = JSON.parse(source);
      return {
        projectId: String(parsed.project_id ?? ""),
        clientEmail: String(parsed.client_email ?? ""),
        privateKey: normalizeMultilineSecret(String(parsed.private_key ?? ""))
      };
    } catch (error: any) {
      console.warn(`[push] failed to parse FIREBASE service account JSON: ${error?.message ?? error}`);
    }
  }

  return null;
}

const firebaseServiceAccount = readFirebaseServiceAccount();
const FIREBASE_PROJECT_ID = firebaseServiceAccount?.projectId || process.env.FIREBASE_PROJECT_ID || "";
const FIREBASE_CLIENT_EMAIL = firebaseServiceAccount?.clientEmail || process.env.FIREBASE_CLIENT_EMAIL || "";
const FIREBASE_PRIVATE_KEY =
  firebaseServiceAccount?.privateKey ||
  readSecretValue(
    process.env.FIREBASE_PRIVATE_KEY ?? "",
    process.env.FIREBASE_PRIVATE_KEY_BASE64 ?? "",
    process.env.FIREBASE_PRIVATE_KEY_PATH ?? ""
  );

const APNS_KEY_ID = process.env.APNS_KEY_ID ?? "";
const APNS_TEAM_ID = process.env.APNS_TEAM_ID ?? "";
const APNS_PRIVATE_KEY = readSecretValue(
  process.env.APNS_PRIVATE_KEY ?? "",
  process.env.APNS_PRIVATE_KEY_BASE64 ?? "",
  process.env.APNS_PRIVATE_KEY_PATH ?? ""
);
const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID ?? "";
const APNS_PRODUCTION =
  /^(1|true|yes)$/i.test(process.env.APNS_PRODUCTION ?? "") ||
  process.env.NODE_ENV === "production";

export type NativePushPlatform = "android" | "ios";

let firebaseMessaging: admin.messaging.Messaging | null = null;
if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
  try {
    const firebaseApp = admin.apps.length
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.cert({
            projectId: FIREBASE_PROJECT_ID,
            clientEmail: FIREBASE_CLIENT_EMAIL,
            privateKey: FIREBASE_PRIVATE_KEY
          })
        });
    firebaseMessaging = firebaseApp.messaging();
    console.log(`[push] firebase messaging configured for project ${FIREBASE_PROJECT_ID}`);
  } catch (error: any) {
    console.warn(`[push] firebase messaging init failed: ${error?.message ?? error}`);
  }
} else {
  console.warn("[push] firebase messaging not configured — Android native push disabled.");
}

let apnsProvider: apn.Provider | null = null;
if (APNS_KEY_ID && APNS_TEAM_ID && APNS_PRIVATE_KEY && APNS_BUNDLE_ID) {
  try {
    apnsProvider = new apn.Provider({
      token: {
        key: APNS_PRIVATE_KEY,
        keyId: APNS_KEY_ID,
        teamId: APNS_TEAM_ID
      },
      production: APNS_PRODUCTION
    });
    console.log(`[push] APNs configured for bundle ${APNS_BUNDLE_ID} (${APNS_PRODUCTION ? "production" : "sandbox"})`);
  } catch (error: any) {
    console.warn(`[push] APNs init failed: ${error?.message ?? error}`);
  }
} else {
  console.warn("[push] APNs not configured — iOS native push disabled.");
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

export function getNativePushConfigStatus(): Record<NativePushPlatform, boolean> {
  return {
    android: Boolean(firebaseMessaging),
    ios: Boolean(apnsProvider)
  };
}

export function isNativePushConfigured(platform?: NativePushPlatform): boolean {
  const status = getNativePushConfigStatus();
  if (platform) return status[platform];
  return status.android || status.ios;
}

export function isAnyPushDeliveryConfigured(): boolean {
  return isPushConfigured() || isNativePushConfigured();
}

type PushPayload = {
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

type StoredNativePushDevice = {
  id: string;
  platform: NativePushPlatform;
  token: string;
};

function pushTopicForPayload(payload: PushPayload): string {
  const raw = payload.tag ?? payload.kind ?? payload.title ?? "protohub";
  const sanitized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
  return sanitized || "protohub";
}

function buildNativeDataPayload(payload: PushPayload): Record<string, string> {
  return {
    title: payload.title,
    body: payload.body,
    ...(payload.kind ? { kind: payload.kind } : {}),
    ...(payload.url ? { url: payload.url } : {}),
    ...(payload.tag ? { tag: payload.tag } : {}),
    ...(payload.icon ? { icon: payload.icon } : {}),
    ...(payload.badge ? { badge: payload.badge } : {}),
    ...(payload.image ? { image: payload.image } : {}),
    ...(payload.color ? { color: payload.color } : {}),
    ...(payload.brandName ? { brandName: payload.brandName } : {}),
    ...(payload.brandLogo ? { brandLogo: payload.brandLogo } : {}),
    ...(typeof payload.requireInteraction === "boolean"
      ? { requireInteraction: String(payload.requireInteraction) }
      : {}),
    ...(payload.vibrate?.length ? { vibrate: JSON.stringify(payload.vibrate) } : {}),
    ...(payload.timestamp ? { timestamp: String(payload.timestamp) } : {})
  };
}

async function removeNativePushDevicesByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await supabase.from("native_push_devices").delete().in("id", ids);
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
 * Send push notification to a set of stored browser subscriptions.
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
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
          message,
          {
            TTL: 60 * 60,
            urgency: "high",
            topic: pushTopicForPayload(payload)
          }
        );
      } catch (err: any) {
        const body = typeof err?.body === "string" ? err.body.toLowerCase() : "";
        const vapidMismatch = err?.statusCode === 403 && body.includes("vapid credentials");
        if (err.statusCode === 410 || err.statusCode === 404 || vapidMismatch) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
        throw err;
      }
    })
  );

  const failed = results.filter((result) => result.status === "rejected").length;
  const attempted = subscriptions.length;
  const delivered = attempted - failed;
  if (failed > 0) {
    console.warn(`[push] ${failed}/${subscriptions.length} web push deliveries failed for ${logLabel}`);
  }
  return { attempted, delivered, failed };
}

async function sendNativeAndroidPush(
  devices: StoredNativePushDevice[],
  payload: PushPayload,
  logLabel: string
): Promise<PushDeliveryStats> {
  if (!firebaseMessaging || devices.length === 0) return { attempted: 0, delivered: 0, failed: 0 };

  try {
    const data = buildNativeDataPayload(payload);
    const batch = await firebaseMessaging.sendEach(
      devices.map((device) => ({
        token: device.token,
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.image ? { imageUrl: payload.image } : {})
        },
        data,
        android: {
          priority: "high",
          notification: {
            channelId: "protohub-alerts",
            sound: "default",
            ...(payload.tag ? { tag: payload.tag } : {}),
            ...(payload.color ? { color: payload.color } : {}),
            clickAction: "PROTOHUB_PUSH_OPEN"
          }
        }
      }))
    );

    const staleIds: string[] = [];
    batch.responses.forEach((response, index) => {
      if (response.success) return;
      const code = response.error?.code ?? "";
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        staleIds.push(devices[index]!.id);
      }
    });
    await removeNativePushDevicesByIds(staleIds);

    if (batch.failureCount > 0) {
      console.warn(`[push] ${batch.failureCount}/${devices.length} Android native push deliveries failed for ${logLabel}`);
    }
    return {
      attempted: devices.length,
      delivered: batch.successCount,
      failed: batch.failureCount
    };
  } catch (error: any) {
    console.warn(`[push] Android native push failed for ${logLabel}: ${error?.message ?? error}`);
    return {
      attempted: devices.length,
      delivered: 0,
      failed: devices.length
    };
  }
}

async function sendNativeIosPush(
  devices: StoredNativePushDevice[],
  payload: PushPayload,
  logLabel: string
): Promise<PushDeliveryStats> {
  if (!apnsProvider || devices.length === 0) return { attempted: 0, delivered: 0, failed: 0 };

  try {
    const note = new apn.Notification();
    note.topic = APNS_BUNDLE_ID;
    note.expiry = Math.floor(Date.now() / 1000) + 3600;
    note.priority = 10;
    note.sound = "default";
    note.alert = {
      title: payload.title,
      body: payload.body
    };
    note.payload = buildNativeDataPayload(payload);
    if (payload.tag) note.threadId = payload.tag;
    if (payload.badge && !Number.isNaN(Number(payload.badge))) {
      note.badge = Number(payload.badge);
    }
    if (payload.image) {
      note.mutableContent = true;
    }

    const response = await apnsProvider.send(note, devices.map((device) => device.token));
    const staleTokens = new Set<string>();
    response.failed.forEach((failure) => {
      const reason = failure.response?.reason ?? "";
      if (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic" || reason === "Unregistered") {
        staleTokens.add(failure.device);
      }
    });
    if (staleTokens.size > 0) {
      await removeNativePushDevicesByIds(
        devices.filter((device) => staleTokens.has(device.token)).map((device) => device.id)
      );
    }

    if (response.failed.length > 0) {
      console.warn(`[push] ${response.failed.length}/${devices.length} iOS native push deliveries failed for ${logLabel}`);
    }
    return {
      attempted: devices.length,
      delivered: response.sent.length,
      failed: response.failed.length
    };
  } catch (error: any) {
    console.warn(`[push] iOS native push failed for ${logLabel}: ${error?.message ?? error}`);
    return {
      attempted: devices.length,
      delivered: 0,
      failed: devices.length
    };
  }
}

export async function sendNativePushToDevices(
  devices: StoredNativePushDevice[] | null | undefined,
  payload: PushPayload,
  logLabel = "native devices"
): Promise<PushDeliveryStats> {
  if (!devices || devices.length === 0) return { attempted: 0, delivered: 0, failed: 0 };

  const androidDevices = devices.filter((device) => device.platform === "android");
  const iosDevices = devices.filter((device) => device.platform === "ios");

  const [androidStats, iosStats] = await Promise.all([
    sendNativeAndroidPush(androidDevices, payload, logLabel),
    sendNativeIosPush(iosDevices, payload, logLabel)
  ]);

  return {
    attempted: androidStats.attempted + iosStats.attempted,
    delivered: androidStats.delivered + iosStats.delivered,
    failed: androidStats.failed + iosStats.failed
  };
}

/**
 * Send push notification to a specific user across web + native channels.
 */
export async function sendPushToUser(orgId: string, userId: string, payload: PushPayload): Promise<PushDeliveryStats> {
  const [webResult, nativeResult] = await Promise.allSettled([
    (async () => {
      const { data: subscriptions } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("org_id", orgId)
        .eq("user_id", userId);
      return sendPushToSubscriptions(
        subscriptions as StoredPushSubscription[] | null | undefined,
        payload,
        `user ${userId} web`
      );
    })(),
    (async () => {
      const { data: devices } = await supabase
        .from("native_push_devices")
        .select("id, platform, token")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .eq("active", true);
      return sendNativePushToDevices(
        devices as StoredNativePushDevice[] | null | undefined,
        payload,
        `user ${userId} native`
      );
    })()
  ]);

  return {
    attempted:
      (webResult.status === "fulfilled" ? webResult.value.attempted : 0) +
      (nativeResult.status === "fulfilled" ? nativeResult.value.attempted : 0),
    delivered:
      (webResult.status === "fulfilled" ? webResult.value.delivered : 0) +
      (nativeResult.status === "fulfilled" ? nativeResult.value.delivered : 0),
    failed:
      (webResult.status === "fulfilled" ? webResult.value.failed : 1) +
      (nativeResult.status === "fulfilled" ? nativeResult.value.failed : 1)
  };
}

/**
 * Send push notification to multiple users.
 */
export async function sendPushToUsers(orgId: string, userIds: string[], payload: PushPayload): Promise<PushDeliveryStats> {
  if (userIds.length === 0) return { attempted: 0, delivered: 0, failed: 0 };
  const results = await Promise.allSettled(userIds.map((userId) => sendPushToUser(orgId, userId, payload)));
  return results.reduce<PushDeliveryStats>(
    (acc, result) => {
      if (result.status === "fulfilled") {
        acc.attempted += result.value.attempted;
        acc.delivered += result.value.delivered;
        acc.failed += result.value.failed;
      } else {
        acc.failed += 1;
      }
      return acc;
    },
    { attempted: 0, delivered: 0, failed: 0 }
  );
}

/**
 * Send push notifications to all active users in the given roles.
 */
export async function sendPushToRoles(orgId: string, roles: string[], payload: PushPayload): Promise<PushDeliveryStats> {
  if (roles.length === 0) return { attempted: 0, delivered: 0, failed: 0 };
  const userIds = await getActiveUserIdsByRoles(orgId, roles);
  if (userIds.length === 0) return { attempted: 0, delivered: 0, failed: 0 };
  return sendPushToUsers(orgId, userIds, payload);
}
