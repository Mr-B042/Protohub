import assert from "node:assert/strict";
import test from "node:test";
import { cleanConfig, conditionsPass, configProblem, fillVariables, firstRunAt, nextOpen, nextScheduled, ruleMatches, type LeadFacts } from "./automation-rules.js";

const facts: LeadFacts = { tags: ["New Lead"], message: "How much is the shelf? price please", state: "Lagos", productId: "p1", product: "Multi Corner Storage Shelf", status: "new", platform: "facebook", orders: 0, hot: false, score: 40 };

test("Bright's example conditions: tag is New Lead AND message has price/cost/how much AND state not Zamfara/Sokoto/Jigawa", () => {
  const c = cleanConfig({ conditions: { enabled: true, match: "all", rules: [
    { field: "tag", op: "is", values: ["New Lead"] },
    { field: "message", op: "any", values: ["price", "cost", "how much"] },
    { field: "state", op: "is_not", values: ["Zamfara", "Sokoto", "Jigawa"] }
  ] } }).conditions;
  assert.equal(conditionsPass(c, facts), true);
  assert.equal(conditionsPass(c, { ...facts, state: "Sokoto" }), false);
  assert.equal(conditionsPass(c, { ...facts, message: "hello" }), false);
  assert.equal(conditionsPass({ ...c, match: "any" }, { ...facts, message: "hello" }), true);
  assert.equal(conditionsPass({ ...c, enabled: false }, { ...facts, state: "Sokoto" }), true);
});

test("each condition kind", () => {
  assert.equal(ruleMatches({ id: "1", field: "orders", op: "is", values: ["0"] }, facts), true);
  assert.equal(ruleMatches({ id: "1", field: "orders", op: "gt", values: ["0"] }, facts), false);
  assert.equal(ruleMatches({ id: "1", field: "product", op: "is", values: ["shelf"] }, facts), true);
  assert.equal(ruleMatches({ id: "1", field: "message", op: "all", values: ["price", "delivery"] }, facts), false);
  assert.equal(ruleMatches({ id: "1", field: "score", op: "gte", values: ["40"] }, facts), true);
  assert.equal(ruleMatches({ id: "1", field: "hot", op: "is", values: [] }, facts), false);
});

test("custom logic: every group must pass", () => {
  const c = cleanConfig({ conditions: { enabled: true, match: "custom", groups: [
    { match: "any", rules: [{ field: "state", op: "is", values: ["Abuja"] }, { field: "state", op: "is", values: ["Lagos"] }] },
    { match: "all", rules: [{ field: "platform", op: "is", values: ["facebook"] }] }
  ] } }).conditions;
  assert.equal(conditionsPass(c, facts), true);
  assert.equal(conditionsPass(c, { ...facts, platform: "instagram" }), false);
});

test("an automation needs a name, an action, a live platform; webhook refused", () => {
  assert.match(configProblem(cleanConfig({}), "")!, /name/);
  assert.match(configProblem(cleanConfig({}), "x")!, /action/);
  assert.match(configProblem(cleanConfig({ trigger: { platforms: ["whatsapp"] }, actions: [{ type: "assign", config: {} }] }), "x")!, /Facebook or Instagram/);
  assert.match(configProblem(cleanConfig({ actions: [{ type: "webhook", config: {} }] }), "x")!, /not available/);
  assert.equal(configProblem(cleanConfig({ actions: [{ type: "send_message", config: { text: "Hi" } }] }), "x"), null);
});

test("working hours push a run to the next opening (Mon–Fri 9–6)", () => {
  const s = cleanConfig({ schedule: { workingHoursOnly: true, days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 } }).schedule;
  // Saturday 14 Nov 2026 10:00 Lagos → Monday 16 Nov 09:00 Lagos.
  assert.equal(new Date(nextOpen(Date.parse("2026-11-14T09:00:00Z"), s)).toISOString(), "2026-11-16T08:00:00.000Z");
  // Thursday 12 Nov 10:00 Lagos is open.
  assert.equal(nextOpen(Date.parse("2026-11-12T09:00:00Z"), s), Date.parse("2026-11-12T09:00:00Z"));
  const delay = cleanConfig({ schedule: { mode: "delay", delayMinutes: 120 } }).schedule;
  assert.equal(firstRunAt(delay, Date.parse("2026-11-12T09:00:00Z")), Date.parse("2026-11-12T11:00:00Z"));
});

test("scheduled + daily repeat: first at the date, then every day, ends after N", () => {
  const s = cleanConfig({ schedule: { mode: "scheduled", date: "2026-11-17", time: "10:00", repeat: true, frequency: "daily", every: 1, ends: "after", endAfter: 2 } }).schedule;
  const now = Date.parse("2026-11-13T09:00:00Z");
  const first = nextScheduled(s, now, 0, now)!;
  assert.equal(new Date(first).toISOString(), "2026-11-17T09:00:00.000Z");
  assert.equal(new Date(nextScheduled(s, first, 1, now)!).toISOString(), "2026-11-18T09:00:00.000Z");
  assert.equal(nextScheduled(s, first, 2, now), null);
  const once = cleanConfig({ schedule: { mode: "scheduled", date: "2026-11-17", time: "10:00" } }).schedule;
  assert.equal(nextScheduled(once, Date.parse("2026-11-17T09:00:00Z"), 1, now), null);
});

test("variables", () => {
  assert.equal(fillVariables("Hi {{customer_name}}, the {{product}} is {{price}}. {{promo}}", { customer_name: "Chinedu", product: "Shelf", price: "₦39,500", promo: "Free delivery" }), "Hi Chinedu, the Shelf is ₦39,500. Free delivery");
  assert.equal(fillVariables("Hi {{customer_name}}", {}), "Hi there");
});
