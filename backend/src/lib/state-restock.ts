// Loads stock left per agent hub (and pieces on the way to it) for one branch.
// Used by Pieces Sold ("X left" in the State / Agent rankings) and by the
// busy-state restock alert. Rules: state-restock-model.ts.

import { supabase } from "./supabase.js";
import { REPORT_ROW_CEILING } from "./query-limits.js";
import { tidyState, waybillItems } from "./stock-intel-data.js";
import type { HubStockRow } from "./state-restock-model.js";

const num = (value: unknown) => Math.max(0, Number(value ?? 0) || 0);

export async function loadHubStock(orgId: string, branchId: string): Promise<HubStockRow[]> {
  const agentsRes = await supabase.from("agents").select("id, status").eq("org_id", orgId).eq("branch_id", branchId).limit(REPORT_ROW_CEILING);
  if (agentsRes.error) throw new Error(`Could not load agents: ${agentsRes.error.message}`);
  const agentIds = (agentsRes.data ?? []).filter((a: any) => String(a.status ?? "Active") === "Active").map((a: any) => String(a.id));
  if (agentIds.length === 0) return [];
  const [locationsRes, waybillRes] = await Promise.all([
    supabase.from("agent_locations")
      .select("id, agent_id, state, active, stock:agent_location_stock(product_id, quantity, defective, missing)")
      .eq("branch_id", branchId).in("agent_id", agentIds).eq("active", true).limit(REPORT_ROW_CEILING),
    supabase.from("waybill_records").select("status, items, product_id, product_name, quantity, to_agent_location_id")
      .eq("org_id", orgId).eq("branch_id", branchId).eq("status", "In Transit").limit(REPORT_ROW_CEILING)
  ]);
  if (locationsRes.error) throw new Error(`Could not load agent hubs: ${locationsRes.error.message}`);
  if (waybillRes.error) throw new Error(`Could not load waybills: ${waybillRes.error.message}`);

  const rows = new Map<string, HubStockRow>();
  const hubs = new Map<string, { agentId: string; state: string }>();
  for (const loc of locationsRes.data ?? []) {
    const state = tidyState((loc as any).state);
    if (!state) continue;
    const locationId = String((loc as any).id), agentId = String((loc as any).agent_id);
    hubs.set(locationId, { agentId, state });
    for (const s of (loc as any).stock ?? []) {
      const productId = String(s.product_id);
      rows.set(`${locationId}::${productId}`, { locationId, agentId, state, productId, left: Math.max(0, num(s.quantity) - num(s.defective) - num(s.missing)), onTheWay: 0 });
    }
  }
  for (const waybill of waybillRes.data ?? []) {
    const locationId = (waybill as any).to_agent_location_id ? String((waybill as any).to_agent_location_id) : "";
    const hub = hubs.get(locationId);
    if (!hub) continue;
    for (const item of waybillItems(waybill)) {
      const key = `${locationId}::${item.productId}`;
      const row = rows.get(key) ?? { locationId, agentId: hub.agentId, state: hub.state, productId: item.productId, left: 0, onTheWay: 0 };
      row.onTheWay += item.quantity;
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}
