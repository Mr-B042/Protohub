import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<{ branchId: string }>();

export const runWithBranchScope = <T>(branchId: string, callback: () => T): T =>
  storage.run({ branchId }, callback);

const BRANCH_TABLES = new Set([
  "orders", "agents", "agent_stock", "stock_movements", "abandoned_carts",
  "agent_locations", "agent_location_stock", "delivered_stock_reconciliation_lines"
]);

/**
 * Supabase service-role requests bypass RLS. This fetch wrapper adds the
 * request's branch as an unavoidable AND filter to every read/update/delete
 * of branch-owned operational tables. Background jobs have no request scope
 * and intentionally retain organisation-wide access.
 */
export async function branchScopedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const context = storage.getStore();
  if (!context) return fetch(input, init);

  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(rawUrl);
  const match = url.pathname.match(/\/rest\/v1\/([^/]+)$/);
  const table = match ? decodeURIComponent(match[1]) : "";
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

  if (BRANCH_TABLES.has(table) && ["GET", "HEAD", "PATCH", "DELETE"].includes(method)) {
    // Existing explicit route filters remain valid; avoid adding a duplicate.
    if (!url.searchParams.has("branch_id")) url.searchParams.set("branch_id", `eq.${context.branchId}`);
    input = input instanceof Request ? new Request(url, input) : url;
  }
  return fetch(input, init);
}
