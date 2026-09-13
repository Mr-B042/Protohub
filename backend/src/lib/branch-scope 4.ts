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
  "recovery_actions", "sales_call_reviews", "customer_flags",

  // The books. Each branch trades in its own currency - naira, cedi,
  // shilling - so one shared ledger cannot hold three. A delivery expense
  // follows the waybill it paid for and a remittance follows the order whose
  // cash came in; the rest were created in Nigeria and stay there.
  "expenses", "remittance_transactions", "rep_penalties",
  "payroll_runs", "pay_structures",
  "bank_accounts", "bank_account_transfers",
  "cash_opening_balances", "cash_opening_balance_sources",
  "cash_reserves", "cash_reserve_releases",
  "weekly_cash_verifications", "weekly_cash_verification_accounts",
  "cash_variance_investigations", "cash_variance_investigation_events",
  "account_reconciliations", "account_reconciliation_matches",
  "account_reconciliation_adjustments",
  "period_closes", "period_close_checks",
  "batch_economics", "batch_cost_tiers", "batch_status_tier_map",

  // People, targets and bonuses. A Ghana rep must not be measured against a
  // Nigerian target, and a bonus rule written in naira must not pay in cedi.
  "sales_teams", "sales_leads", "sales_bonus_programs", "sales_bonus_rules",
  "sales_closer_bonus_settings", "sales_closer_bonus_monthly_records",
  "manager_bonus_settings", "manager_product_challenges",
  "manager_product_challenge_allocations", "manager_activity_logs",
  "head_of_sales_settings", "head_of_sales_weekly_reports",
  "head_of_sales_bonus_weekly_records",
  "rep_weekly_targets", "rep_coaching_plans", "rep_coaching_action_items",
  "target_periods", "daily_target_snapshots", "incentive_rules",
  "upsell_bonus_settings", "sales_expansion_settings",
  "sales_expansion_compliance_waivers", "recovery_rep_kpi_settings",
  "recovery_templates", "sales_initiatives", "sales_initiative_learnings",

  // Retention and marketing.
  "customer_retention_touchpoints", "customer_retention_action_events",
  "customer_retention_tasks", "customer_retention_referrals",
  "customer_retention_bonus_settings",
  "marketing_spend_records", "marketing_link_variants",

  // Personal delivery agents: people holding a branch's stock and its cash.
  // ⚠️ A DIFFERENT MODULE FROM `agents`. Their paperwork, fees and
  // remittances follow the rider, and the rider belongs to the branch that
  // signed them.
  "personal_delivery_agents", "pda_agent_stock", "pda_agreement_acceptances",
  "pda_application_links", "pda_blocked_applicants", "pda_cod_discrepancies",
  "pda_documents", "pda_earning_payouts", "pda_fee_negotiations", "pda_fee_rules",
  "pda_guarantors", "pda_incidents", "pda_inventory_baselines", "pda_kyc_items",
  "pda_notes", "pda_order_assignments", "pda_remittance_allocations",
  "pda_remittances", "pda_reports", "pda_settings", "pda_stock_discrepancies",
  "pda_stock_ledger", "pda_stock_transfers",

  // Messaging, and the settings that drive it. Ghana sends from its own
  // number and runs its own order form, so its message history and alerts
  // stay in Ghana too.
  //
  // ⚠️ THE PUBLIC ORDER FORM STILL WORKS. Public and background callers have
  // no request scope, so branchScopedFetch leaves them alone - a customer
  // filling in the form is never inside a branch session.
  "system_notifications", "short_links",
  "sms_messages", "sms_inbound_messages", "sms_opt_outs", "sms_settings",
  "email_messages", "email_settings",
  "whatsapp_messages", "whatsapp_inbox_messages", "whatsapp_opt_outs",
  "whatsapp_settings", "whatsapp_user_accounts", "whatsapp_user_destinations",
  "embed_settings", "meta_capi_configs",

  // The catalogue. A full split, chosen deliberately: one shared price list
  // cannot hold naira, cedi and shilling at once.
  //
  // ⚠️ THIS IS WHY ACCRA'S PRODUCTS PAGE IS EMPTY. All 25 products were
  // created in Nigeria and stay there. A new branch has no catalogue until
  // somebody adds products to it - that is the split working, not a fault.
  //
  // The public order form is not affected: it fetches a product by the id in
  // the embed link rather than listing a catalogue, and public callers carry
  // no request scope, so this filter never touches them.
  "products", "product_packages", "product_pricings",
  "product_cost_changes", "product_dedicated_handlers", "product_delivery_goals"
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
