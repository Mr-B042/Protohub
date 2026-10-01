import assert from "node:assert/strict";
import test from "node:test";
import { classifyRepInfluence, headBonusHold, orderHasRepExpansion } from "./head-of-sales-script.js";

const base = { upsellRate: 30, crossSellRate: 10, baselineUpsellRate: 20, baselineCrossSellRate: 10, expansionOrders: 6, scriptOrders: 0 };

test("improved with the script on most orders = her influence", () => {
  assert.equal(classifyRepInfluence({ ...base, scriptOrders: 4 }).verdict, "influenced");
  assert.equal(classifyRepInfluence({ ...base, scriptOrders: 3 }).verdict, "influenced");
});

test("improved with the script on a few orders = mixed", () => {
  assert.equal(classifyRepInfluence({ ...base, scriptOrders: 2 }).verdict, "mixed");
});

test("improved without the script = own effort", () => {
  assert.equal(classifyRepInfluence(base).verdict, "own_effort");
});

test("no better than the last 4 weeks = no improvement, whatever the script", () => {
  const flat = { ...base, upsellRate: 20 };
  assert.equal(classifyRepInfluence(flat).verdict, "no_improvement");
  assert.match(classifyRepInfluence({ ...flat, scriptOrders: 5 }).label, /even with the script on 5 orders/);
});

test("no upsells or cross-sells = nothing to judge", () => {
  assert.equal(classifyRepInfluence({ ...base, expansionOrders: 0 }).verdict, "no_sales");
});

test("bonus is held without a script, or when nobody used it; never when there is no bonus", () => {
  assert.deepEqual(headBonusHold({ amount: 5000, scriptSubmitted: false, scriptUses: 0 }), { held: true, reasons: ["no_script"] });
  assert.deepEqual(headBonusHold({ amount: 5000, scriptSubmitted: true, scriptUses: 0 }), { held: true, reasons: ["script_not_used"] });
  assert.deepEqual(headBonusHold({ amount: 5000, scriptSubmitted: true, scriptUses: 3 }), { held: false, reasons: [] });
  assert.deepEqual(headBonusHold({ amount: 0, scriptSubmitted: false, scriptUses: 0 }), { held: false, reasons: [] });
});

test("only a recorded upsell or a rep-added cross-sell can carry the script tick", () => {
  assert.equal(orderHasRepExpansion({ upsell_from_qty: 1, upsell_to_qty: 2 }), true);
  assert.equal(orderHasRepExpansion({ upsell_from_qty: 2, upsell_to_qty: 2 }), false);
  assert.equal(orderHasRepExpansion({ cross_sell_lines: [{ selectionSource: "manual_rep" }] }), true);
  assert.equal(orderHasRepExpansion({ cross_sell_lines: [{ selectionSource: "public_form" }, { selectionSource: "public_upsell" }] }), false);
  assert.equal(orderHasRepExpansion({ cross_sell_lines: [{}] }), true);
});
