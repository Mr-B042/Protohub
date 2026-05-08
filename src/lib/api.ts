// ProtoHub API client
// All requests go through `request()` which attaches the Bearer token
// and auto-refreshes if the token has expired (401).

import { auth } from "./auth";
import { snakeToCamel } from "./normalize";

const BASE = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:4000";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ── Core request helper ────────────────────────────────────
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false
): Promise<T> {
  const token = auth.getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  // Auto-refresh on 401 (token expired)
  if (res.status === 401 && !retried) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(method, path, body, true);
    auth.clear();
    window.location.reload();
    throw new ApiError(401, "Session expired.");
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, payload?.error ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  const json = await res.json();
  return snakeToCamel<T>(json);
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = auth.getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
    if (!res.ok) return false;
    const data = await res.json();
    // Fetch fresh profile so role/name stay in sync
    let user = auth.getUser();
    try {
      const meRes = await fetch(`${BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${data.accessToken}` }
      });
      if (meRes.ok) {
        const me = await meRes.json();
        if (me.user) user = snakeToCamel(me.user);
      }
    } catch { /* keep existing user if /me fails */ }
    if (user) auth.save(data.accessToken, data.refreshToken, user);
    return true;
  } catch { return false; }
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
  }>("/api/auth/me"),
  bumpCacheVersion: () => post<{ cacheVersion: number }>("/api/auth/bump-cache-version", {}),
  updateBranding: (body: { name?: string; logoUrl?: string; topPerformerBonusEnabled?: boolean; topPerformerBonusAmount?: number; timezone?: string }) =>
    patch<{ name: string; logoUrl: string; topPerformerBonusEnabled: boolean; topPerformerBonusAmount: number; timezone: string }>("/api/auth/org-branding", body),

  invite: (body: { name: string; email: string; password: string; role: string }) =>
    post<{ message: string }>("/api/auth/invite", body),

  resetPassword: (email: string) =>
    post<{ message: string }>("/api/auth/reset-password", { email }),

  // userId is optional — when omitted, the backend resolves the target from
  // the Bearer token (used by the recovery flow, where we have no profile yet).
  setPassword: (passwordOrUserId: string, password?: string) =>
    post<{ message: string }>(
      "/api/auth/set-password",
      password === undefined ? { password: passwordOrUserId } : { userId: passwordOrUserId, password }
    )
};

// ── Users ────────────────────────────────────────────────
export const usersApi = {
  list: () => get<any[]>("/api/users"),
  update: (id: string, body: { name?: string; email?: string; active?: boolean }) =>
    patch<any>(`/api/users/${id}`, body)
};

// ── Products ──────────────────────────────────────────────
export const productsApi = {
  list: () => get<any[]>("/api/products"),
  // Public storefront view of one product, with cross-sells + free-gifts inlined.
  // No auth required; safe to call from unauthenticated iframes.
  public: (id: string) => get<{ product: any; related: any[] }>(`/api/public/products/${encodeURIComponent(id)}`),
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
  update: (id: string, body: unknown) => patch<any>(`/api/orders/${id}`, body),
  delete: (id: string) => del<void>(`/api/orders/${id}`),
  audit: (id: string) => get<any[]>(`/api/orders/${id}/audit`)
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
  delete: (id: string) => del<void>(`/api/expenses/${id}`)
};

// ── Payroll ───────────────────────────────────────────────
export const payrollApi = {
  list: () => get<any[]>("/api/payroll"),
  generate: (body: { period: string }) => post<any>("/api/payroll/generate", body),
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
  delete: (id: string) => del<void>(`/api/auth/team/${id}`),
  updateRoundRobin: (order: string[]) => request<{ ok: boolean }>("PUT", "/api/auth/team/round-robin", { order })
};

// ── Email Settings ────────────────────────────────────────
export const embedSettingsApi = {
  get:    ()                  => get<any>("/api/embed-settings"),
  patch:  (body: unknown)     => patch<any>("/api/embed-settings", body),
  // Public: read settings unauthenticated (used by the customer-facing embed form)
  public: async (orgId: string) => {
    const res = await fetch(`${BASE}/api/public/embed-settings/${orgId}`);
    if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
    return snakeToCamel<any>(await res.json());
  }
};

export const emailSettingsApi = {
  get:  ()            => get<any>("/api/email-settings"),
  save: (body: unknown) => request<any>("PUT", "/api/email-settings", body),
  test: (to: string)  => post<{ message: string }>("/api/email-settings/test", { to })
};

// ── Abandoned Carts ──────────────────────────────────────
export const cartsApi = {
  list: () => get<any[]>("/api/carts"),
  create: (body: unknown) => post<any>("/api/carts", body),
  // Public capture endpoint — no auth required, derives org from product_id.
  // Use this from the embed form so it works inside customer-facing iframes.
  capture: (body: unknown) => post<any>("/api/public/carts", body),
  update: (id: string, body: unknown) => patch<any>(`/api/carts/${id}`, body)
};

// ── Pay Structures ───────────────────────────────────────
export const payStructuresApi = {
  list: () => get<any[]>("/api/pay-structures"),
  save: (body: unknown) => post<any>("/api/pay-structures", body)
};

// ── Sales Teams ──────────────────────────────────────────
export const salesTeamsApi = {
  list: () => get<any[]>("/api/sales-teams"),
  create: (body: unknown) => post<any>("/api/sales-teams", body),
  update: (id: string, body: unknown) => patch<any>(`/api/sales-teams/${id}`, body),
  delete: (id: string) => del<void>(`/api/sales-teams/${id}`)
};

// ── Penalties ────────────────────────────────────────────
export const penaltiesApi = {
  list: () => get<any[]>("/api/penalties"),
  create: (body: unknown) => post<any>("/api/penalties", body),
  delete: (id: string) => del<void>(`/api/penalties/${id}`)
};

export { ApiError };
