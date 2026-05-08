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

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
};

/**
 * Send push notification to a specific user (all their subscriptions).
 * Silently removes stale/expired subscriptions (410 Gone).
 */
export async function sendPushToUser(orgId: string, userId: string, payload: PushPayload): Promise<void> {
  if (!isPushConfigured()) return;

  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("org_id", orgId)
    .eq("user_id", userId);

  if (!subscriptions || subscriptions.length === 0) return;

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
            TTL: 60 * 60,         // 1 hour — drop if undeliverable that long
            urgency: "high",      // bypass FCM coalescing / battery delays
            topic: "protohub-evt" // collapse repeated alerts for same device
          }
        );
      } catch (err: any) {
        // 410 Gone or 404 = subscription expired, remove it
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
        throw err;
      }
    })
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.warn(`[push] ${failed}/${subscriptions.length} push deliveries failed for user ${userId}`);
  }
}

/**
 * Send push notification to multiple users.
 */
export async function sendPushToUsers(orgId: string, userIds: string[], payload: PushPayload): Promise<void> {
  if (!isPushConfigured() || userIds.length === 0) return;
  await Promise.allSettled(userIds.map((uid) => sendPushToUser(orgId, uid, payload)));
}
