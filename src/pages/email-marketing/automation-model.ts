import type { EmAutomation, EmAutomationInput, EmAutomationSettings, EmCheck, EmDesigner, EmFlowNode, EmQuietReason, EmStage, EmTrigger, EmWorkflow } from "../../lib/api";
import { buildTemplateDesign, type CampaignFields, type EmailDesign } from "../../lib/email-render";
import { priceText } from "./wizard-model";

/**
 * Automations (Bright's designs 50, 51 and steps 2-4, 8 Nov 2026): the
 * ready-made flows, the words for triggers and checks, and the small helpers
 * that edit a flow. Starter emails promise nothing (no discount, no reward):
 * the business adds its own offer in each email.
 */

export type AutoDraft = Omit<EmAutomationInput, "launch"> & { id: string | null; status: EmAutomation["status"]; active: boolean };

export const GOAL_OPTIONS = [
  { key: "repeat", label: "Drive Repeat Purchase" },
  { key: "winback", label: "Win Back Customers" },
  { key: "cart", label: "Recover Unfinished Orders" },
  { key: "welcome", label: "Welcome New Subscribers" },
  { key: "reviews", label: "Collect Reviews" },
  { key: "reorder", label: "Bring Reorders" },
  { key: "occasion", label: "Celebrate Customers" },
  { key: "loyalty", label: "Reward Loyal Customers" },
  { key: "upsell", label: "Grow Order Value (AOV)" }
];
export const goalText = (key: string) => GOAL_OPTIONS.find((row) => row.key === key)?.label ?? key;

/** The short goal names on Customer Journey's list (design 53). */
export const GOAL_PILL: Record<string, { label: string; tone: string }> = {
  repeat: { label: "Retention", tone: "green" }, reorder: { label: "Retention", tone: "green" }, loyalty: { label: "Loyalty", tone: "orange" },
  winback: { label: "Reactivation", tone: "red" }, cart: { label: "Conversion", tone: "purple" }, welcome: { label: "Acquisition", tone: "blue" },
  reviews: { label: "Reviews", tone: "amber" }, occasion: { label: "Engagement", tone: "blue" }, upsell: { label: "AOV Growth", tone: "amber" }
};

/** Customer Journey's stages, in the order of a customer's life with the shop. */
export const STAGES: Array<{ key: EmStage; label: string }> = [
  { key: "acquisition", label: "Acquisition" }, { key: "nurture", label: "Nurture" }, { key: "conversion", label: "Conversion" },
  { key: "retention", label: "Retention" }, { key: "winback", label: "Win-Back" }, { key: "post_purchase", label: "Post-Purchase" }
];
export const stageText = (key: EmStage) => STAGES.find((row) => row.key === key)?.label ?? key;
const TRIGGER_STAGE: Record<EmTrigger["kind"], EmStage> = {
  new_subscriber: "acquisition", date_field: "nurture", cart_abandoned: "conversion", order_placed: "conversion",
  reorder: "retention", vip: "retention", inactive: "winback", went_quiet: "winback", order_delivered: "post_purchase"
};

/** `when` completes "Starts when ..." / "This automation will start when ...". */
export const TRIGGER_OPTIONS: Array<{ kind: EmTrigger["kind"]; label: string; when: string }> = [
  { kind: "order_delivered", label: "Order Delivered", when: "a customer's order is delivered (completed)" },
  { kind: "order_placed", label: "Order Placed", when: "a customer places an order" },
  { kind: "cart_abandoned", label: "Cart Abandoned", when: "someone leaves the order form without finishing" },
  { kind: "new_subscriber", label: "New Subscriber", when: "someone joins the email list" },
  { kind: "inactive", label: "No Purchase in a While", when: "a customer has not bought for a number of days" },
  { kind: "date_field", label: "Birthday / Special Date", when: "it is the date saved in a customer's date field (e.g. Birthday)" },
  { kind: "vip", label: "Becomes a VIP", when: "a customer reaches a number of delivered orders" },
  { kind: "reorder", label: "Time to Reorder", when: "a number of days have passed since an order was delivered" },
  { kind: "went_quiet", label: "Customer Went Quiet", when: "a customer's latest order failed, was postponed or cancelled, or they stopped picking calls" }
];

/** Why a customer went quiet, read from the rep's last call note (same list as the server). */
export const QUIET_REASON_OPTIONS: Array<{ key: EmQuietReason; label: string }> = [
  { key: "unreachable", label: "Stopped picking calls or replying" },
  { key: "not_ready", label: "Not ready yet (travel, money, timing)" },
  { key: "let_down", label: "We let them down (out of stock, can't reach their area)" },
  { key: "said_no", label: "Said no thanks" },
  { key: "other", label: "Other or no reason written" }
];
export function triggerText(trigger: EmTrigger) {
  switch (trigger.kind) {
    case "cart_abandoned": return `Cart Abandoned (${trigger.cartMinutes ?? 60} min)`;
    case "inactive": return `No Purchase (${trigger.inactiveDays ?? 60} Days)`;
    case "vip": return `Becomes VIP (${trigger.vipOrders ?? 3} orders)`;
    case "reorder": return `Time to Reorder (${trigger.reorderDays ?? 30} days)`;
    case "went_quiet": return `Went Quiet (${trigger.quietDays ?? 1} ${(trigger.quietDays ?? 1) === 1 ? "day" : "days"})`;
    default: return TRIGGER_OPTIONS.find((row) => row.kind === trigger.kind)?.label ?? trigger.kind;
  }
}

export const CHECK_OPTIONS: Array<{ kind: EmCheck["kind"]; label: string; question: string }> = [
  { kind: "placed_order", label: "Placed a new order", question: "Did the customer place another order?" },
  { kind: "delivered_order", label: "Got a new order delivered", question: "Did the customer get another order delivered?" },
  { kind: "opened_last", label: "Opened the last email", question: "Did they open the last email?" },
  { kind: "clicked_last", label: "Clicked the last email", question: "Did they click the last email?" },
  { kind: "left_review", label: "Left a review", question: "Did they leave a review?" },
  { kind: "in_segment", label: "Is in a segment", question: "Are they in the segment?" },
  { kind: "has_tag", label: "Has a tag", question: "Do they have the tag?" }
];
export const checkQuestion = (check: EmCheck) => CHECK_OPTIONS.find((row) => row.kind === check.kind)?.question ?? "Check";

export const DEFAULT_SETTINGS: EmAutomationSettings = {
  reentry: true, reentryDays: 30, frequency: "per_event", priority: "normal",
  exit: { onUnsubscribe: true, onPurchase: false, afterDays: null },
  sendWindow: { on: true, from: 8, to: 19, days: [1, 2, 3, 4, 5] },
  utm: true, track: true, replyTo: ""
};

export const hourText = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 || hour === 24 ? "AM" : "PM"}`;
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function windowText(settings: EmAutomationSettings) {
  const w = settings.sendWindow;
  if (!w.on) return "Any time";
  const days = [...w.days].sort();
  const run = days.length > 2 && days.every((day, i) => i === 0 || day === days[i - 1] + 1);
  const dayText = days.length === 7 ? "every day" : run ? `${DAY_NAMES[days[0]]} – ${DAY_NAMES[days[days.length - 1]]}` : days.map((day) => DAY_NAMES[day]).join(", ");
  return `${hourText(w.from)} – ${hourText(w.to)} (${dayText})`;
}

// ── Building blocks ───────────────────────────────────────────────────

let counter = 0;
export const newId = (prefix = "n") => `${prefix}${Date.now().toString(36).slice(-5)}${(counter += 1).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

type Words = { title: string; highlight: string; body: string; button: string; template?: "simple_message" | "product_promo" | "win_back" };

/** A starter email: real product and link when there is one, and words that make no promises. */
export function starterEmail(designer: EmDesigner | null, goal: string, words: Words, subject: string, preheader: string) {
  const product = designer?.products.find((row) => row.image) ?? designer?.products[0];
  const fields: CampaignFields = {
    brand: designer?.sender.fromName || "Our Store", goal, offerType: "custom", productId: product?.id ?? "", productName: product?.name ?? "",
    productImage: product?.image ?? "", productLink: product?.links[0]?.url ?? "", productPrice: priceText(product), offerOn: false, offerTitle: "", offerBenefit: ""
  };
  const design: EmailDesign = buildTemplateDesign(words.template ?? "simple_message", fields);
  design.blocks = design.blocks.map((block) => {
    if (block.type === "hero") return { ...block, title: words.title, highlight: words.highlight, buttonText: `${words.button} →` };
    if (block.type === "text" && !block.bold) return { ...block, text: words.body };
    if (block.type === "button") return { ...block, text: `${words.button} →` };
    return block;
  });
  return { subject, preheader, design, productId: product?.id ?? null, thumbnailUrl: product?.image || null };
}

const wait = (amount: number, unit: "hours" | "days" = "days"): EmFlowNode => ({ id: newId("w"), type: "wait", amount, unit });
const email = (name: string, content: ReturnType<typeof starterEmail>): EmFlowNode => ({ id: newId("e"), type: "email", name, email: content, campaignId: null });
const check = (name: string, kind: EmCheck["kind"], yes: EmFlowNode[], no: EmFlowNode[]): EmFlowNode => ({ id: newId("c"), type: "condition", name, check: { kind }, yes, no });

export type TemplateDef = {
  key: string; name: string; hint: string; icon: string; goal: string; trigger: EmTrigger; useCase: string; stage: EmStage;
  settings?: Partial<EmAutomationSettings>;
  flow: (designer: EmDesigner | null) => EmFlowNode[];
};

export const TEMPLATES: TemplateDef[] = [
  {
    key: "post_purchase", name: "Post-Purchase Follow-Up", hint: "Thank, educate, and drive repeat orders", icon: "cart", goal: "repeat", useCase: "repeat", stage: "post_purchase",
    trigger: { kind: "order_delivered", productId: null },
    flow: (d) => [
      wait(1),
      email("Email 1: Thank You", starterEmail(d, "appreciation", { title: "Thank You", highlight: "For Your Order", body: "Your order has arrived. Thank you for choosing us. If anything is not right, just reply to this email and we will help.", button: "See How To Use It" }, "Thank you for your order, {{first name}}", "Your order has arrived")),
      wait(3),
      email("Email 2: Review Request", starterEmail(d, "appreciation", { title: "How Is", highlight: "Your Order?", body: "We would love to hear how it is going. Reply to this email with a photo or a short video of it in your home, and tell us what you think.", button: "Tell Us What You Think" }, "How is your order, {{first name}}?", "We'd love a photo or a few words")),
      wait(7),
      email("Email 3: Come Back Offer", starterEmail(d, "retention", { title: "Ready For", highlight: "Your Next Order?", body: "It has been a while since your order arrived. If you'd like another one, or something to go with it, we are here. Order today and pay on delivery.", button: "Order Again", template: "product_promo" }, "Something to go with your order, {{first name}}", "Order today, pay on delivery"))
    ]
  },
  {
    key: "win_back", name: "Win-Back (Inactive Customers)", hint: "Re-engage customers who haven't purchased in a while", icon: "refresh", goal: "winback", useCase: "winback", stage: "winback",
    trigger: { kind: "inactive", inactiveDays: 60 }, settings: { exit: { onUnsubscribe: true, onPurchase: true, afterDays: null } },
    flow: (d) => [
      email("Email 1: We Miss You", starterEmail(d, "winback", { title: "It's Been", highlight: "A While", body: "We have not seen you in a while. Here is what is new. Order today and pay when it arrives.", button: "See What's New", template: "win_back" }, "We miss you, {{first name}}", "Here's what's new")),
      wait(3),
      check("Did the customer place another order?", "placed_order", [], [
        email("Email 2: Last Reminder", starterEmail(d, "winback", { title: "Still", highlight: "Thinking It Over?", body: "Just a friendly reminder that we are here when you need us. Delivery to your door, and you pay on delivery.", button: "Shop Now" }, "Still thinking it over, {{first name}}?", "Pay on delivery, as always"))
      ])
    ]
  },
  {
    key: "cart_abandonment", name: "Cart Abandonment", hint: "Remind customers to complete their order", icon: "cartx", goal: "cart", useCase: "cart", stage: "conversion",
    trigger: { kind: "cart_abandoned", cartMinutes: 60 }, settings: { exit: { onUnsubscribe: true, onPurchase: true, afterDays: null } },
    flow: (d) => [
      email("Email 1: You Left Something", starterEmail(d, "cart", { title: "You Left", highlight: "Something Behind", body: "You started an order but did not finish. It only takes a minute, and you pay when it arrives.", button: "Finish My Order", template: "product_promo" }, "Your order is waiting, {{first name}}", "Finish it in a minute")),
      wait(1),
      check("Did the customer place another order?", "placed_order", [], [
        email("Email 2: Still Interested?", starterEmail(d, "cart", { title: "Still", highlight: "Interested?", body: "Your order is still waiting. Reply to this email if you have a question before ordering.", button: "Finish My Order" }, "Still interested, {{first name}}?", "Questions? Just reply"))
      ])
    ]
  },
  {
    key: "welcome", name: "Welcome Series", hint: "Nurture new subscribers and build trust", icon: "mail", goal: "welcome", useCase: "welcome", stage: "acquisition",
    trigger: { kind: "new_subscriber" }, settings: { reentry: false },
    flow: (d) => [
      email("Email 1: Welcome", starterEmail(d, "announcement", { title: "Welcome", highlight: "To The Family", body: "Thank you for joining us. We will only send things worth reading: new arrivals, tips and the occasional offer.", button: "See Our Shop" }, "Welcome, {{first name}}!", "Thanks for joining us")),
      wait(2),
      email("Email 2: How It Works", starterEmail(d, "announcement", { title: "How", highlight: "Ordering Works", body: "Order online in a minute, we deliver to your door, and you pay when it arrives. No card needed.", button: "Start An Order" }, "How ordering works", "Pay on delivery, delivered to your door")),
      wait(4),
      email("Email 3: Our Favourites", starterEmail(d, "promotion", { title: "Our", highlight: "Customer Favourites", body: "These are the pieces our customers order most. Have a look.", button: "See Them", template: "product_promo" }, "Our customers' favourites", "The pieces people order most"))
    ]
  },
  {
    key: "review_feedback", name: "Review & Feedback", hint: "Request product reviews from happy customers", icon: "star", goal: "reviews", useCase: "reviews", stage: "nurture",
    trigger: { kind: "order_delivered", productId: null },
    flow: (d) => [
      wait(3),
      email("Email 1: How Is It?", starterEmail(d, "appreciation", { title: "How Is", highlight: "Your Order?", body: "We hope you are enjoying it. Reply with a photo or a short video and a few words: it helps other customers choose.", button: "Tell Us" }, "How is it going, {{first name}}?", "A photo and a few words help others")),
      wait(4),
      check("Did they leave a review?", "left_review", [], [
        email("Email 2: A Quick Reminder", starterEmail(d, "appreciation", { title: "A Quick", highlight: "Reminder", body: "If you have a minute, reply to this email with a photo of your order in use. Thank you!", button: "Reply Now" }, "A quick favour, {{first name}}?", "One photo is enough"))
      ])
    ]
  },
  {
    key: "replenishment", name: "Replenishment / Reorder", hint: "Remind when it's time to buy again", icon: "refresh", goal: "reorder", useCase: "repeat", stage: "retention",
    trigger: { kind: "reorder", reorderDays: 30, productId: null }, settings: { exit: { onUnsubscribe: true, onPurchase: true, afterDays: null } },
    flow: (d) => [
      email("Email 1: Time To Restock?", starterEmail(d, "retention", { title: "Time To", highlight: "Restock?", body: "It has been a while since your last order. If you are running low, order today and pay on delivery.", button: "Order Again", template: "product_promo" }, "Time to restock, {{first name}}?", "Order today, pay on delivery")),
      wait(5),
      check("Did the customer place another order?", "placed_order", [], [
        email("Email 2: Reminder", starterEmail(d, "retention", { title: "Just A", highlight: "Reminder", body: "Need another one? We deliver to your door and you pay when it arrives.", button: "Order Now" }, "Need another one, {{first name}}?", "Delivered to your door"))
      ])
    ]
  },
  {
    key: "birthday", name: "Birthday / Special Occasion", hint: "Send personalized offers and greetings", icon: "gift", goal: "occasion", useCase: "loyalty", stage: "nurture",
    trigger: { kind: "date_field", fieldKey: "birthday" }, settings: { reentryDays: 300 },
    flow: (d) => [
      email("Email: Happy Birthday", starterEmail(d, "appreciation", { title: "Happy", highlight: "Birthday!", body: "Everyone at the shop wishes you a wonderful day. Thank you for being part of our family.", button: "Treat Yourself" }, "Happy birthday, {{first name}}!", "Wishing you a wonderful day"))
    ]
  },
  {
    key: "vip_loyalty", name: "Loyalty / VIP", hint: "Reward and retain your best customers", icon: "crown", goal: "loyalty", useCase: "loyalty", stage: "retention",
    trigger: { kind: "vip", vipOrders: 3 }, settings: { reentry: false },
    flow: (d) => [
      email("Email 1: You're A VIP", starterEmail(d, "appreciation", { title: "You're One Of", highlight: "Our Best Customers", body: "You have ordered from us three times. Thank you. You will hear about new arrivals first.", button: "See What's New" }, "Thank you, {{first name}}: you're one of our best", "You'll hear about new arrivals first")),
      wait(7),
      email("Email 2: First Look", starterEmail(d, "launch", { title: "A First Look", highlight: "Just For You", body: "Here is what just arrived. Order before everyone else.", button: "Take A Look", template: "product_promo" }, "A first look, just for you", "New arrivals before everyone else"))
    ]
  },
  {
    // Loyalty & Rewards (design 55): a day after each delivery, once the order's points are in.
    key: "loyalty_update", name: "Loyalty Points Update", hint: "Tell members their points, level and voucher after each delivery", icon: "star", goal: "loyalty", useCase: "loyalty", stage: "retention",
    trigger: { kind: "order_delivered", productId: null }, settings: { exit: { onUnsubscribe: true, onPurchase: false, afterDays: null } },
    flow: (d) => [
      wait(1),
      email("Email 1: Your Points", starterEmail(d, "appreciation", {
        title: "You Have", highlight: "{{Points}} Points",
        body: "Thank you for your order. Your level: {{Level}}. Your points: {{Points}}. Voucher waiting: {{Voucher}}. It comes off your next order by itself, with nothing to type. Next level: {{Next Level}}.",
        button: "Order Again"
      }, "{{first name}}, you have {{Points}} points", "Your level: {{Level}}"))
    ]
  },
  {
    key: "repeat_buyer", name: "Repeat Buyer Journey", hint: "Drive the second and third purchase", icon: "refresh", goal: "repeat", useCase: "repeat", stage: "retention",
    trigger: { kind: "order_delivered", productId: null }, settings: { exit: { onUnsubscribe: true, onPurchase: true, afterDays: null } },
    flow: (d) => [
      wait(14),
      email("Email 1: Your Next Order", starterEmail(d, "retention", { title: "Ready For", highlight: "Your Next Order?", body: "Many customers come back for a second piece for another room. Order today and pay on delivery.", button: "Shop Again", template: "product_promo" }, "Ready for your next order, {{first name}}?", "A second piece for another room")),
      wait(7),
      check("Did the customer place another order?", "placed_order", [], [
        email("Email 2: Customer Favourites", starterEmail(d, "promotion", { title: "Our", highlight: "Customer Favourites", body: "These are the pieces customers order most after their first one.", button: "See Them", template: "product_promo" }, "What customers order next", "Our most-loved second buys"))
      ])
    ]
  },
  {
    key: "upsell_cross_sell", name: "Upsell & Cross-sell Flow", hint: "Recommend related or higher value items", icon: "tag", goal: "upsell", useCase: "repeat", stage: "post_purchase",
    trigger: { kind: "order_delivered", productId: null }, settings: { exit: { onUnsubscribe: true, onPurchase: true, afterDays: null } },
    flow: (d) => [
      wait(5),
      email("Email 1: Goes Well With It", starterEmail(d, "upsell", { title: "Goes Well", highlight: "With Your Order", body: "Here is something that pairs well with what you bought. Order today and pay on delivery.", button: "See It", template: "product_promo" }, "This goes well with your order, {{first name}}", "A matching piece for your home")),
      wait(4),
      check("Did the customer place another order?", "placed_order", [], [
        email("Email 2: Still Thinking?", starterEmail(d, "upsell", { title: "Still", highlight: "Thinking It Over?", body: "Reply to this email if you have a question about it. We deliver to your door and you pay on delivery.", button: "Order Now" }, "Still thinking it over, {{first name}}?", "Questions? Just reply"))
      ])
    ]
  }
];

export const USE_CASES = [
  { key: "repeat", label: "Get more repeat orders" },
  { key: "winback", label: "Bring customers back" },
  { key: "cart", label: "Recover unfinished orders" },
  { key: "welcome", label: "Welcome new subscribers" },
  { key: "reviews", label: "Build trust with reviews" },
  { key: "loyalty", label: "Reward your best customers" }
];

/** Part 1's names for the three ready-made flows (Overview, Audience Health). */
export const LEGACY_TEMPLATE: Record<string, string> = { post_purchase: "post_purchase", win_back: "win_back", cart_recovery: "cart_abandonment", loyalty: "loyalty_update" };

export function draftFromTemplate(key: string | null, designer: EmDesigner | null): AutoDraft {
  const template = TEMPLATES.find((row) => row.key === key) ?? null;
  return {
    id: null, status: "draft", active: true,
    name: template?.name ?? "", description: template?.hint ?? "", template: template?.key ?? null, goal: template?.goal ?? "repeat",
    trigger: template?.trigger ?? { kind: "order_delivered", productId: null }, audience: { source: "all" },
    enrollment: { on: false, match: "all", conditions: [] },
    settings: { ...DEFAULT_SETTINGS, ...(template?.settings ?? {}), exit: { ...DEFAULT_SETTINGS.exit, ...(template?.settings?.exit ?? {}) } },
    workflow: { nodes: template ? template.flow(designer) : [] },
    stage: template?.stage ?? TRIGGER_STAGE.order_delivered
  };
}

export const draftFromAutomation = (row: EmAutomation): AutoDraft => ({
  id: row.id, status: row.status, active: row.status !== "paused" && row.status !== "archived",
  name: row.name, description: row.description, template: row.template, goal: row.goal, trigger: row.trigger, audience: row.audience,
  enrollment: row.enrollment, settings: row.settings, workflow: row.workflow, stage: row.stage
});

export const toAutomationInput = (draft: AutoDraft, launch: boolean): EmAutomationInput => ({
  name: draft.name.trim(), description: draft.description.trim(), template: draft.template, goal: draft.goal, trigger: draft.trigger, audience: draft.audience,
  enrollment: draft.enrollment, settings: draft.settings, workflow: draft.workflow, stage: draft.stage, launch
});

// ── Reading a flow ────────────────────────────────────────────────────

export const allNodes = (nodes: EmFlowNode[]): EmFlowNode[] => nodes.flatMap((node) => (node.type === "condition" ? [node, ...allNodes(node.yes), ...allNodes(node.no)] : [node]));
export const emailSteps = (flow: EmWorkflow) => allNodes(flow.nodes).filter((node): node is Extract<EmFlowNode, { type: "email" }> => node.type === "email");
const waitDays = (node: Extract<EmFlowNode, { type: "wait" }>) => (node.unit === "hours" ? node.amount / 24 : node.amount);
export function durationDays(nodes: EmFlowNode[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.type === "wait") total += waitDays(node);
    if (node.type === "condition") total += Math.max(durationDays(node.yes), durationDays(node.no));
  }
  return total;
}
export function durationText(days: number) {
  if (days <= 0) return "Same Day";
  if (days < 1) { const hours = Math.max(1, Math.round(days * 24)); return `${hours} ${hours === 1 ? "Hour" : "Hours"}`; }
  const rounded = Math.round(days * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${rounded === 1 ? "Day" : "Days"}`;
}

export function waitText(node: Extract<EmFlowNode, { type: "wait" }>) {
  return `${node.amount} ${node.unit === "hours" ? (node.amount === 1 ? "Hour" : "Hours") : node.amount === 1 ? "Day" : "Days"}`;
}

/** "How it works": one plain line per step, in order. */
export function howItWorks(draft: Pick<AutoDraft, "trigger" | "workflow">): string[] {
  const lines = [`Starts when ${TRIGGER_OPTIONS.find((row) => row.kind === draft.trigger.kind)?.when ?? "the trigger happens"}.`];
  let pending = "";
  const walk = (nodes: EmFlowNode[], prefix = "") => {
    for (const node of nodes) {
      if (node.type === "wait") { pending = `after ${waitText(node).toLowerCase()}`; continue; }
      if (node.type === "email") lines.push(`${prefix}Sends "${node.name.replace(/^Email \d+:\s*/, "")}"${pending ? ` ${pending}` : ""}.`);
      if (node.type === "tag") lines.push(`${prefix}${node.action === "add" ? "Tags" : "Untags"} the customer "${node.tagName}"${pending ? ` ${pending}` : ""}.`);
      if (node.type === "list") lines.push(`${prefix}Adds them to the list "${node.listName}"${pending ? ` ${pending}` : ""}.`);
      if (node.type === "exit") lines.push(`${prefix}Ends the flow.`);
      if (node.type === "condition") {
        lines.push(`${prefix}${pending ? `${pending[0].toUpperCase()}${pending.slice(1)}, asks` : "Asks"}: ${checkQuestion(node.check)}`);
        pending = "";
        if (node.yes.length) walk(node.yes, `${prefix}If yes: `);
        if (node.no.length) walk(node.no, `${prefix}If no: `);
        continue;
      }
      pending = "";
    }
  };
  walk(draft.workflow.nodes);
  return lines;
}

// ── Editing a flow (pure: every change returns a new flow) ────────────

/** A place in the flow: the list (root, or a check's yes/no) and the position in it. */
export type Slot = { parentId: string | null; branch: "yes" | "no" | null; index: number };

const mapLists = (nodes: EmFlowNode[], parentId: string | null, branch: "yes" | "no" | null, fn: (list: EmFlowNode[], parentId: string | null, branch: "yes" | "no" | null) => EmFlowNode[]): EmFlowNode[] => {
  const mapped = fn(nodes, parentId, branch).map((node) => (node.type === "condition"
    ? { ...node, yes: mapLists(node.yes, node.id, "yes", fn), no: mapLists(node.no, node.id, "no", fn) }
    : node));
  return mapped;
};

export function insertAt(flow: EmWorkflow, slot: Slot, node: EmFlowNode): EmWorkflow {
  return { nodes: mapLists(flow.nodes, null, null, (list, parentId, branch) => (parentId === slot.parentId && branch === slot.branch ? [...list.slice(0, slot.index), node, ...list.slice(slot.index)] : list)) };
}
export function removeNode(flow: EmWorkflow, id: string): EmWorkflow {
  return { nodes: mapLists(flow.nodes, null, null, (list) => list.filter((node) => node.id !== id)) };
}
export function replaceNode(flow: EmWorkflow, next: EmFlowNode): EmWorkflow {
  return { nodes: mapLists(flow.nodes, null, null, (list) => list.map((node) => (node.id === next.id ? (next.type === "condition" && node.type === "condition" ? { ...next, yes: node.yes, no: node.no } : next) : node))) };
}
export function moveNode(flow: EmWorkflow, id: string, by: -1 | 1): EmWorkflow {
  return {
    nodes: mapLists(flow.nodes, null, null, (list) => {
      const index = list.findIndex((node) => node.id === id);
      const to = index + by;
      if (index < 0 || to < 0 || to >= list.length) return list;
      const copy = [...list];
      [copy[index], copy[to]] = [copy[to], copy[index]];
      return copy;
    })
  };
}
export const findNode = (flow: EmWorkflow, id: string | null) => (id ? allNodes(flow.nodes).find((node) => node.id === id) ?? null : null);

export type ActionKey = "email" | "wait" | "condition" | "tag_add" | "tag_remove" | "list" | "exit";
/** A new step of a kind, ready to edit. */
export function newNode(kind: ActionKey, designer: EmDesigner | null, emailNumber: number): EmFlowNode {
  switch (kind) {
    case "email": return email(`Email ${emailNumber}: New Email`, starterEmail(designer, "retention", { title: "Your", highlight: "Headline", body: "Write your message here.", button: "Shop Now" }, "", ""));
    case "wait": return wait(1);
    case "condition": return check("Did the customer place another order?", "placed_order", [], []);
    case "tag_add": case "tag_remove": {
      const tag = designer?.tags.find((row) => row.kind === "custom");
      return { id: newId("t"), type: "tag", action: kind === "tag_add" ? "add" : "remove", tagId: tag?.id ?? "", tagName: tag?.name ?? "" };
    }
    case "list": {
      const list = designer?.segments.find((row) => row.kind === "fixed" && row.status !== "archived");
      return { id: newId("l"), type: "list", listId: list?.id ?? "", listName: list?.name ?? "" };
    }
    default: return { id: newId("x"), type: "exit" };
  }
}

/** What stops a launch, in plain words (the server checks the same). */
export function launchProblems(draft: AutoDraft, designer: EmDesigner | null): string[] {
  const out: string[] = [];
  if (!draft.name.trim()) out.push("Give the automation a name.");
  const emails = emailSteps(draft.workflow);
  if (!emails.length) out.push("Add at least one email to the flow.");
  for (const node of emails) if (!node.email.subject.trim() || !node.email.design?.blocks.length) out.push(`"${node.name}" needs a subject and some content.`);
  for (const node of allNodes(draft.workflow.nodes)) {
    if (node.type === "tag" && !node.tagId) out.push("Pick a tag for every tag step.");
    if (node.type === "list" && !node.listId) out.push("Pick a list for every list step.");
    if (node.type === "condition" && node.check.kind === "in_segment" && !node.check.segmentId) out.push(`Pick the segment for "${node.name}".`);
    if (node.type === "condition" && node.check.kind === "has_tag" && !node.check.tagId) out.push(`Pick the tag for "${node.name}".`);
  }
  if (draft.trigger.kind === "date_field" && !designer?.fields.some((field) => field.key === draft.trigger.fieldKey && field.type === "date")) {
    out.push("Add a date field first (Audience & Segments › Custom Fields, type Date), e.g. Birthday.");
  }
  if (designer && !designer.sender.ready) out.push(designer.sender.reason ?? "Email sending is not set up.");
  return [...new Set(out)];
}
