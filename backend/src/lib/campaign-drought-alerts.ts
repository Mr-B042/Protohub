import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { alertRecipients } from "./notification-routing.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUser } from "./push.js";
import { lagosDateKey } from "./sales-bonus-engine.js";
import { sinceStartCore } from "./ad-spend-data.js";
import { TIKTOK_PREFIX } from "./ad-spend.js";
import { campaignVerdicts, VERDICT_RULES, type CampaignVerdict, type VerdictResult } from "./campaign-verdict.js";
import { alertSeesAdSpend } from "./alert-privacy.js";

// Campaign decisions (Bright, 15 Nov 2026): ONE verdict per running campaign
// by its product's break-even (campaign-verdict.ts), on Tracking Hub › Ad
// Spend with a count on the sidebar, and alerts for Turn off / Pause / Check
// tracking (routing key campaign_no_orders, kept so Alert routing and
// Telegram settings still apply). Replaces the 3-day + money lists (#908, #1004).

export const DROUGHT_ALERT_TYPE = "campaign_no_orders";
const ALERTED: CampaignVerdict[] = ["turn_off", "pause", "check_tracking"];
// Short: a campaign switched off in Meta must drop off the list quickly.
const CACHE_MS = 5 * 60_000;
type Checked = { at: number; verdicts: VerdictResult[]; unchecked: number; uncheckedAccounts: Array<{ name: string; message: string }> };
const cache = new Map<string, Checked>();

/** Every running campaign of a branch with its one decision, kept 5 minutes. */
export async function droughtsFor(orgId: string, branchId: string, opts: { fresh?: boolean } = {}) {
  const key = `${orgId}|${branchId}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return { ...hit, checkedAt: new Date(hit.at).toISOString() };
  const today = lagosDateKey(new Date().toISOString());
  const core = await sinceStartCore(orgId, branchId, today);
  const lastOrderDay = new Map<string, string>();
  const ordersByDay = new Map<string, Map<string, number>>();
  for (const order of core.data.orders) {
    if (!order.campaignId) continue;
    const seen = lastOrderDay.get(order.campaignId);
    if (!seen || order.day > seen) lastOrderDay.set(order.campaignId, order.day);
    const perDay = ordersByDay.get(order.campaignId) ?? new Map<string, number>();
    perDay.set(order.day, (perDay.get(order.day) ?? 0) + 1);
    ordersByDay.set(order.campaignId, perDay);
  }
  const spendByDay = new Map<string, Map<string, number>>();
  const platformByDay = new Map<string, Map<string, number>>();
  for (const row of core.data.insights) {
    const days = spendByDay.get(row.campaign_id) ?? new Map<string, number>();
    days.set(row.day, (days.get(row.day) ?? 0) + (Number(row.spend) || 0));
    spendByDay.set(row.campaign_id, days);
    if (row.purchases) {
      const p = platformByDay.get(row.campaign_id) ?? new Map<string, number>();
      p.set(row.day, (p.get(row.day) ?? 0) + Number(row.purchases));
      platformByDay.set(row.campaign_id, p);
    }
  }
  const marginOf = new Map(core.targets.map((t) => [t.productId, t.margin]));
  const spendFrom = core.data.insights.map((row) => row.day).sort()[0];
  const all = campaignVerdicts({
    today, lastOrderDay, ordersByDay, spendByDay, platformByDay, spendFrom,
    campaigns: core.rows.map((row) => ({
      campaignId: row.campaignId, campaignName: row.campaignName, platform: row.platform, accountName: row.accountName, productName: row.productName,
      running: true, target: row.target, targetSource: row.targetSource, spend: row.spend, orders: row.orders, delivered: row.delivered,
      marginPerDelivery: row.productId ? marginOf.get(row.productId) ?? null : null
    }))
  });
  // ⚠️ Only campaigns Meta says are delivering RIGHT NOW (Bright, 5 Nov 2026):
  // a campaign stays "ACTIVE" with its ads paused. An account Meta did not
  // answer for is left out and named (never guessed). TikTok: spent today.
  const rowOf = new Map(core.rows.map((row) => [row.campaignId, row]));
  const unknown = new Set<string>();
  const verdicts = all.filter((v) => {
    const row = rowOf.get(v.campaignId);
    if (v.platform !== "meta" || v.campaignId.startsWith(TIKTOK_PREFIX)) return (spendByDay.get(v.campaignId)?.get(today) ?? 0) > 0;
    if (row?.runningSource !== "live") { unknown.add(v.campaignId); return false; }
    return row.running;
  });
  const entry: Checked = { at: Date.now(), verdicts, unchecked: unknown.size, uncheckedAccounts: core.liveFailures.map((f) => ({ name: f.name, message: f.message })) };
  cache.set(key, entry);
  return { ...entry, checkedAt: new Date(entry.at).toISOString() };
}

const linkFor = (v: VerdictResult) => `/dashboard/admin/tracking-hub?tab=adspend&alert=${encodeURIComponent(v.episodeKey)}`;
const WORD: Record<CampaignVerdict, string> = { turn_off: "Turn off", pause: "Pause & check", check_tracking: "Check tracking", watch: "Watch", scale: "Scale", keep: "Keep" };

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

/** A few times a day: Turn off / Pause / Check tracking, once per campaign per situation. */
export async function runCampaignDroughtAlerts() {
  let sent = 0;
  for (const { orgId, branchId } of await adBranches()) {
    try {
      const { verdicts } = await droughtsFor(orgId, branchId, { fresh: true });
      const due = verdicts.filter((v) => ALERTED.includes(v.verdict));
      if (due.length === 0) continue;
      const links = due.map(linkFor);
      const { data: told, error } = await supabase.from("system_notifications").select("link").eq("org_id", orgId).eq("type", DROUGHT_ALERT_TYPE).in("link", links);
      if (error) throw error;
      const done = new Set(((told ?? []) as any[]).map((row) => String(row.link)));
      const fresh = due.filter((v) => !done.has(linkFor(v)));
      if (fresh.length === 0) continue;
      const routed = await alertRecipients(orgId, DROUGHT_ALERT_TYPE);
      // Ad spend in every line: only roles that may see it, whatever Alert routing says (Bright, 6 Nov 2026).
      const recipients = new Map([...routed.recipients].filter(([, role]) => alertSeesAdSpend(role)));
      if (recipients.size === 0) continue;
      const titleOf = (v: VerdictResult) => `${WORD[v.verdict]}: ${v.campaignName}`;
      const insert = await supabase.from("system_notifications").insert(fresh.flatMap((v) => [...recipients.keys()].map((recipientId) => ({
        org_id: orgId, branch_id: branchId, recipient_id: recipientId, type: DROUGHT_ALERT_TYPE, read: false, link: linkFor(v),
        title: titleOf(v), message: `${v.reason} ${v.action}`
      }))));
      if (insert.error) throw insert.error;
      sent += fresh.length;
      if (!routed.push) continue;
      const branding = await getOrgPushBranding(orgId);
      // Many at once: one push that sums them up, so phones are not flooded.
      const pushes = fresh.length <= 3
        ? fresh.map((v) => ({ title: titleOf(v), body: v.reason, url: linkFor(v), tag: `campaign-verdict-${v.campaignId}` }))
        : [{
            title: `${fresh.length} campaigns need a decision`,
            body: ALERTED.map((k) => [k, fresh.filter((v) => v.verdict === k).length] as const).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${WORD[k].toLowerCase()}`).join(" · ") + ". Open Ad Spend to see them.",
            url: "/dashboard/admin/tracking-hub?tab=adspend", tag: "campaign-verdict-summary"
          }];
      for (const message of pushes) {
        await Promise.all([...recipients.keys()].map((recipientId) => sendPushToUser(orgId, recipientId, {
          ...message, kind: DROUGHT_ALERT_TYPE, brandName: branding.brandName, brandLogo: branding.brandLogo
        }).catch((err) => logger.warn("campaign verdict push failed", { orgId, error: String(err) }))));
      }
    } catch (error: any) {
      logger.warn("campaign verdict check failed", { orgId, branchId, error: error?.message ?? String(error) });
    }
  }
  return { sent };
}

export { VERDICT_RULES };
