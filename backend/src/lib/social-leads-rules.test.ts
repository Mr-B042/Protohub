import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanSla, dedupeKey, leadScore, matchProduct, messagingWindow, parseInbound, phoneInText, slaStage, statusAfterCustomerMessage, strongIntent, workingMsBetween
} from "./social-leads-rules.js";

const HOURS = { workStartMinute: 8 * 60 + 30, workEndMinute: 17 * 60, worksSunday: false };
const at = (iso: string) => Date.parse(iso);

test("response clock: working minutes only (Lagos 8:30-5pm, no Sunday)", () => {
  // Thu 12 Nov 2026, 10:00 -> 10:07 Lagos (09:00Z -> 09:07Z): 7 minutes.
  assert.equal(workingMsBetween(at("2026-11-12T09:00:00Z"), at("2026-11-12T09:07:00Z"), HOURS) / 60_000, 7);
  // Message at 10pm Lagos, now 8:35am next day: only 5 working minutes.
  assert.equal(workingMsBetween(at("2026-11-12T21:00:00Z"), at("2026-11-13T07:35:00Z"), HOURS) / 60_000, 5);
  // Saturday 4:55pm -> Monday 8:32am: 5 + 2 minutes (Sunday off).
  assert.equal(workingMsBetween(at("2026-11-14T15:55:00Z"), at("2026-11-16T07:32:00Z"), HOURS) / 60_000, 7);
});

test("clock stages follow the settings", () => {
  const sla = cleanSla(undefined);
  assert.deepEqual([0, 2, 5, 10, 15, 20].map((m) => slaStage(m, sla)), ["ok", "yellow", "red", "renotify", "escalate", "reassign"]);
  assert.deepEqual(cleanSla({ yellow: 3, red: "x" }), { yellow: 3, red: 5, renotify: 10, escalate: 15, reassign: 20 });
  assert.equal(slaStage(60, cleanSla({ reassign: 0 })), "escalate"); // 0 = never hand to another rep
});

test("24-hour window keeps real time; a person may reply up to 7 days", () => {
  const now = at("2026-11-12T12:00:00Z");
  assert.equal(messagingWindow("2026-11-12T00:00:00Z", now).state, "open");
  assert.equal(messagingWindow("2026-11-11T11:00:00Z", now).state, "human_only");
  assert.equal(messagingWindow("2026-11-01T11:00:00Z", now).state, "closed");
  assert.equal(messagingWindow(null, now).state, "none");
});

test("phone numbers in messages", () => {
  assert.equal(phoneInText("call me on 0803 123 4567 please"), "08031234567");
  assert.equal(phoneInText("+2348031234567"), "08031234567");
  assert.equal(phoneInText("my number is 0971234567"), "0971234567");
  assert.equal(phoneInText("I need 2 pieces"), null);
});

test("buying intent and score", () => {
  assert.equal(strongIntent("I want it, send it to Lekki"), true);
  assert.equal(strongIntent("how much is it?"), false);
  const low = leadScore({ engaged: false, phone: false, state: false, product: true, hot: false, customerMessages: [] });
  const high = leadScore({ engaged: true, phone: true, state: true, product: true, hot: true, customerMessages: ["How much?", "I want one, how do I pay"] });
  assert.ok(low < 30 && high >= 85 && high <= 100, `${low} ${high}`);
});

test("ManyChat Full Contact Data body + our query values", () => {
  const parsed = parseInbound(
    { id: "123456789", first_name: "Chinedu", last_name: "Okafor", profile_pic: "https://x/p.jpg", last_input_text: "I'm interested in the shelf", live_chat_url: "https://app.manychat.com/fb1/chat/123456789", last_interaction: "2026-11-12T09:24:00Z", custom_fields: { product: "Multi Corner Shelf" } },
    { event: "comment", campaign: "{{campaign}}" }
  );
  assert.ok(!("error" in parsed));
  if ("error" in parsed) return;
  assert.equal(parsed.contactId, "123456789");
  assert.equal(parsed.name, "Chinedu Okafor");
  assert.equal(parsed.event, "comment");
  assert.equal(parsed.comment, "I'm interested in the shelf");
  assert.equal(parsed.product, "Multi Corner Shelf");
  assert.equal(parsed.campaign, null); // an unfilled {{field}} is ignored
  assert.equal(parsed.platform, "facebook");
  assert.equal((parseInbound({ id: "987654", ig_username: "amaka", last_input_text: "How much?" }) as any).platform, "instagram");
  assert.ok("error" in parseInbound({ name: "x" }));
  // Same event twice -> same key; a new message -> new key.
  const again = parseInbound({ id: "123456789", last_input_text: "I'm interested in the shelf", last_interaction: "2026-11-12T09:24:00Z" }, { event: "comment" });
  const other = parseInbound({ id: "123456789", last_input_text: "Yes please", last_interaction: "2026-11-12T09:26:00Z" });
  if ("error" in again || "error" in other) return assert.fail();
  assert.equal(dedupeKey(parsed), dedupeKey(again));
  assert.notEqual(dedupeKey(parsed), dedupeKey(other));
});

test("product named in words", () => {
  const products = [{ id: "a", name: "Multi Corner Storage Shelf" }, { id: "b", name: "5-in-1 Shoe Rack" }, { id: "c", name: "Edge Brusher Max" }];
  assert.equal(matchProduct("shelf", products)?.id, "a");
  assert.equal(matchProduct("5 in 1 rack", products)?.id, "b");
  assert.equal(matchProduct("nothing", products), null);
});

test("status after a customer message", () => {
  assert.equal(statusAfterCustomerMessage("dm_sent", { phoneFound: false, strong: false, event: "message" }), "engaged");
  assert.equal(statusAfterCustomerMessage("in_conversation", { phoneFound: true, strong: false, event: "message" }), "call_requested");
  assert.equal(statusAfterCustomerMessage("awaiting_customer", { phoneFound: false, strong: false, event: "message" }), "in_conversation");
  assert.equal(statusAfterCustomerMessage("order_created", { phoneFound: true, strong: true, event: "message" }), "order_created");
  assert.equal(statusAfterCustomerMessage("comment_captured", { phoneFound: false, strong: false, event: "comment" }), "comment_captured");
});

test("settings: defaults, junk refused, Owner always allowed", async () => {
  const { cleanPrefs, hotByKeywords, PREF_DEFAULTS } = await import("./social-leads-rules.js");
  assert.deepEqual(cleanPrefs(undefined).workingDays, [1, 2, 3, 4, 5, 6]);
  const p = cleanPrefs({ workingDays: [1, 9, 2, 2], hotKeywords: ["Buy", "x", "send account"], roles: ["Sales Rep", "Hacker"], autoCloseDays: -1 });
  assert.deepEqual(p.workingDays, [1, 2]);
  assert.deepEqual(p.hotKeywords, ["buy", "send account"]);
  assert.deepEqual(p.roles, ["Owner", "Sales Rep"]);
  assert.equal(p.autoCloseDays, PREF_DEFAULTS.autoCloseDays);
  assert.equal(hotByKeywords("Please send account number", p.hotKeywords), true);
  assert.equal(hotByKeywords("buyer?", p.hotKeywords), false);
});

test("working days from Settings: a Saturday-off branch skips Saturday", () => {
  const sat = workingMsBetween(at("2026-11-14T09:00:00Z"), at("2026-11-14T09:10:00Z"), { ...HOURS, workingDays: [1, 2, 3, 4, 5] });
  assert.equal(sat, 0);
});

test("SLA per kind of lead: hot first, half for yellow, double to escalate", async () => {
  const { slaRuleFor, slaFor, DEFAULT_SLA_RULES, cleanPrefs } = await import("./social-leads-rules.js");
  const global = cleanSla(undefined);
  assert.equal(slaRuleFor({ hot: true }, DEFAULT_SLA_RULES)?.key, "hot");
  assert.equal(slaRuleFor({ status: "follow_up" }, DEFAULT_SLA_RULES)?.key, "follow_up");
  assert.equal(slaRuleFor({ returning: true }, DEFAULT_SLA_RULES)?.key, "returning");
  assert.equal(slaRuleFor({}, DEFAULT_SLA_RULES)?.key, "new");
  assert.deepEqual(slaFor(DEFAULT_SLA_RULES[0], false, global), { yellow: 3, red: 5, renotify: 8, escalate: 10, reassign: 20 });
  assert.equal(slaFor(DEFAULT_SLA_RULES[0], true, global).red, 15); // a later reply: "next response"
  const off = cleanPrefs({ slaRules: [{ key: "hot", enabled: false }] });
  assert.equal(slaRuleFor({ hot: true }, off.slaRules)?.key, "new");
  assert.equal(cleanPrefs({ slaRules: [{ key: "new", first: 0 }] }).slaRules[0].first, 5);
});
