import { DAY_MS } from "./email-marketing-rules.js";
import { normalizeDesign, type EmailDesign } from "./email-render.js";

/**
 * Automations (Bright's designs 50, 51 and steps 2-4, 8 Nov 2026): the shape
 * of a flow and the rules for walking it. Pure, tested in
 * email-automation-rules.test.ts; lib/email-automations.ts does the reading,
 * enrolling and sending.
 */

// ── Shapes ────────────────────────────────────────────────────────────

export const TRIGGER_KINDS = ["order_delivered", "order_placed", "cart_abandoned", "new_subscriber", "inactive", "date_field", "vip", "reorder", "went_quiet", "in_segment"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];
export type Trigger = {
  kind: TriggerKind;
  /** order_delivered / order_placed / reorder: only this product (null = any). */
  productId?: string | null;
  /** cart_abandoned: minutes after the cart was left. */
  cartMinutes?: number;
  /** inactive: days since the last delivered order. */
  inactiveDays?: number;
  /** date_field: the custom field (a date) to celebrate, e.g. a birthday. */
  fieldKey?: string;
  /** vip: delivered orders that make a customer a VIP. */
  vipOrders?: number;
  /** reorder: days after delivery when it is time to buy again. */
  reorderDays?: number;
  /** in_segment: the group (segment) whose customers walk the flow. */
  segmentId?: string;
  /** in_segment: which flow wins when a customer is in several groups (lower first). */
  rank?: number;
  /** went_quiet: days after the order before the first email. */
  quietDays?: number;
  /** went_quiet: only customers who went quiet for these reasons (empty = all). */
  quietReasons?: QuietReason[];
};

// Customers who went quiet: the rule lives in email-marketing-rules.ts (segments use it too).
export { QUIET_REASONS, QUIET_REASON_LABELS, quietReason, type QuietReason } from "./email-marketing-rules.js";
import { QUIET_REASONS, type QuietReason } from "./email-marketing-rules.js";

export const CHECK_KINDS = ["placed_order", "delivered_order", "opened_last", "clicked_last", "left_review", "in_segment", "has_tag"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];
export type Check = { kind: CheckKind; segmentId?: string; tagId?: string };

export type EmailContent = {
  subject: string;
  preheader: string;
  design: EmailDesign | null;
  productId: string | null;
  thumbnailUrl: string | null;
  /** Coupons & Offers: applied when they order from this email. */
  offerId?: string | null;
};

export type WorkflowNode =
  | { id: string; type: "wait"; amount: number; unit: "hours" | "days" }
  | { id: string; type: "email"; name: string; email: EmailContent; campaignId?: string | null }
  | { id: string; type: "condition"; name: string; check: Check; yes: WorkflowNode[]; no: WorkflowNode[] }
  | { id: string; type: "tag"; action: "add" | "remove"; tagId: string; tagName: string }
  | { id: string; type: "list"; listId: string; listName: string }
  | { id: string; type: "exit" };
export type Workflow = { nodes: WorkflowNode[] };

export type SendWindow = { on: boolean; from: number; to: number; days: number[] };
export type AutomationSettings = {
  reentry: boolean;
  reentryDays: number;
  frequency: "per_event" | "max_2" | "max_3" | "unlimited";
  priority: "low" | "normal" | "high";
  exit: { onUnsubscribe: boolean; onPurchase: boolean; afterDays: number | null };
  sendWindow: SendWindow;
  utm: boolean;
  track: boolean;
  replyTo: string;
  /** Payday timing (Bright, 9 Nov 2026, from "sell when customers have money"): an email due on the 8th–24th waits for the 25th. */
  payday?: boolean;
};

export const DEFAULT_SETTINGS: AutomationSettings = {
  reentry: true, reentryDays: 30, frequency: "per_event", priority: "normal",
  exit: { onUnsubscribe: true, onPurchase: false, afterDays: null },
  sendWindow: { on: true, from: 8, to: 19, days: [1, 2, 3, 4, 5] },
  utm: true, track: true, replyTo: ""
};

export const AUTOMATION_GOALS = ["repeat", "winback", "cart", "welcome", "reviews", "reorder", "occasion", "loyalty", "upsell"] as const;

/** Customer Journey (design 53) groups the flows by the customer's stage. */
export const STAGES = ["acquisition", "nurture", "conversion", "retention", "winback", "post_purchase"] as const;
export type Stage = (typeof STAGES)[number];
const TEMPLATE_STAGE: Record<string, Stage> = {
  welcome: "acquisition", review_feedback: "nurture", birthday: "nurture", cart_abandonment: "conversion",
  repeat_buyer: "retention", replenishment: "retention", vip_loyalty: "retention", win_back: "winback", post_purchase: "post_purchase", upsell_cross_sell: "post_purchase"
};
const TRIGGER_STAGE: Record<string, Stage> = {
  new_subscriber: "acquisition", date_field: "nurture", cart_abandoned: "conversion", order_placed: "conversion",
  reorder: "retention", vip: "retention", inactive: "winback", went_quiet: "winback", in_segment: "retention", order_delivered: "post_purchase"
};
/** A flow's stage when none was picked: from its ready-made template, else its trigger. */
export function defaultStage(template: string | null | undefined, trigger: { kind: string } | null | undefined): Stage {
  return (template && TEMPLATE_STAGE[template]) || TRIGGER_STAGE[trigger?.kind ?? ""] || "retention";
}
export const PRIORITY_RANK: Record<AutomationSettings["priority"], number> = { low: 0, normal: 1, high: 2 };

// ── Cleaning what the browser sends ──────────────────────────────────

const ID = /^[A-Za-z0-9_-]{1,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const int = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

export function normalizeTrigger(raw: any): Trigger {
  const kind: TriggerKind = TRIGGER_KINDS.includes(raw?.kind) ? raw.kind : "order_delivered";
  const out: Trigger = { kind };
  if (["order_delivered", "order_placed", "reorder", "cart_abandoned"].includes(kind)) out.productId = UUID.test(String(raw?.productId ?? "")) ? raw.productId : null;
  if (kind === "cart_abandoned") out.cartMinutes = int(raw?.cartMinutes, 15, 7 * 24 * 60, 60);
  if (kind === "inactive") out.inactiveDays = int(raw?.inactiveDays, 7, 365, 60);
  if (kind === "date_field") out.fieldKey = /^[a-z][a-z0-9_]{0,40}$/.test(String(raw?.fieldKey ?? "")) ? raw.fieldKey : "birthday";
  if (kind === "vip") out.vipOrders = int(raw?.vipOrders, 2, 50, 3);
  if (kind === "reorder") out.reorderDays = int(raw?.reorderDays, 7, 365, 30);
  if (kind === "in_segment") {
    out.segmentId = UUID.test(String(raw?.segmentId ?? "")) ? raw.segmentId : "";
    out.rank = int(raw?.rank, 0, 99, 50);
  }
  if (kind === "went_quiet") {
    out.quietDays = int(raw?.quietDays, 1, 120, 1);
    out.quietReasons = Array.isArray(raw?.quietReasons) ? [...new Set<QuietReason>(raw.quietReasons.filter((r: any) => QUIET_REASONS.includes(r)))] : [];
  }
  return out;
}

export function normalizeSettings(raw: any): AutomationSettings {
  const d = DEFAULT_SETTINGS;
  const days = Array.isArray(raw?.sendWindow?.days) ? [...new Set(raw.sendWindow.days.map(Number).filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6))].sort() as number[] : d.sendWindow.days;
  const from = int(raw?.sendWindow?.from, 0, 23, d.sendWindow.from);
  const to = int(raw?.sendWindow?.to, 1, 24, d.sendWindow.to);
  const reply = text(raw?.replyTo, 254).toLowerCase();
  return {
    reentry: raw?.reentry === undefined ? d.reentry : !!raw.reentry,
    reentryDays: int(raw?.reentryDays, 0, 365, d.reentryDays),
    frequency: ["per_event", "max_2", "max_3", "unlimited"].includes(raw?.frequency) ? raw.frequency : d.frequency,
    priority: ["low", "normal", "high"].includes(raw?.priority) ? raw.priority : d.priority,
    exit: {
      onUnsubscribe: raw?.exit?.onUnsubscribe === undefined ? d.exit.onUnsubscribe : !!raw.exit.onUnsubscribe,
      onPurchase: !!raw?.exit?.onPurchase,
      afterDays: raw?.exit?.afterDays === null || raw?.exit?.afterDays === undefined || raw?.exit?.afterDays === "" ? null : int(raw.exit.afterDays, 1, 365, 30)
    },
    sendWindow: { on: raw?.sendWindow?.on === undefined ? d.sendWindow.on : !!raw.sendWindow.on, from, to: Math.max(from + 1, to), days: days.length ? days : d.sendWindow.days },
    utm: raw?.utm === undefined ? d.utm : !!raw.utm,
    track: raw?.track === undefined ? d.track : !!raw.track,
    replyTo: /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(reply) ? reply : "",
    ...(raw?.payday ? { payday: true } : {})
  };
}

function normalizeCheck(raw: any): Check {
  const kind: CheckKind = CHECK_KINDS.includes(raw?.kind) ? raw.kind : "placed_order";
  const out: Check = { kind };
  if (kind === "in_segment" && UUID.test(String(raw?.segmentId ?? ""))) out.segmentId = raw.segmentId;
  if (kind === "has_tag" && UUID.test(String(raw?.tagId ?? ""))) out.tagId = raw.tagId;
  return out;
}

export const WORKFLOW_LIMITS = { nodes: 40, depth: 3, emails: 10 };

/** Checks every step the browser sends; throws with a plain message when the flow is unusable. */
export function normalizeWorkflow(raw: any): Workflow {
  let count = 0;
  let emails = 0;
  const ids = new Set<string>();
  const walk = (list: any, depth: number): WorkflowNode[] => {
    if (!Array.isArray(list)) return [];
    const out: WorkflowNode[] = [];
    for (const node of list) {
      count += 1;
      if (count > WORKFLOW_LIMITS.nodes) throw new Error(`An automation can have up to ${WORKFLOW_LIMITS.nodes} steps.`);
      const id = ID.test(String(node?.id ?? "")) && !ids.has(node.id) ? String(node.id) : `n${count}${Math.random().toString(36).slice(2, 7)}`;
      ids.add(id);
      switch (node?.type) {
        case "wait":
          out.push({ id, type: "wait", amount: int(node.amount, 1, node.unit === "hours" ? 720 : 365, 1), unit: node.unit === "hours" ? "hours" : "days" });
          break;
        case "email": {
          emails += 1;
          if (emails > WORKFLOW_LIMITS.emails) throw new Error(`An automation can send up to ${WORKFLOW_LIMITS.emails} emails.`);
          const design = node.email?.design === undefined || node.email?.design === null ? null : normalizeDesign(node.email.design);
          if (design && JSON.stringify(design).length > 600_000) throw new Error("One of the emails is too big. Remove some HTML or pictures.");
          out.push({
            id, type: "email", name: text(node.name, 80) || "Email",
            email: {
              subject: text(node.email?.subject, 200), preheader: text(node.email?.preheader, 100), design,
              productId: UUID.test(String(node.email?.productId ?? "")) ? node.email.productId : null,
              thumbnailUrl: /^https:\/\//i.test(String(node.email?.thumbnailUrl ?? "")) ? String(node.email.thumbnailUrl).slice(0, 2000) : null,
              offerId: UUID.test(String(node.email?.offerId ?? "")) ? node.email.offerId : null
            },
            campaignId: UUID.test(String(node.campaignId ?? "")) ? node.campaignId : null
          });
          break;
        }
        case "condition":
          if (depth >= WORKFLOW_LIMITS.depth) throw new Error(`Checks can sit inside each other up to ${WORKFLOW_LIMITS.depth} deep.`);
          out.push({ id, type: "condition", name: text(node.name, 80), check: normalizeCheck(node.check), yes: walk(node.yes, depth + 1), no: walk(node.no, depth + 1) });
          break;
        case "tag":
          if (!UUID.test(String(node.tagId ?? ""))) throw new Error("Pick a tag for every tag step.");
          out.push({ id, type: "tag", action: node.action === "remove" ? "remove" : "add", tagId: node.tagId, tagName: text(node.tagName, 60) });
          break;
        case "list":
          if (!UUID.test(String(node.listId ?? ""))) throw new Error("Pick a list for every list step.");
          out.push({ id, type: "list", listId: node.listId, listName: text(node.listName, 120) });
          break;
        case "exit":
          out.push({ id, type: "exit" });
          break;
        default:
          throw new Error("The flow has a step Protohub doesn't know.");
      }
    }
    return out;
  };
  return { nodes: walk(raw?.nodes, 0) };
}

// ── Walking the flow ──────────────────────────────────────────────────

export function allNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.flatMap((node) => (node.type === "condition" ? [node, ...allNodes(node.yes), ...allNodes(node.no)] : [node]));
}
export const emailNodes = (workflow: Workflow) => allNodes(workflow.nodes).filter((node): node is Extract<WorkflowNode, { type: "email" }> => node.type === "email");
export const findNode = (workflow: Workflow, id: string | null | undefined) => (id ? allNodes(workflow.nodes).find((node) => node.id === id) ?? null : null);

/**
 * The list a step sits in, its place there, and the chain of checks above it
 * (innermost last), so "what comes next" can climb out of a finished branch.
 */
function locate(nodes: WorkflowNode[], id: string, parents: Array<{ list: WorkflowNode[]; index: number }> = []): { list: WorkflowNode[]; index: number; parents: Array<{ list: WorkflowNode[]; index: number }> } | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.id === id) return { list: nodes, index, parents };
    if (node.type === "condition") {
      const inside = locate(node.yes, id, [...parents, { list: nodes, index }]) ?? locate(node.no, id, [...parents, { list: nodes, index }]);
      if (inside) return inside;
    }
  }
  return null;
}

export const firstNodeId = (workflow: Workflow) => workflow.nodes[0]?.id ?? null;

/** The step after `id`: the next one in its list, or after the check whose branch just ended. Null = the end. */
export function nextNodeId(workflow: Workflow, id: string): string | null {
  const at = locate(workflow.nodes, id);
  if (!at) return null;
  if (at.index + 1 < at.list.length) return at.list[at.index + 1].id;
  for (let i = at.parents.length - 1; i >= 0; i -= 1) {
    const parent = at.parents[i];
    if (parent.index + 1 < parent.list.length) return parent.list[parent.index + 1].id;
  }
  return null;
}

/** Where a check sends the customer: the first step of its Yes/No branch, or past the check when that branch is empty. */
export function branchNodeId(workflow: Workflow, conditionId: string, yes: boolean): string | null {
  const node = findNode(workflow, conditionId);
  if (!node || node.type !== "condition") return null;
  const branch = yes ? node.yes : node.no;
  return branch[0]?.id ?? nextNodeId(workflow, conditionId);
}

export const waitMs = (node: Extract<WorkflowNode, { type: "wait" }>) => node.amount * (node.unit === "hours" ? 3_600_000 : DAY_MS);

/** The longest time a customer can spend in the flow, in days (waits only). */
export function durationDays(nodes: WorkflowNode[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.type === "wait") total += waitMs(node) / DAY_MS;
    if (node.type === "condition") total += Math.max(durationDays(node.yes), durationDays(node.no));
  }
  return Math.round(total * 100) / 100;
}

// ── Sending hours (Lagos) ─────────────────────────────────────────────

const LAGOS_MS = 3_600_000;
const lagosParts = (ms: number) => { const d = new Date(ms + LAGOS_MS); return { day: d.getUTCDay(), hour: d.getUTCHours() }; };

export function inSendWindow(ms: number, window: SendWindow) {
  if (!window.on) return true;
  const { day, hour } = lagosParts(ms);
  return window.days.includes(day) && hour >= window.from && hour < window.to;
}

/**
 * Payday weeks (Bright, 9 Nov 2026): most customers have money from the 25th
 * to the 7th, so a selling email due on the 8th–24th (Lagos) waits for the
 * 25th at 9am. Returns `ms` itself when it is already payday time.
 */
export function nextPaydayMs(ms: number) {
  const lagos = new Date(ms + LAGOS_MS);
  const day = lagos.getUTCDate();
  if (day < 8 || day >= 25) return ms;
  return Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), 25, 9) - LAGOS_MS;
}

/** The next moment the window is open, from `ms` (itself when already open). */
export function nextWindowStart(ms: number, window: SendWindow) {
  if (inSendWindow(ms, window)) return ms;
  const lagos = new Date(ms + LAGOS_MS);
  for (let add = 0; add <= 7; add += 1) {
    const start = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() + add, window.from) - LAGOS_MS;
    if (start >= ms && inSendWindow(start, window)) return start;
  }
  return ms + DAY_MS;
}

// ── Checks and entering ───────────────────────────────────────────────

export type CheckFacts = {
  placedOrderSince: boolean;
  deliveredSince: boolean;
  openedLast: boolean;
  clickedLast: boolean;
  reviewed: boolean;
  inSegment: (segmentId: string) => boolean;
  hasTag: (tagId: string) => boolean;
};

export function checkMet(check: Check, facts: CheckFacts) {
  switch (check.kind) {
    case "placed_order": return facts.placedOrderSince;
    case "delivered_order": return facts.deliveredSince;
    case "opened_last": return facts.openedLast || facts.clickedLast;
    case "clicked_last": return facts.clickedLast;
    case "left_review": return facts.reviewed;
    case "in_segment": return !!check.segmentId && facts.inSegment(check.segmentId);
    case "has_tag": return !!check.tagId && facts.hasTag(check.tagId);
    default: return false;
  }
}

/**
 * May this customer start (again)? `past` = their earlier walks through this
 * automation (newest first). One walk at a time; re-entry off = once ever.
 */
export function mayEnter(settings: AutomationSettings, past: Array<{ status: string; enteredMs: number }>, nowMs: number) {
  if (past.some((run) => run.status === "active")) return false;
  if (!past.length) return true;
  if (!settings.reentry) return false;
  const limit = settings.frequency === "max_2" ? 2 : settings.frequency === "max_3" ? 3 : Infinity;
  if (past.length >= limit) return false;
  const last = Math.max(...past.map((run) => run.enteredMs));
  return nowMs - last >= settings.reentryDays * DAY_MS;
}

/** "08:00" style hour for summaries and the browser. */
export const hourText = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 || hour === 24 ? "AM" : "PM"}`;
