import assert from "node:assert/strict";
import test from "node:test";
import {
  atRisk, classify, cohorts, daysBetween, delivery, deliveryGrade, detectIssues, engagement, growth, growthSeries, healthScore, gradeOf, listReputation, qualityCounts,
  qualityTrend, reconcileIssues, segmentHealth, type HealthContact, type HealthSend, type IssueInput
} from "./email-health-rules.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-08T12:00:00+01:00");
const c = (id: string, extra: Partial<HealthContact> = {}): HealthContact => ({
  id, email: `${id}@x.com`, phone: null, source: "order", status: "subscribed", createdMs: NOW - 100 * DAY, statusChangedMs: null, statusReason: null,
  importId: null, lastOpenedMs: null, lastClickedMs: null, lastEmailedMs: null, ...extra
});
const s = (email: string, campaignId: string, extra: Partial<HealthSend> = {}): HealthSend => ({
  contactId: email.split("@")[0], email, campaignId, status: "sent", sentMs: NOW - 5 * DAY, queuedMs: NOW - 5 * DAY, openedMs: null, clickedMs: null,
  bouncedMs: null, bounceKind: null, spamMs: null, unsubscribedMs: null, orderId: null, ...extra
});
const range = { fromMs: NOW - 30 * DAY, toMs: NOW };

test("quality: bounced, unsubscribed, and an older second email for the same phone is a duplicate", () => {
  const contacts = [
    c("a", { phone: "08031234567", createdMs: NOW - 50 * DAY }), c("b", { phone: "+2348031234567", createdMs: NOW - 10 * DAY }),
    c("u", { status: "unsubscribed", statusChangedMs: NOW - 3 * DAY }), c("x", { status: "bounced" }), c("h")
  ];
  const validity = classify(contacts, [s("h@x.com", "k1", { bouncedMs: NOW - DAY, bounceKind: "hard" })]);
  assert.equal(validity.get("a"), "duplicate");
  assert.equal(validity.get("b"), "valid");
  assert.equal(validity.get("h"), "bounced"); // a hard bounce counts even before the status catches up
  assert.deepEqual(qualityCounts(validity), { total: 5, valid: 1, bounced: 2, unsubscribed: 1, duplicate: 1, other: 0, qualityPercent: 20 });
  const trend = qualityTrend(contacts, [s("h@x.com", "k1", { bouncedMs: NOW - DAY, bounceKind: "hard" })], ["2026-11-01", "2026-11-07"]);
  assert.equal(trend[0].value, 60); // b, u and h: the unsubscribe and the bounce came later
  assert.equal(trend[1].value, 20);
});

test("never opening 3+ emails over 60+ days, or a clean-up, is 'other' and not a loss", () => {
  const sends = [80, 50, 20].map((days, i) => s("q@x.com", `k${i}`, { sentMs: NOW - days * DAY, queuedMs: NOW - days * DAY }));
  const contacts = [c("q"), c("ok"), c("cl", { status: "cleaned", statusChangedMs: NOW - 2 * DAY })];
  const validity = classify(contacts, sends, NOW);
  assert.deepEqual([validity.get("q"), validity.get("ok"), validity.get("cl")], ["other", "valid", "other"]);
  assert.equal(classify(contacts, [...sends.slice(0, 2), { ...sends[2], openedMs: NOW - 19 * DAY }], NOW).get("q"), "valid"); // opened one
  assert.equal(classify(contacts, sends.slice(1), NOW).get("q"), "valid"); // two emails: too early to say
  assert.equal(growth(contacts, range).churned, 0);
  assert.equal(qualityTrend(contacts, sends, ["2026-11-01"])[0].value, Math.round((2 / 3) * 1000) / 10); // cl was still subscribed then
});

test("engagement and delivery count people once, and only in the period", () => {
  const sends = [
    s("a@x.com", "k1", { openedMs: NOW - 4 * DAY, clickedMs: NOW - 4 * DAY }), s("a@x.com", "k2", { openedMs: NOW - 2 * DAY }),
    s("b@x.com", "k1"), s("c@x.com", "k1", { bouncedMs: NOW - 5 * DAY, bounceKind: "hard" }), s("d@x.com", "k1", { status: "failed", sentMs: null }),
    s("e@x.com", "k1", { sentMs: NOW - 40 * DAY, openedMs: NOW - 39 * DAY })
  ];
  const contacts = [c("a", { lastOpenedMs: NOW - 2 * DAY, lastEmailedMs: NOW - 2 * DAY }), c("b", { lastEmailedMs: NOW - 5 * DAY }), c("c"), c("d"), c("e", { lastEmailedMs: NOW - 40 * DAY, lastOpenedMs: NOW - 39 * DAY })];
  const eng = engagement(sends, contacts, range, NOW);
  assert.equal(eng.people, 3); // a, b, c had emails accepted in the period
  assert.equal(eng.opened, 1);
  assert.equal(eng.clicked, 1);
  assert.equal(eng.repeatEngagement, 50); // a opened two campaigns; e opened one
  assert.equal(eng.active, 1);
  const del = delivery(sends, range);
  assert.deepEqual([del.tried, del.accepted, del.failed, del.bounced, del.delivered], [5, 4, 1, 1, 3]);
  assert.equal(del.bounceRate, 25);
  assert.equal(listReputation({ bounceRate: 0.4, spamRate: 0, unsubscribeRate: 0.2 }), "Excellent");
  assert.equal(listReputation({ bounceRate: 6, spamRate: 0, unsubscribeRate: 0 }), "Poor");
  assert.equal(listReputation({ bounceRate: null, spamRate: null, unsubscribeRate: null }), null);
});

test("at risk, growth, churn and cohorts come from join and leave dates", () => {
  const contacts = [
    c("q", { lastEmailedMs: NOW - 70 * DAY, createdMs: NOW - 120 * DAY }),
    c("n1", { createdMs: NOW - 5 * DAY }), c("n2", { createdMs: NOW - 2 * DAY }),
    c("gone", { status: "unsubscribed", statusChangedMs: NOW - 4 * DAY, createdMs: NOW - 60 * DAY }),
    c("old", { createdMs: NOW - 200 * DAY })
  ];
  const risk = atRisk(contacts, classify(contacts), NOW);
  assert.deepEqual([risk.quiet, risk.unsubscribedRecently, risk.total], [1, 1, 2]);
  const g = growth(contacts, range);
  assert.deepEqual([g.added, g.churned, g.net, g.atStart], [2, 1, 1, 3]);
  assert.equal(g.churnRate, 20);
  assert.equal(g.retentionRate, 80);
  const series = growthSeries(contacts, ["2026-11-03", "2026-11-04"]);
  assert.equal(series[1].churned, 1);
  const cohort = cohorts(contacts, NOW, 4);
  assert.equal(cohort.length, 4);
  assert.equal(cohort[3].month, "2026-11");
  assert.equal(cohort[3].cells[0], null); // nobody who joined in November is 7 days old... n1 is 5 days, n2 is 2
});

test("segment health, score and grades", () => {
  assert.deepEqual([deliveryGrade(99), deliveryGrade(96), deliveryGrade(91), deliveryGrade(88.8), deliveryGrade(null)], ["Excellent", "Good", "Fair", "Poor", null]);
  assert.equal(segmentHealth({ subscribed: 0, contacts: 0, bad: 0, sent: 0, opened: 0 }), "unhealthy");
  assert.equal(segmentHealth({ subscribed: 50, contacts: 52, bad: 2, sent: 40, opened: 2 }), "at_risk");
  assert.equal(segmentHealth({ subscribed: 50, contacts: 52, bad: 2, sent: 40, opened: 20 }), "healthy");
  assert.equal(healthScore({ quality: 95, deliverability: null, engagement: null, atRiskPercent: null }), 95);
  assert.equal(healthScore({ quality: null, deliverability: null, engagement: null, atRiskPercent: null }), null);
  assert.equal(gradeOf(91), "Excellent");
  assert.equal(gradeOf(70), "Fair");
  assert.equal(daysBetween({ fromMs: NOW - 3 * DAY, toMs: NOW }).length, 4);
});

test("issues: found from the numbers, closed when they go away", () => {
  const base: IssueInput = {
    senderReady: true, formEmailOn: true, bounceReportsOn: true,
    delivery: { accepted: 200, bounceRate: 4.8, spamRate: 0, failedRate: 0, tried: 200 },
    engagement: { people: 200, openRate: 12 }, quality: { total: 300, bounced: 9, duplicate: 1 },
    unsubscribes: { inPeriod: 4, sentInPeriod: 200 }, newContacts14d: 5, ordersWithPhone14d: 50, stuckSends: 0,
    auth: { spf: "verified", dkim: "verified", dmarc: "missing" },
    segments: [{ id: "s1", name: "Product Interest", health: "at_risk", usedByCampaign: false, subscribed: 30 }, { id: "s2", name: "VIP", health: "unhealthy", usedByCampaign: true, subscribed: 0 }]
  };
  const issues = detectIssues(base);
  const by = Object.fromEntries(issues.map((issue) => [issue.key, issue.severity]));
  assert.equal(by.high_bounce, "high");
  assert.equal(by.low_open_rate, "high");
  assert.equal(by.invalid_emails, "medium");
  assert.equal(by.unsubscribe_spike, "high");
  assert.equal(by.dmarc_missing, "medium");
  assert.equal(by["segment_at_risk:s1"], "medium");
  assert.equal(by["segment_empty:s2"], "high");
  assert.equal(by.bounce_reports_off, undefined);
  const quiet = detectIssues({ ...base, senderReady: false, senderReason: "no key", delivery: { accepted: 5, bounceRate: 20, spamRate: 0, failedRate: 0, tried: 5 } });
  assert.equal(quiet.find((issue) => issue.key === "sender_not_ready")?.severity, "critical");
  assert.equal(quiet.find((issue) => issue.key === "high_bounce"), undefined); // too few emails to judge
  const plan = reconcileIssues([{ id: "1", key: "high_bounce" }, { id: "2", key: "old_problem" }], issues);
  assert.deepEqual(plan.keep, ["1"]);
  assert.deepEqual(plan.close, ["2"]);
  assert.ok(plan.add.every((issue) => issue.key !== "high_bounce"));
});
