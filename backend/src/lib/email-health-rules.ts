import { DAY_MS, lagosDay, phoneKey } from "./email-marketing-rules.js";

/**
 * Audience Health rules (Bright's 7 designs, 8 Nov 2026). Pure functions,
 * tested in email-health-rules.test.ts; lib/email-health.ts reads the data.
 *
 * Nothing here guesses. A number that needs data we don't have (inbox
 * placement, an outside reputation score) is not worked out at all; the
 * screen says so.
 */

export type HealthContact = {
  id: string;
  email: string;
  phone: string | null;
  source: string;
  status: string;
  createdMs: number;
  statusChangedMs: number | null;
  statusReason: string | null;
  importId: string | null;
  lastOpenedMs: number | null;
  lastClickedMs: number | null;
  lastEmailedMs: number | null;
};

export type HealthSend = {
  contactId: string | null;
  email: string;
  campaignId: string;
  status: string;
  sentMs: number | null;
  queuedMs: number;
  openedMs: number | null;
  clickedMs: number | null;
  bouncedMs: number | null;
  bounceKind: string | null;
  spamMs: number | null;
  unsubscribedMs: number | null;
  orderId: string | null;
};

export type Range = { fromMs: number; toMs: number };

const inRange = (ms: number | null | undefined, range: Range) => !!ms && ms >= range.fromMs && ms < range.toMs;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// ── Quality ───────────────────────────────────────────────────────────

export type Validity = "valid" | "bounced" | "unsubscribed" | "duplicate" | "other";

/** Never opened or clicked any of 3+ emails, the first sent 60+ days before `atMs`. */
export function longQuiet(mine: HealthSend[], atMs: number) {
  const sent = mine.filter((send) => send.status === "sent" && send.sentMs !== null && send.sentMs <= atMs);
  if (sent.length < 3) return false;
  if (sent.some((send) => (send.openedMs !== null && send.openedMs <= atMs) || (send.clickedMs !== null && send.clickedMs <= atMs))) return false;
  return atMs - Math.min(...sent.map((send) => send.sentMs!)) >= 60 * DAY_MS;
}

export function sendsByContact(sends: HealthSend[]) {
  const out = new Map<string, HealthSend[]>();
  for (const send of sends) {
    if (!send.contactId) continue;
    const list = out.get(send.contactId);
    if (list) list.push(send); else out.set(send.contactId, [send]);
  }
  return out;
}

/** Status at a moment, worked back from when it last changed. */
const statusAt = (contact: HealthContact, atMs: number) => (contact.status === "subscribed" || (contact.statusChangedMs !== null && contact.statusChangedMs > atMs) ? "subscribed" : contact.status);

/**
 * Each person's standing at a moment. Valid = can be emailed and is not one of
 * the others. Duplicate = an older second email for the same phone (one
 * customer, two addresses). Other = never opened 3+ emails over 60+ days, or
 * taken out by a list clean-up ("cleaned"): neither counts as good standing,
 * so a clean-up never lowers the quality number.
 */
export function standingAt(contacts: HealthContact[], byContact: Map<string, HealthSend[]>, atMs: number): Map<string, Validity> {
  const out = new Map<string, Validity>();
  const byPhone = new Map<string, HealthContact[]>();
  for (const contact of contacts) {
    if (contact.createdMs > atMs) continue;
    const mine = byContact.get(contact.id) ?? [];
    const status = statusAt(contact, atMs);
    const hardBounced = mine.some((send) => send.bouncedMs !== null && send.bouncedMs <= atMs && send.bounceKind !== "soft");
    if (status === "bounced" || hardBounced) { out.set(contact.id, "bounced"); continue; }
    if (status === "unsubscribed") { out.set(contact.id, "unsubscribed"); continue; }
    if (status !== "subscribed" || longQuiet(mine, atMs)) { out.set(contact.id, "other"); continue; }
    const key = phoneKey(contact.phone);
    if (key) { const group = byPhone.get(key); if (group) group.push(contact); else byPhone.set(key, [contact]); }
    out.set(contact.id, "valid");
  }
  for (const group of byPhone.values()) {
    if (group.length < 2) continue;
    const newest = group.reduce((best, contact) => (contact.createdMs > best.createdMs ? contact : best));
    for (const contact of group) if (contact.id !== newest.id) out.set(contact.id, "duplicate");
  }
  return out;
}

export function classify(contacts: HealthContact[], sends: HealthSend[] = [], nowMs = Date.now()) {
  return standingAt(contacts, sendsByContact(sends), nowMs);
}

export function qualityCounts(validity: Map<string, Validity>) {
  const counts = { total: validity.size, valid: 0, bounced: 0, unsubscribed: 0, duplicate: 0, other: 0 };
  for (const value of validity.values()) counts[value] += 1;
  return { ...counts, qualityPercent: pct(counts.valid, counts.total) };
}

/** Day by day share of the list in good standing (the same rule as today's number). */
export function qualityTrend(contacts: HealthContact[], sends: HealthSend[], days: string[]) {
  const byContact = sendsByContact(sends);
  return days.map((day) => {
    const counts = qualityCounts(standingAt(contacts, byContact, Date.parse(`${day}T23:59:59+01:00`)));
    return { day, value: counts.qualityPercent };
  });
}

/** Left the list: unsubscribed or bounced (a clean-up is our choice, not a loss). */
const leftBy = (contact: HealthContact, atMs: number) => (contact.status === "unsubscribed" || contact.status === "bounced") && (contact.statusChangedMs ?? contact.createdMs) <= atMs;
const leftIn = (contact: HealthContact, range: Range) => (contact.status === "unsubscribed" || contact.status === "bounced") && inRange(contact.statusChangedMs, range);

// ── Engagement ────────────────────────────────────────────────────────

export function engagement(sends: HealthSend[], contacts: HealthContact[], range: Range, nowMs: number) {
  const sent = sends.filter((send) => send.status === "sent" && inRange(send.sentMs, range));
  const people = new Set(sent.map((send) => send.email));
  const opened = new Set(sent.filter((send) => send.openedMs || send.clickedMs).map((send) => send.email));
  const clicked = new Set(sent.filter((send) => send.clickedMs).map((send) => send.email));
  // Opened two or more different campaigns.
  const campaignsOpened = new Map<string, Set<string>>();
  for (const send of sends) if (send.openedMs || send.clickedMs) campaignsOpened.set(send.email, new Set([...(campaignsOpened.get(send.email) ?? []), send.campaignId]));
  const everOpened = [...campaignsOpened.values()];
  const repeat = everOpened.filter((set) => set.size >= 2).length;
  // Re-engaged: opened in the period after 60+ quiet days with emails going out.
  const byEmail = new Map<string, HealthSend[]>();
  for (const send of sends) { const list = byEmail.get(send.email); if (list) list.push(send); else byEmail.set(send.email, [send]); }
  const reengaged = new Set<string>();
  for (const send of sent) {
    if (!send.openedMs || !inRange(send.openedMs, range)) continue;
    const mine = byEmail.get(send.email) ?? [];
    const openedLately = mine.some((other) => other.openedMs && other.openedMs < send.openedMs! && send.openedMs! - other.openedMs <= 60 * DAY_MS);
    const emailedBefore = mine.some((other) => other.sentMs && other.sentMs < send.sentMs! - 60 * DAY_MS);
    if (!openedLately && emailedBefore) reengaged.add(send.email);
  }
  const active = contacts.filter((contact) => contact.status === "subscribed" && Math.max(contact.lastOpenedMs ?? 0, contact.lastClickedMs ?? 0) >= nowMs - 30 * DAY_MS).length;
  const subscribed = contacts.filter((contact) => contact.status === "subscribed");
  const inactive = subscribed.filter((contact) => contact.lastEmailedMs && Math.max(contact.lastOpenedMs ?? 0, contact.lastClickedMs ?? 0) < nowMs - 90 * DAY_MS).length;
  return {
    sent: sent.length, people: people.size, opened: opened.size, clicked: clicked.size,
    openRate: pct(opened.size, people.size), clickRate: pct(clicked.size, people.size),
    repeatEngagement: pct(repeat, everOpened.length), reengaged: reengaged.size,
    active, activePercent: pct(active, subscribed.length), inactive, inactivePercent: pct(inactive, contacts.length)
  };
}

/** Open and click rate of the emails sent each day. */
export function dailyRates(sends: HealthSend[], days: string[]) {
  const byDay = new Map<string, HealthSend[]>();
  for (const send of sends) if (send.status === "sent" && send.sentMs) { const day = lagosDay(send.sentMs); byDay.set(day, [...(byDay.get(day) ?? []), send]); }
  return days.map((day) => {
    const rows = byDay.get(day) ?? [];
    return { day, sent: rows.length, openRate: pct(rows.filter((send) => send.openedMs || send.clickedMs).length, rows.length), clickRate: pct(rows.filter((send) => send.clickedMs).length, rows.length) };
  });
}

// ── Deliverability ────────────────────────────────────────────────────

export function delivery(sends: HealthSend[], range: Range) {
  const tried = sends.filter((send) => (send.status === "sent" || send.status === "failed") && inRange(send.sentMs ?? send.queuedMs, range));
  const accepted = tried.filter((send) => send.status === "sent");
  const failed = tried.filter((send) => send.status === "failed").length;
  const bounced = accepted.filter((send) => send.bouncedMs).length;
  const hard = accepted.filter((send) => send.bouncedMs && send.bounceKind !== "soft").length;
  const spam = accepted.filter((send) => send.spamMs).length;
  const delivered = accepted.length - bounced;
  return {
    tried: tried.length, accepted: accepted.length, delivered, failed, bounced, hard, spam,
    deliveredRate: pct(delivered, tried.length), failedRate: pct(failed, tried.length),
    bounceRate: pct(bounced, accepted.length), spamRate: pct(spam, accepted.length)
  };
}

export function dailyDelivery(sends: HealthSend[], days: string[]) {
  return days.map((day) => {
    const rows = sends.filter((send) => (send.status === "sent" || send.status === "failed") && lagosDay(send.sentMs ?? send.queuedMs) === day);
    const delivered = rows.filter((send) => send.status === "sent" && !send.bouncedMs).length;
    return { day, sent: rows.length, value: pct(delivered, rows.length) };
  });
}

/** Our own list's standing from its own numbers (not an outside score). */
export function listReputation(input: { bounceRate: number | null; spamRate: number | null; unsubscribeRate: number | null }) {
  const { bounceRate, spamRate, unsubscribeRate } = input;
  if (bounceRate === null && spamRate === null && unsubscribeRate === null) return null;
  if ((spamRate ?? 0) >= 0.3 || (bounceRate ?? 0) >= 5) return "Poor";
  if ((spamRate ?? 0) >= 0.1 || (bounceRate ?? 0) >= 2 || (unsubscribeRate ?? 0) >= 2) return "Fair";
  if ((bounceRate ?? 0) >= 1 || (unsubscribeRate ?? 0) >= 1) return "Good";
  return "Excellent";
}

// ── At risk ───────────────────────────────────────────────────────────

export function atRisk(contacts: HealthContact[], validity: Map<string, Validity>, nowMs: number) {
  const quiet = contacts.filter((contact) => contact.status === "subscribed" && contact.lastEmailedMs
    && Math.max(contact.lastOpenedMs ?? 0, contact.lastClickedMs ?? 0) < nowMs - 60 * DAY_MS
    && contact.createdMs < nowMs - 60 * DAY_MS).length;
  const bounced = [...validity.values()].filter((value) => value === "bounced").length;
  const unsubscribedRecently = contacts.filter((contact) => contact.status === "unsubscribed" && contact.statusChangedMs && contact.statusChangedMs >= nowMs - 30 * DAY_MS).length;
  const total = quiet + bounced + unsubscribedRecently;
  return { total, percent: pct(total, contacts.length), quiet, bounced, unsubscribedRecently };
}

// ── Growth & churn ────────────────────────────────────────────────────

export function growth(contacts: HealthContact[], range: Range) {
  const added = contacts.filter((contact) => inRange(contact.createdMs, range)).length;
  const churned = contacts.filter((contact) => leftIn(contact, range)).length;
  const atStart = contacts.filter((contact) => contact.createdMs < range.fromMs && statusAt(contact, range.fromMs - 1) === "subscribed").length;
  const base = atStart + added;
  const churnRate = pct(churned, base);
  return { added, churned, net: added - churned, atStart, churnRate, retentionRate: churnRate === null ? null : Math.round((100 - churnRate) * 10) / 10 };
}

export function growthSeries(contacts: HealthContact[], days: string[]) {
  return days.map((day) => {
    const start = Date.parse(`${day}T00:00:00+01:00`), end = start + DAY_MS;
    const day1: Range = { fromMs: start, toMs: end };
    const total = contacts.filter((contact) => contact.createdMs < end && statusAt(contact, end - 1) === "subscribed").length;
    const added = contacts.filter((contact) => inRange(contact.createdMs, day1)).length;
    const churned = contacts.filter((contact) => leftIn(contact, day1)).length;
    return { day, total, added, churned, churnRate: pct(churned, total + churned) };
  });
}

/** Of the people who joined in a month, the share still on the list N days after joining. */
export function cohorts(contacts: HealthContact[], nowMs: number, months = 4, checkpoints = [7, 14, 30, 60, 90]) {
  const now = new Date(nowMs + 3_600_000);
  const out: Array<{ month: string; label: string; size: number; cells: Array<number | null> }> = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const fromMs = start.getTime() - 3_600_000, toMs = next.getTime() - 3_600_000;
    const members = contacts.filter((contact) => contact.createdMs >= fromMs && contact.createdMs < toMs);
    out.push({
      month: start.toISOString().slice(0, 7),
      label: start.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
      size: members.length,
      cells: checkpoints.map((days) => {
        const old = members.filter((contact) => contact.createdMs + days * DAY_MS <= nowMs);
        if (!old.length) return null;
        return pct(old.filter((contact) => !leftBy(contact, contact.createdMs + days * DAY_MS)).length, old.length);
      })
    });
  }
  return out;
}

// ── Segments ──────────────────────────────────────────────────────────

export type SegmentHealth = "healthy" | "at_risk" | "unhealthy";

/**
 * Unhealthy: nobody to email, or 30%+ of its people bounced or unsubscribed.
 * At risk: emailed 10+ times with under 15% opening, or 15%+ gone.
 */
export function segmentHealth(input: { subscribed: number; contacts: number; bad: number; sent: number; opened: number }): SegmentHealth {
  const badShare = input.contacts ? input.bad / input.contacts : 0;
  if (input.subscribed === 0 || badShare >= 0.3) return "unhealthy";
  if ((input.sent >= 10 && input.opened / input.sent < 0.15) || badShare >= 0.15) return "at_risk";
  return "healthy";
}

// ── Scores ────────────────────────────────────────────────────────────

export type Grade = "Excellent" | "Good" | "Fair" | "Poor";
export const gradeOf = (score: number | null): Grade | null => (score === null ? null : score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 60 ? "Fair" : "Poor");
/** Delivery is held to a stricter scale: losing 1 email in 10 is already a real problem. */
export const deliveryGrade = (rate: number | null): Grade | null => (rate === null ? null : rate >= 98 ? "Excellent" : rate >= 95 ? "Good" : rate >= 90 ? "Fair" : "Poor");

/** Quality counts most; deliverability and engagement join once emails have gone out. */
export function healthScore(input: { quality: number | null; deliverability: number | null; engagement: number | null; atRiskPercent: number | null }) {
  const parts: Array<[number, number]> = [];
  if (input.quality !== null) parts.push([input.quality, 0.4]);
  if (input.deliverability !== null) parts.push([input.deliverability, 0.3]);
  if (input.engagement !== null) parts.push([Math.min(100, input.engagement * 2), 0.2]);
  if (input.atRiskPercent !== null) parts.push([100 - input.atRiskPercent, 0.1]);
  const weight = parts.reduce((sum, [, w]) => sum + w, 0);
  if (!weight) return null;
  return Math.round((parts.reduce((sum, [value, w]) => sum + value * w, 0) / weight) * 10) / 10;
}

// ── Issues ────────────────────────────────────────────────────────────

export type IssueArea = "quality" | "engagement" | "deliverability" | "growth" | "segments";
export type Severity = "critical" | "high" | "medium" | "low";
export type IssueAction = "clean" | "campaign" | "winback" | "segments" | "settings" | "auth" | "bounce_reports" | "form" | "audience";
export type DetectedIssue = { key: string; title: string; area: IssueArea; severity: Severity; action: IssueAction };

export type IssueInput = {
  senderReady: boolean; senderReason?: string;
  formEmailOn: boolean;
  bounceReportsOn: boolean;
  delivery: { accepted: number; bounceRate: number | null; spamRate: number | null; failedRate: number | null; tried: number };
  engagement: { people: number; openRate: number | null };
  quality: { total: number; bounced: number; duplicate: number };
  unsubscribes: { inPeriod: number; sentInPeriod: number };
  newContacts14d: number; ordersWithPhone14d: number;
  stuckSends: number;
  auth: { spf: string; dkim: string; dmarc: string } | null;
  segments: Array<{ id: string; name: string; health: SegmentHealth; usedByCampaign: boolean; subscribed: number }>;
};

export function detectIssues(input: IssueInput): DetectedIssue[] {
  const out: DetectedIssue[] = [];
  const add = (issue: DetectedIssue) => out.push(issue);
  const d = input.delivery;
  if (!input.senderReady) add({ key: "sender_not_ready", title: `Emails can't be sent: ${input.senderReason ?? "email is not set up"}`, area: "deliverability", severity: "critical", action: "settings" });
  if (d.accepted >= 20 && d.bounceRate !== null && d.bounceRate >= 2) add({ key: "high_bounce", title: `High bounce rate (${d.bounceRate}%)`, area: "deliverability", severity: d.bounceRate >= 5 ? "critical" : "high", action: "clean" });
  if (d.accepted >= 100 && d.spamRate !== null && d.spamRate >= 0.1) add({ key: "spam_complaints", title: `Customers marking emails as spam (${d.spamRate}%)`, area: "deliverability", severity: d.spamRate >= 0.3 ? "critical" : "high", action: "clean" });
  if (d.tried >= 20 && d.failedRate !== null && d.failedRate >= 5) add({ key: "send_failures", title: `Emails the email service refused (${d.failedRate}%)`, area: "deliverability", severity: "high", action: "settings" });
  if (input.auth) {
    if (input.auth.spf === "missing" || input.auth.dkim === "missing") add({ key: "auth_missing", title: `Sender checks missing (${[input.auth.spf === "missing" ? "SPF" : "", input.auth.dkim === "missing" ? "DKIM" : ""].filter(Boolean).join(" and ")})`, area: "deliverability", severity: "high", action: "auth" });
    if (input.auth.dmarc === "missing") add({ key: "dmarc_missing", title: "No DMARC record for the sending address", area: "deliverability", severity: "medium", action: "auth" });
  }
  if (!input.bounceReportsOn) add({ key: "bounce_reports_off", title: "Bounce and spam reports are off", area: "deliverability", severity: "low", action: "bounce_reports" });
  const e = input.engagement;
  if (e.people >= 50 && e.openRate !== null && e.openRate < 25) add({ key: "low_open_rate", title: `Low engagement (open rate ${e.openRate}%)`, area: "engagement", severity: e.openRate < 15 ? "high" : "medium", action: "campaign" });
  const q = input.quality;
  const badShare = q.total ? (q.bounced / q.total) * 100 : 0;
  if (q.total >= 20 && badShare >= 2) add({ key: "invalid_emails", title: `Bounced email rate (${Math.round(badShare * 10) / 10}%)`, area: "quality", severity: badShare >= 5 ? "high" : "medium", action: "clean" });
  const dupShare = q.total ? (q.duplicate / q.total) * 100 : 0;
  if (q.total >= 20 && dupShare >= 3) add({ key: "duplicates", title: `Duplicate contacts (${q.duplicate})`, area: "quality", severity: "low", action: "clean" });
  const u = input.unsubscribes;
  if (u.sentInPeriod >= 50) {
    const rate = (u.inPeriod / u.sentInPeriod) * 100;
    if (rate >= 1) add({ key: "unsubscribe_spike", title: `Spike in unsubscribes (${Math.round(rate * 10) / 10}%)`, area: "growth", severity: rate >= 2 ? "high" : "medium", action: "audience" });
  }
  if (!input.formEmailOn) add({ key: "form_email_off", title: "The order form's Email box is off", area: "growth", severity: "high", action: "form" });
  else if (input.newContacts14d === 0 && input.ordersWithPhone14d >= 20) add({ key: "no_new_emails", title: "No new emails in 14 days", area: "growth", severity: "medium", action: "form" });
  if (input.stuckSends > 0) add({ key: "daily_limit", title: `${input.stuckSends} emails waiting over a day (daily limit reached)`, area: "deliverability", severity: "medium", action: "settings" });
  for (const segment of input.segments) {
    if (segment.usedByCampaign && segment.subscribed === 0) add({ key: `segment_empty:${segment.id}`, title: `"${segment.name}" has nobody to email but a campaign uses it`, area: "segments", severity: "high", action: "segments" });
    else if (segment.health === "at_risk") add({ key: `segment_at_risk:${segment.id}`, title: `Segment "${segment.name}" at risk`, area: "segments", severity: "medium", action: "segments" });
    else if (segment.health === "unhealthy" && segment.subscribed > 0) add({ key: `segment_unhealthy:${segment.id}`, title: `Segment "${segment.name}" is unhealthy`, area: "segments", severity: "high", action: "segments" });
  }
  return out;
}

/** What to add, keep and close, comparing this check with the open issues. */
export function reconcileIssues(open: Array<{ id: string; key: string }>, detected: DetectedIssue[]) {
  const detectedKeys = new Set(detected.map((issue) => issue.key));
  const openKeys = new Set(open.map((issue) => issue.key));
  return {
    add: detected.filter((issue) => !openKeys.has(issue.key)),
    keep: open.filter((issue) => detectedKeys.has(issue.key)).map((issue) => issue.id),
    close: open.filter((issue) => !detectedKeys.has(issue.key)).map((issue) => issue.id)
  };
}

/** Days from `from` to `to` (Lagos), oldest first. */
export function daysBetween(range: Range) {
  const out: string[] = [];
  for (let ms = range.fromMs; ms < range.toMs && out.length < 400; ms += DAY_MS) out.push(lagosDay(ms));
  const last = lagosDay(range.toMs - 1);
  if (out[out.length - 1] !== last) out.push(last);
  return [...new Set(out)];
}
