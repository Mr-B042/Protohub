// ProtoHub API client
// All requests go through `request()` which attaches the Bearer token
// and auto-refreshes if the token has expired (401).

import { auth } from "./auth";
import { fetchWithApiFailover } from "./backend-origin";
import { snakeToCamel } from "./normalize";
let refreshInFlight: Promise<boolean> | null = null;
const TRANSIENT_RETRYABLE_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_GET_RETRY_LIMIT = 2;

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

// ── Core request helper ────────────────────────────────────
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
  transientAttempt = 0
): Promise<T> {
  const token = auth.getAccessToken();
  let res: Response;
  try {
    res = await fetchWithApiFailover(path, {
      method,
      cache: "no-store", // never read from or write to HTTP cache
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
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
  if (res.status === 401 && !retried) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(method, path, body, true, transientAttempt);
    auth.clear();
    window.location.reload();
    throw new ApiError(401, "Session expired.");
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, extractErrorMessage(payload, res.statusText || "Request failed."));
  }

  if (res.status === 204) return undefined as T;
  const json = await res.json();
  return snakeToCamel<T>(json);
}

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = auth.getRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await fetchWithApiFailover("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
      });
      if (!res.ok) return false;
      const data = await res.json();
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
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
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
    }>("/api/auth/org-branding", body),

  invite: (body: { name: string; email: string; phone?: string; password: string; role: string }) =>
    post<{ message: string }>("/api/auth/invite", body),

  resetPassword: (email: string) =>
    post<{ message: string }>("/api/auth/reset-password", { email }),

  // userId is optional — when omitted, the backend resolves the target from
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
  create: (body: unknown) => post<any>("/api/products", body),
  update: (id: string, body: unknown) => patch<any>(`/api/products/${id}`, body),
  delete: (id: string) => del<void>(`/api/products/${id}`),
  createPricing: (productId: string, body: unknown) => post<any>(`/api/products/${productId}/pricings`, body),
  createPackage: (productId: string, body: unknown) => post<any>(`/api/products/${productId}/packages`, body),
  updatePackage: (productId: string, pkgId: string, body: unknown) => patch<any>(`/api/products/${productId}/packages/${pkgId}`, body),
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
  delete: (id: string) => del<void>(`/api/orders/${id}`),
  audit: (id: string) => get<any[]>(`/api/orders/${id}/audit`),
  followUpTasks: (id: string) => get<any[]>(`/api/orders/${id}/follow-up-tasks`),
  contactAttempts: (id: string) => get<any[]>(`/api/orders/${id}/contact-attempts`),
  logContactAttempt: (id: string, body: unknown) => post<any>(`/api/orders/${id}/contact-attempts`, body)
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
  closeSession: (sessionId: string) => patch<any>(`/api/stock/count-sessions/${sessionId}/close`, {})
};

// ── Expenses ──────────────────────────────────────────────
export const expensesApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<any[]>(`/api/expenses${qs}`);
  },
  create: (body: unknown) => post<any>("/api/expenses", body),
  saveAdSpendBatch: (body: {
    weekStart: string;
    weekEnd: string;
    scopeProductIds: string[];
    entries: Array<{
      id: string;
      date: string;
      productId: string;
      description?: string;
      amount: number;
      currency: "NGN" | "USD" | "GBP";
    }>;
  }) => post<{ savedCount: number; totalAmount: number; rows: any[] }>("/api/expenses/batch-ad-spend", body),
  delete: (id: string) => del<void>(`/api/expenses/${id}`)
};

// ── Payroll ───────────────────────────────────────────────
export const payrollApi = {
  list: () => get<any[]>("/api/payroll"),
  preview: (body: { period: string }) => post<any>("/api/payroll/preview", body),
  generate: (body: { period: string; label?: string; notes?: string }) => post<any>("/api/payroll/generate", body),
  approve: (id: string) => patch<any>(`/api/payroll/${id}/approve`, {}),
  markPaid: (id: string) => patch<any>(`/api/payroll/${id}/mark-paid`, {})
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
  create: (body: { type: string; message: string; productId?: string }) => post<any>("/api/notifications", body),
  markAllRead: () => patch<{ message: string }>("/api/notifications/read-all", {}),
  markRead: (id: string) => patch<any>(`/api/notifications/${id}/read`, {}),
  deleteRead: () => del<void>("/api/notifications/read")
};

// ── Waybills ──────────────────────────────────────────────
export const waybillsApi = {
  list: () => get<any[]>("/api/waybills"),
  create: (body: unknown) => post<any>("/api/waybills", body),
  update: (id: string, body: unknown) => patch<any>(`/api/waybills/${id}`, body),
  updateStatus: (id: string, body: unknown) => patch<any>(`/api/waybills/${id}/status`, body)
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

export const emailReportsApi = {
  sendWeeklyReport: () => post<{ message: string }>("/api/email/weekly-report", {})
};

// ── Abandoned Carts ──────────────────────────────────────
export const cartsApi = {
  list: () => get<any[]>("/api/carts"),
  create: (body: unknown) => post<any>("/api/carts", body),
  // Public capture endpoint — no auth required, derives org from product_id.
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
  changeDate: (id: string, body: { createdAt: string; reason: string }) => patch<any>(`/api/carts/${id}/date`, body),
  update: (id: string, body: unknown) => patch<any>(`/api/carts/${id}`, body),
  delete: (id: string) => del<void>(`/api/carts/${id}`)
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
  save: (body: unknown) => post<any>("/api/pay-structures", body)
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
