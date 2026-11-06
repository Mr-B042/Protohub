// ── Telegram Automation Center: pure rules (Bright, 6 Nov 2026) ────────────
// What can start a message, who gets it, and what it says. No database here,
// so it can be tested; lib/telegram.ts does the sending.

import { tgEscape, type TgButton, type TgKeyboard } from "./telegram-api.js";

export const TELEGRAM_ROLES = [
  "Owner", "Admin", "Manager", "Sales Rep", "Recovery Rep", "Sales Closer",
  "Inventory Manager", "Inventory Manager & Logistics Operations", "Marketer"
] as const;

/** Roles that may see a customer's name, phone and the order amount. */
const CUSTOMER_ROLES = new Set(["Owner", "Admin", "Manager", "Sales Rep", "Recovery Rep", "Sales Closer"]);
/** Revenue is strictly for the Owner, Admins and Managers (Bright, 6 Nov 2026). */
const REVENUE_ROLES = new Set(["Owner", "Admin", "Manager"]);
/** Ad spend and cost per order: the Owner and Admins. */
const BUSINESS_MONEY_ROLES = new Set(["Owner", "Admin"]);
export const seesCustomer = (role: string | null | undefined) => CUSTOMER_ROLES.has(String(role ?? ""));
export const seesRevenue = (role: string | null | undefined) => REVENUE_ROLES.has(String(role ?? ""));
export const seesBusinessMoney = (role: string | null | undefined) => BUSINESS_MONEY_ROLES.has(String(role ?? ""));

/** Short names on chips: the design says "Logistics", "Inventory". */
export const ROLE_SHORT: Record<string, string> = {
  "Inventory Manager & Logistics Operations": "Logistics",
  "Inventory Manager": "Inventory"
};

export type TriggerKey =
  | "order_new" | "order_assigned" | "order_confirmed" | "order_delivered" | "order_failed" | "order_cancelled" | "order_rescheduled"
  | "cart_assigned" | "send_out_soon" | "follow_up_due" | "low_stock" | "daily_report" | "weekly_report" | "weekly_rep_note";

/** Reports carry company-wide figures: leadership only (Bright, 6 Nov 2026). */
export const LEADERSHIP_ROLES = ["Owner", "Admin", "Manager"];
/**
 * Reps only ever hear about their OWN orders and carts (Bright, 6 Nov 2026:
 * "each sales rep sees their own specific orders, not general info"). They
 * cannot be named by role or by hand on an automation; they get its message
 * only as "the order's own rep".
 */
export const REP_ROLES = ["Sales Rep", "Recovery Rep", "Sales Closer"];
export const isRepRole = (role: string | null | undefined) => REP_ROLES.includes(String(role ?? ""));
/** The weekly late & fines note: each sales rep gets their own. */
const REP_NOTE_ROLES = ["Sales Rep"];

/** Message kinds that are not automations but still go in the log. */
export type OtherKind = "announcement" | "app_alert" | "test" | "command";

export type PerformanceGroup = "new_orders" | "follow_ups" | "delivery" | "stock" | "reports";

export const PERFORMANCE_GROUPS: Array<{ key: PerformanceGroup; label: string }> = [
  { key: "new_orders", label: "New Order Alerts" },
  { key: "follow_ups", label: "Follow-up Reminders" },
  { key: "delivery", label: "Delivery & Logistics Alerts" },
  { key: "stock", label: "Stock & Inventory Alerts" },
  { key: "reports", label: "Scheduled Reports" }
];

type SettingKey = "minutesBefore" | "threshold" | "hour" | "weekday";

type TriggerDef = {
  /** The "Trigger" column. */
  label: string;
  description: string;
  group: PerformanceGroup;
  settings: SettingKey[];
  /** Can the order's own rep be a recipient? */
  repApplies: boolean;
};

export const TRIGGERS: Record<TriggerKey, TriggerDef> = {
  order_new: { label: "Order Created", description: "A new order comes in.", group: "new_orders", settings: [], repApplies: true },
  order_assigned: { label: "Order Assigned", description: "An order is given (or moved) to a rep.", group: "new_orders", settings: [], repApplies: true },
  cart_assigned: { label: "Cart Assigned", description: "An abandoned cart is given to a rep to call.", group: "new_orders", settings: [], repApplies: true },
  send_out_soon: { label: "Deadline Near", description: "A New order has only a few working minutes left before the 15-minute send-out limit.", group: "follow_ups", settings: ["minutesBefore"], repApplies: true },
  follow_up_due: { label: "Follow-up Due", description: "A scheduled call or follow-up on an order is due.", group: "follow_ups", settings: [], repApplies: true },
  order_confirmed: { label: "Order Confirmed", description: "An order moves to Confirmed.", group: "delivery", settings: [], repApplies: true },
  order_delivered: { label: "Order Delivered", description: "An order is delivered.", group: "delivery", settings: [], repApplies: true },
  order_failed: { label: "Delivery Failed", description: "A delivery failed.", group: "delivery", settings: [], repApplies: true },
  order_cancelled: { label: "Order Cancelled", description: "An order is cancelled.", group: "delivery", settings: [], repApplies: true },
  order_rescheduled: { label: "Order Rescheduled", description: "A delivery date is moved.", group: "delivery", settings: [], repApplies: true },
  low_stock: { label: "Stock ≤ {threshold}", description: "A hub's usable stock of a product it has been selling drops to the limit or below.", group: "stock", settings: ["threshold"], repApplies: false },
  daily_report: { label: "Scheduled (Daily)", description: "Yesterday's business summary, every morning.", group: "reports", settings: ["hour"], repApplies: false },
  weekly_report: { label: "Scheduled (Weekly)", description: "Last week's business summary, once a week.", group: "reports", settings: ["weekday", "hour"], repApplies: false },
  weekly_rep_note: { label: "Scheduled (Weekly, each rep)", description: "Each sales rep's own late send-outs and fines last week.", group: "reports", settings: ["weekday", "hour"], repApplies: false }
};

export const TRIGGER_KEYS = Object.keys(TRIGGERS) as TriggerKey[];
export const isTriggerKey = (value: unknown): value is TriggerKey => typeof value === "string" && value in TRIGGERS;

export type Recipients = { roles: string[]; assignedRep: boolean; userIds: string[] };
export type AutomationSettings = { minutesBefore?: number; threshold?: number; hour?: number; weekday?: number };

export type DefaultAutomation = { trigger: TriggerKey; name: string; enabled: boolean; recipients: Recipients; settings: AutomationSettings };

/** The automations every organisation starts with (built in: can be paused, not deleted). */
export const DEFAULT_AUTOMATIONS: DefaultAutomation[] = [
  { trigger: "order_new", name: "New Order Alert", enabled: true, recipients: { roles: [], assignedRep: true, userIds: [] }, settings: {} },
  // A reassigned order reached its new rep only if someone made this by hand.
  { trigger: "order_assigned", name: "Order Assigned Alert", enabled: true, recipients: { roles: [], assignedRep: true, userIds: [] }, settings: {} },
  { trigger: "cart_assigned", name: "Cart Assigned Alert", enabled: true, recipients: { roles: [], assignedRep: true, userIds: [] }, settings: {} },
  { trigger: "send_out_soon", name: "Follow-up Reminder", enabled: true, recipients: { roles: [], assignedRep: true, userIds: [] }, settings: { minutesBefore: 5 } },
  { trigger: "follow_up_due", name: "Follow-up Due", enabled: true, recipients: { roles: [], assignedRep: true, userIds: [] }, settings: {} },
  { trigger: "order_failed", name: "Failed Delivery Alert", enabled: true, recipients: { roles: ["Inventory Manager & Logistics Operations"], assignedRep: false, userIds: [] }, settings: {} },
  { trigger: "low_stock", name: "Low Stock Alert", enabled: true, recipients: { roles: ["Inventory Manager", "Inventory Manager & Logistics Operations"], assignedRep: false, userIds: [] }, settings: { threshold: 5 } },
  { trigger: "daily_report", name: "Daily Sales Report", enabled: true, recipients: { roles: ["Owner"], assignedRep: false, userIds: [] }, settings: { hour: 9 } },
  { trigger: "weekly_report", name: "Weekly Sales Report", enabled: true, recipients: { roles: ["Owner"], assignedRep: false, userIds: [] }, settings: { weekday: 1, hour: 9 } },
  { trigger: "weekly_rep_note", name: "Weekly Late & Fines Note", enabled: true, recipients: { roles: ["Sales Rep"], assignedRep: false, userIds: [] }, settings: { weekday: 1, hour: 9 } }
];

const ROLE_SET = new Set<string>(TELEGRAM_ROLES);
const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Who an automation may name at all (reports: leadership; the rep note: sales reps). */
export function allowedRoles(trigger: TriggerKey): readonly string[] {
  if (trigger === "daily_report" || trigger === "weekly_report") return LEADERSHIP_ROLES;
  if (trigger === "weekly_rep_note") return REP_NOTE_ROLES;
  return TELEGRAM_ROLES.filter((role) => !isRepRole(role));
}

/** May this person get what this automation sends? (Checked again at send time.) */
export function roleMayReceive(trigger: string, role: string) {
  return isTriggerKey(trigger) ? allowedRoles(trigger).includes(role) : true;
}

export function cleanRecipients(trigger: TriggerKey, raw: unknown): Recipients {
  const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const allowed = new Set(allowedRoles(trigger));
  return {
    roles: Array.isArray(r.roles) ? [...new Set(r.roles.filter((x): x is string => typeof x === "string" && ROLE_SET.has(x) && allowed.has(x)))] : [],
    assignedRep: TRIGGERS[trigger].repApplies && r.assignedRep === true,
    userIds: Array.isArray(r.userIds) ? [...new Set(r.userIds.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 100) : []
  };
}

export function cleanSettings(trigger: TriggerKey, raw: unknown): AutomationSettings {
  const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const out: AutomationSettings = {};
  for (const key of TRIGGERS[trigger].settings) {
    if (key === "minutesBefore") out.minutesBefore = clampInt(r.minutesBefore, 1, 14, 5);
    if (key === "threshold") out.threshold = clampInt(r.threshold, 0, 500, 5);
    if (key === "hour") out.hour = clampInt(r.hour, 0, 23, 9);
    if (key === "weekday") out.weekday = clampInt(r.weekday, 0, 6, 1);
  }
  return out;
}

export function triggerLabel(trigger: TriggerKey, settings: AutomationSettings) {
  return TRIGGERS[trigger].label.replace("{threshold}", String(settings.threshold ?? 5));
}

/** "Assigned Rep", "Owner", "Logistics", "Owner +2". */
export function recipientLabel(recipients: Recipients) {
  const parts = [
    ...(recipients.assignedRep ? ["Assigned Rep"] : []),
    ...recipients.roles.map((role) => ROLE_SHORT[role] ?? role),
    ...(recipients.userIds.length ? [`${recipients.userIds.length} ${recipients.userIds.length === 1 ? "person" : "people"}`] : [])
  ];
  if (parts.length === 0) return "Nobody yet";
  return parts.length <= 2 ? parts.join(", ") : `${parts[0]} +${parts.length - 1}`;
}

// ── Message wording ──────────────────────────────────────────────────────────

export const naira = (value: number) => `₦${Math.round(Number(value) || 0).toLocaleString("en-NG")}`;

export type OrderInfo = {
  id: string; customer: string | null; phone: string | null; productName: string | null; packageName: string | null;
  quantity: number | null; amount: number | null; city: string | null; state: string | null; status: string | null;
  repName: string | null; callOutcome: string | null;
  /** Held for review (possible repeat order). */
  held?: boolean;
};

export type Draft = { title: string; text: string; keyboard: KeyboardSpec };
/** Buttons before links are made absolute: { path } opens the app, { callback } asks the bot. */
export type KeyboardSpec = Array<Array<{ text: string; path?: string; callback?: string }>>;

const ORDER_HEAD: Partial<Record<TriggerKey, { icon: string; title: string }>> = {
  order_new: { icon: "🛒", title: "NEW ORDER RECEIVED" },
  order_assigned: { icon: "📥", title: "ORDER ASSIGNED TO YOU" },
  order_confirmed: { icon: "✅", title: "ORDER CONFIRMED" },
  order_delivered: { icon: "🎉", title: "ORDER DELIVERED" },
  order_failed: { icon: "❌", title: "DELIVERY FAILED" },
  order_cancelled: { icon: "🚫", title: "ORDER CANCELLED" },
  order_rescheduled: { icon: "📅", title: "DELIVERY RESCHEDULED" }
};

const productLine = (order: OrderInfo) => {
  const name = [order.productName, order.packageName && order.packageName !== order.productName ? order.packageName : null].filter(Boolean).join(" · ");
  return name || "Order";
};
const placeLine = (order: OrderInfo) => [order.city, order.state].filter(Boolean).join(", ");

export function orderPath(role: string, orderId: string) {
  return role === "Sales Rep" ? `/dashboard/sales-rep/orders/${orderId}` : `/dashboard/admin/orders/${orderId}`;
}

/** An order event, worded for one recipient's role. */
export function orderDraft(trigger: TriggerKey, order: OrderInfo, role: string): Draft {
  const head = ORDER_HEAD[trigger] ?? { icon: "📦", title: "ORDER UPDATE" };
  const customerOk = seesCustomer(role);
  const lines = [
    `${head.icon} <b>${head.title}</b>`,
    ...(order.held ? [`⚠️ <b>Held for review</b>: possibly a repeat order from this number. Check it before calling.`] : []),
    `Order ID: #${tgEscape(order.id)}`,
    `Product: ${tgEscape(productLine(order))}${order.quantity && order.quantity > 1 ? ` × ${order.quantity}` : ""}`,
    ...(customerOk && order.amount != null ? [`Amount: ${naira(order.amount)}`] : []),
    ...(customerOk && order.customer ? [`Customer: ${tgEscape(order.customer)}`] : []),
    ...(placeLine(order) ? [`Location: ${tgEscape(placeLine(order))}`] : []),
    ...(order.repName ? [`Assigned to: ${tgEscape(order.repName)}`] : []),
    ...(trigger === "order_failed" && order.callOutcome && customerOk ? [`Reason: ${tgEscape(order.callOutcome.split("\n")[0].slice(0, 160))}`] : [])
  ];
  const keyboard: KeyboardSpec = [[
    ...(customerOk && order.phone ? [{ text: "📞 Call Customer", callback: `call:${order.id}` }] : []),
    { text: "👁 View Order", path: orderPath(role, order.id) }
  ]];
  return { title: `${head.title.charAt(0)}${head.title.slice(1).toLowerCase()} #${order.id}`, text: lines.join("\n"), keyboard };
}

export function sendOutSoonDraft(order: OrderInfo, minutesLeft: number, role: string): Draft {
  const customerOk = seesCustomer(role);
  const text = [
    `⏰ <b>Send this order out: ${minutesLeft} min left</b>`,
    `Order ID: #${tgEscape(order.id)}`,
    `Product: ${tgEscape(productLine(order))}`,
    ...(customerOk && order.customer ? [`Customer: ${tgEscape(order.customer)}`] : []),
    `It is still New. Move it out of New before the 15 minutes run out.`
  ].join("\n");
  return {
    title: `Follow-up reminder (${minutesLeft} min left) #${order.id}`,
    text,
    keyboard: [[
      ...(customerOk && order.phone ? [{ text: "📞 Call Customer", callback: `call:${order.id}` }] : []),
      { text: "👁 View Order", path: orderPath(role, order.id) }
    ]]
  };
}

export function followUpDraft(orderId: string, title: string, message: string, role: string): Draft {
  // The app's follow-up text carries the customer and the amount.
  return {
    title,
    text: seesCustomer(role) ? `🔔 <b>${tgEscape(title)}</b>\n${tgEscape(message)}` : `🔔 <b>${tgEscape(title)}</b>`,
    keyboard: [[
      ...(seesCustomer(role) ? [{ text: "📞 Call Customer", callback: `call:${orderId}` }] : []),
      { text: "👁 View Order", path: orderPath(role, orderId) }
    ]]
  };
}

export type LowStockItem = { productName: string; hubName: string; state: string; usable: number };

export function lowStockDraft(item: LowStockItem, threshold: number): Draft {
  const where = [item.hubName, item.state].filter(Boolean).join(" · ");
  return {
    title: `Low stock: ${item.productName} – ${item.state} (${item.usable} left)`,
    text: [
      `📦 <b>LOW STOCK</b>`,
      `Product: ${tgEscape(item.productName)}`,
      `Hub: ${tgEscape(where)}`,
      `Usable stock: <b>${item.usable}</b> (limit ${threshold})`
    ].join("\n"),
    keyboard: [[{ text: "📋 Open Inventory", path: "/dashboard/admin/inventory" }]]
  };
}

export type BusinessReport = {
  label: string;                // "Thu 5 Nov" or "30 Oct – 5 Nov"
  ordersIn: number;
  topProducts: Array<{ name: string; orders: number }>;
  delivered: number;
  deliveredRevenue: number;
  failed: number;
  cancelled: number;
  stillNew: number;
  lateSendOuts: number;
  adSpend: number | null;
};

export function reportDraft(kind: "daily_report" | "weekly_report", report: BusinessReport, role: string): Draft {
  const revenue = seesRevenue(role);
  const money = seesBusinessMoney(role);
  const head = kind === "daily_report" ? "Daily report" : "Weekly report";
  const lines = [
    `📊 <b>${head} · ${tgEscape(report.label)}</b>`,
    ``,
    `Orders in: <b>${report.ordersIn}</b>`,
    ...report.topProducts.slice(0, 3).map((row) => `  • ${tgEscape(row.name)}: ${row.orders}`),
    `Delivered: <b>${report.delivered}</b>${revenue ? ` · ${naira(report.deliveredRevenue)}` : ""}`,
    `Failed: ${report.failed} · Cancelled: ${report.cancelled}`,
    `Sent out late (past 15 min): ${report.lateSendOuts}`,
    `Still New right now: ${report.stillNew}`,
    ...(money && report.adSpend != null ? [`Ad spend: ${naira(report.adSpend)}${report.ordersIn ? ` · ${naira(report.adSpend / report.ordersIn)} per order` : ""}`] : [])
  ];
  return { title: `${head} sent – ${report.label}`, text: lines.join("\n"), keyboard: [[{ text: "📈 Open Dashboard", path: "/dashboard" }]] };
}

export type CartInfo = { id: string; customer: string | null; productName: string | null; packageName: string | null; amount: number | null; city: string | null; state: string | null; repName: string | null };

/** A cart given to a rep to call. */
export function cartDraft(cart: CartInfo, role: string): Draft {
  const customerOk = seesCustomer(role);
  const product = [cart.productName, cart.packageName && cart.packageName !== cart.productName ? cart.packageName : null].filter(Boolean).join(" · ");
  const place = [cart.city, cart.state].filter(Boolean).join(", ");
  return {
    title: `Cart assigned${cart.repName ? ` to ${cart.repName}` : ""}`,
    text: [
      `🛒 <b>CART GIVEN TO ${cart.repName && role !== "Sales Rep" ? tgEscape(cart.repName.toUpperCase()) : "YOU"}</b>`,
      `Product: ${tgEscape(product || "Cart")}`,
      ...(customerOk && cart.amount != null ? [`Value: ${naira(cart.amount)}`] : []),
      ...(customerOk && cart.customer ? [`Customer: ${tgEscape(cart.customer)}`] : []),
      ...(place ? [`Location: ${tgEscape(place)}`] : []),
      `Call within 10 minutes.`
    ].join("\n"),
    keyboard: [[
      ...(customerOk ? [{ text: "📞 Call Customer", callback: `callcart:${cart.id}` }] : []),
      { text: "👁 View Cart", path: role === "Sales Rep" ? "/dashboard/sales-rep/abandoned-carts" : `/dashboard/admin/abandoned-carts/${cart.id}` }
    ]]
  };
}

export type RepWeekNote = {
  label: string;
  lateSendOuts: number;
  lateExamples: Array<{ orderId: string; minutesLate: number }>;
  fines: Array<{ amount: number; reason: string }>;
};

/** Monday's note to each rep: their own late send-outs and fines last week. */
export function repWeekNoteDraft(note: RepWeekNote): Draft {
  const total = note.fines.reduce((sum, fine) => sum + (Number(fine.amount) || 0), 0);
  const clean = note.lateSendOuts === 0 && note.fines.length === 0;
  return {
    title: `Weekly late & fines note – ${note.label}`,
    text: clean
      ? `✅ <b>Last week · ${tgEscape(note.label)}</b>\nNo late send-outs and no fines. Well done.`
      : [
          `📋 <b>Last week · ${tgEscape(note.label)}</b>`,
          `Orders sent out late (past 15 min): <b>${note.lateSendOuts}</b>`,
          ...note.lateExamples.slice(0, 5).map((row) => `  • #${tgEscape(row.orderId)}: ${row.minutesLate} min late`),
          `Fines: <b>${note.fines.length}</b>${note.fines.length ? ` · ${naira(total)}` : ""}`,
          ...note.fines.slice(0, 5).map((fine) => `  • ${naira(fine.amount)} – ${tgEscape(String(fine.reason ?? "").split("\n")[0].slice(0, 90))}`),
          ``,
          `If a fine is wrong, appeal it in Protohub.`
        ].join("\n"),
    keyboard: [[{ text: "Open my Bonuses", path: "/dashboard/sales-rep" }]]
  };
}

export type QuietHours = { on: boolean; from: number; to: number };
export const DEFAULT_QUIET: QuietHours = { on: true, from: 21, to: 7 };

export function cleanQuiet(raw: unknown): QuietHours {
  const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return { on: typeof r.on === "boolean" ? r.on : DEFAULT_QUIET.on, from: clampInt(r.from, 0, 23, DEFAULT_QUIET.from), to: clampInt(r.to, 0, 23, DEFAULT_QUIET.to) };
}

/** Inside quiet hours (Lagos), messages arrive without a sound. */
export function isQuietTime(nowMs: number, quiet: QuietHours) {
  if (!quiet.on || quiet.from === quiet.to) return false;
  const hour = new Date(nowMs + 60 * 60_000).getUTCHours();
  return quiet.from < quiet.to ? hour >= quiet.from && hour < quiet.to : hour >= quiet.from || hour < quiet.to;
}

export type RepDay = {
  label: string;
  ordersIn: number;
  sentOut: number;
  sentLate: number;
  delivered: number;
  stillNew: number;
  lateNow: number;
  /** The Bonuses screen's "Bonus earned" this week; null = could not be worked out, undefined = no bonus line (not a sales rep). */
  bonus?: { earned: number; deliveredCount: number } | null;
};

/** /today for a sales rep: their own day and their own bonus, never revenue. */
export function repTodayDraft(day: RepDay): string {
  return [
    `<b>Your day so far · ${tgEscape(day.label)}</b>`,
    `Orders given to you today: <b>${day.ordersIn}</b>`,
    `Sent out of New: ${day.sentOut}${day.sentLate ? ` (${day.sentLate} late)` : ""}`,
    `Delivered today: <b>${day.delivered}</b>`,
    `Still New: ${day.stillNew}${day.lateNow ? ` (${day.lateNow} past the 15 min)` : ""}`,
    ...(day.bonus === undefined ? [] : [
      ``,
      day.bonus
        ? `💰 Your bonus this week: <b>${naira(day.bonus.earned)}</b> (from ${day.bonus.deliveredCount} delivered order${day.bonus.deliveredCount === 1 ? "" : "s"})`
        : `💰 Your bonus this week: open Bonuses in Protohub to see it.`
    ])
  ].join("\n");
}

export function announcementDraft(text: string, fromName: string): Draft {
  return {
    title: "Announcement",
    text: `📣 <b>Announcement</b>\n${tgEscape(text)}\n\n<i>– ${tgEscape(fromName)}</i>`,
    keyboard: []
  };
}

/** A phone alert forwarded to Telegram. url is the app path the alert opens. */
export function forwardedDraft(title: string, body: string, url?: string): Draft {
  return {
    title,
    text: `🔔 <b>${tgEscape(title)}</b>\n${tgEscape(body)}`,
    keyboard: url && url.startsWith("/") ? [[{ text: "Open in Protohub", path: url }]] : []
  };
}

/** Make app paths absolute (the app uses # routes). Telegram only accepts http(s) links. */
export function buildKeyboard(spec: KeyboardSpec, appBase: string | null): TgKeyboard {
  const rows: TgKeyboard = [];
  for (const row of spec) {
    const out = row.flatMap((button): TgButton[] => {
      if (button.callback) return [{ text: button.text, callback_data: button.callback.slice(0, 64) }];
      if (button.path && appBase && /^https?:\/\//.test(appBase)) return [{ text: button.text, url: `${appBase.replace(/\/+$/, "")}/#${button.path}` }];
      return [];
    });
    if (out.length) rows.push(out);
  }
  return rows;
}

/** Short plain-text preview for the log (no HTML tags). */
export function previewOf(text: string) {
  return text.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 240);
}

// ── Commands people can type to the bot ─────────────────────────────────────

export type CommandKey = "help" | "myorders" | "today" | "late" | "stock" | "stop";

export const COMMANDS: Array<{ key: CommandKey; description: string; who: string }> = [
  { key: "help", description: "What this bot can do", who: "Everyone" },
  { key: "myorders", description: "My New orders and follow-ups due today", who: "Sales reps (all orders for leadership)" },
  { key: "today", description: "Today's numbers so far", who: "Leadership (with revenue); sales reps see their own day and bonus" },
  { key: "late", description: "Orders past the 15-minute send-out limit", who: "Leadership (reps see their own)" },
  { key: "stock", description: "Usable stock by hub, e.g. /stock edge", who: "Leadership and inventory staff" },
  { key: "stop", description: "Stop Protohub messages to this chat", who: "Everyone" }
];

export function cleanCommandSettings(raw: unknown): Record<CommandKey, boolean> {
  const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return Object.fromEntries(COMMANDS.map(({ key }) => [key, key === "help" || key === "stop" ? true : r[key] !== false])) as Record<CommandKey, boolean>;
}

// ── App alerts that can also go to Telegram ─────────────────────────────────

/** Phone-alert kinds the Automations tab already covers: never forwarded twice. */
export const AUTOMATION_KINDS = new Set(["order_new", "order_assigned", "order_failed", "order_follow_up", "low_stock", "abandoned_cart_assigned", "test_push", "telegram_notice"]);

export const FORWARD_GROUPS: Array<{ key: string; label: string; hint: string; kinds: string[] }> = [
  { key: "orders", label: "Order updates", hint: "Confirmed, delivered, cancelled and rescheduled orders.", kinds: ["order_confirmed", "order_delivered", "order_cancelled", "order_rescheduled"] },
  { key: "late_send", label: "Orders not sent out in 15 min", hint: "A rep left an order in New past 15 working minutes.", kinds: ["order_late_send"] },
  { key: "carts", label: "New abandoned carts", hint: "A customer left the order form without finishing (carts given to a rep are an Automation).", kinds: ["abandoned_cart_new"] },
  { key: "ads", label: "Campaigns with no order", hint: "A running campaign brought no order for 3 full days.", kinds: ["campaign_no_orders"] },
  { key: "other", label: "Everything else", hint: "Weekly reports, fines and appeals, challenges, bug reports and other phone alerts.", kinds: ["*"] }
];

/**
 * An order alert copied from the phone shares its "send once" key with the
 * matching automation, so the same person never gets it twice (an "Order
 * Delivered" automation and "Order updates" switched on together).
 */
export function forwardDedupeKey(kind: string | undefined, tag: string | undefined, day: string): string | null {
  const k = String(kind ?? "");
  const match = String(tag ?? "").match(/^order-(.+)-([A-Za-z]+)$/);
  if (match && isTriggerKey(k)) return `${k}:${match[1]}:${match[2]}:${day}`;
  return tag ? `app_alert:${tag}` : null;
}

/** Phone alerts about company-wide matters: never copied to a rep. */
const NOT_FOR_REPS = new Set(["abandoned_cart_new", "campaign_no_orders", "low_stock"]);

/**
 * May this phone alert be copied to this person's Telegram? A rep gets only
 * alerts about themselves: an alert about an order must be about one of
 * theirs (orderId returned for that check); company-wide ones never.
 */
export function forwardCheck(role: string, kind: string | undefined, tag: string | undefined): { allowed: false } | { allowed: true; ownOrderId?: string } {
  if (!isRepRole(role)) return { allowed: true };
  if (NOT_FOR_REPS.has(String(kind ?? ""))) return { allowed: false };
  const t = String(tag ?? "");
  const orderTag = t.match(/^order-(.+)-([A-Za-z]+)$/) ?? t.match(/^late-send-(.+)$/);
  if (orderTag) return { allowed: true, ownOrderId: orderTag[1] };
  if (String(kind ?? "").startsWith("order_")) return { allowed: false }; // an order alert we cannot tie to an order
  return { allowed: true };
}

/** Is this phone-alert kind switched on for Telegram? */
export function kindForwarded(kind: string | undefined, enabledGroups: Set<string>) {
  const k = String(kind ?? "");
  if (!k || AUTOMATION_KINDS.has(k)) return false;
  const named = FORWARD_GROUPS.find((group) => group.kinds.includes(k));
  return enabledGroups.has(named ? named.key : "other");
}

// ── Numbers for the Overview ────────────────────────────────────────────────

/** Sent / (sent + failed), 0-100, or null when nothing was tried. */
export function successRate(sent: number, failed: number) {
  const tried = sent + failed;
  return tried > 0 ? Math.round((sent / tried) * 1000) / 10 : null;
}

export function groupOf(trigger: string): PerformanceGroup | null {
  return isTriggerKey(trigger) ? TRIGGERS[trigger].group : null;
}
