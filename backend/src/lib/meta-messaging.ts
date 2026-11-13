import { plainMetaError, toGraphMessage, type OutMessage } from "./meta-direct-rules.js";

// Meta Graph calls for Direct Meta (Social Leads, 13 Nov 2026): connect Pages,
// send Messenger / Instagram messages, private + public replies to comments.
// META_GRAPH_BASE points the local sandbox at a stand-in; never set in production.

const VERSION = (process.env.META_GRAPH_VERSION || "v23.0").replace(/^\/+|\/+$/g, "");
const ROOT = (process.env.META_GRAPH_BASE || "https://graph.facebook.com").replace(/\/+$/, "");
const GRAPH = `${ROOT}/${VERSION}`;
const DIALOG = process.env.META_GRAPH_BASE ? `${ROOT}/dialog/oauth` : `https://www.facebook.com/${VERSION}/dialog/oauth`;

type Result<T> = { ok: true; data: T } | { ok: false; message: string; code?: number };

async function graph<T>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string>, body?: unknown): Promise<Result<T>> {
  const url = new URL(`${GRAPH}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const response = await fetch(url, {
      method, signal: AbortSignal.timeout(20_000),
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const json: any = await response.json().catch(() => ({}));
    if (!response.ok || json?.error) {
      const e = json?.error ?? {};
      return { ok: false, code: e.code, message: plainMetaError(e.code, e.error_subcode, String(e.error_user_msg || e.message || "")) };
    }
    return { ok: true, data: json as T };
  } catch (error: any) {
    return { ok: false, message: error?.name === "TimeoutError" ? "Meta did not answer in 20 seconds." : "Could not reach Meta." };
  }
}

/** Permissions asked for on "Connect with Facebook". */
export const SCOPES = [
  "pages_show_list", "pages_messaging", "pages_read_engagement", "pages_manage_metadata", "pages_read_user_content", "pages_manage_engagement",
  "instagram_basic", "instagram_manage_messages", "instagram_manage_comments", "business_management"
];

export const loginUrl = (appId: string, redirectUri: string, state: string) =>
  `${DIALOG}?${new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, scope: SCOPES.join(","), response_type: "code" })}`;

/** App ID + secret belong together? (An app token can read its own app.) */
export const checkApp = (appId: string, appSecret: string) =>
  graph<{ id: string; name: string }>("GET", appId, { fields: "id,name", access_token: `${appId}|${appSecret}` });

export async function codeToLongToken(appId: string, appSecret: string, code: string, redirectUri: string): Promise<Result<string>> {
  const short = await graph<{ access_token: string }>("GET", "oauth/access_token", { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
  if (!short.ok) return short;
  return longToken(appId, appSecret, short.data.access_token);
}

/** A person's token → 60-day token; Page keys read with it never expire. */
export async function longToken(appId: string, appSecret: string, token: string): Promise<Result<string>> {
  const long = await graph<{ access_token: string }>("GET", "oauth/access_token", { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: token });
  return long.ok ? { ok: true, data: long.data.access_token } : long;
}

export type MetaPage = { id: string; name: string; access_token: string; tasks?: string[]; instagram_business_account?: { id: string; username?: string } };
/** The Pages this person (or system user) manages, with their keys and linked Instagram accounts. */
export async function managedPages(userToken: string): Promise<Result<MetaPage[]>> {
  const pages: MetaPage[] = [];
  let after = "";
  for (let i = 0; i < 10; i += 1) {
    const r = await graph<{ data: MetaPage[]; paging?: { cursors?: { after?: string }; next?: string } }>("GET", "me/accounts",
      { fields: "id,name,access_token,tasks,instagram_business_account{id,username}", limit: "100", access_token: userToken, ...(after ? { after } : {}) });
    if (!r.ok) return r;
    pages.push(...(r.data.data ?? []));
    after = r.data.paging?.next ? r.data.paging?.cursors?.after ?? "" : "";
    if (!after) break;
  }
  return { ok: true, data: pages };
}

/** Ask Meta to send this Page's comments and messages to the app's webhook. */
export const subscribePage = (pageId: string, pageToken: string) =>
  graph<{ success: boolean }>("POST", `${pageId}/subscribed_apps`, { subscribed_fields: "feed,messages,messaging_postbacks,messaging_referrals", access_token: pageToken });
export const unsubscribePage = (pageId: string, pageToken: string) =>
  graph<{ success: boolean }>("DELETE", `${pageId}/subscribed_apps`, { access_token: pageToken });

/**
 * Send one message. `to` is a PSID / IGSID, or { commentId } for the one
 * private reply a comment allows. humanAgent = a person writing 1–7 days
 * after the customer's last message.
 */
export async function sendMessage(pageToken: string, to: { userId: string } | { commentId: string }, message: OutMessage, humanAgent = false) {
  const recipient = "commentId" in to ? { comment_id: to.commentId } : { id: to.userId };
  const body: Record<string, unknown> = { recipient, message: toGraphMessage(message) };
  if ("commentId" in to) { /* private replies carry no messaging_type */ }
  else if (humanAgent) Object.assign(body, { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" });
  else body.messaging_type = "RESPONSE";
  return graph<{ recipient_id?: string; message_id?: string }>("POST", "me/messages", { access_token: pageToken }, body);
}

/** Public reply under the comment (Facebook: /comments, Instagram: /replies). */
export const publicReply = (pageToken: string, object: "page" | "instagram", commentId: string, text: string) =>
  graph<{ id: string }>("POST", `${commentId}/${object === "page" ? "comments" : "replies"}`, { access_token: pageToken }, { message: text.slice(0, 2000) });

/** Name and picture of someone who wrote to the Page (Meta only answers after they messaged). */
export async function profile(pageToken: string, object: "page" | "instagram", userId: string) {
  const r = await graph<{ first_name?: string; last_name?: string; name?: string; username?: string; profile_pic?: string }>("GET", userId,
    { fields: object === "page" ? "first_name,last_name,profile_pic" : "name,username,profile_pic", access_token: pageToken });
  if (!r.ok) return null;
  const d = r.data;
  return { name: d.name || [d.first_name, d.last_name].filter(Boolean).join(" ") || (d.username ? `@${d.username}` : ""), username: d.username ?? null, pic: d.profile_pic ?? null };
}
