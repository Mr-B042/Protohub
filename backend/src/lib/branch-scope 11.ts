import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<{ branchId: string }>();

export const runWithBranchScope = <T>(branchId: string, callback: () => T): T =>
  storage.run({ branchId }, callback);

// ⚠️ A TABLE ONLY BELONGS HERE ONCE IT HAS A branch_id ON EVERY ROW.
// Listing one before then hides its existing records instead of separating
// them: the filter becomes `branch_id = eq.X` against a column full of nulls
// and the table reads as empty. Every table below was backfilled from its
// parent in migration 258 and verified at 0 nulls before being added.
const BRANCH_TABLES = new Set([
  // The records a branch owns outright.
  "orders", "agents", "agent_stock", "stock_movements", "abandoned_carts",
  "agent_locations", "agent_location_stock", "delivered_stock_reconciliation_lines",

  // An order's own history. Without these, Accra opens a Nigerian order's
  // audit trail and call notes - the parent was separated, the story was not.
  "order_audit", "order_field_edits", "order_contact_attempts",
  "order_sales_expansion_attempts", "order_sales_expansion_offer_lines",
  "follow_up_tasks", "follow_up_misses", "recovery_order_claims",
  "delivery_distance_audits", "whatsapp_order_dispatches", "recovery_template_sends",

  // A cart's history, same reasoning.
  "cart_journey_events", "cart_contact_attempts", "cart_log_misses",

  // What an agent covers, holds and is measured on.
  "agent_coverage", "agent_stock_audit", "agent_stock_drift_baseline",
  "agent_balance_weekly_snapshots", "agent_balance_weekly_followups",
  "user_agent_assignments", "inventory_balance_baselines",

  // Stock and the paperwork that moves it. stock_movements was already
  // separated while waybills were not, so half of that pair was leaking.
  "waybill_records", "stock_count_sessions", "stock_count_entries",
  "inventory_valuation_snapshots", "inventory_valuation_snapshot_lines",
  "state_replenishment_notes",

  // Operational records with no parent to inherit from.
  "recovery_actions", "sales_call_reviews", "customer_flags"
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
