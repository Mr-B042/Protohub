// ProtoHub API client
// All requests go through `request()` which attaches the Bearer token
// and auto-refreshes if the token has expired (401).

import { auth } from "./auth";
import { fetchWithApiFailover } from "./backend-origin";
import { snakeToCamel } from "./normalize";
const TRANSIENT_RETRYABLE_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_GET_RETRY_LIMIT = 2;
const PRE_REQUEST_REFRESH_SKEW_MS = 5 * 60 * 1000;
const BACKGROUND_REFRESH_SKEW_MS = 10 * 60 * 1000;
const AUTH_REFRESH_LOCK_KEY = "protohub.authRefreshLock";
const AUTH_REFRESH_LOCK_TTL_MS = 15_000;
const AUTH_REFRESH_LOCK_WAIT_MS = 12_000;
const AUTH_REFRESH_LOCK_POLL_MS = 250;
const INVALID_REFRESH_GRACE_MS = 90_000;
const REFRESH_LOCK_OWNER = `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

type AuthRefreshResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "invalid" | "transient"; status?: number; message?: string };

let refreshInFlight: Promise<AuthRefreshResult> | null = null;

const toSnakeKey = (key: string) =>
  key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

const normalizeBooleanMapKeys = (value: unknown): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[toSnakeKey(key)] = !!entry;
  }
  return out;
};

const normalizeTemplateMapKeys = <T extends Record<string, unknown>>(value: unknown): Record<string, T> => {
  const out: Record<string, T> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry && typeof entry === "object") {
      out[toSnakeKey(key)] = entry as T;
    }
  }
  return out;
};

const normalizeEmailSettingsResponse = (value: any) => ({
  ...value,
  triggers: normalizeBooleanMapKeys(value?.triggers),
  templates: normalizeTemplateMapKeys<{ subject: string; body: string }>(value?.templates)
});

const normalizeSmsSettingsResponse = (value: any) => ({
  ...value,
  triggers: normalizeBooleanMapKeys(value?.triggers),
  templates: normalizeTemplateMapKeys<{ body: string }>(value?.templates)
});

const normalizeWhatsappSettingsResponse = (value: any) => ({
  ...value,
  assistantOutcomeAutofillEnabled: value?.assistantOutcomeAutofillEnabled !== false && value?.assistant_outcome_autofill_enabled !== false,
  triggers: normalizeBooleanMapKeys(value?.triggers),
  templates: normalizeTemplateMapKeys<{ body: string }>(value?.templates)
});

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function extractErrorMessage(payload: any, fallback: string) {
  const flattenFieldErrors = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null;
    const parts: string[] = [];
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (Array.isArray(entry)) {
        const lines = entry
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim());
        if (lines.length) parts.push(`${key}: ${lines.join(", ")}`);
      } else if (typeof entry === "string" && entry.trim()) {
        parts.push(`${key}: ${entry.trim()}`);
      }
    }
    return parts.length ? parts.join(" • ") : null;
  };

  const structured = [
    flattenFieldErrors(payload?.error),
    flattenFieldErrors(payload?.message),
    flattenFieldErrors(payload?.errors)
  ];
  for (const candidate of structured) {
    if (candidate) return candidate;
  }

  const direct = [
    payload?.error,
    payload?.message,
    typeof payload === "string" ? payload : null
  ];
  for (const candidate of direct) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return fallback;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

type AuthRefreshLock = { owner: string; expiresAt: number };

function readAuthRefreshLock(): AuthRefreshLock | null {
  try {
    const raw = localStorage.getItem(AUTH_REFRESH_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthRefreshLock>;
    if (typeof parsed.owner !== "string" || typeof parsed.expiresAt !== "number") return null;
    return { owner: parsed.owner, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function acquireAuthRefreshLock(): boolean {
  try {
    const now = Date.now();
    const current = readAuthRefreshLock();
    if (current && current.expiresAt > now && current.owner !== REFRESH_LOCK_OWNER) {
      return false;
    }

    localStorage.setItem(AUTH_REFRESH_LOCK_KEY, JSON.stringify({
      owner: REFRESH_LOCK_OWNER,
      expiresAt: now + AUTH_REFRESH_LOCK_TTL_MS
    }));

    return readAuthRefreshLock()?.owner === REFRESH_LOCK_OWNER;
  } catch {
    // If localStorage is unavailable, keep the app usable in this tab.
    return true;
  }
}

function releaseAuthRefreshLock() {
  try {
    const current = readAuthRefreshLock();
    if (!current || current.owner === REFRESH_LOCK_OWNER) {
      localStorage.removeItem(AUTH_REFRESH_LOCK_KEY);
    }
  } catch { /* ignore */ }
}

function authSessionChanged(accessToken: string | null, refreshToken: string | null) {
  return auth.getAccessToken() !== accessToken || auth.getRefreshToken() !== refreshToken;
}

async function waitForOtherTabRefresh(accessToken: string | null, refreshToken: string | null): Promise<boolean> {
  const deadline = Date.now() + AUTH_REFRESH_LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    if (authSessionChanged(accessToken, refreshToken)) return true;
    const lock = readAuthRefreshLock();
    if (!lock || lock.expiresAt <= Date.now() || lock.owner === REFRESH_LOCK_OWNER) return false;
    await sleep(AUTH_REFRESH_LOCK_POLL_MS);
  }
  return authSessionChanged(accessToken, refreshToken);
}

function invalidRefreshCanBeRetried(accessToken: string | null, refreshToken: string | null) {
  // Supabase refresh tokens rotate. If another tab/device refreshed first, the
  // token this tab attempted may be stale even though the browser already has a
  // newer session. Also, when the current access token still has breathing room,
  // do not kick the user out on one failed refresh - retry on the next tick.
  return authSessionChanged(accessToken, refreshToken) || !auth.isAccessTokenExpired(INVALID_REFRESH_GRACE_MS);
}

// These routes are part of starting/recovering a session, so a 401 from them
// is the actual form error (for example "Invalid email or password"), not a
// stale dashboard session that should refresh/reload the app.
const SESSION_START_ENDPOINTS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/reset-password",
  "/api/auth/refresh"
]);

// ── Spy mode: the app sets this when the Owner is viewing-as another user ──
let _spyUserId: string | null = null;
export function setApiSpyUserId(userId: string | null) {
  _spyUserId = userId;
}

// ── Core request helper ────────────────────────────────────
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
  transientAttempt = 0
): Promise<T> {
  const isSessionStartEndpoint = SESSION_START_ENDPOINTS.has(path);
  let token = auth.getAccessToken();
  if (token && !isSessionStartEndpoint && auth.isAccessTokenExpiringWithin(PRE_REQUEST_REFRESH_SKEW_MS)) {
    const refresh = await refreshAuthSession();
    if (refresh.ok) {
      token = auth.getAccessToken();
    } else if (auth.isAccessTokenExpired(30_000)) {
      if (refresh.reason === "invalid" || refresh.reason === "missing") {
        auth.clear();
        throw new ApiError(401, "Your session expired. Please sign in again.");
      }
      throw new ApiError(503, "Could not refresh your session right now. Please retry in a moment - you have not been logged out.");
    }
  }
  let res: Response;
  try {
    res = await fetchWithApiFailover(path, {
      method,
      cache: "no-store", // never read from or write to HTTP cache
      headers: {
        "Content-Type": "application/json",
        ...(token && !isSessionStartEndpoint ? { Authorization: `Bearer ${token}` } : {}),
        ...(_spyUserId ? { "X-Spy-User-Id": _spyUserId } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    if (method === "GET" && transientAttempt < TRANSIENT_GET_RETRY_LIMIT) {
      await sleep(400 * (transientAttempt + 1));
      return request<T>(method, path, body, retried, transientAttempt + 1);
    }
    throw new ApiError(0, "Unable to reach the server. The request may be blocked by your connection or allowed domain settings.");
  }

  if (method === "GET" && TRANSIENT_RETRYABLE_STATUSES.has(res.status) && transientAttempt < TRANSIENT_GET_RETRY_LIMIT) {
    await sleep(400 * (transientAttempt + 1));
    return request<T>(method, path, body, retried, transientAttempt + 1);
  }

  // Auto-refresh on 401 (token expired)
  if (res.status === 401 && !retried && !isSessionStartEndpoint) {
    const refreshed = await refreshAuthSession();
    if (refreshed.ok) return request<T>(method, path, body, true, transientAttempt);
    if (refreshed.reason === "transient") {
      throw new ApiError(503, "Could not refresh your session right now. Please retry in a moment - you have not been logged out.");
    }
    if (refreshed.reason === "invalid" && !auth.isAccessTokenExpired(30_000)) {
      throw new ApiError(503, "Could not refresh your session right now. Please retry in a moment - you have not been logged out.");
    }
    auth.clear();
    throw new ApiError(401, "Your session expired. Please sign in again.");
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, extractErrorMessage(payload, res.statusText || "Request failed."));
  }

  if (res.status === 204) return undefined as T;
  const json = await res.json();
  return snakeToCamel<T>(json);
}

function isTransientRefreshStatus(status: number) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export async function refreshAuthSession(): Promise<AuthRefreshResult> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const accessToken = auth.getAccessToken();
    const refreshToken = auth.getRefreshToken();
    if (!refreshToken) return { ok: false, reason: "missing" };
    let lockAcquired = acquireAuthRefreshLock();
    if (!lockAcquired) {
      const otherTabRefreshed = await waitForOtherTabRefresh(accessToken, refreshToken);
      if (otherTabRefreshed) return { ok: true };
      lockAcquired = acquireAuthRefreshLock();
      if (!lockAcquired) {
        return { ok: false, reason: "transient", message: "Another browser tab is refreshing your session." };
      }
    }
    try {
      const res = await fetchWithApiFailover("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: res.statusText }));
        const reason = isTransientRefreshStatus(res.status) || invalidRefreshCanBeRetried(accessToken, refreshToken)
          ? "transient"
          : "invalid";
        return {
          ok: false,
          reason,
          status: res.status,
          message: extractErrorMessage(payload, res.statusText || "Session refresh failed.")
        };
      }
      const data = await res.json();
      if (!data?.accessToken || !data?.refreshToken) {
        return { ok: false, reason: "transient", message: "Session refresh response was incomplete." };
      }
      // Fetch fresh profile so role/name stay in sync
      let user = auth.getUser();
      try {
        const meRes = await fetchWithApiFailover("/api/auth/me", {
          headers: { Authorization: `Bearer ${data.accessToken}` }
        });
        if (meRes.ok) {
          const me = await meRes.json();
          if (me.user) user = snakeToCamel(me.user);
        }
      } catch { /* keep existing user if /me fails */ }
      if (user) auth.save(data.accessToken, data.refreshToken, user);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, reason: "transient", message: error?.message ?? "Session refresh failed." };
    } finally {
      if (lockAcquired) releaseAuthRefreshLock();
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function ensureFreshAuthSession(skewMs = BACKGROUND_REFRESH_SKEW_MS): Promise<AuthRefreshResult> {
  if (!auth.getAccessToken()) return { ok: false, reason: "missing" };
  if (!auth.isAccessTokenExpiringWithin(skewMs)) return { ok: true };
  return refreshAuthSession();
}

const get  = <T>(path: string)            => request<T>("GET",    path);
const post = <T>(path: string, body: unknown) => request<T>("POST",   path, body);
const patch = <T>(path: string, body: unknown) => request<T>("PATCH",  path, body);
const del  = <T>(path: string)            => request<T>("DELETE", path);

// ── Auth ──────────────────────────────────────────────────
export const authApi = {
  register: (body: { orgName: string; name: string; email: string; password: string }) =>
    post<{ message: string }>("/api/auth/register", body),

  login: (email: string, password: string) =>
    post<{ accessToken: string; refreshToken: string; user: { id: string; orgId: string; name: string; role: string; email: string } }>(
      "/api/auth/login", { email, password }
    ),

  me: () => get<{
    user: { id: string; orgId: string; name: string; role: string; email: string };
    cacheVersion?: number;
    branding?: { name: string; logoUrl: string };
    payroll?: { topPerformerBonusEnabled: boolean; topPerformerBonusAmount: number };
    timezone?: string;
    adminCartNotifications?: boolean;
    workingScheduleEnabled?: boolean;
    workingDays?: string[];
    workingDayStart?: string;
    workingDayEnd?: string;
    smartStockRules?: {
      demandLookbackDays: number;
      dormantDays: number;
      criticalDaysCover: number;
      watchDaysCover: number;
      lowStockThreshold: number;
    };
    adTrackingLabels?: {
      campaigns: Record<string, string>;
      creatives: Record<string, string>;
    };
    adTrackingLabelsShared?: boolean;
  }>("/api/auth/me"),
  bumpCacheVersion: () => post<{ cacheVersion: number }>("/api/auth/bump-cache-version", {}),
  updateBranding: (body: {
    name?: string;
    logoUrl?: string;
    topPerformerBonusEnabled?: boolean;
    topPerformerBonusAmount?: number;
    timezone?: string;
    adminCartNotifications?: boolean;
    workingScheduleEnabled?: boolean;
    workingDays?: string[];
    workingDayStart?: string;
    workingDayEnd?: string;
    smartStockRules?: {
      demandLookbackDays: number;
      dormantDays: number;
      criticalDaysCover: number;
      watchDaysCover: number;
      lowStockThreshold: number;
    };
  }) =>
    patch<{
      name: string;
      logoUrl: string;
      topPerformerBonusEnabled: boolean;
      topPerformerBonusAmount: number;
      timezone: string;
      adminCartNotifications: boolean;
      workingScheduleEnabled: boolean;
      workingDays: string[];
      workingDayStart: string;
      workingDayEnd: string;
      smartStockRules?: {
        demandLookbackDays: number;
        dormantDays: number;
        criticalDaysCover: number;
        watchDaysCover: number;
        lowStockThreshold: number;
      };
    }>("/api/auth/org-branding", body),
  saveAdTrackingLabels: (body: {
    campaigns?: Record<string, string>;
    creatives?: Record<string, string>;
  }) =>
    patch<{
      shared?: boolean;
      campaigns: Record<string, string>;
      creatives: Record<string, string>;
    }>("/api/auth/ad-tracking-labels", body),
  adTrackingLabels: () =>
    get<{
      shared?: boolean;
      campaigns: Record<string, string>;
      creatives: Record<string, string>;
    }>("/api/auth/ad-tracking-labels"),

  invite: (body: { name: string; email: string; phone?: string; password: string; role: string; marketingAttributionTags?: string[] }) =>
    post<{ message: string }>("/api/auth/invite", body),

  resetPassword: (email: string) =>
    post<{ message: string }>("/api/auth/reset-password", { email }),

  // userId is optional - when omitted, the backend resolves the target from
  // the Bearer token (used by the recovery flow, where we have no profile yet).
  setPassword: (passwordOrUserId: string, password?: string) =>
    post<{ message: string }>(
      "/api/auth/set-password",
      password === undefined ? { password: passwordOrUserId } : { userId: passwordOrUserId, password }
    ),
  presence: () => post<{ ok: boolean; lastSeenAt: string }>("/api/auth/presence", {})
};

// ── Users ────────────────────────────────────────────────
export const usersApi = {
  list: () => get<any[]>("/api/users"),
  update: (id: string, body: { name?: string; email?: string; phone?: string; active?: boolean }) =>
    patch<any>(`/api/users/${id}`, body)
};

// ── Products ──────────────────────────────────────────────
export const productsApi = {
  list: () => get<any[]>("/api/products"),
  // Public storefront view of one product, with cross-sells + free-gifts inlined.
  // Raw fetch so embed forms never inherit stale auth headers or 401 refresh logic.
  public: async (id: string) => {
    const res = await fetchWithApiFailover(`/api/public/products/${encodeURIComponent(id)}`, {
      cache: "no-store"
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, typeof payload?.error === "string" ? payload.error : res.statusText);
    }
    return snakeToCamel<{ product: any; related: any[] }>(await res.json());
  },
  publicPackageAvailability: async (id: string, state: string, packageSet?: string, forceStockCheck = false) => {
    const qs = new URLSearchParams({ state });
    if (packageSet?.trim()) qs.set("packageSet", packageSet.trim());
    if (forceStockCheck) qs.set("forceStockCheck", "1");
    const res = await fetchWithApiFailover(`/api/public/products/${encodeURIComponent(id)}/package-availability?${qs.toString()}`, {
      cache: "no-store"
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, typeof payload?.error === "string" ? payload.error : res.statusText);
    }
    return snakeToCamel<{
      packages: Array<{
        packageId: string;
        stateAllowed: boolean;
        stockReady: boolean;
        visible: boolean;
        requiresStateStock: boolean;
      }>;
      companions?: Array<{
        packageId: string;
        companionId: string;
        productId: string;
        targetPackageId: string | null;
        stateAllowed: boolean;
        stockReady: boolean;
        visible: boolean;
        requiresStateStock: boolean;
      }>;
    }>(await res.json());
  },
  publicFreeDeliverySlots: async (id: string) => {
    const res = await fetchWithApiFailover(`/api/public/products/${encodeURIComponent(id)}/free-delivery-slots`, {
      cache: "no-store"
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, typeof payload?.error === "string" ? payload.error : res.statusText);
    }
    return snakeToCamel<{
      enabled: boolean;
      limit?: number;
      claimed?: number;
      manualClaimed?: number;
      liveClaimed?: number;
      remaining?: number;
      full?: boolean;
      windowStart?: string;
      nextResetAt?: string;
      resetIntervalMinutes?: number;
    }>(await res.json());
  },
  create: (body: unknown) => post<any>("/api/products", body),
  update: (id: string, body: unknown) => patch<any>(`/api/products/${id}`, body),
  delete: (id: string) => del<void>(`/api/products/${id}`),
  resetDedicatedHandlerCounts: (id: string) => post<{ ok: true }>(`/api/products/${id}/dedicated-handlers/reset-counts`, {}),
  createPricing: (productId: string, body: unknown) => post<any>(`/api/products/${productId}/pricings`, body),
  listPackages: (productId: string) => get<any[]>(`/api/products/${productId}/packages`),
  createPackage: (productId: string, body: unknown) => post<any>(`/api/products/${productId}/packages`, body),
  updatePackage: (productId: string, pkgId: string, body: unknown) => patch<any>(`/api/products/${productId}/packages/${pkgId}`, body),
  uploadPackageImage: (dataUrl: string, filename?: string) =>
    post<{ url: string; path: string }>(`/api/products/package-images/upload`, { dataUrl, filename }),
  uploadProductVideo: (dataUrl: string, filename?: string) =>
    post<{ url: string; path: string }>(`/api/products/product-videos/upload`, { dataUrl, filename }),
  deletePricing: (productId: string, currency: string) => del<void>(`/api/products/${productId}/pricings/${currency}`),
  deletePackage: (productId: string, pkgId: string) => del<void>(`/api/products/${productId}/packages/${pkgId}`)
};

// ── Orders ────────────────────────────────────────────────
export const ordersApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<{ data: any[]; total: number; page: number; pageSize: number }>(`/api/orders${qs}`);
  },
  create: (body: unknown) => post<any>("/api/orders", body),
  updateStatus: (id: string, body: unknown) => patch<any>(`/api/orders/${id}/status`, body),
  changeDate: (id: string, body: { createdAt: string; reason: string }) => patch<any>(`/api/orders/${id}/date`, body),
  update: (id: string, body: unknown) => patch<any>(`/api/orders/${id}`, body),
  reviewRemittanceVariance: (id: string, body: { action: "approve" | "reject"; note?: string }) =>
    patch<any>(`/api/orders/${id}/remittance-variance`, body),
  openRemittanceForEdit: (orderIds: string[]) => post<{ opened: number }>("/api/orders/open-remittance", { orderIds }),
  delete: (id: string) => del<void>(`/api/orders/${id}`),
  audit: (id: string) => get<any[]>(`/api/orders/${id}/audit`),
  fieldEdits: (id: string) => get<any[]>(`/api/orders/${id}/field-edits`),
  followUpTasks: (id: string) => get<any[]>(`/api/orders/${id}/follow-up-tasks`),
  contactAttempts: (id: string) => get<any[]>(`/api/orders/${id}/contact-attempts`),
  logContactAttempt: (id: string, body: unknown) => post<any>(`/api/orders/${id}/contact-attempts`, body)
};

// ── Follow-up KPI: daily logging scoreboard + miss review ────
export const followUpKpiApi = {
  board: (params?: { repId?: string; date?: string }) => {
    const qs = new URLSearchParams();
    if (params?.repId) qs.set("repId", params.repId);
    if (params?.date) qs.set("date", params.date);
    const s = qs.toString();
    return get<any>(`/api/follow-up-kpi/board${s ? `?${s}` : ""}`);
  },
  grid: (params?: { repId?: string; weekStart?: string }) => {
    const qs = new URLSearchParams();
    if (params?.repId) qs.set("repId", params.repId);
    if (params?.weekStart) qs.set("weekStart", params.weekStart);
    const s = qs.toString();
    return get<any>(`/api/follow-up-kpi/grid${s ? `?${s}` : ""}`);
  },
  log: (body: { orderId: string; text: string; channels: string[]; promisedDate?: string | null; promisedTime?: string | null; recoveryBucket?: string | null; outcomeGroup?: string | null; slot?: "morning" | "later" | null }) => post<any>("/api/follow-up-kpi/log", body),
  misses: (state: string = "pending") => get<any[]>(`/api/follow-up-kpi/misses?state=${encodeURIComponent(state)}`),
  approveMiss: (id: string) => post<any>(`/api/follow-up-kpi/misses/${id}/approve`, {}),
  waiveMiss: (id: string) => post<any>(`/api/follow-up-kpi/misses/${id}/waive`, {})
};

// ── Batch unit-economics ─────────────────────────────────
export const batchesApi = {
  list: () => get<any[]>("/api/batches"),
  create: (body: unknown) => post<any>("/api/batches", body),
  update: (id: string, body: unknown) => patch<any>(`/api/batches/${id}`, body),
  delete: (id: string) => del<void>(`/api/batches/${id}`),
  assignOrders: (id: string, body: unknown) => post<{ assigned: number }>(`/api/batches/${id}/assign-orders`, body),
  economics: (id: string) => get<any>(`/api/batches/${id}/economics`),
  autofill: (id: string) => get<{ suggestions: Record<string, number>; meta: any }>(`/api/batches/${id}/autofill`),
  getConfig: () => get<{ tiers: any[]; statusMap: any[] }>("/api/batches/config/tiers"),
  updateConfig: (body: unknown) => patch<{ tiers: any[]; statusMap: any[] }>("/api/batches/config/tiers", body)
};

export const weeklyAccountingApi = {
  summary: (params: { weekStart: string; productIds?: string }) => {
    const qs = new URLSearchParams({
      weekStart: params.weekStart,
      ...(params.productIds ? { productIds: params.productIds } : {})
    }).toString();
    return get<any>(`/api/weekly-accounting?${qs}`);
  }
};

export const financeSummaryApi = {
  summary: (params: { dateFrom: string; dateTo: string; productIds?: string }) => {
    const qs = new URLSearchParams({
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      ...(params.productIds ? { productIds: params.productIds } : {})
    }).toString();
    return get<any>(`/api/finance-summary?${qs}`);
  }
};

export const remittanceTransactionsApi = {
  list: (params: { dateFrom: string; dateTo: string; productIds?: string }) => {
    const qs = new URLSearchParams({
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      ...(params.productIds ? { productIds: params.productIds } : {})
    }).toString();
    return get<any>(`/api/remittance-transactions?${qs}`);
  },
  backfill: (body?: { dryRun?: boolean; dateMode?: "updated_at" | "delivered_date" | "created_at" }) => {
    return post<any>("/api/remittance-transactions/backfill", body ?? {});
  }
};

// ── Agents ────────────────────────────────────────────────
export const agentsApi = {
  list: () => get<any[]>("/api/agents"),
  create: (body: unknown) => post<any>("/api/agents", body),
  update: (id: string, body: unknown) => patch<any>(`/api/agents/${id}`, body),
  delete: (id: string) => del<void>(`/api/agents/${id}`),
  getStock: (id: string) => get<any[]>(`/api/agents/${id}/stock`),
  assignStock: (id: string, body: unknown) => post<any>(`/api/agents/${id}/stock`, body),
  reconcile: (id: string, body: unknown) => post<any>(`/api/agents/${id}/reconcile`, body)
};

export const deliveryDistanceAuditsApi = {
  list: (params?: { orderIds?: string[] }) => {
    const qs = params?.orderIds?.length ? `?${new URLSearchParams({ orderIds: params.orderIds.join(",") }).toString()}` : "";
    return get<any[]>(`/api/delivery-distance-audits${qs}`);
  },
  calculate: (orderId: string, body?: unknown) => post<any>(`/api/delivery-distance-audits/orders/${orderId}/calculate`, body ?? {}),
  updateOrderCoordinates: (orderId: string, body: unknown) => patch<any>(`/api/delivery-distance-audits/orders/${orderId}/coordinates`, body),
  updateAgentLocationCoordinates: (locationId: string, body: unknown) => patch<any>(`/api/delivery-distance-audits/agent-locations/${locationId}/coordinates`, body)
};

export const weekendStockSummaryApi = {
  weekly: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return get<any>(`/api/weekend-stock-summary/weekly${qs}`);
  }
};

// ── Stock ─────────────────────────────────────────────────
export const stockApi = {
  movements: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<{ data: any[]; total: number }>(`/api/stock/movements${qs}`);
  },
  createMovement: (body: unknown) => post<any>("/api/stock/movements", body),
  update: (body: unknown) => post<any>("/api/stock/update", body),
  countSessions: () => get<any[]>("/api/stock/count-sessions"),
  createSession: (body: unknown) => post<any>("/api/stock/count-sessions", body),
  updateEntry: (entryId: string, body: unknown) => patch<any>(`/api/stock/count-entries/${entryId}`, body),
  adjustEntry: (entryId: string, body: unknown) => post<any>(`/api/stock/count-entries/${entryId}/adjust`, body),
  closeSession: (sessionId: string) => patch<any>(`/api/stock/count-sessions/${sessionId}/close`, {}),
  runSmartAlerts: () => post<{ scannedOrgs: number; firedAlerts: number }>(`/api/stock/smart-alerts/run`, {})
};

// ── Expenses ──────────────────────────────────────────────
export const expensesApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<any[]>(`/api/expenses${qs}`);
  },
  create: (body: unknown) => post<any>("/api/expenses", body),
  delete: (id: string) => del<void>(`/api/expenses/${id}`)
};

// ── Payroll ───────────────────────────────────────────────
export const payrollApi = {
  list: () => get<any[]>("/api/payroll"),
  preview: (body: { period: string }) => post<any>("/api/payroll/preview", body),
  generate: (body: { period: string; label?: string; notes?: string }) => post<any>("/api/payroll/generate", body),
  approve: (id: string) => patch<any>(`/api/payroll/${id}/approve`, {}),
  markPaid: (id: string) => patch<any>(`/api/payroll/${id}/mark-paid`, {}),
  spreadWeeklySalary: (month: string, week: number) => post<any>("/api/payroll/spread-weekly-salary", { month, week })
};

export const bonusCoachApi = {
  me: (weekStart: string) => get<any>(`/api/bonus-coach/me?${new URLSearchParams({ weekStart }).toString()}`),
  rep: (repId: string, weekStart: string) => get<any>(`/api/bonus-coach/rep/${repId}?${new URLSearchParams({ weekStart }).toString()}`)
};

export const salesBonusesApi = {
  programs: (params?: { includeDeleted?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.includeDeleted) qs.set("includeDeleted", "1");
    const suffix = qs.toString();
    return get<any[]>(`/api/sales-bonuses/programs${suffix ? `?${suffix}` : ""}`);
  },
  createProgram: (body: unknown) => post<any>("/api/sales-bonuses/programs", body),
  updateProgram: (id: string, body: unknown) => patch<any>(`/api/sales-bonuses/programs/${id}`, body),
  duplicateProgram: (id: string) => post<any>(`/api/sales-bonuses/programs/${id}/duplicate`, {}),
  deleteProgram: (id: string) => del<void>(`/api/sales-bonuses/programs/${id}`),
  createRule: (programId: string, body: unknown) => post<any>(`/api/sales-bonuses/programs/${programId}/rules`, body),
  updateRule: (id: string, body: unknown) => patch<any>(`/api/sales-bonuses/rules/${id}`, body),
  deleteRule: (id: string) => del<void>(`/api/sales-bonuses/rules/${id}`),
  progress: (weekStart: string) => get<any>(`/api/sales-bonuses/progress?${new URLSearchParams({ weekStart }).toString()}`),
  progressForRep: (repId: string, weekStart: string) => get<any>(`/api/sales-bonuses/progress/${repId}?${new URLSearchParams({ weekStart }).toString()}`)
};

// ── Customers ─────────────────────────────────────────────
export const customersApi = {
  list: () => get<any[]>("/api/customers"),
  flags: () => get<{ phone: string; reason: string; flagged_at?: string; flagged_by?: string }[]>("/api/customers/flags"),
  flag: (body: { phone: string; reason: string }) => post<any>("/api/customers/flags", body),
  unflag: (phone: string) => del<void>(`/api/customers/flags/${phone}`)
};

// ── Notifications ─────────────────────────────────────────
export const notificationsApi = {
  list: () => get<any[]>("/api/notifications"),
  create: (body: { type: string; message: string; productId?: string; title?: string; link?: string; orderId?: string }) => post<any>("/api/notifications", body),
  createStockRiskAlerts: (body: {
    signals: Array<{
      productId: string;
      productName: string;
      state: string;
      stock: number;
      warehouseStock?: number;
      recentUnits: number;
      openOrders: number;
      daysCover?: number;
      lookbackDays?: number;
      severity: "stockout" | "critical" | "watch";
      salesRepRecipientIds?: string[];
    }>;
  }) => post<any[]>("/api/notifications/stock-risk", body),
  markAllRead: () => patch<{ message: string }>("/api/notifications/read-all", {}),
  markRead: (id: string) => patch<any>(`/api/notifications/${id}/read`, {}),
  deleteRead: () => del<void>("/api/notifications/read")
};

// ── Waybills ──────────────────────────────────────────────
export const waybillsApi = {
  list: () => get<any[]>("/api/waybills"),
  create: (body: unknown) => post<any>("/api/waybills", body),
  update: (id: string, body: unknown) => patch<any>(`/api/waybills/${id}`, body),
  updateStatus: (id: string, body: unknown) => patch<any>(`/api/waybills/${id}/status`, body),
  delete: (id: string) => del<{ deleted: boolean; restoredUnits?: number }>(`/api/waybills/${id}`)
};

// ── Team (users in org) ───────────────────────────────────
export const teamApi = {
  list: () => get<any[]>("/api/auth/team"),
  update: (id: string, body: unknown) => patch<any>(`/api/auth/team/${id}`, body),
  updateAgentAssignments: (id: string, agentIds: string[]) =>
    request<{ userId: string; agentIds: string[] }>("PUT", `/api/auth/team/${id}/agent-assignments`, { agentIds }),
  delete: (id: string) => del<void>(`/api/auth/team/${id}`),
  updateRoundRobin: (order: string[]) => request<{ ok: boolean }>("PUT", "/api/auth/team/round-robin", { order })
};

// ── Email Settings ────────────────────────────────────────
export const embedSettingsApi = {
  get:    ()                  => get<any>("/api/embed-settings"),
  patch:  (body: unknown)     => patch<any>("/api/embed-settings", body),
  // Public: read settings unauthenticated (used by the customer-facing embed form)
  public: async (orgId: string) => {
    const res = await fetchWithApiFailover(`/api/public/embed-settings/${orgId}`);
    if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
    return snakeToCamel<any>(await res.json());
  }
};

// ── Marketing Link Variants ──────────────────────────────
export const marketingLinkVariantsApi = {
  list: (params?: { productId?: string }) => {
    const qs = params?.productId ? `?${new URLSearchParams({ productId: params.productId }).toString()}` : "";
    return get<any[]>(`/api/marketing-link-variants${qs}`);
  },
  create: (body: unknown) => post<any>("/api/marketing-link-variants", body),
  delete: (id: string) => del<void>(`/api/marketing-link-variants/${encodeURIComponent(id)}`),
  traffic: () => get<Record<string, { carts: number; orders: number; lastActivity: string | null }>>("/api/marketing-link-variants/traffic")
};

// ── Marketing Spend Ledger ───────────────────────────────
export const marketingSpendApi = {
  list: (params?: { from?: string; to?: string; productId?: string; marketerUserId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    if (params?.productId) qs.set("productId", params.productId);
    if (params?.marketerUserId) qs.set("marketerUserId", params.marketerUserId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return get<any[]>(`/api/marketing-spend${suffix}`);
  },
  create: (body: unknown) => post<any>("/api/marketing-spend", body),
  update: (id: string, body: unknown) => patch<any>(`/api/marketing-spend/${encodeURIComponent(id)}`, body),
  delete: (id: string) => del<void>(`/api/marketing-spend/${encodeURIComponent(id)}`)
};

export const metaCapiSettingsApi = {
  list: () => get<any[]>("/api/meta-capi-settings"),
  save: (body: unknown) => post<any>("/api/meta-capi-settings", body),
  toggle: (id: string, active: boolean) => patch<any>(`/api/meta-capi-settings/${encodeURIComponent(id)}/toggle`, { active }),
  test: (body: { id?: string; trackingKey?: string; pixelId?: string; accessToken?: string; testEventCode?: string }) =>
    post<{ ok: boolean; message: string; eventsReceived?: number }>("/api/meta-capi-settings/test", body),
  testTiktok: (body: { id?: string; trackingKey?: string; pixelId?: string; accessToken?: string; testEventCode?: string }) =>
    post<{ ok: boolean; message: string }>("/api/meta-capi-settings/test-tiktok", body),
  delete: (id: string) => del<{ ok: boolean }>(`/api/meta-capi-settings/${encodeURIComponent(id)}`)
};

export const emailSettingsApi = {
  get:  async ()            => normalizeEmailSettingsResponse(await get<any>("/api/email-settings")),
  save: async (body: any) => normalizeEmailSettingsResponse(await request<any>("PUT", "/api/email-settings", {
    ...body,
    triggers: normalizeBooleanMapKeys(body?.triggers),
    templates: normalizeTemplateMapKeys<{ subject: string; body: string }>(body?.templates)
  })),
  test: (to: string)  => post<{ message: string; provider?: string; fallbackFrom?: string | null }>("/api/email-settings/test", { to }),
  messages: (page = 1, limit = 10) => get<{ data: any[]; total: number; page: number; pageSize: number }>(`/api/email-settings/messages?page=${page}&limit=${limit}`)
};

export const smsSettingsApi = {
  get: async () => normalizeSmsSettingsResponse(await get<any>("/api/sms-settings")),
  save: async (body: any) => normalizeSmsSettingsResponse(await request<any>("PUT", "/api/sms-settings", {
    ...body,
    triggers: normalizeBooleanMapKeys(body?.triggers),
    templates: normalizeTemplateMapKeys<{ body: string }>(body?.templates)
  })),
  test: (phone: string) =>
    post<{ message: string; provider?: string; providerMessageId?: string | null; units?: number; segments?: number }>(
      "/api/sms-settings/test",
      { phone }
    ),
  balance: () => get<{ balance: number | null; raw?: unknown }>("/api/sms-settings/balance"),
  messages: (page = 1, limit = 10) => get<{ data: any[]; total: number; page: number; pageSize: number }>(`/api/sms-settings/messages?page=${page}&limit=${limit}`),
  resend: (id: string) => post<{ message: string; deferred?: boolean; logId?: string | null }>(`/api/sms-settings/messages/${id}/resend`, {}),
  optOuts: () => get<any[]>("/api/sms-settings/opt-outs"),
  addOptOut: (body: { phone: string; note?: string }) => post<any>("/api/sms-settings/opt-outs", body),
  removeOptOut: (phone: string) => del<{ normalizedPhone: string }>(`/api/sms-settings/opt-outs/${encodeURIComponent(phone)}`),
  inbound: (limit = 50) => get<any[]>(`/api/sms-settings/inbound?limit=${limit}`),
  rotateWebhookSecret: () => post<{ inboundWebhookSecret: string; inboundWebhookUrl: string }>("/api/sms-settings/webhook-secret/rotate", {})
};

export const whatsappSettingsApi = {
  get: async () => normalizeWhatsappSettingsResponse(await get<any>("/api/whatsapp-settings")),
  save: async (body: any) => normalizeWhatsappSettingsResponse(await request<any>("PUT", "/api/whatsapp-settings", {
    ...body,
    assistant_outcome_autofill_enabled: body?.assistantOutcomeAutofillEnabled,
    triggers: normalizeBooleanMapKeys(body?.triggers),
    templates: normalizeTemplateMapKeys<{ body: string }>(body?.templates)
  })),
  connect: async (body: { mode: "qr" | "pairing_code"; phone?: string }) =>
    normalizeWhatsappSettingsResponse(await post<any>("/api/whatsapp-settings/connect", body)),
  disconnect: async () => normalizeWhatsappSettingsResponse(await post<any>("/api/whatsapp-settings/disconnect", {})),
  test: (phone: string) =>
    post<{ message: string; provider?: string; providerMessageId?: string | null }>(
      "/api/whatsapp-settings/test",
      { phone }
    ),
  customSend: (body: { phone: string; body: string; recipientName?: string; orderId?: string }) =>
    post<{ message: string; provider?: string; providerMessageId?: string | null }>("/api/whatsapp-settings/custom-send", {
      phone: body.phone,
      body: body.body,
      recipient_name: body.recipientName,
      order_id: body.orderId
    }),
  summary: () => get<any>("/api/whatsapp-settings/summary"),
  inbox: (limit = 50) => get<any[]>(`/api/whatsapp-settings/inbox?limit=${limit}`),
  optOuts: () => get<any[]>("/api/whatsapp-settings/opt-outs"),
  addOptOut: (body: { phone: string; note?: string }) => post<any>("/api/whatsapp-settings/opt-outs", body),
  removeOptOut: (phone: string) => del<{ normalizedPhone: string }>(`/api/whatsapp-settings/opt-outs/${encodeURIComponent(phone)}`),
  messages: (page = 1, limit = 10) => get<{ data: any[]; total: number; page: number; pageSize: number }>(`/api/whatsapp-settings/messages?page=${page}&limit=${limit}`),
  upsellStats: () => get<{ total: number; sent7d: number; sent30d: number; delivered: number; failed: number }>("/api/whatsapp-settings/upsell-stats")
};

export const whatsappUserAccountApi = {
  get: () => get<{ account: any; dispatches: any[] }>("/api/whatsapp-user-account/me/connect"),
  // Owner/Admin: fetch another user's account for view-as mode
  getForUser: (userId: string) => get<{ account: any; dispatches: any[] }>(`/api/whatsapp-user-account/user/${encodeURIComponent(userId)}/connect`),
  connect: (body: { mode: "qr" | "pairing_code"; phone?: string; riskAcknowledged?: boolean }) =>
    post<{ account: any }>("/api/whatsapp-user-account/me/connect", body),
  acknowledgeRisk: () =>
    post<{ account: any }>("/api/whatsapp-user-account/me/risk-acknowledgement", { riskAcknowledged: true }),
  disconnect: () => post<{ account: any }>("/api/whatsapp-user-account/me/disconnect", {}),
  groups: () => get<{ groups: Array<{ jid: string; subject: string; participants?: number | null }> }>("/api/whatsapp-user-account/me/groups"),
  teamDispatches: () => get<{ dispatches: any[] }>("/api/whatsapp-user-account/dispatches?scope=team")
};

export const whatsappDestinationsApi = {
  list: (includeInactive = false) =>
    get<{ destinations: any[] }>(`/api/whatsapp-destinations${includeInactive ? "?includeInactive=true" : ""}`),
  // Owner/Admin: fetch another user's destinations for view-as mode
  listForUser: (userId: string) => get<{ destinations: any[] }>(`/api/whatsapp-destinations/user/${encodeURIComponent(userId)}`),
  // Owner/Admin: all org destinations enriched with owner + assigned rep names
  listAll: () => get<{ destinations: any[] }>("/api/whatsapp-destinations/org/all"),
  // Owner/Admin: assign multiple reps to a destination
  assignReps: (destinationId: string, repIds: string[]) =>
    patch<{ ok: boolean; repIds: string[] }>(`/api/whatsapp-destinations/${encodeURIComponent(destinationId)}/assign-reps`, { repIds }),
  // Owner/Admin: assign a delivery agent to a destination
  assignAgent: (destinationId: string, agentId: string | null) =>
    patch<{ ok: boolean }>(`/api/whatsapp-destinations/${encodeURIComponent(destinationId)}/assign-agent`, { agentId }),
  create: (body: { label: string; destinationType: "group" | "phone" | "manual_group"; groupJid?: string | null; phone?: string | null; notes?: string | null; active?: boolean; isDefault?: boolean }) =>
    post<any>("/api/whatsapp-destinations", body),
  update: (id: string, body: Partial<{ label: string; destinationType: "group" | "phone" | "manual_group"; groupJid: string | null; phone: string | null; notes: string | null; active: boolean; isDefault: boolean }>) =>
    patch<any>(`/api/whatsapp-destinations/${encodeURIComponent(id)}`, body),
  remove: (id: string) => del<{ ok: boolean }>(`/api/whatsapp-destinations/${encodeURIComponent(id)}`)
};

export const whatsappConversationsApi = {
  list: (limit = 50) => get<{ conversations: any[] }>(`/api/whatsapp/conversations?limit=${limit}`),
  thread: (phone: string) => get<{ messages: any[]; linkedOrder: any | null; unreadCount: number }>(`/api/whatsapp/conversations/${encodeURIComponent(phone)}`),
  send: (phone: string, body: string, linkedOrderId?: string | null, fallbackPhone?: string | null) =>
    post<{ ok: boolean; id: string; confirmedPhone: string; usedFallback: boolean }>(`/api/whatsapp/conversations/${encodeURIComponent(phone)}/send`, { body, linkedOrderId, fallbackPhone }),
  markRead: (phone: string) =>
    patch<{ ok: boolean }>(`/api/whatsapp/conversations/${encodeURIComponent(phone)}/read`, {})
};

export const ordersWhatsAppResendApi = {
  resend: (orderId: string) =>
    post<{ ok: boolean; message: string }>(`/api/orders/${encodeURIComponent(orderId)}/whatsapp-resend`, {}),
  status: (orderId: string) =>
    get<{ messages: Array<{ id: string; trigger: string; status: string; error_message: string | null; created_at: string; body: string }>; normalizedPhone: string }>(`/api/orders/${encodeURIComponent(orderId)}/whatsapp-status`)
};

export const whatsappOrderDispatchApi = {
  preview: (orderId: string) =>
    get<{ orderId: string; body: string; defaultDestination: any | null; account: any | null; canDirect: boolean; directBlockedReason?: string | null; limits: { directPerMinute: number; directPerDay: number } }>(
      `/api/orders/${encodeURIComponent(orderId)}/whatsapp-dispatch/preview`
    ),
  dispatch: (orderId: string, body: { sendMode: "assisted" | "direct"; destinationId?: string; destinationLabel?: string; destinationType?: "group" | "phone" | "manual_group" }) =>
    post<{ dispatch: any; body: string; assisted: boolean }>(`/api/orders/${encodeURIComponent(orderId)}/whatsapp-dispatch`, body)
};

export const emailReportsApi = {
  sendWeeklyReport: () => post<{ message: string }>("/api/email/weekly-report", {})
};

// ── Abandoned Carts ──────────────────────────────────────
export const cartsApi = {
  list: () => get<any[]>("/api/carts"),
  create: (body: unknown) => post<any>("/api/carts", body),
  // Public capture endpoint - no auth required, derives org from product_id.
  // Use this from the embed form so it works inside customer-facing iframes.
  capture: (body: unknown) => post<any>("/api/public/carts", body),
  trackPublicJourney: async (id: string, body: unknown, options?: { keepalive?: boolean }) => {
    const res = await fetchWithApiFailover(`/api/public/carts/${encodeURIComponent(id)}/events`, {
      method: "POST",
      cache: "no-store",
      keepalive: options?.keepalive === true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, extractErrorMessage(payload, "Could not track form activity."));
    }
    return snakeToCamel<any>(await res.json());
  },
  journey: (id: string) => get<any[]>(`/api/carts/${encodeURIComponent(id)}/journey`),
  journeyBulk: (cartIds: string[]) => post<Record<string, any[]>>("/api/carts/journey-bulk", { cartIds }),
  convertedLinkRepairs: () => get<any>("/api/carts/converted-link-repairs"),
  applyConvertedLinkRepairs: () => post<any>("/api/carts/converted-link-repairs/apply", {}),
  applyConvertedLinkRepair: (cartId: string, orderId: string) =>
    post<any>("/api/carts/converted-link-repairs/apply-one", { cartId, orderId }),
  livePulse: (params?: { productIds?: string[]; embedLabels?: string[]; activeWindowMinutes?: number; dateFrom?: string; dateTo?: string }) => {
    const qs = new URLSearchParams();
    if (params?.productIds?.length) {
      qs.set("productIds", params.productIds.join(","));
    }
    if (params?.embedLabels?.length) {
      qs.set("embedLabels", params.embedLabels.join(","));
    }
    if (typeof params?.activeWindowMinutes === "number") {
      qs.set("activeWindowMinutes", String(params.activeWindowMinutes));
    }
    if (params?.dateFrom) {
      qs.set("dateFrom", params.dateFrom);
    }
    if (params?.dateTo) {
      qs.set("dateTo", params.dateTo);
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return get<any>(`/api/carts/live-pulse${suffix}`);
  },
  byLabel: (label: string) => get<any[]>(`/api/carts/by-label/${encodeURIComponent(label)}`),
  changeDate: (id: string, body: { createdAt: string; reason: string }) => patch<any>(`/api/carts/${id}/date`, body),
  update: (id: string, body: unknown) => patch<any>(`/api/carts/${id}`, body),
  delete: (id: string) => del<void>(`/api/carts/${id}`),
  liveStatus: (id: string) => get<{ id: string; liveStatus: any; lastActivity: string }>(`/api/carts/${encodeURIComponent(id)}/live`),
  heartbeat: (id: string, body: { action: string; field?: string; section?: string }) =>
    fetch(`/api/public/carts/${encodeURIComponent(id)}/heartbeat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), keepalive: true
    }).catch(() => {}),
  markLeft: (id: string) =>
    fetch(`/api/public/carts/${encodeURIComponent(id)}/left`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: "{}", keepalive: true
    }).catch(() => {})
};

// ── Public Orders ────────────────────────────────────────
// Raw fetch so we don't pick up the Authorization header (no auth context for
// embed-form customers) and don't trigger request()'s 401 → reload behavior.
export const publicOrdersApi = {
  create: async (body: unknown) => {
    const res = await fetchWithApiFailover("/api/public/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, typeof payload?.error === "string" ? payload.error : "Order failed.");
    }
    return snakeToCamel<{
      id: string;
      amount: number;
      currency: string;
      crossSellLines: any[];
      upsellOffer?: {
        companionId?: string;
        productId: string;
        packageId?: string;
        packageName?: string;
        packageQuantity?: number;
        quantity: number;
        unitPrice: number;
        amount: number;
      } | null;
      upsellToken?: string | null;
      // True when the order was held for manual review (possible duplicate). The
      // form uses this to skip the landing-page redirect (and its Facebook pixel).
      reviewHold?: boolean;
    }>(await res.json());
  },
  acceptUpsell: async (orderId: string, body: { token: string }) => {
    const res = await fetchWithApiFailover(`/api/public/orders/${encodeURIComponent(orderId)}/upsell`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, typeof payload?.error === "string" ? payload.error : "Upsell failed.");
    }
    return snakeToCamel<{ id: string; amount: number; currency: string; crossSellLines: any[] }>(await res.json());
  }
};

// ── Pay Structures ───────────────────────────────────────
export const payStructuresApi = {
  list: () => get<any[]>("/api/pay-structures"),
  save: (body: unknown) => post<any>("/api/pay-structures", body),
  delete: (userId: string) => del<{ message: string; removed: number }>(`/api/pay-structures/${userId}`)
};

// ── Sales Teams ──────────────────────────────────────────
export const salesTeamsApi = {
  list: () => get<any[]>("/api/sales-teams"),
  performance: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<{ rows: any[]; summary: any }>(`/api/sales-teams/performance${qs}`);
  },
  logManagerAction: (id: string, body: unknown) => post<any>(`/api/sales-teams/${id}/manager-actions`, body),
  create: (body: unknown) => post<any>("/api/sales-teams", body),
  update: (id: string, body: unknown) => patch<any>(`/api/sales-teams/${id}`, body),
  syncAgentAssignments: (id: string) =>
    post<{ teamId: string; teamName: string; userIds: string[]; agentIds: string[]; userCount: number; agentCount: number; mode: string }>(
      `/api/sales-teams/${id}/sync-agent-assignments`,
      {}
    ),
  delete: (id: string) => del<void>(`/api/sales-teams/${id}`)
};

// ── Penalties ────────────────────────────────────────────
export const penaltiesApi = {
  list: () => get<any[]>("/api/penalties"),
  create: (body: unknown) => post<any>("/api/penalties", body),
  delete: (id: string) => del<void>(`/api/penalties/${id}`)
};

export { ApiError };
