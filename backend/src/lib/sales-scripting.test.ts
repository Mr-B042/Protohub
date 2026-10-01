import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCRIPT_SETTINGS, fillScriptText, funnelOf, mergeSettings, nearDuplicates, outdatedPrices,
  playbookReadiness, priceMentions, repDiagnosis, scriptHealth
} from "./sales-scripting.js";

test("placeholders are filled from the current offer; unknown ones are reported", () => {
  const result = fillScriptText("The {{product_name}} goes for {{current_price}}. {{delivery_offer}}", { product_name: "Corner Rack", current_price: "₦39,500", delivery_offer: "" });
  assert.equal(result.text, "The Corner Rack goes for ₦39,500. {{delivery_offer}}");
  assert.deepEqual(result.missing, ["delivery_offer"]);
});

test("typed prices are found in the usual ways of writing naira", () => {
  assert.deepEqual(priceMentions("Two for ₦68,500 or N39500, that is 29,000 naira more").sort(), [29000, 39500, 68500]);
  assert.deepEqual(priceMentions("Take 2 pieces, 10 minutes"), []);
});

test("a typed price that is not a current price is flagged as outdated", () => {
  assert.deepEqual(outdatedPrices("Only ₦39,500 for one", [42500, 68500]), [39500]);
  assert.deepEqual(outdatedPrices("Only ₦42,500 for one", [42500, 68500]), []);
});

test("same purpose or mostly the same wording counts as a duplicate", () => {
  const others = [
    { id: "a", title: "Value upgrade", scenario: "Value Upgrade", whatToSay: "Most customers take two because it gives better value and saves delivery" },
    { id: "b", title: "Bathrooms", scenario: "Household need", whatToSay: "If you have two bathrooms you will want one for each" }
  ];
  assert.deepEqual(nearDuplicates({ scenario: "value upgrade", whatToSay: "anything" }, others).map((item) => item.reason), ["same_purpose"]);
  assert.deepEqual(nearDuplicates({ scenario: "Delivery savings", whatToSay: "Most customers take two because it gives better value and saves on delivery" }, others).map((item) => item.id), ["a"]);
  assert.deepEqual(nearDuplicates({ scenario: "Limited offer", whatToSay: "This week's offer ends Friday" }, others), []);
});

test("playbook readiness: 5 per core category = 100%, objections never block it", () => {
  assert.equal(playbookReadiness({ closing: 5, upsell: 5, cross_sell: 5, objection: 0 }, 5).percent, 100);
  const partial = playbookReadiness({ closing: 5, upsell: 3, cross_sell: 2, objection: 8 }, 5);
  assert.equal(partial.percent, 67);
  assert.equal(partial.categories.upsell.ok, false);
  assert.equal(partial.categories.objection.count, 8);
});

test("the funnel: used -> accepted -> delivered, revenue only from delivered yeses", () => {
  const funnel = funnelOf([
    { repId: "a", outcome: "accepted", delivered: true, incrementalRevenue: 29000 },
    { repId: "a", outcome: "accepted", delivered: false, incrementalRevenue: 29000 },
    { repId: "b", outcome: "declined", delivered: true, incrementalRevenue: 0 },
    { repId: "b", outcome: "accepted", delivered: true, incrementalRevenue: 5000 }
  ], 10);
  assert.deepEqual(funnel, { shown: 10, used: 4, accepted: 3, delivered: 2, acceptanceRate: 75, deliveredConversion: 50, incrementalRevenue: 34000 });
});

test("health is set by the numbers", () => {
  const base = { uses: 40, deliveredConversion: 20, previousUses: 40, previousDeliveredConversion: 20, categoryAverage: 15, outdatedPrice: false };
  assert.equal(scriptHealth(base, DEFAULT_SCRIPT_SETTINGS).health, "high");
  assert.equal(scriptHealth({ ...base, deliveredConversion: 13 , previousDeliveredConversion: 13 }, DEFAULT_SCRIPT_SETTINGS).health, "performing");
  assert.equal(scriptHealth({ ...base, deliveredConversion: 9, previousDeliveredConversion: 9 }, DEFAULT_SCRIPT_SETTINGS).health, "needs_review");
  assert.equal(scriptHealth({ ...base, deliveredConversion: 5, previousDeliveredConversion: 5 }, DEFAULT_SCRIPT_SETTINGS).health, "underperforming");
  assert.equal(scriptHealth({ ...base, uses: 5 }, DEFAULT_SCRIPT_SETTINGS).health, "insufficient");
  assert.equal(scriptHealth({ ...base, previousDeliveredConversion: 26 }, DEFAULT_SCRIPT_SETTINGS).health, "needs_review");
  assert.equal(scriptHealth({ ...base, outdatedPrice: true }, DEFAULT_SCRIPT_SETTINGS).health, "needs_review");
});

test("weak script vs a rep who needs coaching", () => {
  assert.match(repDiagnosis([
    { repName: "A", used: 10, deliveredConversion: 5 }, { repName: "B", used: 10, deliveredConversion: 6 }
  ], 20)!, /script itself may be weak/);
  assert.match(repDiagnosis([
    { repName: "Chelsea", used: 24, deliveredConversion: 37.5 }, { repName: "Precious", used: 22, deliveredConversion: 27.3 },
    { repName: "Esther", used: 20, deliveredConversion: 25 }, { repName: "Chidinma", used: 18, deliveredConversion: 11.1 }
  ], 25)!, /Chidinma may need coaching/);
  assert.equal(repDiagnosis([{ repName: "A", used: 2, deliveredConversion: 0 }], 20), null);
});

test("settings fall back to defaults for anything missing or malformed", () => {
  const settings = mergeSettings({ minPerCategory: 3, minUses: "x", defaultNeverSay: ["  ", "Fake offers"] });
  assert.equal(settings.minPerCategory, 3);
  assert.equal(settings.minUses, 20);
  assert.deepEqual(settings.defaultNeverSay, ["Fake offers"]);
});
