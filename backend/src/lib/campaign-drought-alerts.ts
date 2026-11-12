import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { alertRecipients } from "./notification-routing.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUser } from "./push.js";
import { lagosDateKey } from "./sales-bonus-engine.js";
import { sinceStartCore } from "./ad-spend-data.js";
import { TIKTOK_PREFIX } from "./ad-spend.js";
import { campaignDroughts, DROUGHT_RULES, type Drought, type DroughtGroup } from "./campaign-drought.js";
import { alertSeesAdSpend } from "./alert-privacy.js";

// Campaigns with no order for 3 days (Bright, 5 Nov 2026): worked out from
// Since Start, shown on Tracking Hub › Ad Spend with a count on the sidebar,
// and sent as alerts (routing key campaign_no_orders). Rules: campaign-drought.ts.

export const DROUGHT_ALERT_TYPE = "campaign_no_orders";
// Short: a campaign switched off in Meta must drop off the list quickly.
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; droughts: Drought[]; unchecked: number }>();

/** The dry campaigns of a branch, kept 15 minutes (Since Start reads months of orders). */
export async function droughtsFor(orgId: string, branchId: string, opts: { fresh?: boolean } = {}) {
  const key = `${orgId}|${branchId}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return { droughts: hit.droughts, unchecked: hit.unchecked, checkedAt: new Date(hit.at).toISOString() };
  const today = lagosDateKey(new Date().toISOString());
  const core = await sinceStartCore(orgId, branchId, today);
  const lastOrderDay = new Map<string, string>();
  for (const order of core.data.orders) {
    if (!order.campaignId) continue;
    const seen = lastOrderDay.get(order.campaignId);
    if (!seen || order.day > seen) lastOrderDay.set(order.campaignId, order.day);
  }
  const spendByDay = new Map<string, Map<string, number>>();
  for (const row of core.data.insights) {
    const days = spendByDay.get(row.campaign_id) ?? new Map<string, number>();
    days.set(row.day, (days.get(row.day) ?? 0) + (Number(row.spend) || 0));
    spendByDay.set(row.campaign_id, days);
  }
  // ⚠️ NOT the saved campaign status (Bright, 5 Nov 2026: "some ... has already
  // been turned off"). Meta keeps a campaign "ACTIVE" when its ad sets or ads
  // are paused. Since Start now asks Meta live (runningSource "live"): only
  // those answers count here. An account Meta did not answer is left out
  // (never guessed) and counted as unchecked. TikTok has no live check yet:
  // kept only when it spent today.
  const rowOf = new Map(core.rows.map((row) => [row.campaignId, row]));
  const spendFrom = core.data.insights.map((row) => row.day).sort()[0];
  const candidates = campaignDroughts({
    today, lastOrderDay, spendByDay, spendFrom,
    campaigns: core.rows.map((row) => ({
      campaignId: row.campaignId, campaignName: row.campaignName, platform: row.platform, accountName: row.accountName,
      running: true, start: row.start, spend: row.spend, orders: row.orders, cpa: row.cpa, productName: row.productName
    }))
  });
  let unchecked = 0;
  const droughts = candidates.filter((drought) => {
    const row = rowOf.get(drought.campaignId);
    if (drought.platform !== "meta" || drought.campaignId.startsWith(TIKTOK_PREFIX)) return (spendByDay.get(drought.campaignId)?.get(today) ?? 0) > 0;
    if (row?.runningSource !== "live") { unchecked += 1; return false; }
    return row.running;
  });
  cache.set(key, { at: Date.now(), droughts, unchecked });
  return { droughts, unchecked, checkedAt: new Date().toISOString() };
}

const linkFor = (drought: Drought) => `/dashboard/admin/tracking-hub?tab=adspend&alert=${encodeURIComponent(drought.episodeKey)}`;
const GROUP_WORD: Record<DroughtGroup, string> = { off: "Turn off", watch: "Watch", adjust: "Check" };

/** Branches with an ad account (same list the ad spend sync uses). */
async function adBranches() {
  const [accounts, tiktok] = await Promise.all([
    supabase.from("tracking_meta_ad_accounts").select("org_id, branch_id").eq("active", true),
    supabase.from("tracking_tiktok_connections").select("org_id, branch_id").not("access_token", "is", null)
  ]);
  if (accounts.error) throw accounts.error;
  if (tiktok.error) throw tiktok.error;
  const out = new Map<string, { orgId: string; branchId: string }>();
  for (const row of [...(accounts.data ?? []), ...(tiktok.data ?? [])] as any[]) out.set(`${row.org_id}|${row.branch_id}`, { orgId: row.org_id, branchId: row.branch_id });
  return [...out.values()];
}

/** A few times a day: one alert per campaign per dry spell, never repeated. */
export async function runCampaignDroughtAlerts() {
  let sent = 0;
  for (const { orgId, branchId } of await adBranches()) {
    try {
      const { droughts } = await droughtsFor(orgId, branchId, { fresh: true });
      if (droughts.length === 0) continue;
      const links = droughts.map(linkFor);
      const { data: told, error } = await supabase.from("system_notifications").select("link")
        .eq("org_id", orgId).eq("type", DROUGHT_ALERT_TYPE).in("link", links);
      if (error) throw error;
      const done = new Set(((told ?? []) as any[]).map((row) => String(row.link)));
      const fresh = droughts.filter((drought) => !done.has(linkFor(drought)));
      if (fresh.length === 0) continue;
      const routed = await alertRecipients(orgId, DROUGHT_ALERT_TYPE);
      // Ad spend in every line: only roles that may see it, whatever Alert routing says (Bright, 6 Nov 2026).
      const recipients = new Map([...routed.recipients].filter(([, role]) => alertSeesAdSpend(role)));
      const push = routed.push;
      if (recipients.size === 0) continue;
      const rows = fresh.flatMap((drought) => [...recipients.keys()].map((recipientId) => ({
        org_id: orgId, branch_id: branchId, recipient_id: recipientId, type: DROUGHT_ALERT_TYPE, read: false, link: linkFor(drought),
        title: `${GROUP_WORD[drought.group]}: ${drought.campaignName} - no order in ${drought.daysWithoutOrder} full days running`,
        message: drought.lastOrderDay && drought.spendSinceLastOrder >= 1
          ? `${drought.advice} ₦${Math.round(drought.spendSinceLastOrder).toLocaleString("en-NG")} spent since the last order${drought.todaySpend >= 1 ? `, including today's ₦${Math.round(drought.todaySpend).toLocaleString("en-NG")} so far` : ""}.`
          : drought.advice
      })));
      const insert = await supabase.from("system_notifications").insert(rows);
      if (insert.error) throw insert.error;
      sent += fresh.length;
      if (!push) continue;
      const branding = await getOrgPushBranding(orgId);
      // Many at once: one push that sums them up, so phones are not flooded.
      const pushes = fresh.length <= 3
        ? fresh.map((drought) => ({ title: `${GROUP_WORD[drought.group]}: ${drought.campaignName}`, body: `No order in ${drought.daysWithoutOrder} full days running. ${drought.advice}`, url: linkFor(drought), tag: `campaign-dry-${drought.campaignId}` }))
        : [{
            title: `${fresh.length} campaigns with no order in ${DROUGHT_RULES.days}+ full days`,
            body: (["off", "watch", "adjust"] as DroughtGroup[]).map((group) => [group, fresh.filter((d) => d.group === group).length] as const)
              .filter(([, count]) => count > 0).map(([group, count]) => `${count} ${GROUP_WORD[group].toLowerCase()}`).join(" · ") + ". Open Ad Spend to see them.",
            url: "/dashboard/admin/tracking-hub?tab=adspend", tag: "campaign-dry-summary"
          }];
      for (const message of pushes) {
        await Promise.all([...recipients.keys()].map((recipientId) => sendPushToUser(orgId, recipientId, {
          ...message, kind: DROUGHT_ALERT_TYPE, brandName: branding.brandName, brandLogo: branding.brandLogo
        }).catch((err) => logger.warn("campaign drought push failed", { orgId, error: String(err) }))));
      }
    } catch (error: any) {
      logger.warn("campaign drought check failed", { orgId, branchId, error: error?.message ?? String(error) });
    }
  }
  return { sent };
}
