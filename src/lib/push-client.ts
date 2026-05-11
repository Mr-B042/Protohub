// Push notification client-side helpers
import { auth } from "./auth";

const BASE = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:4000";
const SERVICE_WORKER_SCOPE = "/";
const SERVICE_WORKER_URL = "/sw.js";

function getAuthHeaders(): Record<string, string> {
  const token = auth.getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function waitForActivatedRegistration(registration: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> {
  if (registration.active?.state === "activated") {
    return registration;
  }

  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) {
    return navigator.serviceWorker.ready;
  }

  if (worker.state === "activated") {
    return registration;
  }

  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      worker.removeEventListener("statechange", handleStateChange);
      resolve();
    }, 10000);

    const handleStateChange = () => {
      if (worker.state === "activated" || worker.state === "redundant") {
        window.clearTimeout(timeout);
        worker.removeEventListener("statechange", handleStateChange);
        resolve();
      }
    };

    worker.addEventListener("statechange", handleStateChange);
  });

  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return registration;
  }
}

export async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    let registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);
    if (!registration) {
      registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
        scope: SERVICE_WORKER_SCOPE,
        updateViaCache: "none"
      });
    }

    await registration.update().catch(() => undefined);
    return waitForActivatedRegistration(registration);
  } catch {
    return null;
  }
}

type SaveSubscriptionOptions = {
  replaceOthers?: boolean;
};

async function saveSubscription(subscription: PushSubscription, options: SaveSubscriptionOptions = {}): Promise<void> {
  const subJson = subscription.toJSON();
  const res = await fetch(`${BASE}/api/push/subscribe`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: {
        p256dh: subJson.keys?.p256dh,
        auth: subJson.keys?.auth
      },
      replaceOthers: options.replaceOthers === true
    })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to save subscription" }));
    throw new Error(data.error ?? "Failed to save subscription");
  }
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
export async function getPushStatus(): Promise<{
  subscribed: boolean;
  count: number;
  configured: boolean;
  subscriptions: Array<{ id: string; endpoint: string; createdAt: string; host: string }>;
}> {
  try {
    const res = await fetch(`${BASE}/api/push/status`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) return { subscribed: false, count: 0, configured: false, subscriptions: [] };
    return await res.json();
  } catch {
    return { subscribed: false, count: 0, configured: false, subscriptions: [] };
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

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function getSubscriptionServerKey(subscription: PushSubscription): Uint8Array | null {
  try {
    const rawKey = subscription.options?.applicationServerKey;
    if (!rawKey) return null;
    if (rawKey instanceof ArrayBuffer) return new Uint8Array(rawKey);
    if (ArrayBuffer.isView(rawKey)) {
      const view = rawKey as ArrayBufferView;
      return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    }
    return null;
  } catch {
    return null;
  }
}

async function removeServerSubscription(endpoint: string): Promise<void> {
  await fetch(`${BASE}/api/push/subscribe`, {
    method: "DELETE",
    headers: getAuthHeaders(),
    body: JSON.stringify({ endpoint })
  }).catch(() => undefined);
}

export async function ensurePushSubscriptionCurrent(options: SaveSubscriptionOptions = {}): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return false;
  }

  if (Notification.permission !== "granted") {
    return false;
  }

  const registration = await ensureServiceWorkerRegistration();
  if (!registration) return false;
  const vapidKey = await getVapidPublicKey();
  if (!vapidKey) return false;
  const desiredKey = urlBase64ToUint8Array(vapidKey);

  let subscription = await registration.pushManager.getSubscription();
  const staleEndpoint = subscription?.endpoint ?? null;
  const currentKey = subscription ? getSubscriptionServerKey(subscription) : null;
  const keyMismatch = subscription && currentKey && !arraysEqual(currentKey, desiredKey);

  if (subscription && keyMismatch) {
    await subscription.unsubscribe().catch(() => undefined);
    if (staleEndpoint) {
      await removeServerSubscription(staleEndpoint);
    }
    subscription = null;
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: desiredKey as BufferSource
    });
  }

  await saveSubscription(subscription, options);
  return true;
}

/**
 * Subscribe to push notifications.
 * Returns true on success, throws on failure.
 */
export async function subscribeToPush(options: SaveSubscriptionOptions = {}): Promise<boolean> {
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
  const vapidKey = await getVapidPublicKey();
  if (!vapidKey) {
    throw new Error("Push notifications not configured on this server.");
  }

  const registration = await ensureServiceWorkerRegistration();
  if (!registration) {
    throw new Error("Service worker could not be registered on this device.");
  }

  return ensurePushSubscriptionCurrent(options);
}

/**
 * Unsubscribe from push notifications.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;

  const registration = await ensureServiceWorkerRegistration();
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    // Unsubscribe from browser
    await subscription.unsubscribe();

    // Remove from backend
    await removeServerSubscription(subscription.endpoint);
  }

  return true;
}

/**
 * Send a real push notification to the current user for diagnostics.
 */
export async function sendTestPush(body?: { title?: string; body?: string }): Promise<{ message: string }> {
  const endpoint = await getCurrentPushEndpoint();
  const res = await fetch(`${BASE}/api/push/test`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      ...(body ?? {}),
      ...(endpoint ? { endpoint } : {})
    })
  });
  const data = await res.json().catch(() => ({ error: "Failed to send test push." }));
  if (!res.ok) {
    throw new Error(data.error ?? "Failed to send test push.");
  }
  return data;
}

/**
 * Check if currently subscribed (browser-level check).
 */
export async function isCurrentlySubscribed(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const registration = await ensureServiceWorkerRegistration();
    if (!registration) return false;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}

export async function getCurrentPushEndpoint(): Promise<string | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    const registration = await ensureServiceWorkerRegistration();
    if (!registration) return null;
    const subscription = await registration.pushManager.getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
}

/**
 * Get current permission state.
 */
export function getPermissionState(): NotificationPermission | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}
