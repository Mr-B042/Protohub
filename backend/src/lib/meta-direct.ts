import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { open, seal } from "./secret-box.js";
import * as meta from "./meta-messaging.js";
import * as manychat from "./manychat.js";
import { fillVariables } from "./automation-rules.js";
import {
  cleanCommentReply, commentReplyBlock, contactIdFor, parseMetaWebhook, pickPublic, privateReplyOpen, signState, signatureOk, stateOk, readState,
  type CommentReply, type MetaCommentEvent, type MetaEvent, type OutMessage
} from "./meta-direct-rules.js";
import { SocialLeadError, logEvent, receiveInbound, settingsBySecret, settingsFor, systemMessage, type Actor, type SettingsRow } from "./social-leads.js";
import type { Inbound } from "./social-leads-rules.js";

// Direct Meta (free) for Social Leads (Bright, 13 Nov 2026). Protohub is the
// Meta app: Facebook Page + Instagram comments and messages come straight to
// /api/public/social-leads/meta/<secret>, replies go out through Meta's Send
// API. ONE switch (social_lead_meta.active) decides who delivers: on = Direct
// Meta, off = ManyChat. Both never answer the same customer.

export const PUBLIC_BACKEND_URL = (process.env.PUBLIC_BACKEND_URL || "https://protohub-production.up.railway.app").replace(/\/+$/, "");
const FRONTEND = () => ((process.env.FRONTEND_URL ?? "").split(",")[0]?.trim().replace(/\/+$/, "") || "https://protohub-zeta.vercel.app");
export const redirectUri = () => `${PUBLIC_BACKEND_URL}/api/public/social-leads/meta/connect/callback`;

type DirectRow = { org_id: string; branch_id: string; active: boolean; app_id: string | null; app_secret_enc: string | null; verify_token: string; comment_reply: unknown; last_event_at: string | null; last_error: string | null };
type PageRow = { id: string; org_id: string; branch_id: string; page_id: string; page_name: string; page_token_enc: string; ig_id: string | null; ig_username: string | null; subscribed: boolean; subscribe_error: string | null; connected_at: string; last_event_at: string | null };

export async function directFor(orgId: string, branchId: string): Promise<DirectRow> {
  const { data, error } = await supabase.from("social_lead_meta").select("*").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
  if (error) throw error;
  if (data) return data as DirectRow;
  const made = await supabase.from("social_lead_meta").insert({ org_id: orgId, branch_id: branchId }).select("*").single();
  if (made.error) {
    const again = await supabase.from("social_lead_meta").select("*").eq("org_id", orgId).eq("branch_id", branchId).single();
    if (again.error) throw again.error;
    return again.data as DirectRow;
  }
  return made.data as DirectRow;
}
async function pagesFor(orgId: string, branchId: string): Promise<PageRow[]> {
  const { data, error } = await supabase.from("social_lead_meta_pages").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("connected_at");
  if (error) throw error;
  return (data ?? []) as PageRow[];
}
export async function directActive(orgId: string, branchId: string) {
  const { data } = await supabase.from("social_lead_meta").select("active").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
  return Boolean((data as any)?.active);
}

// ── Sending (used by the inbox, automations and the after-hours reply) ────

type Delivered = { ok: true; via: "manychat" | "meta" | "private_reply" } | { ok: false; message: string };

/**
 * Deliver to a lead through whichever channel is switched on. A customer who
 * only commented gets Meta's one private reply (text only, within 7 days).
 */
export async function deliver(settings: SettingsRow, lead: any, messages: OutMessage[], opts: { humanAgent?: boolean; allowPrivateReply?: boolean } = {}): Promise<Delivered> {
  if (lead.channel === "manual" || String(lead.manychat_contact_id).startsWith("manual-")) return { ok: false, message: "This lead was added by hand: there is no chat to send to." };
  const direct = await directFor(settings.org_id, settings.branch_id);
  if (!direct.active) {
    if (!settings.manychat_api_key) return { ok: false, message: "No channel is switched on. Turn on Direct Meta or connect ManyChat (Social Leads › Settings)." };
    const contact = String(lead.manychat_contact_id);
    const subscriberId = /^fb_/.test(contact) ? contact.slice(3) : contact;
    if (/^(ig_|igc_|fbc_)/.test(contact)) return { ok: false, message: "This chat started on Direct Meta. ManyChat can reply once the customer writes again." };
    const sent = await manychat.sendContent(settings.manychat_api_key, { subscriberId, platform: lead.platform, messages: messages as manychat.OutMessage[], humanAgentTag: opts.humanAgent });
    return sent.ok ? { ok: true, via: "manychat" } : { ok: false, message: sent.message };
  }
  const target = await metaTarget(settings, lead);
  if ("error" in target) return { ok: false, message: target.error };
  if (!target.userId) {
    if (!opts.allowPrivateReply || !lead.pending_comment_id || !privateReplyOpen(lead.pending_comment_at)) {
      return { ok: false, message: lead.pending_comment_id ? "Over 7 days since the comment: Meta no longer allows a private reply." : "This customer only commented. Meta allows a message only after they write to the page." };
    }
    const text = messages.find((m) => m.type === "text") as { type: "text"; text: string } | undefined;
    if (!text) return { ok: false, message: "A first message to someone who only commented can only be text." };
    const sent = await meta.sendMessage(target.token, { commentId: lead.pending_comment_id }, text);
    if (!sent.ok) return { ok: false, message: sent.message };
    await afterPrivateReply(lead, target.object, sent.data.recipient_id ?? null);
    return { ok: true, via: "private_reply" };
  }
  for (const message of messages) {
    const sent = await meta.sendMessage(target.token, { userId: target.userId }, message, opts.humanAgent);
    if (!sent.ok) return { ok: false, message: sent.message };
  }
  return { ok: true, via: "meta" };
}

async function metaTarget(settings: SettingsRow, lead: any): Promise<{ token: string; object: "page" | "instagram"; userId: string | null } | { error: string }> {
  const pages = await pagesFor(settings.org_id, settings.branch_id);
  if (!pages.length) return { error: "Direct Meta is on but no Page is connected (Social Leads › Settings › Direct Meta)." };
  const contact = String(lead.manychat_contact_id);
  const object: "page" | "instagram" = lead.platform === "instagram" ? "instagram" : "page";
  const page = pages.find((p) => lead.meta_page_id && (p.page_id === lead.meta_page_id || p.ig_id === lead.meta_page_id))
    ?? (object === "instagram" ? pages.find((p) => p.ig_id) : pages[0]);
  if (!page) return { error: "No connected Page has this Instagram account." };
  const token = open(page.page_token_enc);
  if (!token) return { error: "The Page key can't be read any more. Reconnect the Page (Settings › Direct Meta)." };
  let userId: string | null = null;
  if (/^(fb|ig)_/.test(contact)) userId = contact.slice(3);
  else if (/^(fbc|igc)_/.test(contact)) userId = null;
  else if (object === "page") userId = contact;              // a ManyChat lead: ManyChat's Facebook id is the Page-scoped id
  else userId = lead.ig_id ?? null;                           // a ManyChat Instagram lead with its Instagram id saved
  if (!userId && !/^(fbc|igc)_/.test(contact)) return { error: "This Instagram chat came through ManyChat without its Instagram id. Direct Meta can reply once the customer writes again." };
  return { token, object, userId };
}

/** After the private reply Meta tells us the customer's chat id: the lead now has a real chat. */
async function afterPrivateReply(lead: any, object: "page" | "instagram", recipientId: string | null) {
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = { pending_comment_id: null, pending_comment_at: null, updated_at: nowIso };
  if (["comment_captured", "new"].includes(lead.status) && !lead.last_customer_message_at) patch.status = "dm_sent";
  const old = String(lead.manychat_contact_id);
  if (recipientId && /^(fbc|igc)_/.test(old)) {
    const chatId = contactIdFor(object, recipientId, false);
    const { data: taken } = await supabase.from("social_leads").select("id, assigned_to").eq("org_id", lead.org_id).eq("manychat_contact_id", chatId).maybeSingle();
    if (!taken) Object.assign(patch, { manychat_contact_id: chatId, meta_alt_id: old });
    else if (!lead.order_id && !lead.assigned_to) {
      // They already chat with the Page: fold this comment into that conversation.
      await supabase.from("social_lead_messages").update({ lead_id: (taken as any).id }).eq("lead_id", lead.id);
      await supabase.from("social_leads").update({ meta_alt_id: old, pending_comment_id: null, pending_comment_at: null, updated_at: nowIso }).eq("id", (taken as any).id);
      await supabase.from("social_leads").delete().eq("id", lead.id);
      return;
    }
  }
  await supabase.from("social_leads").update(patch).eq("id", lead.id);
}

// ── Receiving ─────────────────────────────────────────────────────────────

/** Meta's one-time check when the webhook address is saved in the app. */
export async function verifyWebhook(secret: string, mode: unknown, token: unknown, challenge: unknown) {
  const settings = await settingsBySecret(secret);
  if (!settings || mode !== "subscribe") return null;
  const direct = await directFor(settings.org_id, settings.branch_id);
  return typeof token === "string" && token === direct.verify_token && typeof challenge === "string" ? challenge.slice(0, 200) : null;
}

export async function receiveMeta(secret: string, raw: Buffer, signature: string | undefined) {
  const settings = await settingsBySecret(secret);
  if (!settings) throw new SocialLeadError(404, "Unknown address.");
  const direct = await directFor(settings.org_id, settings.branch_id);
  const appSecret = open(direct.app_secret_enc);
  if (!appSecret || !signatureOk(raw, signature, appSecret)) {
    // Not from Meta (or the app secret in Protohub is wrong). Nothing is saved but one log line an hour.
    if (!direct.last_error?.startsWith("Signature") || Date.now() - Date.parse(direct.last_event_at ?? "1970-01-01") > 3_600_000) {
      await supabase.from("social_lead_meta").update({ last_error: "Signature check failed: is the App Secret in Protohub the same app's?" }).eq("org_id", settings.org_id).eq("branch_id", settings.branch_id);
    }
    throw new SocialLeadError(401, "Signature check failed.");
  }
  let payload: unknown;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { throw new SocialLeadError(400, "Not JSON."); }
  const nowIso = new Date().toISOString();
  await supabase.from("social_lead_meta").update({ last_event_at: nowIso, last_error: null }).eq("org_id", settings.org_id).eq("branch_id", settings.branch_id);
  if (!direct.active) return { ok: true, skipped: "Direct Meta is off" };
  const events = parseMetaWebhook(payload);
  if (!events.length) return { ok: true, events: 0 };
  const pages = await pagesFor(settings.org_id, settings.branch_id);
  let handled = 0;
  for (const event of events) {
    const page = pages.find((p) => p.page_id === event.accountId || p.ig_id === event.accountId);
    if (!page) continue; // a Page this branch did not connect
    try {
      await handleEvent(settings, direct, page, event);
      handled += 1;
    } catch (error: any) {
      logger.warn("meta direct event failed", { error: error?.message ?? String(error), kind: event.kind });
      await logEvent(settings.org_id, settings.branch_id, `meta.${event.kind}`, false, { error: String(error?.message ?? error).slice(0, 300) });
    }
  }
  if (handled) await supabase.from("social_lead_meta_pages").update({ last_event_at: nowIso }).in("id", pages.map((p) => p.id));
  return { ok: true, events: handled };
}

async function handleEvent(settings: SettingsRow, direct: DirectRow, page: PageRow, event: MetaEvent) {
  const token = open(page.page_token_enc);
  const platform: Inbound["platform"] = event.object === "instagram" ? "instagram" : event.kind === "comment" ? "facebook" : "messenger";
  const contactId = contactIdFor(event.object, event.userId, event.kind === "comment");
  // The commenter may already have a chat under their message id (or the reverse).
  const aliases = [contactIdFor(event.object, event.userId, event.kind !== "comment"), ...(event.object === "page" ? [event.userId] : [])];
  let name = event.kind === "comment" && event.userName ? (event.object === "instagram" ? `@${event.userName}` : event.userName) : "";
  let pic: string | null = null, username: string | null = event.object === "instagram" && event.kind === "comment" ? event.userName : null;
  if (event.kind === "message" && token) {
    const { data: known } = await supabase.from("social_leads").select("name").eq("org_id", settings.org_id).in("manychat_contact_id", [contactId, ...aliases]).limit(1).maybeSingle();
    if (!known || !(known as any).name || (known as any).name === "Facebook user") {
      const who = await meta.profile(token, event.object, event.userId);
      if (who) { name = who.name; pic = who.pic; username = who.username; }
    }
  }
  if (event.object === "instagram" && username && !name) name = `@${username}`;
  const inbound: Inbound = {
    event: event.kind === "comment" ? "comment" : "message", contactId, platform,
    name: (name || (event.object === "instagram" ? "Instagram user" : "Facebook user")).slice(0, 160), profilePic: pic, instagramUsername: username,
    phone: null, whatsapp: null, email: null,
    text: event.text || (event.kind === "message" && event.imageUrls.length ? "Sent a picture" : ""),
    comment: event.kind === "comment" ? event.text : null,
    product: null, campaign: event.kind === "message" ? event.adTitle : null, adId: event.adId, adName: event.kind === "message" ? event.adTitle : null,
    state: null, liveChatUrl: null, sentAt: new Date(event.at).toISOString(),
    igId: event.object === "instagram" && event.kind === "message" ? event.userId : null,
    aliases, channel: "meta", eventId: event.kind === "comment" ? `c_${event.commentId}` : `m_${event.mid}`,
    metaPageId: event.object === "instagram" ? page.ig_id ?? page.page_id : page.page_id,
    commentId: event.kind === "comment" ? event.commentId : undefined
  };
  const result = await receiveInbound(settings, inbound, "");
  if (event.kind !== "comment" || result.duplicate || result.skipped || !result.leadRow || !token) return;
  await commentAutoReply(settings, direct, page, token, event, result.leadRow);
}

/** OpenReply's core: a matching comment gets one private message (and, if chosen, a public reply). */
async function commentAutoReply(settings: SettingsRow, direct: DirectRow, page: PageRow, token: string, event: MetaCommentEvent, lead: any) {
  const cfg: CommentReply = cleanCommentReply(direct.comment_reply);
  const block = commentReplyBlock(cfg, event);
  if (block) return;
  // Someone already chatting is answered by their rep, not by a canned reply.
  if (lead.last_customer_message_at && Date.now() - Date.parse(lead.last_customer_message_at) < 24 * 3_600_000) return;
  const first = String(lead.name ?? "").replace(/^@/, "").split(/\s+/)[0];
  const text = fillVariables(cfg.message, { first_name: first && first !== "Facebook" && first !== "Instagram" ? first : "there", customer_name: lead.name, product: lead.product_interest }).trim();
  if (!text) return;
  const sent = await meta.sendMessage(token, { commentId: event.commentId }, { type: "text", text });
  await supabase.from("social_lead_messages").insert({ org_id: lead.org_id, branch_id: lead.branch_id, lead_id: lead.id, direction: "bot", kind: "text", body: text, sender_name: "Comment auto-reply", status: sent.ok ? "ok" : "failed", error: sent.ok ? null : sent.message });
  await logEvent(settings.org_id, settings.branch_id, "meta.private_reply", sent.ok, { lead: lead.ref, leadId: lead.id, name: lead.name, ...(sent.ok ? {} : { error: sent.message }) });
  if (sent.ok) {
    await afterPrivateReply({ ...lead, pending_comment_id: event.commentId }, event.object, sent.data.recipient_id ?? null);
    await supabase.from("social_leads").update({ last_message_preview: text.slice(0, 200), last_message_at: new Date().toISOString() }).eq("id", lead.id);
  }
  const pub = pickPublic(cfg, event.commentId);
  if (pub && sent.ok) {
    const replied = await meta.publicReply(token, event.object, event.commentId, pub);
    await systemMessage(lead, replied.ok ? `Public reply under the comment: "${pub}"` : `Public reply failed: ${replied.message}`);
  }
}

// ── Owner setup ───────────────────────────────────────────────────────────

export async function directView(actor: Actor) {
  const settings = await settingsFor(actor.orgId, actor.branchId);
  const direct = await directFor(actor.orgId, actor.branchId);
  const pages = await pagesFor(actor.orgId, actor.branchId);
  return {
    active: direct.active,
    appId: direct.app_id, hasSecret: Boolean(open(direct.app_secret_enc)),
    webhookUrl: `${PUBLIC_BACKEND_URL}/api/public/social-leads/meta/${settings.webhook_secret}`,
    verifyToken: direct.verify_token,
    redirectUri: redirectUri(),
    lastEventAt: direct.last_event_at, lastError: direct.last_error,
    commentReply: cleanCommentReply(direct.comment_reply),
    manychatConnected: Boolean(settings.manychat_api_key),
    scopes: meta.SCOPES,
    pages: pages.map((p) => ({ id: p.id, pageId: p.page_id, name: p.page_name, igId: p.ig_id, igUsername: p.ig_username, subscribed: p.subscribed, error: p.subscribe_error, connectedAt: p.connected_at, lastEventAt: p.last_event_at }))
  };
}

export async function saveDirect(actor: Actor, input: { appId?: string; appSecret?: string; active?: boolean; commentReply?: unknown }) {
  const direct = await directFor(actor.orgId, actor.branchId);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor.id };
  const appId = input.appId !== undefined ? input.appId.trim() : direct.app_id;
  const secret = input.appSecret?.trim() ? input.appSecret.trim() : open(direct.app_secret_enc);
  if (input.appId !== undefined || input.appSecret?.trim()) {
    if (!appId || !/^\d{5,25}$/.test(appId)) throw new SocialLeadError(400, "The App ID is the number at the top of your Meta app's dashboard.");
    if (!secret) throw new SocialLeadError(400, "Add the App Secret (Meta app › App settings › Basic).");
    const check = await meta.checkApp(appId, secret);
    if (!check.ok) throw new SocialLeadError(400, check.code === 190 || check.code === 101 || check.code === 803
      ? "Meta did not accept this App ID and App Secret together. Copy both again from the app's App settings › Basic."
      : `Meta did not accept the app: ${check.message}`);
    patch.app_id = appId;
    patch.app_secret_enc = seal(secret);
  }
  if (input.commentReply !== undefined) patch.comment_reply = cleanCommentReply(input.commentReply);
  if (input.active !== undefined) {
    if (input.active) {
      const pages = await pagesFor(actor.orgId, actor.branchId);
      if (!secret || !appId) throw new SocialLeadError(400, "Add the Meta app first (step 1).");
      if (!pages.length) throw new SocialLeadError(400, "Connect at least one Page first (step 3).");
    }
    patch.active = input.active;
    await logEvent(actor.orgId, actor.branchId, "meta.switch", true, { active: input.active, by: actor.name });
  }
  const { error } = await supabase.from("social_lead_meta").update(patch).eq("org_id", actor.orgId).eq("branch_id", actor.branchId);
  if (error) throw error;
  return directView(actor);
}

/** "Connect with Facebook": where to send the Owner. */
export async function connectUrl(actor: Actor) {
  const direct = await directFor(actor.orgId, actor.branchId);
  const secret = open(direct.app_secret_enc);
  if (!direct.app_id || !secret) throw new SocialLeadError(400, "Add the Meta app first (step 1).");
  return { url: meta.loginUrl(direct.app_id, redirectUri(), signState({ o: actor.orgId, b: actor.branchId, u: actor.id, t: Date.now() }, secret)) };
}

/** Meta sends the Owner back here after they approve. Returns where to send the browser. */
export async function connectCallback(query: Record<string, unknown>) {
  const back = (result: string) => `${FRONTEND()}/#/dashboard/admin/social-leads-inbox?tab=settings&section=integrations&meta=${encodeURIComponent(result)}`;
  const peek = readState(String(query.state ?? ""));
  if (!peek) return back("invalid");
  const direct = await directFor(peek.o, peek.b);
  const secret = open(direct.app_secret_enc);
  const state = secret ? stateOk(String(query.state), secret) : null;
  if (!state || !direct.app_id || !secret) return back("expired");
  if (query.error) return back("denied");
  const { data: user } = await supabase.from("users").select("id, name, role, active").eq("org_id", state.o).eq("id", state.u).maybeSingle();
  if (!user || !(user as any).active || !["Owner", "Admin"].includes((user as any).role)) return back("forbidden");
  const token = await meta.codeToLongToken(direct.app_id, secret, String(query.code ?? ""), redirectUri());
  if (!token.ok) { await supabase.from("social_lead_meta").update({ last_error: token.message }).eq("org_id", state.o).eq("branch_id", state.b); return back("failed"); }
  const saved = await savePages({ id: state.u, name: (user as any).name, role: (user as any).role, orgId: state.o, branchId: state.b }, token.data);
  return back(saved.count ? `connected-${saved.count}` : "no-pages");
}

/** Paste a token instead (a system user's, for example). */
export async function connectWithToken(actor: Actor, token: string) {
  const direct = await directFor(actor.orgId, actor.branchId);
  const secret = open(direct.app_secret_enc);
  if (!direct.app_id || !secret) throw new SocialLeadError(400, "Add the Meta app first (step 1).");
  const long = await meta.longToken(direct.app_id, secret, token.trim());
  const saved = await savePages(actor, long.ok ? long.data : token.trim());
  if (!saved.count) throw new SocialLeadError(400, saved.error ?? "This token manages no Page that can send messages.");
  return directView(actor);
}

async function savePages(actor: Actor, userToken: string): Promise<{ count: number; error?: string }> {
  const list = await meta.managedPages(userToken);
  if (!list.ok) return { count: 0, error: list.message };
  // Only Pages this person may message for.
  const pages = list.data.filter((p) => p.access_token && (!p.tasks || p.tasks.includes("MESSAGING") || p.tasks.includes("MANAGE")));
  let count = 0;
  for (const p of pages) {
    const { data: other } = await supabase.from("social_lead_meta_pages").select("org_id, branch_id").eq("page_id", p.id).maybeSingle();
    if (other && ((other as any).org_id !== actor.orgId || (other as any).branch_id !== actor.branchId)) continue; // another branch uses it
    const sub = await meta.subscribePage(p.id, p.access_token);
    const row = {
      org_id: actor.orgId, branch_id: actor.branchId, page_id: p.id, page_name: p.name ?? "", page_token_enc: seal(p.access_token),
      ig_id: p.instagram_business_account?.id ?? null, ig_username: p.instagram_business_account?.username ?? null,
      subscribed: sub.ok && Boolean(sub.data.success), subscribe_error: sub.ok ? null : sub.message, connected_by: actor.id, connected_at: new Date().toISOString()
    };
    const { error } = await supabase.from("social_lead_meta_pages").upsert(row, { onConflict: "page_id" });
    if (error) { logger.warn("meta page save failed", { error: error.message }); continue; }
    count += 1;
  }
  await logEvent(actor.orgId, actor.branchId, "meta.connect", count > 0, { pages: count, by: actor.name });
  return { count, error: count ? undefined : "This login manages no Page that can send messages." };
}

export async function removePage(actor: Actor, id: string) {
  const { data } = await supabase.from("social_lead_meta_pages").select("*").eq("org_id", actor.orgId).eq("branch_id", actor.branchId).eq("id", id).maybeSingle();
  if (!data) throw new SocialLeadError(404, "Page not found.");
  const token = open((data as PageRow).page_token_enc);
  if (token) await meta.unsubscribePage((data as PageRow).page_id, token);
  await supabase.from("social_lead_meta_pages").delete().eq("id", id);
  if (!(await pagesFor(actor.orgId, actor.branchId)).length) await supabase.from("social_lead_meta").update({ active: false }).eq("org_id", actor.orgId).eq("branch_id", actor.branchId);
  await logEvent(actor.orgId, actor.branchId, "meta.disconnect", true, { page: (data as PageRow).page_name, by: actor.name });
  return directView(actor);
}

/** Re-ask Meta to send this Page's events (the button next to a Page). */
export async function resubscribe(actor: Actor, id: string) {
  const { data } = await supabase.from("social_lead_meta_pages").select("*").eq("org_id", actor.orgId).eq("branch_id", actor.branchId).eq("id", id).maybeSingle();
  if (!data) throw new SocialLeadError(404, "Page not found.");
  const token = open((data as PageRow).page_token_enc);
  if (!token) throw new SocialLeadError(400, "The Page key can't be read any more. Connect the Page again.");
  const sub = await meta.subscribePage((data as PageRow).page_id, token);
  await supabase.from("social_lead_meta_pages").update({ subscribed: sub.ok && Boolean(sub.data.success), subscribe_error: sub.ok ? null : sub.message }).eq("id", id);
  if (!sub.ok) throw new SocialLeadError(400, sub.message);
  return directView(actor);
}
