// Stock Intelligence alerts (Bright's brief §9, 23 Nov 2026). Two kinds the
// older low-stock alert (smart-stock-alerts.ts, per agent hub) does not cover:
//
//   stock_hub_risk         a hub that restocks other states (Abuja for the
//                          north) cannot cover its own week AND what the
//                          agents it supplies need.
//   stock_transfer_chance  an agent is short and a fallback hub (Ogun for
//                          Ibadan) can spare stock without becoming short.
//
//   stock_state_restock    a busy state (sold 12+ of a product in 7 days)
//                          has less than a week left (Bright, 26 Nov 2026:
//                          "Lagos, Abuja, Rivers, Ogun, Owerri ... send
//                          notifications for restock to logistics, manager
//                          and owner"). Rule: state-restock-model.ts.
//
// Same figures as the tab (loadStockIntel / loadStockSold). Recipients come from Alert
// Routing. One alert per hub x product a day (dedupe on the link). No money
// and no customer details, so any routed role may see it.

import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { alertRecipients } from "./notification-routing.js";
import { sendPushToUsers } from "./push.js";
import { getOrgPushBranding } from "./push-branding.js";
import { loadStockIntel } from "./stock-intel-data.js";
import type { FallbackChance, HubRisk } from "./stock-intel-model.js";
import { loadStockSold } from "./stock-sold.js";
import { RESTOCK_WINDOW_DAYS, stateRestockNeeds, type StateRestock } from "./state-restock-model.js";
import { shiftDay } from "./stock-intel-model.js";

const DEDUPE_HOURS = 24;
const LINK_BASE = "/dashboard/admin/product-trend?tab=stock-intel";
const place = (state: string) => (state === "FCT Abuja" ? "Abuja" : state);

const ALERT_TYPES = ["stock_hub_risk", "stock_transfer_chance", "stock_state_restock"] as const;
export type IntelAlert = { type: (typeof ALERT_TYPES)[number]; title: string; message: string; link: string; productId: string };

/** Pure: one alert per busy state x product with less than a week left (tested). */
export function stateRestockAlerts(needs: StateRestock[], productName: (id: string) => string): IntelAlert[] {
  return needs.map((need) => {
    const product = productName(need.productId);
    return {
      type: "stock_state_restock" as const, productId: need.productId,
      title: `Restock ${place(need.state)}: ${product}`,
      message: `${place(need.state)} sold ${need.sold} ${product} in the last ${RESTOCK_WINDOW_DAYS} days and has ${need.left} left${need.onTheWay > 0 ? ` (+${need.onTheWay} on the way)` : ""}. That is less than a week. Send at least ${need.send}.`,
      link: `${LINK_BASE}&view=overview&state=${encodeURIComponent(need.state)}&product=${need.productId}`
    };
  });
}

/** Pure: the alerts for one branch's result (tested). */
export function intelAlerts(args: { hubRisks: HubRisk[]; fallbacks: FallbackChance[]; productName: (id: string) => string }): IntelAlert[] {
  const out: IntelAlert[] = [];
  for (const risk of args.hubRisks) {
    if (risk.shortage <= 0 || risk.networkDemand <= 0) continue;
    const product = args.productName(risk.productId);
    const deps = new Set(risk.dependents.map((d) => d.locationId)).size;
    out.push({
      type: "stock_hub_risk", productId: risk.productId,
      title: `${risk.hubLabel}: not enough ${product} for the network`,
      message: `${risk.hubLabel} has ${risk.available} ${product}. It needs ${risk.ownDemand} for its own week and ${risk.networkDemand} for ${deps} agent${deps === 1 ? "" : "s"} it restocks — ${risk.shortage} short. Restock ${place(risk.sourceState)} before sending more out of it.`,
      link: `${LINK_BASE}&view=network&hub=${encodeURIComponent(risk.sourceState)}&product=${risk.productId}`
    });
  }
  for (const chance of args.fallbacks) {
    const product = args.productName(chance.productId);
    out.push({
      type: "stock_transfer_chance", productId: chance.productId,
      title: `${chance.agentName} (${place(chance.state)}) can get ${product} from ${chance.from.label}`,
      message: `${chance.agentName} needs ${chance.need} ${product}. ${chance.from.label} can spare ${chance.from.spare} and still cover its own week — send ${chance.from.units}.`,
      link: `${LINK_BASE}&view=forecast&hub=${chance.locationId}&product=${chance.productId}`
    });
  }
  return out;
}

async function scanBranch(orgId: string, branchId: string) {
  const data = await loadStockIntel({ orgId, branchId, windowDays: 7 });
  const names = new Map(data.products.map((p) => [p.id, p.name]));
  const productName = (id: string) => names.get(id) ?? "Product";
  const alerts = intelAlerts({ hubRisks: data.result.hubRisks, fallbacks: data.result.fallbacks, productName });
  // Busy states with less than a week left. Its own try: a failure here must
  // not stop the hub alerts above.
  try {
    const sold = await loadStockSold({ orgId, branchId, start: shiftDay(data.today, -(RESTOCK_WINDOW_DAYS - 1)), end: data.today });
    const weekStart = shiftDay(data.today, -(RESTOCK_WINDOW_DAYS - 1));
    const needs = stateRestockNeeds({
      sold: sold.lines.filter((line) => line.day >= weekStart && line.day <= data.today),
      stock: sold.stock.map((row) => ({ locationId: "", ...row }))
    });
    alerts.push(...stateRestockAlerts(needs, productName));
  } catch (err: any) {
    logger.warn("stock-intel-alerts: state restock check failed", { orgId, branchId, error: err?.message ?? String(err) });
  }
  if (alerts.length === 0) return 0;

  const since = new Date(Date.now() - DEDUPE_HOURS * 3_600_000).toISOString();
  const { data: recent, error: recentError } = await supabase.from("system_notifications").select("link")
    .eq("org_id", orgId).in("type", [...ALERT_TYPES]).gte("created_at", since).limit(5000);
  if (recentError) { logger.warn("stock-intel-alerts: dedupe read failed", { orgId, error: recentError.message }); return 0; }
  const seen = new Set((recent ?? []).map((row: any) => String(row.link ?? "")));
  const fresh = alerts.filter((alert) => !seen.has(alert.link));
  if (fresh.length === 0) return 0;

  const branding = await getOrgPushBranding(orgId).catch(() => ({ brandName: "Protohub", brandLogo: undefined }));
  let sent = 0;
  for (const type of ALERT_TYPES) {
    const batch = fresh.filter((alert) => alert.type === type);
    if (batch.length === 0) continue;
    const { recipients, push } = await alertRecipients(orgId, type);
    const ids = [...recipients.keys()];
    if (ids.length === 0) continue;
    const rows = batch.flatMap((alert) => ids.map((id) => ({
      org_id: orgId, recipient_id: id, type, title: alert.title, message: alert.message, link: alert.link, product_id: alert.productId, read: false
    })));
    const { error } = await supabase.from("system_notifications").insert(rows);
    if (error) { logger.error("stock-intel-alerts: insert failed", { orgId, type, error: error.message }); continue; }
    sent += batch.length;
    if (!push) continue;
    for (const alert of batch) {
      sendPushToUsers(orgId, ids, { title: alert.title, body: alert.message, kind: type, url: alert.link, tag: `${type}-${alert.link}`, brandName: branding.brandName, brandLogo: branding.brandLogo })
        .catch((err) => logger.warn("stock-intel-alerts: push failed", { error: err?.message ?? String(err) }));
    }
  }
  return sent;
}

export async function runStockIntelAlerts(): Promise<{ branches: number; alerts: number }> {
  const { data: branches, error } = await supabase.from("branches").select("id, org_id").eq("active", true);
  if (error) { logger.error("stock-intel-alerts: branches read failed", { error: error.message }); return { branches: 0, alerts: 0 }; }
  let alerts = 0;
  for (const branch of branches ?? []) {
    try { alerts += await scanBranch(String((branch as any).org_id), String((branch as any).id)); }
    catch (err: any) { logger.warn("stock-intel-alerts: branch scan failed", { branchId: (branch as any).id, error: err?.message ?? String(err) }); }
  }
  return { branches: (branches ?? []).length, alerts };
}
