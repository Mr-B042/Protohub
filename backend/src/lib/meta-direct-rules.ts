import { createHmac, timingSafeEqual } from "node:crypto";

// Direct Meta (free) — pure rules, no database (Bright, 13 Nov 2026).
// Facebook Page + Instagram events in, Send API messages out. The webhook
// shapes and the once-per-comment private reply follow Meta's docs and the
// approach OpenReply (MIT, github.com/diwenne/openreply) proved for Instagram.

export type MetaObject = "page" | "instagram";

export type MetaMessageEvent = {
  kind: "message"; object: MetaObject; accountId: string; userId: string; mid: string;
  text: string; imageUrls: string[]; adId: string | null; adTitle: string | null; at: number;
};
export type MetaCommentEvent = {
  kind: "comment"; object: MetaObject; accountId: string; userId: string; userName: string | null;
  commentId: string; text: string; postId: string | null; adId: string | null; isReply: boolean; at: number;
};
export type MetaEvent = MetaMessageEvent | MetaCommentEvent;

const s = (v: unknown, max = 4000) => (v === null || v === undefined ? "" : String(v).trim().slice(0, max));
const id = (v: unknown) => { const t = s(v, 64); return /^[\w.-]{1,64}$/.test(t) ? t : ""; };

/** Every usable event in one webhook delivery. Own messages, echoes, edits and deletes are left out. */
export function parseMetaWebhook(payload: unknown): MetaEvent[] {
  const p = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const object: MetaObject | null = p.object === "page" ? "page" : p.object === "instagram" ? "instagram" : null;
  if (!object || !Array.isArray(p.entry)) return [];
  const out: MetaEvent[] = [];
  for (const entry of p.entry as any[]) {
    const accountId = id(entry?.id);
    if (!accountId) continue;
    const entryTime = Number(entry?.time) || Date.now();
    for (const m of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const userId = id(m?.sender?.id);
      if (!userId || userId === accountId) continue;
      const at = Number(m?.timestamp) || entryTime;
      const referral = m?.message?.referral ?? m?.referral ?? m?.postback?.referral ?? null;
      const adId = id(referral?.ad_id) || null;
      const adTitle = s(referral?.ads_context_data?.ad_title, 200) || null;
      if (m?.message) {
        const msg = m.message;
        if (msg.is_echo || msg.is_deleted || msg.is_unsupported) continue;
        const mid = s(msg.mid, 300);
        if (!mid) continue;
        const imageUrls = (Array.isArray(msg.attachments) ? msg.attachments : [])
          .filter((a: any) => a?.type === "image" && /^https:\/\//.test(s(a?.payload?.url, 2000))).map((a: any) => s(a.payload.url, 2000));
        const text = s(msg.text) || s(msg.quick_reply?.payload, 500);
        if (!text && !imageUrls.length && !adId) continue;
        out.push({ kind: "message", object, accountId, userId, mid, text, imageUrls, adId, adTitle, at });
      } else if (m?.postback) {
        // A button tap reads like the customer typed the button's words.
        const mid = s(m.postback.mid, 300) || `pb-${userId}-${at}`;
        const text = s(m.postback.title, 500) || s(m.postback.payload, 500);
        if (text) out.push({ kind: "message", object, accountId, userId, mid, text, imageUrls: [], adId, adTitle, at });
      }
    }
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = change?.value ?? {};
      if (object === "page") {
        if (change?.field !== "feed" || v.item !== "comment" || v.verb !== "add") continue;
        const userId = id(v.from?.id), commentId = id(v.comment_id);
        if (!userId || !commentId || userId === accountId) continue;
        const postId = id(v.post_id) || null;
        const parent = id(v.parent_id);
        out.push({ kind: "comment", object, accountId, userId, userName: s(v.from?.name, 160) || null, commentId, text: s(v.message), postId,
          adId: null, isReply: Boolean(parent && parent !== postId), at: (Number(v.created_time) || entryTime / 1000) * 1000 });
      } else {
        if (change?.field !== "comments") continue;
        const userId = id(v.from?.id), commentId = id(v.id ?? v.comment_id);
        if (!userId || !commentId || userId === accountId) continue;
        out.push({ kind: "comment", object, accountId, userId, userName: s(v.from?.username, 160) || null, commentId, text: s(v.text),
          postId: id(v.media?.original_media_id) || id(v.media?.id) || null, adId: id(v.media?.ad_id) || null, isReply: Boolean(id(v.parent_id)), at: entryTime });
      }
    }
  }
  return out;
}

/** Meta signs every delivery with the app secret (X-Hub-Signature-256). */
export function signatureOk(raw: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(raw).digest("hex")}`;
  const a = Buffer.from(header), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The "Connect with Facebook" round trip carries who started it, signed, for 10 minutes. */
export type ConnectState = { o: string; b: string; u: string; t: number };
export function signState(state: ConnectState, secret: string) {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function readState(raw: string): ConnectState | null {
  const [body] = String(raw ?? "").split(".");
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof parsed?.o === "string" && typeof parsed?.b === "string" && typeof parsed?.u === "string" && Number.isFinite(parsed?.t) ? parsed : null;
  } catch { return null; }
}
export function stateOk(raw: string, secret: string, nowMs = Date.now()): ConnectState | null {
  const [body, sig] = String(raw ?? "").split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const state = readState(raw);
  if (!state) return null;
  const age = nowMs - state.t;
  return age >= 0 && age <= 10 * 60_000 ? state : null;
}

// ── Comment auto-reply ─────────────────────────────────────────────────────

export type CommentReply = {
  enabled: boolean;
  /** Empty = every comment. Otherwise whole words / phrases, any of them. */
  keywords: string[];
  message: string;
  publicReply: boolean;
  /** Rotated so the replies under a post don't all look the same. */
  publicMessages: string[];
  /** Replies to replies (people talking to each other) are left alone. */
  skipThreadReplies: boolean;
};

export const COMMENT_REPLY_DEFAULT: CommentReply = {
  enabled: false,
  keywords: [],
  message: "Hi {{first_name}} 👋 thanks for your comment! Reply here and we'll send you the price and how delivery works.",
  publicReply: false,
  publicMessages: ["Sent you a message 📩", "Check your inbox 😊", "We've sent you the details in a message 👍"],
  skipThreadReplies: true
};

export function cleanCommentReply(raw: unknown): CommentReply {
  const r = raw && typeof raw === "object" ? raw as Record<string, any> : {};
  const d = COMMENT_REPLY_DEFAULT;
  const list = (v: unknown, max: number, len: number) => Array.isArray(v)
    ? [...new Set(v.map((x) => s(x, len)).filter(Boolean))].slice(0, max) : null;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    keywords: Array.isArray(r.keywords) ? list(r.keywords.map((k: unknown) => s(k, 60).toLowerCase()), 30, 60)! : d.keywords,
    message: typeof r.message === "string" && r.message.trim() ? s(r.message, 1000) : d.message,
    publicReply: typeof r.publicReply === "boolean" ? r.publicReply : d.publicReply,
    publicMessages: list(r.publicMessages, 10, 300) ?? d.publicMessages,
    skipThreadReplies: typeof r.skipThreadReplies === "boolean" ? r.skipThreadReplies : d.skipThreadReplies
  };
}

const norm = (t: string) => t.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Whole-word match: "price" hits "Price?" and "what's the price" but not "priceless". */
export function keywordHit(text: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const hay = ` ${norm(text)} `;
  return keywords.some((k) => { const n = norm(k); return Boolean(n) && hay.includes(` ${n} `); });
}

/** Should this comment get the automatic private message? Returns why not, or null. */
export function commentReplyBlock(cfg: CommentReply, event: MetaCommentEvent): string | null {
  if (!cfg.enabled) return "Comment auto-reply is off";
  if (cfg.skipThreadReplies && event.isReply) return "Reply inside a comment thread";
  if (!keywordHit(event.text, cfg.keywords)) return "No keyword in the comment";
  return null;
}

export function pickPublic(cfg: CommentReply, seed: string): string | null {
  if (!cfg.publicReply || !cfg.publicMessages.length) return null;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return cfg.publicMessages[Math.abs(h) % cfg.publicMessages.length];
}

/** Meta's private reply is allowed for 7 days after the comment. */
export const PRIVATE_REPLY_MS = 7 * 24 * 3_600_000;
export const privateReplyOpen = (commentAt: string | null | undefined, nowMs = Date.now()) =>
  Boolean(commentAt) && nowMs - Date.parse(String(commentAt)) < PRIVATE_REPLY_MS;

// ── Outgoing ──────────────────────────────────────────────────────────────

export type OutMessage =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "cards"; elements: Array<{ title: string; subtitle?: string; image_url?: string; buttons?: Array<{ type: "url"; caption: string; url: string }> }>; image_aspect_ratio?: "horizontal" | "square" };

/** Protohub's message shapes → Meta Send API "message" objects (same for Messenger and Instagram). */
export function toGraphMessage(m: OutMessage): Record<string, unknown> {
  if (m.type === "text") return { text: m.text.slice(0, 2000) };
  if (m.type === "image") return { attachment: { type: "image", payload: { url: m.url, is_reusable: true } } };
  return {
    attachment: { type: "template", payload: { template_type: "generic", image_aspect_ratio: m.image_aspect_ratio ?? "horizontal", elements: m.elements.slice(0, 10).map((e) => ({
      title: e.title.slice(0, 80), ...(e.subtitle ? { subtitle: e.subtitle.slice(0, 80) } : {}), ...(e.image_url ? { image_url: e.image_url } : {}),
      ...(e.buttons?.length ? { buttons: e.buttons.slice(0, 3).map((b) => ({ type: "web_url", url: b.url, title: b.caption.slice(0, 20) })) } : {})
    })) } }
  };
}

/** Lead contact ids: fb_<PSID>, ig_<IGSID>; a commenter not yet messaged is fbc_/igc_<id>. */
export const contactIdFor = (object: MetaObject, userId: string, fromComment: boolean) =>
  `${object === "page" ? "fb" : "ig"}${fromComment ? "c" : ""}_${userId}`;

/** Meta's error → plain words for the rep. */
export function plainMetaError(code: number | undefined, subcode: number | undefined, message: string): string {
  if (code === 190) return "Meta no longer accepts the Page key. Reconnect the Page in Social Leads › Settings › Direct Meta.";
  if (code === 10 && subcode === 2018278) return "The customer's 24-hour window has closed, so Meta does not allow this message.";
  if (code === 10 || code === 200 || code === 230) return "Meta has not given the app permission to message for this Page yet (App Review or Page role).";
  if (code === 551) return "This person can't get messages from the Page right now.";
  if (code === 100 && /comment|private repl/i.test(message)) return "This comment has already had its one private reply, or it is older than 7 days.";
  if (code === 4 || code === 613 || code === 32) return "Meta's sending limit was reached. Try again in a few minutes.";
  if (/another app|thread owner|handover/i.test(message)) return "Another app (for example ManyChat) controls this Page's chats. Give Protohub control in Meta Business Suite › Inbox settings.";
  return message ? `Meta: ${message.slice(0, 200)}` : "Meta returned an error.";
}
