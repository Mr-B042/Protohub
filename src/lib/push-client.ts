// Push notification client-side helpers
import { auth } from "./auth";

const BASE = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:4000";

function getAuthHeaders(): Record<string, string> {
  const token = auth.getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

/**
 * Fetch the VAPID public key from the backend.
 */
export async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/push/vapid-public-key`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.publicKey ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if the user currently has push subscriptions on the server.
 */
export async function getPushStatus(): Promise<{ subscribed: boolean; count: number }> {
  try {
    const res = await fetch(`${BASE}/api/push/status`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) return { subscribed: false, count: 0 };
    return await res.json();
  } catch {
    return { subscribed: false, count: 0 };
  }
}

/**
 * Convert a base64 URL string to a Uint8Array (needed for applicationServerKey).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Subscribe to push notifications.
 * Returns true on success, throws on failure.
 */
export async function subscribeToPush(): Promise<boolean> {
  // 1. Check browser support
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push notifications are not supported in this browser.");
  }

  // 2. Request notification permission
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission denied. Please enable it in browser settings.");
  }

  // 3. Get service worker registration
  const registration = await navigator.serviceWorker.ready;

  // 4. Get VAPID public key from server
  const vapidKey = await getVapidPublicKey();
  if (!vapidKey) {
    throw new Error("Push notifications not configured on this server.");
  }

  // 5. Subscribe to push
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource
  });

  // 6. Send subscription to backend
  const subJson = subscription.toJSON();
  const res = await fetch(`${BASE}/api/push/subscribe`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: {
        p256dh: subJson.keys?.p256dh,
        auth: subJson.keys?.auth
      }
    })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to save subscription" }));
    throw new Error(data.error ?? "Failed to save subscription");
  }

  return true;
}

/**
 * Unsubscribe from push notifications.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    // Unsubscribe from browser
    await subscription.unsubscribe();

    // Remove from backend
    await fetch(`${BASE}/api/push/subscribe`, {
      method: "DELETE",
      headers: getAuthHeaders(),
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });
  }

  return true;
}

/**
 * Check if currently subscribed (browser-level check).
 */
export async function isCurrentlySubscribed(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}

/**
 * Get current permission state.
 */
export function getPermissionState(): NotificationPermission | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}
