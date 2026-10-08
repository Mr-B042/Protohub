import { supabase } from "./supabase.js";
import { addDaysToDateKey, lagosDateKey } from "./sales-bonus-engine.js";
import { orderAdIds, productFromName } from "./tracking-hub.js";
import { dayOfIso, endIso, journeyCounts, loadBasics, startIso, type Basics } from "./tracking-hub-data.js";
import { refreshAccount, refreshTargets } from "./tracking-meta-refresh.js";
import { linkEvidence, type AccountInfo, type SpendInsight, type SpendMapping, type SpendOrder } from "./ad-spend.js";

// Loading and syncing for Tracking Hub -> Ad Spend (Bright, 8 Oct 2026). The
// maths is in ad-spend.ts; this file reads the database and Meta.

const PAGE = 1000;

async function insightsBetween(orgId: string, branchId: string, from: string, to: string): Promise<SpendInsight[]> {
  const rows: SpendInsight[] = [];
  for (let page = 0; page < 60; page += 1) {
    const { data, error } = await supabase.from("tracking_meta_ad_insights")
      .select("id, day, spend, ad_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name")
      .eq("org_id", orgId).eq("branch_id", branchId).gte("day", from).lte("day", to)
      .order("id").range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as any[]).map((row) => ({ ...row, day: String(row.day).slice(0, 10), spend: Number(row.spend) || 0 })));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

/** Every order of the branch placed in the window (not only form orders); review holds left out. */
async function ordersBetween(orgId: string, branchId: string, from: string, to: string): Promise<SpendOrder[]> {
  const rows: SpendOrder[] = [];
  for (let page = 0; page < 60; page += 1) {
    const { data, error } = await supabase.from("orders")
      .select("id, created_at, product_id, status, amount, cogs_snapshot, logistics_cost, form_context, utm_source, utm_campaign, utm_content, utm_term, review_hold")
      .eq("org_id", orgId).eq("branch_id", branchId).gte("created_at", startIso(from)).lte("created_at", endIso(to))
      .order("id").range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    for (const order of (data ?? []) as any[]) {
      if (order.review_hold === true) continue;
      const ids = orderAdIds(order);
      rows.push({
        id: String(order.id), day: dayOfIso(order.created_at), productId: order.product_id ?? null, status: String(order.status ?? ""),
        amount: Number(order.amount) || 0, productCost: Number(order.cogs_snapshot) || 0, deliveryFee: Number(order.logistics_cost) || 0,
        campaignId: ids.campaignId, adsetId: ids.adsetId, adId: ids.adId
      });
    }
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

/** Ad account -> its name and Meta Business (a connection, or a Pixel added by hand). */
export function accountsOf(basics: Basics): Map<string, AccountInfo> {
  const map = new Map<string, AccountInfo>();
  const connections = new Map((basics.connections as any[]).map((row) => [row.id, row]));
  for (const account of basics.adAccounts as any[]) {
    const connection: any = connections.get(account.connection_id);
    map.set(String(account.account_id), { accountId: String(account.account_id), name: account.name || `act_${account.account_id}`, businessKey: account.connection_id ?? "", businessName: connection?.name || "Meta Business" });
  }
  for (const source of basics.sources as any[]) {
    for (const raw of (source.ad_account_ids ?? []) as string[]) {
      const id = String(raw).replace(/^act_/, "");
      if (!map.has(id)) map.set(id, { accountId: id, name: source.ad_account_label || `act_${id}`, businessKey: `src:${source.id}`, businessName: source.business_name || source.name || "Ad accounts added by hand" });
    }
  }
  return map;
}

export async function loadAdSpendInputs(orgId: string, branchId: string, from: string, to: string) {
  const [basics, insights, orders, mappingsRes, stateRes, daysRes, journey] = await Promise.all([
    loadBasics(orgId, branchId), insightsBetween(orgId, branchId, from, to), ordersBetween(orgId, branchId, from, to),
    supabase.from("tracking_ad_spend_mappings").select("level, meta_id, ad_account_id, label, splits, created_by_name, updated_at").eq("org_id", orgId).eq("branch_id", branchId),
    supabase.from("tracking_ad_spend_state").select("*").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle(),
    supabase.from("tracking_ad_spend_days").select("day").eq("org_id", orgId).eq("branch_id", branchId).gte("day", from).lte("day", to),
    // Where each ad's visitors landed (last 30 days of form opens).
    journeyCounts(orgId, branchId, addDaysToDateKey(to, -29), to).catch(() => [])
  ]);
  if (mappingsRes.error) throw mappingsRes.error;
  if (stateRes.error) throw stateRes.error;
  if (daysRes.error) throw daysRes.error;
  const visits = journey.filter((row) => row.event_type === "form_opened" && row.ad_id).map((row) => ({ adId: row.ad_id!, productId: row.product_id, visits: row.visits }));
  for (const order of orders) if (order.adId && order.productId) visits.push({ adId: order.adId, productId: order.productId, visits: 1 });
  return {
    basics, insights, orders, mappings: (mappingsRes.data ?? []) as Array<SpendMapping & { ad_account_id: string | null; label: string; created_by_name: string | null; updated_at: string }>,
    state: stateRes.data as any, finalDays: new Set((daysRes.data ?? []).map((row: any) => String(row.day).slice(0, 10))),
    evidence: linkEvidence(visits), accounts: accountsOf(basics)
  };
}

/** A name match, offered in the assign box only - never used to give spend a product. */
export const suggestProduct = (names: string[], products: Array<{ id: string; name: string }>) => {
  for (const name of names) { const id = productFromName(name, products); if (id) return id; }
  return null;
};

// ---------------------------------------------------------------- sync

/**
 * Read Meta's spend for the days given, for every switched-on ad account of
 * the branch. A day is final once it is synced after 06:00 the next morning
 * (Lagos); the auto sync stops re-reading final days.
 */
export async function syncAdSpend(orgId: string, branchId: string, opts: { from: string; to: string; trigger: "auto" | "manual"; now?: Date }) {
  const now = opts.now ?? new Date();
  const targets = refreshTargets(await loadBasics(orgId, branchId));
  if (targets.length === 0) return { ok: false, accounts: 0, failed: [] as string[], message: "No ad account is switched on. Connect your Meta Business in Data Sources and switch on its ad accounts." };
  const report: Array<Awaited<ReturnType<typeof refreshAccount>>> = [];
  for (let i = 0; i < targets.length; i += 4) {
    report.push(...await Promise.all(targets.slice(i, i + 4).map((target) =>
      refreshAccount(orgId, branchId, target, opts.from, opts.to).catch((error: any) => ({ source: target.label, account: target.account, ok: false, message: error?.message ?? "Failed", rows: 0 }))
    )));
  }
  const failed = report.filter((row) => !row.ok);
  const ok = failed.length === 0;
  if (ok) {
    const today = lagosDateKey(now.toISOString());
    const hour = Number(now.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Africa/Lagos" }));
    const lastFinal = hour >= 6 ? addDaysToDateKey(today, -1) : addDaysToDateKey(today, -2);
    const days: string[] = [];
    for (let day = opts.from; day <= opts.to && day <= lastFinal; day = addDaysToDateKey(day, 1)) days.push(day);
    if (days.length) {
      const { error } = await supabase.from("tracking_ad_spend_days").upsert(days.map((day) => ({ org_id: orgId, branch_id: branchId, day, finalized_at: now.toISOString() })), { onConflict: "org_id,branch_id,day", ignoreDuplicates: true });
      if (error) throw error;
    }
  }
  const message = ok ? `Synced ${report.length} ad account${report.length === 1 ? "" : "s"}.` : `Couldn't read ${failed.length} of ${report.length} ad account${report.length === 1 ? "" : "s"}: ${failed.map((row) => `${row.source} (${row.message})`).join("; ")}`;
  const { error } = await supabase.from("tracking_ad_spend_state").upsert({
    org_id: orgId, branch_id: branchId, last_sync_at: now.toISOString(), last_sync_ok: ok, last_sync_message: message, last_sync_trigger: opts.trigger, updated_at: now.toISOString()
  }, { onConflict: "org_id,branch_id" });
  if (error) throw error;
  return { ok, accounts: report.length, failed: failed.map((row) => row.source), message };
}

/**
 * Every 30 minutes: today's spend so far (and yesterday until it is final)
 * for each branch with a switched-on ad account and auto sync on.
 */
export async function runAdSpendAutoSync(now = new Date()) {
  const [accounts, sources, states] = await Promise.all([
    supabase.from("tracking_meta_ad_accounts").select("org_id, branch_id").eq("active", true),
    supabase.from("tracking_data_sources").select("org_id, branch_id, ad_account_ids"),
    supabase.from("tracking_ad_spend_state").select("org_id, branch_id, auto_sync")
  ]);
  for (const result of [accounts, sources, states]) if (result.error) throw result.error;
  const off = new Set((states.data ?? []).filter((row: any) => row.auto_sync === false).map((row: any) => `${row.org_id}|${row.branch_id}`));
  const branches = new Map<string, { orgId: string; branchId: string }>();
  for (const row of [...(accounts.data ?? []), ...(sources.data ?? []).filter((item: any) => (item.ad_account_ids ?? []).length)] as any[]) {
    const key = `${row.org_id}|${row.branch_id}`;
    if (!off.has(key)) branches.set(key, { orgId: row.org_id, branchId: row.branch_id });
  }
  const today = lagosDateKey(now.toISOString());
  const yesterday = addDaysToDateKey(today, -1);
  let synced = 0;
  for (const { orgId, branchId } of branches.values()) {
    try {
      const { data: final } = await supabase.from("tracking_ad_spend_days").select("day").eq("org_id", orgId).eq("branch_id", branchId).eq("day", yesterday).maybeSingle();
      const result = await syncAdSpend(orgId, branchId, { from: final ? today : yesterday, to: today, trigger: "auto", now });
      if (result.accounts) synced += 1;
    } catch (error: any) {
      console.warn("[ad-spend] auto sync failed:", branchId, error?.message ?? error);
    }
  }
  return { synced };
}
