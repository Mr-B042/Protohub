import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS, branchNodeId, defaultStage, checkMet, durationDays, emailNodes, firstNodeId, inSendWindow, mayEnter, nextNodeId, nextWindowStart, normalizeSettings,
  normalizeTrigger, normalizeWorkflow, type CheckFacts
} from "./email-automation-rules.js";

const DAY = 86_400_000;
const TAG = "11111111-2222-4333-8444-555555555555";

const flow = normalizeWorkflow({
  nodes: [
    { id: "w1", type: "wait", amount: 1, unit: "days" },
    { id: "e1", type: "email", name: "Thank you", email: { subject: "Thanks", preheader: "", design: null } },
    { id: "c1", type: "condition", name: "Bought again?", check: { kind: "placed_order" }, yes: [{ id: "t1", type: "tag", action: "add", tagId: TAG, tagName: "Repeat" }], no: [{ id: "e2", type: "email", name: "Come back", email: { subject: "10% off", preheader: "", design: null } }, { id: "w2", type: "wait", amount: 3, unit: "days" }] },
    { id: "c2", type: "condition", name: "Opened?", check: { kind: "opened_last" }, yes: [], no: [] },
    { id: "e3", type: "email", name: "Last one", email: { subject: "Bye", preheader: "", design: null } }
  ]
});

test("walking a flow: next step, into a branch, out of it, and the end", () => {
  assert.equal(firstNodeId(flow), "w1");
  assert.equal(nextNodeId(flow, "w1"), "e1");
  assert.equal(nextNodeId(flow, "e1"), "c1");
  assert.equal(branchNodeId(flow, "c1", true), "t1");
  assert.equal(nextNodeId(flow, "t1"), "c2"); // the Yes branch ended: back after the check
  assert.equal(branchNodeId(flow, "c1", false), "e2");
  assert.equal(nextNodeId(flow, "e2"), "w2");
  assert.equal(nextNodeId(flow, "w2"), "c2");
  assert.equal(branchNodeId(flow, "c2", true), "e3"); // an empty branch goes straight past the check
  assert.equal(nextNodeId(flow, "e3"), null);
  assert.equal(nextNodeId(flow, "missing"), null);
  assert.equal(emailNodes(flow).length, 3);
  assert.equal(durationDays(flow.nodes), 4); // 1 day + the longer branch (3 days)
});

test("cleaning a flow: unknown steps, missing tags and size limits are refused", () => {
  assert.throws(() => normalizeWorkflow({ nodes: [{ type: "sms" }] }), /doesn't know/);
  assert.throws(() => normalizeWorkflow({ nodes: [{ type: "tag", action: "add" }] }), /Pick a tag/);
  assert.throws(() => normalizeWorkflow({ nodes: Array.from({ length: 41 }, () => ({ type: "exit" })) }), /up to 40 steps/);
  const deep = { type: "condition", check: { kind: "placed_order" }, yes: [{ type: "condition", check: { kind: "placed_order" }, yes: [{ type: "condition", check: { kind: "placed_order" }, yes: [{ type: "condition", check: { kind: "placed_order" }, yes: [], no: [] }], no: [] }], no: [] }], no: [] };
  assert.throws(() => normalizeWorkflow({ nodes: [deep] }), /3 deep/);
  const cleaned = normalizeWorkflow({ nodes: [{ id: "a", type: "wait", amount: 999, unit: "days" }, { id: "a", type: "wait", amount: 0, unit: "hours" }] });
  assert.equal((cleaned.nodes[0] as any).amount, 365);
  assert.notEqual(cleaned.nodes[1].id, "a"); // a repeated id gets a new one
  assert.equal((cleaned.nodes[1] as any).amount, 1);
});

test("triggers and settings fall back to safe values", () => {
  assert.deepEqual(normalizeTrigger({ kind: "inactive", inactiveDays: 2 }), { kind: "inactive", inactiveDays: 7 });
  assert.deepEqual(normalizeTrigger({ kind: "nope" }), { kind: "order_delivered", productId: null });
  const s = normalizeSettings({ sendWindow: { on: true, from: 18, to: 9, days: [5, 9, 1, 1] }, replyTo: "Not an email", exit: { afterDays: "" } });
  assert.deepEqual(s.sendWindow, { on: true, from: 18, to: 19, days: [1, 5] });
  assert.equal(s.replyTo, "");
  assert.equal(s.exit.afterDays, null);
  assert.equal(normalizeSettings({ replyTo: "Help@Shop.ng" }).replyTo, "help@shop.ng");
});

test("send window: Lagos hours and days, and the next opening", () => {
  const window = { on: true, from: 8, to: 19, days: [1, 2, 3, 4, 5] };
  const friday8pm = Date.parse("2026-11-13T20:00:00+01:00");
  assert.equal(inSendWindow(friday8pm, window), false);
  assert.equal(new Date(nextWindowStart(friday8pm, window)).toISOString(), "2026-11-16T07:00:00.000Z"); // Monday 8:00 AM Lagos
  const tuesday10am = Date.parse("2026-11-10T10:00:00+01:00");
  assert.equal(nextWindowStart(tuesday10am, window), tuesday10am);
  assert.equal(inSendWindow(friday8pm, { ...window, on: false }), true);
});

test("checks and who may enter again", () => {
  const facts: CheckFacts = { placedOrderSince: false, deliveredSince: false, openedLast: false, clickedLast: true, reviewed: false, inSegment: (id) => id === "s1", hasTag: () => false };
  assert.equal(checkMet({ kind: "opened_last" }, facts), true); // a click means it was opened
  assert.equal(checkMet({ kind: "placed_order" }, facts), false);
  assert.equal(checkMet({ kind: "in_segment", segmentId: "s1" }, facts), true);
  const now = Date.now();
  assert.equal(mayEnter(DEFAULT_SETTINGS, [], now), true);
  assert.equal(mayEnter(DEFAULT_SETTINGS, [{ status: "active", enteredMs: now - 90 * DAY }], now), false);
  assert.equal(mayEnter(DEFAULT_SETTINGS, [{ status: "completed", enteredMs: now - 10 * DAY }], now), false); // 30-day wait
  assert.equal(mayEnter(DEFAULT_SETTINGS, [{ status: "completed", enteredMs: now - 31 * DAY }], now), true);
  assert.equal(mayEnter({ ...DEFAULT_SETTINGS, reentry: false }, [{ status: "completed", enteredMs: now - 300 * DAY }], now), false);
  assert.equal(mayEnter({ ...DEFAULT_SETTINGS, frequency: "max_2" }, [{ status: "completed", enteredMs: now - 90 * DAY }, { status: "exited", enteredMs: now - 60 * DAY }], now), false);
});

test("customer stage: picked from the template, else the trigger", () => {
  assert.equal(defaultStage("welcome", { kind: "new_subscriber" }), "acquisition");
  assert.equal(defaultStage("upsell_cross_sell", { kind: "order_delivered" }), "post_purchase");
  assert.equal(defaultStage(null, { kind: "inactive" }), "winback");
  assert.equal(defaultStage(null, { kind: "cart_abandoned" }), "conversion");
  assert.equal(defaultStage("not-a-template", null), "retention");
});
