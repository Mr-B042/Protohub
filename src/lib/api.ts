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
      /** The refresh request got no answer at all (connection, not the login). */
      noAnswer?: boolean;
    };

let refreshInFlight: Promise<AuthRefreshResult> | null = null;

export type BranchWorkspace = {
  id: string;
  countryCode: string;
  countryName: string;
  name: string;
  stateOrRegion?: string | null;
  city?: string | null;
  currency: string;
  active: boolean;
  createdAt: string;
  /** The branch this person opens when their device has none saved. */
  isDefault?: boolean;
};

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
  constructor(public status: number, message: string, public code?: string) {
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

// ── When a request gets no answer at all ───────────────────
// (Bright, 2 Oct 2026: error messages must say what actually happened.)
// The browser only says "failed", so we check: is the device offline? Does
// the Protohub website itself still load? Then we say which one it was.
// Status stays 0 so callers that treat "no answer" as an outage still do.
export type NoAnswerKind = "offline" | "connection_lost" | "server_unreachable";
export const NO_ANSWER_MESSAGE: Record<NoAnswerKind, string> = {
  offline: "You're offline. Check your internet or data connection. We'll try again when you're back.",
  connection_lost: "Your internet connection dropped. Nothing was saved or lost. Try again once you're connected.",
  server_unreachable: "Your internet is working, but Protohub's server didn't answer. This is on our side. Try again in a minute."
};

async function websiteStillLoads(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), 4000) : null;
  try {
    const res = await fetch(`${window.location.origin}/?connection-check=${Date.now()}`, { method: "HEAD", cache: "no-store", signal: controller?.signal });
    return res.status > 0;
  } catch {
    return false;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

export async function diagnoseNoAnswer(): Promise<NoAnswerKind> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  return (await websiteStillLoads()) ? "server_unreachable" : "connection_lost";
}

async function noAnswerError() {
  const kind = await diagnoseNoAnswer();
  return new ApiError(0, NO_ANSWER_MESSAGE[kind], kind);
}

/** True when the request got no answer (offline, dropped, or server silent). */
export function isNoAnswerError(error: unknown): boolean {
  return typeof (error as { status?: unknown })?.status === "number" && (error as { status: number }).status === 0;
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
        if (refresh.noAnswer) throw await noAnswerError();
        throw new ApiError(503, "Could not refresh your session right now. Please retry in a moment - you have not been logged out.");
      }
    }
  }
  let res: Response;
  let branchId: string | null = null;
  try {
    const storedBranchId = localStorage.getItem("protohub.activeBranch");
    // The initial selector uses temporary labels until /api/branches has
    // hydrated real database UUIDs. Never send a placeholder as scope.
    branchId = storedBranchId && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(storedBranchId) ? storedBranchId : null;
  } catch { /* private mode */ }
  try {
    res = await fetchWithApiFailover(path, {
      method,
      cache: "no-store", // never read from or write to HTTP cache
      headers: {
        "Content-Type": "application/json",
        ...(token && !isSessionStartEndpoint ? { Authorization: `Bearer ${token}` } : {}),
        ...(branchId && !isSessionStartEndpoint ? { "X-Branch-Id": branchId } : {}),
        ...(_spyUserId ? { "X-Spy-User-Id": _spyUserId } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    if (method === "GET" && transientAttempt < TRANSIENT_GET_RETRY_LIMIT) {
      await sleep(400 * (transientAttempt + 1));
      return request<T>(method, path, body, retried, transientAttempt + 1);
    }
    throw await noAnswerError();
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
      if (refreshed.noAnswer) throw await noAnswerError();
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
    throw new ApiError(res.status, extractErrorMessage(payload, res.statusText || "Request failed."), typeof payload?.code === "string" ? payload.code : undefined);
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
      return { ok: false, reason: "transient", session, message: error?.message ?? "Session refresh failed.", noAnswer: true };
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
  presence: (sessionId: string) => post<{ ok: boolean; lastSeenAt: string }>("/api/auth/presence", { sessionId }),
  presenceOffline: (sessionId: string) => post<{ ok: boolean }>("/api/auth/presence/offline", { sessionId })
};

// ── Users ────────────────────────────────────────────────
export const usersApi = {
  list: () => get<any[]>("/api/users"),
  presence: () => get<{
    serverTime: string;
    activeWindowSeconds: number;
    users: Array<{ id: string; active: boolean; online: boolean; lastSeenAt?: string | null }>;
  }>("/api/users/presence"),
  update: (id: string, body: { name?: string; email?: string; phone?: string; active?: boolean }) =>
    patch<any>(`/api/users/${id}`, body),
  // Which branches one person may open. Not a second account - the same login
  // switches between them from the picker in the top bar.
  branches: (id: string) => get<UserBranchMembership[]>(`/api/users/${id}/branches`),
  setBranches: (id: string, body: { branchIds: string[]; defaultBranchId?: string | null }) =>
    put<UserBranchMembership[]>(`/api/users/${id}/branches`, body)
};

export type UserBranchMembership = {
  branchId: string;
  name: string;
  countryName: string;
  currency: string;
  /** Where this person lands when they sign in. Exactly one is true. */
  isDefault: boolean;
};

// ── Products ──────────────────────────────────────────────
/**
 * ⚠️ A ROLE THAT CANNOT SEE PRICING STILL GETS A PRODUCT SHAPE.
 *
 * The server strips `pricings` and `dedicated_handlers` outright for
 * "Inventory Manager & Logistics Operations" - correct, that role must not see
 * money - but it REMOVES the keys rather than emptying them. The client types
 * both as required arrays, so nothing forced a guard, and the first read of
 * `product.pricings.find(...)` threw
 *
 *   TypeError: Cannot read properties of undefined (reading 'find')
 *
 * which took the whole app down for that role. Normalising here fixes every
 * reader at once instead of guarding dozens of call sites, and it is the right
 * place: the shape a role is allowed to see is still a valid product shape.
 */
const normaliseProductRow = (row: any) => ({
  ...row,
  pricings: Array.isArray(row?.pricings) ? row.pricings : [],
  packages: Array.isArray(row?.packages) ? row.packages : [],
  dedicatedHandlers: Array.isArray(row?.dedicatedHandlers) ? row.dedicatedHandlers
    : Array.isArray(row?.dedicated_handlers) ? row.dedicated_handlers : []
});

export const productsApi = {
  list: async () => {
    const rows = await get<any[]>("/api/products");
    return Array.isArray(rows) ? rows.map(normaliseProductRow) : rows;
  },
  // Every recorded unit-cost move, so a historical line can be costed at what
  // it cost THEN instead of what the product record says today.
  costChanges: () => get<{ changes: any[] }>("/api/products/cost-changes"),
  // Public storefront view of one product, with cross-sells + free-gifts inlined.
  // Raw fetch so embed forms never inherit stale auth headers or 401 refresh logic.
  public: async (id: string) => {
    const res = await fetchWithApiFailover(`/api/public/products/${encodeURIComponent(id)}`, {
      // Stable form configuration may use the browser/proxy's short HTTP
      // cache. State-specific stock is fetched separately and submit is always
      // validated by the server, so this does not permit stale orders.
      cache: "default"
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, typeof payload?.error === "string" ? payload.error : res.statusText);
    }
    const payload = snakeToCamel<{ product: any; related: any[]; media?: Record<string, string> }>(await res.json());
    const hydrateCompanionMedia = (product: any) => {
      for (const pkg of product?.packages ?? []) {
        for (const companion of pkg?.companionProducts ?? []) {
          for (const field of ["imageUrl", "videoUrl", "embedHtml"] as const) {
            const reference = companion?.mediaRefs?.[field];
            if (reference && payload.media?.[reference]) companion[field] = payload.media[reference];
          }
          delete companion.mediaRefs;
        }
      }
    };
    hydrateCompanionMedia(payload.product);
    payload.related.forEach(hydrateCompanionMedia);
    return { product: payload.product, related: payload.related };
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
// Returned once on approval. tempPassword is never stored and never re-shown.
export type PdaLoginResult = { created: boolean; email?: string; tempPassword?: string; reason?: string };

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


// ── Agent Access ──────────────────────────────────────────
// Portal state is its own axis, deliberately separate from accountStatus: an
// agent can be on Probation and signing in fine, or Active with a blocked
// login while a cash problem is sorted out.
export type PortalAccessState = "Active" | "Setup Required" | "Blocked";

export type AgentAccessRow = {
  id: string; agentCode: string; fullName: string; phone: string;
  contactEmail: string | null;
  city: string; state: string; location: string; fullLocation: string;
  accountStatus: string; trustLevel: string | null;
  portalAccess: PortalAccessState;
  /** What the agent actually types to sign in (phone, or a legacy email). */
  loginId: string | null;
  /** The number a new login would be created under. */
  loginPhone: string | null;
  hasLogin: boolean; userId: string | null;
  accountCreatedAt: string | null;
  /** Last successful sign-in. Null means the account has never been used. */
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  twoFactorRequired: boolean;
  recentFailedAttempts: number;
  /** Plain-English reasons this account needs a look. Empty when it does not. */
  securityReasons: string[];
  activeOrders: number; stockUnitsHeld: number; codExposure: number; openIncidents: number;
  /** What is still outstanding against them, shown before standing them down. */
  blockers: string[];
};

export type AgentAccessView = {
  rows: AgentAccessRow[];
  counts: { activeAccounts: number; setupRequired: number; suspended: number; securityAttention: number };
};

export type AgentLoginEvent = {
  id: string; at: string; success: boolean; ip: string | null; device: string | null;
};

/** Per-channel outcome. "Created but WhatsApp failed" is not "not created". */
export type CredentialDelivery = { channel: string; ok: boolean; error?: string };

export type PortalCredentialResult = {
  created: boolean; email?: string; loginPhone?: string; tempPassword?: string; reason?: string;
  delivery?: CredentialDelivery[];
};

export type PortalSendOptions = {
  tempPassword?: string;
  requirePasswordChange?: boolean;
  sendWhatsApp?: boolean;
  sendSms?: boolean;
  copyToMyEmail?: boolean;
};


// ── Delivery goals (Manager Dashboard product cards) ──────
export type DeliveryGoalBasis = "period" | "month" | "all_time";

export type ProductDeliveryGoal = {
  productId: string;
  useCustomGoals: boolean;
  primaryTarget: number;
  stretchTarget: number;
  goalBasis: DeliveryGoalBasis;
  showProgressBar: boolean;
  updatedAt?: string | null;
};

export type DeliveryGoalsView = {
  companyDefault: { primaryTarget: number; stretchTarget: number };
  /** Only products with their own settings. Everything else follows the default. */
  products: ProductDeliveryGoal[];
};


// ── Cash Flow ─────────────────────────────────────────────
import type { CashFlowView, OpeningBalanceRow } from "../pages/CashFlowPage";
import type { WeeklyOpeningView } from "../pages/WeeklyOpeningCashWizard";

export type BankAccountRow = {
  id: string; name: string; accountType: "bank" | "cash";
  bankName: string; accountNumberLast4: string;
  isPrimary: boolean; active: boolean;
  openingBalance: number; openingBalanceDate: string | null;
  currentBalance: number; availableBalance: number; pendingIn: number; pendingOut: number;
};

export type BankTransferRow = {
  id: string; fromAccountId: string; toAccountId: string;
  amount: number; transferredAt: string; clearedAt: string | null; note: string;
};

export type BankAccountsView = {
  accounts: BankAccountRow[];
  totals: { totalLiquid: number; totalBank: number; cashInHand: number; pendingToClear: number };
  /** Cash recorded before accounts existed - belongs to no account. */
  unassigned: number;
  transfers: BankTransferRow[];
};

export type ReconciliationStatusKey =
  | "not_verified" | "balanced" | "needs_investigation" | "investigating" | "resolved";

export type ReconciliationAccount = {
  id: string; name: string; bankName: string;
  accountType: "bank" | "cash"; accountNumberLast4: string;
  /** What the books say this account holds as at the end of the week. */
  systemBalance: number;
};

export type VerificationAccountEntry = {
  bankAccountId: string | null; accountLabel: string;
  systemBalance: number; actualBalance: number;
};

export type VarianceInvestigationEvent = {
  id: string; kind: string; detail: string;
  amount: number | null; actorName: string; createdAt: string;
};

export type WeeklyReconciliationView = {
  weekStart: string; weekEnd: string;
  openingCash: number;
  /** False when the opening figure is derived rather than counted. */
  openingVerified: boolean;
  cashIn: number; cashOut: number; expectedClosing: number;
  accounts: ReconciliationAccount[];
  unassigned: number;
  verification: {
    id: string; status: string;
    expectedClosing: number; actualClosing: number;
    notes: string; verifiedByName: string; verifiedAt: string | null;
    accounts: VerificationAccountEntry[];
  } | null;
  investigation: {
    id: string; status: "in_progress" | "submitted" | "resolved";
    varianceAmount: number; reason: string; amountExplained: number;
    description: string; occurredOn: string | null; category: string;
    evidenceName: string; evidenceUrl: string; createdByName: string;
    events: VarianceInvestigationEvent[];
  } | null;
  activity: {
    ordersPlaced: number; ordersDelivered: number; deliveryRatePct: number;
    agentRemittances: number; expectedRemittances: number; remittanceCoveragePct: number;
    adSpend: number; adSpendPct: number;
    stockPurchases: number; stockPurchasesPct: number;
    otherExpenses: number; otherExpensesPct: number;
  };
  highlights: {
    topCashIn: { label: string; amount: number; at: string } | null;
    topCashOut: { label: string; amount: number; at: string } | null;
    topTransfer: { label: string; amount: number; at: string } | null;
  };
};

export type ReconciliationHistoryWeek = {
  id: string; weekStart: string; weekEnd: string;
  expectedClosing: number; actualClosing: number; variance: number;
  amountExplained: number; status: ReconciliationStatusKey;
  verifiedByName: string; verifiedAt: string | null;
};

export type ReserveCategoryKey =
  | "payroll" | "tax" | "supplier" | "advertising" | "emergency" | "owner" | "other";

export type ReserveRow = {
  id: string; refCode: string; name: string; purpose: string;
  bankAccountId: string | null; accountLabel: string;
  amount: number; releasedAmount: number; outstanding: number;
  availableToUse: boolean; expectedReleaseDate: string | null;
  category: ReserveCategoryKey; status: "active" | "released" | "cancelled";
  displayStatus: "active" | "due_soon" | "overdue" | "released" | "cancelled";
  createdByName: string; createdAt: string;
};

export type ReservesView = {
  reserves: ReserveRow[];
  summary: {
    totalReserved: number; totalLiquidCash: number;
    /** Liquid cash minus what is still held. Can be negative. */
    freeOperatingCash: number; reservedPct: number;
    activeCount: number; overCommitted: boolean;
  };
  breakdown: { slices: Array<{ id: string; label: string; amount: number; sharePct: number }>; total: number };
  insights: Array<{ kind: "healthy" | "warning" | "info" | "critical"; title: string; detail: string }>;
  upcoming: Array<{ id: string; name: string; amount: number; releaseDate: string; daysLeft: number }>;
  today: string;
};

export type StockConditionKey = "healthy" | "slow_moving" | "at_risk" | "damaged";

export type ValuedProductRow = {
  productId: string; name: string; sku: string; imageUrl: string | null;
  catalogType: string; units: number; damagedUnits: number;
  unitCost: number; costValue: number; retailValue: number;
  condition: StockConditionKey; weekTrend: number;
  /** True when stock is held with no unit cost on file - it values at ₦0. */
  missingCost: boolean;
};

export type InventoryValueView = {
  weekStart: string; weekEnd: string;
  products: ValuedProductRow[];
  totals: {
    totalUnits: number; totalCostValue: number; totalRetailValue: number;
    averageUnitCost: number; productLines: number;
    unpricedLines: number; unpricedUnits: number;
  };
  health: {
    slices: Array<{ condition: StockConditionKey; label: string; amount: number; units: number; sharePct: number }>;
    total: number;
  };
  byLocation: Array<{ key: string; label: string; amount: number; units: number; sharePct: number }>;
  byAgent: Array<{ key: string; label: string; amount: number; units: number; sharePct: number }>;
  byType: Array<{ key: string; label: string; amount: number; units: number; sharePct: number }>;
  movements: {
    stockInUnits: number; stockInValue: number;
    stockOutUnits: number; stockOutValue: number;
    adjustmentUnits: number; adjustmentValue: number;
    netUnits: number; netValue: number;
  };
  lowStock: ValuedProductRow[];
  snapshot: {
    id: string; status: "draft" | "final";
    totalUnits: number; totalValue: number; notes: string;
    capturedByName: string; capturedAt: string;
    lines: Array<{
      productId: string | null; productName: string; units: number;
      unitCost: number; value: number; condition: StockConditionKey; note: string;
    }>;
  } | null;
  slowMovingWindowDays: number;
};

export type AccountReconciliationRow = {
  id: string; bankAccountId: string; accountName: string; bankName: string;
  accountType: "bank" | "cash"; accountNumberLast4: string;
  statementDate: string; statementBalance: number; bookBalance: number;
  adjustmentCount: number;
  /** Statement minus books, after adjustments. Negative = bank holds less. */
  remainingDifference: number;
  settled: boolean;
  status: "in_progress" | "reconciled";
  notes: string; reconciledByName: string; reconciledAt: string | null; createdAt: string;
};

export type ReconBookItem = {
  sourceType: "expense" | "remittance" | "transfer";
  sourceId: string; occurredOn: string; description: string;
  amount: number; direction: "in" | "out";
};

export type ReconAdjustment = {
  id: string; occurredOn: string | null; description: string;
  amount: number; direction: "in" | "out";
  kind: "bank_charge" | "interest" | "vat" | "transfer" | "other";
};

export type AccountReconciliationsView = {
  reconciliations: AccountReconciliationRow[];
  summary: {
    total: number; reconciled: number; inProgress: number; unreconciled: number;
    reconciledPct: number; inProgressPct: number; unreconciledPct: number;
    totalVariance: number; varianceCount: number;
    bands: Record<"matched" | "small" | "large", { amount: number; count: number; sharePct: number }>;
  };
  accounts: Array<{ id: string; name: string; bankName: string; accountType: "bank" | "cash"; accountNumberLast4: string }>;
};

export type ReconciliationWorkspace = {
  account: { id: string; name: string; bankName: string; accountType: "bank" | "cash"; accountNumberLast4: string };
  statementDate: string; periodFrom: string; bookBalance: number;
  existing: {
    id: string; statementBalance: number; bookBalance: number;
    status: "in_progress" | "reconciled"; notes: string;
    reconciledByName: string; reconciledAt: string | null;
  } | null;
  items: ReconBookItem[];
  unmatched: ReconBookItem[];
  matches: Array<{ sourceType: string; sourceId: string }>;
  adjustments: ReconAdjustment[];
  lastReconciled: { statementDate: string; at: string | null; byName: string } | null;
};

export type CloseCheckRow = {
  key: string; group: string; label: string;
  /** "computed" is a fact read from data; "manual" is someone's claim. */
  kind: "computed" | "manual";
  required: boolean; done: boolean; evidence: string;
  doneByName?: string; doneAt?: string | null;
};

export type PeriodCloseView = {
  weekStart: string; weekEnd: string;
  status: "open" | "draft" | "closed" | "reopened";
  closingNotes: string; closedByName: string; closedAt: string | null; approvedByName: string;
  profit: {
    totalRevenue: number; totalCogs: number; grossProfit: number;
    operatingExpenses: number; netProfit: number; netMarginPct: number;
  };
  cashPosition: {
    totalLiquidCash: number; codWithAgents: number; inventoryAtCost: number;
    reservedCash: number; freeOperatingCash: number;
  };
  expectedClosingCash: number; actualClosingCash: number;
  cashVariance: number; varianceSettled: boolean;
  progress: {
    checks: CloseCheckRow[]; total: number; completed: number;
    blocking: CloseCheckRow[];
    computedTotal: number; computedDone: number;
    manualTotal: number; manualDone: number;
    progressPct: number; canClose: boolean;
  };
  /** False: closing never writes next week's opening cash. */
  setsNextWeekOpening: boolean;
};

export type WeekMovement = { current: number; previous: number; delta: number; pct: number | null };

export type WeeklyOverviewView = {
  weekStart: string; weekEnd: string; previousWeekStart: string;
  headline: {
    netProfit: WeekMovement; cashIn: WeekMovement; cashOut: WeekMovement;
    expectedClosing: WeekMovement; cashVariance: number; varianceVerified: boolean;
  };
  summary: Array<{ label: string } & WeekMovement>;
  cashPosition: {
    bankAccounts: number; cashInHand: number; codWithAgents: number;
    reservedCash: number; freeOperatingCash: number; totalLiquid: number;
  };
  health: Array<{ key: string; label: string; rating: "good" | "fair" | "poor" | "unknown"; detail: string }>;
  /** variance is null for a week nobody counted - never plotted as zero. */
  varianceTrend: Array<{ weekStart: string; weekEnd: string; variance: number | null; counted: boolean }>;
  highlights: Array<{ key: string; label: string; value: number; format: "naira" | "pct"; movement: WeekMovement }>;
  topCashIn: Array<{ label: string; amount: number; sharePct: number }>;
  topCashOut: Array<{ label: string; amount: number; sharePct: number }>;
  openingCounted: boolean;
};

export const cashFlowApi = {
  summary: (from: string, to: string) =>
    get<CashFlowView>(`/api/cash-flow?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  accounts: () => get<BankAccountsView>("/api/cash-flow/accounts"),
  addAccount: (body: unknown) => post<{ account: BankAccountRow }>("/api/cash-flow/accounts", body),
  updateAccount: (id: string, body: unknown) => patch<{ account: BankAccountRow }>(`/api/cash-flow/accounts/${id}`, body),
  transfer: (body: unknown) => post<{ id: string }>("/api/cash-flow/transfers", body),
  clearTransfer: (id: string) => post<{ ok: boolean }>(`/api/cash-flow/transfers/${id}/clear`, {}),
  deleteAccount: (id: string) => del<{ ok: boolean; deleted: string }>(`/api/cash-flow/accounts/${id}`),
  weeklyOpening: (weekStart?: string) =>
    get<WeeklyOpeningView>(`/api/cash-flow/weekly-opening${weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : ""}`),
  saveWeeklyOpening: (body: { weekStart: string; reason: string; sources: Array<{ bankAccountId: string | null; accountLabel: string; amount: number }> }) =>
    post<{ id: string; weekStart: string; total: number }>("/api/cash-flow/weekly-opening", body),
  assignAccount: (body: unknown) => post<{ remittances: number; expenses: number }>("/api/cash-flow/assign-account", body),
  openingHistory: () => get<{ rows: OpeningBalanceRow[] }>("/api/cash-flow/opening-balances"),
  setOpeningCash: (body: { amount: number; effectiveAt: string; method: "manual" | "carry_forward"; reason: string }) =>
    post<{ row: OpeningBalanceRow }>("/api/cash-flow/opening-balances", body),
  reconciliation: (weekStart?: string) =>
    get<WeeklyReconciliationView>(`/api/cash-flow/reconciliation${weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : ""}`),
  saveVerification: (body: {
    weekStart: string; status: "draft" | "verified"; notes: string;
    accounts: VerificationAccountEntry[];
  }) => post<{ id: string; weekStart: string; expectedClosing: number; actualClosing: number; variance: number; status: ReconciliationStatusKey }>(
    "/api/cash-flow/reconciliation", body),
  saveInvestigation: (body: {
    weekStart: string; status: "in_progress" | "submitted" | "resolved";
    reason: string | null; amountExplained: number; description: string;
    occurredOn: string | null; category: string; evidenceName: string; evidenceUrl: string;
  }) => post<{ id: string; weekStart: string; variance: number; progress: { variance: number; explained: number; unexplained: number; pct: number } }>(
    "/api/cash-flow/reconciliation/investigation", body),
  reconciliationHistory: () =>
    get<{ weeks: ReconciliationHistoryWeek[] }>("/api/cash-flow/reconciliation/history"),
  reserves: () => get<ReservesView>("/api/cash-flow/reserves"),
  addReserve: (body: unknown) => post<{ id: string; refCode: string }>("/api/cash-flow/reserves", body),
  updateReserve: (id: string, body: unknown) => patch<{ ok: boolean }>(`/api/cash-flow/reserves/${id}`, body),
  releaseReserve: (id: string, body: { amount: number; note: string }) =>
    post<{ remaining: number }>(`/api/cash-flow/reserves/${id}/release`, body),
  deleteReserve: (id: string) => del<{ ok: boolean; cancelled: boolean }>(`/api/cash-flow/reserves/${id}`),
  inventory: (weekStart?: string) =>
    get<InventoryValueView>(`/api/cash-flow/inventory${weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : ""}`),
  saveInventorySnapshot: (body: {
    weekStart: string; status: "draft" | "final"; notes: string;
    lines: Array<{ productId: string | null; productName: string; units: number; unitCost: number; condition: StockConditionKey; note: string }>;
  }) => post<{ id: string; weekStart: string; totalUnits: number; totalValue: number }>(
    "/api/cash-flow/inventory/snapshot", body),
  accountReconciliations: () => get<AccountReconciliationsView>("/api/cash-flow/account-reconciliations"),
  reconciliationWorkspace: (accountId: string, statementDate: string) =>
    get<ReconciliationWorkspace>(
      `/api/cash-flow/account-reconciliations/workspace?accountId=${encodeURIComponent(accountId)}&statementDate=${encodeURIComponent(statementDate)}`),
  saveAccountReconciliation: (body: {
    bankAccountId: string; statementDate: string; statementBalance: number;
    status: "in_progress" | "reconciled"; notes: string;
    matches: Array<{ sourceType: "expense" | "remittance" | "transfer"; sourceId: string }>;
  }) => post<{ id: string; bookBalance: number; remainingDifference: number; settled: boolean }>(
    "/api/cash-flow/account-reconciliations", body),
  addReconAdjustment: (id: string, body: {
    occurredOn: string | null; description: string; amount: number;
    direction: "in" | "out"; kind: "bank_charge" | "interest" | "vat" | "transfer" | "other";
  }) => post<{ ok: boolean }>(`/api/cash-flow/account-reconciliations/${id}/adjustments`, body),
  removeReconAdjustment: (id: string, adjustmentId: string) =>
    del<{ ok: boolean }>(`/api/cash-flow/account-reconciliations/${id}/adjustments/${adjustmentId}`),
  reopenAccountReconciliation: (id: string) =>
    post<{ ok: boolean }>(`/api/cash-flow/account-reconciliations/${id}/reopen`, {}),
  periodClose: (weekStart?: string) =>
    get<PeriodCloseView>(`/api/cash-flow/period-close${weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : ""}`),
  setCloseCheck: (body: { weekStart: string; checkKey: string; done: boolean }) =>
    post<{ ok: boolean }>("/api/cash-flow/period-close/check", body),
  savePeriodClose: (body: {
    weekStart: string; closingNotes: string; approvedByUserId: string | null; status: "draft" | "closed";
  }) => post<{ id: string; weekStart: string; status: string }>("/api/cash-flow/period-close", body),
  reopenPeriod: (weekStart: string) =>
    post<{ ok: boolean }>("/api/cash-flow/period-close/reopen", { weekStart }),
  weeklyOverview: (weekStart?: string) =>
    get<WeeklyOverviewView>(`/api/cash-flow/weekly-overview${weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : ""}`)
};

export const deliveryGoalsApi = {
  list: () => get<DeliveryGoalsView>("/api/delivery-goals"),
  saveProduct: (body: Omit<ProductDeliveryGoal, "updatedAt">) =>
    put<{ goal: ProductDeliveryGoal }>("/api/delivery-goals/product", body),
  saveCompanyDefault: (body: { primaryTarget: number; stretchTarget: number }) =>
    put<{ companyDefault: { primaryTarget: number; stretchTarget: number } }>("/api/delivery-goals/company-default", body)
};

export type TargetLever = {
  actual: number; target: number; percentAchieved: number | null;
  expectedByToday: number; variance: number; projected: number;
};

export type TargetForecast = {
  trendStart: string; trendEnd: string;
  dailyAverageContribution: number; dailyAverageOrders: number;
  dailyAverageDelivered: number; dailyAveragePieces: number;
  projectedContribution: number; projectedOrders: number;
  projectedDelivered: number; projectedPieces: number;
  projectedPercent: number | null;
  status: "on_track" | "at_risk" | "behind" | "achieved";
  daysElapsed: number; daysRemainingInclusive: number; daysAfterToday: number;
};

export type TargetRequiredPace = {
  remainingContribution: number; remainingOrders: number;
  remainingDelivered: number; remainingPieces: number;
  contributionPerDay: number; ordersPerDay: number;
  deliveredPerDay: number; piecesPerDay: number;
  daysRemainingInclusive: number;
};

export type TargetWeeklyMilestone = {
  week: number; startDate: string; endDate: string; days: number;
  targetContribution: number; actualContribution: number; percentAchieved: number | null;
};

export type TargetPeriod = {
  id: string; productId: string; productName: string | null; name: string;
  periodStart: string; periodEnd: string;
  contributionMinimum: number; contributionTarget: number; contributionExceptional: number;
  orderTarget: number; deliveredTarget: number; piecesTarget: number;
  deliveryRateTarget: number; adSpendCeiling: number;
  status: "draft" | "active" | "closed" | "settled";
  incentive: {
    id: string; managerId: string | null; baseReward: number;
    minimumMultiplier: number; targetMultiplier: number; exceptionalMultiplier: number;
    verificationStatus: string; verificationGates: Record<string, boolean>; finalPayout: number | null;
  } | null;
};

export type TargetProgressView = {
  targetId: string; periodStart: string; periodEnd: string;
  // ⚠️ false until the incentive slice lands: the contribution figure is
  // BEFORE commissions and therefore reads slightly high. The UI must say so
  // rather than presenting it as final.
  commissionsIncluded: boolean;
  breakdown: {
    revenue: number; cogs: number; logistics: number; commissions: number;
    adSpend: number; contributionBeforeAds: number; contribution: number;
  };
  contribution: TargetLever;
  ordersPlaced: TargetLever;
  delivered: TargetLever;
  pieces: TargetLever;
  deliveryRate: TargetLever;
  adSpend: TargetLever & { overCeiling: boolean };
  weeklyMilestones: TargetWeeklyMilestone[];
  forecast: TargetForecast;
  requiredPace: TargetRequiredPace;
  recoveryPlan: TargetRecoveryPlan;
  incentive: TargetIncentive | null;
  incentiveStatus: string | null;
};

export type TargetRecoveryPlan = {
  planCode: "A" | "B" | "C" | "D" | "E";
  problem: "none" | "orders" | "delivery_rate" | "pieces" | "contribution";
  headline: string;
  actions: { label: string; detail: string; impact: number }[];
};

export type TargetIncentive = {
  tier: "none" | "minimum" | "target" | "exceptional";
  tierLabel: string;
  multiplier: number;
  amount: number;
  projectedTier: "none" | "minimum" | "target" | "exceptional";
  projectedAmount: number;
  nextTier: { name: string; threshold: number; shortfall: number; perDay: number } | null;
  gatesMet: string[];
  gatesOutstanding: string[];
  settleable: boolean;
};

export const targetPeriodsApi = {
  list: () => get<{ targets: TargetPeriod[] }>("/api/target-periods"),
  progress: (id: string) => get<TargetProgressView>(`/api/target-periods/${id}/progress`),
  create: (body: Record<string, unknown>) => post<{ target: TargetPeriod }>("/api/target-periods", body),
  update: (id: string, body: Record<string, unknown>) =>
    patch<{ target: TargetPeriod }>(`/api/target-periods/${id}`, body),
  setStatus: (id: string, status: TargetPeriod["status"]) =>
    put<{ target: TargetPeriod }>(`/api/target-periods/${id}/status`, { status }),
  saveIncentive: (id: string, body: Record<string, unknown>) =>
    put<{ incentive: unknown }>(`/api/target-periods/${id}/incentive`, body),
  remove: (id: string) => del<{ deleted: boolean; snapshotsRemoved: number }>(`/api/target-periods/${id}`),
  suggest: (params: { productId: string; periodStart: string; periodEnd: string; months?: number; stretch?: number }) =>
    get<TargetSuggestion>(`/api/target-periods/suggest?${new URLSearchParams({
      productId: params.productId,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      months: String(params.months ?? 2),
      stretch: String(params.stretch ?? 10)
    }).toString()}`)
};

export type SuggestedTargetValues = {
  contributionTarget: number; contributionMinimum: number; contributionExceptional: number;
  orderTarget: number; deliveredTarget: number; piecesTarget: number;
  deliveryRateTarget: number; adSpendCeiling: number;
};

export type TargetSuggestion = {
  productId: string;
  productName: string;
  basedOn: Array<{
    monthKey: string; periodStart: string; periodEnd: string; days: number;
    contribution: number; ordersPlaced: number; delivered: number; pieces: number; adSpend: number;
    isPartial?: boolean;
  }>;
  skipped: string[];
  excludedMonths: Array<{ monthKey: string; reason: string }>;
  daysInTargetPeriod: number;
  stretchPct: number;
  baseline: SuggestedTargetValues;
  suggested: SuggestedTargetValues;
  notes: string[];
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
  agentAccess: () => get<AgentAccessView>("/api/personal-delivery-agents/agent-access"),
  agentLoginHistory: (id: string) =>
    get<{ rows: AgentLoginEvent[] }>(`/api/personal-delivery-agents/${id}/login-history`),
  suspendPortalAccess: (id: string, reason: string) =>
    post<{ ok: boolean; portalAccess: PortalAccessState }>(`/api/personal-delivery-agents/${id}/portal/suspend`, { reason }),
  restorePortalAccess: (id: string) =>
    post<{ ok: boolean; portalAccess: PortalAccessState }>(`/api/personal-delivery-agents/${id}/portal/restore`, {}),
  signOutAllDevices: (id: string) =>
    post<{ ok: boolean; sessionsRevoked: number }>(`/api/personal-delivery-agents/${id}/portal/sign-out-all`, {}),
  setTwoFactorRequired: (id: string, required: boolean) =>
    post<{ ok: boolean; twoFactorRequired: boolean }>(`/api/personal-delivery-agents/${id}/portal/two-factor`, { required }),
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
    post<{ row: PersonalDeliveryAgentRow; login?: PdaLoginResult }>(`/api/personal-delivery-agents/${id}/approve`, {}),
  createPortalLogin: (id: string, body: PortalSendOptions = {}) =>
    post<PortalCredentialResult>(`/api/personal-delivery-agents/${id}/create-login`, body),
  deleteAgent: (id: string) =>
    del<{ ok: boolean; deleted: string }>(`/api/personal-delivery-agents/${id}`),
  resetPortalPassword: (id: string, body: PortalSendOptions = {}) =>
    post<PortalCredentialResult>(`/api/personal-delivery-agents/${id}/reset-login-password`, body),
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

export const branchesApi = {
  list: () => get<BranchWorkspace[]>("/api/branches"),
  create: (body: Omit<BranchWorkspace, "id" | "active" | "createdAt">) => post<{ branch: BranchWorkspace }>("/api/branches", body)
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

export type DeliveredStockReconciliationRow = {
  id: string;
  orderId: string;
  agentId: string;
  agentLocationId: string;
  state: string;
  agentName: string;
  customer: string;
  productId: string;
  productName: string;
  quantity: number;
  status: "pending" | "exception" | "reconciled";
  deliveredAt: string;
  reconciledAt?: string | null;
  reconciledBy?: string | null;
  movementId?: string | null;
  issueNote?: string | null;
  currentStock: number;
};

export const deliveredStockReconciliationApi = {
  list: () => get<{ generatedAt: string; rows: DeliveredStockReconciliationRow[] }>("/api/delivered-stock-reconciliation"),
  reconcile: (lineIds: string[]) => post<{ reconciledLines: number; movements: unknown[] }>("/api/delivered-stock-reconciliation/reconcile", { lineIds }),
  flag: (lineIds: string[], note: string) => post<{ flagged: number }>("/api/delivered-stock-reconciliation/flag", { lineIds, note }),
  resolve: (lineId: string) => post<{ resolved: boolean }>(`/api/delivered-stock-reconciliation/${encodeURIComponent(lineId)}/resolve`, {})
};

// ── State replenishment notes ─────────────────────────────
// The only stored part of the State Replenishment page. Everything else there
// is derived in the browser from stock, orders and waybills.
export type StateReplenishmentNote = {
  id: string;
  stateKey: string;
  stateLabel: string;
  productId: string | null;
  productName: string;
  body: string;
  createdBy: string | null;
  createdByName: string;
  createdAt: string;
};
export const stateReplenishmentNotesApi = {
  list: () => get<{ notes: StateReplenishmentNote[] }>("/api/state-replenishment-notes"),
  create: (body: { stateKey: string; stateLabel: string; productId: string | null; productName: string; body: string }) =>
    post<{ note: StateReplenishmentNote }>("/api/state-replenishment-notes", body),
  remove: (id: string) => del<{ deleted: boolean }>(`/api/state-replenishment-notes/${encodeURIComponent(id)}`)
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

export const managerProductChallengesApi = {
  list: (window?: { from?: string; to?: string }) => {
    const params = new URLSearchParams();
    if (window?.from) params.set("from", window.from);
    if (window?.to) params.set("to", window.to);
    const query = params.toString();
    return get<any>(`/api/manager-product-challenges${query ? `?${query}` : ""}`);
  },
  create: (body: unknown) => post<any>("/api/manager-product-challenges", body),
  update: (id: string, body: unknown) => patch<any>(`/api/manager-product-challenges/${id}`, body),
  remove: (id: string) => del<void>(`/api/manager-product-challenges/${id}`),
  saveAllocations: (id: string, allocations: unknown[]) => put<any>(`/api/manager-product-challenges/${id}/allocations`, { allocations }),
  markIncentivePaid: (id: string, body: { note?: string; people: Array<{ kind: string; personId: string | null; personName: string; earned: number; rate: number | null }> }) =>
    post<any>(`/api/manager-product-challenges/${id}/incentive/paid`, body),
  undoIncentivePaid: (id: string, body: { kind: string; personId: string | null }) =>
    request<any>("DELETE", `/api/manager-product-challenges/${id}/incentive/paid`, body)
};

export const upsellBonusApi = {
  settings: () => get<any>("/api/upsell-bonuses/settings"),
  updateSettings: (body: unknown) => patch<any>("/api/upsell-bonuses/settings", body)
};

export type HeadOfSalesScorecardMetric = {
  key: string; label: string; weight: number;
  targetMode: "baseline" | "manual"; targetValue: number | null;
};

export const headOfSalesApi = {
  // range is optional: when the picker resolves to something other than a
  // full Sunday week (Today, Yesterday, a custom range) the server computes
  // over the real dates instead of snapping onto the containing week.
  overview: (repId: string, weekStart?: string, range?: { from: string; to: string }) => {
    const params = new URLSearchParams({ repId });
    if (weekStart) params.set("weekStart", weekStart);
    if (range?.from && range?.to) { params.set("dateFrom", range.from); params.set("dateTo", range.to); }
    return get<any>(`/api/head-of-sales-rep/overview?${params.toString()}`);
  },
  scorecard: (repId: string, weekStart?: string) => {
    const params = new URLSearchParams({ repId });
    if (weekStart) params.set("weekStart", weekStart);
    return get<any>(`/api/head-of-sales-rep/scorecard?${params.toString()}`);
  },
  // range is optional: when the picker resolves to something other than a
  // full Sunday week (Today, Yesterday, a custom range) the server computes
  // over the real dates instead of snapping onto the containing week.
  teamPerformance: (repId: string, weekStart?: string, range?: { from: string; to: string }) => {
    const params = new URLSearchParams({ repId });
    if (weekStart) params.set("weekStart", weekStart);
    if (range?.from && range?.to) { params.set("dateFrom", range.from); params.set("dateTo", range.to); }
    return get<any>(`/api/head-of-sales-rep/team-performance?${params.toString()}`);
  },
  // range is optional: when the picker resolves to something other than a
  // full Sunday week (Today, Yesterday, a custom range) the server computes
  // over the real dates instead of snapping onto the containing week.
  upsellCrossSell: (repId: string, weekStart?: string, range?: { from: string; to: string }) => {
    const params = new URLSearchParams({ repId });
    if (weekStart) params.set("weekStart", weekStart);
    if (range?.from && range?.to) { params.set("dateFrom", range.from); params.set("dateTo", range.to); }
    return get<any>(`/api/head-of-sales-rep/upsell-cross-sell?${params.toString()}`);
  },
  scorecardSettings: (repId: string) =>
    get<{ metrics: HeadOfSalesScorecardMetric[]; isDefault: boolean; defaults: HeadOfSalesScorecardMetric[] }>(
      `/api/head-of-sales-rep/scorecard-settings?repId=${encodeURIComponent(repId)}`),
  updateScorecardSettings: (metrics: Array<{ key: string; weight: number; targetMode: "baseline" | "manual"; targetValue: number | null }>) =>
    patch<{ metrics: HeadOfSalesScorecardMetric[]; isDefault: boolean }>(
      "/api/head-of-sales-rep/scorecard-settings", { metrics }),
  repCoaching: (repId: string, selectedRepId?: string, weekStart?: string) => {
    const params = new URLSearchParams({ repId });
    if (selectedRepId) params.set("selectedRepId", selectedRepId);
    if (weekStart) params.set("weekStart", weekStart);
    return get<any>(`/api/head-of-sales-rep/rep-coaching?${params.toString()}`);
  },
  callReviews: (repId: string, selectedRepId: string, weekStart?: string, weekEnd?: string) => {
    const params = new URLSearchParams({ repId, selectedRepId });
    if (weekStart) params.set("weekStart", weekStart);
    if (weekEnd) params.set("weekEnd", weekEnd);
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
    repId: string; selectedRepId: string; description: string; targetCount?: number; targetIsPercentage?: boolean; dueDate?: string;
  }) => post<any>("/api/head-of-sales-rep/coaching-plan/action-items", body),
  updateCoachingActionItem: (itemId: string, body: {
    repId: string; status?: string; completedCount?: number; description?: string; targetCount?: number; targetIsPercentage?: boolean; dueDate?: string | null;
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
    keyLearnings?: string; additionalNotes?: string; focusTargetAov?: number; focusTargetDeliveryRate?: number; focusTargetUpsellRate?: number;
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

// Upsell & Cross-Selling Performance (Manager Dashboard). The call log only -
// upsell offers and answers per confirmation call, plus each rep's latest
// weekly target. The money is worked out in the browser, by the same
// calculation as the Upsell & Cross-Sell Bonus tab.
export type UpsellPerformanceOffer = {
  response: "accepted" | "declined" | "consider_later" | "not_appropriate" | "waived_no_offer";
  refusalReason: string | null;
  offeredQuantity: number | null;
  offeredPackageName: string | null;
  offeredProductName: string | null;
};
export type UpsellPerformanceLogRow = {
  orderId: string;
  repId: string;
  attemptedAt: string;
  attemptedKey: string;
  eligible: boolean;
  exemptionReason: string | null;
  productId: string | null;
  productName: string;
  originalQuantity: number;
  upsell: UpsellPerformanceOffer | null;
};
export type UpsellPerformanceLog = {
  dateFrom: string;
  dateTo: string;
  attempts: UpsellPerformanceLogRow[];
  targets: Array<{ repId: string; targetPct: number; weekStart: string }>;
};
export const upsellPerformanceApi = {
  log: (dateFrom: string, dateTo: string) =>
    get<UpsellPerformanceLog>(`/api/upsell-performance/log?${new URLSearchParams({ dateFrom, dateTo }).toString()}`)
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
  // The candidate card shows these before a claim, and a Recovery Rep's
  // GET /api/orders never contains an unclaimed candidate to fall back on.
  state?: string | null; city?: string | null; address?: string | null;
  closedAt: string; createdAt: string; reason: string;
};
export type RecoveryWorklistRow = {
  orderId: string; customer: string; phone: string;
  state?: string | null; city?: string | null;
  productName?: string | null; amount: number; currency: string; status: string;
  category: string; categoryCode: string; categoryLabel: string; priority: number;
  lastOutcome?: string | null; scheduledDate?: string | null; daysSinceClosed?: number | null;
  assignedRepId?: string | null; customerOrders: number; customerDelivered: number;
};
export type RecoveryWorklistView = {
  rows: RecoveryWorklistRow[];
  counts: Record<string, number>;
  dormantDays: number;
  categories: Record<string, { code: string; label: string; blurb: string }>;
  notTracked: string[];
};
export type RecoveryCandidatesView = {
  rows: RecoveryCandidateRow[];
  cap: number; held: number; remaining: number; canClaim: boolean;
};

export type RecoveryCalendarDay = {
  day: string;
  followUp: number;
  retention: number;
  delivered: number;
  claimed: number;
  heldAtStart?: number;
  status: "none" | "rest" | "critical" | "below" | "above";
  attainment: number | null;
  /** Board was full, so no claim was possible - not counted as a miss. */
  claimCapped: boolean;
};

export type RecoveryCalendarView = {
  from: string;
  to: string;
  targets: { followUp: number; retention: number; delivered: number; claimed: number } | null;
  bonusPerRecoveredOrder: number;
  monthlyRecoveredTarget: number;
  days: RecoveryCalendarDay[];
  followUpTotal: number;
  retentionTotal: number;
  deliveredTotal: number;
  claimedTotal: number;
  claimDaysMet: number;
  claimDaysMissed: number;
  claimDaysAtCap: number;
  claimCap: number;
  belowTargetDays: number;
  aboveTargetDays: number;
  restDays: number;
};

export type RecoveryFollowUpEntry = {
  at: string; outcome: string; note: string; reached: boolean; channel: string; repName: string;
};
/** Per order: the rep's own newest attempt, and the newest by anyone else. */
export type RecoveryFollowUpPairs = Record<string, {
  mine: RecoveryFollowUpEntry | null;
  prior: RecoveryFollowUpEntry | null;
}>;

export type RecoveryDayActivity = {
  day: string;
  followUps: Array<{
    orderId: string; customer: string; phone: string; status: string;
    at: string; channel: string; outcome: string; note: string;
    reached: boolean; nextActionAt: string | null;
    /** Identical saves collapsed into one row - see the endpoint's warning. */
    repeats: number;
  }>;
  retention: Array<{ orderId: string; customer: string; at: string; stage: string; outcome: string; response: string }>;
  claimed: Array<{ orderId: string; customer: string; phone: string; status: string; amount: number }>;
  delivered: Array<{ orderId: string; customer: string; amount: number }>;
};

export const recoveryRepKpiApi = {
  dayActivity: (day: string, repId?: string) => {
    const qs = new URLSearchParams({ day });
    if (repId) qs.set("repId", repId);
    return get<RecoveryDayActivity>(`/api/recovery-rep-kpi/day-activity?${qs.toString()}`);
  },
  followUpPairs: (repId?: string) =>
    get<{ pairs: RecoveryFollowUpPairs }>(
      `/api/recovery-rep-kpi/follow-up-pairs${repId ? `?repId=${encodeURIComponent(repId)}` : ""}`),
  calendar: (params: { repId?: string; dateFrom?: string; dateTo?: string }) => {
    const qs = new URLSearchParams();
    if (params.repId) qs.set("repId", params.repId);
    if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
    if (params.dateTo) qs.set("dateTo", params.dateTo);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return get<RecoveryCalendarView>(`/api/recovery-rep-kpi/calendar${suffix}`);
  },
  candidates: (repId?: string) =>
    get<RecoveryCandidatesView>(`/api/recovery-rep-kpi/candidates${repId ? `?repId=${encodeURIComponent(repId)}` : ""}`),
  worklist: (dormantDays?: number) =>
    get<RecoveryWorklistView>(`/api/recovery-rep-kpi/worklist${dormantDays ? `?dormantDays=${dormantDays}` : ""}`),
  claimCandidate: (orderId: string, repId?: string) =>
    post<{ ok: boolean; held: number; cap: number; remaining: number; claimedAt: string }>(
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

// ── Sales Closer: manually logged social-DM leads ──────────────────────
export type SalesLead = {
  id: string;
  fullName: string;
  phone: string;
  alternatePhone: string;
  whatsappNumber: string;
  email: string;
  preferredContactMethod: "whatsapp" | "call" | "sms" | "email";
  state: string;
  city: string;
  address: string;
  source: "whatsapp" | "instagram" | "tiktok" | "facebook" | "website" | "phone" | "referral" | "other";
  campaign: string;
  interestedProductIds: string[];
  packageId: string | null;
  notes: string;
  status: "new_lead" | "contacted" | "qualified" | "follow_up" | "order_created" | "not_interested";
  tags: string[];
  priority: "low" | "medium" | "high";
  assignedCloserId: string | null;
  followUpAt: string | null;
  convertedOrderId: string | null;
  convertedAt: string | null;
  lastActivityAt: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

// convertedOrderId/convertedAt ARE settable here - Convert to Order writes
// them once a real order exists (the id/lastActivityAt/createdBy/timestamps
// below stay server-only).
export type SalesLeadInput = Partial<Omit<SalesLead, "id" | "lastActivityAt" | "createdBy" | "createdAt" | "updatedAt">>;

export type SalesLeadKpi = { value: number; deltaVsYesterday: number };
export type SalesCloserOverview = {
  kpis: { newLeads: SalesLeadKpi; contacted: SalesLeadKpi; qualified: SalesLeadKpi; ordersCreated: SalesLeadKpi; delivered: SalesLeadKpi };
  funnel: { newLeads: number; contacted: number; qualified: number; ordersCreated: number; delivered: number };
  conversionRates: { leadToOrder: number; leadToDelivered: number; orderConversionRate: number };
  followUpsDue: Array<{ id: string; fullName: string; productNames: string[]; followUpAt: string }>;
  performanceThisMonth: { leads: number; ordersCreated: number; deliveredOrders: number; deliveryRate: number; aovDelivered: number; deliveredRevenue: number; upsellRevenue: number; crossSellRevenue: number };
  recentLeads: Array<{ id: string; fullName: string; productNames: string[]; source: string; status: string; createdAt: string }>;
};
export type SalesCloserFollowUpRow = {
  id: string;
  fullName: string;
  phone: string;
  whatsappNumber: string;
  productNames: string[];
  source: string;
  status: string;
  priority: string;
  followUpAt: string;
  lastActivityAt: string;
  overdue: boolean;
};
export type SalesCloserFollowUps = {
  kpis: { totalFollowUps: number; dueToday: number; dueThisWeek: number; overdue: number; converted: number };
  rows: SalesCloserFollowUpRow[];
};

export type SalesCloserOrderKpi = { value: number; deltaVsLastMonth: number };
export type SalesCloserOrderRow = {
  id: string;
  customer: string;
  productName: string;
  packageName: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  closedByCloserName: string;
  deliveredDate: string | null;
};
export type SalesCloserOrders = {
  kpis: { ordersCreated: SalesCloserOrderKpi; deliveredOrders: SalesCloserOrderKpi; deliveredRevenue: SalesCloserOrderKpi; aov: SalesCloserOrderKpi; deliveryRate: SalesCloserOrderKpi };
  orders: SalesCloserOrderRow[];
  conversionSummaryThisMonth: { leadsCaptured: number; ordersCreated: number; deliveredOrders: number; leadToOrderRate: number; leadToDeliveredRate: number };
  topProducts: Array<{ productName: string; orders: number; revenue: number }>;
};

export type SalesCloserPerformance = {
  funnel: { newLeads: number; contacted: number; qualified: number; ordersCreated: number; delivered: number };
  conversionRates: { leadToOrder: number; leadToDelivered: number; orderConversionRate: number };
  trend: Array<{ date: string; leads: number; orders: number }>;
  leadsBySource: Array<{ source: string; count: number }>;
  topProducts: Array<{ productName: string; orders: number; delivered: number; revenue: number; aov: number; conversionRate: number }>;
  summary: { leadsCaptured: number; ordersCreated: number; deliveredOrders: number; deliveredRevenue: number; aov: number; leadToOrderRate: number; leadToDeliveredRate: number; upsellRevenue: number; crossSellRevenue: number };
};

export type SalesCloserBonusTier = { id: string; label: string; minValue: number; amount: number };
export type SalesCloserBonusComponent = {
  id: string;
  label: string;
  description: string;
  metric: "leadToOrderRate" | "leadToDeliveredRate" | "aov" | "upsellCrossSellRevenue" | "activityScore" | "deliveryRate";
  tiers: SalesCloserBonusTier[];
};
export type SalesCloserBonusSettings = { currency: string; components: SalesCloserBonusComponent[]; allocatedSalaryMonthly: number; packagingCostPerUnit: number; updatedAt: string | null };
export type SalesCloserBonusComponentResult = { id: string; label: string; metric: string; achieved: number; tierId: string | null; tierLabel: string | null; amount: number };
export type SalesCloserBonusRecord = { id: string; monthStart: string; componentResults: SalesCloserBonusComponentResult[]; totalAmount: number; status: "Pending" | "Paid"; notes: string | null; paidAt: string | null };
export type SalesCloserBonus = {
  monthStart: string;
  settings: SalesCloserBonusSettings;
  record: SalesCloserBonusRecord | null;
  preview: { componentResults: SalesCloserBonusComponentResult[]; totalAmount: number } | null;
  summary: { totalEarnedThisMonth: number; totalPotential: number; bonusPaid: number; payoutPending: number };
  history: Array<{ monthStart: string; totalAmount: number; status: "Pending" | "Paid"; paidAt: string | null }>;
};

export type SalesCloserLeaderboardRow = {
  closerId: string;
  closerName: string;
  active: boolean;
  leads: number;
  orders: number;
  leadToOrderRate: number;
  delivered: number;
  leadToDeliveredRate: number;
  aov: number;
  revenue: number;
};

export type SalesCloserCostProfitability = {
  monthStart: string;
  deliveredRevenue: number;
  productCost: number;
  deliveryCost: number;
  packaging: number;
  discounts: number;
  closerBonus: number;
  allocatedSalary: number;
  netProfit: number;
  deliveredOrders: number;
  deliveredUnits: number;
};

export const salesLeadsApi = {
  list: (status?: string) => {
    const qs = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
    return get<{ leads: SalesLead[] }>(`/api/sales-leads${qs}`);
  },
  detail: (id: string) => get<SalesLead>(`/api/sales-leads/${encodeURIComponent(id)}`),
  create: (body: SalesLeadInput) => post<SalesLead>("/api/sales-leads", body),
  update: (id: string, body: SalesLeadInput) => patch<SalesLead>(`/api/sales-leads/${encodeURIComponent(id)}`, body),
  overview: () => get<SalesCloserOverview>("/api/sales-leads/overview"),
  followUps: () => get<SalesCloserFollowUps>("/api/sales-leads/follow-ups"),
  orders: () => get<SalesCloserOrders>("/api/sales-leads/orders"),
  performance: () => get<SalesCloserPerformance>("/api/sales-leads/performance"),
  bonusSettings: () => get<{ settings: SalesCloserBonusSettings }>("/api/sales-leads/bonus-settings"),
  updateBonusSettings: (body: Partial<Pick<SalesCloserBonusSettings, "currency" | "components" | "allocatedSalaryMonthly" | "packagingCostPerUnit">>) => patch<{ settings: SalesCloserBonusSettings }>("/api/sales-leads/bonus-settings", body),
  bonus: (monthStart?: string, closerId?: string) => {
    const qs = new URLSearchParams();
    if (monthStart) qs.set("monthStart", monthStart);
    if (closerId) qs.set("closerId", closerId);
    const suffix = qs.toString();
    return get<SalesCloserBonus>(`/api/sales-leads/bonus${suffix ? `?${suffix}` : ""}`);
  },
  saveBonus: (body: { closerId: string; monthStart: string; notes?: string }) => put<{ id: string; totalAmount: number }>("/api/sales-leads/bonus", body),
  markBonusPaid: (body: { closerId: string; monthStart: string }) => post<{ id: string; status: "Paid" }>("/api/sales-leads/bonus/mark-paid", body),
  closersLeaderboard: (monthStart?: string) => {
    const qs = monthStart ? `?monthStart=${encodeURIComponent(monthStart)}` : "";
    return get<{ monthStart: string; rows: SalesCloserLeaderboardRow[] }>(`/api/sales-leads/closers-leaderboard${qs}`);
  },
  costProfitability: (closerId: string, monthStart?: string) => {
    const qs = new URLSearchParams({ closerId });
    if (monthStart) qs.set("monthStart", monthStart);
    return get<SalesCloserCostProfitability>(`/api/sales-leads/cost-profitability?${qs.toString()}`);
  }
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
export type CartRecoveryStat = {
  assigned: number; worked: number; reached: number; converted: number; delivered: number;
  revenue: number;
  counts: { converted: number; not_interested: number; unresponsive: number; wrong_number: number; pending: number };
  /** Median hours from assignment to the first logged attempt. Null when no
   *  cart in the set has ever been contacted. */
  medianFirstContactHours: number | null;
  unloggedToday: number;
  /** Of the carts that did NOT convert, how many got 3+ attempts. */
  deepAttempts: number; unconverted: number;
};

export type CartRecoverySummary = {
  from: string | null; to: string | null; todayKey?: string;
  totals: CartRecoveryStat;
  reps: Array<CartRecoveryStat & {
    repId: string; repName: string;
    /** Same shape as the team flags, scoped to this rep - so a flag can name
     *  who owns it without a second request. */
    flags: { quickClose: number; bulkClose: number; weakFollowUp: number; closedUnworked: number; closesWithTimestamp: number };
  }>;
  flags: { quickClose: number; bulkClose: number; weakFollowUp: number; closedUnworked: number; closesWithTimestamp: number };
  days: Array<CartRecoveryStat & { key: string }>;
};

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
    const res = await fetchWithApiFailover(`/api/public/embed-settings/${orgId}`, { cache: "default" });
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
export type MarketingPerformanceFilters = {
  productId?: string;
  campaign?: string;
  source?: string;
  mediaBuyer?: string;
};

export type MarketingLeaderboardRow = {
  key: string;
  label: string;
  kind: "paid" | "organic" | "unattributed";
  campaigns: number;
  products: number;
  ordersPlaced: number;
  confirmed: number;
  confirmationRate: number | null;
  delivered: number;
  deliveryRate: number | null;
  adSpend: number | null;
  costPerDeliveredOrder: number | null;
  deliveredAov: number | null;
  deliveredRevenue: number;
  netProfit: number | null;
  margin: number | null;
  roas: number | null;
  status: "profitable" | "losing" | "high_value" | "check_tag" | "spend_unknown";
};

export type MarketingPerformance = {
  from: string;
  to: string;
  /** The last day actually counted - today, when the window runs past it. */
  countedTo: string;
  previousFrom: string;
  previousTo: string;
  totals: {
    /** ⚠️ null means the spend is not known - never treat it as zero. */
    adSpend: number | null;
    spendBasis: "actual" | "budget" | "mixed" | "none";
    spendRecords: number;
    companySpend: number;
    buyerSpend: number;
    /** A filter asked for a split the spend was never recorded at. */
    spendNotSplittable: boolean;
    daysWithoutSpend: number;
    periodDays: number;
    leads: number | null;
    ordersPlaced: number;
    placedValue: number;
    confirmed: number;
    delivered: number;
    confirmedPending: number;
    awaitingConfirmation: number;
    lost: number;
    deliveredRevenue: number;
    productCost: number;
    deliveryCost: number;
    trueNetProfit: number | null;
    profitMargin: number | null;
    costPerLead: number | null;
    costPerOrder: number | null;
    costPerConfirmed: number | null;
    costPerDeliveredOrder: number | null;
    placedAov: number | null;
    deliveredAov: number | null;
    roas: number | null;
    breakEvenCostPerDelivered: number | null;
    breakEvenHeadroom: number | null;
    /** Logistics paid per successful delivery. Known without any ad spend. */
    avgDeliveryCost: number | null;
    /** Ads plus delivery per delivered order - CPDO alone is the ads half. */
    totalCostToDeliver: number | null;
    /** The most ads + delivery can cost per delivered order and still break even. */
    breakEvenTotalCostToDeliver: number | null;
    /** Delivered orders whose delivery fee was never entered. */
    deliveredWithoutFee: number;
    /** Delivery fees paid on orders that failed - spent, nothing sold. */
    failedDeliveryCost: number;
    /** APDO: profit per delivered order before salaries, rent and running costs. */
    profitPerDeliveredOrder: number | null;
    /** Rep bonuses earned on these delivered orders - both bonus systems. */
    repBonuses: number;
    /** Salaries, waybill, airtime, other - this selection's share under a filter. */
    overheadByCategory: Array<{ category: string; amount: number }>;
    overheadCost: number;
    /** Running costs were split by share of delivered revenue (a filter is on). */
    overheadShared: boolean;
    /** The bonus rules could not be worked out, so net is unknown. */
    bonusesUnavailable: boolean;
    netProfit: number | null;
    /** Average net profit per delivered order - after salaries and running costs. */
    netProfitPerDeliveredOrder: number | null;
    leadToOrderRate: number | null;
    confirmationRate: number | null;
    deliveryRateOfConfirmed: number | null;
    /** Delivered ÷ placed - the Orders page's "X delivered of Y". */
    deliveryRate: number | null;
    /** Placed orders that are neither delivered nor lost yet. */
    inProgress: number;
  };
  /** Change against the same number of days just before; null when not comparable. */
  deltas: {
    adSpend: number | null;
    ordersPlaced: number | null;
    deliveredRevenue: number | null;
    costPerOrder: number | null;
    costPerDeliveredOrder: number | null;
    placedAov: number | null;
    deliveredAov: number | null;
    roas: number | null;
    avgDeliveryCost: number | null;
    totalCostToDeliver: number | null;
    profitPerDeliveredOrder: number | null;
    netProfitPerDeliveredOrder: number | null;
    /** Percentage points (0.05 = +5 pts), not a relative change. */
    deliveryRate: number | null;
  };
  leaderboard: MarketingLeaderboardRow[];
  options: {
    products: Array<{ id: string; name: string }>;
    campaigns: string[];
    sources: string[];
    mediaBuyers: string[];
  };
};

export const marketingSpendApi = {
  /** Ad spend through to profit for one period. */
  performance: (from: string, to: string, filters: MarketingPerformanceFilters = {}) => {
    const qs = new URLSearchParams({ from, to });
    for (const [key, value] of Object.entries(filters)) if (value) qs.set(key, value);
    return get<MarketingPerformance>(`/api/marketing-spend/performance?${qs.toString()}`);
  },
  /** Orders placed per day under the page's filters - the period shortcut counts. */
  orderCounts: (from: string, to: string, filters: MarketingPerformanceFilters = {}) => {
    const qs = new URLSearchParams({ from, to });
    for (const [key, value] of Object.entries(filters)) if (value) qs.set(key, value);
    return get<{ days: Record<string, number> }>(`/api/marketing-spend/order-counts?${qs.toString()}`);
  },
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
  delete: (id: string) => del<{ ok: boolean }>(`/api/meta-capi-settings/${encodeURIComponent(id)}`),
  // What Meta got for one order, and the last 7 days (1 Oct 2026).
  events: (orderId: string) => get<MetaCapiEventRow[]>(`/api/meta-capi-settings/events?orderId=${encodeURIComponent(orderId)}`),
  eventsSummary: () => get<{ since: string; counts: Record<string, Record<string, number>>; topProblems: Array<{ message: string; count: number }> }>("/api/meta-capi-settings/events/summary")
};
export type MetaCapiEventRow = {
  eventName: "Purchase" | "Delivered"; metaEventName: string; eventId: string;
  status: "sent" | "dry_run" | "rejected" | "failed" | "duplicate" | "missing_config";
  httpStatus: number | null; message: string | null; testMode: boolean; value: number; currency: string | null; attempts: number; sentAt: string;
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
  source?: string | null;
  status: string; repId: string; repName: string; assignedAt?: string | null;
  createdAt: string; createdKey: string;
  convertedOrderId?: string | null; convertedOrderStatus?: string | null;
  /** Finished: order delivered, customer said no, or the number was wrong.
   *  A display state only - logging stays possible if they come back. */
  closed?: boolean; closedReason?: string | null;
  /** When it reached a terminal status. NULL for carts closed before
   *  migration 239 - there was no record then - and NULL while still open. */
  closedAt?: string | null;
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

export type CartLogRangePreset =
  | "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "all";

export type CartLogMiss = {
  id: string | null; repId: string; repName: string; missDate: string;
  cartsDue: number; cartsLogged: number; cartsMissed: number; amount: number;
  status: "pending" | "approved" | "waived";
  reviewedByName: string; reviewedAt: string | null; reviewNote: string;
  affectedCarts?: Array<{ id: string; customer: string; phone: string; productName: string; assignedAt: string | null; reason: string }>;
};

export type CartLogPenaltiesView = {
  range: CartLogRangePreset;
  from: string; to: string; todayKey: string;
  phase: { active: boolean; startDate: string; daysUntil: number; label: string };
  missAmount: number;
  chargeableDays: number;
  misses: CartLogMiss[];
  /**
   * Closed days in the CURRENT week, computed outside the range filter - so a
   * rep browsing another period still sees what they already owe.
   */
  owedThisWeek: CartLogMiss[];
  byRep: Array<{ repId: string; repName: string; missedDays: string[]; missedCount: number; missedCarts: number; atRiskAmount: number; clearDays: number }>;
  totals: {
    pendingCount: number; pendingAmount: number;
    approvedCount: number; approvedAmount: number; waivedCount: number;
  };
  /** Present tense, for the rep reading it. Null when viewing all reps. */
  today: {
    dateKey: string; cartsDue: number; logsMade: number;
    /** Carts still untouched right now - what the charge is counted on. */
    cartsRemaining: number;
    status: "not_due" | "clear" | "missed" | "before_go_live";
    atRisk: number; rehearsal: boolean; message: string;
  } | null;
  /** Supervisor view: reps with carts still unlogged today, worst exposure first. */
  repsAtRiskToday: Array<{
    repId: string; repName: string; cartsDue: number; logsMade: number;
    cartsLogged: number; cartsRemaining: number; atRisk: number;
  }>;
};

export type OrderAdditionalLine = {
  id: string; productId: string; productName: string;
  quantity: number; amount: number; bonusEligible: boolean; note: string;
  addedAt: string; addedById: string | null; addedByName: string; addedByRole: string;
};

export const ordersExtraApi = {
  /** Replaces the whole set of extra (non-cross-sell) lines on an order. */
  saveAdditionalLines: (
    orderId: string,
    body: {
      lines: Array<{ productId: string; quantity: number; amount: number; bonusEligible: boolean; note: string }>;
      adjustOrderAmount: boolean;
    }
  ) => put<{
    lines: OrderAdditionalLine[]; amount: number;
    breakdown: { total: number; crossSell: number; additional: number; main: number };
  }>(`/api/orders/${orderId}/additional-lines`, body)
};

export type CostChangeImpact = {
  previousUnitCost: number; newUnitCost: number; delta: number;
  ordersAffected: number; unitsAffected: number;
  /** How much reported profit would move if history were not frozen. */
  reportedProfitShift: number;
  alreadyFrozen: number;
};

export const productCostApi = {
  /** Freeze every delivered order's COGS at today's costs. Idempotent. */
  freezeAll: () => post<{ frozen: number; units: number; message: string }>("/api/products/freeze-cogs", {}),
  preview: (productId: string, newUnitCost: number) =>
    get<{ productId: string; productName: string; currency: string; impact: CostChangeImpact }>(
      `/api/products/${productId}/cost-change-preview?newUnitCost=${encodeURIComponent(String(newUnitCost))}`),
  changeCost: (productId: string, body: { newUnitCost: number; reason: string; freezeHistory: boolean }) =>
    post<{ productId: string; previousUnitCost: number; newUnitCost: number; ordersFrozen: number; unitsFrozen: number }>(
      `/api/products/${productId}/change-cost`, body)
};

export type CartAssignmentPanel = {
  active: boolean;
  mode: "rotation";
  assignmentDelayMinutes: number;
  contactSlaMinutes: number;
  eligibleReps: number;
  totalReps: number;
  unassignedCarts: number;
  workStartMinute: number;
  workEndMinute: number;
  worksSunday: boolean;
  /** Whether carts are being handed out right now. */
  windowOpenNow: boolean;
  /** Only Owner and Admin may change the rules; a Manager watches. */
  canEditRules: boolean;
  /** Only the Owner is told who is online; everyone else gets null. */
  showsPresence: boolean;
  reps: Array<{ id: string; name: string; openCarts: number; isNext: boolean; online: boolean | null }>;
  recentAssignments: Array<{ cartId: string; customer: string; repName: string; assignedAt: string }>;
};

/** The branch's cart hand-out rules - readable by every role (the rep's countdown uses them). */
export type CartHandOutRules = {
  enabled: boolean;
  assignmentDelayMinutes: number;
  contactSlaMinutes: number;
  workStartMinute: number;
  workEndMinute: number;
  worksSunday: boolean;
  /** From this many minutes before closing, a cart goes out after closingRushWaitMinutes. */
  closingRushWindowMinutes: number;
  closingRushWaitMinutes: number;
};

export const cartsApi = {
  /** The branch's hand-out rules, for any role. */
  assignmentRules: () => get<CartHandOutRules>("/api/carts/assignment-rules"),
  /** Who the rotation would pick next, and what each rep is carrying. */
  assignmentPanel: () => get<CartAssignmentPanel>("/api/carts/assignment-panel"),
  saveAssignmentRules: (body: {
    enabled: boolean;
    assignmentDelayMinutes: number;
    contactSlaMinutes: number;
    workStartMinute: number;
    workEndMinute: number;
    worksSunday: boolean;
  }) => put<{ saved: boolean }>("/api/carts/assignment-rules", body),
  /** Recovery funnel over ANY range - the follow-up grid only knows one week. */
  recoverySummary: (params: { from?: string; to?: string; productId?: string }) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.productId) qs.set("productId", params.productId);
    const query = qs.toString();
    return get<CartRecoverySummary>(`/api/carts/recovery-summary${query ? `?${query}` : ""}`);
  },
  logPenalties: (params?: { range?: CartLogRangePreset; repId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.range) qs.set("range", params.range);
    if (params?.repId) qs.set("repId", params.repId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return get<CartLogPenaltiesView>(`/api/carts/log-penalties${suffix}`);
  },
  reviewLogPenalty: (body: { repId: string; missDate: string; status: "approved" | "waived"; note: string }) =>
    post<{ ok: boolean }>("/api/carts/log-penalties/review", body),
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
      /** True when this repeats an order already recorded for the same cart. */
      replayed?: boolean;
      /** On a replay, the original order's Purchase event id (so Meta counts it once). */
      metaPurchaseEventId?: string | null;
      /** The ONE Pixel the server sent this Purchase to; the browser fires only it. */
      metaPixelId?: string | null;
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

// ── Weekly Report approvals (rep → manager → owner) ──────────────────────────
export type WeeklyRepReportStatus = "draft" | "submitted" | "returned" | "manager_approved" | "owner_approved" | "locked";
export type WeeklyCompanyReportStatus = "open" | "submitted_to_owner" | "returned_to_manager" | "locked";
export type WeeklyRepReport = {
  id: string; repId: string; weekStart: string; status: WeeklyRepReportStatus;
  snapshot: any | null; repNote: string | null; submitCount: number; submittedAt: string | null;
  managerReviewedBy: string | null; managerReviewedAt: string | null;
  ownerApprovedBy: string | null; ownerApprovedAt: string | null; lockedAt: string | null; updatedAt: string | null;
};
export type WeeklyCompanyReport = {
  id: string; weekStart: string; status: WeeklyCompanyReportStatus;
  managerNote: string | null; ownerNote: string | null;
  companySnapshot: any | null; managerBonusSnapshot: any | null; submitCount: number;
  submittedBy: string | null; submittedAt: string | null; lockedBy: string | null; lockedAt: string | null;
  reopenedBy: string | null; reopenedAt: string | null; reopenReason: string | null;
};
export type WeeklyReportCorrection = {
  id: string; weekStart: string; repReportId: string | null; companyReportId: string | null;
  kind: "return" | "flag"; section: string; problem: string; comment: string; orderRef: string | null;
  raisedBy: string | null; raisedByName: string | null; raisedByRole: string | null;
  status: "open" | "resolved"; response: string | null; resolvedBy: string | null; resolvedAt: string | null; createdAt: string;
};
export type WeeklyReportAuditEntry = {
  id: string; weekStart: string; repReportId: string | null; companyReportId: string | null; repId: string | null;
  actorId: string | null; actorName: string | null; actorRole: string | null; action: string; detail: any | null; createdAt: string;
};
export type WeeklyReportFineRow = { id: string; repId: string; label: string; amount: number; date: string };
export type WeeklyReportAdjustmentRow = { id: string; repId: string; label: string; amount: number };
export type WeeklyLogMissRow = {
  kind: "follow_up" | "cart_log"; ref: string; repId: string; missDate: string; amount: number;
  status: "pending" | "approved" | "waived"; label: string; orderId?: string | null; cartsMissed?: number;
};
export type LogMissDispute = {
  id: string; repId: string; kind: "follow_up" | "cart_log"; ref: string; missDate: string; amount: number; orderId: string | null;
  checkVerdict: "miss_confirmed" | "miss_wrong"; checkResult: { findings?: Array<{ level: "issue" | "info" | "ok"; text: string }> };
  repReason: string | null; status: "open" | "cancelled" | "kept" | "awaiting_owner";
  decidedByName: string | null; decidedAt: string | null; decisionNote: string | null; createdAt: string;
};
export type WeeklyBonusQuery = {
  id: string; repId: string; weekStart: string; orderRefs: string[]; repMessage: string | null;
  checkVerdict: "accurate" | "issues";
  checkResult: { verdict?: string; findings?: Array<{ level: "issue" | "info" | "ok"; text: string; orderId?: string }>; checkedAt?: string; checkedFinalBonus?: number };
  sentDespiteAccurate: boolean; status: "open" | "corrected" | "no_change";
  managerResponse: string | null; correctionAmount: number; correctionWeekStart: string | null;
  resolvedBy: string | null; resolvedByName: string | null; resolvedAt: string | null; createdAt: string;
};
export type WeeklyReportCorrectionInput = { weekStart: string; section: string; problem: string; comment: string; orderRef?: string; fundTransactionId?: string };
export type WeeklyReportResponseInput = { correctionId: string; response: string };

export const weeklyReportsApi = {
  mine: (weekStart: string) =>
    get<{ weekStart: string; weekEnd: string; report: WeeklyRepReport | null; companyStatus: WeeklyCompanyReportStatus; corrections: WeeklyReportCorrection[]; audit: WeeklyReportAuditEntry[]; fines: WeeklyReportFineRow[]; previousFines: WeeklyReportFineRow[];
      adjustments: WeeklyReportAdjustmentRow[]; previousAdjustments: WeeklyReportAdjustmentRow[]; bonusQueries: WeeklyBonusQuery[];
      logMisses: WeeklyLogMissRow[]; previousLogMisses: WeeklyLogMissRow[]; logMissDisputes: LogMissDispute[]; carriedFines: number }>(
      `/api/weekly-reports/mine?${new URLSearchParams({ weekStart }).toString()}`
    ),
  myHistory: () => get<{ rows: Array<WeeklyRepReport & { openReturns: number }> }>("/api/weekly-reports/mine/history"),
  submitMine: (body: { weekStart: string; snapshot: unknown; note?: string; responses?: WeeklyReportResponseInput[] }) =>
    post<{ ok: true }>("/api/weekly-reports/mine/submit", body),
  week: (weekStart: string) =>
    get<{
      weekStart: string; weekEnd: string; company: WeeklyCompanyReport | null; repReports: WeeklyRepReport[];
      corrections: WeeklyReportCorrection[]; audit: WeeklyReportAuditEntry[]; expectedRepIds: string[];
      editedAfterSubmit: Array<{ repId: string; orderId: string; editedAt: string; what: string; by: string | null }>;
      fines: WeeklyReportFineRow[]; previousFines: WeeklyReportFineRow[];
      adjustments: WeeklyReportAdjustmentRow[]; previousAdjustments: WeeklyReportAdjustmentRow[]; bonusQueries: WeeklyBonusQuery[];
      logMisses: WeeklyLogMissRow[]; previousLogMisses: WeeklyLogMissRow[]; logMissDisputes: LogMissDispute[]; carriedFines: Record<string, number>;
      funds?: Array<{ managerId: string; managerName: string; totals: ManagerFundTotals; readiness: string[]; locked: boolean; varianceExplanation: string | null; notes: string | null; returned: number }>;
    }>(`/api/weekly-reports/week?${new URLSearchParams({ weekStart }).toString()}`),
  history: () => get<{ rows: Array<{ weekStart: string; weekEnd: string; company: WeeklyCompanyReport | null; repStatusCounts: Record<string, number> }> }>("/api/weekly-reports/history"),
  approveRep: (repId: string, body: { weekStart: string; note?: string }) =>
    post<{ ok: true }>(`/api/weekly-reports/rep/${encodeURIComponent(repId)}/approve`, body),
  returnRep: (repId: string, body: WeeklyReportCorrectionInput) =>
    post<{ ok: true }>(`/api/weekly-reports/rep/${encodeURIComponent(repId)}/return`, body),
  flagRep: (repId: string, body: WeeklyReportCorrectionInput) =>
    post<{ ok: true }>(`/api/weekly-reports/rep/${encodeURIComponent(repId)}/flag`, body),
  submitCompany: (body: { weekStart: string; managerNote?: string; companySnapshot: unknown; managerBonusSnapshot?: unknown; responses?: WeeklyReportResponseInput[] }) =>
    post<{ ok: true }>("/api/weekly-reports/company/submit", body),
  approveLock: (body: { weekStart: string; note?: string }) => post<{ ok: true }>("/api/weekly-reports/company/approve-lock", body),
  returnCompany: (body: WeeklyReportCorrectionInput) => post<{ ok: true }>("/api/weekly-reports/company/return", body),
  reopen: (body: { weekStart: string; reason: string }) => post<{ ok: true }>("/api/weekly-reports/company/reopen", body),
  sendBonusQuery: (body: {
    weekStart: string; orderRefs: string[]; message?: string;
    check: { verdict: "accurate" | "issues"; findings: Array<{ level: "issue" | "info" | "ok"; text: string; orderId?: string }>; checkedFinalBonus?: number };
    sendDespiteAccurate?: boolean;
  }) => post<{ sent: boolean; id?: string }>("/api/weekly-reports/mine/bonus-queries", body),
  resolveBonusQuery: (id: string, body: { outcome: "corrected" | "no_change"; response: string; amount?: number }) =>
    post<{ ok: true; paidWeekStart: string | null }>(`/api/weekly-reports/bonus-queries/${encodeURIComponent(id)}/resolve`, body)
};

// ── Manager Funds & Expenses (manager wallet) ────────────────────────────────
export type FundKindKey = "customer_payment" | "owner_funding" | "company_transfer_in" | "other_in" | "expense" | "remittance_out";
export type ManagerFundTxn = {
  id: string; managerId: string; weekStart: string; kind: FundKindKey; kindLabel: string;
  category: string | null; categoryLabel: string | null; amount: number; occurredAt: string;
  description: string | null; paidTo: string | null; paymentMethod: string | null; reference: string | null;
  orderIds: string[]; counterpartyAccountId: string | null;
  evidence: Array<{ path: string; name: string; mime: string; size: number; uploadedAt: string }>;
  status: "recorded" | "returned" | "voided"; returnReason: string | null; voidReason: string | null;
  adjustsTransactionId: string | null; version: number; createdByName: string | null; createdAt: string; updatedAt: string;
  missingProof: string | null;
  /** Rider fees matched to the orders' own delivery fees: paid from the wallet, not a new cost. */
  countedOnOrders?: number;
};
export type ManagerFundOrderCheck = {
  orders: Array<{ id: string; customer: string; status: string; amount: number; deliveryFee: number; received: number; expected: number; left: number; remittanceStatus: string | null }>;
  split: { counted: number; newCost: number } | null;
};
export type ManagerFundTotals = {
  opening: number; received: number; receivedBySource: Record<string, number>; spent: number; spentByCategory: Record<string, number>;
  remitted: number; expected: number; actual: number | null; variance: number | null; otherIn: number;
  counts: { in: number; expense: number; out: number }; pending: number;
};
export type ManagerFundWeek = {
  weekStart: string; weekEnd: string;
  manager: { id: string; name: string } | null;
  managers: Array<{ id: string; name: string }>;
  wallet?: { id: string; name: string } | null;
  week?: { opening: number; openingSource: string; actualClosing: number | null; varianceExplanation: string | null; notes: string | null; locked: boolean; closingSnapshot: ManagerFundTotals | null };
  companyStatus?: string; editable?: boolean; editableReason?: string | null;
  settings?: { expenseProofMin: number; remittanceProofRequired: boolean; ownerFundingReferenceRequired: boolean; otherInProofRequired: boolean };
  totals?: ManagerFundTotals; readiness?: string[];
  transactions: ManagerFundTxn[];
  companyAccounts?: Array<{ id: string; name: string; bankName: string }>;
  adjustments?: Array<{ id: string; transactionId: string; originalAmount: number; requestedAmount: number; reason: string; status: "pending" | "approved" | "rejected"; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null; createdAt: string }>;
  daily?: Array<{ date: string; moneyIn: number; expenses: number; remitted: number }>;
  categories?: Array<{ key: string; label: string }>;
};
export type ManagerFundLogInput = {
  kind: FundKindKey; category?: string; amount: number; occurredAt: string; description?: string; paidTo?: string;
  paymentMethod?: "cash" | "transfer" | "pos" | "other"; reference?: string; orderId?: string; relatedOrderIds?: string[];
  counterpartyAccountId?: string; varianceReason?: string;
};

export const managerFundsApi = {
  week: (weekStart: string, managerId?: string) => {
    const qs = new URLSearchParams({ weekStart });
    if (managerId) qs.set("managerId", managerId);
    return get<ManagerFundWeek>(`/api/manager-funds/week?${qs.toString()}`);
  },
  log: (body: ManagerFundLogInput) => post<{ id: string }>("/api/manager-funds/transactions", body),
  edit: (id: string, body: Partial<Omit<ManagerFundLogInput, "kind" | "orderId">>) => patch<{ ok: true }>(`/api/manager-funds/transactions/${encodeURIComponent(id)}`, body),
  void: (id: string, reason: string) => post<{ ok: true }>(`/api/manager-funds/transactions/${encodeURIComponent(id)}/void`, { reason }),
  uploadEvidence: (id: string, dataUrl: string, name: string) => post<{ ok: true }>(`/api/manager-funds/transactions/${encodeURIComponent(id)}/evidence`, { dataUrl, name }),
  evidenceUrl: (transactionId: string, path: string) => get<{ url: string }>(`/api/manager-funds/evidence-url?${new URLSearchParams({ transactionId, path }).toString()}`),
  saveWeek: (body: { weekStart: string; actualClosing?: number | null; varianceExplanation?: string | null; notes?: string | null }) =>
    request<{ ok: true }>("PUT", "/api/manager-funds/week", body),
  requestAdjustment: (body: { transactionId: string; requestedAmount: number; reason: string }) => post<{ id: string }>("/api/manager-funds/adjustments", body),
  orderCheck: (ids: string[], options: { amount?: number; category?: string; excludeTxnId?: string } = {}) => {
    const qs = new URLSearchParams({ ids: ids.join(",") });
    if (options.amount !== undefined) qs.set("amount", String(options.amount));
    if (options.category) qs.set("category", options.category);
    if (options.excludeTxnId) qs.set("excludeTxnId", options.excludeTxnId);
    return get<ManagerFundOrderCheck>(`/api/manager-funds/order-check?${qs.toString()}`);
  },
  decideAdjustment: (id: string, body: { approve: boolean; note?: string }) => post<{ ok: true }>(`/api/manager-funds/adjustments/${encodeURIComponent(id)}/decide`, body),
  saveSettings: (body: { expenseProofMin: number; remittanceProofRequired: boolean; ownerFundingReferenceRequired: boolean; otherInProofRequired: boolean }) =>
    request<{ ok: true }>("PUT", "/api/manager-funds/settings", body)
};

// ── Missed-log charges: check and dispute ────────────────────────────────────
export const logMissApi = {
  check: (kind: "follow_up" | "cart_log", ref: string) =>
    post<{ verdict: "miss_confirmed" | "miss_wrong"; findings: Array<{ level: "issue" | "info" | "ok"; text: string }>; status: string; amount: number; disputeId: string | null }>("/api/log-misses/check", { kind, ref }),
  escalate: (kind: "follow_up" | "cart_log", ref: string, reason: string) => post<{ id: string }>("/api/log-misses/escalate", { kind, ref, reason }),
  decide: (id: string, outcome: "cancel" | "keep", note: string) => post<{ ok: true; status: string }>(`/api/log-misses/disputes/${encodeURIComponent(id)}/decide`, { outcome, note })
};

// The Head of Sales bonus on the weekly report and the Owner's release
// (Bright, 1 Oct 2026). "Was a script used" reads the Sales Scripting library.
export type HeadOfSalesRepInfluence = {
  repId: string; repName: string; isHead: boolean;
  upsellRate: number; baselineUpsellRate: number; crossSellRate: number; baselineCrossSellRate: number;
  expansionOrders: number; scriptOrders: number;
  verdict: "influenced" | "mixed" | "own_effort" | "no_improvement" | "no_sales"; label: string;
};
export type HeadOfSalesReview = {
  weekStart: string;
  head: { id: string; name: string } | null;
  scripts?: { live: number; used: Array<{ scriptId: string; title: string; productName: string; category: string; used: number; accepted: number; byOthers: number }> };
  team?: { aov: number; deliveryRate: number; upsellRate: number; crossSellRate: number; baselineUpsellRate: number; baselineCrossSellRate: number };
  evaluation?: { level: string; label: string; amount: number };
  qualitative?: { upsellImprovement: boolean; initiativeSuccess: boolean };
  teamImproved?: boolean;
  reps?: HeadOfSalesRepInfluence[];
  scriptUses?: number;
  hold?: { held: boolean; reasons: string[] };
  record?: { status: string; amount: number; level: string; paidAt: string | null } | null;
  release?: { decision: "released" | "withheld"; wasHeld: boolean; level: string; amount: number; note: string | null; decidedBy: string | null; decidedAt: string } | null;
  weekOver?: boolean;
};
export const salesScriptApi = {
  headReview: (weekStart: string) => get<HeadOfSalesReview>(`/api/sales-scripts/head-review?weekStart=${encodeURIComponent(weekStart)}`),
  release: (body: { weekStart: string; decision: "release" | "withhold"; upsellImprovement?: boolean; initiativeSuccess?: boolean; note?: string }) =>
    post<HeadOfSalesReview>("/api/sales-scripts/head-review/release", body)
};

// Sales Scripting (Bright, 1 Oct 2026): the Head of Sales script library,
// manager approval with versions, the rep's view on an order, usage report.
export type ScriptCategory = "closing" | "upsell" | "cross_sell" | "objection";
// ⚠️ request() camelCases every response KEY, so a map keyed by category
// arrives with "crossSell", not "cross_sell" (the values stay "cross_sell").
// Read category-keyed maps through this.
export const byCategory = <T,>(map: Record<string, T> | undefined, category: ScriptCategory): T | undefined =>
  map ? (map[category] ?? map[category.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())]) : undefined;
export type ScriptVersion = {
  id: string; versionNo: number; status: "draft" | "submitted" | "returned" | "rejected" | "approved" | "archived";
  title: string; scenario: string; objective: string; whenToUse: string; trigger: string; whatToSay: string;
  keyPoints: string[]; mustSay: string[]; neverSay: string[]; desiredAction: string;
  priority: "primary" | "alternative" | "experimental"; impact: "high" | "medium" | "low";
  closingStyle: "direct" | "choice" | "delivery" | "urgency" | "confirmation" | null; objection: string | null;
  upsellFromQty: number | null; upsellToQty: number | null; crossSellProductId: string | null;
  createdByName: string | null; createdAt: string; submittedAt: string | null;
  decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
  approvedAt: string | null; archivedAt: string | null; replacedByVersionId: string | null;
};
export type ScriptSummary = {
  id: string; productId: string; category: ScriptCategory;
  status: "approved" | "pending" | "draft" | "returned" | "rejected" | "deactivated" | "archived";
  live: ScriptVersion | null; latest: ScriptVersion | null; hasPendingChange: boolean; versionsCount: number;
  createdByName: string | null; createdAt: string;
  deactivatedAt: string | null; deactivatedByName: string | null; deactivationNote: string | null; archivedAt: string | null;
  outdatedPrices: number[];
};
export type ScriptSettings = {
  minPerCategory: number; minUses: number; highRatio: number; performingRatio: number; underRatio: number; dropPoints: number;
  deliveryOffer: string; productDeliveryOffers: Record<string, string>; defaultMustSay: string[]; defaultNeverSay: string[];
};
export type ScriptProduct = {
  id: string; name: string; imageUrl: string | null; currency: string; scriptCount: number;
  readiness: { percent: number; categories: Record<string, { count: number; min: number; ok: boolean }> };
  packages: Array<{ quantity: number; price: number; name: string }>;
  crossSellProducts: Array<{ id: string; name: string }>;
  deliveryOffer: string;
};
export type ScriptLibrary = {
  canAuthor: boolean; canApprove: boolean; settings: ScriptSettings;
  products: ScriptProduct[]; allProducts: Array<{ id: string; name: string }>;
  scripts: ScriptSummary[]; archivedCount: number;
  kpis: { total: number; approved: number; approvedLast7: number; pending: number; drafts: number };
};
export type ScriptFields = {
  title: string; scenario: string; objective: string; whenToUse: string; trigger: string; whatToSay: string;
  keyPoints: string[]; mustSay: string[]; neverSay: string[]; desiredAction: string;
  priority: ScriptVersion["priority"]; impact: ScriptVersion["impact"];
  closingStyle?: ScriptVersion["closingStyle"]; objection?: string | null;
  upsellFromQty?: number | null; upsellToQty?: number | null; crossSellProductId?: string | null;
};
export type ScriptWarnings = {
  preview: { whatToSay: string; keyPoints: string[]; mustSay: string[] };
  missingPlaceholders: string[]; outdatedPrices: number[];
  duplicates: Array<{ id: string; title: string; reason: "same_purpose" | "same_wording" }>;
};
export type ScriptAuditEntry = { action: string; actorName: string | null; actorRole: string | null; detail: any; at: string; versionId: string | null };
export type RepScript = {
  id: string; versionId: string; versionNo: number; category: ScriptCategory; title: string; scenario: string;
  priority: string; impact: string; whenToUse: string; trigger: string; objection: string | null; closingStyle: string | null;
  whatToSay: string; keyPoints: string[]; mustSay: string[]; neverSay: string[]; desiredAction: string;
  upsellFromQty: number | null; upsellToQty: number | null; crossSellProductName: string | null; extraAmount: string | null; suggested: boolean;
};
export type ScriptFunnel = { shown: number; used: number; accepted: number; delivered: number; acceptanceRate: number; deliveredConversion: number; incrementalRevenue: number };
export type ScriptHealth = "high" | "performing" | "needs_review" | "underperforming" | "insufficient";
export type ScriptUsageReport = {
  period: { from: string; to: string; previousFrom: string; previousTo: string };
  settings: ScriptSettings;
  kpis: { activeApproved: number; pending: number; needsReview: number; used: number; scriptAssistedSales: number; upsellConversion: number; crossSellConversion: number; incrementalRevenue: number };
  scripts: Array<{
    scriptId: string; productId: string; productName: string; category: ScriptCategory; categoryLabel: string; title: string; versionNo: number; live: boolean;
    pairName: string | null; upgradePath: string | null; funnel: ScriptFunnel; previousFunnel: ScriptFunnel; categoryAverage: number;
    health: ScriptHealth; healthLabel: string; healthReason: string; outdatedPrices: number[];
  }>;
  leaders: Array<{
    productName: string; category: ScriptCategory; categoryLabel: string; early: boolean;
    best: { scriptId: string; title: string; used: number; acceptanceRate: number; deliveredConversion: number };
    others: Array<{ scriptId: string; title: string; used: number; acceptanceRate: number; deliveredConversion: number }>;
  }>;
  pairs: Array<ScriptFunnel & { productName: string; pairName: string }>;
};
const scriptQuery = (period?: { from?: string; to?: string }) => {
  const params = new URLSearchParams();
  if (period?.from) params.set("from", period.from);
  if (period?.to) params.set("to", period.to);
  const text = params.toString();
  return text ? `?${text}` : "";
};
export const salesScriptingApi = {
  library: () => get<ScriptLibrary>("/api/sales-scripting/library"),
  archived: () => get<{ scripts: ScriptSummary[] }>("/api/sales-scripting/archived"),
  script: (id: string) => get<{ script: ScriptSummary; versions: Array<ScriptVersion & { used: number; accepted: number }>; audit: ScriptAuditEntry[] }>(`/api/sales-scripting/scripts/${encodeURIComponent(id)}`),
  preview: (body: { scriptId?: string | null; productId: string; category: ScriptCategory; fields: Partial<ScriptFields> }) => post<ScriptWarnings>("/api/sales-scripting/preview", body),
  create: (body: { productId: string; category: ScriptCategory; fields: ScriptFields; submit?: boolean }) => post<{ id: string; warnings: ScriptWarnings }>("/api/sales-scripting/scripts", body),
  update: (id: string, body: { fields: ScriptFields; submit?: boolean }) => put<{ id: string; warnings: ScriptWarnings }>(`/api/sales-scripting/scripts/${encodeURIComponent(id)}`, body),
  submit: (id: string) => post<{ ok: true }>(`/api/sales-scripting/scripts/${encodeURIComponent(id)}/submit`, {}),
  remove: (id: string) => del<{ ok: true }>(`/api/sales-scripting/scripts/${encodeURIComponent(id)}`),
  decide: (id: string, action: "approve" | "return" | "reject", note?: string) => post<{ ok: true }>(`/api/sales-scripting/scripts/${encodeURIComponent(id)}/decide`, { action, note }),
  retire: (id: string, action: "deactivate" | "reactivate" | "archive", note?: string) => post<{ ok: true }>(`/api/sales-scripting/scripts/${encodeURIComponent(id)}/retire`, { action, note }),
  forOrder: (orderId: string) => get<{ orderId: string; product: { id: string; name: string } | null; quantity: number; sections: Record<string, RepScript[]>; uses: Record<string, { outcome: "accepted" | "declined"; usedAt: string }>; canRecord: boolean }>(`/api/sales-scripting/for-order/${encodeURIComponent(orderId)}`),
  shown: (orderId: string, scriptId: string) => post<{ ok: true }>(`/api/sales-scripting/for-order/${encodeURIComponent(orderId)}/shown`, { scriptId }),
  use: (orderId: string, scriptId: string, outcome: "accepted" | "declined" | null) => post<{ ok: true }>(`/api/sales-scripting/for-order/${encodeURIComponent(orderId)}/use`, { scriptId, outcome }),
  usage: (period?: { from?: string; to?: string }) => get<ScriptUsageReport>(`/api/sales-scripting/usage${scriptQuery(period)}`),
  usageReps: (scriptId: string, period?: { from?: string; to?: string }) => get<{ rows: Array<ScriptFunnel & { repId: string; repName: string }>; categoryAverage: number; diagnosis: string | null; versions: Array<ScriptFunnel & { versionNo: number; status: string }> }>(`/api/sales-scripting/usage/${encodeURIComponent(scriptId)}/reps${scriptQuery(period)}`),
  saveSettings: (settings: Partial<ScriptSettings>) => put<{ settings: ScriptSettings }>("/api/sales-scripting/settings", settings)
};

// Tracking Hub (Bright, 2 Oct 2026; every tab rebuilt to his images the same day). Owner only.
export type HubStrategy = "browser_capi" | "capi_only" | "landing_page";
export type HubPlatform = "meta" | "tiktok" | "google" | "snapchat" | "other";
export type HubLedgerStatus = "deduped" | "server_only" | "browser_only" | "capi_failed" | "test" | "not_tracked" | "page_pixel" | "capi_only" | "sending";
export type HubKpis = { orders: number; purchaseEvents: number; browserEvents: number; serverEvents: number; deduped: number; unmatched: number; failed: number; browserPct: number; serverPct: number; purchasePct: number; dedupRate: number; unmatchedPct: number };
export type HubPeriod = { from: string; to: string; compareFrom: string; compareTo: string; length: number };
export type HubLedgerRow = {
  orderId: string; createdAt: string; product: string; productId: string | null; productImage?: string | null; website: string | null; landingPath: string | null; source: string | null;
  campaignId: string | null; adsetId: string | null; adId: string | null; value: number; currency: string; orderStatus: string | null;
  trackingMode: string; trackingKey: string | null; browser: boolean; browserAt: string | null; serverStatus: string | null; serverAt: string | null; serverTest: boolean; serverPixel: string | null; eventId: string | null;
  status: HubLedgerStatus; statusLabel: string;
};
export type HubDataSource = {
  id: string; name: string; description: string; platform: HubPlatform; businessName: string; adAccountIds: string[]; adAccountLabel: string; pixelId: string;
  datasetName: string | null; currency: string; timezone: string; hasToken: boolean; ownToken: boolean; active: boolean; hasAccess: boolean | null;
  connectionId: string | null; connectionName: string | null; metaLastFiredAt: string | null; testEventCode: string; isMain: boolean; status: "production" | "testing" | "paused";
  lastCheckAt: string | null; lastCheckOk: boolean | null; lastCheckMessage: string | null; metaStatsAt: string | null; emq: Record<string, number> | null;
  events7d: number | null; events7dChange: number | null; eventsFromMeta: boolean; sentByProtohub7d: number;
  health: "healthy" | "testing" | "error" | "no_token" | "unchecked" | "disconnected" | "off" | "no_access"; healthy: boolean; createdAt: string;
};
export type HubConnection = {
  id: string; name: string; businessId: string; systemUserName: string | null; hasToken: boolean; currency: string; timezone: string;
  lastCheckAt: string | null; lastCheckOk: boolean | null; lastCheckMessage: string | null; human: { title: string; action: string } | null;
  lastSyncAt: string | null; lastSyncOk: boolean | null; lastSyncMessage: string | null; status: "connected" | "error" | "disconnected" | "sync_failed";
  pixels: Array<{ sourceId: string; pixelId: string; name: string; active: boolean; hasAccess: boolean | null; lastFiredAt: string | null; health: HubDataSource["health"]; ownToken: boolean }>;
  adAccounts: Array<{ id: string; accountId: string; name: string; currency: string | null; active: boolean; hasAccess: boolean; status: number | null }>;
};
export type HubSyncResult = { ok: boolean; message: string; pixels: number; newPixels: number; accounts: number; newAccounts: number; noAccess: number };
export type HubIssue = {
  key: string; severity: "red" | "orange" | "yellow"; level: "critical" | "warning" | "info"; title: string; detail: string; action: string; at: string | null;
  tab: string; affected: string; actionLabel: string; orderIds?: string[]; subjectId?: string | null;
};
export type HubDataSourceDetail = HubDataSource & {
  eventsManagerUrl: string;
  browser: { lastEventAt: string | null; receiving: boolean; emq: number | null };
  capi: { lastEventAt: string | null; connected: boolean; emq: number | null };
  counts7d: Record<string, number> | null; prev7d: Record<string, number> | null;
  recent: Array<{ name: string; count: number; change: number | null }>; recentLoaded: boolean;
  issues: HubIssue[];
  logs: Array<{ at: string; action: string; by: string | null; detail: Record<string, unknown> }>;
  sends: Array<{ at: string; orderId: string; event: string; status: string; message: string | null; test: boolean }>;
};
export type HubScanPage = { url: string; ok: boolean; status: number | null; pixels: string[]; protohubForm: boolean; purchaseOnPage: boolean; usesTagManager: boolean; error?: string; kind: "home" | "landing" | "thank_you" };
export type HubWebsite = {
  id: string; domain: string; label: string; platform: string; dataSourceId: string | null; dataSourceName: string | null; dataSourceIsMain: boolean; dataSourcePlatform: string;
  notes: string | null; forms: number; activeForms: number; orders7d: number; lastBrowserEvent: string | null; lastEvent: string | null; duplicatePixel: boolean; landingPages: string[];
  pixelCount: number; browserPages: number; browserSeenPages: number;
  lastScanAt: string | null; lastScan: { pages: HubScanPage[]; at: string } | null; status: "healthy" | "warning" | "disconnected"; problems: string[]; createdAt: string;
};
export type HubWebsiteDetail = HubWebsite & {
  siteUrl: string;
  dataSource: { id: string; name: string; isMain: boolean; hasToken: boolean; platform: string } | null;
  orders30d: number; orders30dChange: number;
  landingStats: Array<{
    path: string; orders30d: number; link: string | null; linkId: string | null; strategy: string | null;
    expectedPixel: { id: string; name: string; fromDefault: boolean } | null; foundPixels: Array<{ id: string; name: string | null }>;
    extraPixels: Array<{ id: string; name: string; seen: boolean }>;
    lastBrowserEvent: string | null; checkedAt: string | null; status: "ok" | "no_link" | "not_checked" | "missing_pixel" | "two_pixels" | "wrong_pixel";
  }>;
  forms: Array<{ id: string; label: string; landingPath: string | null; strategy: string; active: boolean }>;
  checks: Array<{ key: string; label: string; ok: boolean; value: string }>;
  recent: Array<{ name: string; count: number; change: number }>;
  issues: HubIssue[];
};
export type HubProfile = { id: string; name: string; dataSourceId: string | null; defaultWebsiteId: string | null; strategy: HubStrategy; adAccountLabel: string; status: "production" | "testing" };
export type HubHealthItem = { key: string; label: string; total: number; healthy: number; detail: string };
export type HubOverview = {
  period: HubPeriod; kpis: HubKpis; previous: HubKpis;
  chart: Array<{ day: string; orders: number; browser: number; server: number }>;
  health: { score: number; items: HubHealthItem[] };
  attribution: { orders: number; fields: Array<{ key: string; label: string; pct: number }> };
  dataSources: HubDataSource[]; websites: HubWebsite[]; recent: HubLedgerRow[]; attention: HubIssue[]; issueCount: number;
};
export type HubLinkStats = { views: number; orders: number; conversionRate: number; revenue: number; spark: Array<{ day: string; views: number; orders: number }> };
export type HubLink = {
  id: string; trackingKey: string; label: string; active: boolean; productId: string | null; productName: string | null; productImage: string | null;
  websiteId: string | null; websiteDomain: string | null; landingPageUrl: string; landingPath: string | null; redirectUrl: string; formLabel: string;
  packageSet: string | null; currency: string | null;
  dataSourceId: string | null; dataSourceName: string | null; dataSourcePlatform: string; pixelId: string | null; profileId: string | null; profileName: string | null;
  extraPixels: Array<{ id: string; name: string; pixelId: string; status: "production" | "testing" | "paused"; active: boolean; hasToken: boolean }>;
  strategy: HubStrategy | "off"; mode: string; testEventCode: string;
  checklist: { thankYouPixelRemoved?: boolean; testEventSeen?: boolean; confirmedBy?: string | null; confirmedAt?: string };
  adUrl: string | null; createdAt: string; updatedAt: string; stats: HubLinkStats; healthy: boolean; problems: string[];
  status: "healthy" | "needs_review" | "low_performance" | "paused";
};
export type HubPixelOption = {
  id: string; name: string; pixelId: string; status: string; platform: string; business: string | null; active: boolean; hasAccess: boolean | null;
  health: HubDataSource["health"]; lastFiredAt: string | null;
};
export type HubLinksResponse = {
  period: HubPeriod;
  kpis: { total: number; newThisMonth: number; orders: number; ordersChange: number; pageViews: number; pageViewsChange: number; conversionRate: number; conversionRateChange: number; healthy: number; healthyPct: number };
  links: HubLink[]; products: Array<{ id: string; name: string; packageSets: Array<{ name: string; currency: string | null; packages: number }> }>;
  dataSources: HubPixelOption[];
  websites: Array<{ id: string; domain: string; dataSourceId: string | null; pagePixels: Record<string, string[]> }>; profiles: HubProfile[]; defaultStrategy: HubStrategy; urlParameters: string;
};
export type HubLinkDetail = {
  id: string; label: string; trackingKey: string; adUrl: string | null; landingPageUrl: string; productName: string | null; productImage: string | null; websiteDomain: string | null; dataSourceName: string | null;
  landingPath: string | null; formLabel: string; redirectPath: string; createdAt: string; updatedAt: string; totalOrders: number;
  kpis: { views: number; viewsChange: number; orders: number; ordersChange: number; conversionRate: number; conversionRateChange: number; revenue: number; revenueChange: number };
  chart: Array<{ day: string; views: number; orders: number }>;
  campaigns: Array<{ campaignId: string; orders: number; views: number }>;
  attribution: Array<{ key: string; label: string; pct: number }>; attributionOrders: number; events: HubLedgerRow[];
};
export type HubLedgerResponse = {
  period: HubPeriod; kpis: HubKpis; previous: HubKpis; rows: HubLedgerRow[]; total: number; page: number; pageSize: number; tabCounts: Record<string, number>;
  filters: { dataSources: Array<{ id: string; name: string }>; websites: Array<{ id: string; domain: string }>; products: Array<{ id: string; name: string }> };
  mainPixelUrl: string;
};
export type HubLedgerDetail = HubLedgerRow & {
  productImage: string | null; sku: string | null; packageName: string | null;
  landingPage: string | null; referralUrl: string | null; thankYouPage: string | null; fbclid: string | null; fbp: string | null; fbc: string | null;
  utm: { source: string | null; campaign: string | null; content: string | null; term: string | null; medium: string | null };
  customer: { name: string | null; phone: string | null; state: string | null; city: string | null };
  device: { deviceType: string | null; userAgent: string | null; locale: string | null };
  browserEvent: { firedAt: string; eventId: string; pixelId: string | null; pageUrl: string | null; pixelsOnPage: string[] } | null;
  serverEvent: { sentAt: string; eventId: string; status: string; message: string | null; test: boolean; attempts: number; human: { title: string; action: string } | null } | null;
  deliveredEvent: { sentAt: string; status: string; metaEventName: string; message: string | null } | null;
  mainPixel: { pixelId: string; name: string | null } | null;
  extraPixelSends: Array<{ pixelId: string; name: string | null; status: string; test: boolean; sentAt: string; attempts: number; message: string | null; human: { title: string; action: string } | null }>;
  deliveredDate: string | null; timeline: Array<{ at: string; label: string; detail: string }>;
};
export type HubReconView = "campaign" | "adset" | "ad" | "landing_page" | "product" | "website";
export type HubVerdict = { tone: "ok" | "warn" | "info"; conclusion: string; likely: string };
export type HubReconRow = {
  id: string; name: string; view: HubReconView; image: string | null; productName: string | null; account: string; accountId: string | null; dataSourceName: string | null;
  protohub: number; meta: number | null; difference: number | null; matchRate: number | null; spend: number;
  status: "matched" | "investigate" | "resolved" | "no_meta" | "meta_higher" | "protohub_higher"; verdict: HubVerdict;
  /** What is known about the difference - facts only (orders sent, Meta's count, orders after the last load). */
  explanation?: string | null;
  /** Orders placed after Meta's numbers were loaded: not compared yet. */
  pendingMeta?: number;
};
export type HubReconProduct = { id: string; name: string; image: string | null; protohub: number; meta: number; difference: number; pendingMeta: number };
export type HubReconciliation = {
  period: HubPeriod; view: HubReconView; lastFetched: string | null;
  kpis: { protohub: number; protohubChange: number; protohubAll?: number; pendingMeta?: number; loadedAt?: string | null; meta: number | null; difference: number | null; matchRate: number | null; matched: number | null; matchedOf: number | null; investigate: number };
  rows: HubReconRow[];
  products?: HubReconProduct[];
  filters: { accounts: Array<{ id: string; label: string }>; businesses: string[]; websites: Array<{ id: string; domain: string }> };
  sources: Array<{ id: string; name: string; adAccounts: number; hasToken: boolean }>;
};
export type HubReconItem = HubReconRow & {
  chart: Array<{ day: string; protohub: number; meta: number }>;
  details: { adAccount: string | null; businessAccount: string | null; campaignId: string | null; objective: string | null; startDate: string | null; endDate: string | null; campaignStatus: string | null; landingPage: string | null; dataSource: string | null; form: string | null; adsManagerUrl: string };
  orders: HubLedgerRow[];
  metaRows: Array<{ day: string; campaign: string; adset: string; ad: string; purchases: number; value: number; spend: number }>;
  breakdown: { protohubOrders: number; purchaseEvents: number; sentToMeta: number; notSent: number; withoutFbclid: number; duplicates: number; metaPurchases: number | null };
  insights: string[];
  notes: Array<{ note: string | null; resolved: boolean; by: string | null; at: string }>;
};
export type HubDiagnostics = {
  period: HubPeriod;
  kpis: { score: number; ordersTracked: number; orders: number; trackedPct: number; browser: number; browserPct: number; browserMissing: number; server: number; serverPct: number; issues: number; critical: number; warning: number; info: number };
  items: HubHealthItem[];
  flow: Array<{ key: string; label: string; value: number; sub: string; pct: number }>;
  emq: { source: string; scores: Record<string, number> } | null;
  statusCounts: { deduplicated: number; serverOnly: number; browserOnly: number; failed: number; pending: number; pagePixel: number }; totalEvents: number;
  issues: HubIssue[];
  quickChecks: Array<{ label: string; ok: boolean; warn?: boolean; value: string }>;
  topPages: Array<{ path: string; domain: string; orders: number; issues: number }>;
  pixelCapi: HubDataSource[];
  attribution: Array<{ key: string; label: string; pct: number }>; attributionOrders: number;
  duplicates: Array<{ kind: string; detail: string; orderId: string | null }>;
  lostParams: Array<{ orderId: string; at: string; utmSource: string | null; referrer: string | null }>;
  activity: Array<{ at: string; action: string; subject: string | null; by: string | null; detail: Record<string, unknown> }>;
  websites: Array<{ id: string; domain: string }>;
};
export type HubSettings = {
  enabled: boolean; currency: string; timezone: string; sendBrowser: boolean; sendCapi: boolean; multiPlatform: boolean; logAllEvents: boolean;
  trackingMode: "order_based" | "thank_you" | "hybrid"; defaultStrategy: HubStrategy; defaultDataSources: Record<string, string>; defaultEventValue: "order_total";
  defaultWebsiteId: string | null; defaultProfileId: string | null;
  notifications: { capiFailures: boolean; connection: boolean; duplicatePixel: boolean; lostParameters: boolean; dailySummary: boolean };
  urlParameters: string; lowConversionRate: number; investigateBelowMatchRate: number;
};
export type HubSettingsResponse = {
  settings: HubSettings;
  dataSources: Array<{ id: string; name: string; platform: HubPlatform; pixelId: string; health: HubDataSource["health"]; isMain: boolean }>;
  websites: Array<{ id: string; domain: string }>; profiles: HubProfile[];
  health: Array<{ label: string; ok: boolean; value: string }>;
  defaultSource: { id: string; name: string; pixelId: string; health: HubDataSource["health"] } | null;
  lastSentAt: string | null; owners: Array<{ name: string; email: string }>;
};
export type HubAuditEntry = { at: string; action: string; subjectType: string | null; subject: string | null; by: string | null; detail: Record<string, unknown> };
type HubQuery = Record<string, string | number | undefined | null>;
const hubQuery = (query: HubQuery) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
};
const hubId = (id: string) => encodeURIComponent(id);
export const trackingHubApi = {
  overview: (query: HubQuery) => get<HubOverview>(`/api/tracking-hub/overview${hubQuery(query)}`),
  dataSources: () => get<{ kpis: { total: number; newThisMonth: number; healthy: number; healthyPct: number; needAttention: number; needAttentionPct: number; disconnected: number; disconnectedPct: number; off: number }; platformCounts: Record<HubPlatform, number>; dataSources: HubDataSource[]; connections: HubConnection[]; profiles: HubProfile[]; websites: Array<{ id: string; domain: string }>; issues: HubIssue[] }>("/api/tracking-hub/data-sources"),
  dataSource: (id: string) => get<HubDataSourceDetail>(`/api/tracking-hub/data-sources/${hubId(id)}`),
  saveDataSource: (id: string | null, body: Record<string, unknown>) => id ? put<{ id: string; name: string }>(`/api/tracking-hub/data-sources/${hubId(id)}`, body) : post<{ id: string; name: string }>("/api/tracking-hub/data-sources", body),
  deleteDataSource: (id: string) => del<{ ok: true }>(`/api/tracking-hub/data-sources/${hubId(id)}`),
  disconnectDataSource: (id: string) => post<{ ok: true }>(`/api/tracking-hub/data-sources/${hubId(id)}/disconnect`, {}),
  testDataSource: (id: string) => post<{ ok: boolean; message: string; canRead: boolean; lastFiredAt: string | null; human: { title: string; action: string } | null }>(`/api/tracking-hub/data-sources/${hubId(id)}/test`, {}),
  refreshDataSource: (id: string) => post<{ metaStats: Record<string, unknown> }>(`/api/tracking-hub/data-sources/${hubId(id)}/refresh`, {}),
  lookupToken: (accessToken: string) => post<{ userName: string | null; businesses: Array<{ id: string; name: string }>; businessesError: string | null }>("/api/tracking-hub/connections/lookup", { accessToken }),
  connect: (body: { accessToken: string; businessId?: string; currency: string; timezone: string }) => post<{ id: string; name: string; sync: HubSyncResult | null; syncError: string | null }>("/api/tracking-hub/connections", body),
  saveConnection: (id: string, body: { accessToken?: string; businessId?: string; currency: string; timezone: string }) => put<{ ok: true; name: string; sync: HubSyncResult | null; syncError: string | null }>(`/api/tracking-hub/connections/${hubId(id)}`, body),
  testConnection: (id: string) => post<{ ok: boolean; message: string; human: { title: string; action: string } | null }>(`/api/tracking-hub/connections/${hubId(id)}/test`, {}),
  syncConnection: (id: string) => post<HubSyncResult>(`/api/tracking-hub/connections/${hubId(id)}/sync`, {}),
  removeConnection: (id: string) => del<{ ok: true }>(`/api/tracking-hub/connections/${hubId(id)}`),
  disconnectConnection: (id: string) => post<{ ok: true }>(`/api/tracking-hub/connections/${hubId(id)}/disconnect`, {}),
  setPixelActive: (sourceId: string, active: boolean) => put<{ ok: true; linksUsing: number }>(`/api/tracking-hub/data-sources/${hubId(sourceId)}/active`, { active }),
  setAdAccountActive: (id: string, active: boolean) => put<{ ok: true }>(`/api/tracking-hub/ad-accounts/${hubId(id)}/active`, { active }),
  testEvent: (dataSourceId: string) => post<{ ok: boolean; status: string; eventId: string; message: string }>("/api/tracking-hub/test-event", { dataSourceId }),
  saveProfile: (id: string | null, body: Record<string, unknown>) => id ? put<HubProfile>(`/api/tracking-hub/profiles/${hubId(id)}`, body) : post<HubProfile>("/api/tracking-hub/profiles", body),
  deleteProfile: (id: string) => del<{ ok: true }>(`/api/tracking-hub/profiles/${hubId(id)}`),
  websites: () => get<{ kpis: { total: number; newThisMonth: number; wordpress: number; wordpressPct: number; healthy: number; healthyPct: number; withIssues: number; withIssuesPct: number; landingPages: number; externalForms: number }; websites: HubWebsite[]; detected: Array<{ domain: string; orders30d: number }>; dataSources: Array<{ id: string; name: string; platform: string; isMain: boolean }> }>("/api/tracking-hub/websites"),
  website: (id: string) => get<HubWebsiteDetail>(`/api/tracking-hub/websites/${hubId(id)}`),
  saveWebsite: (id: string | null, body: Record<string, unknown>) => id ? put<{ id: string }>(`/api/tracking-hub/websites/${hubId(id)}`, body) : post<{ id: string }>("/api/tracking-hub/websites", body),
  deleteWebsite: (id: string) => del<{ ok: true }>(`/api/tracking-hub/websites/${hubId(id)}`),
  scanWebsite: (id: string) => post<{ scan: { pages: HubScanPage[]; at: string }; summary: string[] }>(`/api/tracking-hub/websites/${hubId(id)}/scan`, {}),
  links: (query: HubQuery = {}) => get<HubLinksResponse>(`/api/tracking-hub/links${hubQuery(query)}`),
  link: (id: string, days = 7) => get<HubLinkDetail>(`/api/tracking-hub/links/${hubId(id)}?days=${days}`),
  saveLink: (id: string | null, body: Record<string, unknown>) => id ? put<{ id: string; tracking_key: string }>(`/api/tracking-hub/links/${hubId(id)}`, body) : post<{ id: string; tracking_key: string }>("/api/tracking-hub/links", body),
  duplicateLink: (id: string) => post<{ id: string; tracking_key: string }>(`/api/tracking-hub/links/${hubId(id)}/duplicate`, {}),
  bulkLinks: (ids: string[], action: "activate" | "pause" | "delete") => post<{ ok: true }>("/api/tracking-hub/links/bulk", { ids, action }),
  saveChecklist: (id: string, body: { thankYouPixelRemoved: boolean; testEventSeen: boolean }) => put<{ checklist: HubLink["checklist"] }>(`/api/tracking-hub/links/${hubId(id)}/checklist`, body),
  deleteLink: (id: string) => del<{ ok: true }>(`/api/tracking-hub/links/${hubId(id)}`),
  ledger: (query: HubQuery) => get<HubLedgerResponse>(`/api/tracking-hub/ledger${hubQuery(query)}`),
  ledgerExport: (query: HubQuery) => get<{ filename: string; csv: string }>(`/api/tracking-hub/ledger/export${hubQuery(query)}`),
  ledgerDetail: (orderId: string) => get<HubLedgerDetail>(`/api/tracking-hub/ledger/${hubId(orderId)}`),
  reconciliation: (query: HubQuery) => get<HubReconciliation>(`/api/tracking-hub/reconciliation${hubQuery(query)}`),
  reconciliationItem: (query: HubQuery) => get<HubReconItem>(`/api/tracking-hub/reconciliation/item${hubQuery(query)}`),
  reconciliationNote: (body: { scope: HubReconView; scopeId: string; note?: string; resolved?: boolean }) => post<{ ok: true }>("/api/tracking-hub/reconciliation/notes", body),
  reconciliationTargets: () => get<{ accounts: Array<{ account: string; label: string }> }>("/api/tracking-hub/reconciliation/targets"),
  refreshReconciliation: (period: { from: string; to: string; account?: string }) => post<{ report: Array<{ source: string; account: string; ok: boolean; message: string; rows: number }> }>("/api/tracking-hub/reconciliation/refresh", period),
  diagnostics: (query: HubQuery) => get<HubDiagnostics>(`/api/tracking-hub/diagnostics${hubQuery(query)}`),
  validateUrl: (url: string) => post<{ host: string; path: string; ok: boolean; note: string; checks: Array<{ key: string; label: string; value: string | null; required: boolean; ok: boolean }> }>("/api/tracking-hub/diagnostics/validate-url", { url }),
  settings: () => get<HubSettingsResponse>("/api/tracking-hub/settings"),
  saveSettings: (settings: HubSettings) => put<{ settings: HubSettings }>("/api/tracking-hub/settings", settings),
  audit: () => get<{ entries: HubAuditEntry[] }>("/api/tracking-hub/audit")
};

// ── Team Challenges (Bright, 3 Oct 2026) ─────────────────────────────────────
export type TeamChallengeMilestone = { key: string; target: number; winnerAmount: number; runnerUpAmount: number; minPerMember: number };
export type TeamChallengeScoring = { onePointFrom: number; twoPointsFrom: number; packagingPerUnit: number; linkWindowHours: number; productIds: string[] };
export type TeamChallengeBreakdown = { revenue: number; productCost: number; logistics: number; repBonus: number; packaging: number; gifts: number; adjustment: number; upgrade: { from: number; to: number } | null; crossSells: number };
export type TeamChallengeBaseline = { computedAt: string; averagePoints: number; months: Array<{ month: string; transactions: number; points: number; contribution: number; byTeam: Record<string, { transactions: number; points: number; contribution: number }>; byRep: Record<string, { transactions: number; points: number }> }> };
export type TeamChallengeEntryStatus = "awaiting_delivery" | "awaiting_payment" | "awaiting_verification" | "verified" | "correction_requested" | "excluded" | "reversed" | "linked";
export type TeamChallengeEntitlement = {
  key: string; target: number; reached: boolean; place: "winner" | "runner_up" | "tie" | null; entitlement: number; step: number; provisional: boolean;
  payout: { id: string; amount: number; perRep: Array<{ repId: string; name: string; amount: number }>; approvedAt: string; approvedBy: string | null; paidAt: string | null; reference: string | null } | null;
};
export type TeamChallengeTeam = {
  id: string; name: string; color: string;
  members: Array<{ id: string; name: string; points: number; orders: number; upsells: number; crossSells: number; pending: number; onePoint: number; twoPoint: number; contribution: number; assigned: number }>;
  linked: number;
  opportunity: { assigned: number; share: number; conversion: number; pointsPer100: number; products: Array<{ name: string; count: number }> };
  points: number; orders: number; upsells: number; crossSells: number; addedValue: number;
  onePoint: number; twoPoint: number; zeroPoint: number; contribution: number;
  reconciliation: { paid: number; entitled: number; over: number } | null;
  memberPending: Array<{ key: string; target: number; short: Array<{ repId: string; need: number; name: string }> }>;
  awaitingDelivery: number; awaitingPayment: number; awaitingVerification: number;
  nextMilestone: { key: string; target: number; away: number } | null;
  entitlements: TeamChallengeEntitlement[]; entitled: number; approved: number; paid: number; outstanding: number;
};
export type TeamChallengeEntry = {
  id: string; orderId: string; repId: string; repName: string; teamId: string | null; customer: string | null; product: string | null; packageName: string | null; orderStatus: string | null;
  category: "upsell" | "cross_sell" | "both"; points: number; verifiedPoints: number | null; ruleLabel: string | null; ruleVersion: number;
  original: { quantity: number | null; amount: number | null } | null;
  revised: { quantity: number | null; amount: number; package?: string; product?: string; crossSells: Array<{ product: string; quantity: number; amount: number }> } | null;
  addedValue: number; deliveredAt: string | null; paidAt: string | null; qualifiedAt: string | null;
  status: TeamChallengeEntryStatus; reason: string | null; decidedBy: string | null; decidedAt: string | null; repNote: string | null; reviewRequestedAt: string | null; updatedAt: string;
  contribution: number | null; breakdown: TeamChallengeBreakdown | null; final: boolean;
  adjustment: number; adjustmentReason: string | null; adjustmentBy: string | null; adjustedAt: string | null;
  escalatedAt: string | null; escalationNote: string | null; linkedTo: string | null;
};
export type TeamChallengeSummary = {
  sellingDays: number;
  teams: Array<{ id: string; name: string; points: number; transactions: number; onePoint: number; twoPoint: number; contribution: number; revenue: number; assigned: number; conversion: number; entitled: number; paid: number; outstanding: number; members: Array<{ id: string; name: string; points: number; transactions: number; contribution: number }> }>;
  milestones: Array<{ target: number; winners: Array<{ team: string; at: string | null }>; others: Array<{ team: string; at: string | null }>; provisional: boolean; tie: boolean }>;
  excluded: number; reversed: number; linked: number;
  exceptions: Array<{ orderId: string; rep: string; status: string; reason: string | null }>;
  entitled: number; paid: number; outstanding: number; maxBudget: number;
  baselineMonthly: number | null; challengeMonthly: number; uplift: number | null;
};
export type TeamChallengeDetail = {
  challenge: {
    id: string; name: string; status: "draft" | "active" | "paused" | "closed"; phase: string;
    sellFrom: string; sellTo: string; graceDays: number; graceUntil: string;
    milestones: TeamChallengeMilestone[]; scoring: TeamChallengeScoring; ruleVersion: number; sponsorNote: string | null;
    approvedBy: string | null; approvedAt: string | null; maxBudget: number; createdAt: string;
    baseline: TeamChallengeBaseline | null;
  };
  teams: TeamChallengeTeam[];
  race: { leaderTeamId: string | null; gap: number; results: Array<{ key: string; target: number; winnerAmount: number; runnerUpAmount: number; reached: Array<{ teamId: string; at: string }>; winnerTeamIds: string[]; runnerUpTeamIds: string[]; tie: boolean; provisional: boolean }> };
  kpis: { verifiedPoints: number; verifiedOrders: number; awaitingDelivery: number; awaitingVerification: number; addedRevenue: number; addedContribution: number; escalated: number; prizeBudget: number };
  entries: TeamChallengeEntry[];
  log: Array<{ id: string; actor: string | null; action: string; detail: Record<string, unknown> | null; at: string }>;
  me: { id: string; teamId: string | null; leader: boolean; owner: boolean };
  summary: TeamChallengeSummary;
};
export type TeamChallengeInput = {
  name: string; sellFrom: string; sellTo: string; graceDays: number;
  milestones: Array<{ target: number; winnerAmount: number; runnerUpAmount: number; minPerMember: number }>;
  scoring: TeamChallengeScoring; sponsorNote?: string;
  teams: Array<{ id?: string; name: string; color: string; memberIds: string[] }>;
  reason?: string;
};
export const teamChallengesApi = {
  list: () => get<{ challenges: Array<{ id: string; name: string; status: string; phase: string; sellFrom: string; sellTo: string; maxBudget: number }> }>("/api/team-challenges"),
  detail: (id: string) => get<TeamChallengeDetail>(`/api/team-challenges/${encodeURIComponent(id)}`),
  meta: () => get<{ reps: Array<{ id: string; name: string }>; products: Array<{ id: string; name: string }>; defaults: { milestones: TeamChallengeMilestone[]; scoring: TeamChallengeScoring } }>("/api/team-challenges/meta/reps"),
  create: (body: TeamChallengeInput) => post<{ id: string }>("/api/team-challenges", body),
  update: (id: string, body: TeamChallengeInput) => request<{ ok: true }>("PUT", `/api/team-challenges/${encodeURIComponent(id)}`, body),
  remove: (id: string) => request<{ ok: true }>("DELETE", `/api/team-challenges/${encodeURIComponent(id)}`),
  publish: (id: string) => post<{ ok: true }>(`/api/team-challenges/${encodeURIComponent(id)}/publish`, {}),
  setStatus: (id: string, status: "paused" | "active" | "closed", reason?: string) => post<{ ok: true }>(`/api/team-challenges/${encodeURIComponent(id)}/status`, { status, reason }),
  decide: (id: string, entryId: string, action: "verify" | "correction" | "exclude", note?: string) => post<{ ok: true }>(`/api/team-challenges/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/decision`, { action, note }),
  respond: (id: string, entryId: string, note: string, requestReview: boolean) => post<{ ok: true }>(`/api/team-challenges/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/respond`, { note, requestReview }),
  approvePayout: (id: string, teamId: string, milestoneKey: string) => post<{ ok: true }>(`/api/team-challenges/${encodeURIComponent(id)}/payouts`, { teamId, milestoneKey }),
  adjust: (id: string, entryId: string, amount: number, reason: string) => post<{ ok: true }>(`/api/team-challenges/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/adjust`, { amount, reason }),
  escalate: (id: string, entryId: string, note: string) => post<{ ok: true }>(`/api/team-challenges/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/escalate`, { note }),
  baseline: (id: string) => post<TeamChallengeBaseline>(`/api/team-challenges/${encodeURIComponent(id)}/baseline`, {}),
  markPaid: (id: string, payoutId: string, reference?: string) => post<{ ok: true }>(`/api/team-challenges/${encodeURIComponent(id)}/payouts/${encodeURIComponent(payoutId)}/paid`, { reference })
};
