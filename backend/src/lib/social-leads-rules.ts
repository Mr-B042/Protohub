// Social Leads Inbox (Bright, 12 Nov 2026): pure rules, no database.
// See social-leads.ts for the jobs and routes/social-leads.ts for the screens.

export const LEAD_STATUSES = [
  "comment_captured", "dm_sent", "engaged", "new", "in_conversation", "hot", "call_requested",
  "awaiting_customer", "follow_up", "on_hold", "order_created", "delivered", "lost"
] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];
export const isLeadStatus = (value: unknown): value is LeadStatus => LEAD_STATUSES.includes(value as LeadStatus);

/** Statuses a rep still has to work (not converted, delivered or lost). */
export const OPEN_STATUSES: LeadStatus[] = ["comment_captured", "dm_sent", "engaged", "new", "in_conversation", "hot", "call_requested", "awaiting_customer", "follow_up", "on_hold"];
/** Someone a rep can actually message: the customer wrote to the page (a comment alone does not open the chat). */
export const CONTACTABLE: LeadStatus[] = ["engaged", "new", "in_conversation", "hot", "call_requested", "awaiting_customer", "follow_up", "on_hold", "order_created", "delivered"];

export type SlaSettings = { yellow: number; red: number; renotify: number; escalate: number; reassign: number };
export const SLA_DEFAULTS: SlaSettings = { yellow: 2, red: 5, renotify: 10, escalate: 15, reassign: 20 };
export function cleanSla(raw: unknown): SlaSettings {
  const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const pick = (key: keyof SlaSettings) => {
    const n = Number(r[key]);
    return Number.isFinite(n) && n >= 0 && n <= 24 * 60 ? Math.round(n) : SLA_DEFAULTS[key];
  };
  return { yellow: pick("yellow"), red: pick("red"), renotify: pick("renotify"), escalate: pick("escalate"), reassign: pick("reassign") };
}

export type SlaStage = "ok" | "yellow" | "red" | "renotify" | "escalate" | "reassign";
const STAGE_ORDER: SlaStage[] = ["ok", "yellow", "red", "renotify", "escalate", "reassign"];
export const stageRank = (stage: string | null | undefined) => Math.max(0, STAGE_ORDER.indexOf((stage ?? "ok") as SlaStage));

/** Where a waiting customer is on the response clock (working minutes waited). */
export function slaStage(workingMinutes: number, sla: SlaSettings): SlaStage {
  if (workingMinutes >= sla.reassign && sla.reassign > 0) return "reassign";
  if (workingMinutes >= sla.escalate && sla.escalate > 0) return "escalate";
  if (workingMinutes >= sla.renotify && sla.renotify > 0) return "renotify";
  if (workingMinutes >= sla.red) return "red";
  if (workingMinutes >= sla.yellow) return "yellow";
  return "ok";
}

export type Hours = { workStartMinute: number; workEndMinute: number; worksSunday: boolean; workingDays?: number[] };
const LAGOS = 60 * 60_000;

/**
 * Milliseconds of WORKING time between two moments (Lagos hours, no Sunday
 * unless the branch works Sundays). A customer who writes at 10pm starts the
 * rep's clock at opening; the 24-hour messaging window keeps counting in real
 * time (windowLeftMs).
 */
export function workingMsBetween(fromMs: number, toMs: number, hours: Hours): number {
  if (!(toMs > fromMs)) return 0;
  let total = 0;
  const dayMs = 86_400_000;
  // Walk Lagos calendar days.
  let dayStart = Math.floor((fromMs + LAGOS) / dayMs) * dayMs - LAGOS;
  for (let guard = 0; dayStart < toMs && guard < 400; guard += 1, dayStart += dayMs) {
    const dow = new Date(dayStart + LAGOS + 12 * 3_600_000).getUTCDay();
    if (hours.workingDays ? !hours.workingDays.includes(dow) : dow === 0 && !hours.worksSunday) continue;
    const open = dayStart + hours.workStartMinute * 60_000;
    const close = dayStart + hours.workEndMinute * 60_000;
    const a = Math.max(open, fromMs), b = Math.min(close, toMs);
    if (b > a) total += b - a;
  }
  return total;
}

/** Meta lets a page message someone freely for 24 hours after their last message; a person (human agent) for 7 days. */
export const WINDOW_MS = 24 * 3_600_000;
export const HUMAN_AGENT_MS = 7 * 24 * 3_600_000;
export type WindowState = { state: "open" | "human_only" | "closed" | "none"; leftMs: number };
export function messagingWindow(lastCustomerMessageAt: string | null | undefined, nowMs: number): WindowState {
  if (!lastCustomerMessageAt) return { state: "none", leftMs: 0 };
  const since = nowMs - Date.parse(lastCustomerMessageAt);
  if (since < WINDOW_MS) return { state: "open", leftMs: WINDOW_MS - since };
  if (since < HUMAN_AGENT_MS) return { state: "human_only", leftMs: HUMAN_AGENT_MS - since };
  return { state: "closed", leftMs: 0 };
}

/** A Nigerian (or Zambian) phone number written in a message, as 0XXXXXXXXXX. */
export function phoneInText(text: string | null | undefined): string | null {
  const t = String(text ?? "");
  const ng = t.match(/(?:\+?234[\s-]?|0)([789][01]\d(?:[\s-]?\d){7})/);
  if (ng) return `0${ng[1].replace(/\D/g, "")}`;
  const zm = t.match(/(?:\+?260[\s-]?|0)([79]\d(?:[\s-]?\d){7})/);
  if (zm) return `0${zm[1].replace(/\D/g, "")}`;
  return null;
}

const BUY_WORDS = /\b(i\s*(?:want|need|will take|'?ll take)|order|buy|send (?:it|me)|how (?:do|can) i (?:pay|get|order)|pay(?:ment)? on delivery|deliver(?:y)? to|my address|interested|price|how much|available)\b/i;
const STRONG_WORDS = /\b(i\s*(?:want|need) (?:it|one|two|\d)|i(?:'?ll| will) take|place (?:an |my )?order|send (?:it|me)|my address is|deliver (?:it )?to me|how (?:do|can) i pay)\b/i;
export const showsBuyingIntent = (text: string | null | undefined) => BUY_WORDS.test(String(text ?? ""));
export const strongIntent = (text: string | null | undefined) => STRONG_WORDS.test(String(text ?? ""));

/** 0-100: how likely this lead buys. Shown as the Lead Score bar; never hides a lead. */
export function leadScore(lead: {
  engaged: boolean; phone: boolean; state: boolean; product: boolean; hot: boolean;
  customerMessages: string[]; repliedQuickly?: boolean;
}): number {
  let score = 10;
  if (lead.engaged) score += 15;
  if (lead.product) score += 10;
  if (lead.state) score += 10;
  if (lead.phone) score += 20;
  const intent = lead.customerMessages.filter(showsBuyingIntent).length;
  score += Math.min(15, intent * 5);
  if (lead.customerMessages.some(strongIntent)) score += 10;
  if (lead.hot) score += 10;
  return Math.max(0, Math.min(100, score));
}

/** What ManyChat sent, made plain. Accepts "Full Contact Data" bodies and our own keys, plus ?query values. */
export type Inbound = {
  event: "comment" | "message" | "lead" | "bot";
  contactId: string;
  platform: "facebook" | "instagram" | "messenger";
  name: string; profilePic: string | null; instagramUsername: string | null;
  phone: string | null; whatsapp: string | null; email: string | null;
  text: string; comment: string | null;
  product: string | null; campaign: string | null; adId: string | null; adName: string | null;
  state: string | null; liveChatUrl: string | null;
  /** ManyChat's last interaction time: used to drop the same event sent twice. */
  sentAt: string | null;
};

const str = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  // ManyChat leaves an unfilled {{field}} as the literal placeholder.
  return /^\{\{.*\}\}$/.test(s) ? "" : s.slice(0, 4000);
};

export function parseInbound(body: unknown, query: Record<string, unknown> = {}): Inbound | { error: string } {
  const b = body && typeof body === "object" ? body as Record<string, any> : {};
  const custom = b.custom_fields && typeof b.custom_fields === "object" ? b.custom_fields as Record<string, unknown> : {};
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const v = str(query[key]) || str(b[key]) || str(custom[key]);
      if (v) return v;
    }
    return "";
  };
  const contactId = pick("contact_id", "subscriber_id", "id", "user_id");
  if (!contactId || !/^[\w-]{3,64}$/.test(contactId)) return { error: "No ManyChat contact id: add Full Contact Data to the request body." };
  const rawEvent = pick("event", "type").toLowerCase();
  const event: Inbound["event"] = rawEvent === "comment" ? "comment" : rawEvent === "lead" ? "lead" : rawEvent === "bot" ? "bot" : "message";
  const channel = pick("channel", "platform").toLowerCase();
  const platform: Inbound["platform"] = channel.startsWith("insta") || channel === "ig" || (!channel && (str(b.ig_id) || str(b.ig_username)))
    ? "instagram" : channel === "messenger" ? "messenger" : "facebook";
  const first = pick("first_name"), last = pick("last_name");
  const name = pick("name", "full_name") || [first, last].filter(Boolean).join(" ") || (str(b.ig_username) ? `@${str(b.ig_username)}` : "Facebook user");
  const text = pick("text", "message", "last_input_text");
  const comment = event === "comment" ? (pick("comment", "comment_text") || text) : (pick("comment", "comment_text") || null);
  const phone = pick("phone", "optin_phone") || null;
  return {
    event, contactId, platform, name: name.slice(0, 160),
    profilePic: pick("profile_pic", "avatar") || null,
    instagramUsername: str(b.ig_username) || pick("ig_username", "instagram") || null,
    phone, whatsapp: pick("whatsapp_phone", "whatsapp") || null, email: pick("email", "optin_email") || null,
    text: event === "comment" ? (text || comment || "") : text, comment,
    product: pick("product", "product_interest", "keyword") || null,
    campaign: pick("campaign", "campaign_name", "ad_campaign") || null,
    adId: pick("ad_id") || null, adName: pick("ad_name", "ad") || null,
    state: pick("state", "location") || null,
    liveChatUrl: pick("live_chat_url", "inbox_url") || null,
    sentAt: pick("last_interaction", "ig_last_interaction", "sent_at") || null
  };
}

/** Same event sent twice by ManyChat (retries): one row only. */
export function dedupeKey(inbound: Inbound): string {
  const text = `${inbound.event}|${inbound.text}|${inbound.comment ?? ""}`;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return `mc:${inbound.contactId}:${inbound.sentAt ?? "na"}:${(hash >>> 0).toString(36)}`;
}

/** A product named in words ("shelf", "5-in-1 rack") → the closest product name. */
export function matchProduct(words: string | null | undefined, products: Array<{ id: string; name: string }>): { id: string; name: string } | null {
  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const w = fold(String(words ?? ""));
  if (!w) return null;
  let best: { id: string; name: string } | null = null, bestScore = 0;
  for (const product of products) {
    const name = fold(product.name);
    if (!name) continue;
    if (name === w) return product;
    const tokens = w.split(" ").filter((t) => t.length >= 3);
    const score = tokens.filter((t) => name.includes(t)).length + (name.includes(w) ? 2 : 0);
    if (score > bestScore) { best = product; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

/** Status after a customer message arrives. */
export function statusAfterCustomerMessage(current: LeadStatus, opts: { phoneFound: boolean; strong: boolean; event: Inbound["event"] }): LeadStatus {
  if (opts.event === "comment") return current === "comment_captured" || current === "dm_sent" ? current : current;
  if (current === "order_created" || current === "delivered") return current;
  if (opts.phoneFound) return "call_requested";
  if (opts.strong) return "hot";
  if (current === "comment_captured" || current === "dm_sent" || current === "lost") return "engaged";
  if (current === "awaiting_customer") return "in_conversation";
  return current;
}

/** Settings › General, Lead capture, Assignment, Automation controls, Templates (Bright's Settings design). */
export type Prefs = {
  inboxName: string; description: string; businessName: string; timezone: string;
  /** 0 = Sunday … 6 = Saturday. Days leads are handed out and the clock runs. */
  workingDays: number[];
  captureFacebookComments: boolean; captureInstagramComments: boolean; captureMessenger: boolean;
  autoCreate: boolean; preventDuplicates: boolean;
  /** Empty = every rep in the cart hand-out rotation. */
  eligibleRepIds: string[];
  sticky: boolean;
  pauseBotOnAssign: boolean; assignInHoursOnly: boolean; allowRepResumeBot: boolean;
  /** Close a lead as lost after this many days with no customer message (0 = never). */
  autoCloseDays: number;
  hotKeywords: string[];
  /** Schedule a follow-up when the customer has not answered the rep for this many working hours (0 = off). */
  autoFollowUpHours: number;
  templates: Array<{ id: string; title: string; body: string; category: string; kind: "template" | "quick"; updatedAt: string | null }>;
  notifyInApp: boolean; notifyPush: boolean; notifyTelegram: boolean;
  /** Which roles may open the page (Owner always). */
  roles: string[];
  // ── Team & Assignment ──
  distributeByWorkload: boolean; skipInactive: boolean; reassignEnabled: boolean; maxOpenEnabled: boolean;
  // ── Response & SLA ──
  slaRules: SlaRule[];
  escalateOnBreach: boolean; notifyRepeatBreaches: boolean; dailySlaSummary: boolean;
  // ── Working Hours ──
  hoursEnabled: boolean; startMinute: number; endMinute: number;
  offHoursReply: boolean; offHoursMessage: string;
  pendingOffHours: boolean;
  teamSchedules: Array<{ id: string; team: string; days: number[]; start: number; end: number; enabled: boolean }>;
  exceptions: Array<{ id: string; date: string; type: "holiday" | "custom"; description: string; closed: boolean; start: number; end: number; enabled: boolean }>;
  // ── Lead & Conversations ──
  tagOptions: string[];
  customFields: Array<{ key: string; label: string; type: "select" | "text" | "money"; options: string[] }>;
  // ── Notifications ──
  notifyEvents: Record<"newLeads" | "orderAssigned" | "slaBreaches" | "deliveryUpdates" | "followUpReminders" | "teamPerformance" | "stockAlerts" | "announcements", boolean>;
  // ── Templates ──
  templateCategories: string[];
  templateUsage: Record<string, { count: number; lastUsedAt: string | null }>;
  // ── Advanced ──
  dedupeBy: "contact" | "phone";
  mergeDuplicates: boolean;
  liveAutomations: boolean;
  pauseAllAutomations: boolean;
};

/** Response target per kind of lead (Response & SLA design). Minutes; escalation goes to that role. */
export type SlaRule = { key: "new" | "follow_up" | "hot" | "returning"; label: string; first: number; next: number; escalateTo: string; enabled: boolean };
export const DEFAULT_SLA_RULES: SlaRule[] = [
  { key: "new", label: "New Lead (Ad / Inbox)", first: 5, next: 15, escalateTo: "Manager", enabled: true },
  { key: "follow_up", label: "Follow-up", first: 10, next: 30, escalateTo: "Manager", enabled: true },
  { key: "hot", label: "High-Intent Lead (Hot / Buy Signal)", first: 3, next: 10, escalateTo: "Sales Closer", enabled: true },
  { key: "returning", label: "Returning Customer", first: 10, next: 20, escalateTo: "Manager", enabled: true }
];
export const ESCALATION_ROLES = ["Manager", "Admin", "Owner", "Sales Closer", "Head of Sales"];

export const DEFAULT_TEMPLATES: Prefs["templates"] = [
  { id: "welcome", title: "Welcome Message", category: "Greeting & Welcome", kind: "template", updatedAt: null, body: "Hello {customer_name}! 👋 Thank you for your interest in our {product_name}. How can I help you today?" },
  { id: "availability", title: "Product Availability", category: "Product Inquiry", kind: "template", updatedAt: null, body: "Yes, the {product_name} is available ✅ We deliver to your state and you pay when it arrives." },
  { id: "price", title: "Price & Offer", category: "Pricing & Offer", kind: "template", updatedAt: null, body: "Great choice! 🎉 The {product_name} is {price} today. Would you like to place an order now?" },
  { id: "delivery", title: "Delivery & Timeline", category: "Order & Delivery", kind: "template", updatedAt: null, body: "We can deliver to you in {delivery_time}. Please send your full name, phone number and delivery address with a landmark." },
  { id: "followup", title: "Follow-up (No Response)", category: "Follow-up & Nurture", kind: "template", updatedAt: null, body: "Hello {customer_name}, just checking in about the {product_name}. Would you like us to deliver it this week?" },
  { id: "expensive", title: "Objection – Too Expensive", category: "Objection Handling", kind: "template", updatedAt: null, body: "I understand. Many customers felt the same until they used it 🙂 You only pay when it arrives, so there is no risk to you." },
  { id: "upsell", title: "Upsell – Add Another Item", category: "Upsell & Cross-sell", kind: "template", updatedAt: null, body: "Most customers take 2 so they have one for each room. Would you like to add another for a better price?" },
  { id: "confirm", title: "Order Confirmation", category: "Payment & Confirmation", kind: "template", updatedAt: null, body: "Thank you {customer_name}! Your order {order_id} is confirmed. Our delivery team will call you before they arrive." },
  { id: "q-hello", title: "Hello", category: "Greeting & Welcome", kind: "quick", updatedAt: null, body: "Hello {customer_name}! How can I help you? 😊" },
  { id: "q-phone", title: "Ask for phone", category: "Order & Delivery", kind: "quick", updatedAt: null, body: "Please send your phone number so our delivery team can reach you 🙏" },
  { id: "q-address", title: "Ask for address", category: "Order & Delivery", kind: "quick", updatedAt: null, body: "Please send your delivery address with a landmark." },
  { id: "q-thanks", title: "Thank you", category: "Miscellaneous", kind: "quick", updatedAt: null, body: "Thank you! 🙏" }
];

export const PREF_DEFAULTS: Prefs = {
  inboxName: "ProtoHub Social Leads Inbox",
  description: "Manage leads from Facebook & Instagram (via Manychat), assign to call reps and convert to orders.",
  businessName: "ProtoHub", timezone: "Africa/Lagos", workingDays: [1, 2, 3, 4, 5, 6],
  captureFacebookComments: true, captureInstagramComments: true, captureMessenger: true, autoCreate: true, preventDuplicates: true,
  eligibleRepIds: [], sticky: true, pauseBotOnAssign: true, assignInHoursOnly: true, allowRepResumeBot: true,
  autoCloseDays: 7, hotKeywords: ["buy", "order", "i want"], autoFollowUpHours: 0,
  templates: DEFAULT_TEMPLATES, notifyInApp: true, notifyPush: true, notifyTelegram: true,
  roles: ["Owner", "Admin", "Manager", "Sales Rep"],
  distributeByWorkload: false, skipInactive: true, reassignEnabled: true, maxOpenEnabled: false,
  slaRules: DEFAULT_SLA_RULES, escalateOnBreach: true, notifyRepeatBreaches: true, dailySlaSummary: false,
  hoursEnabled: true, startMinute: 8 * 60 + 30, endMinute: 17 * 60,
  offHoursReply: false,
  offHoursMessage: "👋 Thanks for reaching out! Our team is offline right now. We're open Mon – Sat, 8:30 AM – 5:00 PM (WAT) and will reply as soon as we're back.",
  pendingOffHours: true,
  teamSchedules: [
    { id: "reps", team: "Sales Reps", days: [1, 2, 3, 4, 5, 6], start: 510, end: 1020, enabled: true },
    { id: "closer", team: "Sales Closer", days: [1, 2, 3, 4, 5, 6], start: 540, end: 1080, enabled: true },
    { id: "recovery", team: "Recovery / Retention", days: [1, 2, 3, 4, 5, 6], start: 540, end: 1080, enabled: true },
    { id: "logistics", team: "Logistics & Dispatch", days: [1, 2, 3, 4, 5, 6], start: 480, end: 1020, enabled: true }
  ],
  exceptions: [
    { id: "xmas", date: "2026-12-25", type: "holiday", description: "Christmas Day", closed: true, start: 0, end: 0, enabled: true },
    { id: "boxing", date: "2026-12-26", type: "custom", description: "Boxing Day (Limited Support)", closed: false, start: 600, end: 960, enabled: true },
    { id: "newyear", date: "2027-01-01", type: "holiday", description: "New Year's Day", closed: true, start: 0, end: 0, enabled: true }
  ],
  tagOptions: ["Promo", "Lagos", "Price question", "Delivery question", "Repeat buyer"],
  customFields: [
    // Keys without "_": the browser renames snake_case keys on the way in.
    { key: "intent", label: "Order Intent", type: "select", options: ["Just asking", "Interested", "Ready to Buy"] },
    { key: "budget", label: "Budget", type: "money", options: [] }
  ],
  notifyEvents: { newLeads: true, orderAssigned: true, slaBreaches: true, deliveryUpdates: true, followUpReminders: true, teamPerformance: true, stockAlerts: true, announcements: true },
  templateCategories: ["Greeting & Welcome", "Product Inquiry", "Pricing & Offer", "Order & Delivery", "Follow-up & Nurture", "Objection Handling", "Upsell & Cross-sell", "Payment & Confirmation", "Miscellaneous"],
  templateUsage: {},
  dedupeBy: "contact", mergeDuplicates: true, liveAutomations: true, pauseAllAutomations: false
};

const PAGE_ROLES = ["Owner", "Admin", "Manager", "Sales Rep"];
/** {customer_name} / {product_name} / {price} / {delivery_time} / {order_id} (and the older {name} / {product}). */
export function fillTemplate(body: string, values: { name?: string | null; product?: string | null; price?: string | null; deliveryTime?: string | null; orderId?: string | null }) {
  const first = (values.name ?? "").trim().split(/\s+/)[0] || "there";
  return body
    .replace(/\{(customer_name|name)\}/g, first).replace(/\{(product_name|product)\}/g, values.product || "product")
    .replace(/\{price\}/g, values.price || "the price").replace(/\{delivery_time\}/g, values.deliveryTime || "1–3 working days").replace(/\{order_id\}/g, values.orderId || "");
}

export function cleanPrefs(raw: unknown): Prefs {
  const r = raw && typeof raw === "object" ? raw as Record<string, any> : {};
  const d = PREF_DEFAULTS;
  const bool = (key: keyof Prefs) => (typeof r[key] === "boolean" ? r[key] : d[key]) as boolean;
  const text = (key: keyof Prefs, max: number) => (typeof r[key] === "string" ? String(r[key]).slice(0, max) : d[key]) as string;
  const num = (key: keyof Prefs, max: number) => { const n = Number(r[key]); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : d[key] as number; };
  const days = Array.isArray(r.workingDays) ? [...new Set(r.workingDays.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() as number[] : d.workingDays;
  const templates = Array.isArray(r.templates)
    ? r.templates.filter((t: any) => t && typeof t.body === "string" && t.body.trim()).slice(0, 60).map((t: any, i: number) => ({
      id: String(t.id ?? `t${i}`).slice(0, 40), title: String(t.title ?? "Reply").slice(0, 60), body: String(t.body).slice(0, 1000), category: String(t.category ?? "Miscellaneous").slice(0, 40),
      kind: t.kind === "quick" ? "quick" as const : "template" as const, updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : null
    }))
    : d.templates;
  return {
    inboxName: text("inboxName", 80), description: text("description", 300), businessName: text("businessName", 80), timezone: text("timezone", 60),
    workingDays: days.length ? days : d.workingDays,
    captureFacebookComments: bool("captureFacebookComments"), captureInstagramComments: bool("captureInstagramComments"), captureMessenger: bool("captureMessenger"),
    autoCreate: bool("autoCreate"), preventDuplicates: bool("preventDuplicates"),
    eligibleRepIds: Array.isArray(r.eligibleRepIds) ? r.eligibleRepIds.filter((x: unknown) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200) : d.eligibleRepIds,
    sticky: bool("sticky"), pauseBotOnAssign: bool("pauseBotOnAssign"), assignInHoursOnly: bool("assignInHoursOnly"), allowRepResumeBot: bool("allowRepResumeBot"),
    autoCloseDays: num("autoCloseDays", 365), autoFollowUpHours: num("autoFollowUpHours", 240),
    hotKeywords: Array.isArray(r.hotKeywords) ? [...new Set(r.hotKeywords.map((k: unknown) => String(k).trim().toLowerCase()).filter((k: string) => k.length >= 2 && k.length <= 40))].slice(0, 30) as string[] : d.hotKeywords,
    templates, notifyInApp: bool("notifyInApp"), notifyPush: bool("notifyPush"), notifyTelegram: bool("notifyTelegram"),
    roles: Array.isArray(r.roles) ? ["Owner", ...r.roles.filter((x: unknown) => typeof x === "string" && PAGE_ROLES.includes(x) && x !== "Owner")] : d.roles,
    distributeByWorkload: bool("distributeByWorkload"), skipInactive: bool("skipInactive"), reassignEnabled: bool("reassignEnabled"), maxOpenEnabled: bool("maxOpenEnabled"),
    slaRules: DEFAULT_SLA_RULES.map((def) => {
      const saved = Array.isArray(r.slaRules) ? r.slaRules.find((x: any) => x?.key === def.key) : null;
      const mins = (v: unknown, fb: number) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 1440 ? Math.round(n) : fb; };
      return saved ? { ...def, first: mins(saved.first, def.first), next: mins(saved.next, def.next), escalateTo: ESCALATION_ROLES.includes(saved.escalateTo) ? saved.escalateTo : def.escalateTo, enabled: saved.enabled !== false } : def;
    }),
    escalateOnBreach: bool("escalateOnBreach"), notifyRepeatBreaches: bool("notifyRepeatBreaches"), dailySlaSummary: bool("dailySlaSummary"),
    hoursEnabled: bool("hoursEnabled"),
    startMinute: num("startMinute", 1439), endMinute: Math.max(num("startMinute", 1439) + 30, num("endMinute", 1440)),
    offHoursReply: bool("offHoursReply"), offHoursMessage: text("offHoursMessage", 600), pendingOffHours: bool("pendingOffHours"),
    teamSchedules: Array.isArray(r.teamSchedules) ? r.teamSchedules.slice(0, 20).map((t: any, i: number) => ({
      id: String(t?.id ?? `t${i}`).slice(0, 40), team: String(t?.team ?? "Team").slice(0, 60),
      days: Array.isArray(t?.days) ? [...new Set(t.days.map(Number).filter((n: number) => n >= 0 && n <= 6))].sort() as number[] : [1, 2, 3, 4, 5, 6],
      start: Math.max(0, Math.min(1439, Number(t?.start) || 510)), end: Math.max(0, Math.min(1440, Number(t?.end) || 1020)), enabled: t?.enabled !== false
    })) : d.teamSchedules,
    exceptions: Array.isArray(r.exceptions) ? r.exceptions.filter((x: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(x?.date ?? ""))).slice(0, 60).map((x: any, i: number) => ({
      id: String(x.id ?? `x${i}`).slice(0, 40), date: String(x.date), type: x.type === "custom" ? "custom" as const : "holiday" as const, description: String(x.description ?? "").slice(0, 80),
      closed: x.closed !== false, start: Math.max(0, Math.min(1439, Number(x.start) || 0)), end: Math.max(0, Math.min(1440, Number(x.end) || 0)), enabled: x.enabled !== false
    })) : d.exceptions,
    tagOptions: Array.isArray(r.tagOptions) ? [...new Set(r.tagOptions.map((t: unknown) => String(t).trim()).filter((t: string) => t && t.length <= 30))].slice(0, 50) as string[] : d.tagOptions,
    customFields: Array.isArray(r.customFields) ? r.customFields.slice(0, 20).map((f: any, i: number) => ({
      key: String(f?.key ?? `field${i}`).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40) || `field${i}`, label: String(f?.label ?? "Field").slice(0, 40),
      type: f?.type === "select" ? "select" as const : f?.type === "money" ? "money" as const : "text" as const,
      options: Array.isArray(f?.options) ? f.options.map((o: unknown) => String(o).slice(0, 40)).filter(Boolean).slice(0, 20) : []
    })) : d.customFields,
    notifyEvents: Object.fromEntries(Object.entries(d.notifyEvents).map(([k, v]) => [k, typeof r.notifyEvents?.[k] === "boolean" ? r.notifyEvents[k] : v])) as Prefs["notifyEvents"],
    templateCategories: Array.isArray(r.templateCategories) ? [...new Set(r.templateCategories.map((t: unknown) => String(t).trim()).filter(Boolean))].slice(0, 30) as string[] : d.templateCategories,
    templateUsage: r.templateUsage && typeof r.templateUsage === "object" ? Object.fromEntries(Object.entries(r.templateUsage).slice(0, 200).map(([k, v]: [string, any]) => [k.slice(0, 40), { count: Math.max(0, Number(v?.count) || 0), lastUsedAt: typeof v?.lastUsedAt === "string" ? v.lastUsedAt : null }])) : {},
    dedupeBy: r.dedupeBy === "phone" ? "phone" : "contact", mergeDuplicates: bool("mergeDuplicates"), liveAutomations: bool("liveAutomations"), pauseAllAutomations: bool("pauseAllAutomations")
  };
}

/** Which SLA rule applies: hot beats follow-up beats returning beats new. */
export function slaRuleFor(lead: { hot?: boolean; status?: string; next_follow_up_at?: string | null; returning?: boolean }, rules: SlaRule[]): SlaRule | null {
  const pick = (key: SlaRule["key"]) => rules.find((r) => r.key === key && r.enabled) ?? null;
  if (lead.hot || lead.status === "hot") return pick("hot") ?? pick("new");
  if (lead.status === "follow_up" || lead.next_follow_up_at) return pick("follow_up") ?? pick("new");
  if (lead.returning) return pick("returning") ?? pick("new");
  return pick("new");
}

/**
 * The clock for one waiting customer: the rule's minutes (first reply, or
 * later replies once answered before) set red; yellow at half, the rep is
 * nudged at 1.5x, the escalation at 2x; another rep after the global minutes.
 */
export function slaFor(rule: SlaRule | null, answeredBefore: boolean, global: SlaSettings): SlaSettings {
  if (!rule) return global;
  const red = answeredBefore ? rule.next : rule.first;
  return { yellow: Math.max(1, Math.round(red / 2)), red, renotify: Math.round(red * 1.5), escalate: red * 2, reassign: global.reassign ? Math.max(global.reassign, red * 2 + 1) : 0 };
}

/** A holiday / special day from Settings for a Lagos date, if switched on. */
export const exceptionFor = (prefs: Pick<Prefs, "exceptions">, dateKey: string) => prefs.exceptions.find((x) => x.enabled && x.date === dateKey) ?? null;

/** Owner's own "hot" words (Settings) on top of the built-in buying phrases. */
export function hotByKeywords(text: string | null | undefined, keywords: string[]) {
  const t = ` ${String(text ?? "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ")} `;
  return keywords.some((k) => t.includes(` ${k.toLowerCase()} `));
}

/** Days the branch works, from Settings (overrides Sunday in the cart rules). */
export function hoursWithDays(hours: Hours, workingDays: number[]): Hours & { workingDays: number[] } {
  return { ...hours, worksSunday: workingDays.includes(0), workingDays };
}
