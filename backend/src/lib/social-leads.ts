import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { alertRecipients } from "./notification-routing.js";
import { alertSeesCustomer } from "./alert-privacy.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUser } from "./push.js";
import { assignmentRulesForBranch, eligibleReps, isAssignmentWindowOpen, nextRepInLine, type AssignmentRules, type EligibleRep } from "./cart-assignment.js";
import * as manychat from "./manychat.js";
import {
  CONTACTABLE, OPEN_STATUSES, cleanPrefs, cleanSla, dedupeKey, exceptionFor, hotByKeywords, hoursWithDays, slaFor, slaRuleFor, type Prefs, leadScore, matchProduct, messagingWindow, parseInbound, phoneInText, showsBuyingIntent,
  slaStage, stageRank, statusAfterCustomerMessage, strongIntent, workingMsBetween, type Inbound, type LeadStatus, type SlaSettings
} from "./social-leads-rules.js";

// Social Leads Inbox (Bright, 12 Nov 2026). ManyChat posts every comment and
// customer message to /api/public/social-leads/manychat/<secret>; a lead is
// one ManyChat contact, handed to a call rep with the abandoned-cart rules
// (turn order, working hours, paused reps out) and kept with that rep
// ("sticky"). Reps reply through the ManyChat API. Rules: social-leads-rules.ts.

/** Start the Protohub automations for this event (Create Automation builder, 13 Nov 2026). Never throws. */
async function fire(key: "new_message" | "new_lead" | "tag_added" | "order_update" | "assigned", lead: any, ctx: Record<string, unknown> = {}) {
  try { const m = await import("./social-lead-automations.js"); await m.fireTrigger(key, lead, ctx as any); } catch { /* logged inside */ }
}
/** Send through the switched-on channel (Direct Meta or ManyChat): meta-direct.ts. */
async function deliver(settings: SettingsRow, lead: any, messages: manychat.OutMessage[], opts: { humanAgent?: boolean; allowPrivateReply?: boolean } = {}) {
  const m = await import("./meta-direct.js");
  return m.deliver(settings, lead, messages, opts);
}
async function directOn(settings: SettingsRow) {
  const m = await import("./meta-direct.js");
  return m.directActive(settings.org_id, settings.branch_id);
}
const reload = async (id: string) => (await supabase.from("social_leads").select("*").eq("id", id).maybeSingle()).data as any;

export class SocialLeadError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const LINK = "/dashboard/admin/social-leads-inbox";
const leadLink = (id: string) => `${LINK}?lead=${encodeURIComponent(id)}`;

// ── Settings ───────────────────────────────────────────────────────────────

export type SettingsRow = {
  org_id: string; branch_id: string; manychat_api_key: string | null; manychat_page_name: string | null; manychat_page_id: string | null;
  connected_at: string | null; connection_error: string | null; webhook_secret: string; facebook_connected: boolean; instagram_connected: boolean;
  auto_assign: boolean; telegram_alerts: boolean; sla: unknown; max_open_per_rep: number; last_event_at: string | null; updated_at: string;
  prefs: unknown;
};

/** The branch's hand-out hours (cart rules) with Settings' working days. */
export type BranchHours = AssignmentRules & { workingDays?: number[]; exceptions?: Prefs["exceptions"] };
export async function hoursFor(settings: SettingsRow): Promise<{ rules: BranchHours; prefs: Prefs }> {
  const cart = await assignmentRulesForBranch(settings.branch_id);
  const prefs = cleanPrefs(settings.prefs);
  // Settings › Working Hours sets the inbox's own hours (they start equal to cart hand-out's).
  const base = prefs.hoursEnabled ? { ...cart, workStartMinute: prefs.startMinute, workEndMinute: prefs.endMinute } : cart;
  return { rules: { ...base, ...hoursWithDays(base, prefs.workingDays), exceptions: prefs.exceptions }, prefs };
}

/** Is someone working right now (hours, Settings' days, holidays and special days)? */
export function openNow(rules: BranchHours, now = new Date()) {
  const lagos = new Date(now.getTime() + 3_600_000);
  const special = rules.exceptions ? exceptionFor({ exceptions: rules.exceptions }, lagos.toISOString().slice(0, 10)) : null;
  if (special) {
    if (special.closed) return false;
    const minute = lagos.getUTCHours() * 60 + lagos.getUTCMinutes();
    return minute >= special.start && minute < special.end;
  }
  if (!isAssignmentWindowOpen({ ...rules, enabled: true, worksSunday: true }, now)) return false;
  const dow = lagos.getUTCDay();
  return rules.workingDays ? rules.workingDays.includes(dow) : dow !== 0 || rules.worksSunday;
}

export async function settingsFor(orgId: string, branchId: string): Promise<SettingsRow> {
  const { data, error } = await supabase.from("social_lead_settings").select("*").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
  if (error) throw error;
  if (data) return data as SettingsRow;
  const created = await supabase.from("social_lead_settings").insert({ org_id: orgId, branch_id: branchId }).select("*").single();
  if (created.error) {
    // Two screens opening at once: the other one made it.
    const again = await supabase.from("social_lead_settings").select("*").eq("org_id", orgId).eq("branch_id", branchId).single();
    if (again.error) throw again.error;
    return again.data as SettingsRow;
  }
  return created.data as SettingsRow;
}

export async function settingsBySecret(secret: string): Promise<SettingsRow | null> {
  if (!/^[a-f0-9]{32,80}$/.test(secret)) return null;
  const { data, error } = await supabase.from("social_lead_settings").select("*").eq("webhook_secret", secret).maybeSingle();
  if (error) throw error;
  return (data as SettingsRow) ?? null;
}

export async function logEvent(orgId: string, branchId: string | null, kind: string, ok: boolean, detail: Record<string, unknown>) {
  await supabase.from("social_lead_events").insert({ org_id: orgId, branch_id: branchId, kind, ok, detail }).then(() => undefined, () => undefined);
}

// ── Inbound from ManyChat ──────────────────────────────────────────────────

async function branchProducts(orgId: string, branchId: string) {
  const { data } = await supabase.from("products").select("id, name").eq("org_id", orgId).eq("branch_id", branchId).eq("active", true);
  return ((data ?? []) as Array<{ id: string; name: string }>);
}

/**
 * One event from ManyChat. Returns what happened, for the log and for
 * ManyChat (it shows the response in the External Request test).
 */
export async function receiveManychat(secret: string, body: unknown, query: Record<string, unknown>, nowMs = Date.now()) {
  const settings = await settingsBySecret(secret);
  if (!settings) throw new SocialLeadError(404, "Unknown address. Copy it again from Social Leads Inbox › Settings.");
  // Settings › Advanced › Test Webhook: proves the address works; nothing is saved but the log line.
  if (query.event === "test") { await logEvent(settings.org_id, settings.branch_id, "test", true, { by: "Test Webhook" }); return { ok: true, test: true }; }
  const inbound = parseInbound(body, query);
  if ("error" in inbound) {
    await logEvent(settings.org_id, settings.branch_id, "inbound", false, { error: inbound.error });
    throw new SocialLeadError(400, inbound.error);
  }
  // Direct Meta is the live channel: ManyChat's copy of the same event would make a second lead.
  const { data: direct } = await supabase.from("social_lead_meta").select("active").eq("org_id", settings.org_id).eq("branch_id", settings.branch_id).maybeSingle();
  if ((direct as any)?.active) {
    await logEvent(settings.org_id, settings.branch_id, `inbound.${inbound.event}`, true, { skipped: "Direct Meta is on: ManyChat events are not used." });
    return { ok: true, skipped: "Direct Meta is on in Protohub (Settings › Direct Meta). Turn it off to use ManyChat." };
  }
  const flow = typeof query.flow === "string" ? query.flow.trim().slice(0, 80) : "";
  // ManyChat sees only the outcome, never the lead record.
  const { leadRow: _row, ...outcome } = await receiveInbound(settings, inbound, flow, nowMs);
  return outcome;
}

/** One customer event from ManyChat or Direct Meta: lead, message, hand-out, automations. */
export async function receiveInbound(settings: SettingsRow, inbound: Inbound, flow: string, nowMs = Date.now()): Promise<{ ok: true; lead?: string; created?: boolean; duplicate?: boolean; skipped?: string; leadRow?: any }> {
  // Meta repeats deliveries: an event already saved changes nothing (checked before any lead is made).
  if (inbound.eventId) {
    const { data: seen } = await supabase.from("social_lead_messages").select("id").eq("org_id", settings.org_id).eq("dedupe_key", dedupeKey(inbound)).limit(1).maybeSingle();
    if (seen) return { ok: true, duplicate: true };
  }
  const nowIso = new Date(nowMs).toISOString();
  const prefs = cleanPrefs(settings.prefs);
  let flowPaused = false;
  if (flow) {
    await trackFlow(settings, flow, inbound.event);
    const { data: auto } = await supabase.from("social_lead_automations").select("status").eq("org_id", settings.org_id).eq("branch_id", settings.branch_id).eq("flow_key", slug(flow)).maybeSingle();
    flowPaused = (auto as any)?.status === "paused";
  }
  const skip = !prefs.autoCreate ? "Creating leads is off (Settings)."
    : flowPaused ? `The "${flow}" automation is paused in Protohub.`
    : inbound.event === "comment" && inbound.platform === "instagram" && !prefs.captureInstagramComments ? "Instagram comments are not captured (Settings)."
      : inbound.event === "comment" && inbound.platform !== "instagram" && !prefs.captureFacebookComments ? "Facebook comments are not captured (Settings)."
        : inbound.event === "message" && inbound.platform !== "instagram" && !prefs.captureMessenger ? "Messenger messages are not captured (Settings)." : "";
  if (skip) {
    const { data: known } = await supabase.from("social_leads").select("id").eq("org_id", settings.org_id).eq("manychat_contact_id", inbound.contactId).maybeSingle();
    // An existing conversation always continues; only NEW leads are skipped.
    if (!known) { await logEvent(settings.org_id, settings.branch_id, `inbound.${inbound.event}`, true, { skipped: skip, flow: flow || undefined }); return { ok: true, skipped: skip }; }
  }
  await supabase.from("social_lead_settings").update({
    last_event_at: nowIso,
    ...(inbound.platform === "instagram" ? { instagram_connected: true } : { facebook_connected: true })
  }).eq("org_id", settings.org_id).eq("branch_id", settings.branch_id);

  const { lead, created } = await upsertLead(settings, inbound, nowIso);
  const key = dedupeKey(inbound);
  const direction = inbound.event === "bot" ? "bot" : "in";
  const kind = inbound.event === "comment" ? "comment" : "text";
  const body_ = inbound.event === "comment" ? (inbound.comment ?? inbound.text) : inbound.text;
  let duplicate = false;
  if (body_ || inbound.event === "lead") {
    const insert = await supabase.from("social_lead_messages").insert({
      org_id: settings.org_id, branch_id: settings.branch_id, lead_id: lead.id, direction, kind,
      body: body_ || (inbound.event === "lead" ? "Sent their details" : ""), dedupe_key: key,
      payload: { event: inbound.event, product: inbound.product, campaign: inbound.campaign, adName: inbound.adName }
    });
    // 23505 = the same event again: keep the first, change nothing else.
    if (insert.error) { if ((insert.error as any).code === "23505") duplicate = true; else throw insert.error; }
  }
  if (duplicate) return { ok: true, lead: lead.ref, duplicate: true };
  if (inbound.commentId) {
    // Direct Meta: the newest unanswered comment can get one private reply (7 days).
    await supabase.from("social_leads").update({ pending_comment_id: inbound.commentId, pending_comment_at: nowIso }).eq("id", lead.id);
    lead.pending_comment_id = inbound.commentId; lead.pending_comment_at = nowIso;
  }

  if (direction === "in") await afterCustomerMessage(settings, lead, inbound, nowIso, created);
  if (created) { const fresh = await reload(lead.id); if (fresh) await fire("new_lead", fresh, { message: body_ }); }
  else if (body_) {
    await supabase.from("social_leads").update({ last_message_preview: body_.slice(0, 200), last_message_at: nowIso, status: lead.status === "comment_captured" ? "dm_sent" : lead.status, updated_at: nowIso }).eq("id", lead.id);
  }
  await logEvent(settings.org_id, settings.branch_id, `inbound.${inbound.event}`, true, { lead: lead.ref, leadId: lead.id, name: lead.name, platform: inbound.platform, created, flow: flow || undefined });
  return { ok: true, lead: lead.ref, created, leadRow: lead };
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "flow";
/** A flow named in the request address (?flow=...) shows on Automations with its numbers. */
async function trackFlow(settings: SettingsRow, name: string, event: Inbound["event"]) {
  const trigger = event === "comment" ? "comment" : event === "bot" ? "after_reply" : "keyword";
  await supabase.from("social_lead_automations").upsert({ org_id: settings.org_id, branch_id: settings.branch_id, flow_key: slug(name), name, trigger }, { onConflict: "org_id,branch_id,flow_key", ignoreDuplicates: true });
}

async function upsertLead(settings: SettingsRow, inbound: Inbound, nowIso: string): Promise<{ lead: any; created: boolean }> {
  let { data: existing, error } = await supabase.from("social_leads").select("*").eq("org_id", settings.org_id).eq("manychat_contact_id", inbound.contactId).maybeSingle();
  if (error) throw error;
  const channel = inbound.channel ?? "manychat";
  if (!existing) {
    // The same person under the other channel's id (ManyChat ⇄ Direct Meta switch): keep that lead and its history.
    const ids = [...new Set(inbound.aliases ?? [])].filter((x) => x && x !== inbound.contactId);
    let other: any = null;
    if (ids.length) other = (await supabase.from("social_leads").select("*").eq("org_id", settings.org_id).in("manychat_contact_id", ids).order("last_message_at", { ascending: false }).limit(1).maybeSingle()).data;
    if (!other) other = (await supabase.from("social_leads").select("*").eq("org_id", settings.org_id).eq("meta_alt_id", inbound.contactId).limit(1).maybeSingle()).data;
    if (!other && inbound.igId) other = (await supabase.from("social_leads").select("*").eq("org_id", settings.org_id).eq("ig_id", inbound.igId).order("last_message_at", { ascending: false }).limit(1).maybeSingle()).data;
    if (other) {
      const moved = await supabase.from("social_leads").update({ manychat_contact_id: inbound.contactId, channel, ...(inbound.metaPageId ? { meta_page_id: inbound.metaPageId } : {}) }).eq("id", other.id).select("*").single();
      existing = moved.data ?? other;
    }
  }
  // Settings › Advanced › Lead Deduplication by phone: the same number on another account is the same customer.
  const dprefs = cleanPrefs(settings.prefs);
  const last10 = String(inbound.phone ?? "").replace(/\D/g, "").slice(-10);
  if (!existing && dprefs.dedupeBy === "phone" && dprefs.mergeDuplicates && last10.length === 10) {
    const { data: byPhone } = await supabase.from("social_leads").select("*").eq("org_id", settings.org_id).eq("branch_id", settings.branch_id).ilike("phone", `%${last10}`).order("last_message_at", { ascending: false }).limit(1).maybeSingle();
    if (byPhone) {
      // Keep the most recent conversation: reply through the account the customer is using now.
      const moved = await supabase.from("social_leads").update({ manychat_contact_id: inbound.contactId, platform: inbound.platform }).eq("id", (byPhone as any).id).select("*").single();
      existing = moved.data ?? byPhone;
    }
  }
  const products = inbound.product || !existing?.product_id ? await branchProducts(settings.org_id, settings.branch_id) : [];
  const product = matchProduct(inbound.product, products) ?? (existing?.product_id ? null : matchProduct(inbound.comment ?? inbound.text, products));
  const patch: Record<string, unknown> = {
    // Never swap a full name for a shorter one (a later message may carry only the first name).
    name: !existing?.name || existing.name === "Facebook user" || (inbound.name !== "Facebook user" && inbound.name.split(/\s+/).length > existing.name.split(/\s+/).length) ? inbound.name : existing.name,
    profile_pic: inbound.profilePic ?? existing?.profile_pic ?? null,
    instagram_username: inbound.instagramUsername ?? existing?.instagram_username ?? null,
    phone: existing?.phone || inbound.phone || null,
    whatsapp: existing?.whatsapp || inbound.whatsapp || null,
    email: existing?.email || inbound.email || null,
    state: existing?.state || inbound.state || null,
    manychat_inbox_url: inbound.liveChatUrl ?? existing?.manychat_inbox_url ?? null,
    ig_id: inbound.igId ?? existing?.ig_id ?? null,
    updated_at: nowIso
  };
  if (existing && existing.channel !== "manual" && existing.channel !== channel) patch.channel = channel;
  if (inbound.metaPageId) patch.meta_page_id = inbound.metaPageId;
  if (product && !existing?.product_id) { patch.product_id = product.id; patch.product_interest = product.name; }
  else if (inbound.product && !existing?.product_interest) patch.product_interest = inbound.product;
  if (inbound.campaign && !existing?.campaign_name) { patch.campaign_name = inbound.campaign; patch.source_label = `${inbound.platform === "instagram" ? "Instagram" : "Facebook"} Ad (${inbound.campaign})`; }
  if (inbound.adId && !existing?.ad_id) patch.ad_id = inbound.adId;
  if (inbound.adName && !existing?.ad_name) patch.ad_name = inbound.adName;
  if (inbound.comment && !existing?.original_comment) patch.original_comment = inbound.comment;
  if (existing) {
    const { data, error: updateError } = await supabase.from("social_leads").update(patch).eq("id", existing.id).select("*").single();
    if (updateError) throw updateError;
    return { lead: data, created: false };
  }
  const insert = await supabase.from("social_leads").insert({
    ...patch, org_id: settings.org_id, branch_id: settings.branch_id, manychat_contact_id: inbound.contactId, channel,
    // A Facebook customer who only wrote in Messenger (no ad comment) is a Messenger lead.
    platform: inbound.platform === "facebook" && inbound.event !== "comment" ? "messenger" : inbound.platform,
    status: inbound.event === "comment" ? "comment_captured" : inbound.event === "bot" ? "dm_sent" : "new",
    source_label: patch.source_label ?? (inbound.event === "comment" ? `${inbound.platform === "instagram" ? "Instagram" : "Facebook"} comment` : `${inbound.platform === "instagram" ? "Instagram" : "Facebook"} message`)
  }).select("*").single();
  if (insert.error) {
    if ((insert.error as any).code === "23505") return upsertLead(settings, inbound, nowIso); // the same contact arrived twice at once
    throw insert.error;
  }
  return { lead: insert.data, created: true };
}

async function afterCustomerMessage(settings: SettingsRow, lead: any, inbound: Inbound, nowIso: string, created: boolean) {
  const text = inbound.event === "comment" ? (inbound.comment ?? "") : inbound.text;
  const phone = phoneInText(text);
  const prefs = cleanPrefs(settings.prefs);
  const strong = strongIntent(text) || hotByKeywords(text, prefs.hotKeywords);
  const nextStatus = statusAfterCustomerMessage(lead.status as LeadStatus, { phoneFound: Boolean(phone && !lead.phone), strong, event: inbound.event });
  const realMessage = inbound.event !== "comment";
  const patch: Record<string, unknown> = {
    status: nextStatus,
    hot: lead.hot || strong || nextStatus === "hot",
    last_message_preview: text.slice(0, 200), last_message_at: nowIso, updated_at: nowIso
  };
  if (phone && !lead.phone) patch.phone = phone;
  if (realMessage) {
    patch.last_customer_message_at = nowIso;
    patch.first_customer_message_at = lead.first_customer_message_at ?? nowIso;
    patch.unread_count = (lead.unread_count ?? 0) + 1;
    // The response clock starts at the first unanswered message, not the latest.
    patch.awaiting_reply_since = lead.awaiting_reply_since ?? nowIso;
    if (!lead.awaiting_reply_since) patch.sla_stage = "ok";
  }
  const { data: messages } = await supabase.from("social_lead_messages").select("body").eq("lead_id", lead.id).eq("direction", "in").order("created_at", { ascending: false }).limit(30);
  patch.lead_score = leadScore({
    engaged: realMessage || CONTACTABLE.includes(lead.status), phone: Boolean(patch.phone ?? lead.phone), state: Boolean(lead.state),
    product: Boolean(lead.product_id || lead.product_interest), hot: Boolean(patch.hot), customerMessages: ((messages ?? []) as any[]).map((m) => String(m.body))
  });
  const { data: updated, error } = await supabase.from("social_leads").update(patch).eq("id", lead.id).select("*").single();
  if (error) throw error;

  // Only someone who wrote to the page can be messaged (a comment alone does not open the chat).
  if (!realMessage) return;
  await offHoursReply(settings, updated, prefs);
  if (updated.assigned_to && !prefs.sticky && (lead.status === "lost" || lead.status === "delivered")) {
    // Sticky off (Settings): a customer who comes back after a closed sale goes to the next rep in turn.
    await supabase.from("social_leads").update({ assigned_to: null }).eq("id", updated.id);
    updated.assigned_to = null;
  }
  if (!updated.assigned_to && settings.auto_assign) await assignLead(settings, updated, "auto");
  else if (updated.assigned_to) await notifyRep(settings.org_id, updated, created ? "new" : "reply", text);
  const afterAll = await reload(lead.id);
  if (afterAll) await fire("new_message", afterAll, { message: text, firstMessage: !lead.first_customer_message_at });
}

/** Settings › Working Hours › After-Hours: one automatic reply per quiet spell (12 hours). */
async function offHoursReply(settings: SettingsRow, lead: any, prefs: Prefs) {
  if (!prefs.offHoursReply || prefs.pauseAllAutomations || !prefs.offHoursMessage.trim()) return;
  if (lead.off_hours_reply_at && Date.now() - Date.parse(lead.off_hours_reply_at) < 12 * 3_600_000) return;
  const { rules } = await hoursFor(settings);
  if (openNow(rules)) return;
  const sent = await deliver(settings, lead, [{ type: "text", text: prefs.offHoursMessage }]);
  const nowIso = new Date().toISOString();
  await supabase.from("social_leads").update({ off_hours_reply_at: nowIso }).eq("id", lead.id);
  await supabase.from("social_lead_messages").insert({ org_id: lead.org_id, branch_id: lead.branch_id, lead_id: lead.id, direction: "bot", kind: "text", body: prefs.offHoursMessage, sender_name: "After-hours reply", status: sent.ok ? "ok" : "failed", error: sent.ok ? null : sent.message });
}

// ── Assignment (cart hand-out rules, sticky) ───────────────────────────────

async function repsWithSocialTurns(orgId: string, branchId: string): Promise<Array<EligibleRep & { openLeads: number }>> {
  const reps = await eligibleReps(orgId, branchId);
  if (reps.length === 0) return [];
  const { data } = await supabase.from("social_leads").select("assigned_to, assigned_at, status").eq("org_id", orgId).eq("branch_id", branchId)
    .not("assigned_to", "is", null).order("assigned_at", { ascending: false }).limit(3000);
  const last = new Map<string, string>(), open = new Map<string, number>();
  for (const row of (data ?? []) as any[]) {
    if (row.assigned_at && !last.has(row.assigned_to)) last.set(row.assigned_to, row.assigned_at);
    if (OPEN_STATUSES.includes(row.status)) open.set(row.assigned_to, (open.get(row.assigned_to) ?? 0) + 1);
  }
  // Turn order counts SOCIAL turns, so carts and leads each go round fairly.
  return reps.map((rep) => ({ ...rep, lastAssignedAt: last.get(rep.id) ?? null, openLeads: open.get(rep.id) ?? 0 }));
}

/** Hand one lead to the next rep in turn. Outside working hours it waits for opening (the job hands it out then). */
export async function assignLead(settings: SettingsRow, lead: any, by: "auto" | "reassign", exclude: string[] = [], rules?: BranchHours, nowMs = Date.now()) {
  const { rules: hours, prefs } = rules ? { rules, prefs: cleanPrefs(settings.prefs) } : await hoursFor(settings);
  if (prefs.assignInHoursOnly && !openNow(hours, new Date(nowMs))) return null;
  let reps = (await repsWithSocialTurns(settings.org_id, settings.branch_id)).filter((rep) => !exclude.includes(rep.id));
  if (prefs.eligibleRepIds.length) reps = reps.filter((rep) => prefs.eligibleRepIds.includes(rep.id));
  if (settings.max_open_per_rep > 0 && prefs.maxOpenEnabled) reps = reps.filter((rep) => rep.openLeads < settings.max_open_per_rep);
  // "Distribute leads equally by workload" (Settings): fewest open leads first, turn order breaks ties.
  if (prefs.distributeByWorkload && reps.length) { const least = Math.min(...reps.map((r) => r.openLeads)); reps = reps.filter((r) => r.openLeads === least); }
  const rep = nextRepInLine(reps);
  if (!rep) return null;
  const nowIso = new Date(nowMs).toISOString();
  let claim = supabase.from("social_leads")
    .update({ assigned_to: rep.id, assigned_at: nowIso, assigned_by: by, status: lead.status === "comment_captured" || lead.status === "dm_sent" || lead.status === "engaged" ? "new" : lead.status, updated_at: nowIso, sla_stage: lead.awaiting_reply_since ? "ok" : lead.sla_stage })
    .eq("id", lead.id);
  // Auto: only while still unassigned (two runs never both take it). Reassign: only from the same rep.
  claim = by === "auto" ? claim.is("assigned_to", null) : claim.eq("assigned_to", lead.assigned_to);
  const { data: claimed, error } = await claim.select("*").maybeSingle();
  if (error) throw error;
  if (!claimed) return null; // another run took it first
  await systemMessage(claimed, by === "auto" ? `Assigned to ${rep.name} (next in turn).` : `Moved to ${rep.name}: no reply in time.`);
  if (prefs.pauseBotOnAssign && settings.manychat_api_key && !claimed.bot_paused && !(await directOn(settings))) {
    const paused = await manychat.setHumanHandling(settings.manychat_api_key, claimed.manychat_contact_id, true);
    if (paused.ok) await supabase.from("social_leads").update({ bot_paused: true }).eq("id", claimed.id);
  }
  await notifyRep(settings.org_id, claimed, "new", claimed.last_message_preview ?? "");
  await fire("assigned", claimed);
  return rep;
}

export async function systemMessage(lead: { id: string; org_id: string; branch_id: string }, body: string, senderName?: string) {
  await supabase.from("social_lead_messages").insert({ org_id: lead.org_id, branch_id: lead.branch_id, lead_id: lead.id, direction: "system", kind: "event", body, sender_name: senderName ?? null });
}

// ── Alerts ────────────────────────────────────────────────────────────────

type AlertKind = "new" | "reply" | "overdue" | "follow_up" | "renotify";
const TYPE: Record<AlertKind, string> = { new: "social_lead_new", reply: "social_lead_reply", overdue: "social_lead_overdue", follow_up: "social_lead_follow_up", renotify: "social_lead_reply" };

async function notifyRep(orgId: string, lead: any, kind: AlertKind, text: string) {
  await sendLeadAlert(orgId, lead, kind, text, lead.assigned_to);
}

/** In-app alert + phone pop-up (Telegram copies it when switched on). Customer words only to roles that may see customers. */
const EVENT_OF: Record<AlertKind, keyof Prefs["notifyEvents"]> = { new: "newLeads", reply: "newLeads", renotify: "newLeads", overdue: "slaBreaches", follow_up: "followUpReminders" };
export async function sendLeadAlert(orgId: string, lead: any, kind: AlertKind, text: string, repId: string | null, extra = "", extraRoles: string[] = []) {
  try {
    const { data: srow } = await supabase.from("social_lead_settings").select("prefs").eq("org_id", orgId).eq("branch_id", lead.branch_id).maybeSingle();
    const prefs = cleanPrefs((srow as any)?.prefs);
    // Settings › Notifications: an event switched off sends nothing; in-app off leaves only phone pop-ups.
    if (!prefs.notifyEvents[EVENT_OF[kind]] || (!prefs.notifyInApp && !prefs.notifyPush)) return;
    const routed = await alertRecipients(orgId, TYPE[kind] as any, repId);
    if (extraRoles.length) {
      // Escalation target from the SLA rule. "Head of Sales" is the Sales Rep promoted to lead the team.
      const roles = extraRoles.filter((r) => r !== "Head of Sales");
      const { data: byRole } = roles.length ? await supabase.from("users").select("id, role").eq("org_id", orgId).eq("active", true).in("role", roles) : { data: [] as any[] };
      const { data: heads } = extraRoles.includes("Head of Sales") ? await supabase.from("users").select("id, role").eq("org_id", orgId).eq("active", true).eq("is_head_of_sales_rep", true) : { data: [] as any[] };
      for (const u of [...(byRole ?? []), ...(heads ?? [])] as any[]) routed.recipients.set(u.id, u.role);
    }
    if (routed.recipients.size === 0) return;
    if (!prefs.notifyPush) routed.push = false;
    const platform = lead.platform === "instagram" ? "Instagram" : "Facebook";
    const product = lead.product_interest ? ` · ${lead.product_interest}` : "";
    const titles: Record<AlertKind, (who: string) => string> = {
      new: (who) => `New social lead: ${who}${product}`,
      reply: (who) => `${who} replied on ${platform}`,
      renotify: (who) => `${who} is still waiting for your reply`,
      overdue: (who) => `No reply in time: ${who}${extra ? ` (${extra})` : ""}`,
      follow_up: (who) => `Follow up now: ${who}${product}`
    };
    const rows: any[] = [];
    for (const [userId, role] of routed.recipients) {
      const seesCustomer = alertSeesCustomer(role);
      const who = seesCustomer ? (lead.name || "A customer") : "A customer";
      const message = seesCustomer && text ? `“${text.slice(0, 140)}” · ${platform}${product} · ${lead.ref}` : `${platform}${product} · ${lead.ref}`;
      rows.push({ org_id: orgId, branch_id: lead.branch_id, recipient_id: userId, type: TYPE[kind], read: false, link: leadLink(lead.id), title: titles[kind](who), message });
    }
    if (prefs.notifyInApp) {
      const insert = await supabase.from("system_notifications").insert(rows);
      if (insert.error) throw insert.error;
    }
    if (!routed.push) return;
    const branding = await getOrgPushBranding(orgId);
    await Promise.all(rows.map((row) => sendPushToUser(orgId, row.recipient_id, {
      title: row.title, body: row.message, url: row.link, tag: `social-lead-${lead.id}-${kind}`, kind: TYPE[kind], brandName: branding.brandName, brandLogo: branding.brandLogo
    }).catch(() => undefined)));
  } catch (error: any) {
    logger.warn("social lead alert failed", { orgId, lead: lead?.ref, error: error?.message ?? String(error) });
  }
}

// ── The every-minute job ───────────────────────────────────────────────────

/**
 * 1. Hand out waiting leads (opening time catches the overnight ones).
 * 2. Response clock on unanswered customers: nudge the rep, tell managers, hand to another rep.
 * 3. Follow-ups that are due.
 */
export async function runSocialLeadsJob(nowMs = Date.now()) {
  const { data: all, error } = await supabase.from("social_lead_settings").select("*");
  if (error) throw error;
  let assigned = 0, nudged = 0, escalated = 0, moved = 0, followUps = 0;
  for (const settings of (all ?? []) as SettingsRow[]) {
    try {
      const { rules, prefs } = await hoursFor(settings);
      const open = openNow(rules, new Date(nowMs));
      const sla = cleanSla(settings.sla);
      if (open && settings.auto_assign && !prefs.pauseAllAutomations) {
        const { data: waiting } = await supabase.from("social_leads").select("*").eq("org_id", settings.org_id).eq("branch_id", settings.branch_id)
          .is("assigned_to", null).in("status", OPEN_STATUSES).not("last_customer_message_at", "is", null).order("last_customer_message_at", { ascending: true }).limit(50);
        for (const lead of (waiting ?? []) as any[]) if (await assignLead(settings, lead, "auto", [], rules, nowMs)) assigned += 1;
      }
      const { data: awaiting } = await supabase.from("social_leads").select("*").eq("org_id", settings.org_id).eq("branch_id", settings.branch_id)
        .not("awaiting_reply_since", "is", null).not("assigned_to", "is", null).in("status", OPEN_STATUSES).limit(500);
      for (const lead of (awaiting ?? []) as any[]) {
        const minutes = workingMsBetween(Date.parse(lead.awaiting_reply_since), nowMs, rules) / 60_000;
        const rule = slaRuleFor({ ...lead, returning: Boolean(lead.converted_at) }, prefs.slaRules);
        const leadSla = slaFor(rule, Boolean(lead.first_response_at), { ...sla, reassign: prefs.reassignEnabled ? sla.reassign : 0 });
        const stage = slaStage(minutes, leadSla);
        if (stageRank(stage) <= stageRank(lead.sla_stage)) continue;
        await supabase.from("social_leads").update({ sla_stage: stage }).eq("id", lead.id);
        if (stage === "renotify") { await sendLeadAlert(settings.org_id, lead, "renotify", lead.last_message_preview ?? "", lead.assigned_to); nudged += 1; }
        if (stage === "escalate" && prefs.escalateOnBreach) { await escalate(settings, lead, Math.round(minutes), rule?.escalateTo ?? "Manager", prefs); escalated += 1; }
        if (stage === "reassign" && open && settings.auto_assign && prefs.reassignEnabled && !prefs.pauseAllAutomations) {
          const before = lead.assigned_to;
          const rep = await assignLead(settings, { ...lead, sla_stage: "ok" }, "reassign", [before], rules, nowMs);
          if (rep) { moved += 1; await supabase.from("social_leads").update({ sla_stage: "ok", awaiting_reply_since: new Date(nowMs).toISOString() }).eq("id", lead.id); }
        }
      }
      const { data: due } = await supabase.from("social_leads").select("*").eq("org_id", settings.org_id).eq("branch_id", settings.branch_id)
        .lte("next_follow_up_at", new Date(nowMs).toISOString()).is("follow_up_notified_at", null).in("status", OPEN_STATUSES).limit(200);
      for (const lead of (due ?? []) as any[]) {
        await supabase.from("social_leads").update({ follow_up_notified_at: new Date(nowMs).toISOString() }).eq("id", lead.id);
        await sendLeadAlert(settings.org_id, lead, "follow_up", lead.follow_up_note ?? "", lead.assigned_to);
        followUps += 1;
      }
      // Auto follow-up (Settings): the rep wrote last and the customer went quiet for N working hours.
      if (prefs.autoFollowUpHours > 0 && open && !prefs.pauseAllAutomations) {
        const { data: quiet } = await supabase.from("social_leads").select("*").eq("org_id", settings.org_id).eq("branch_id", settings.branch_id)
          .in("status", ["in_conversation", "awaiting_customer", "hot", "call_requested"]).is("next_follow_up_at", null).is("awaiting_reply_since", null)
          .not("last_rep_message_at", "is", null).not("assigned_to", "is", null).limit(300);
        for (const lead of (quiet ?? []) as any[]) {
          if (lead.last_customer_message_at && lead.last_customer_message_at > lead.last_rep_message_at) continue;
          if (workingMsBetween(Date.parse(lead.last_rep_message_at), nowMs, rules) < prefs.autoFollowUpHours * 3_600_000) continue;
          await scheduleFollowUp(lead, new Date(nowMs + 5 * 60_000).toISOString(), "No reply from the customer: follow up.", "Auto follow-up", true);
        }
      }
      // Auto-close (Settings): no customer message for N days.
      if (prefs.autoCloseDays > 0 && !prefs.pauseAllAutomations) {
        const cutoff = new Date(nowMs - prefs.autoCloseDays * 86_400_000).toISOString();
        const { data: stale } = await supabase.from("social_leads").select("*").eq("org_id", settings.org_id).eq("branch_id", settings.branch_id)
          .in("status", OPEN_STATUSES).lt("last_message_at", cutoff).is("next_follow_up_at", null).limit(300);
        for (const lead of (stale ?? []) as any[]) {
          await supabase.from("social_leads").update({ status: "lost", lost_reason: `No reply for ${prefs.autoCloseDays} days`, closed_at: new Date(nowMs).toISOString(), awaiting_reply_since: null, sla_stage: null }).eq("id", lead.id);
          await systemMessage(lead, `Closed automatically: no message for ${prefs.autoCloseDays} days.`);
        }
      }
    } catch (err: any) {
      logger.warn("social leads job failed", { branchId: settings.branch_id, error: err?.message ?? String(err) });
    }
  }
  // Settings › Response & SLA › "Send daily SLA performance summary": 5:30pm Lagos, once a day.
  const lagosNow = new Date(nowMs + 3_600_000);
  if (lagosNow.getUTCHours() === 17 && lagosNow.getUTCMinutes() >= 30) {
    for (const settings of (all ?? []) as SettingsRow[]) {
      const prefs = cleanPrefs(settings.prefs);
      if (!prefs.dailySlaSummary) continue;
      const today = lagosNow.toISOString().slice(0, 10);
      const { data: done } = await supabase.from("social_lead_events").select("id").eq("org_id", settings.org_id).eq("branch_id", settings.branch_id).eq("kind", "daily_summary").gte("created_at", `${today}T00:00:00+01:00`).limit(1);
      if ((done ?? []).length) continue;
      await logEvent(settings.org_id, settings.branch_id, "daily_summary", true, {});
      const since = `${today}T00:00:00+01:00`;
      const [{ count: leadsToday }, { count: late }, { count: orders }] = await Promise.all([
        supabase.from("social_leads").select("id", { count: "exact", head: true }).eq("org_id", settings.org_id).eq("branch_id", settings.branch_id).gte("created_at", since),
        supabase.from("social_lead_events").select("id", { count: "exact", head: true }).eq("org_id", settings.org_id).eq("branch_id", settings.branch_id).eq("kind", "escalated").gte("created_at", since),
        supabase.from("social_leads").select("id", { count: "exact", head: true }).eq("org_id", settings.org_id).eq("branch_id", settings.branch_id).gte("converted_at", since)
      ]);
      const { data: leaders } = await supabase.from("users").select("id").eq("org_id", settings.org_id).eq("active", true).in("role", ["Owner", "Admin", "Manager"]);
      const rows = ((leaders ?? []) as any[]).map((u) => ({ org_id: settings.org_id, branch_id: settings.branch_id, recipient_id: u.id, type: "info", read: false, link: LINK,
        title: "Daily SLA performance summary", message: `Today: ${leadsToday ?? 0} new social leads, ${orders ?? 0} orders, ${late ?? 0} replies past the target.` }));
      if (rows.length) await supabase.from("system_notifications").insert(rows);
    }
  }
  // Order status changes: the lead follows its order (Delivered marks it delivered) and "Order Update" automations fire.
  const { data: converted } = await supabase.from("social_leads").select("*").not("order_id", "is", null).in("status", ["order_created", "delivered"]).limit(2000);
  const ids = [...new Set(((converted ?? []) as any[]).map((row) => String(row.order_id)))];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    // launch-safe: only the status is read, to follow the order; nothing is shown.
    const { data: orders } = await supabase.from("orders").select("id, status").in("id", chunk);
    const statusOf = new Map(((orders ?? []) as any[]).map((row) => [String(row.id), String(row.status)]));
    for (const lead of ((converted ?? []) as any[]).filter((row) => chunk.includes(String(row.order_id)))) {
      const st = statusOf.get(String(lead.order_id));
      if (!st || st === lead.order_status) continue;
      const patch: Record<string, unknown> = { order_status: st, updated_at: new Date(nowMs).toISOString() };
      if (st === "Delivered") patch.status = "delivered";
      const { data: fresh } = await supabase.from("social_leads").update(patch).eq("id", lead.id).select("*").single();
      if (fresh) await fire("order_update", fresh, { orderStatus: st });
    }
  }
  try { const m = await import("./social-lead-automations.js"); await m.runAutomationsJob(nowMs); } catch (err: any) { logger.warn("automations job failed", { error: err?.message ?? String(err) }); }
  return { assigned, nudged, escalated, moved, followUps };
}

async function escalate(settings: SettingsRow, lead: any, minutes: number, toRole: string, prefs: Prefs) {
  const { data: rep } = await supabase.from("users").select("name").eq("id", lead.assigned_to).maybeSingle();
  const repName = (rep as any)?.name ?? "rep";
  await systemMessage(lead, `No reply after ${minutes} working minutes: ${toRole} told.`);
  await sendLeadAlert(settings.org_id, lead, "overdue", lead.last_message_preview ?? "", null, `${repName}, ${minutes} min`, [toRole]);
  await logEvent(settings.org_id, settings.branch_id, "escalated", true, { lead: lead.ref, leadId: lead.id, name: lead.name, rep: lead.assigned_to, minutes });
  // "Notify Manager for repeated breaches (≥ 3)": the third breach of the day for one rep.
  if (prefs.notifyRepeatBreaches && lead.assigned_to) {
    const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
    const { data: todays } = await supabase.from("social_lead_events").select("detail").eq("org_id", settings.org_id).eq("branch_id", settings.branch_id).eq("kind", "escalated").gte("created_at", `${today}T00:00:00+01:00`).limit(500);
    const mine = ((todays ?? []) as any[]).filter((e) => e.detail?.rep === lead.assigned_to).length;
    if (mine === 3) await sendLeadAlert(settings.org_id, lead, "overdue", "", null, `${repName} has missed 3 reply targets today`, ["Manager"]);
  }
}

// ── Replying ──────────────────────────────────────────────────────────────

export type Actor = { id: string; name: string; role: string; orgId: string; branchId: string };
export const LEADERSHIP = new Set(["Owner", "Admin", "Manager"]);

export async function loadLeadFor(actor: Actor, leadId: string) {
  const { data, error } = await supabase.from("social_leads").select("*").eq("org_id", actor.orgId).eq("id", leadId).maybeSingle();
  if (error) throw error;
  if (!data) throw new SocialLeadError(404, "This lead was not found.");
  // A rep works only their own leads (one customer, one rep).
  if (!LEADERSHIP.has(actor.role) && data.assigned_to !== actor.id) throw new SocialLeadError(403, "This lead belongs to another rep.");
  return data as any;
}

/** A rep's reply (sent through ManyChat), a team-only note, or a product card. */
export async function sendReply(actor: Actor, leadId: string, input: { kind: "text" | "note" | "product" | "image"; body?: string; productId?: string; packageId?: string; imageUrl?: string }) {
  const lead = await loadLeadFor(actor, leadId);
  const nowIso = new Date().toISOString();
  const body = String(input.body ?? "").trim().slice(0, 2000);
  if (input.kind === "note") {
    if (!body) throw new SocialLeadError(400, "Write the note first.");
    const { data, error } = await supabase.from("social_lead_messages").insert({ org_id: lead.org_id, branch_id: lead.branch_id, lead_id: lead.id, direction: "note", kind: "text", body, sender_id: actor.id, sender_name: actor.name }).select("*").single();
    if (error) throw error;
    return { message: data };
  }
  const settings = await settingsFor(lead.org_id, lead.branch_id);
  const window = messagingWindow(lead.last_customer_message_at, Date.now());
  // Direct Meta: someone who only commented can get ONE private reply to their comment (7 days).
  const privateReply = window.state === "none" && Boolean(lead.pending_comment_id) && lead.channel === "meta";
  if (window.state === "none" && !privateReply) throw new SocialLeadError(409, "This customer only commented. Meta allows a message only after they write to the page (a private reply to the comment asks them to).");
  if (privateReply && input.kind !== "text") throw new SocialLeadError(409, "Someone who only commented can first get one text message (a private reply). Pictures and product cards can follow once they answer.");
  if (window.state === "closed") throw new SocialLeadError(409, "Over 7 days since the customer last wrote: Meta no longer allows a message. Call them if you have their number.");
  let messages: manychat.OutMessage[] = [];
  let payload: Record<string, unknown> = {};
  let kind: "text" | "product" | "image" = "text";
  if (input.kind === "product") {
    const card = await productCard(lead, input.productId ?? lead.product_id, input.packageId ?? null);
    messages = [card.message, ...(body ? [{ type: "text" as const, text: body }] : [])];
    payload = card.payload;
    kind = "product";
  } else if (input.kind === "image") {
    if (!input.imageUrl || !/^https:\/\//.test(input.imageUrl)) throw new SocialLeadError(400, "Pick a picture to send.");
    messages = [{ type: "image", url: input.imageUrl }, ...(body ? [{ type: "text" as const, text: body }] : [])];
    payload = { imageUrl: input.imageUrl };
    kind = "image";
  } else {
    if (!body) throw new SocialLeadError(400, "Type a message first.");
    messages = [{ type: "text", text: body }];
  }
  const { data: row, error } = await supabase.from("social_lead_messages").insert({
    org_id: lead.org_id, branch_id: lead.branch_id, lead_id: lead.id, direction: "out", kind, body, payload, sender_id: actor.id, sender_name: actor.name, status: "sending"
  }).select("*").single();
  if (error) throw error;
  const sent = await deliver(settings, lead, messages, { humanAgent: window.state === "human_only", allowPrivateReply: privateReply });
  if (!sent.ok) {
    await supabase.from("social_lead_messages").update({ status: "failed", error: sent.message }).eq("id", row.id);
    await logEvent(lead.org_id, lead.branch_id, "send", false, { lead: lead.ref, error: sent.message });
    throw new SocialLeadError(502, sent.message);
  }
  await supabase.from("social_lead_messages").update({ status: "ok" }).eq("id", row.id);
  await logEvent(lead.org_id, lead.branch_id, "send", true, { lead: lead.ref, leadId: lead.id, name: lead.name, kind, by: actor.name });
  const firstReply = !lead.first_response_at;
  const responseSeconds = firstReply && lead.first_customer_message_at ? Math.round(workingMsBetween(Date.parse(lead.first_customer_message_at), Date.now(), (await hoursFor(settings)).rules) / 1000) : null;
  await supabase.from("social_leads").update({
    last_rep_message_at: nowIso, last_message_at: nowIso, last_message_preview: body || (kind === "product" ? "Sent a product card" : "Sent a picture"),
    awaiting_reply_since: null, sla_stage: null, unread_count: 0,
    status: ["new", "engaged", "dm_sent"].includes(lead.status) ? "in_conversation" : lead.status,
    ...(firstReply ? { first_response_at: nowIso, first_response_seconds: responseSeconds } : {}),
    updated_at: nowIso
  }).eq("id", lead.id);
  // A person is talking: keep the bot quiet (best effort; needs the protohub_human field in ManyChat).
  if (!lead.bot_paused && sent.via === "manychat" && settings.manychat_api_key) {
    const paused = await manychat.setHumanHandling(settings.manychat_api_key, lead.manychat_contact_id, true);
    if (paused.ok) await supabase.from("social_leads").update({ bot_paused: true }).eq("id", lead.id);
  }
  return { message: { ...row, status: "ok" } };
}

async function productCard(lead: any, productId: string | null, packageId: string | null) {
  if (!productId) throw new SocialLeadError(400, "Pick the product to send.");
  const { data: product } = await supabase.from("products").select("id, name, image_url, description").eq("org_id", lead.org_id).eq("id", productId).maybeSingle();
  if (!product) throw new SocialLeadError(404, "Product not found.");
  let pkgQuery = supabase.from("product_packages").select("id, name, price, currency, quantity").eq("product_id", productId).eq("active", true).order("display_order").limit(1);
  if (packageId) pkgQuery = supabase.from("product_packages").select("id, name, price, currency, quantity").eq("id", packageId).limit(1);
  const { data: pkgs } = await pkgQuery;
  const pkg = (pkgs ?? [])[0] as any;
  const price = pkg ? `${pkg.currency === "ZMW" ? "K" : "₦"}${Math.round(Number(pkg.price)).toLocaleString("en-NG")}` : "";
  const url = `${(process.env.FRONTEND_URL || "https://protohub-zeta.vercel.app").replace(/\/+$/, "")}/#/order-form/embed?product=${encodeURIComponent(product.id)}`;
  return {
    message: { type: "cards" as const, image_aspect_ratio: "square" as const, elements: [{ title: `${product.name}${price ? ` – ${price}` : ""}`.slice(0, 80), subtitle: String((product as any).description ?? pkg?.name ?? "").slice(0, 80) || undefined, image_url: (product as any).image_url || undefined, buttons: [{ type: "url" as const, caption: "View Details", url }] }] },
    payload: { productId: product.id, productName: product.name, packageName: pkg?.name ?? null, price: pkg ? Number(pkg.price) : null, currency: pkg?.currency ?? "NGN", imageUrl: (product as any).image_url ?? null, url }
  };
}

export async function markRead(actor: Actor, leadId: string) {
  const lead = await loadLeadFor(actor, leadId);
  if (lead.unread_count) await supabase.from("social_leads").update({ unread_count: 0 }).eq("id", lead.id);
  return { ok: true };
}

// ── Follow-ups ────────────────────────────────────────────────────────────

/** One open follow-up per lead: a new one replaces the old; the lead mirrors it. */
export async function scheduleFollowUp(lead: any, dueAt: string, note: string | null, byName: string, auto = false) {
  await supabase.from("social_lead_follow_ups").update({ status: "cancelled" }).eq("lead_id", lead.id).eq("status", "scheduled");
  const { error } = await supabase.from("social_lead_follow_ups").insert({ org_id: lead.org_id, branch_id: lead.branch_id, lead_id: lead.id, due_at: dueAt, note, rep_id: lead.assigned_to, created_by_name: byName, auto });
  if (error) throw error;
  await supabase.from("social_leads").update({
    next_follow_up_at: dueAt, follow_up_note: note, follow_up_notified_at: null, updated_at: new Date().toISOString(),
    ...(["order_created", "delivered", "lost"].includes(lead.status) ? {} : { status: "follow_up" })
  }).eq("id", lead.id);
  const when = new Date(dueAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
  await systemMessage(lead, `${auto ? "Auto follow-up" : "Follow-up"} scheduled for ${when}${note ? `: ${note}` : ""}`, byName);
}

export async function completeFollowUp(actor: Actor, leadId: string, outcome: string | null) {
  const lead = await loadLeadFor(actor, leadId);
  const nowIso = new Date().toISOString();
  await supabase.from("social_lead_follow_ups").update({ status: "done", done_at: nowIso }).eq("lead_id", lead.id).eq("status", "scheduled");
  const { data, error } = await supabase.from("social_leads").update({
    next_follow_up_at: null, follow_up_note: null, follow_up_notified_at: null, updated_at: nowIso,
    ...(lead.status === "follow_up" ? { status: "in_conversation" } : {})
  }).eq("id", lead.id).select("*").single();
  if (error) throw error;
  await systemMessage(lead, `Follow-up done${outcome ? `: ${String(outcome).slice(0, 200)}` : ""}.`, actor.name);
  return { lead: data };
}

/** Add Lead (All Leads): someone who called or wrote elsewhere. No ManyChat contact, so no chat. */
export async function addManualLead(actor: Actor, input: Record<string, unknown>) {
  const name = String(input.name ?? "").trim().slice(0, 160);
  if (!name) throw new SocialLeadError(400, "Type the customer's name.");
  const platform = ["facebook", "instagram", "messenger"].includes(String(input.platform)) ? String(input.platform) : "facebook";
  let product: { id: string; name: string } | null = null;
  if (input.productId) {
    const { data } = await supabase.from("products").select("id, name").eq("org_id", actor.orgId).eq("id", String(input.productId)).maybeSingle();
    product = (data as any) ?? null;
  }
  const nowIso = new Date().toISOString();
  const assignTo = input.assignTo === "me" || !LEADERSHIP.has(actor.role) ? actor.id : typeof input.assignTo === "string" && /^[0-9a-f-]{36}$/i.test(input.assignTo) ? input.assignTo : null;
  const { data, error } = await supabase.from("social_leads").insert({
    org_id: actor.orgId, branch_id: actor.branchId, manychat_contact_id: `manual-${crypto.randomUUID()}`, platform, name,
    phone: String(input.phone ?? "").trim().slice(0, 30) || null, state: String(input.state ?? "").trim().slice(0, 60) || null,
    product_id: product?.id ?? null, product_interest: product?.name ?? (String(input.product ?? "").trim().slice(0, 120) || null),
    original_comment: String(input.note ?? "").trim().slice(0, 1000) || null, source_label: "Added by hand", campaign_name: String(input.campaign ?? "").trim().slice(0, 120) || null,
    status: "new", assigned_to: assignTo, assigned_at: assignTo ? nowIso : null, assigned_by: assignTo ? `manual:${actor.name}` : null,
    last_message_preview: String(input.note ?? "").trim().slice(0, 200) || null, last_message_at: nowIso
  }).select("*").single();
  if (error) throw error;
  await systemMessage(data, `Added by ${actor.name}.`, actor.name);
  return { lead: data };
}

// ── Editing a lead ─────────────────────────────────────────────────────────

const EDITABLE_STATUSES: LeadStatus[] = ["new", "in_conversation", "hot", "call_requested", "awaiting_customer", "follow_up", "on_hold", "lost", "engaged"];

export async function updateLead(actor: Actor, leadId: string, input: Record<string, unknown>) {
  const lead = await loadLeadFor(actor, leadId);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const notes: string[] = [];
  const text = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max) || null;
  if ("name" in input) patch.name = text(input.name, 160) ?? lead.name;
  if ("phone" in input) patch.phone = text(input.phone, 30);
  if ("whatsapp" in input) patch.whatsapp = text(input.whatsapp, 30);
  if ("state" in input) patch.state = text(input.state, 60);
  if ("address" in input) patch.address = text(input.address, 400);
  if ("productId" in input) {
    const id = text(input.productId, 60);
    if (id) {
      const { data } = await supabase.from("products").select("id, name").eq("org_id", lead.org_id).eq("id", id).maybeSingle();
      if (!data) throw new SocialLeadError(400, "Product not found.");
      patch.product_id = data.id; patch.product_interest = data.name;
    }
  }
  if ("packageId" in input) patch.package_id = text(input.packageId, 60);
  if ("tags" in input && Array.isArray(input.tags)) patch.tags = [...new Set((input.tags as unknown[]).map((t) => String(t).trim().slice(0, 30)).filter(Boolean))].slice(0, 20);
  if ("customFields" in input && input.customFields && typeof input.customFields === "object") {
    patch.custom_fields = Object.fromEntries(Object.entries(input.customFields as Record<string, unknown>).slice(0, 30).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40), String(v ?? "").slice(0, 120)]));
  }
  if ("offerText" in input) patch.offer_text = text(input.offerText, 120);
  if ("hot" in input) { patch.hot = Boolean(input.hot); if (input.hot && !["order_created", "delivered", "lost"].includes(lead.status)) patch.status = "hot"; notes.push(input.hot ? "Marked as hot lead" : "No longer hot"); }
  if ("status" in input) {
    const status = String(input.status) as LeadStatus;
    if (!EDITABLE_STATUSES.includes(status)) throw new SocialLeadError(400, "That status is set by the system.");
    patch.status = status;
    if (status === "lost") { patch.lost_reason = text(input.lostReason, 200) ?? "Not given"; patch.closed_at = patch.updated_at; patch.awaiting_reply_since = null; patch.next_follow_up_at = null; notes.push(`Closed as lost: ${patch.lost_reason}`); }
    else if (lead.status === "lost") { patch.closed_at = null; patch.lost_reason = null; notes.push("Reopened"); }
    if (status === "awaiting_customer") patch.awaiting_reply_since = null;
  }
  if ("nextFollowUpAt" in input) {
    const at = input.nextFollowUpAt ? new Date(String(input.nextFollowUpAt)) : null;
    if (at && Number.isNaN(at.getTime())) throw new SocialLeadError(400, "Pick a valid follow-up time.");
    if (at) await scheduleFollowUp(lead, at.toISOString(), text(input.followUpNote, 300), actor.name);
    else {
      await supabase.from("social_lead_follow_ups").update({ status: "cancelled" }).eq("lead_id", lead.id).eq("status", "scheduled");
      patch.next_follow_up_at = null; patch.follow_up_note = null; patch.follow_up_notified_at = null;
      if (lead.status === "follow_up") patch.status = "in_conversation";
      notes.push("Follow-up cleared");
    }
  }
  if ("botPaused" in input) {
    const settings = await settingsFor(lead.org_id, lead.branch_id);
    if (settings.manychat_api_key) {
      const result = await manychat.setHumanHandling(settings.manychat_api_key, lead.manychat_contact_id, Boolean(input.botPaused));
      if (!result.ok) throw new SocialLeadError(502, `${result.message} Add a custom field named protohub_human (Yes/No) in ManyChat.`);
    }
    patch.bot_paused = Boolean(input.botPaused);
    notes.push(input.botPaused ? "Bot paused: a person is handling this chat" : "Bot switched back on");
  }
  if ("botPaused" in input && !input.botPaused && !LEADERSHIP.has(actor.role) && !cleanPrefs((await settingsFor(lead.org_id, lead.branch_id)).prefs).allowRepResumeBot) {
    throw new SocialLeadError(403, "Only a manager can switch the bot back on (Settings).");
  }
  const { data, error } = await supabase.from("social_leads").update(patch).eq("id", lead.id).select("*").single();
  if (error) throw error;
  for (const note of notes) await systemMessage(lead, note, actor.name);
  if (Array.isArray(patch.tags)) for (const tag of (patch.tags as string[]).filter((t) => !(lead.tags ?? []).includes(t))) await fire("tag_added", data, { tag });
  return { lead: data };
}

export async function transferLead(actor: Actor, leadId: string, repId: string) {
  const lead = await loadLeadFor(actor, leadId);
  const { data: rep } = await supabase.from("users").select("id, name, role, active").eq("org_id", lead.org_id).eq("id", repId).maybeSingle();
  if (!rep || !(rep as any).active) throw new SocialLeadError(400, "Pick an active rep.");
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.from("social_leads").update({ assigned_to: rep.id, assigned_at: nowIso, assigned_by: `transfer:${actor.name}`, sla_stage: lead.awaiting_reply_since ? "ok" : null, updated_at: nowIso }).eq("id", lead.id).select("*").single();
  if (error) throw error;
  await systemMessage(lead, `Transferred to ${(rep as any).name} by ${actor.name}.`, actor.name);
  await notifyRep(lead.org_id, data, "new", data.last_message_preview ?? "");
  await fire("assigned", data);
  return { lead: data };
}

/** An order was made from this lead (routes/orders.ts). */
export async function leadConverted(orgId: string, leadId: string, orderId: string, actorName: string) {
  const { data: lead } = await supabase.from("social_leads").select("*").eq("org_id", orgId).eq("id", leadId).maybeSingle();
  if (!lead) return;
  const nowIso = new Date().toISOString();
  await supabase.from("social_leads").update({ status: "order_created", order_id: orderId, converted_at: (lead as any).converted_at ?? nowIso, awaiting_reply_since: null, sla_stage: null, next_follow_up_at: null, updated_at: nowIso }).eq("id", leadId);
  // A follow-up that led to the order counts as done (follow-up conversion).
  await supabase.from("social_lead_follow_ups").update({ status: "done", done_at: nowIso }).eq("lead_id", leadId).eq("status", "scheduled");
  await systemMessage(lead as any, `Order #${orderId} created by ${actorName}.`, actorName);
  await logEvent(orgId, (lead as any).branch_id, "converted", true, { lead: (lead as any).ref, leadId, name: (lead as any).name, order: orderId });
  await supabase.from("social_leads").update({ order_status: "New" }).eq("id", leadId);
  const fresh = await reload(leadId);
  if (fresh) await fire("order_update", fresh, { orderStatus: "New" });
}

export { showsBuyingIntent };

/** Settings › Notifications › Create Notification: an announcement to roles (in-app + phone pop-up). */
export async function announce(actor: Actor, input: { title?: unknown; message?: unknown; roles?: unknown }) {
  const title = String(input.title ?? "").trim().slice(0, 120), message = String(input.message ?? "").trim().slice(0, 500);
  const roles = Array.isArray(input.roles) ? input.roles.filter((r) => typeof r === "string").slice(0, 10) as string[] : [];
  if (!title) throw new SocialLeadError(400, "Give the notification a title.");
  if (!roles.length) throw new SocialLeadError(400, "Pick who gets it.");
  const { data: users } = await supabase.from("users").select("id").eq("org_id", actor.orgId).eq("active", true).in("role", roles);
  const ids = ((users ?? []) as any[]).map((u) => u.id);
  if (!ids.length) return { sent: 0 };
  const { error } = await supabase.from("system_notifications").insert(ids.map((id) => ({ org_id: actor.orgId, branch_id: actor.branchId, recipient_id: id, type: "info", read: false, link: LINK, title, message: message || title })));
  if (error) throw error;
  const branding = await getOrgPushBranding(actor.orgId);
  await Promise.all(ids.map((id) => sendPushToUser(actor.orgId, id, { title, body: message || title, url: LINK, tag: `announce-${Date.now()}`, kind: "info", brandName: branding.brandName, brandLogo: branding.brandLogo }).catch(() => undefined)));
  await logEvent(actor.orgId, actor.branchId, "announcement", true, { title, roles, by: actor.name });
  return { sent: ids.length };
}
