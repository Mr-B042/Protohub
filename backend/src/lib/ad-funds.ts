import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { adAccountFunds } from "./meta-graph.js";
import { humanMetaError } from "./tracking-hub.js";
import { alertRecipients } from "./notification-routing.js";
import { alertSeesAdSpend } from "./alert-privacy.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUser } from "./push.js";
import { alertDue, cleanFundsSettings, fundsLeft, lowReason, naira, type FundsSettings, type LowReason } from "./ad-funds-rules.js";

// Low ad account funds (Bright, 12 Nov 2026). Every 30 minutes, after the ad
// spend sync: each switched-on Meta ad account's money left, saved in
// tracking_ad_account_funds (migration 349), and an alert (routing key
// ad_account_low_funds) when it drops below the Owner's level. Rules:
// ad-funds-rules.ts. On/off and the level: organizations.ad_funds_alert.

export const FUNDS_ALERT_TYPE = "ad_account_low_funds";
const LINK = "/dashboard/admin/tracking-hub?tab=adspend&funds=1";

export async function fundsSettingsFor(orgId: string): Promise<FundsSettings> {
  const { data, error } = await supabase.from("organizations").select("ad_funds_alert").eq("id", orgId).maybeSingle();
  if (error) throw error;
  return cleanFundsSettings((data as any)?.ad_funds_alert);
}

export async function saveFundsSettings(orgId: string, input: unknown): Promise<FundsSettings> {
  const settings = cleanFundsSettings({ ...(await fundsSettingsFor(orgId)), ...(input && typeof input === "object" ? input : {}) });
  const { error } = await supabase.from("organizations").update({ ad_funds_alert: settings }).eq("id", orgId);
  if (error) throw error;
  return settings;
}

type Target = { orgId: string; branchId: string; account: string; name: string; currency: string; token: string };

/** Switched-on Meta ad accounts with their connection's token (same list Ad Spend reads). */
async function targets(orgId?: string): Promise<Target[]> {
  let accounts = supabase.from("tracking_meta_ad_accounts").select("org_id, branch_id, connection_id, account_id, name, currency").eq("active", true);
  let connections = supabase.from("tracking_meta_connections").select("id, access_token").not("access_token", "is", null);
  if (orgId) { accounts = accounts.eq("org_id", orgId); connections = connections.eq("org_id", orgId); }
  const [a, c] = await Promise.all([accounts, connections]);
  if (a.error) throw a.error;
  if (c.error) throw c.error;
  const tokenOf = new Map(((c.data ?? []) as any[]).map((row) => [String(row.id), String(row.access_token)]));
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const row of (a.data ?? []) as any[]) {
    const token = tokenOf.get(String(row.connection_id));
    const key = `${row.org_id}|${row.account_id}`;
    if (!token || seen.has(key)) continue;
    seen.add(key);
    out.push({ orgId: row.org_id, branchId: row.branch_id, account: String(row.account_id), name: row.name || `act_${row.account_id}`, currency: String(row.currency || "NGN"), token });
  }
  return out;
}

const WORDS: Record<LowReason, (name: string, left: number | null, threshold: number) => { title: string; body: string }> = {
  low: (name, left, threshold) => ({
    title: `Low ad funds: ${name} has ${naira(left ?? 0)} left`,
    body: `Below your ${naira(threshold)} level. Add funds in Meta Ads Manager before the ads stop.`
  }),
  unpaid: (name) => ({
    title: `Ads stopped: ${name} has an unpaid bill`,
    body: "Meta could not take payment, so the ads in this account are not running. Pay it in Meta Ads Manager › Billing."
  })
};

/** Read every account, save, and alert. orgId: one org only (the "Check now" button). */
export async function runAdFundsCheck(opts: { orgId?: string; nowMs?: number } = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const list = await targets(opts.orgId);
  const settingsByOrg = new Map<string, FundsSettings>();
  let checked = 0, alerted = 0;
  for (const target of list) {
    try {
      if (!settingsByOrg.has(target.orgId)) settingsByOrg.set(target.orgId, await fundsSettingsFor(target.orgId));
      const settings = settingsByOrg.get(target.orgId)!;
      const { data: before } = await supabase.from("tracking_ad_account_funds").select("low_since, last_alert_at")
        .eq("org_id", target.orgId).eq("ad_account_id", target.account).maybeSingle();
      const result = await adAccountFunds(target.account, target.token);
      if (!result.ok) {
        // Never guessed: a failed read keeps the last numbers and sends nothing.
        await supabase.from("tracking_ad_account_funds").upsert({
          org_id: target.orgId, branch_id: target.branchId, ad_account_id: target.account, name: target.name, currency: target.currency,
          error: humanMetaError(result.message, null).title.slice(0, 300), error_at: nowIso
        }, { onConflict: "org_id,ad_account_id" });
        continue;
      }
      checked += 1;
      const raw = result.data;
      const currency = String(raw.currency || target.currency);
      const { left, source } = fundsLeft({ ...raw, currency });
      const status = typeof raw.account_status === "number" ? raw.account_status : null;
      const reason = lowReason({ left, currency, accountStatus: status, threshold: settings.threshold });
      const due = settings.enabled ? alertDue({ low: Boolean(reason), lowSince: (before as any)?.low_since ?? null, lastAlertAt: (before as any)?.last_alert_at ?? null, nowMs }) : null;
      const row = {
        org_id: target.orgId, branch_id: target.branchId, ad_account_id: target.account, name: raw.name || target.name, currency,
        is_prepay: raw.is_prepay_account ?? null, account_status: status, disable_reason: raw.disable_reason ?? null,
        balance_minor: raw.balance ?? null, amount_spent_minor: raw.amount_spent ?? null, spend_cap_minor: raw.spend_cap ?? null,
        funding_type: raw.funding_source_details?.type ?? null, funding_display: raw.funding_source_details?.display_string ?? null,
        funds_left: left, funds_source: source, low_reason: reason, checked_at: nowIso, error: null, error_at: null,
        low_since: reason ? ((before as any)?.low_since ?? nowIso) : null,
        // Marked alerted only once the alert is saved (below): a refused alert is tried again next run.
        last_alert_at: reason ? (before as any)?.last_alert_at ?? null : null
      };
      const save = await supabase.from("tracking_ad_account_funds").upsert(row, { onConflict: "org_id,ad_account_id" });
      if (save.error) throw save.error;
      if (due && reason) {
        await sendFundsAlert(target, row.name, reason, left, settings.threshold, due);
        const mark = await supabase.from("tracking_ad_account_funds").update({ last_alert_at: nowIso }).eq("org_id", target.orgId).eq("ad_account_id", target.account);
        if (mark.error) throw mark.error;
        alerted += 1;
      }
    } catch (error: any) {
      logger.warn("ad funds check failed", { orgId: target.orgId, account: target.account, error: error?.message ?? String(error) });
    }
  }
  return { accounts: list.length, checked, alerted };
}

async function sendFundsAlert(target: Target, name: string, reason: LowReason, left: number | null, threshold: number, due: "first" | "remind") {
  const routed = await alertRecipients(target.orgId, FUNDS_ALERT_TYPE);
  // Money in the words: only roles that may see ad spend, whatever routing says.
  const recipients = [...routed.recipients].filter(([, role]) => alertSeesAdSpend(role)).map(([id]) => id);
  if (recipients.length === 0) return;
  const words = WORDS[reason](name, left, threshold);
  const title = due === "remind" ? `Reminder: ${words.title}` : words.title;
  const insert = await supabase.from("system_notifications").insert(recipients.map((recipientId) => ({
    org_id: target.orgId, branch_id: target.branchId, recipient_id: recipientId, type: FUNDS_ALERT_TYPE, read: false, link: LINK, title, message: words.body
  })));
  if (insert.error) throw insert.error;
  if (!routed.push) return;
  const branding = await getOrgPushBranding(target.orgId);
  await Promise.all(recipients.map((recipientId) => sendPushToUser(target.orgId, recipientId, {
    title, body: words.body, url: LINK, tag: `ad-funds-${target.account}-${Date.now()}`, kind: FUNDS_ALERT_TYPE, brandName: branding.brandName, brandLogo: branding.brandLogo
  }).catch((err) => logger.warn("ad funds push failed", { orgId: target.orgId, error: String(err) }))));
}

/** The Ad Spend panel: settings and every account's last reading. */
export async function adFundsView(orgId: string) {
  const [settings, rows] = await Promise.all([
    fundsSettingsFor(orgId),
    supabase.from("tracking_ad_account_funds").select("ad_account_id, name, currency, funds_left, funds_source, low_reason, account_status, is_prepay, funding_display, checked_at, error, error_at, low_since, last_alert_at").eq("org_id", orgId)
  ]);
  if (rows.error) throw rows.error;
  const active = new Set((await targets(orgId)).map((target) => target.account));
  const accounts = ((rows.data ?? []) as any[]).filter((row) => active.has(String(row.ad_account_id))).map((row) => ({
    accountId: String(row.ad_account_id), name: String(row.name ?? ""), currency: String(row.currency ?? "NGN"),
    fundsLeft: row.funds_left === null ? null : Number(row.funds_left), source: row.funds_source as "prepaid" | "spend_limit" | null,
    lowReason: row.low_reason as LowReason | null, accountStatus: row.account_status, fundingText: row.funding_display ?? null,
    checkedAt: row.checked_at, error: row.error, lowSince: row.low_since, lastAlertAt: row.last_alert_at
  })).sort((a, b) => Number(Boolean(b.lowReason)) - Number(Boolean(a.lowReason)) || (a.fundsLeft ?? Infinity) - (b.fundsLeft ?? Infinity) || a.name.localeCompare(b.name));
  return { settings, accounts, unchecked: [...active].filter((id) => !accounts.some((row) => row.accountId === id)).length };
}
