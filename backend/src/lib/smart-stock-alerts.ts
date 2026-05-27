// Smart low-stock alerts at the agent-hub-state level.
//
// Instead of a fixed numeric threshold (which is wrong for both ends — too
// noisy for slow-moving SKUs, too quiet for hot states), this fires when:
//   - sell rate in that state was meaningful last week (>= MIN_RECENT_ORDERS)
//   - and current state stock would run out in < DAYS_OF_STOCK_THRESHOLD days
//     at that sell rate.
//
// Dedupes by writing dedupe keys into the `link` field on system_notifications
// and skipping any (org, link) that already fired within DEDUPE_WINDOW_HOURS.
//
// Runs from cron in src/index.ts under the ENABLE_BACKGROUND_JOBS flag.

import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUsers } from "./push.js";

const DAYS_OF_STOCK_THRESHOLD = 3;
const MIN_RECENT_ORDERS = 3;
const RECENT_DAYS_WINDOW = 7;
const DEDUPE_WINDOW_HOURS = 24;
const RECIPIENT_ROLES = ["Owner", "Admin", "Call Rep"] as const;

type AgentRow = { id: string; org_id: string; primary_base_state: string | null; status: string | null };
type StockRow = { agent_id: string; product_id: string; quantity: number };
type ProductRow = { id: string; org_id: string; name: string };
type OrderRow = { product_id: string | null; state: string | null };

function normalizeState(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function titleCaseState(value: string): string {
  const normalized = normalizeState(value);
  if (!normalized) return "";
  return normalized
    .toLowerCase()
    .split(" ")
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

function dedupeLinkFor(productId: string, state: string): string {
  return `/dashboard/admin/inventory/state-stock?product=${encodeURIComponent(productId)}&state=${encodeURIComponent(state)}`;
}

/**
 * For one organization: compute alerts and insert + push them.
 * Returns the number of alerts fired.
 */
async function scanOrgForSmartStockAlerts(orgId: string): Promise<number> {
  const since = new Date(Date.now() - RECENT_DAYS_WINDOW * 86_400_000);
  const sinceDate = since.toISOString().slice(0, 10); // YYYY-MM-DD for delivered_date

  // 1. Active agents in this org with a base state
  const { data: agentsRaw, error: agentsErr } = await supabase
    .from("agents")
    .select("id, org_id, primary_base_state, status")
    .eq("org_id", orgId)
    .eq("status", "Active");
  if (agentsErr) {
    logger.warn("smart-stock-alerts: agents fetch failed", { orgId, error: agentsErr.message });
    return 0;
  }
  const agents = (agentsRaw ?? []) as AgentRow[];
  const agentStateById = new Map<string, string>();
  for (const a of agents) {
    const state = titleCaseState(a.primary_base_state ?? "");
    if (state) agentStateById.set(a.id, state);
  }
  if (agentStateById.size === 0) return 0;

  // 2. Stock for those agents
  const agentIds = Array.from(agentStateById.keys());
  const { data: stockRaw, error: stockErr } = await supabase
    .from("agent_stock")
    .select("agent_id, product_id, quantity")
    .in("agent_id", agentIds);
  if (stockErr) {
    logger.warn("smart-stock-alerts: agent_stock fetch failed", { orgId, error: stockErr.message });
    return 0;
  }
  // (productId, state) -> total stock
  const stockByProductState = new Map<string, number>();
  for (const row of (stockRaw ?? []) as StockRow[]) {
    const state = agentStateById.get(row.agent_id);
    if (!state || !row.product_id) continue;
    const key = `${row.product_id}::${state}`;
    stockByProductState.set(key, (stockByProductState.get(key) ?? 0) + Math.max(0, Number(row.quantity ?? 0)));
  }
  if (stockByProductState.size === 0) return 0;

  // 3. Delivered orders in the last RECENT_DAYS_WINDOW days, grouped (productId, state)
  const { data: ordersRaw, error: ordersErr } = await supabase
    .from("orders")
    .select("product_id, state")
    .eq("org_id", orgId)
    .eq("status", "Delivered")
    .gte("delivered_date", sinceDate);
  if (ordersErr) {
    logger.warn("smart-stock-alerts: orders fetch failed", { orgId, error: ordersErr.message });
    return 0;
  }
  const recentByProductState = new Map<string, number>();
  for (const row of (ordersRaw ?? []) as OrderRow[]) {
    const state = titleCaseState(row.state ?? "");
    if (!state || !row.product_id) continue;
    const key = `${row.product_id}::${state}`;
    recentByProductState.set(key, (recentByProductState.get(key) ?? 0) + 1);
  }

  // 4. Find candidates worth alerting
  type Candidate = {
    productId: string;
    state: string;
    stock: number;
    recentOrders: number;
    daysOfStock: number;
  };
  const candidates: Candidate[] = [];
  for (const [key, stock] of stockByProductState.entries()) {
    const recentOrders = recentByProductState.get(key) ?? 0;
    if (recentOrders < MIN_RECENT_ORDERS) continue;
    const daily = recentOrders / RECENT_DAYS_WINDOW;
    if (daily <= 0) continue;
    const daysOfStock = stock / daily;
    if (daysOfStock >= DAYS_OF_STOCK_THRESHOLD) continue;
    const [productId, state] = key.split("::");
    candidates.push({ productId, state, stock, recentOrders, daysOfStock });
  }
  // Also: states with ZERO stock but recent sales — definitely worth alerting.
  for (const [key, recent] of recentByProductState.entries()) {
    if (recent < MIN_RECENT_ORDERS) continue;
    if (stockByProductState.has(key)) continue; // already covered above
    const [productId, state] = key.split("::");
    candidates.push({ productId, state, stock: 0, recentOrders: recent, daysOfStock: 0 });
  }
  if (candidates.length === 0) return 0;

  // 5. Resolve product names
  const productIds = Array.from(new Set(candidates.map((c) => c.productId)));
  const { data: productsRaw } = await supabase
    .from("products")
    .select("id, org_id, name")
    .in("id", productIds)
    .eq("org_id", orgId);
  const productById = new Map<string, ProductRow>(
    ((productsRaw ?? []) as ProductRow[]).map((p) => [p.id, p])
  );

  // 6. Dedupe: drop candidates already alerted in the dedupe window
  const dedupeLinks = candidates.map((c) => dedupeLinkFor(c.productId, c.state));
  const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 3_600_000).toISOString();
  const { data: existingRaw } = await supabase
    .from("system_notifications")
    .select("link")
    .eq("org_id", orgId)
    .eq("type", "low_stock")
    .in("link", dedupeLinks)
    .gte("created_at", dedupeSince);
  const recentLinks = new Set(((existingRaw ?? []) as { link: string | null }[]).map((r) => r.link ?? ""));
  const freshCandidates = candidates.filter(
    (c) => !recentLinks.has(dedupeLinkFor(c.productId, c.state))
  );
  if (freshCandidates.length === 0) return 0;

  // 7. Resolve recipients (Owners, Admins, Call Reps) for this org
  const { data: recipientsRaw } = await supabase
    .from("users")
    .select("id")
    .eq("org_id", orgId)
    .eq("active", true)
    .in("role", RECIPIENT_ROLES as unknown as string[]);
  const recipientIds = Array.from(new Set(((recipientsRaw ?? []) as { id: string }[]).map((r) => r.id)));
  if (recipientIds.length === 0) return 0;

  // 8. Build + insert notification rows
  const branding = await getOrgPushBranding(orgId).catch(() => ({ brandName: "Protohub", brandLogo: undefined }));
  const rows: Array<{
    org_id: string;
    recipient_id: string;
    type: "low_stock";
    title: string;
    message: string;
    link: string;
    product_id: string;
    read: boolean;
  }> = [];
  const pushPayloads: Array<{
    productId: string;
    state: string;
    title: string;
    body: string;
    link: string;
  }> = [];
  for (const c of freshCandidates) {
    const productName = productById.get(c.productId)?.name ?? "Product";
    const daysLabel = c.daysOfStock <= 0
      ? "out"
      : c.daysOfStock < 1
        ? "<1 day"
        : `~${Math.max(1, Math.floor(c.daysOfStock))} days`;
    const title = `${productName} low in ${c.state}`;
    const message = `${c.stock} left at hub, ${daysLabel} of stock at current sell rate. ${c.recentOrders} delivered in ${c.state} this week.`;
    const link = dedupeLinkFor(c.productId, c.state);
    for (const recipientId of recipientIds) {
      rows.push({
        org_id: orgId,
        recipient_id: recipientId,
        type: "low_stock",
        title,
        message,
        link,
        product_id: c.productId,
        read: false
      });
    }
    pushPayloads.push({ productId: c.productId, state: c.state, title, body: message, link });
  }

  if (rows.length === 0) return 0;
  const { error: insertErr } = await supabase.from("system_notifications").insert(rows);
  if (insertErr) {
    logger.error("smart-stock-alerts: insert failed", { orgId, error: insertErr.message });
    return 0;
  }

  // 9. Background push (fire and forget)
  for (const payload of pushPayloads) {
    sendPushToUsers(orgId, recipientIds, {
      title: payload.title,
      body: payload.body,
      kind: "low_stock",
      url: payload.link,
      tag: `smart-stock-${payload.productId}-${payload.state}`,
      brandName: branding.brandName,
      brandLogo: branding.brandLogo
    }).catch((err) => logger.warn("smart-stock-alerts: push failed", { error: err?.message ?? String(err) }));
  }

  logger.info("smart-stock-alerts: fired", {
    orgId,
    fired: freshCandidates.length,
    recipients: recipientIds.length
  });
  return freshCandidates.length;
}

export async function runSmartStockAlerts(): Promise<{ scannedOrgs: number; firedAlerts: number }> {
  const { data: orgsRaw, error } = await supabase
    .from("organizations")
    .select("id");
  if (error) {
    logger.error("smart-stock-alerts: orgs fetch failed", { error: error.message });
    return { scannedOrgs: 0, firedAlerts: 0 };
  }
  let firedAlerts = 0;
  for (const org of (orgsRaw ?? []) as { id: string }[]) {
    try {
      firedAlerts += await scanOrgForSmartStockAlerts(org.id);
    } catch (err: any) {
      logger.warn("smart-stock-alerts: org scan crashed", { orgId: org.id, error: err?.message ?? String(err) });
    }
  }
  return { scannedOrgs: (orgsRaw ?? []).length, firedAlerts };
}
