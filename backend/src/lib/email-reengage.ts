import crypto from "node:crypto";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { fetchAllRowsOrThrow } from "./query-limits.js";
import { marketingSender } from "./mailer.js";
import { CLEANED_REASON, DAY, REENGAGE, checkDesign, isQuiet, reengageAction, type Activity, type CheckRound, type CheckStep } from "./email-reengage-rules.js";

/**
 * Engaged-first sending + the "Still want our emails?" check (rules and the
 * why: email-reengage-rules.ts). The two check emails are ordinary campaigns
 * (status "active", options.system = reengage1 / reengage2), so they go out
 * through the normal queue: tracking, daily limit, send hours, unsubscribe.
 */

type SystemKey = CheckStep;
const SYSTEM_KEYS: SystemKey[] = ["reengage1", "reengage2"];
const ms = (value: string | null | undefined) => (value ? Date.parse(value) : null);
const newToken = () => crypto.randomBytes(18).toString("base64url");

/** The branch's two check campaigns, made the first time they're needed. */
async function checkCampaigns(orgId: string, branchId: string, brand: string) {
  const { data } = await supabase.from("email_campaigns").select("id, status, options").eq("branch_id", branchId).in("options->>system", SYSTEM_KEYS);
  const found = new Map<SystemKey, string>();
  for (const row of data ?? []) found.set((row.options as any).system, row.id);
  const { campaignLinks } = await import("./email-marketing.js");
  for (const key of SYSTEM_KEYS) {
    if (found.has(key)) continue;
    const { subject, preheader, design } = checkDesign(key, brand);
    const slug = `still-want-our-emails-${key === "reengage1" ? 1 : 2}-${crypto.randomBytes(3).toString("hex")}`;
    const options = { utm: true, track: true, abTest: false, replyTo: "", plainText: false, system: key, resendNonOpeners: false, sendWindow: { on: true, from: 9, to: 19, days: [1, 2, 3, 4, 5, 6] } };
    const { data: made, error } = await supabase.from("email_campaigns").insert({
      org_id: orgId, branch_id: branchId,
      name: `Still want our emails? · Email ${key === "reengage1" ? "1" : "2 (last check)"}`,
      goal: "announcement", subject, preheader, design, offer_type: "custom", audience: { source: "all" }, delivery: { type: "step" },
      options, status: "active", slug, links: campaignLinks({ slug, options }, design), launched_at: new Date().toISOString()
    }).select("id").single();
    if (error) throw new Error(error.message);
    found.set(key, made.id);
  }
  return found as Map<SystemKey, string>;
}

/** Contacts that broadcasts skip: quiet, or already being asked. Keyed by contact id. */
export async function quietContactIds(branchId: string, nowMs: number): Promise<Set<string>> {
  const since = new Date(nowMs - REENGAGE.windowDays * DAY).toISOString();
  const [contacts, sends, system] = await Promise.all([
    fetchAllRowsOrThrow<any>(() => supabase.from("email_contacts").select("id, last_opened_at, last_clicked_at").eq("branch_id", branchId).eq("status", "subscribed")),
    fetchAllRowsOrThrow<any>(() => supabase.from("email_campaign_sends").select("contact_id, campaign_id").eq("branch_id", branchId).eq("status", "sent").gte("sent_at", since).not("contact_id", "is", null)),
    supabase.from("email_campaigns").select("id").eq("branch_id", branchId).in("options->>system", SYSTEM_KEYS)
  ]);
  const checkIds = new Set((system.data ?? []).map((row) => row.id));
  const count = new Map<string, number>();
  for (const send of sends) if (!checkIds.has(send.campaign_id)) count.set(send.contact_id, (count.get(send.contact_id) ?? 0) + 1);
  const quiet = new Set<string>();
  for (const contact of contacts) {
    const activity: Activity = { lastOpenedMs: ms(contact.last_opened_at), lastClickedMs: ms(contact.last_clicked_at) };
    if (isQuiet(activity, count.get(contact.id) ?? 0, nowMs)) quiet.add(contact.id);
  }
  return quiet;
}

/** One branch: queue check emails, stop the ones who never answered, bring back cleaned buyers. */
async function reengageBranch(orgId: string, branchId: string, nowMs: number) {
  const sender = await marketingSender(orgId, branchId);
  if (!sender.ready) return { send1: 0, send2: 0, stopped: 0, back: 0 };
  const campaigns = await checkCampaigns(orgId, branchId, sender.fromName || "Protohub");
  const quiet = await quietContactIds(branchId, nowMs);
  const [contacts, checks] = await Promise.all([
    fetchAllRowsOrThrow<any>(() => supabase.from("email_contacts").select("id, email, name, phone, last_opened_at, last_clicked_at").eq("branch_id", branchId).eq("status", "subscribed")),
    fetchAllRowsOrThrow<any>(() => supabase.from("email_campaign_sends").select("contact_id, campaign_id, run_no, status, sent_at").in("campaign_id", [...campaigns.values()]).in("status", ["queued", "sent"]))
  ]);
  // Each contact's latest round of the check.
  const rounds = new Map<string, CheckRound>();
  for (const row of checks) {
    if (!row.contact_id) continue;
    const current = rounds.get(row.contact_id);
    if (current && current.round > row.run_no) continue;
    const r: CheckRound = current && current.round === row.run_no ? current : { round: row.run_no, email1Ms: null, email2Ms: null, email1Waiting: false, email2Waiting: false };
    const first = row.campaign_id === campaigns.get("reengage1");
    if (row.status === "queued") { if (first) r.email1Waiting = true; else r.email2Waiting = true; }
    else if (first) r.email1Ms = ms(row.sent_at); else r.email2Ms = ms(row.sent_at);
    rounds.set(row.contact_id, r);
  }
  const queue: any[] = [];
  const stop: string[] = [];
  let send1 = 0, send2 = 0;
  for (const contact of contacts) {
    const activity: Activity = { lastOpenedMs: ms(contact.last_opened_at), lastClickedMs: ms(contact.last_clicked_at) };
    const check = rounds.get(contact.id) ?? null;
    const action = reengageAction(activity, quiet.has(contact.id), check, nowMs);
    if (action === "none") continue;
    if (action === "stop") { stop.push(contact.id); continue; }
    const key: SystemKey = action === "send1" ? "reengage1" : "reengage2";
    const runNo = action === "send1" ? (check?.round ?? 0) + 1 : check!.round;
    if (action === "send1") send1 += 1; else send2 += 1;
    queue.push({
      org_id: orgId, branch_id: branchId, campaign_id: campaigns.get(key), run_no: runNo, kind: "main",
      contact_id: contact.id, email: contact.email, name: contact.name || "", phone: contact.phone, variant: "a", token: newToken()
    });
  }
  for (let i = 0; i < queue.length; i += 500) {
    const { error } = await supabase.from("email_campaign_sends").upsert(queue.slice(i, i + 500), { onConflict: "campaign_id,run_no,kind,email", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const at = new Date(nowMs).toISOString();
  for (let i = 0; i < stop.length; i += 200) {
    const { error } = await supabase.from("email_contacts").update({ status: "cleaned", status_changed_at: at, status_reason: CLEANED_REASON, updated_at: at })
      .in("id", stop.slice(i, i + 200)).eq("status", "subscribed");
    if (error) throw new Error(error.message);
  }
  // Cleaned by this check, then ordered again: a real customer, back on the list.
  const cleaned = await fetchAllRowsOrThrow<any>(() => supabase.from("email_contacts").select("id, email, status_changed_at").eq("branch_id", branchId).eq("status", "cleaned").eq("status_reason", CLEANED_REASON));
  let back = 0;
  if (cleaned.length) {
    const oldest = cleaned.reduce((min, row) => (row.status_changed_at < min ? row.status_changed_at : min), cleaned[0].status_changed_at);
    const orders = await fetchAllRowsOrThrow<any>(() => supabase.from("orders").select("email, created_at").eq("branch_id", branchId).gte("created_at", oldest).not("email", "is", null));
    const latest = new Map<string, string>();
    for (const order of orders) {
      const email = String(order.email).trim().toLowerCase();
      if (!latest.has(email) || order.created_at > latest.get(email)!) latest.set(email, order.created_at);
    }
    const ids = cleaned.filter((row) => (latest.get(row.email) ?? "") > row.status_changed_at).map((row) => row.id);
    if (ids.length) {
      await supabase.from("email_contacts").update({ status: "subscribed", status_changed_at: at, status_reason: "Ordered again after the 'Still want our emails?' check", updated_at: at }).in("id", ids).eq("status", "cleaned");
      back = ids.length;
    }
  }
  return { send1, send2, stopped: stop.length, back };
}

let lastRunMs = 0;
/** Hourly, from the email marketing job. */
export async function runReengage(nowMs: number) {
  if (nowMs - lastRunMs < 60 * 60_000) return;
  lastRunMs = nowMs;
  const { data } = await supabase.from("email_marketing_settings").select("org_id, branch_id");
  for (const row of data ?? []) {
    try {
      const result = await reengageBranch(row.org_id, row.branch_id, nowMs);
      if (result.send1 || result.send2 || result.stopped || result.back) logger.info("email still-want check", { branchId: row.branch_id, ...result });
    } catch (error) {
      logger.warn("email still-want check failed", { branchId: row.branch_id, error: (error as Error).message });
    }
  }
}
