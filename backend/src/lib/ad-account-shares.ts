import { supabase } from "./supabase.js";
import { pageKey, pageProducts } from "./ad-auto-product.js";
import { decideClaims, type ClaimEvidence } from "./ad-account-shares-rules.js";
export { decideClaims };

/**
 * Shared ad accounts (Bright, 15 Nov 2026). An account switched on in its home
 * branch can also be used by another branch (Zambia using "2nd Designers
 * Deluxe"). Spend is read once (home); each campaign counts in ONE branch.
 * A sharing branch takes a campaign only on proof: its own orders carry the
 * campaign, its landing page sells that branch's product, or the Owner mapped
 * it there by hand. Never by name: both branches sell "Edge Brusher Max".
 */

export type Share = { branchId: string; accountId: string; homeBranchId: string };
let sharesCache: { at: number; org: string; rows: Share[] } | null = null;
export async function sharesOf(orgId: string): Promise<Share[]> {
  if (sharesCache && sharesCache.org === orgId && Date.now() - sharesCache.at < 60_000) return sharesCache.rows;
  const { data, error } = await supabase.from("tracking_ad_account_shares").select("branch_id, account_id, home_branch_id").eq("org_id", orgId);
  if (error) throw error;
  const rows = ((data ?? []) as any[]).map((r) => ({ branchId: r.branch_id, accountId: String(r.account_id), homeBranchId: r.home_branch_id }));
  sharesCache = { at: Date.now(), org: orgId, rows };
  return rows;
}
export const forgetShares = () => { sharesCache = null; claimsCache.clear(); };

const claimsCache = new Map<string, { at: number; claims: Map<string, string> }>();
const norm = (id: string) => String(id).replace(/^act_/, "");

/** Campaign -> the sharing branch it belongs to, for every shared account of the org (10 min). */
export async function campaignClaims(orgId: string): Promise<Map<string, string>> {
  const shares = await sharesOf(orgId);
  if (!shares.length) return new Map();
  const hit = claimsCache.get(orgId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.claims;
  const byAccount = new Map<string, { home: string; with: Set<string> }>();
  for (const s of shares) { const a = byAccount.get(norm(s.accountId)) ?? { home: s.homeBranchId, with: new Set<string>() }; a.with.add(s.branchId); byAccount.set(norm(s.accountId), a); }
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const campaigns: Array<{ campaignId: string; homeBranchId: string; sharedWith: string[] }> = [];
  const adCampaign = new Map<string, string>(), adsetCampaign = new Map<string, string>();
  for (const [account, info] of byAccount) {
    const { data } = await supabase.from("tracking_ad_lifetime").select("campaign_id, adset_id, ad_id").eq("org_id", orgId).eq("branch_id", info.home).in("account_id", [account, `act_${account}`]).limit(20000);
    const ids = new Set<string>();
    for (const r of (data ?? []) as any[]) { ids.add(String(r.campaign_id)); adCampaign.set(String(r.ad_id), String(r.campaign_id)); adsetCampaign.set(String(r.adset_id), String(r.campaign_id)); }
    const { data: daily } = await supabase.from("tracking_meta_ad_insights").select("campaign_id, adset_id, ad_id").eq("org_id", orgId).eq("branch_id", info.home).in("ad_account_id", [account, `act_${account}`]).gte("day", since.slice(0, 10)).limit(20000);
    for (const r of (daily ?? []) as any[]) { ids.add(String(r.campaign_id)); adCampaign.set(String(r.ad_id), String(r.campaign_id)); adsetCampaign.set(String(r.adset_id), String(r.campaign_id)); }
    for (const id of ids) campaigns.push({ campaignId: id, homeBranchId: info.home, sharedWith: [info.home, ...info.with] });
  }
  const campaignIds = new Set(campaigns.map((c) => c.campaignId));
  const branches = [...new Set(shares.flatMap((s) => [s.branchId, s.homeBranchId]))];
  const ev: ClaimEvidence = { orderBranches: new Map(), mappedBranches: new Map(), pageBranches: new Map() };
  // Orders carrying the campaign (launch-safe: Owner-only ad spend; counts only).
  for (const branchId of branches) {
    for (let page = 0; page < 30; page += 1) {
      const { data, error } = await supabase.from("orders").select("id, utm_campaign, utm_content").eq("org_id", orgId).eq("branch_id", branchId).gte("created_at", since).not("utm_campaign", "is", null).order("id").range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      for (const o of (data ?? []) as any[]) {
        const c = campaignIds.has(String(o.utm_campaign)) ? String(o.utm_campaign) : adCampaign.get(String(o.utm_content ?? ""));
        if (!c || !campaignIds.has(c)) continue;
        const m = ev.orderBranches.get(c) ?? new Map<string, number>();
        m.set(branchId, (m.get(branchId) ?? 0) + 1); ev.orderBranches.set(c, m);
      }
      if ((data ?? []).length < 1000) break;
    }
  }
  // Mapped by hand in a branch.
  const { data: maps } = await supabase.from("tracking_ad_spend_mappings").select("branch_id, level, meta_id").eq("org_id", orgId).in("branch_id", branches);
  for (const m of (maps ?? []) as any[]) {
    const c = m.level === "campaign" ? String(m.meta_id) : m.level === "adset" ? adsetCampaign.get(String(m.meta_id)) : m.level === "ad" ? adCampaign.get(String(m.meta_id)) : undefined;
    if (!c || !campaignIds.has(c)) continue;
    const set = ev.mappedBranches.get(c) ?? new Set<string>(); set.add(m.branch_id); ev.mappedBranches.set(c, set);
  }
  // Landing page selling a branch's product (pages learned from each branch's orders).
  const links: any[] = [];
  const adIds = [...adCampaign.keys()];
  for (let i = 0; i < Math.min(adIds.length, 6000); i += 300) {
    const { data } = await supabase.from("tracking_meta_ad_links").select("ad_id, page").eq("org_id", orgId).in("ad_id", adIds.slice(i, i + 300));
    links.push(...((data ?? []) as any[]));
  }
  const pageOfCampaign = new Map<string, Set<string>>();
  for (const l of (links ?? []) as any[]) { const c = adCampaign.get(String(l.ad_id)); if (c && l.page) { const s = pageOfCampaign.get(c) ?? new Set<string>(); s.add(l.page); pageOfCampaign.set(c, s); } }
  // An ad linking straight to a branch's product form is proof (15 Nov 2026).
  const directIds = [...new Set([...pageOfCampaign.values()].flatMap((ps) => [...ps]).filter((p) => p.startsWith("product:")).map((p) => p.slice(8)))];
  if (directIds.length) {
    const { data: prods } = await supabase.from("products").select("id, branch_id").eq("org_id", orgId).in("id", directIds);
    const branchOfProduct = new Map(((prods ?? []) as any[]).map((r) => [String(r.id), String(r.branch_id)]));
    for (const [c, ps] of pageOfCampaign) for (const p of ps) {
      const b = p.startsWith("product:") ? branchOfProduct.get(p.slice(8)) : undefined;
      if (b) { const set = ev.pageBranches.get(c) ?? new Set<string>(); set.add(b); ev.pageBranches.set(c, set); }
    }
  }
  if (pageOfCampaign.size) {
    for (const branchId of branches) {
      const rows: Array<{ page: string | null; productId: string | null }> = [];
      // launch-safe: Owner-only Tracking Hub; reads each landing page's product, never shows an order.
      const { data } = await supabase.from("orders").select("product_id, lp:form_context->>landingPageUrl").eq("org_id", orgId).eq("branch_id", branchId).gte("created_at", since).not("product_id", "is", null).limit(20000);
      for (const r of (data ?? []) as any[]) rows.push({ page: pageKey(r.lp), productId: r.product_id });
      const pages = new Set(pageProducts(rows).keys());
      for (const [c, ps] of pageOfCampaign) if ([...ps].some((p) => pages.has(p))) { const s = ev.pageBranches.get(c) ?? new Set<string>(); s.add(branchId); ev.pageBranches.set(c, s); }
    }
  }
  const claims = decideClaims(campaigns, ev);
  claimsCache.set(orgId, { at: Date.now(), claims });
  return claims;
}

/** What one branch reads: its own rows minus campaigns claimed away, plus campaigns it claims on accounts shared with it. */
export async function branchShareView(orgId: string, branchId: string) {
  const shares = await sharesOf(orgId);
  if (!shares.length) return null;
  const mine = shares.filter((s) => s.branchId === branchId);
  const ownShared = shares.some((s) => s.homeBranchId === branchId);
  if (!mine.length && !ownShared) return null;
  const claims = await campaignClaims(orgId);
  const claimedAway = new Set([...claims.entries()].filter(([, b]) => b !== branchId).map(([c]) => c));
  const claimedHere = [...claims.entries()].filter(([, b]) => b === branchId).map(([c]) => c);
  return { sharedIn: mine.map((s) => ({ accountId: norm(s.accountId), homeBranchId: s.homeBranchId })), claimedAway, claimedHere };
}
