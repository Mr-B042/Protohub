import { App as CapacitorApp } from "@capacitor/app";
import { PushNotifications, type PushNotificationSchema } from "@capacitor/push-notifications";
import { auth } from "./auth";
import { isNativeShell, nativePlatform } from "./native-shell";

const BASE = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:4000";
const SERVICE_WORKER_SCOPE = "/";
const SERVICE_WORKER_URL = "/sw.js";
const NATIVE_PUSH_TOKEN_KEY = "protohub.nativePushToken";
const NATIVE_PUSH_DEVICE_ID_KEY = "protohub.nativePushDeviceId";

type SaveSubscriptionOptions = {
  replaceOthers?: boolean;
};

export type PushStatusResponse = {
  subscribed: boolean;
  count: number;
  configured: boolean;
  nativeConfigured?: boolean;
  subscriptions: Array<{ id: string; endpoint: string; createdAt: string; host: string }>;
  nativeDevices?: Array<{
    id: string;
    token: string;
    tokenPreview: string;
    platform: string;
    provider: string;
    deviceName?: string | null;
    createdAt: string;
    lastSeenAt?: string | null;
  }>;
};

function getAuthHeaders(): Record<string, string> {
  const token = auth.getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function getNativePushDeviceId(): string {
  if (typeof window === "undefined") {
    return "native-device";
  }
  const existing = window.localStorage.getItem(NATIVE_PUSH_DEVICE_ID_KEY);
  if (existing) return existing;
  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `native-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  window.localStorage.setItem(NATIVE_PUSH_DEVICE_ID_KEY, generated);
  return generated;
}

function getStoredNativePushToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(NATIVE_PUSH_TOKEN_KEY);
}

function setStoredNativePushToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (!token) {
    window.localStorage.removeItem(NATIVE_PUSH_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(NATIVE_PUSH_TOKEN_KEY, token);
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
  if (isNativeShell || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
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

async function saveWebSubscription(subscription: PushSubscription, options: SaveSubscriptionOptions = {}): Promise<void> {
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

async function saveNativePushDevice(token: string, options: SaveSubscriptionOptions = {}): Promise<void> {
  const appInfo = await CapacitorApp.getInfo().catch(() => null);
  const res = await fetch(`${BASE}/api/push/native/subscribe`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      token,
      platform: nativePlatform === "ios" ? "ios" : "android",
      provider: nativePlatform === "ios" ? "apns" : "fcm",
      deviceId: getNativePushDeviceId(),
      deviceName: nativePlatform === "ios" ? "iPhone / iPad" : "Android device",
      appId: appInfo?.id,
      appVersion: appInfo?.version,
      replaceOthers: options.replaceOthers === true
    })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to save native device" }));
    throw new Error(data.error ?? "Failed to save native device");
  }
}

let nativeListenersReady = false;
let nativeRegistrationPromise:
  | {
      promise: Promise<string>;
      resolve: (token: string) => void;
      reject: (error: Error) => void;
      timeout: number;
    }
  | null = null;

function resolveNativeRegistration(token: string) {
  setStoredNativePushToken(token);
  window.dispatchEvent(new CustomEvent("protohub:native-push-token", { detail: token }));
  if (!nativeRegistrationPromise) return;
  window.clearTimeout(nativeRegistrationPromise.timeout);
  nativeRegistrationPromise.resolve(token);
  nativeRegistrationPromise = null;
}

function rejectNativeRegistration(error: Error) {
  if (!nativeRegistrationPromise) return;
  window.clearTimeout(nativeRegistrationPromise.timeout);
  nativeRegistrationPromise.reject(error);
  nativeRegistrationPromise = null;
}

function createNativeRegistrationPromise(): Promise<string> {
  if (nativeRegistrationPromise) {
    return nativeRegistrationPromise.promise;
  }

  let resolveFn!: (token: string) => void;
  let rejectFn!: (error: Error) => void;
  const promise = new Promise<string>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  const timeout = window.setTimeout(() => {
    rejectNativeRegistration(new Error("Native push registration timed out. Please try again."));
  }, 15000);

  nativeRegistrationPromise = {
    promise,
    resolve: resolveFn,
    reject: rejectFn,
    timeout
  };
  return promise;
}

function notificationUrlFromData(data: Record<string, any> | undefined): string | null {
  const raw = data?.url ?? data?.link ?? data?.route ?? null;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function normalizeNativePermissionState(permission: { receive?: string } | null | undefined): NotificationPermission | "unsupported" {
  const receive = permission?.receive ?? "prompt";
  if (receive === "granted") return "granted";
  if (receive === "denied") return "denied";
  return "default";
}

async function ensureNativePushListeners(): Promise<void> {
  if (!isNativeShell || nativeListenersReady) return;
  nativeListenersReady = true;

  await PushNotifications.addListener("registration", async (token) => {
    setStoredNativePushToken(token.value);
    resolveNativeRegistration(token.value);
    if (auth.isLoggedIn()) {
      await saveNativePushDevice(token.value).catch(() => undefined);
    }
  });

  await PushNotifications.addListener("registrationError", (error) => {
    rejectNativeRegistration(new Error(error?.error ?? "Native push registration failed."));
  });

  await PushNotifications.addListener("pushNotificationActionPerformed", (event) => {
    const url = notificationUrlFromData(event.notification?.data as Record<string, any> | undefined);
    if (url && typeof window !== "undefined") {
      window.location.hash = url;
    }
  });

  await PushNotifications.addListener("pushNotificationReceived", (_notification: PushNotificationSchema) => {
    // Keep the listener attached so native registration remains active.
  });
}

async function getNativePermissionState(): Promise<NotificationPermission | "unsupported"> {
  if (!isNativeShell) return "unsupported";
  const permissions = await PushNotifications.checkPermissions().catch(() => null);
  return normalizeNativePermissionState(permissions);
}

async function syncNativePushIfPossible(options: SaveSubscriptionOptions = {}): Promise<boolean> {
  if (!isNativeShell) return false;
  await ensureNativePushListeners();
  const permission = await getNativePermissionState();
  if (permission !== "granted") {
    return false;
  }

  const token = getStoredNativePushToken();
  if (token) {
    await saveNativePushDevice(token, options).catch(() => undefined);
  }

  const waitForToken = createNativeRegistrationPromise();
  await PushNotifications.register().catch((error) => {
    rejectNativeRegistration(new Error(error?.message ?? "Native push registration failed."));
  });
  const registeredToken = await waitForToken;
  await saveNativePushDevice(registeredToken, options);
  return true;
}

export async function initializeNativePushBridge(): Promise<void> {
  if (!isNativeShell) return;
  await ensureNativePushListeners();
  const permission = await getNativePermissionState();
  if (permission === "granted") {
    await syncNativePushIfPossible().catch(() => undefined);
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

export async function getPushStatus(): Promise<PushStatusResponse> {
  try {
    const res = await fetch(`${BASE}/api/push/status`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      return { subscribed: false, count: 0, configured: false, nativeConfigured: false, subscriptions: [], nativeDevices: [] };
    }
    return await res.json();
  } catch {
    return { subscribed: false, count: 0, configured: false, nativeConfigured: false, subscriptions: [], nativeDevices: [] };
  }
}

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

async function removeNativePushDevice(token: string | null): Promise<void> {
  await fetch(`${BASE}/api/push/native/subscribe`, {
    method: "DELETE",
    headers: getAuthHeaders(),
    body: JSON.stringify(token ? { token } : {})
  }).catch(() => undefined);
}

export async function ensurePushSubscriptionCurrent(options: SaveSubscriptionOptions = {}): Promise<boolean> {
  if (isNativeShell) {
    return syncNativePushIfPossible(options);
  }
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

  await saveWebSubscription(subscription, options);
  return true;
}

export async function subscribeToPush(options: SaveSubscriptionOptions = {}): Promise<boolean> {
  if (isNativeShell) {
    await ensureNativePushListeners();
    const existing = await PushNotifications.checkPermissions().catch(() => null);
    const current = normalizeNativePermissionState(existing);
    if (current !== "granted") {
      const requested = await PushNotifications.requestPermissions();
      const requestedState = normalizeNativePermissionState(requested);
      if (requestedState !== "granted") {
        throw new Error("Notification permission denied. Please enable it in app settings.");
      }
    }
    return syncNativePushIfPossible(options);
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push notifications are not supported in this browser.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission denied. Please enable it in browser settings.");
  }

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

export async function unsubscribeFromPush(): Promise<boolean> {
  if (isNativeShell) {
    const token = getStoredNativePushToken();
    if (token) {
      await removeNativePushDevice(token);
    }
    setStoredNativePushToken(null);
    return true;
  }

  if (!("serviceWorker" in navigator)) return false;

  const registration = await ensureServiceWorkerRegistration();
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    await subscription.unsubscribe();
    await removeServerSubscription(subscription.endpoint);
  }

  return true;
}

export async function sendTestPush(body?: { title?: string; body?: string }): Promise<{ message: string }> {
  const nativeToken = isNativeShell ? getStoredNativePushToken() : null;
  const endpoint = !isNativeShell ? await getCurrentPushEndpoint() : null;
  const res = await fetch(`${BASE}/api/push/test`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      ...(body ?? {}),
      ...(endpoint ? { endpoint } : {}),
      ...(nativeToken ? { nativeToken } : {})
    })
  });
  const data = await res.json().catch(() => ({ error: "Failed to send test push." }));
  if (!res.ok) {
    throw new Error(data.error ?? "Failed to send test push.");
  }
  return data;
}

export async function isCurrentlySubscribed(): Promise<boolean> {
  if (isNativeShell) {
    const permission = await getNativePermissionState();
    return permission === "granted" && Boolean(getStoredNativePushToken());
  }
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
  if (isNativeShell) {
    return getStoredNativePushToken();
  }
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

export async function getPermissionState(): Promise<NotificationPermission | "unsupported"> {
  if (isNativeShell) {
    return getNativePermissionState();
  }
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}
