import { Capacitor } from "@capacitor/core";
import {
  PushNotifications,
  type ActionPerformed,
  type PushNotificationSchema
} from "@capacitor/push-notifications";
import { auth } from "./auth";

const BASE = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:4000";
const TOKEN_STORAGE_KEY = "protohub.nativePushToken";

type NativePushRegisterOptions = {
  replaceOthers?: boolean;
};

type NativePushBridgeOptions = {
  onAction?: (notification: ActionPerformed) => void;
  onReceive?: (notification: PushNotificationSchema) => void;
  onToken?: (token: string) => void;
  onError?: (message: string) => void;
};

const isNativePlatform = Capacitor.isNativePlatform();
const nativePlatform = Capacitor.getPlatform();

let listenersReady = false;
let bridgeOptions: NativePushBridgeOptions = {};
let pendingRegistration:
  | {
      resolve: (token: string) => void;
      reject: (error: Error) => void;
      timeoutId: number;
    }
  | null = null;

function getAuthHeaders(): Record<string, string> {
  const token = auth.getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function setCachedToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage issues on restricted devices.
  }
}

function clearCachedToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage issues on restricted devices.
  }
}

export function getCachedNativePushToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function resolvePendingRegistration(token: string): void {
  if (!pendingRegistration) return;
  window.clearTimeout(pendingRegistration.timeoutId);
  pendingRegistration.resolve(token);
  pendingRegistration = null;
}

function rejectPendingRegistration(error: Error): void {
  if (!pendingRegistration) return;
  window.clearTimeout(pendingRegistration.timeoutId);
  pendingRegistration.reject(error);
  pendingRegistration = null;
}

async function saveNativeToken(token: string, options: NativePushRegisterOptions = {}): Promise<void> {
  const res = await fetch(`${BASE}/api/push/native/register`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      token,
      platform: nativePlatform,
      replaceOthers: options.replaceOthers === true,
      appId: Capacitor.getPlatform() === "ios" ? "ios-shell" : "android-shell"
    })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to save native push token." }));
    throw new Error(data.error ?? "Failed to save native push token.");
  }
}

async function removeNativeToken(token?: string | null): Promise<void> {
  await fetch(`${BASE}/api/push/native/register`, {
    method: "DELETE",
    headers: getAuthHeaders(),
    body: JSON.stringify(token ? { token } : {})
  }).catch(() => undefined);
}

async function registerAndWaitForToken(): Promise<string> {
  const cachedBeforeRegister = getCachedNativePushToken();
  return new Promise<string>((resolve, reject) => {
    if (pendingRegistration) {
      rejectPendingRegistration(new Error("Native push registration was superseded by a newer request."));
    }

    pendingRegistration = {
      resolve,
      reject,
      timeoutId: window.setTimeout(() => {
        const cached = getCachedNativePushToken() ?? cachedBeforeRegister;
        if (cached) {
          resolvePendingRegistration(cached);
          return;
        }
        rejectPendingRegistration(new Error("Push registration token was not returned by the device in time."));
      }, 12000)
    };

    PushNotifications.register().catch((error) => {
      rejectPendingRegistration(
        new Error(typeof error === "string" ? error : error?.message ?? "Failed to register for native push.")
      );
    });
  });
}

export async function initializeNativePushBridge(options: NativePushBridgeOptions = {}): Promise<void> {
  if (!isNativePlatform) return;
  bridgeOptions = { ...bridgeOptions, ...options };
  if (listenersReady) return;
  listenersReady = true;

  await PushNotifications.addListener("registration", (token) => {
    setCachedToken(token.value);
    bridgeOptions.onToken?.(token.value);
    resolvePendingRegistration(token.value);
  });

  await PushNotifications.addListener("registrationError", (error) => {
    const message = typeof error?.error === "string" ? error.error : "Native push registration failed.";
    bridgeOptions.onError?.(message);
    rejectPendingRegistration(new Error(message));
  });

  await PushNotifications.addListener("pushNotificationReceived", (notification) => {
    bridgeOptions.onReceive?.(notification);
  });

  await PushNotifications.addListener("pushNotificationActionPerformed", (notification) => {
    bridgeOptions.onAction?.(notification);
  });

  if (nativePlatform === "android") {
    await PushNotifications.createChannel({
      id: "protohub-alerts",
      name: "Protohub Alerts",
      description: "Orders, deliveries, stock, and operational alerts",
      importance: 5,
      visibility: 1,
      sound: "default"
    }).catch(() => undefined);
  }
}

export async function getNativePushPermissionState(): Promise<NotificationPermission | "unsupported"> {
  if (!isNativePlatform) return "unsupported";
  const status = await PushNotifications.checkPermissions();
  if (status.receive === "granted") return "granted";
  if (status.receive === "denied") return "denied";
  return "default";
}

export async function ensureNativePushRegistrationCurrent(
  options: NativePushRegisterOptions = {}
): Promise<boolean> {
  if (!isNativePlatform) return false;
  await initializeNativePushBridge();

  const permission = await PushNotifications.checkPermissions();
  if (permission.receive !== "granted") {
    return false;
  }

  const cachedToken = getCachedNativePushToken();
  if (cachedToken) {
    await saveNativeToken(cachedToken, options).catch(() => undefined);
  }

  const token = await registerAndWaitForToken().catch(() => cachedToken);
  if (!token) return false;

  await saveNativeToken(token, options);
  return true;
}

export async function subscribeToNativePush(options: NativePushRegisterOptions = {}): Promise<boolean> {
  if (!isNativePlatform) {
    throw new Error("Native push is only available inside the mobile app shell.");
  }

  await initializeNativePushBridge();

  let permission = await PushNotifications.checkPermissions();
  if (permission.receive !== "granted") {
    permission = await PushNotifications.requestPermissions();
  }

  if (permission.receive !== "granted") {
    throw new Error("Notification permission denied. Please enable it in device settings.");
  }

  const token = await registerAndWaitForToken();
  await saveNativeToken(token, options);
  return true;
}

export async function unsubscribeFromNativePush(): Promise<boolean> {
  if (!isNativePlatform) return false;

  const token = getCachedNativePushToken();
  await removeNativeToken(token);
  clearCachedToken();

  await PushNotifications.unregister().catch(() => undefined);
  await PushNotifications.removeAllDeliveredNotifications().catch(() => undefined);
  return true;
}
