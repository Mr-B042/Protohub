// ProtoHub API client
// All requests go through `request()` which attaches the Bearer token
// and auto-refreshes if the token has expired (401).

import { auth, type AuthSessionSnapshot } from "./auth";
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

export type AuthRefreshResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing" | "invalid" | "transient";
      session: AuthSessionSnapshot;
      status?: number;
      message?: string;
    };

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

// ── Preview read-only ──────────────────────────────────────
// While the Owner is previewing a role, every screen shows REAL data - which is
// the point, since an empty screen tells you nothing about layout under load.
// The risk is that clicking anything then changes a real order.
//
// Enforced here rather than by disabling buttons: there are hundreds of write
// paths and one of them would always be missed. Every non-GET goes through this
// function, so a single check covers all of them, including any added later.
let _previewReadOnly = false;
export function setApiPreviewReadOnly(readOnly: boolean) {
  _previewReadOnly = readOnly;
}
export class PreviewReadOnlyError extends Error {
  constructor() {
    super("Preview is read-only. Turn it off in the preview bar to make real changes.");
    this.name = "PreviewReadOnlyError";
  }
}

// ── Core request helper ────────────────────────────────────
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
  transientAttempt = 0
): Promise<T> {
  // Reads always pass. Auth endpoints pass too - refreshing a token or signing
  // out is not a change to the business.
  if (_previewReadOnly && method !== "GET" && !SESSION_START_ENDPOINTS.has(path) && !path.startsWith("/api/auth/")) {
    throw new PreviewReadOnlyError();
  }
  const isSessionStartEndpoint = SESSION_START_ENDPOINTS.has(path);
  let token = auth.getAccessToken();
  if (token && !isSessionStartEndpoint && auth.isAccessTokenExpiringWithin(PRE_REQUEST_REFRESH_SKEW_MS)) {
    const refresh = await refreshAuthSession();
    if (refresh.ok) {
      token = auth.getAccessToken();
    } else if (auth.isAccessTokenExpired(30_000)) {
      if (refresh.reason === "invalid" || refresh.reason === "missing") {
        if (auth.clearIfSessionMatches(refresh.session)) {
          throw new ApiError(401, "Your session expired. Please sign in again.");
        }
        token = auth.getAccessToken();
      } else {
        throw new ApiError(503, "Could not refresh your session right now. Please retry in a moment - you have not been logged out.");
      }
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
    if (!auth.sessionMatches(refreshed.session)) {
      return request<T>(method, path, body, true, transientAttempt);
    }
    if (refreshed.reason === "transient") {
      throw new ApiError(503, "Could not refresh your session right now. Please retry in a moment - you have not been logged out.");
    }
    if (refreshed.reason === "invalid" && !auth.isAccessTokenExpired(30_000)) {
      throw new ApiError(503, "Could not refresh your session right now. Please retry in a moment - you have not been logged out.");
    }
    auth.clearIfSessionMatches(refreshed.session);
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
    const session = auth.getSessionSnapshot();
    const { accessToken, refreshToken } = session;
    if (!refreshToken) return { ok: false, reason: "missing", session };
    let lockAcquired = acquireAuthRefreshLock();
    if (!lockAcquired) {
      const otherTabRefreshed = await waitForOtherTabRefresh(accessToken, refreshToken);
      if (otherTabRefreshed) return { ok: true };
      lockAcquired = acquireAuthRefreshLock();
      if (!lockAcquired) {
        return { ok: false, reason: "transient", session, message: "Another browser tab is refreshing your session." };
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
          session,
          status: res.status,
          message: extractErrorMessage(payload, res.statusText || "Session refresh failed.")
        };
      }
      const data = await res.json();
      if (!data?.accessToken || !data?.refreshToken) {
        return { ok: false, reason: "transient", session, message: "Session refresh response was incomplete." };
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
      // A login or another tab may have installed a newer session while this
      // request was in flight. Never overwrite that session with stale tokens.
      if (user && auth.sessionMatches(session)) {
        auth.save(data.accessToken, data.refreshToken, user);
      }
      return { ok: true };
    } catch (error: any) {
      return { ok: false, reason: "transient", session, message: error?.message ?? "Session refresh failed." };
    } finally {
      if (lockAcquired) releaseAuthRefreshLock();
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function ensureFreshAuthSession(skewMs = BACKGROUND_REFRESH_SKEW_MS): Promise<AuthRefreshResult> {
  if (!auth.getAccessToken()) {
    return { ok: false, reason: "missing", session: auth.getSessionSnapshot() };
  }
  if (!auth.isAccessTokenExpiringWithin(skewMs)) return { ok: true };
  return refreshAuthSession();
}

const get  = <T>(path: string)            => request<T>("GET",    path);
const post = <T>(path: string, body: unknown) => request<T>("POST",   path, body);
const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);
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
  presence: () => get<{
    serverTime: string;
    users: Array<{ id: string; active: boolean; lastSeenAt?: string | null }>;
  }>("/api/users/presence"),
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
export type PersonalDeliveryAgentRow = {
  id: string;
  agentCode: string;
  fullName: string;
  phone: string;
  whatsappPhone?: string | null;
  email?: string | null;
  state?: string | null;
  city?: string | null;
  residentialAddress?: string | null;
  photoUrl?: string | null;
  serviceAreas: string[];
  serviceRadiusKm?: number | null;
  transportMethod?: string | null;
  vehicleModel?: string | null;
  vehiclePlate?: string | null;
  accountStatus: string;
  kycStatus: string;
  trustLevel: string;
  availability: string;
  maxStockUnits?: number | null;
  maxCodExposure?: number | null;
  maxActiveOrders?: number | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  approvedAt?: string | null;
  probationEndsAt?: string | null;
  kycExpiresAt?: string | null;
  restrictionReason?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PdaOverviewAgent = {
  id: string; agentCode: string; fullName: string; phone: string; photoUrl?: string | null;
  accountStatus: string; kycStatus: string; availability: string; state: string;
  serviceArea: string; serviceRadiusKm: number | null;
  activeOrders: number; inProgress: number;
  inventoryUnits: number; inventoryValue: number;
  codHeld: number; codOrders: number;
  /** null = no closed orders yet, which is not the same as a 0% rate. */
  performancePct: number | null;
};

export type PersonalDeliveryAgentOverview = {
  pendingMigration?: boolean;
  totals: {
    totalAgents: number;
    operational: number;
    pendingApplications: number;
    restricted: number;
    terminated: number;
    rejected: number;
    availableNow: number;
    onProbation: number;
    kycExpiringSoon: number;
    kycItemsOutstanding: number;
    guarantorsOutstanding: number;
    inventoryHeld: number;
    inventoryAvailable: number;
    inventoryOutForDelivery: number;
    inventoryUnaccounted: number;
    stockInTransit: number;
    openStockReports: number;
    codOutstanding: number;
    agentsHoldingCash: number;
    ordersWithCashOutstanding: number;
    earningsAvailable: number;
    earningsPending: number;
    ordersAssignedToday: number;
    ordersAwaitingAcceptance: number;
    dispatchesInProgress: number;
    deliveredToday: number;
    failedToday: number;
    staleOpenOrders: number;
  } | null;
  byStatus?: Record<string, number>;
  /** Real day-over-day deltas; null where yesterday had nothing to compare to. */
  comparisons?: {
    ordersAssignedDeltaPct: number | null;
    deliveredDeltaPct: number | null;
    codCollectedDeltaPct: number | null;
    successRatePct: number | null;
  };
  kycBreakdown?: { verified: number; pending: number; incomplete: number; rejected: number };
  ordersToday?: { inProgress: number; awaitingCustomer: number; readyForPickup: number; delivered: number; failed: number };
  inventory?: { totalUnits: number; totalValue: number; unaccounted: number };
  codOverview?: { collectedToday: number; outstanding: number; overdue: number };
  agents?: PdaOverviewAgent[];
  // Capabilities that do not exist yet, named so the UI can say so rather than
  // showing a zero that would read as "nothing outstanding".
  unavailable?: Record<string, string>;
};

export type PdaKycItem = {
  id: string; itemKey: string; label: string; mandatory: boolean; status: string;
  filePath?: string | null; reviewedAt?: string | null; reviewNote?: string | null;
  rejectionReason?: string | null; fileName?: string | null; fileSizeBytes?: number | null;
};

export type PdaGuarantor = {
  id: string; slot: number; guarantorType?: string | null; fullName: string;
  relationship?: string | null; phone: string; whatsappPhone?: string | null;
  address?: string | null; occupation?: string | null;
  idDocumentPath?: string | null; photoPath?: string | null; signedFormPath?: string | null;
  consentGiven: boolean; verificationStatus: string; verificationNotes?: string | null;
  verifiedAt?: string | null; callScheduledAt?: string | null;
};

export type PdaDocument = {
  id: string; documentKey: string; label: string; version: string;
  signedFilePath?: string | null; uploadedAt?: string | null; status: string;
  approvedAt?: string | null; rejectionReason?: string | null;
  fileName?: string | null; fileSizeBytes?: number | null;
  acceptance?: PdaAgreementAcceptance | null;
  content?: PdaAgreementContent | null;
};

export type PdaAgreementSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

export type PdaAgreementContent = {
  key: string; title: string; shortTitle: string; purpose: string;
  summary: string[]; sections: PdaAgreementSection[];
  version: string; companyName: string; applicantName: string;
  reference: string; issuedOn: string; opening: string;
  declaration: string; governingLaw: string; contentHash: string;
};

export type PdaAgreementAcceptance = {
  typedName: string; acceptedAt: string; contentHash: string;
  declaration: string; companyName: string; applicantName: string;
  applicationReference: string; content: PdaAgreementContent;
};

export type PdaAgentDetail = {
  agent: PersonalDeliveryAgentRow & {
    verificationPhrase?: string | null; verificationPhraseIssuedAt?: string | null;
    applicantStatusToken?: string | null;
  };
  kycItems: PdaKycItem[];
  guarantors: PdaGuarantor[];
  documents: PdaDocument[];
  /** Every outstanding requirement. Empty means the application can be approved. */
  blockers: string[];
};

export type PdaAssignment = {
  id: string; orderId: string; agentId: string;
  assignmentStatus: string; offeredAt: string; declineReason?: string | null;
  customerContactStatus: string; lastContactAt?: string | null; customerReadyAt?: string | null;
  deliveryStatus: string; dispatchStartedAt?: string | null; expectedArrivalAt?: string | null;
  deliveredAt?: string | null; failureReason?: string | null; failureNote?: string | null;
  rescheduledTo?: string | null; rescheduleReason?: string | null; stockReserved: boolean;
  deliveryFee: number; feeStatus: string;
  amountCollected?: number | null; paymentMethod?: string | null; proofType?: string | null;
  order?: {
    id: string; customer: string; phone: string; address?: string | null; state?: string | null;
    productName?: string | null; quantity?: number | null; amount: number;
  } | null;
};

export type PdaMySummary = {
  agent: {
    id: string; fullName: string; agentCode: string; accountStatus: string;
    trustLevel: string; availability: string; probationEndsAt?: string | null;
  };
  counts: {
    awaitingAcceptance: number; awaitingCustomerConfirmation: number; readyToDispatch: number;
    inProgress: number; rescheduled: number; deliveredToday: number;
  };
  /** null values mean "not built yet", never "zero" - see the route comment. */
  /** The agent's OWN money only - never any company-wide figure. */
  wallet: { available: number; pending: number; codToRemit: number };
};

export type PdaCodRow = {
  assignmentId: string; orderId: string; customer?: string | null; orderValue: number;
  amountCollected: number; paymentMethod?: string | null; deliveryFee: number;
  /** Always the FULL collected amount - never reduced by the agent's fee. */
  amountDue: number; amountRemitted: number; difference: number;
  reconciliationStatus: string; earningStatus: string; deliveredAt?: string | null;
};

export type PdaCodView = {
  position: {
    outstanding: number; pendingEarnings: number; availableEarnings: number;
    deliveredOrders: number; ordersWithCashOutstanding: number;
  };
  rows: PdaCodRow[];
  remittances: any[];
  payouts: any[];
};

export type PdaWallet = {
  codToRemit: number; ordersWithCashOutstanding: number;
  availableEarnings: number; pendingEarnings: number;
  recentPayouts: Array<{ amount: number; paid_at: string; reference?: string | null }>;
  codLimit: number | null;
};

export type PdaDispatchRow = {
  id: string; orderId: string; customer?: string | null; state?: string | null;
  productName?: string | null; orderValue: number;
  agentId: string; agentName?: string | null; agentPhone?: string | null; agentAvailability?: string | null;
  assignmentStatus: string; customerContactStatus: string; deliveryStatus: string;
  declineReason?: string | null; failureReason?: string | null;
  deliveryFee: number; expectedArrivalAt?: string | null; dispatchStartedAt?: string | null;
  deliveredAt?: string | null; rescheduledTo?: string | null; lastUpdatedAt?: string | null;
  /** Management only - a rep monitoring a delivery never receives these. */
  amountCollected?: number | null; amountRemitted?: number; reconciliationStatus?: string;
};

export type PdaCandidateView = {
  order: { id: string; customer: string; state?: string | null; productName?: string | null; quantity?: number | null; amount: number };
  candidates: Array<{ agentId: string; fullName: string; eligible: boolean; reasons: string[]; score: number }>;
};

export type PdaFeeRule = {
  id: string; scope: string; matchValue?: string | null;
  distanceMinKm?: number | null; distanceMaxKm?: number | null;
  fee: number; sameDaySurcharge: number; active: boolean; note?: string | null;
};

export type PdaIncident = {
  id: string; agent_id: string; order_id?: string | null; incident_type: string;
  severity: string; description: string; amount_at_risk: number; status: string;
  resolution?: string | null; final_decision?: string | null;
  reported_by_name?: string | null; created_at: string; resolved_at?: string | null;
};

export type PdaReportRow = {
  agentId: string; fullName: string; agentCode: string; accountStatus: string;
  trustLevel: string; state?: string | null;
  ordersOffered: number; ordersAccepted: number; ordersDeclined: number;
  /** null means no data yet - never conflate that with 0%. */
  acceptanceRatePct: number | null;
  delivered: number; failed: number; deliveryRatePct: number | null; rescheduled: number;
  cashOutstanding: number; earningsAvailable: number; earningsPaid: number;
  openIncidents: number; amountAtRisk: number;
  unitsHeld: number; unitsUnaccounted: number;
};

export type PdaSettings = {
  probationDays: number;
  probationMaxStock: number; probationMaxCod: number; probationMaxActiveOrders: number;
  verifiedMaxStock: number; verifiedMaxCod: number; verifiedMaxActiveOrders: number;
  trustedMaxStock: number; trustedMaxCod: number; trustedMaxActiveOrders: number;
  staleOrderHours: number; remittanceGraceDays: number;
  workingHoursStart: string; workingHoursEnd: string; kycValidMonths: number;
};

export type PdaApplicationRow = {
  id: string; applicationId: string; fullName: string; phone: string; location: string; state: string;
  photoUrl?: string | null; status: string; accountStatus: string;
  kycApproved: number; kycTotal: number; kycPct: number;
  /** What the APPLICANT supplied. kycPct above is what the reviewer approved -
   *  it reads 0% for everyone until a review happens, so only these separate a
   *  complete application from an empty one. */
  kycSupplied: number; kycSuppliedPct: number; formComplete: boolean; missingItems: string[];
  guarantorStatus: string; guarantorsVerified: number; guarantorsTotal: number;
  documentsPending: number; submittedOn: string; approvedAt?: string | null;
  submittedVia?: string | null; applicationLinkId?: string | null; statusReason?: string | null;
  blockers: string[];
};

export type PdaApplicationsView = {
  rows: PdaApplicationRow[];
  counts: {
    total: number; submitted: number; kycIncomplete: number; guarantorPending: number;
    readyForApproval: number; approvedThisMonth: number;
    /** null when there is no prior month to compare against. */
    approvedDeltaVsLastMonth: number | null;
  };
};

export type PdaNote = { id: string; body: string; authorName?: string | null; createdAt: string };
export type PdaActivityEntry = { label: string; at: string; by?: string | null; tone: "done" | "pending" };

export type PdaGuarantorFull = PdaGuarantor & {
  email?: string | null; workplace?: string | null; yearsKnown?: string | null;
  referenceStatement?: string | null; preferredContactTime?: string | null;
  callAttempts: number; lastAttemptAt?: string | null; assignedToName?: string | null;
};

export type PdaGuarantorQueueRow = PdaGuarantorFull & {
  agentId: string; applicantName?: string | null; applicationId: string; applicantState: string;
};

export type PdaDocumentViewRow = {
  key: string; kind: "kyc" | "agreement"; id: string;
  label: string; subtitle: string;
  fileName?: string | null; fileSizeBytes?: number | null; path?: string | null;
  status: string; reviewedByName?: string | null; reviewedAt?: string | null;
  hasElectronicAcceptance?: boolean;
};

export type PdaVerificationCategory = {
  category: string; detail: string; status: string;
  reviewedByName?: string | null; reviewedAt?: string | null;
};

export type PdaReviewView = {
  agent: PersonalDeliveryAgentRow & {
    verificationPhrase?: string | null; applicationId: string; applicantStatusToken?: string | null;
  };
  progress: { approved: number; total: number; pct: number };
  kycItems: PdaKycItem[];
  guarantors: PdaGuarantorFull[];
  documents: PdaDocument[];
  notes: PdaNote[];
  activity: PdaActivityEntry[];
  documentsView: PdaDocumentViewRow[];
  verificationSummary: PdaVerificationCategory[];
  blockers: string[];
  summary: { submittedOn: string; lastUpdated: string; source: string };
};

export type PdaGuarantorDetail = {
  guarantor: PdaGuarantorFull;
  applicant: { id: string; fullName: string; phone: string; applicationId: string } | null;
  notes: PdaNote[];
  activity: PdaActivityEntry[];
};

export type PdaActiveAgentRow = {
  id: string; agentCode: string; fullName: string; phone: string; location: string; state: string;
  accountStatus: string; availability: string; trustLevel: string;
  transportMethod?: string | null; hasPortalLogin?: boolean;
  vehicleModel?: string | null; vehiclePlate?: string | null;
  joinedAt: string; deliveries: number; deliveriesThisMonth: number;
  /** Delivery success out of 5. NOT a customer rating - none are collected. Null until they close an order. */
  performanceScore: number | null;
  deliveryRatePct: number | null;
  earningsThisMonth: number; activeOrders: number;
};

export type PdaActiveAgentsView = {
  rows: PdaActiveAgentRow[];
  counts: {
    totalActive: number; joinedThisMonth: number; onlineNow: number; onDelivery: number;
    deliveriesThisMonth: number; deliveriesDeltaPct: number | null;
    averageScore: number | null; ratedAgents: number;
    paidThisMonth: number; paidDeltaPct: number | null;
  };
};

export type PdaDispatchSummary = {
  counts: {
    total: number; confirmed: number; dispatched: number; pendingDispatch: number;
    delivered: number; cancelled: number; cod: number;
    totalDeltaPct: number | null; confirmedDeltaPct: number | null; dispatchedDeltaPct: number | null;
    pendingDeltaPct: number | null; cancelledDeltaPct: number | null; codDeltaPct: number | null;
  };
  topAgents: Array<{ agentId: string; fullName: string; deliveries: number }>;
  recentActivity: Array<{ label: string; at: string; kind: string }>;
  agentsOnline: number;
};

export type PdaInventoryAgentRow = {
  agentId: string; fullName: string; phone: string; location: string; state: string; accountStatus: string;
  productsHeld: number; totalUnits: number; available: number; reserved: number;
  outForDelivery: number; damagedMissing: number; stockValue: number;
  openIssues: number;
  /** null = never reconciled. A movement is not a count. */
  lastCountAt: string | null;
};

export type PdaInventoryOverview = {
  counts: {
    agentsHoldingStock: number; totalUnits: number; available: number; reserved: number;
    outForDelivery: number; damagedMissing: number; inTransit: number;
    inTransitDeltaPct: number | null; totalValue: number; openDiscrepancies: number;
  };
  agents: PdaInventoryAgentRow[];
  lowStock: Array<{ productId: string; available: number; floor: number }>;
  recentActivity: Array<{ id: string; movement: string; quantity: number; productId: string; productName?: string | null; agentName: string; at: string }>;
};

export type PdaLedgerRow = {
  id: string; at: string; movement: string; productId: string; productName?: string | null;
  agentId: string; agentName: string; location: string;
  quantity: number; balanceAfter: number;
  orderId?: string | null; transferId?: string | null; note?: string | null; recordedByName: string;
};

export type PdaStockLedgerView = {
  rows: PdaLedgerRow[];
  counts: {
    total: number; received: number; issued: number; reserved: number; delivered: number;
    returned: number; adjusted: number;
    totalDeltaPct: number | null; receivedDeltaPct: number | null; issuedDeltaPct: number | null;
    reservedDeltaPct: number | null; deliveredDeltaPct: number | null; returnedDeltaPct: number | null;
  };
};

export type PdaCodAgentRow = {
  agentId: string; agentCode: string; fullName: string; agentState: string;
  ordersDelivered: number; codCollected: number;
  /** null - Protohub does not record refunds. Not the same as zero refunds. */
  refunds: number | null;
  netCollected: number; remitted: number; pending: number; status: string;
};

export type PdaCodOverview = {
  counts: {
    collected: number; collectedDeltaPct: number | null;
    toRemit: number; remitted: number; remittedDeltaPct: number | null;
    pending: number; overdue: number;
    discrepancyAmount: number; discrepancyCases: number;
    collectionRatePct: number | null; graceDays: number;
  };
  agents: PdaCodAgentRow[];
  topAgents: Array<{ agentId: string; fullName: string; amount: number }>;
  remittances: Array<{ id: string; agentId: string; agentName: string; amount: number; method: string; reference?: string | null; receivedAt: string; receivedByName?: string | null }>;
  discrepancies: Array<{ id: string; kind: "incident" | "reconciliation"; agentName: string; orderId?: string | null; amount: number; detail: string; status: string; at: string }>;
  recentActivity: Array<{ label: string; at: string; kind: string }>;
};

export type PdaAgentRemittance = {
  agent: { id: string; agentCode: string; fullName: string; phone: string; location: string;
    bankName?: string | null; bankAccountNumber?: string | null; bankAccountName?: string | null };
  stats: {
    ordersDelivered: number; codCollected: number; refunds: number | null;
    expectedRemittance: number; amountRemitted: number; outstanding: number;
    graceEndsAt: string | null; daysLeft: number | null; graceDays: number;
  };
  orders: Array<{
    assignmentId: string; orderId: string; customer?: string | null; phone?: string | null;
    deliveredAt?: string | null; codCollected: number; refund: number | null;
    amountDue: number; amountRemitted: number; remittanceStatus: string; paymentStatus: string;
  }>;
};

export type PdaPaymentsView = {
  rows: Array<{
    id: string; paymentCode: string; agentId: string; agentName: string; agentCode: string;
    amount: number; method: string; reference?: string | null; receivedAt: string;
    recordedByName: string; status: string; verifiedByName?: string | null;
  }>;
  summary: {
    totalRemitted: number; pending: number; rejected: number;
    topAgents: Array<{ agentId: string; fullName: string; amount: number }>;
  };
};

export type PdaCodDiscrepancyView = {
  rows: Array<{
    id: string; code: string; agentId: string; agentName: string; agentCode: string;
    orderId?: string | null; customerName?: string | null; discrepancyType: string;
    expected: number; actual: number; variance: number; status: string;
    note?: string | null; resolutionNote?: string | null; createdAt: string;
  }>;
  stats: {
    cases: number; totalAmount: number; pending: number; resolved: number;
    overpayment: number; underpayment: number;
    byType: Array<{ type: string; amount: number }>;
    topAgents: Array<{ agentId: string; fullName: string; amount: number }>;
  };
};

export type PdaIncidentRow = {
  id: string; code: string; agentId: string; agentName: string; agentCode: string; agentState: string;
  orderId?: string | null; incidentType: string; severity: string; status: string;
  description: string; amountAtRisk: number; reportedByName?: string | null;
  resolution?: string | null; createdAt: string; resolvedAt?: string | null;
};

export type PdaIncidentsOverview = {
  rows: PdaIncidentRow[];
  counts: {
    total: number; open: number; inProgress: number; resolved: number; closed: number;
    totalDeltaPct: number | null; openDeltaPct: number | null; inProgressDeltaPct: number | null;
    resolvedDeltaPct: number | null; closedDeltaPct: number | null;
  };
  byType: Array<{ label: string; count: number }>;
  byPriority: Array<{ label: string; count: number }>;
  recentActivity: Array<{ code: string; label: string; agentName: string; at: string; resolved: boolean }>;
};

export type PdaGeneratedReport = {
  id: string; code: string; name: string; category: string; description?: string | null;
  dateFrom?: string | null; dateTo?: string | null; status: string; rowCount?: number | null;
  generatedByName: string; generatedByRole: string; generatedAt: string;
  downloadedCount: number; isScheduled: boolean;
};

export type PdaReportsView = {
  rows: PdaGeneratedReport[];
  counts: {
    total: number; generated: number; scheduled: number; downloaded: number; failed: number;
    totalDeltaPct: number | null; generatedDeltaPct: number | null; scheduledDeltaPct: number | null;
    downloadedDeltaPct: number | null; failedDeltaPct: number | null;
  };
  byCategory: Array<{ label: string; count: number }>;
};

export type PdaSettingsGroup = {
  key: string; title: string; description: string; bullets: string[];
  /** The number of settings that ACTUALLY exist in this group. */
  settings: number;
  configurable: boolean; note?: string; managedOn?: string;
};

export type PdaSettingsOverview = {
  groups: PdaSettingsGroup[];
  counts: {
    configurableTotal: number; groupsConfigurable: number; groupsFixed: number;
    feeRules: number; agents: number; graceDays: number; probationDays: number;
  };
  lastUpdatedAt: string | null;
};

export type PdaBlockedApplicant = {
  id: string; phoneDigits: string; displayPhone?: string | null; fullName?: string | null;
  reason: string; agentId?: string | null; applicationLinkId?: string | null;
  blockedByName?: string | null; createdAt: string;
};

export type PdaApplicationLink = {
  id: string; token: string; label?: string | null; active: boolean;
  expiresAt?: string | null; maxSubmissions?: number | null; submissionCount: number;
  createdByName?: string | null; createdAt: string; revokedAt?: string | null;
};

export const personalDeliveryAgentsApi = {
  detail: (id: string) => get<PdaAgentDetail>(`/api/personal-delivery-agents/${id}`),
  applications: () => get<PdaApplicationsView>("/api/personal-delivery-agents/applications"),
  applicationLinks: () => get<{ rows: PdaApplicationLink[] }>("/api/personal-delivery-agents/application-links"),
  createApplicationLink: (body: unknown) =>
    post<{ row: { id: string; token: string; label?: string | null; expiresAt?: string | null } }>("/api/personal-delivery-agents/application-links", body),
  revokeApplicationLink: (id: string) =>
    post<{ ok: boolean }>(`/api/personal-delivery-agents/application-links/${id}/revoke`, {}),
  activeAgents: () => get<PdaActiveAgentsView>("/api/personal-delivery-agents/active-agents"),
  linkPortalLogin: (id: string, userId: string | null) =>
    post<{ ok: boolean; linkedTo?: string; unlinked?: boolean }>(`/api/personal-delivery-agents/${id}/link-login`, { userId: userId ?? "" }),
  inventoryOverview: () => get<PdaInventoryOverview>("/api/personal-delivery-agents/inventory-overview"),
  codOverview: () => get<PdaCodOverview>("/api/personal-delivery-agents/cod-overview"),
  incidentsOverview: () => get<PdaIncidentsOverview>("/api/personal-delivery-agents/incidents-overview"),
  reportsList: () => get<PdaReportsView>("/api/personal-delivery-agents/reports-list"),
  createReport: (body: unknown) => post<{ row: any }>("/api/personal-delivery-agents/reports-list", body),
  markReportDownloaded: (id: string) => post<{ ok: boolean }>(`/api/personal-delivery-agents/reports-list/${id}/downloaded`, {}),
  settingsOverview: () => get<PdaSettingsOverview>("/api/personal-delivery-agents/settings-overview"),
  agentRemittance: (agentId: string) => get<PdaAgentRemittance>(`/api/personal-delivery-agents/cod/agent/${agentId}/remittance`),
  codPayments: () => get<PdaPaymentsView>("/api/personal-delivery-agents/cod/payments"),
  setPaymentStatus: (paymentId: string, body: unknown) =>
    post<{ row: any; reversed: boolean }>(`/api/personal-delivery-agents/cod/payments/${paymentId}/status`, body),
  codDiscrepancies: () => get<PdaCodDiscrepancyView>("/api/personal-delivery-agents/cod/discrepancies"),
  createCodDiscrepancy: (body: unknown) => post<{ row: any }>("/api/personal-delivery-agents/cod/discrepancies", body),
  resolveCodDiscrepancy: (id: string, body: unknown) =>
    post<{ row: any }>(`/api/personal-delivery-agents/cod/discrepancies/${id}/resolve`, body),
  stockLedger: () => get<PdaStockLedgerView>("/api/personal-delivery-agents/stock-ledger"),
  dispatchSummary: () => get<PdaDispatchSummary>("/api/personal-delivery-agents/dispatch-summary"),
  applicationReview: (id: string) => get<PdaReviewView>(`/api/personal-delivery-agents/applications/${id}/review`),
  guarantorQueue: () => get<{ rows: PdaGuarantorQueueRow[]; counts: { total: number; outstanding: number } }>("/api/personal-delivery-agents/guarantors/queue"),
  guarantorDetail: (id: string) => get<PdaGuarantorDetail>(`/api/personal-delivery-agents/guarantors/${id}/detail`),
  logGuarantorCall: (id: string, reached: boolean) =>
    post<{ row: PdaGuarantorQueueRow }>(`/api/personal-delivery-agents/guarantors/${id}/call-attempt`, { reached }),
  addNote: (body: { agentId?: string; guarantorId?: string; body: string }) =>
    post<{ row: PdaNote }>("/api/personal-delivery-agents/notes", body),
  reviewKycItem: (itemId: string, body: unknown) =>
    patch<{ row: PdaKycItem }>(`/api/personal-delivery-agents/kyc-items/${itemId}`, body),
  issueVerificationPhrase: (id: string) =>
    post<{ phrase: string }>(`/api/personal-delivery-agents/${id}/verification-phrase`, {}),
  saveGuarantor: (id: string, body: unknown) =>
    post<{ row: PdaGuarantor }>(`/api/personal-delivery-agents/${id}/guarantors`, body),
  verifyGuarantor: (guarantorId: string, body: unknown) =>
    patch<{ row: PdaGuarantor }>(`/api/personal-delivery-agents/guarantors/${guarantorId}`, body),
  seedDocuments: (id: string) =>
    post<{ seeded: number }>(`/api/personal-delivery-agents/${id}/documents/seed`, {}),
  reviewDocument: (documentId: string, body: unknown) =>
    patch<{ row: PdaDocument }>(`/api/personal-delivery-agents/documents/${documentId}`, body),
  approve: (id: string) =>
    post<{ row: PersonalDeliveryAgentRow }>(`/api/personal-delivery-agents/${id}/approve`, {}),
  applicantStatusLink: (id: string, body: { origin: string; send?: "whatsapp" }) =>
    post<{ token: string; url: string; phone: string | null; sent: { ok: boolean; error?: string } | null }>(
      `/api/personal-delivery-agents/${id}/status-link`, body),
  rejectApplication: (id: string, body: { reason: string; blockApplicant: boolean }) =>
    post<{ ok: boolean; blocked: boolean }>(`/api/personal-delivery-agents/${id}/reject`, body),
  blockedApplicants: () =>
    get<{ rows: PdaBlockedApplicant[] }>("/api/personal-delivery-agents/blocked-applicants"),
  unblockApplicant: (blockId: string) =>
    del<{ ok: boolean }>(`/api/personal-delivery-agents/blocked-applicants/${blockId}`),
  setStatus: (id: string, body: unknown) =>
    post<{ row: PersonalDeliveryAgentRow }>(`/api/personal-delivery-agents/${id}/status`, body),
  uploadMedia: (dataUrl: string) =>
    post<{ path: string }>("/api/personal-delivery-agents/media/upload", { dataUrl }),
  signedMediaUrl: (path: string) =>
    get<{ url: string }>(`/api/personal-delivery-agents/media/signed?path=${encodeURIComponent(path)}`),
  assign: (id: string, body: unknown) => post<{ row: PdaAssignment }>(`/api/personal-delivery-agents/${id}/assign`, body),
  // The agent's own portal
  // agentId previews another agent's portal (management only, read-only).
  mySummary: (agentId?: string) =>
    get<PdaMySummary>(`/api/personal-delivery-agents/my/summary${agentId ? `?agentId=${agentId}` : ""}`),
  myOrders: (agentId?: string) =>
    get<{ rows: PdaAssignment[] }>(`/api/personal-delivery-agents/my/orders${agentId ? `?agentId=${agentId}` : ""}`),
  respond: (assignmentId: string, body: unknown) =>
    post<{ row: PdaAssignment }>(`/api/personal-delivery-agents/my/orders/${assignmentId}/respond`, body),
  setContact: (assignmentId: string, body: unknown) =>
    post<{ row: PdaAssignment }>(`/api/personal-delivery-agents/my/orders/${assignmentId}/contact`, body),
  dispatch: (assignmentId: string, body: unknown) =>
    post<{ row: PdaAssignment }>(`/api/personal-delivery-agents/my/orders/${assignmentId}/dispatch`, body),
  markDelivered: (assignmentId: string, body: unknown) =>
    post<{ row: PdaAssignment }>(`/api/personal-delivery-agents/my/orders/${assignmentId}/delivered`, body),
  markFailed: (assignmentId: string, body: unknown) =>
    post<{ row: PdaAssignment }>(`/api/personal-delivery-agents/my/orders/${assignmentId}/failed`, body),
  reschedule: (assignmentId: string, body: unknown) =>
    post<{ row: PdaAssignment; stockReleased: boolean }>(`/api/personal-delivery-agents/my/orders/${assignmentId}/reschedule`, body),
  setAvailability: (availability: string) =>
    post<{ availability: string }>("/api/personal-delivery-agents/my/availability", { availability }),
  // Inventory
  sendStock: (id: string, body: unknown) => post<{ row: any }>(`/api/personal-delivery-agents/${id}/stock/send`, body),
  agentStock: (id: string) => get<{ stock: any[]; ledger: any[]; transfers: any[] }>(`/api/personal-delivery-agents/${id}/stock`),
  myStock: (agentId?: string) =>
    get<{ stock: any[]; incoming: any[]; ledger: any[] }>(`/api/personal-delivery-agents/my/stock${agentId ? `?agentId=${agentId}` : ""}`),
  confirmTransfer: (transferId: string, body: unknown) =>
    post<{ received: number; short: boolean }>(`/api/personal-delivery-agents/my/transfers/${transferId}/confirm`, body),
  reportDiscrepancy: (body: unknown) =>
    post<{ row: any; note: string }>("/api/personal-delivery-agents/my/stock/discrepancy", body),
  reviewDiscrepancy: (discrepancyId: string, body: unknown) =>
    post<{ row: any }>(`/api/personal-delivery-agents/stock/discrepancies/${discrepancyId}/review`, body),
  // COD & Reconciliation
  agentCod: (id: string) => get<PdaCodView>(`/api/personal-delivery-agents/${id}/cod`),
  recordRemittance: (id: string, body: unknown) =>
    post<{ row: any; applied: number; unallocated: number; note?: string }>(`/api/personal-delivery-agents/${id}/remittances`, body),
  payEarnings: (id: string, body: unknown) =>
    post<{ row: any; orders: number; amount: number }>(`/api/personal-delivery-agents/${id}/earnings/pay`, body),
  myWallet: (agentId?: string) =>
    get<PdaWallet>(`/api/personal-delivery-agents/my/wallet${agentId ? `?agentId=${agentId}` : ""}`),
  // Orders & Dispatch
  assignments: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<{ rows: PdaDispatchRow[]; scope: "management" | "rep" }>(`/api/personal-delivery-agents/assignments${qs}`);
  },
  candidates: (orderId: string) =>
    get<PdaCandidateView>(`/api/personal-delivery-agents/assignments/candidates?orderId=${encodeURIComponent(orderId)}`),
  // Fees & Earnings
  feeRules: () => get<{ rows: PdaFeeRule[] }>("/api/personal-delivery-agents/fees/rules"),
  createFeeRule: (body: unknown) => post<{ row: PdaFeeRule }>("/api/personal-delivery-agents/fees/rules", body),
  deleteFeeRule: (ruleId: string) => del<{ ok: boolean }>(`/api/personal-delivery-agents/fees/rules/${ruleId}`),
  negotiations: () => get<{ rows: any[] }>("/api/personal-delivery-agents/fees/negotiations"),
  decideNegotiation: (id: string, body: unknown) =>
    post<{ ok: boolean }>(`/api/personal-delivery-agents/fees/negotiations/${id}/decide`, body),
  proposeFee: (assignmentId: string, body: unknown) =>
    post<{ row: any }>(`/api/personal-delivery-agents/my/orders/${assignmentId}/propose-fee`, body),
  // Incidents
  incidents: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<{ rows: PdaIncident[] }>(`/api/personal-delivery-agents/incidents${qs}`);
  },
  createIncident: (body: unknown) =>
    post<{ row: PdaIncident; agentSuspended: boolean }>("/api/personal-delivery-agents/incidents", body),
  updateIncident: (id: string, body: unknown) =>
    patch<{ row: PdaIncident }>(`/api/personal-delivery-agents/incidents/${id}`, body),
  // Reports & settings
  reports: () => get<{ rows: PdaReportRow[] }>("/api/personal-delivery-agents/reports"),
  settings: () => get<{ settings: PdaSettings }>("/api/personal-delivery-agents/settings"),
  saveSettings: (body: unknown) => put<{ settings: PdaSettings }>("/api/personal-delivery-agents/settings", body),
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<{ rows: PersonalDeliveryAgentRow[]; pendingMigration?: boolean }>(`/api/personal-delivery-agents${qs}`);
  },
  overview: () => get<PersonalDeliveryAgentOverview>("/api/personal-delivery-agents/overview"),
  create: (body: unknown) => post<{ row: PersonalDeliveryAgentRow }>("/api/personal-delivery-agents", body)
};

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
  // { [orderId]: ISO date the order was Failed/Cancelled }, from order_audit.
  closureDates: () => get<{ closedAt: Record<string, string> }>("/api/orders/closure-dates"),
  fieldEdits: (id: string) => get<any[]>(`/api/orders/${id}/field-edits`),
  followUpTasks: (id: string) => get<any[]>(`/api/orders/${id}/follow-up-tasks`),
  contactAttempts: (id: string) => get<any[]>(`/api/orders/${id}/contact-attempts`),
  logContactAttempt: (id: string, body: unknown) => post<any>(`/api/orders/${id}/contact-attempts`, body),
  // Raw fetch (not the JSON `request` helper) — this endpoint returns a PDF
  // buffer, not JSON, so it needs its own Authorization header + blob read.
  downloadReceipt: async (id: string): Promise<Blob> => {
    const token = auth.getAccessToken();
    const res = await fetchWithApiFailover(`/api/orders/${encodeURIComponent(id)}/receipt`, {
      method: "GET",
      cache: "no-store",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, extractErrorMessage(payload, res.statusText || "Could not download receipt."));
    }
    return res.blob();
  }
};

export const salesExpansionApi = {
  settings: () => get<any>("/api/sales-expansion/settings"),
  updateSettings: (body: unknown) => patch<any>("/api/sales-expansion/settings", body),
  context: (orderId: string) => get<any>(`/api/orders/${orderId}/sales-expansion-context`),
  submit: (orderId: string, body: unknown) => post<any>(`/api/orders/${orderId}/sales-expansion-attempts`, body),
  attempts: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return get<any[]>(`/api/sales-expansion/attempts${qs}`);
  },
  summary: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return get<any>(`/api/sales-expansion/summary${qs}`);
  },
  audit: (id: string, body: { status: "verified" | "flagged"; note: string }) => patch<any>(`/api/sales-expansion/attempts/${id}/audit`, body),
  voidForCorrection: (id: string, reason: string) => patch<any>(`/api/sales-expansion/attempts/${id}/correction`, { reason }),
  dailyCompliance: (params: { weekStart: string; repId?: string }) => {
    const qs = new URLSearchParams({ weekStart: params.weekStart });
    if (params.repId) qs.set("repId", params.repId);
    return get<{ weekStart: string; days: Array<{ date: string; eligibleCount: number; loggedCount: number }> }>(`/api/sales-expansion/daily-compliance?${qs.toString()}`);
  },
  setComplianceWaiver: (repId: string, weekStart: string, body: { active: boolean; reason: string }) =>
    put<any>(`/api/sales-expansion/compliance-waivers/${repId}/${weekStart}`, body)
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

export const managerBonusApi = {
  settings: () => get<any>("/api/manager-bonuses/settings"),
  summary: (weekStart: string, productIds?: string[]) => {
    const params = new URLSearchParams({ weekStart });
    if (productIds && productIds.length > 0) params.set("productIds", productIds.join(","));
    return get<any>(`/api/manager-bonuses/summary?${params.toString()}`);
  },
  updateSettings: (body: unknown) => patch<any>("/api/manager-bonuses/settings", body)
};

export const upsellBonusApi = {
  settings: () => get<any>("/api/upsell-bonuses/settings"),
  updateSettings: (body: unknown) => patch<any>("/api/upsell-bonuses/settings", body)
};

export const headOfSalesApi = {
  overview: (repId: string, weekStart?: string) => {
    const params = new URLSearchParams({ repId });
    if (weekStart) params.set("weekStart", weekStart);
    return get<any>(`/api/head-of-sales-rep/overview?${params.toString()}`);
  },
  scorecard: (repId: string, weekStart?: string) => {
    const params = new URLSearchParams({ repId });
    if (weekStart) params.set("weekStart", weekStart);
    return get<any>(`/api/head-of-sales-rep/scorecard?${params.toString()}`);
  },
  teamPerformance: (repId: string, weekStart?: string) => {
    const params = new URLSearchParams({ repId });
    if (weekStart) params.set("weekStart", weekStart);
    return get<any>(`/api/head-of-sales-rep/team-performance?${params.toString()}`);
  },
  upsellCrossSell: (repId: string, weekStart?: string) => {
    const params = new URLSearchParams({ repId });
    if (weekStart) params.set("weekStart", weekStart);
    return get<any>(`/api/head-of-sales-rep/upsell-cross-sell?${params.toString()}`);
  },
  repCoaching: (repId: string, selectedRepId?: string, weekStart?: string) => {
    const params = new URLSearchParams({ repId });
    if (selectedRepId) params.set("selectedRepId", selectedRepId);
    if (weekStart) params.set("weekStart", weekStart);
    return get<any>(`/api/head-of-sales-rep/rep-coaching?${params.toString()}`);
  },
  callReviews: (repId: string, selectedRepId: string) => {
    const params = new URLSearchParams({ repId, selectedRepId });
    return get<any>(`/api/head-of-sales-rep/call-reviews?${params.toString()}`);
  },
  logCallReview: (body: {
    repId: string; selectedRepId: string; customerName: string; calledAt: string;
    durationSeconds?: number; outcome: string; starScore?: number; reviewerNotes?: string;
  }) => post<any>("/api/head-of-sales-rep/call-reviews", body),
  coachingPlan: (repId: string, selectedRepId: string) => {
    const params = new URLSearchParams({ repId, selectedRepId });
    return get<any>(`/api/head-of-sales-rep/coaching-plan?${params.toString()}`);
  },
  addCoachingActionItem: (body: {
    repId: string; selectedRepId: string; description: string; targetCount?: number; dueDate?: string;
  }) => post<any>("/api/head-of-sales-rep/coaching-plan/action-items", body),
  updateCoachingActionItem: (itemId: string, body: {
    repId: string; status?: string; completedCount?: number; description?: string; targetCount?: number; dueDate?: string | null;
  }) => patch<any>(`/api/head-of-sales-rep/coaching-plan/action-items/${itemId}`, body),
  deleteCoachingActionItem: (itemId: string, repId: string) =>
    del<any>(`/api/head-of-sales-rep/coaching-plan/action-items/${itemId}?${new URLSearchParams({ repId }).toString()}`),
  initiatives: (repId: string, weekStart?: string) => {
    const params = new URLSearchParams({ repId });
    if (weekStart) params.set("weekStart", weekStart);
    return get<any>(`/api/head-of-sales-rep/initiatives?${params.toString()}`);
  },
  createInitiative: (body: {
    repId: string; title: string; description?: string; targetMetric?: string; startedAt?: string; targetDate?: string;
    initiativeType?: string; targetSegment?: string; priority?: string; expectedImpact?: string;
  }) => post<any>("/api/head-of-sales-rep/initiatives", body),
  updateInitiative: (initiativeId: string, body: {
    repId: string; title?: string; description?: string | null; status?: string; targetMetric?: string | null;
    startedAt?: string | null; targetDate?: string | null; outcomeSummary?: string | null; wasSuccessful?: boolean | null;
    initiativeType?: string; targetSegment?: string | null; customersOffered?: number; customersAccepted?: number;
    customersDelivered?: number; incrementalRevenue?: number; impactLevel?: string | null; priority?: string | null;
    expectedImpact?: string | null;
  }) => patch<any>(`/api/head-of-sales-rep/initiatives/${initiativeId}`, body),
  deleteInitiative: (initiativeId: string, repId: string) =>
    del<any>(`/api/head-of-sales-rep/initiatives/${initiativeId}?${new URLSearchParams({ repId }).toString()}`),
  initiativeLearnings: (initiativeId: string, repId: string) =>
    get<any>(`/api/head-of-sales-rep/initiatives/${initiativeId}/learnings?${new URLSearchParams({ repId }).toString()}`),
  addInitiativeLearning: (initiativeId: string, body: { repId: string; note: string; tag?: string }) =>
    post<any>(`/api/head-of-sales-rep/initiatives/${initiativeId}/learnings`, body),
  weeklyReport: (repId: string, weekStart?: string) => {
    const params = new URLSearchParams({ repId });
    if (weekStart) params.set("weekStart", weekStart);
    return get<any>(`/api/head-of-sales-rep/weekly-report?${params.toString()}`);
  },
  saveWeeklyReport: (body: {
    repId: string; weekStart: string; summaryWins?: string; summaryChallenges?: string; nextWeekPlan?: string;
  }) => put<any>("/api/head-of-sales-rep/weekly-report", body),
  submitWeeklyReport: (body: { repId: string; weekStart: string }) =>
    post<any>("/api/head-of-sales-rep/weekly-report/submit", body),
  bonusSettings: (repId: string) =>
    get<any>(`/api/head-of-sales-rep/bonus-settings?${new URLSearchParams({ repId }).toString()}`),
  updateBonusSettings: (body: { repId: string; currency?: string; tiers: any[] }) =>
    patch<any>("/api/head-of-sales-rep/bonus-settings", body),
  bonusPayouts: (repId: string, weekStart?: string) => {
    const params = new URLSearchParams({ repId });
    if (weekStart) params.set("weekStart", weekStart);
    return get<any>(`/api/head-of-sales-rep/bonus-payouts?${params.toString()}`);
  },
  saveBonusPayout: (body: {
    repId: string; weekStart: string; upsellImprovement?: boolean; initiativeSuccess?: boolean; notes?: string;
  }) => put<any>("/api/head-of-sales-rep/bonus-payouts", body),
  markBonusPaid: (body: { repId: string; weekStart: string }) =>
    post<any>("/api/head-of-sales-rep/bonus-payouts/mark-paid", body)
};

export const repWeeklyTargetsApi = {
  list: (weekStart: string) => get<any>(`/api/rep-weekly-targets?${new URLSearchParams({ weekStart }).toString()}`),
  save: (body: unknown) => patch<any>("/api/rep-weekly-targets", body)
};

export const managerDashboardAlertsApi = {
  stockMismatches: () => get<{ rows: any[] }>("/api/manager-dashboard/stock-mismatches")
};

export type RecoveryCandidateRow = {
  id: string; customer: string; phone: string; status: string;
  amount: number; currency: string;
  productName?: string | null; packageName?: string | null; quantity?: number | null;
  addOns?: Array<{ name: string; quantity: number }>;
  freeGifts?: Array<{ name: string; quantity: number }>;
  upgradedFrom?: number | null; upgradedTo?: number | null;
  location?: string | null; callOutcome?: string | null; response?: string | null;
  closedAt: string; createdAt: string; reason: string;
};
export type RecoveryCandidatesView = {
  rows: RecoveryCandidateRow[];
  cap: number; held: number; remaining: number; canClaim: boolean;
};

export const recoveryRepKpiApi = {
  candidates: (repId?: string) =>
    get<RecoveryCandidatesView>(`/api/recovery-rep-kpi/candidates${repId ? `?repId=${encodeURIComponent(repId)}` : ""}`),
  claimCandidate: (orderId: string, repId?: string) =>
    post<{ ok: boolean; held: number; cap: number; remaining: number }>(
      "/api/recovery-rep-kpi/claim", { orderId, repId }),
  summary: (params: { repId?: string; month?: string; dateFrom?: string; dateTo?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.repId) qs.set("repId", params.repId);
    if (params.dateFrom && params.dateTo) {
      qs.set("dateFrom", params.dateFrom);
      qs.set("dateTo", params.dateTo);
    } else if (params.month) {
      qs.set("month", params.month);
    }
    const suffix = qs.toString();
    return get<any>(`/api/recovery-rep-kpi/summary${suffix ? `?${suffix}` : ""}`);
  },
  updateSettings: (body: unknown) => patch<any>("/api/recovery-rep-kpi/settings", body)
};

export type RetentionDueStage = "satisfaction_check" | "review_referral" | "retention_sale" | "needs_resolution" | "win_back" | null;
export type RetentionPriorityBand = "critical" | "overdue" | "high_value" | "satisfaction_due" | "review_referral_due" | "revenue_opportunity";
export type RetentionLifecycleStage = "delivered" | "satisfaction_check" | "review_testimonial" | "referral" | "repeat_sale" | "win_back" | "needs_resolution";

export interface RetentionWorklistRow {
  orderId: string;
  customerName: string;
  phone: string;
  deliveredDate: string;
  daysSinceDelivery: number;
  dueStage: RetentionDueStage;
  lifecycleStage: RetentionLifecycleStage;
  stageEnteredDate: string;
  stageDueDate: string;
  overdueBy: number;
  priorityBand: RetentionPriorityBand;
  orderAmount: number;
  orderCurrency: string;
  productName: string;
  assignedRepId: string | null;
  assignedRepName: string | null;
  lastTouchpoint: {
    stage: string;
    loggedAt: string;
    satisfactionOutcome: string | null;
    reachStatus: string | null;
    customerResponse: string | null;
    nextAction: string | null;
    reviewCollected: boolean;
    referralCollected: boolean;
    retentionOutcome: string | null;
  } | null;
  lastContactAt: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  nextActionNote: string | null;
  followUpStatus: "scheduled" | "due" | "overdue" | null;
  discountOwed: boolean;
  reviewRequested: boolean;
  reviewCollected: boolean;
  referralRequested: boolean;
  referralCollected: boolean;
  doNotContact: boolean;
}

export interface RetentionCustomerRow {
  id: string;
  name: string;
  phone: string;
  city: string;
  state: string;
  customerSince: string;
  totalOrders: number;
  deliveredOrders: number;
  rejectedOrders: number;
  totalSpent: number;
  // Delivered-only, and excluding the first order (acquisition, not
  // retention) - so repeatRevenue can never exceed totalSpent.
  repeatOrders: number;
  repeatRevenue: number;
  firstOrderAmount: number;
  daysSinceLastOrder: number | null;
  lastOrderAmount: number;
  currency: string;
  lastOrderId: string;
  lastProduct: string;
  lastPackage: string;
  lastQuantity?: number;
  lastOrderDate: string;
  productsPurchased: string[];
  lifecycleStage: RetentionLifecycleStage;
  stageEnteredDate: string;
  stageDueDate: string;
  lastContactAt: string | null;
  nextAction: string;
  nextActionAt: string | null;
  nextActionOrderId: string;
  assignedRepId: string | null;
  assignedRepName: string | null;
  priorityBand: RetentionPriorityBand;
  complaintOpen: boolean;
  doNotContact: boolean;
  activeRetention: boolean;
  reviewStatus: "received" | "requested" | "not_requested";
  referralStatus: "received" | "requested" | "not_requested";
  repeatSaleStatus: string;
  status: "active" | "repeat_customer" | "high_value" | "unresolved_issue" | "do_not_contact";
  lastOutcome: string | null;
}

export interface RetentionBonusSummary {
  dateFrom: string;
  dateTo: string;
  userId: string;
  satisfactionChecksLogged: number;
  writtenReviewsCollected: number;
  videoTestimonialsCollected: number;
  referralsCollected: number;
  // Accepted repeat sales whose order has not delivered yet. The bonus vests
  // on delivery, so these are earned-but-not-yet-payable rather than lost.
  retentionSalesPendingDelivery?: number;
  retentionSalesConverted: Array<{ resultingOrderId: string; amount: number }>;
  breakdown: {
    satisfactionBonus: number;
    reviewBonus: number;
    videoBonus: number;
    referralBonus: number;
    retentionSaleBonus: number;
    total: number;
  };
}

export interface RetentionBonusSettings {
  satisfactionCheckBonus: number;
  writtenReviewBonus: number;
  videoTestimonialBonus: number;
  referralBonus: number;
  retentionSaleBonusPct: number;
  customerDiscountPct: number;
  highValueOrderThreshold: number;
  monthlyBonusTarget: number;
}

export interface RetentionTouchpointPayload {
  orderId: string;
  stage: "satisfaction_check" | "review_referral" | "retention_sale";
  reachStatus?: "reached" | "not_reached" | "not_reachable" | "wrong_number";
  customerResponse?: "satisfied" | "neutral" | "complaint";
  nextAction?: "request_review" | "request_referral" | "offer_another_product" | "schedule_follow_up" | "needs_resolution" | "not_interested" | "do_not_contact";
  nextActionAt?: string;
  nextActionNote?: string;
  callDurationSeconds?: number | null;
  // satisfaction_check
  satisfactionOutcome?: string;
  satisfactionNotes?: string;
  // review_referral
  reviewCollected?: boolean;
  reviewText?: string;
  reviewIsVideo?: boolean;
  mediaUrls?: string[];
  adPermissionGranted?: boolean;
  referralCollected?: boolean;
  referralContactName?: string;
  referralContactPhone?: string;
  customerDiscountOwed?: boolean;
  customerDiscountNote?: string;
  reviewRequested?: boolean;
  referralRequested?: boolean;
  // retention_sale
  offeredProductId?: string;
  offeredPackageId?: string;
  retentionOutcome?: "accepted" | "declined" | "no_response";
  resultingOrderId?: string;
}

export interface RetentionDashboardSummary {
  dateFrom: string;
  dateTo: string;
  kpis: {
    dueToday: number;
    overdue: number;
    contacted: number;
    issuesResolved: number;
    reviews: number;
    referrals: number;
    repeatCustomers: number;
    repeatSalesRevenue: number;
  };
  lifecyclePipeline: {
    delivered: number;
    satisfactionDue: number;
    reviewDue: number;
    referralDue: number;
    retentionSaleDue: number;
    winBack: number;
    needsResolution: number;
  };
  reviewsReferrals: {
    reviewsRequested: number;
    reviewsReceived: number;
    reviewConversionPct: number | null;
    referralsRequested: number;
    referralsReceived: number;
    referralConversionPct: number | null;
  };
  retentionRevenue: {
    repeatSalesRevenue: number;
    repeatCustomers: number;
    avgRepeatOrder: number;
    grossContribution: number;
    retentionRepCost: number;
    roi: number | null;
  };
  repPerformance: {
    tasksAssigned: number;
    tasksCompleted: number;
    completionRatePct: number;
    customersReached: number;
    contactRatePct: number;
    issuesResolved: number;
    reviewsReceived: number;
    referralsGenerated: number;
    repeatPurchases: number;
    retentionRevenue: number;
    avgRepeatOrder: number;
    roi: number | null;
    revenueOverTime: Array<{ label: string; current: number }>;
    revenueBySource: Array<{ label: string; amount: number; pct: number }>;
  };
  repBreakdown?: Array<{
    repId: string; repName: string; tasksAssigned: number; tasksCompleted: number; completionRatePct: number;
    issuesResolved: number; reviewConversionPct: number | null; referralConversionPct: number | null; retentionRevenue: number;
  }>;
  bonus: { earned: number; target: number; progressPct: number };
}

// One order, itemised: main product + upsell + cross-sell add-ons + free
// gifts. mainAmount is the order total minus the cross-sell lines, so main
// and add-ons always reconcile to `amount`.
export interface RetentionOrderBreakdown {
  orderId: string;
  product: string;
  package: string;
  quantity: number;
  mainAmount: number;
  crossSellTotal: number;
  amount: number;
  currency: string;
  deliveredDate: string | null;
  createdAt: string | null;
  status: string;
  crossSells: Array<{
    productId: string | null;
    productName: string;
    quantity: number;
    amount: number;
    addedByName: string | null;
    addedByRole: string | null;
    addedAt: string | null;
    selectionSource: string | null;
  }>;
  freeGifts: Array<{ productName: string; quantity: number; source: "package" | "added" }>;
  upsell: { fromQty: number | null; toQty: number | null; note: string | null } | null;
}

export interface RetentionCustomerDetail {
  customer: { name: string; phone: string; address: string; city: string; state: string; customerSince: string; status: string };
  summary: { totalOrders: number; totalSpent: number; delivered: number; wrongDamagedReportsCount: number; ltv: number };
  latestOrder: RetentionOrderBreakdown | null;
  orderHistory: RetentionOrderBreakdown[];
  timeline: Array<{ type: string; at: string; detail: string }>;
  nextAction: {
    recommendedText: string;
    dueStage: string | null;
    orderId: string | null;
    dueAt: string | null;
    source: "lifecycle" | "scheduled_follow_up";
  };
}

export interface RetentionProductTiming {
  satisfactionDays?: number;
  reviewDays?: number;
  repeatSaleStartDays?: number;
  repeatSaleEndDays?: number;
  winBackEndDays?: number;
}

// Manually-created retention tasks (migration 178). These sit alongside the
// derived lifecycle worklist and are deliberately NOT part of the bonus or
// KPI math - a manual task is a reminder, not a business event.
export type RetentionManualTaskType =
  | "satisfaction_check" | "complaint_follow_up" | "review_request" | "referral_request"
  | "repeat_sale_offer" | "win_back_call" | "scheduled_follow_up" | "general_check_in";

export interface RetentionManualTask {
  id: string;
  orderId: string | null;
  customerName: string;
  customerPhone: string;
  taskType: RetentionManualTaskType;
  title: string;
  note: string | null;
  priority: "high" | "medium" | "low";
  status: "pending" | "completed" | "cancelled";
  dueAt: string;
  assignedRepId: string | null;
  assignedRepName: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface RetentionManualTaskInput {
  orderId?: string | null;
  customerName: string;
  customerPhone: string;
  taskType: RetentionManualTaskType;
  title: string;
  note?: string | null;
  priority: "high" | "medium" | "low";
  dueAt: string;
  assignedRepId?: string | null;
}

// Referrals (migration 181) have their own lifecycle: a lead becomes
// converted only when the referee actually places an order, and the reward
// is tracked separately from the conversion.
export interface RetentionReferral {
  id: string;
  referrerOrderId: string | null;
  referrerName: string;
  referrerPhone: string;
  refereeName: string;
  refereePhone: string;
  productInterested: string | null;
  source: "whatsapp" | "facebook" | "instagram" | "website" | "phone" | "other";
  status: "new_lead" | "in_progress" | "converted" | "not_converted";
  referralDate: string;
  convertedAt: string | null;
  convertedOrderId: string | null;
  rewardAmount: number;
  rewardStatus: "not_eligible" | "pending" | "paid";
  rewardPaidAt: string | null;
  assignedRepId: string | null;
  assignedRepName: string | null;
  notes: string | null;
  createdAt: string;
}

export interface RetentionReferralInput {
  referrerOrderId?: string | null;
  referrerName: string;
  referrerPhone: string;
  refereeName: string;
  refereePhone: string;
  productInterested?: string | null;
  source: RetentionReferral["source"];
  assignedRepId?: string | null;
  notes?: string | null;
}

export interface RetentionActivityLogRow {
  id: string;
  activityType: "outcome" | "call" | "whatsapp";
  orderId: string;
  customerName: string;
  phone: string;
  productName: string;
  orderAmount: number;
  orderCurrency: string;
  stage: "satisfaction_check" | "review_referral" | "retention_sale" | null;
  loggedBy: string | null;
  loggedByName: string;
  loggedAt: string;
  reachStatus: string | null;
  customerResponse: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  nextActionNote: string | null;
  // Migration 179. Null means the rep did not record a duration (every
  // touchpoint before that migration) - averages must skip those.
  callDurationSeconds: number | null;
  satisfactionOutcome: string | null;
  satisfactionNotes: string | null;
  reviewRequestedAt: string | null;
  reviewCollected: boolean | null;
  reviewIsVideo: boolean | null;
  reviewText: string | null;
  // Migration 180. Null rating = not scored; averages must skip those.
  reviewRating: number | null;
  reviewSource: string | null;
  // Null status = not yet triaged; the UI treats it as pending so nothing
  // is auto-published without a human.
  reviewStatus: "pending" | "published" | "not_approved" | "rejected" | null;
  reviewSharedCount: number;
  mediaUrls: string[] | null;
  adPermissionGranted: boolean | null;
  referralRequestedAt: string | null;
  referralCollected: boolean | null;
  referralContactName: string | null;
  referralContactPhone: string | null;
  customerDiscountOwed: boolean | null;
  customerDiscountClearedAt: string | null;
  offeredProductId: string | null;
  offeredPackageId: string | null;
  retentionOutcome: string | null;
  resultingOrderId: string | null;
}

export const customerRetentionApi = {
  customers: (params: { repId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.repId && params.repId !== "all") qs.set("repId", params.repId);
    const suffix = qs.toString();
    return get<{ rows: RetentionCustomerRow[] }>(`/api/customer-retention/customers${suffix ? `?${suffix}` : ""}`);
  },
  activityLog: (params: { dateFrom?: string; dateTo?: string; stage?: string; repId?: string; search?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
    if (params.dateTo) qs.set("dateTo", params.dateTo);
    if (params.stage) qs.set("stage", params.stage);
    if (params.repId) qs.set("repId", params.repId);
    if (params.search) qs.set("search", params.search);
    const suffix = qs.toString();
    return get<{ rows: RetentionActivityLogRow[] }>(`/api/customer-retention/activity-log${suffix ? `?${suffix}` : ""}`);
  },
  customerDetail: (phone: string) => get<RetentionCustomerDetail>(`/api/customer-retention/customer/${encodeURIComponent(phone)}`),
  dashboardSummary: (params: { dateFrom?: string; dateTo?: string; repId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
    if (params.dateTo) qs.set("dateTo", params.dateTo);
    if (params.repId) qs.set("repId", params.repId);
    const suffix = qs.toString();
    return get<RetentionDashboardSummary>(`/api/customer-retention/dashboard-summary${suffix ? `?${suffix}` : ""}`);
  },
  worklist: (params: { stage?: string; search?: string; minValue?: number; priority?: string; product?: string; assignedRepId?: string; includeAll?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.stage && params.stage !== "all") qs.set("stage", params.stage);
    if (params.search) qs.set("search", params.search);
    if (typeof params.minValue === "number") qs.set("minValue", String(params.minValue));
    if (params.priority && params.priority !== "all") qs.set("priority", params.priority);
    if (params.product && params.product !== "all") qs.set("product", params.product);
    if (params.assignedRepId && params.assignedRepId !== "all") qs.set("assignedRepId", params.assignedRepId);
    if (params.includeAll) qs.set("includeAll", "true");
    const suffix = qs.toString();
    return get<{ rows: RetentionWorklistRow[] }>(`/api/customer-retention/worklist${suffix ? `?${suffix}` : ""}`);
  },
  retentionSuggestion: (orderId: string) => get<{ suggestion: { productId: string; packageId: string | null } | null }>(`/api/customer-retention/order/${encodeURIComponent(orderId)}/retention-suggestion`),
  trackAction: (body: { orderId: string; actionType: "call" | "whatsapp"; context?: string }) =>
    post<{ row: Record<string, unknown> }>("/api/customer-retention/action-events", body),
  logTouchpoint: (body: RetentionTouchpointPayload) => post<{ row: Record<string, unknown> }>("/api/customer-retention/touchpoints", body),
  updateTouchpoint: (id: string, body: { mediaUrls?: string[]; customerDiscountCleared?: boolean; resultingOrderId?: string }) =>
    patch<{ row: Record<string, unknown> }>(`/api/customer-retention/touchpoints/${id}`, body),
  uploadMedia: (dataUrl: string) => post<{ url: string; path: string }>("/api/customer-retention/media/upload", { dataUrl }),
  bonusSummary: (params: { dateFrom?: string; dateTo?: string; userId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
    if (params.dateTo) qs.set("dateTo", params.dateTo);
    if (params.userId) qs.set("userId", params.userId);
    const suffix = qs.toString();
    return get<RetentionBonusSummary>(`/api/customer-retention/bonus-summary${suffix ? `?${suffix}` : ""}`);
  },
  settings: () => get<{ settings: RetentionBonusSettings }>("/api/customer-retention/settings"),
  updateSettings: (body: Partial<RetentionBonusSettings>) => patch<{ settings: RetentionBonusSettings }>("/api/customer-retention/settings", body),
  productTiming: () => get<{ products: Array<{ id: string; name: string; timing: RetentionProductTiming | null }> }>("/api/customer-retention/product-timing"),
  updateProductTiming: (productId: string, timing: RetentionProductTiming) =>
    patch<{ product: { id: string; name: string; timing: RetentionProductTiming | null } }>(`/api/customer-retention/product-timing/${encodeURIComponent(productId)}`, timing),
  // Manual tasks live alongside the derived lifecycle worklist - see
  // migration 178. `pendingMigration` lets the Tasks page degrade to
  // derived-only rather than erroring if 178 has not been applied yet.
  tasks: () => get<{ rows: RetentionManualTask[]; pendingMigration?: boolean }>("/api/customer-retention/tasks"),
  createTask: (body: RetentionManualTaskInput) => post<{ row: RetentionManualTask }>("/api/customer-retention/tasks", body),
  updateTask: (id: string, body: Partial<Pick<RetentionManualTask, "status" | "priority" | "dueAt" | "assignedRepId" | "title" | "note">>) =>
    patch<{ row: RetentionManualTask }>(`/api/customer-retention/tasks/${encodeURIComponent(id)}`, body),
  bulkAssignTasks: (taskIds: string[], assignedRepId: string | null) =>
    post<{ updated: number }>("/api/customer-retention/tasks/bulk-assign", { taskIds, assignedRepId }),
  importTasks: (tasks: RetentionManualTaskInput[]) =>
    post<{ imported: number }>("/api/customer-retention/tasks/import", { tasks }),
  // Review moderation (migration 180) - status/rating/source are editorial
  // decisions made after the review was captured.
  moderateReview: (touchpointId: string, body: {
    reviewStatus?: "pending" | "published" | "not_approved" | "rejected";
    reviewRating?: number | null;
    reviewSource?: string | null;
    incrementShared?: boolean;
  }) => patch<{ ok: true }>(`/api/customer-retention/reviews/${encodeURIComponent(touchpointId)}`, body),
  referrals: () => get<{ rows: RetentionReferral[]; pendingMigration?: boolean }>("/api/customer-retention/referrals"),
  createReferral: (body: RetentionReferralInput) => post<{ row: RetentionReferral }>("/api/customer-retention/referrals", body),
  updateReferral: (id: string, body: Partial<Pick<RetentionReferral, "status" | "convertedOrderId" | "rewardAmount" | "rewardStatus" | "assignedRepId" | "productInterested" | "notes">>) =>
    patch<{ row: RetentionReferral }>(`/api/customer-retention/referrals/${encodeURIComponent(id)}`, body)
};


// ── Recovery templates: offers, call scripts, broadcast messages ──────────
// Migration 182. Sending is NOT done here - the app dispatches through the
// existing WhatsApp custom-send and then calls recordSend, so the audit trail
// is written by whoever actually sent it.
export interface RecoveryTemplate {
  id: string;
  kind: "offer" | "script" | "message";
  name: string;
  body: string;
  offerType: "discount_pct" | "free_shipping" | "bundle" | "new_arrival" | "other" | null;
  discountPct: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryTemplateUsage {
  templateId: string;
  name: string;
  kind: string;
  sends: number;
  conversions: number;
  conversionPct: number;
  revenue: number;
}

export interface RecoveryTemplateSendInput {
  templateId?: string | null;
  orderId?: string | null;
  customerName?: string | null;
  customerPhone: string;
  channel?: "whatsapp" | "sms" | "call" | "other";
}

export const recoveryTemplatesApi = {
  list: (kind?: RecoveryTemplate["kind"]) =>
    get<{ rows: RecoveryTemplate[]; pendingMigration?: boolean }>(`/api/recovery-templates${kind ? `?kind=${kind}` : ""}`),
  create: (body: Omit<RecoveryTemplate, "id" | "createdAt" | "updatedAt" | "active"> & { active?: boolean }) =>
    post<{ row: RecoveryTemplate }>("/api/recovery-templates", body),
  update: (id: string, body: Partial<Pick<RecoveryTemplate, "name" | "body" | "offerType" | "discountPct" | "active">>) =>
    patch<{ row: RecoveryTemplate }>(`/api/recovery-templates/${encodeURIComponent(id)}`, body),
  deactivate: (id: string) => del<{ ok: boolean }>(`/api/recovery-templates/${encodeURIComponent(id)}`),
  recordSend: (sends: RecoveryTemplateSendInput[]) =>
    post<{ recorded: number }>("/api/recovery-templates/record-send", { sends }),
  usage: () => get<{ rows: RecoveryTemplateUsage[]; pendingMigration?: boolean }>("/api/recovery-templates/usage")
};

export const customerOptOutApi = {
  optOut: (phone: string, reason?: string) => post<any>("/api/customers/opt-out", { phone, reason }),
  clearOptOut: (phone: string) => del<void>(`/api/customers/opt-out/${encodeURIComponent(phone)}`)
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
  progressForRep: (repId: string, weekStart: string) => get<any>(`/api/sales-bonuses/progress/${repId}?${new URLSearchParams({ weekStart }).toString()}`),
  orderBonusMap: (dateTo: string, dateFrom?: string) => {
    const qs = new URLSearchParams({ dateTo });
    if (dateFrom) qs.set("dateFrom", dateFrom);
    return get<Record<string, number>>(`/api/sales-bonuses/order-bonus-map?${qs.toString()}`);
  },
  orderBonusSettlementMap: (dateTo: string, dateFrom?: string) => {
    const qs = new URLSearchParams({ dateTo });
    if (dateFrom) qs.set("dateFrom", dateFrom);
    return get<Record<string, { earnedBeforeCompliance: number; payable: number; complianceReduction: number }>>(
      `/api/sales-bonuses/order-bonus-settlement-map?${qs.toString()}`
    ).catch(async () => {
      const payable = await get<Record<string, number>>(`/api/sales-bonuses/order-bonus-map?${qs.toString()}`);
      return Object.fromEntries(Object.entries(payable).map(([orderId, amount]) => [orderId, {
        earnedBeforeCompliance: amount,
        payable: amount,
        complianceReduction: 0
      }]));
    });
  },
  orderExpansionAttributionMap: (dateTo: string, dateFrom?: string) => {
    const qs = new URLSearchParams({ dateTo });
    if (dateFrom) qs.set("dateFrom", dateFrom);
    return get<Record<string, Array<{ ruleName: string; ruleType: string; amount: number; earnedBeforeCompliance: number; complianceReduction: number }>>>(
      `/api/sales-bonuses/order-expansion-attribution-map?${qs.toString()}`
    );
  },
  orderAttribution: (orderId: string) =>
    get<Array<{ ruleName: string; ruleType: string; amount: number; earnedBeforeCompliance: number; complianceReduction: number }>>(`/api/sales-bonuses/order-attribution/${orderId}`)
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
  // Owner/Admin: switch off a stuck account belonging to someone else
  disconnectUser: (userId: string) =>
    post<{ account: any }>(`/api/whatsapp-user-account/user/${encodeURIComponent(userId)}/disconnect`, {}),
  // Owner/Admin: every account in the org, problems first
  listAccounts: () => get<{ accounts: any[] }>("/api/whatsapp-user-account/accounts"),
  // Owner/Admin: the master switch - disconnects every enabled account
  disableAll: () => post<{ disabled: number; orgDisabled: boolean; total: number }>("/api/whatsapp-user-account/disable-all", {}),
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
// Keys are camelCase: `request()` runs every response through snakeToCamel,
// so the snake_case column names never reach a component.
export type CartAttemptRow = {
  id: string; cartId: string; repName?: string | null; attemptedAt: string;
  channel: string; outcomeCode: string; customOutcome?: string | null;
  outcomeNote?: string | null; customerReached: boolean; nextActionAt?: string | null;
};

export type CartFollowUpRow = {
  id: string; customer: string; phone: string;
  whatsapp?: string | null; email?: string | null;
  city?: string | null; state?: string | null; address?: string | null;
  preferredDelivery?: string | null;
  productId?: string | null; productName?: string | null;
  baseProductName?: string | null; packageName?: string | null;
  amount: number; currency?: string | null; quantity?: number | null;
  source?: string | null; embedLabel?: string | null;
  leftAt?: string | null; recoverySentAt?: string | null;
  status: string; repId: string; repName: string; assignedAt?: string | null;
  createdAt: string; lastActivity: string;
  attempts: number; lastOutcome?: string | null; lastOutcomeNote?: string | null;
  lastAttemptAt?: string | null; lastAttemptBy?: string | null; nextActionAt?: string | null;
  convertedOrderId?: string | null; convertedOrderStatus?: string | null;
  convertedOrderAmount?: number | null; convertedOrderCurrency?: string | null;
  convertedOrderAt?: string | null;
};

export type CartGridCell = {
  attempts: number; channels: string[]; reached: boolean; outcome: string | null;
  entries: Array<{ attemptedAt: string; outcome: string | null; channel: string | null; reached: boolean; note: string | null; repName: string | null }>;
};
export type CartGridRow = {
  id: string; customer: string; phone: string; whatsapp?: string | null;
  productName?: string | null; packageName?: string | null;
  amount: number; currency?: string | null; quantity?: number | null;
  city?: string | null; state?: string | null;
  status: string; repId: string; repName: string; assignedAt?: string | null;
  createdAt: string; createdKey: string;
  convertedOrderId?: string | null; convertedOrderStatus?: string | null;
  /** Finished: order delivered, customer said no, or the number was wrong.
   *  A display state only - logging stays possible if they come back. */
  closed?: boolean; closedReason?: string | null;
  /** Untouched for 2+ days, never contacted, or a promised callback is due. */
  needsLog?: boolean; neverContacted?: boolean; staleDays?: number;
  /** When the rep told the customer they would ring back. */
  nextActionAt?: string | null;
  /** Ranked worst-first. A missed promise outranks a gap, because the
   *  customer was actually told a day and it passed. */
  urgency?: "promise-overdue" | "promise-today" | "never-contacted" | "stale" | null;
  /** Every attempt ever, and the most recent one - so a cart carried in from
   *  an earlier week shows what was already said without opening it. */
  attempts?: number;
  lastOutcome?: string | null; lastOutcomeNote?: string | null;
  lastAttemptAt?: string | null; lastAttemptBy?: string | null;
  cells: Record<string, CartGridCell>;
};
export type CartFollowUpGrid = {
  weekStart: string; isCurrentWeek: boolean; todayKey: string;
  days: Array<{ key: string; label: string; isToday: boolean }>;
  rows: CartGridRow[];
};

export const cartsApi = {
  followUpGrid: (params?: { weekStart?: string; repId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.weekStart) qs.set("weekStart", params.weekStart);
    if (params?.repId) qs.set("repId", params.repId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return get<CartFollowUpGrid>(`/api/carts/follow-up-grid${suffix}`);
  },
  contactAttempts: (cartId: string) => get<{ rows: CartAttemptRow[] }>(`/api/carts/${cartId}/contact-attempts`),
  logContactAttempt: (cartId: string, body: unknown) =>
    post<{ row: CartAttemptRow; statusMovedTo: string | null }>(`/api/carts/${cartId}/contact-attempts`, body),
  followUpOverview: () => get<{ rows: CartFollowUpRow[] }>("/api/carts/follow-up-overview"),
  list: () => get<any[]>("/api/carts"),
  changes: (after: string) => {
    const qs = new URLSearchParams({ after });
    return get<{ rows: any[]; serverTime: string; truncated: boolean }>(`/api/carts/changes?${qs.toString()}`);
  },
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
  journeyBulk: (cartIds: string[], options?: { createdAfter?: string; snapshot?: boolean }) =>
    post<Record<string, any[]>>("/api/carts/journey-bulk", {
      cartIds,
      ...(options?.createdAfter ? { createdAfter: options.createdAfter } : {}),
      ...(options?.snapshot ? { snapshot: true } : {})
    }),
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
      keepalive: true,
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
