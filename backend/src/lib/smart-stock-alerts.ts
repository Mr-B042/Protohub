// Smart low-stock alerts at the agent-hub-state level.
//
// Instead of a fixed numeric threshold (which is wrong for both ends — too
// noisy for slow-moving SKUs, too quiet for hot states), this fires when:
//   - component demand in that state was meaningful last week (>= MIN_RECENT_UNITS)
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
import { orderInventoryLinesFromRow } from "./order-inventory.js";
import { sendPushToUsers } from "./push.js";
import { buildSmartStockAlertCandidates, type SmartStockCandidate } from "./smart-stock-candidates.js";
import { REPORT_ROW_CEILING } from "./query-limits.js";

const DAYS_OF_STOCK_THRESHOLD = 3;
const MIN_RECENT_UNITS = 3;
const RECENT_DAYS_WINDOW = 7;
const SURGE_DAYS_WINDOW = 3;
const DEDUPE_WINDOW_HOURS = 24;
const RECIPIENT_ROLES = ["Owner", "Admin", "Manager", "Inventory Manager", "Inventory Manager & Logistics Operations", "Call Rep"] as const;

type AgentRow = { id: string; org_id: string; name: string; primary_base_state: string | null; status: string | null };
type StockRow = { agent_id: string; product_id: string; quantity: number; defective: number; missing: number };
type LocationStockRow = { product_id: string; quantity: number; defective: number; missing: number };
type AgentLocationRow = {
  id: string;
  agent_id: string;
  name: string;
  state: string;
  active: boolean;
  is_primary: boolean;
  stock: LocationStockRow[] | null;
};
type ProductRow = { id: string; org_id: string; name: string };
type OrderRow = {
  id: string;
  product_id: string | null;
  product_name: string | null;
  quantity: number | null;
  state: string | null;
  status: string | null;
  created_at: string | null;
  agent_id: string | null;
  agent_location_id: string | null;
  package_components_snapshot?: unknown;
  cross_sell_lines?: unknown;
  additional_lines?: unknown;
  free_gift_lines?: unknown;
};

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

function dedupeLinkFor(candidate: Pick<SmartStockCandidate, "scope" | "productId" | "state" | "agentId" | "locationId">): string {
  const base = `/dashboard/admin/inventory/state-stock?product=${encodeURIComponent(candidate.productId)}&state=${encodeURIComponent(candidate.state)}`;
  if (candidate.scope !== "agent" || !candidate.agentId) return base;
  const agentLink = `${base}&agent=${encodeURIComponent(candidate.agentId)}`;
  return candidate.locationId ? `${agentLink}&location=${encodeURIComponent(candidate.locationId)}` : agentLink;
}

/**
 * For one organization: compute alerts and insert + push them.
 * Returns the number of alerts fired.
 */
async function scanOrgForSmartStockAlerts(orgId: string): Promise<number> {
  const since = new Date(Date.now() - RECENT_DAYS_WINDOW * 86_400_000);
  const sinceIso = since.toISOString();
  const surgeSinceMs = Date.now() - SURGE_DAYS_WINDOW * 86_400_000;

  // 1. Active agents in this org with a base state
  const { data: agentsRaw, error: agentsErr } = await supabase
    .from("agents")
    .select("id, org_id, name, primary_base_state, status")
    .eq("org_id", orgId)
    .eq("status", "Active");
  if (agentsErr) {
    logger.warn("smart-stock-alerts: agents fetch failed", { orgId, error: agentsErr.message });
    return 0;
  }
  const agents = (agentsRaw ?? []) as AgentRow[];
  const agentStateById = new Map<string, string>();
  const agentNameById = new Map<string, string>();
  for (const a of agents) {
    const state = titleCaseState(a.primary_base_state ?? "");
    if (state) agentStateById.set(a.id, state);
    agentNameById.set(a.id, a.name || "Delivery agent");
  }
  if (agents.length === 0) return 0;

  // 2. Stock for those agents
  const agentIds = agents.map((agent) => agent.id);
  const { data: stockRaw, error: stockErr } = await supabase
    .from("agent_stock")
    .select("agent_id, product_id, quantity, defective, missing")
    .in("agent_id", agentIds);
  if (stockErr) {
    logger.warn("smart-stock-alerts: agent_stock fetch failed", { orgId, error: stockErr.message });
    return 0;
  }
  const { data: locationsRaw, error: locationsErr } = await supabase
    .from("agent_locations")
    .select("id, agent_id, name, state, active, is_primary, stock:agent_location_stock(product_id, quantity, defective, missing)")
    .in("agent_id", agentIds)
    .eq("active", true);
  if (locationsErr) {
    logger.warn("smart-stock-alerts: agent location stock fetch failed; using aggregate fallback", {
      orgId,
      error: locationsErr.message
    });
  }

  // Keep both state totals and per-agent/hub usable stock. Location stock is
  // authoritative; old aggregate rows are used only when that product has no
  // location row yet. Defective and missing pieces cannot fulfill an order.
  const stockByProductState = new Map<string, number>();
  const agentSupply: Array<{
    agentId: string;
    agentName: string;
    locationId?: string;
    locationName?: string;
    productId: string;
    state: string;
    stock: number;
  }> = [];
  const locationProductKeys = new Set<string>();
  const addSupply = (row: {
    agentId: string;
    productId: string;
    state: string;
    quantity: number;
    defective: number;
    missing: number;
    locationId?: string;
    locationName?: string;
  }) => {
    if (!row.productId || !row.state) return;
    const usable = Math.max(0, row.quantity - row.defective - row.missing);
    const key = `${row.productId}::${row.state}`;
    stockByProductState.set(key, (stockByProductState.get(key) ?? 0) + usable);
    agentSupply.push({
      agentId: row.agentId,
      agentName: agentNameById.get(row.agentId) ?? "Delivery agent",
      productId: row.productId,
      state: row.state,
      stock: usable,
      ...(row.locationId ? { locationId: row.locationId } : {}),
      ...(row.locationName ? { locationName: row.locationName } : {})
    });
  };
  for (const location of (locationsRaw ?? []) as AgentLocationRow[]) {
    const state = titleCaseState(location.state);
    if (!state) continue;
    for (const row of location.stock ?? []) {
      locationProductKeys.add(`${location.agent_id}::${row.product_id}`);
      addSupply({
        agentId: location.agent_id,
        productId: row.product_id,
        state,
        quantity: Number(row.quantity ?? 0),
        defective: Number(row.defective ?? 0),
        missing: Number(row.missing ?? 0),
        locationId: location.id,
        locationName: location.name
      });
    }
  }
  for (const row of (stockRaw ?? []) as StockRow[]) {
    if (locationProductKeys.has(`${row.agent_id}::${row.product_id}`)) continue;
    const state = agentStateById.get(row.agent_id);
    if (!state || !row.product_id) continue;
    addSupply({
      agentId: row.agent_id,
      productId: row.product_id,
      state,
      quantity: Number(row.quantity ?? 0),
      defective: Number(row.defective ?? 0),
      missing: Number(row.missing ?? 0),
      locationName: "Primary hub (legacy stock)"
    });
  }

  // 3. Non-cancelled placed demand in the last window. Waiting for delivery
  // makes replenishment alerts arrive after the stock has already left. A
  // 10-piece package is ten units, and every combo/add-on/gift component counts
  // against its real SKU. The stronger of the 7-day baseline and 3-day surge
  // becomes the forecast so a run of larger packages is visible immediately.
  const { data: ordersRaw, error: ordersErr } = await supabase
    .from("orders")
    .select("id, product_id, product_name, quantity, state, status, created_at, agent_id, agent_location_id, package_components_snapshot, cross_sell_lines, additional_lines, free_gift_lines")
    .limit(REPORT_ROW_CEILING)
    .eq("org_id", orgId)
    .gte("created_at", sinceIso);
  if (ordersErr) {
    logger.warn("smart-stock-alerts: orders fetch failed", { orgId, error: ordersErr.message });
    return 0;
  }
  const recentByProductState = new Map<string, {
    productId: string;
    state: string;
    recentUnits: number;
    surgeUnits: number;
    orderIds: Set<string>;
  }>();
  const committedStatuses = new Set(["Confirmed", "In Process", "Dispatched"]);
  const committedByProductState = new Map<string, number>();
  const committedByAgentLocationProduct = new Map<string, number>();
  const primaryLocationByAgent = new Map<string, string>();
  for (const location of (locationsRaw ?? []) as AgentLocationRow[]) {
    if (location.is_primary && location.active) primaryLocationByAgent.set(location.agent_id, location.id);
  }
  for (const row of (ordersRaw ?? []) as OrderRow[]) {
    if (["Cancelled", "Failed"].includes(row.status ?? "")) continue;
    const state = titleCaseState(row.state ?? "");
    if (!state || !row.product_id) continue;
    const createdMs = row.created_at ? new Date(row.created_at).getTime() : 0;
    const isSurge = Number.isFinite(createdMs) && createdMs >= surgeSinceMs;
    for (const line of orderInventoryLinesFromRow(row)) {
      const key = `${line.productId}::${state}`;
      const bucket = recentByProductState.get(key) ?? {
        productId: line.productId,
        state,
        recentUnits: 0,
        surgeUnits: 0,
        orderIds: new Set<string>()
      };
      const quantity = Math.max(0, Number(line.quantity ?? 0));
      bucket.recentUnits += quantity;
      if (isSurge) bucket.surgeUnits += quantity;
      bucket.orderIds.add(row.id);
      recentByProductState.set(key, bucket);
      if (committedStatuses.has(row.status ?? "")) {
        committedByProductState.set(key, (committedByProductState.get(key) ?? 0) + quantity);
        if (row.agent_id) {
          const locationId = row.agent_location_id || primaryLocationByAgent.get(row.agent_id) || "";
          const agentKey = `${row.agent_id}::${locationId}::${line.productId}`;
          committedByAgentLocationProduct.set(
            agentKey,
            (committedByAgentLocationProduct.get(agentKey) ?? 0) + quantity
          );
        }
      }
    }
  }

  // 4. Find state-wide risks, then agent-specific risks that the pooled state
  // total would otherwise hide.
  const candidates = buildSmartStockAlertCandidates({
    stateSupply: Array.from(stockByProductState, ([key, stock]) => {
      const [productId, state] = key.split("::");
      return { productId, state, stock: Math.max(0, stock - (committedByProductState.get(key) ?? 0)) };
    }),
    agentSupply: agentSupply.map((row) => {
      const locationId = row.locationId || primaryLocationByAgent.get(row.agentId) || "";
      const committed = committedByAgentLocationProduct.get(`${row.agentId}::${locationId}::${row.productId}`) ?? 0;
      return { ...row, stock: Math.max(0, row.stock - committed) };
    }),
    demand: Array.from(recentByProductState.values()).map((row) => ({
      productId: row.productId,
      state: row.state,
      recentOrders: row.orderIds.size,
      recentUnits: row.recentUnits,
      forecastUnitsPerDay: Math.max(
        row.recentUnits / RECENT_DAYS_WINDOW,
        row.surgeUnits / SURGE_DAYS_WINDOW
      )
    })),
    minimumRecentUnits: MIN_RECENT_UNITS,
    daysThreshold: DAYS_OF_STOCK_THRESHOLD,
    recentDaysWindow: RECENT_DAYS_WINDOW
  });
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
  const dedupeLinks = candidates.map((c) => dedupeLinkFor(c));
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
    (c) => !recentLinks.has(dedupeLinkFor(c))
  );
  if (freshCandidates.length === 0) return 0;

  // 7. Resolve recipients for this org
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
    tag: string;
  }> = [];
  for (const c of freshCandidates) {
    const productName = productById.get(c.productId)?.name ?? "Product";
    const daysLabel = c.daysOfStock <= 0
      ? "out"
      : c.daysOfStock < 1
        ? "<1 day"
        : `~${Math.max(1, Math.floor(c.daysOfStock))} days`;
    const agentLabel = c.locationName ? `${c.agentName} (${c.locationName})` : c.agentName;
    const title = c.scope === "agent"
      ? `${productName} low at ${agentLabel}`
      : `${productName} low in ${c.state}`;
    const subject = c.scope === "agent" ? `${agentLabel} has` : "State hubs have";
    const averageUnits = c.recentOrders > 0 ? c.recentUnits / c.recentOrders : 0;
    const message = `${subject} ${c.stock} usable unit${c.stock === 1 ? "" : "s"} after commitments, ${daysLabel} at ${c.forecastUnitsPerDay.toFixed(1)} forecast units/day. ${c.recentUnits} unit${c.recentUnits === 1 ? "" : "s"} across ${c.recentOrders} placed order${c.recentOrders === 1 ? "" : "s"} in ${c.state} this week (${averageUnits.toFixed(1)} units/order).`;
    const link = dedupeLinkFor(c);
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
    pushPayloads.push({
      productId: c.productId,
      state: c.state,
      title,
      body: message,
      link,
      tag: `smart-stock-${c.scope}-${c.productId}-${c.locationId ?? c.agentId ?? c.state}`
    });
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
      tag: payload.tag,
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
