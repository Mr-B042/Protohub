import crypto from "node:crypto";
import { promises as dns } from "node:dns";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { fetchAllRowsOrThrow } from "./query-limits.js";
import { mailjetKeys, marketingSender, senderDomain } from "./mailer.js";
import { alertRecipients } from "./notification-routing.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUser } from "./push.js";
import { DAY_MS, lagosDay, phoneKey, segmentMatches } from "./email-marketing-rules.js";
import { EmailMarketingError, PUBLIC_BACKEND_URL, audienceLabel, forgetWorld, loadWorld, settingsFor, statsFor } from "./email-marketing.js";
import {
  atRisk, classify, cohorts, dailyDelivery, dailyRates, daysBetween, delivery, deliveryGrade, detectIssues, engagement, gradeOf, growth, growthSeries, healthScore,
  listReputation, qualityCounts, qualityTrend, reconcileIssues, segmentHealth, sendsByContact, standingAt,
  type HealthContact, type HealthSend, type Range
} from "./email-health-rules.js";

/**
 * Audience Health (Bright's 7 designs, 8 Nov 2026): one read that feeds all
 * seven tabs, plus the problem list it keeps up to date and the daily
 * snapshot behind the segment trend. Rules in email-health-rules.ts.
 */

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const change = (now: number | null, before: number | null) => (now === null || before === null || before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 1000) / 10);
const pointChange = (now: number | null, before: number | null) => (now === null || before === null ? null : Math.round((now - before) * 10) / 10);

// ── Sender checks (SPF, DKIM, DMARC), looked up in DNS ──────────────

export type AuthStatus = { domain: string; spf: "verified" | "missing" | "other"; dkim: "verified" | "missing"; dmarc: "enforced" | "monitoring" | "missing"; checkedAt: string };
const authCache = new Map<string, { at: number; value: AuthStatus }>();

async function txt(name: string) {
  try { return (await dns.resolveTxt(name)).map((parts) => parts.join("")); } catch { return []; }
}

export async function authFor(orgId: string): Promise<AuthStatus | null> {
  const domain = await senderDomain(orgId);
  if (!domain) return null;
  const hit = authCache.get(domain);
  if (hit && Date.now() - hit.at < 6 * 60 * 60_000) return hit.value;
  const [root, mailjetKey, resendKey, dmarc] = await Promise.all([txt(domain), txt(`mailjet._domainkey.${domain}`), txt(`resend._domainkey.${domain}`), txt(`_dmarc.${domain}`)]);
  const spfRecord = root.find((record) => record.toLowerCase().startsWith("v=spf1"));
  const value: AuthStatus = {
    domain,
    spf: !spfRecord ? "missing" : /include:spf\.mailjet\.com|include:amazonses\.com|include:_spf\.resend/i.test(spfRecord) ? "verified" : "other",
    dkim: [...mailjetKey, ...resendKey].some((record) => /p=/.test(record)) ? "verified" : "missing",
    dmarc: (() => {
      const record = dmarc.find((row) => row.toLowerCase().startsWith("v=dmarc1"));
      if (!record) return "missing";
      return /p=(quarantine|reject)/i.test(record) ? "enforced" : "monitoring";
    })(),
    checkedAt: new Date().toISOString()
  };
  authCache.set(domain, { at: Date.now(), value });
  return value;
}

// ── Reading ───────────────────────────────────────────────────────────

async function loadHealthRows(orgId: string, branchId: string) {
  const since = new Date(Date.now() - 400 * DAY_MS).toISOString();
  const [contacts, sends, imports, campaigns, issues, snapshots] = await Promise.all([
    fetchAllRowsOrThrow<any>(() => supabase.from("email_contacts").select("id, email, phone, source, status, created_at, status_changed_at, status_reason, import_id, last_opened_at, last_clicked_at, last_emailed_at")
      .eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: true })),
    fetchAllRowsOrThrow<any>(() => supabase.from("email_campaign_sends").select("contact_id, email, campaign_id, status, sent_at, queued_at, first_opened_at, first_clicked_at, bounced_at, bounce_kind, spam_at, unsubscribed_at, order_id")
      .eq("org_id", orgId).eq("branch_id", branchId).gte("queued_at", since).order("queued_at", { ascending: true })),
    supabase.from("email_imports").select("id, source, details, created_at").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: false }).limit(200),
    supabase.from("email_campaigns").select("id, name, status, audience, thumbnail_url, goal, launched_at, completed_at").eq("org_id", orgId).eq("branch_id", branchId).neq("status", "archived").order("created_at", { ascending: false }).limit(200),
    supabase.from("email_health_issues").select("*").eq("org_id", orgId).eq("branch_id", branchId)
      .or(`resolved_at.is.null,detected_at.gte.${new Date(Date.now() - 120 * DAY_MS).toISOString()}`).order("detected_at", { ascending: false }).limit(500),
    supabase.from("email_health_snapshots").select("day, data").eq("branch_id", branchId).gte("day", lagosDay(Date.now() - 120 * DAY_MS)).order("day", { ascending: true })
  ]);
  for (const result of [imports, campaigns, issues, snapshots]) if (result.error) throw new Error(result.error.message);
  const ms = (value: string | null) => (value ? Date.parse(value) : null);
  return {
    contacts: contacts.map((row): HealthContact => ({
      id: row.id, email: row.email, phone: row.phone, source: row.source, status: row.status, createdMs: Date.parse(row.created_at), statusChangedMs: ms(row.status_changed_at),
      statusReason: row.status_reason, importId: row.import_id, lastOpenedMs: ms(row.last_opened_at), lastClickedMs: ms(row.last_clicked_at), lastEmailedMs: ms(row.last_emailed_at)
    })),
    sends: sends.map((row): HealthSend => ({
      contactId: row.contact_id, email: row.email, campaignId: row.campaign_id, status: row.status, sentMs: ms(row.sent_at), queuedMs: Date.parse(row.queued_at),
      openedMs: ms(row.first_opened_at), clickedMs: ms(row.first_clicked_at), bouncedMs: ms(row.bounced_at), bounceKind: row.bounce_kind, spamMs: ms(row.spam_at),
      unsubscribedMs: ms(row.unsubscribed_at), orderId: row.order_id
    })),
    imports: imports.data ?? [], campaigns: campaigns.data ?? [], issues: issues.data ?? [], snapshots: snapshots.data ?? []
  };
}

const SOURCE_NAME: Record<string, string> = { order: "Order Form", cart: "Unfinished Orders", manual: "Added by Hand", import: "Uploads" };
const IMPORT_NAME: Record<string, string> = { csv: "CSV Import", paste: "Pasted List", device: "Phone Contacts", manual: "Added by Hand" };

/** Everything the seven tabs show, for one period. Also refreshes the issue list and today's snapshot. */
export async function healthFor(orgId: string, branchId: string, range: Range, options: { syncIssues?: boolean } = {}) {
  const nowMs = Date.now();
  const length = Math.max(DAY_MS, range.toMs - range.fromMs);
  const previous: Range = { fromMs: range.fromMs - length, toMs: range.fromMs };
  const [world, rows, settings, sender, auth, embed] = await Promise.all([
    loadWorld(orgId, branchId), loadHealthRows(orgId, branchId), settingsFor(orgId, branchId), marketingSender(orgId), authFor(orgId).catch(() => null),
    supabase.from("embed_settings").select("show_email").eq("org_id", orgId).limit(1).maybeSingle()
  ]);
  const { contacts, sends } = rows;
  const validity = classify(contacts, sends, nowMs);
  const quality = qualityCounts(validity);
  const days = daysBetween({ fromMs: Math.max(range.fromMs, range.toMs - 90 * DAY_MS), toMs: Math.min(range.toMs, nowMs + 1) });

  // Quality when the period began, by the same rule as today's.
  const qualityAt = (atMs: number) => qualityCounts(standingAt(contacts, sendsByContact(sends), atMs)).qualityPercent;
  const eng = engagement(sends, contacts, range, nowMs);
  const engBefore = engagement(sends, contacts, previous, nowMs - length);
  const del = delivery(sends, range);
  const delBefore = delivery(sends, previous);
  const risk = atRisk(contacts, validity, nowMs);
  const grow = growth(contacts, range);
  const growBefore = growth(contacts, previous);
  const unsubscribeRate = pct(sends.filter((send) => send.unsubscribedMs && send.unsubscribedMs >= range.fromMs && send.unsubscribedMs < range.toMs).length, eng.people);

  // Customers behind the list: their delivered orders only, matched by phone.
  const listed = world.people.filter((person) => person.contact);
  const listedPhones = new Set(listed.map((person) => person.stats?.key).filter(Boolean) as string[]);
  // delivered_date is a calendar day; noon Lagos keeps it on that day.
  const deliveredMs = (day: string | null) => (day ? Date.parse(`${day.slice(0, 10)}T11:00:00Z`) : NaN);
  const listDelivered = world.orders.filter((order) => order.status === "Delivered" && Number.isFinite(deliveredMs(order.deliveredDate)) && listedPhones.has(phoneKey(order.phone)));
  const ordersIn = (r: Range) => listDelivered.filter((order) => deliveredMs(order.deliveredDate) >= r.fromMs && deliveredMs(order.deliveredDate) < r.toMs);
  const periodOrders = ordersIn(range), previousOrders = ordersIn(previous);
  const aovOf = (list: typeof periodOrders) => (list.length ? Math.round(list.reduce((sum, order) => sum + order.amount, 0) / list.length) : null);
  const frequencyOf = (list: typeof periodOrders) => { const people = new Set(list.map((order) => phoneKey(order.phone))).size; return people ? Math.round((list.length / people) * 100) / 100 : null; };
  /** Money per buying customer and the share who bought twice, as it stood at a moment. */
  const valueAt = (cutMs: number) => {
    const byPhone = new Map<string, { orders: number; money: number }>();
    for (const order of listDelivered) {
      if (deliveredMs(order.deliveredDate) >= cutMs) continue;
      const key = phoneKey(order.phone);
      const row = byPhone.get(key) ?? { orders: 0, money: 0 };
      row.orders += 1; row.money += order.amount;
      byPhone.set(key, row);
    }
    const rows = [...byPhone.values()];
    const money = rows.reduce((sum, row) => sum + row.money, 0);
    return { buyers: rows.length, orders: rows.reduce((sum, row) => sum + row.orders, 0), ltv: rows.length ? Math.round(money / rows.length) : null, repeatRate: pct(rows.filter((row) => row.orders >= 2).length, rows.length) };
  };
  const valueNow = valueAt(range.toMs), valueBefore = valueAt(range.fromMs);

  // Segments, with their open rates from the emails their people got.
  const byContact = sendsByContact(sends);
  const statusOf = new Map(contacts.map((contact) => [contact.id, contact.status]));
  const usedSegments = new Set<string>();
  for (const campaign of rows.campaigns) {
    if (!["scheduled", "sending", "active", "paused"].includes(campaign.status)) continue;
    const a = campaign.audience ?? {};
    for (const id of [a.segmentId, a.listId]) if (id) usedSegments.add(id);
  }
  const liveSegments = world.segmentRows.filter((row) => row.status !== "archived" && !row.builtIn?.startsWith("list_"));
  const inSegments = new Set<string>();
  const segmentRows = liveSegments.map((segment) => {
    const fixedIds = new Set(segment.contactIds);
    const members = segment.kind === "fixed"
      ? listed.filter((person) => fixedIds.has(person.contact!.id))
      : listed.filter((person) => segmentMatches(person, { match: segment.match, conditions: segment.conditions, exclude: segment.excludeOn ? segment.exclude : [] }, world.ctx));
    const memberIds = members.map((person) => person.contact!.id);
    for (const id of memberIds) inSegments.add(id);
    const subscribed = memberIds.filter((id) => statusOf.get(id) === "subscribed").length;
    const bad = memberIds.filter((id) => validity.get(id) === "bounced" || validity.get(id) === "unsubscribed").length;
    const memberSends = memberIds.flatMap((id) => byContact.get(id) ?? []).filter((send) => send.status === "sent" && send.sentMs && send.sentMs >= nowMs - 30 * DAY_MS);
    const opened = memberSends.filter((send) => send.openedMs || send.clickedMs).length;
    const clicked = memberSends.filter((send) => send.clickedMs).length;
    const newer = members.filter((person) => Date.parse(person.contact!.createdAt) >= nowMs - 30 * DAY_MS).length;
    const openRate = pct(opened, memberSends.length);
    return {
      id: segment.id, name: segment.name, icon: segment.icon, kind: segment.kind, audience: subscribed, contacts: memberIds.length,
      // Growth over the last 30 days: people who joined it against those already in it.
      growth: memberIds.length - newer > 0 ? pct(newer, memberIds.length - newer) : null,
      sent: memberSends.length, openRate, clickRate: pct(clicked, memberSends.length),
      engagement: openRate === null ? "none" : openRate >= 40 ? "high" : openRate >= 20 ? "good" : "low",
      health: segmentHealth({ subscribed, contacts: memberIds.length, bad, sent: memberSends.length, opened }), usedByCampaign: usedSegments.has(segment.id)
    };
  });
  const healthy = segmentRows.filter((row) => row.health === "healthy").length;
  const segAtRisk = segmentRows.filter((row) => row.health === "at_risk").length;
  const unhealthy = segmentRows.filter((row) => row.health === "unhealthy").length;

  // Quality by source: each source, and each upload on its own.
  const bySource = new Map<string, { label: string; kind: string; ids: string[] }>();
  for (const contact of contacts) {
    const key = contact.importId ? `import:${contact.importId}` : `source:${contact.source}`;
    if (!bySource.has(key)) {
      const upload = contact.importId ? rows.imports.find((row: any) => row.id === contact.importId) : null;
      bySource.set(key, { label: upload ? `${IMPORT_NAME[upload.source] ?? "Upload"}${upload.details ? ` (${upload.details})` : ""}` : SOURCE_NAME[contact.source] ?? contact.source, kind: upload ? upload.source : contact.source, ids: [] });
    }
    bySource.get(key)!.ids.push(contact.id);
  }
  const sources = [...bySource.values()].map((row) => {
    const count = (value: string) => row.ids.filter((id) => validity.get(id) === value).length;
    const valid = count("valid"), bounced = count("bounced"), duplicate = count("duplicate"), unsub = count("unsubscribed");
    const rate = pct(valid, row.ids.length);
    return { label: row.label, kind: row.kind, total: row.ids.length, valid, bounced, duplicate, unsubscribed: unsub, qualityRate: rate, status: rate === null ? "—" : rate >= 90 ? "Good" : rate >= 75 ? "Fair" : "Poor" };
  }).sort((a, b) => b.total - a.total);

  // Campaigns: performance and delivery per campaign.
  const stats = await statsFor(rows.campaigns.map((row: any) => row.id));
  const campaignRows = rows.campaigns.filter((row: any) => (stats.get(row.id)?.sent ?? 0) > 0).slice(0, 8).map((row: any) => {
    const s = stats.get(row.id)!;
    const mine = sends.filter((send) => send.campaignId === row.id && send.status === "sent");
    const bounced = mine.filter((send) => send.bouncedMs).length, spam = mine.filter((send) => send.spamMs).length;
    return {
      id: row.id, name: row.name, thumbnailUrl: row.thumbnail_url, goal: row.goal, status: row.status, audienceLabel: audienceLabel(row.audience, world.segments),
      sent: s.sent, openRate: pct(s.opened, s.sent), clickRate: pct(s.clicked, s.sent), conversions: s.orders, delivered: s.sent - bounced,
      deliveredRate: pct(s.sent - bounced, s.sent), spamRate: pct(spam, s.sent), bounceRate: pct(bounced, s.sent)
    };
  });

  const score = healthScore({ quality: quality.qualityPercent, deliverability: del.tried ? del.deliveredRate : null, engagement: eng.people ? eng.openRate : null, atRiskPercent: contacts.length ? risk.percent : null });
  const deliverabilityScore = del.tried ? del.deliveredRate : null;
  const repeatRate = valueNow.repeatRate;

  // Issues: found again on each look; new ones are saved, gone ones closed.
  // Always the last 30 days, so the period on screen never opens or closes one.
  const last30: Range = { fromMs: nowMs - 30 * DAY_MS, toMs: nowMs + 1 };
  const del30 = delivery(sends, last30);
  const eng30 = engagement(sends, contacts, last30, nowMs);
  const unsub30 = contacts.filter((contact) => contact.status === "unsubscribed" && contact.statusChangedMs && contact.statusChangedMs >= last30.fromMs).length;
  const fourteen = nowMs - 14 * DAY_MS;
  const detected = detectIssues({
    // A failed read is not "off": only a saved setting says so.
    senderReady: sender.ready, senderReason: sender.reason, formEmailOn: embed.error ? true : !!embed.data?.show_email, bounceReportsOn: !!settings.bounceHookOnAt,
    delivery: { accepted: del30.accepted, bounceRate: del30.bounceRate, spamRate: del30.spamRate, failedRate: del30.failedRate, tried: del30.tried },
    engagement: { people: eng30.people, openRate: eng30.openRate }, quality: { total: quality.total, bounced: quality.bounced, duplicate: quality.duplicate },
    unsubscribes: { inPeriod: unsub30, sentInPeriod: eng30.people },
    newContacts14d: contacts.filter((contact) => contact.createdMs >= fourteen).length,
    ordersWithPhone14d: world.orders.filter((order) => Date.parse(order.createdAt) >= fourteen).length,
    stuckSends: sends.filter((send) => send.status === "queued" && send.queuedMs < nowMs - DAY_MS).length,
    auth: auth ? { spf: auth.spf, dkim: auth.dkim, dmarc: auth.dmarc } : null,
    segments: segmentRows.map((row) => ({ id: row.id, name: row.name, health: row.health, usedByCampaign: row.usedByCampaign, subscribed: row.audience }))
  });
  let issues = rows.issues;
  if (options.syncIssues !== false) issues = await syncIssues(orgId, branchId, rows.issues, detected);
  const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const open = issues.filter((issue: any) => !issue.resolved_at)
    .sort((a: any, b: any) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || String(b.detected_at).localeCompare(String(a.detected_at)));
  const resolved30 = issues.filter((issue: any) => issue.resolved_at && Date.parse(issue.resolved_at) >= nowMs - 30 * DAY_MS);
  // Every issue open at some point in the last 30 days: still open, or fixed in them.
  const totalRecent = [...open, ...resolved30];
  const fixTimes = resolved30.map((issue: any) => (Date.parse(issue.resolved_at) - Date.parse(issue.detected_at)) / 3_600_000);
  const issueTrend = days.map((day) => {
    const end = Date.parse(`${day}T23:59:59+01:00`);
    return { day, open: issues.filter((issue: any) => Date.parse(issue.detected_at) <= end && (!issue.resolved_at || Date.parse(issue.resolved_at) > end)).length };
  });

  // Today's snapshot, kept for the segment trend.
  const today = lagosDay(nowMs);
  const score30 = healthScore({ quality: quality.qualityPercent, deliverability: del30.tried ? del30.deliveredRate : null, engagement: eng30.people ? eng30.openRate : null, atRiskPercent: contacts.length ? risk.percent : null });
  const snapshot = { segments: { healthy, atRisk: segAtRisk, unhealthy, total: segmentRows.length }, quality: quality.qualityPercent, score: score30 };
  const saved = await supabase.from("email_health_snapshots").upsert({ branch_id: branchId, org_id: orgId, day: today, data: snapshot }, { onConflict: "branch_id,day" });
  if (saved.error) logger.warn("email health: saving the day's snapshot failed", { branchId, error: saved.error.message });
  const snaps = new Map<string, any>(rows.snapshots.map((row: any) => [String(row.day).slice(0, 10), row.data]));
  snaps.set(today, snapshot);
  const segmentTrend = days.map((day) => {
    const data = snaps.get(day)?.segments;
    return data && data.total ? { day, healthy: pct(data.healthy, data.total), atRisk: pct(data.atRisk, data.total), unhealthy: pct(data.unhealthy, data.total) } : { day, healthy: null, atRisk: null, unhealthy: null };
  });

  const qualityNow = quality.qualityPercent, qualityBefore = qualityAt(range.fromMs);
  const qualityDays = qualityTrend(contacts, sends, days);
  return {
    nowMs, range: { from: new Date(range.fromMs).toISOString(), to: new Date(range.toMs).toISOString() },
    sender: { ready: sender.ready, reason: sender.reason ?? null, fromEmail: sender.fromEmail },
    bounceReports: { on: !!settings.bounceHookOnAt, since: settings.bounceHookOnAt },
    auth,
    overview: {
      kpis: {
        total: { value: contacts.length, change: change(contacts.length, contacts.filter((contact) => contact.createdMs < range.fromMs).length) },
        quality: { value: qualityNow, change: pointChange(qualityNow, qualityBefore) },
        deliverability: { value: deliverabilityScore, change: pointChange(deliverabilityScore, delBefore.tried ? delBefore.deliveredRate : null) },
        engagement: { value: eng.people ? eng.openRate : null, change: pointChange(eng.people ? eng.openRate : null, engBefore.people ? engBefore.openRate : null) },
        atRisk: { value: risk.total, percent: risk.percent }
      },
      score, grade: gradeOf(score),
      checks: [
        { label: "Data quality", value: qualityNow, good: qualityNow !== null && qualityNow >= 90 },
        { label: "Deliverability", value: deliverabilityScore, good: deliverabilityScore !== null && deliverabilityScore >= 95 },
        { label: "Engagement", value: eng.people ? eng.openRate : null, good: eng.openRate !== null && eng.openRate >= 25 },
        { label: "At-risk audience", value: risk.percent, good: risk.percent === null || risk.percent < 10, lowIsGood: true }
      ],
      trend: qualityDays,
      breakdown: quality,
      engagement: { openRate: eng.people ? eng.openRate : null, openChange: pointChange(eng.openRate, engBefore.openRate), clickRate: eng.people ? eng.clickRate : null, clickChange: pointChange(eng.clickRate, engBefore.clickRate), repeatPurchaseRate: repeatRate, active: eng.active, activePercent: eng.activePercent },
      atRisk: risk
    },
    quality: {
      kpis: { total: contacts.length, valid: quality.valid, bounced: quality.bounced, duplicate: quality.duplicate, unsubscribed: quality.unsubscribed, other: quality.other, percent: quality.qualityPercent },
      trend: qualityDays,
      sources
    },
    engagement: {
      kpis: { ...eng, openChange: pointChange(eng.openRate, engBefore.openRate), clickChange: pointChange(eng.clickRate, engBefore.clickRate), repeatChange: pointChange(eng.repeatEngagement, engBefore.repeatEngagement) },
      trend: dailyRates(sends, days),
      segments: segmentRows.filter((row) => row.audience > 0).sort((a, b) => b.audience - a.audience).slice(0, 6),
      campaigns: campaignRows
    },
    deliverability: {
      kpis: { ...del, deliveredChange: pointChange(del.deliveredRate, delBefore.deliveredRate), bounceChange: pointChange(del.bounceRate, delBefore.bounceRate), spamChange: pointChange(del.spamRate, delBefore.spamRate), failedChange: pointChange(del.failedRate, delBefore.failedRate) },
      score: deliverabilityScore, grade: deliveryGrade(deliverabilityScore),
      trend: dailyDelivery(sends, days),
      listReputation: listReputation({ bounceRate: del.bounceRate, spamRate: del.spamRate, unsubscribeRate }),
      campaigns: campaignRows
    },
    growth: {
      kpis: {
        total: contacts.length, added: grow.added, addedChange: change(grow.added, growBefore.added), net: grow.net, netChange: change(grow.net, growBefore.net),
        churned: grow.churned, churnRate: grow.churnRate, churnChange: pointChange(grow.churnRate, growBefore.churnRate),
        retentionRate: grow.retentionRate, retentionChange: pointChange(grow.retentionRate, growBefore.retentionRate),
        ltv: valueNow.ltv, ltvChange: change(valueNow.ltv, valueBefore.ltv)
      },
      series: growthSeries(contacts, days),
      summary: [
        { key: "added", label: "New Subscribers", now: grow.added, before: growBefore.added, goodWhenUp: true },
        { key: "churned", label: "Unsubscribed / Bounced (Churned)", now: grow.churned, before: growBefore.churned, goodWhenUp: false },
        { key: "net", label: "Net Growth", now: grow.net, before: growBefore.net, goodWhenUp: true },
        { key: "churnRate", label: "Churn Rate", now: grow.churnRate, before: growBefore.churnRate, goodWhenUp: false, percent: true },
        { key: "retention", label: "Retention Rate", now: grow.retentionRate, before: growBefore.retentionRate, goodWhenUp: true, percent: true }
      ],
      cohorts: cohorts(contacts, nowMs),
      value: {
        aov: aovOf(periodOrders), aovBefore: aovOf(previousOrders),
        // Delivered orders in the period per customer who bought in it.
        frequency: frequencyOf(periodOrders), frequencyBefore: frequencyOf(previousOrders),
        ltv: valueNow.ltv, ltvBefore: valueBefore.ltv, repeatRate, repeatRateBefore: valueBefore.repeatRate, orders: valueNow.orders
      }
    },
    segments: {
      kpis: { total: segmentRows.length, healthy, atRisk: segAtRisk, unhealthy, inSegments: inSegments.size },
      healthPercent: pct(healthy, segmentRows.length), grade: gradeOf(pct(healthy, segmentRows.length)),
      trend: segmentTrend,
      rows: segmentRows,
      checks: { valid: quality.valid, duplicate: quality.duplicate, bounced: quality.bounced, unsubscribed: quality.unsubscribed, total: quality.total, hygiene: quality.total ? pct(quality.total - quality.bounced - quality.duplicate, quality.total) : null }
    },
    issues: {
      open: open.map((issue: any) => ({ id: issue.id, key: issue.key, title: issue.title, area: issue.area, severity: issue.severity, action: issue.action, detectedAt: issue.detected_at })),
      counts: {
        open: open.length,
        openBefore: issues.filter((issue: any) => Date.parse(issue.detected_at) <= range.fromMs && (!issue.resolved_at || Date.parse(issue.resolved_at) > range.fromMs)).length,
        critical: open.filter((i: any) => i.severity === "critical").length, high: open.filter((i: any) => i.severity === "high").length,
        medium: open.filter((i: any) => i.severity === "medium").length, low: open.filter((i: any) => i.severity === "low").length,
        resolved30: resolved30.length, total: totalRecent.length,
        resolutionRate: pct(resolved30.length, totalRecent.length), avgHoursToFix: fixTimes.length ? Math.round((fixTimes.reduce((a, b) => a + b, 0) / fixTimes.length) * 10) / 10 : null
      },
      trend: issueTrend,
      byArea: (["deliverability", "engagement", "quality", "segments", "growth"] as const).map((area) => ({ area, count: open.filter((issue: any) => issue.area === area).length }))
    }
  };
}

async function syncIssues(orgId: string, branchId: string, existing: any[], detected: ReturnType<typeof detectIssues>) {
  const table = () => supabase.from("email_health_issues");
  const ok = (what: string, error: { message: string } | null) => { if (error) logger.warn(`email health: ${what} failed`, { branchId, error: error.message }); return !error; };
  const open = existing.filter((issue) => !issue.resolved_at);
  const plan = reconcileIssues(open.map((issue) => ({ id: issue.id, key: issue.key })), detected);
  const now = new Date().toISOString();
  const closed = new Set<string>();
  if (plan.close.length && ok("closing issues", (await table().update({ resolved_at: now }).in("id", plan.close).is("resolved_at", null)).error)) plan.close.forEach((id) => closed.add(id));
  if (plan.keep.length) ok("marking issues seen", (await table().update({ last_seen_at: now }).in("id", plan.keep)).error);
  // Titles carry numbers ("High bounce rate (4.8%)") and severity can move: keep both current.
  const current = new Map(detected.map((issue) => [issue.key, issue]));
  for (const row of open) {
    const latest = current.get(row.key);
    if (latest && (row.title !== latest.title || row.severity !== latest.severity)) ok("updating an issue", (await table().update({ title: latest.title, severity: latest.severity }).eq("id", row.id)).error);
  }
  // One insert each: "one open issue per problem" is a partial unique index,
  // so a second copy (two checks at once) fails on its own with 23505.
  const added: any[] = [];
  for (const issue of plan.add) {
    const { data, error } = await table().insert({ org_id: orgId, branch_id: branchId, key: issue.key, title: issue.title, area: issue.area, severity: issue.severity, action: issue.action }).select("*").maybeSingle();
    if (error) { if (error.code !== "23505") ok("adding an issue", error); continue; }
    if (data) added.push(data);
  }
  // A problem that closed in the last 7 days and is back (a rate sitting on its
  // limit) is listed again but not alerted again.
  const recentlyClosed = new Set(existing.filter((issue) => issue.resolved_at && Date.parse(issue.resolved_at) >= Date.now() - 7 * DAY_MS).map((issue) => issue.key));
  const fresh = added.filter((issue) => !recentlyClosed.has(issue.key));
  if (fresh.length) void alertNewIssues(orgId, branchId, fresh).catch((error) => logger.warn("email health alert failed", { error: (error as Error).message }));
  return [
    ...existing.map((issue) => {
      if (closed.has(issue.id)) return { ...issue, resolved_at: now };
      const latest = issue.resolved_at ? undefined : current.get(issue.key);
      return latest ? { ...issue, title: latest.title, severity: latest.severity } : issue;
    }),
    ...added
  ];
}

/** Email Marketing opens for the Owner and Admins only: nobody else can act on the alert. */
const ALERT_ROLES = new Set(["Owner", "Admin"]);
const HEALTH_LINK = "/dashboard/admin/email-marketing/health?tab=issues";

async function alertNewIssues(orgId: string, branchId: string, added: any[]) {
  const serious = added.filter((issue) => issue.severity === "critical" || issue.severity === "high");
  if (!serious.length) return;
  const routed = await alertRecipients(orgId, "email_list_issue");
  const recipients = new Map([...routed.recipients].filter(([, role]) => ALERT_ROLES.has(role)));
  if (!recipients.size) return;
  const message = (issue: any) => `${issue.severity === "critical" ? "Critical" : "High"} problem. Open Email Marketing › Audience Health › Issues & Actions to fix it.`;
  const rows = serious.flatMap((issue) => [...recipients.keys()].map((recipientId) => ({
    org_id: orgId, branch_id: branchId, recipient_id: recipientId, type: "email_list_issue", read: false,
    link: HEALTH_LINK, title: `Email list: ${issue.title}`, message: message(issue)
  })));
  const insert = await supabase.from("system_notifications").insert(rows);
  if (insert.error) throw insert.error;
  if (!routed.push) return;
  const branding = await getOrgPushBranding(orgId);
  const push = serious.length === 1
    ? { title: `Email list: ${serious[0].title}`, body: message(serious[0]), tag: `email-issue-${serious[0].key}` }
    : { title: `${serious.length} email list problems`, body: serious.map((issue) => issue.title).join(" · ").slice(0, 180), tag: "email-issue-summary" };
  await Promise.all([...recipients.keys()].map((recipientId) => sendPushToUser(orgId, recipientId, {
    ...push, url: HEALTH_LINK, kind: "email_list_issue", brandName: branding.brandName, brandLogo: branding.brandLogo
  }).catch((error) => logger.warn("email health push failed", { orgId, error: String(error) }))));
}

// ── List cleaning ─────────────────────────────────────────────────────

/**
 * Who a clean-up would stop emailing: people who never opened 3+ emails over
 * 60+ days, older second emails for the same phone, and bounced addresses
 * still marked subscribed. Nobody is deleted: they stay on the list, marked
 * "cleaned" (or "bounced"), and get no more campaign emails.
 */
export async function cleaningPlan(orgId: string, branchId: string) {
  const rows = await loadHealthRows(orgId, branchId);
  const validity = classify(rows.contacts, rows.sends, Date.now());
  const subscribed = rows.contacts.filter((contact) => contact.status === "subscribed");
  return {
    neverOpened: subscribed.filter((contact) => validity.get(contact.id) === "other"),
    duplicates: subscribed.filter((contact) => validity.get(contact.id) === "duplicate"),
    bounced: subscribed.filter((contact) => validity.get(contact.id) === "bounced")
  };
}

export async function cleanList(orgId: string, branchId: string, userName: string, pick: { neverOpened: boolean; duplicates: boolean; bounced: boolean }) {
  const plan = await cleaningPlan(orgId, branchId);
  const now = new Date().toISOString();
  const groups: Array<{ key: "neverOpened" | "duplicates" | "bounced"; status: "cleaned" | "bounced"; reason: string }> = [
    { key: "neverOpened", status: "cleaned", reason: `List clean-up by ${userName}: never opened 3+ emails over 60+ days` },
    { key: "duplicates", status: "cleaned", reason: `List clean-up by ${userName}: an older email for the same phone` },
    { key: "bounced", status: "bounced", reason: `List clean-up by ${userName}: the email bounced` }
  ];
  const done = { neverOpened: 0, duplicates: 0, bounced: 0 };
  for (const group of groups) {
    if (!pick[group.key] || !plan[group.key].length) continue;
    const ids = plan[group.key].map((contact) => contact.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from("email_contacts").update({ status: group.status, status_changed_at: now, status_reason: group.reason, updated_at: now })
        .eq("org_id", orgId).eq("branch_id", branchId).eq("status", "subscribed").in("id", ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }
    done[group.key] = ids.length;
  }
  forgetWorld(branchId);
  return done;
}

// ── Bounce and spam reports from Mailjet ─────────────────────────────

const HOOK_EVENTS = ["bounce", "spam", "blocked"] as const;

/** Register our address for Mailjet's bounce, spam and blocked events. Never replaces a hook pointing elsewhere. */
export async function enableBounceReports(orgId: string, branchId: string) {
  const keys = await mailjetKeys(orgId);
  if (!keys) throw new EmailMarketingError(409, "Bounce reports need the Mailjet keys in Settings › Email.");
  const { data: row } = await supabase.from("email_marketing_settings").select("bounce_hook_secret").eq("branch_id", branchId).maybeSingle();
  const secret = row?.bounce_hook_secret || crypto.randomBytes(18).toString("base64url");
  const url = `${PUBLIC_BACKEND_URL}/e/hooks/mailjet/${secret}`;
  const auth = `Basic ${Buffer.from(`${keys.apiKey}:${keys.apiSecret}`).toString("base64")}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`https://api.mailjet.com/v3/REST/${path}`, { method, headers: { Authorization: auth, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
    if (!response.ok) throw new EmailMarketingError(502, `Mailjet said: ${json?.ErrorMessage ?? response.status}`);
    return json;
  };
  const existing = ((await call("GET", "eventcallbackurl?Limit=100"))?.Data ?? []) as Array<{ ID: number; EventType: string; Url: string }>;
  const skipped: string[] = [];
  for (const event of HOOK_EVENTS) {
    const current = existing.find((hook) => hook.EventType === event);
    if (!current) await call("POST", "eventcallbackurl", { EventType: event, Url: url, Version: 2, IsBackup: false, Status: "alive" });
    else if (current.Url.includes("/e/hooks/mailjet/")) await call("PUT", `eventcallbackurl/${current.ID}`, { Url: url, Version: 2, Status: "alive" });
    else skipped.push(event);
  }
  await supabase.from("email_marketing_settings").upsert({ branch_id: branchId, org_id: orgId, bounce_hook_secret: secret, bounce_hook_on_at: new Date().toISOString() }, { onConflict: "branch_id" });
  return { on: true, skipped };
}

/** Mailjet's events: a bounce or block stops emails to that address; a spam complaint unsubscribes it. */
export async function receiveMailjetEvents(secret: string, body: unknown) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(secret)) return 0;
  const { data: owner } = await supabase.from("email_marketing_settings").select("branch_id, org_id").eq("bounce_hook_secret", secret).maybeSingle();
  if (!owner) return 0;
  const events = (Array.isArray(body) ? body : [body]).filter((event): event is Record<string, any> => !!event && typeof event === "object");
  let handled = 0;
  for (const event of events.slice(0, 500)) {
    const kind = String(event.event ?? "");
    if (!["bounce", "spam", "blocked"].includes(kind)) continue;
    // Our token rides along as CustomID; Mailjet's message GUID is the fallback.
    const token = String(event.CustomID ?? "");
    const guid = String(event.Message_GUID ?? "");
    const lookup = supabase.from("email_campaign_sends").select("id, contact_id").eq("branch_id", owner.branch_id);
    const { data: send } = /^[A-Za-z0-9_-]{16,40}$/.test(token)
      ? await lookup.eq("token", token).maybeSingle()
      : /^[0-9a-f-]{36}$/i.test(guid) ? await lookup.eq("provider_message_id", guid).limit(1).maybeSingle() : { data: null };
    if (!send) continue;
    const at = event.time ? new Date(Number(event.time) * 1000).toISOString() : new Date().toISOString();
    if (kind === "spam") {
      await supabase.from("email_campaign_sends").update({ spam_at: at }).eq("id", send.id);
      if (send.contact_id) await supabase.from("email_contacts").update({ status: "unsubscribed", status_changed_at: at, status_reason: "Marked the email as spam", updated_at: at }).eq("id", send.contact_id).eq("status", "subscribed");
    } else {
      const hard = kind === "blocked" || event.hard_bounce === true || event.hard_bounce === "true";
      await supabase.from("email_campaign_sends").update({ bounced_at: at, bounce_kind: kind === "blocked" ? "blocked" : hard ? "hard" : "soft" }).eq("id", send.id);
      if (hard && send.contact_id) await supabase.from("email_contacts").update({ status: "bounced", status_changed_at: at, status_reason: `Email ${kind === "blocked" ? "blocked" : "bounced"}: ${String(event.error ?? event.error_related_to ?? "").slice(0, 80)}`, updated_at: at }).eq("id", send.contact_id).eq("status", "subscribed");
    }
    handled += 1;
  }
  if (handled) forgetWorld(owner.branch_id);
  return handled;
}

// ── Daily check (job) ─────────────────────────────────────────────────

/** Once a day (cron): refresh every branch's problems and snapshot, alerting on new serious ones. */
export async function runDailyHealth() {
  const { data } = await supabase.from("email_marketing_settings").select("org_id, branch_id");
  for (const row of data ?? []) {
    try { await healthFor(row.org_id, row.branch_id, { fromMs: Date.now() - 30 * DAY_MS, toMs: Date.now() }); }
    catch (error) { logger.warn("email health daily check failed", { branchId: row.branch_id, error: (error as Error).message }); }
  }
}
