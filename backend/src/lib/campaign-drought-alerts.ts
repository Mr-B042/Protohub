import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { alertRecipients } from "./notification-routing.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUser } from "./push.js";
import { loadCampaignDecisions } from "./campaign-decisions-data.js";
import { ENGINE_RULES, type Decision } from "./campaign-engine.js";
import { alertSeesAdSpend } from "./alert-privacy.js";

// Campaign decisions. Since 21 Nov 2026 the rules are Bright's "Complete Logic
// & Rating System" (campaign-engine.ts), the same as Tracking Hub › Campaign
// Decisions: Turn off needs sustained losses with evidence; 2× break-even with
// no order is "pause & escalate", not an automatic turn off. Alerts go out for
// Turn off and Pause (routing key campaign_no_orders, kept so Alert routing and
// Telegram settings still apply).

export const DROUGHT_ALERT_TYPE = "campaign_no_orders";
const ALERTED: Decision[] = ["turn_off", "pause"];
export type VerdictResult = {
  campaignId: string; campaignName: string; platform: string; accountName: string; productName: string | null;
  verdict: Decision; label: string; reason: string; action: string; episodeKey: string; score: number; confidence: string;
};

/** Every running campaign of a branch with its one decision (kept 5 minutes). */
export async function droughtsFor(orgId: string, branchId: string, opts: { fresh?: boolean } = {}) {
  const value = await loadCampaignDecisions(orgId, branchId, { periodDays: 3, fresh: opts.fresh });
  const verdicts: VerdictResult[] = value.rows.map((row) => ({
    campaignId: row.campaignId, campaignName: row.campaignName, platform: row.platform, accountName: row.accountName, productName: row.productName,
    verdict: row.decision, label: row.label, reason: row.why, action: row.action, episodeKey: row.episodeKey, score: row.score, confidence: row.confidence
  }));
  return { verdicts, unchecked: value.unchecked, uncheckedAccounts: value.uncheckedAccounts, checkedAt: value.checkedAt };
}

const linkFor = (v: VerdictResult) => `/dashboard/admin/tracking-hub?tab=decisions&campaign=${encodeURIComponent(v.campaignId)}&alert=${encodeURIComponent(v.episodeKey)}`;

/** Branches with an ad account (same list the ad spend sync uses). */
async function adBranches() {
  const [accounts, tiktok] = await Promise.all([
    supabase.from("tracking_meta_ad_accounts").select("org_id, branch_id").eq("active", true),
    supabase.from("tracking_tiktok_connections").select("org_id, branch_id").not("access_token", "is", null)
  ]);
  if (accounts.error) throw accounts.error;
  if (tiktok.error) throw tiktok.error;
  const out = new Map<string, { orgId: string; branchId: string }>();
  const shared = await supabase.from("tracking_ad_account_shares").select("org_id, branch_id");
  for (const row of [...(accounts.data ?? []), ...(tiktok.data ?? []), ...(shared.data ?? [])] as any[]) out.set(`${row.org_id}|${row.branch_id}`, { orgId: row.org_id, branchId: row.branch_id });
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
      const titleOf = (v: VerdictResult) => `${v.label}: ${v.campaignName}`;
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
            body: ALERTED.map((k) => [k, fresh.filter((v) => v.verdict === k).length] as const).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k === "turn_off" ? "turn off" : "pause & check"}`).join(" · ") + ". Open Campaign Decisions to see them.",
            url: "/dashboard/admin/tracking-hub?tab=decisions", tag: "campaign-verdict-summary"
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

export { ENGINE_RULES as VERDICT_RULES };
