// Issue & Feedback Management rules (Bright, 9 Oct 2026). Pure functions:
// ticket codes, the status steps for each kind, the priority engine, the
// "similar issues" match, and removing secrets from captured technical data.

export type IssueKind = "issue" | "feature" | "ux" | "other";
export type Impact = "low" | "medium" | "high" | "critical";
export type Affected = "only_me" | "one_customer" | "several_users" | "department" | "everyone" | "not_sure";
export type Priority = "P0" | "P1" | "P2" | "P3";

const PREFIX: Record<IssueKind, string> = { issue: "BUG", feature: "FEAT", ux: "UX", other: "OTH" };
export const ticketCode = (kind: IssueKind, ticketNo: number) => `${PREFIX[kind] ?? "OTH"}-${String(ticketNo).padStart(4, "0")}`;
/** "BUG-1048" / "bug 1048" / "1048" -> 1048. */
export const ticketNumberFrom = (text: string) => {
  const match = String(text ?? "").trim().match(/^(?:[a-z]+[\s-]*)?(\d{1,9})$/i);
  return match ? Number(match[1]) : null;
};

// ── Status steps ──
// Bugs, UI/UX and Other: New -> Triaged -> Assigned -> In Progress -> Testing
// -> Resolved -> Closed, plus Needs More Information, Duplicate, Won't Fix,
// Planned and Reopened. Features: New -> Under Review -> Approved -> Planned
// -> In Development -> Released (-> Closed), plus the same side states.
export const BUG_STATUSES = ["new", "triaged", "assigned", "in_progress", "testing", "resolved", "closed", "reopened", "needs_info", "duplicate", "wont_fix", "planned"] as const;
export const FEATURE_STATUSES = ["new", "under_review", "approved", "planned", "in_development", "released", "closed", "needs_info", "duplicate", "wont_fix"] as const;
export type IssueStatus = (typeof BUG_STATUSES)[number] | (typeof FEATURE_STATUSES)[number];
export const statusesFor = (kind: IssueKind): readonly IssueStatus[] => (kind === "feature" ? FEATURE_STATUSES : BUG_STATUSES);
export const STATUS_LABEL: Record<IssueStatus, string> = {
  new: "New", triaged: "Triaged", assigned: "Assigned", in_progress: "In Progress", testing: "Testing", resolved: "Resolved",
  closed: "Closed", reopened: "Reopened", needs_info: "Needs More Information", duplicate: "Duplicate", wont_fix: "Won't Fix",
  planned: "Planned", under_review: "Under Review", approved: "Approved", in_development: "In Development", released: "Released"
};
/** Finished: nothing more to do, not counted as open. */
export const DONE_STATUSES: readonly IssueStatus[] = ["closed", "duplicate", "wont_fix"];
/** Waiting for the reporter to say whether it is fixed. */
export const AWAITING_CONFIRMATION: readonly IssueStatus[] = ["resolved", "released"];
export const isOpen = (status: string) => !DONE_STATUSES.includes(status as IssueStatus) && !AWAITING_CONFIRMATION.includes(status as IssueStatus);

// ── Priority engine ──
// The reporter gives IMPACT; Protohub works out PRIORITY, so not every bug
// becomes "urgent". Base from impact x who is affected, then raised by
// "experiencing this too", orders or customers involved, and age.
const LEVELS: Priority[] = ["P0", "P1", "P2", "P3"];
const raise = (priority: Priority, steps: number, floor: Priority = "P0") => {
  const index = Math.max(LEVELS.indexOf(floor), LEVELS.indexOf(priority) - steps);
  return LEVELS[Math.min(index, LEVELS.indexOf(priority))];
};
export function basePriority(impact: Impact | null | undefined, affected: Affected | null | undefined): Priority {
  const wide = affected === "everyone";
  const many = affected === "several_users" || affected === "department" || wide;
  if (impact === "critical") return wide || affected === "department" ? "P0" : "P1";
  if (impact === "high") return many ? "P1" : "P2";
  if (impact === "medium") return many ? "P2" : "P3";
  return "P3";
}
/** Money, payments, customer data or security in the words: a business risk. */
const RISK_WORDS = /\b(payment|paid|money|cash|remit\w*|refund|transfer|amount|price|charge\w*|wallet|bonus|salary|password|login|security|hack\w*|leak\w*|data loss|deleted|missing data|wrong (amount|total|figure))\b/i;
export const mentionsRisk = (text: string | null | undefined) => RISK_WORDS.test(String(text ?? ""));

export function autoPriority(input: {
  kind: IssueKind; impact?: Impact | null; affected?: Affected | null; affectedCount?: number;
  affectedRefKind?: string | null; createdAt?: string; now?: Date; status?: string;
  /** Title + description: money / payments / security / data raise it one step (never past P1). */
  text?: string | null;
}): Priority | null {
  if (input.kind === "feature") return null;
  let priority = basePriority(input.impact ?? null, input.affected ?? null);
  const others = Math.max(0, (input.affectedCount ?? 1) - 1);
  if (others >= 10) priority = raise(priority, 2);
  else if (others >= 3) priority = raise(priority, 1);
  // An order or customer is involved and it matters: money or a customer is waiting.
  if ((input.affectedRefKind === "order" || input.affectedRefKind === "customer" || input.affectedRefKind === "delivery")
    && (input.impact === "high" || input.impact === "critical")) priority = raise(priority, 1, "P1");
  // Money, payments, customer data or security at stake, and it matters.
  if (input.impact && input.impact !== "low" && mentionsRisk(input.text)) priority = raise(priority, 1, "P1");
  // Left unresolved for a week: one step, never to P0 on age alone.
  if (input.createdAt && input.status && isOpen(input.status)) {
    const days = ((input.now ?? new Date()).getTime() - new Date(input.createdAt).getTime()) / 86_400_000;
    if (days >= 7) priority = raise(priority, 1, "P1");
  }
  return priority;
}

/** First-response targets, hours. The team is alerted at 75% of each. */
export const RESPONSE_TARGET_HOURS: Record<Priority, number | null> = { P0: 4, P1: 24, P2: 72, P3: null };

// ── "Similar issues already reported" ──
const STOP = new Set(["the", "and", "for", "with", "when", "not", "page", "this", "that", "from", "after", "into", "can", "cannot", "cant", "dont", "does", "doesnt", "is", "are", "was", "showing", "shows", "show"]);
export const titleWords = (text: string) => new Set(String(text ?? "").toLowerCase().replace(/[^a-z0-9#\s]/g, " ").split(/\s+/)
  .map((word) => word.replace(/s$/, "")).filter((word) => word.length >= 3 && !STOP.has(word)));
export function similarity(a: { title: string; module?: string | null }, b: { title: string; module?: string | null }) {
  const left = titleWords(a.title);
  const right = titleWords(b.title);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  left.forEach((word) => { if (right.has(word)) shared += 1; });
  const score = shared / (left.size + right.size - shared);
  return Math.min(1, score + (a.module && b.module && a.module === b.module && shared > 0 ? 0.15 : 0));
}

// ── Technical data: never store secrets ──
// Keys that hold secrets. Not "session": a support session number is useful.
const SECRET_KEY = /(passw(or)?d|^pass$|token|secret|authori[sz]ation|api[-_]?key|cookie|^otp$|^pin$|cvv|credential)/i;
const SECRET_QUERY = /([?&](?:[^=&]*(?:token|key|secret|password|code|signature|sig)[^=&]*)=)[^&#]*/gi;
const BEARER = /bearer\s+[a-z0-9._-]+/gi;
const JWT = /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{5,}/g;
export function redactText(text: unknown, max = 500) {
  return String(text ?? "").replace(BEARER, "Bearer [removed]").replace(JWT, "[removed]").replace(SECRET_QUERY, "$1[removed]").slice(0, max);
}
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[key] = SECRET_KEY.test(key) ? "[removed]" : redact(item, depth + 1);
    }
    return out;
  }
  return null;
}

/** The team a role belongs to, for "Reports by department". */
export function departmentFor(role: string) {
  if (["Sales Rep", "Sales Closer"].includes(role)) return "Sales";
  if (role === "Recovery Rep") return "Recovery";
  if (role.startsWith("Inventory")) return "Inventory & Logistics";
  if (role === "Delivery Agent") return "Delivery";
  if (role === "Marketer") return "Marketing";
  if (role === "Manager") return "Management";
  if (role === "Admin") return "Administration";
  if (role === "Owner") return "Owner";
  return role || "Other";
}
