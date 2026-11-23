// Stock Intelligence alerts (Bright's brief §9, 23 Nov 2026). Two kinds the
// older low-stock alert (smart-stock-alerts.ts, per agent hub) does not cover:
//
//   stock_hub_risk         a hub that restocks other states (Abuja for the
//                          north) cannot cover its own week AND what the
//                          agents it supplies need.
//   stock_transfer_chance  an agent is short and a fallback hub (Ogun for
//                          Ibadan) can spare stock without becoming short.
//
// Same figures as the tab (loadStockIntel). Recipients come from Alert
// Routing. One alert per hub x product a day (dedupe on the link). No money
// and no customer details, so any routed role may see it.

import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { alertRecipients } from "./notification-routing.js";
import { sendPushToUsers } from "./push.js";
import { getOrgPushBranding } from "./push-branding.js";
import { loadStockIntel } from "./stock-intel-data.js";
import type { FallbackChance, HubRisk } from "./stock-intel-model.js";

const DEDUPE_HOURS = 24;
const LINK_BASE = "/dashboard/admin/product-trend?tab=stock-intel";
const place = (state: string) => (state === "FCT Abuja" ? "Abuja" : state);

export type IntelAlert = { type: "stock_hub_risk" | "stock_transfer_chance"; title: string; message: string; link: string; productId: string };

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
  const alerts = intelAlerts({ hubRisks: data.result.hubRisks, fallbacks: data.result.fallbacks, productName: (id) => names.get(id) ?? "Product" });
  if (alerts.length === 0) return 0;

  const since = new Date(Date.now() - DEDUPE_HOURS * 3_600_000).toISOString();
  const { data: recent, error: recentError } = await supabase.from("system_notifications").select("link")
    .eq("org_id", orgId).in("type", ["stock_hub_risk", "stock_transfer_chance"]).gte("created_at", since).limit(5000);
  if (recentError) { logger.warn("stock-intel-alerts: dedupe read failed", { orgId, error: recentError.message }); return 0; }
  const seen = new Set((recent ?? []).map((row: any) => String(row.link ?? "")));
  const fresh = alerts.filter((alert) => !seen.has(alert.link));
  if (fresh.length === 0) return 0;

  const branding = await getOrgPushBranding(orgId).catch(() => ({ brandName: "Protohub", brandLogo: undefined }));
  let sent = 0;
  for (const type of ["stock_hub_risk", "stock_transfer_chance"] as const) {
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
