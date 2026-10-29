import assert from "node:assert/strict";
import test from "node:test";
import { autoChecks } from "./review-questions.js";

const order = (placedThisWeek: boolean, deliveredDate: string, bonus = 200) => ({ status: "Delivered", placedThisWeek, deliveredDate, bonus });
// 33 placed this week + 6 carried over = 39 paid; 41 delivered for the rate.
const rep = {
  repName: "Rep A", weekStart: "2026-10-18", weekEnd: "2026-10-24",
  totals: { delivered: 41, deliveredForBonus: 39, baseBonus: 7800, upsellBonus: 0, crossSellBonus: 0 },
  orders: [
    ...Array.from({ length: 33 }, () => order(true, "2026-10-22")),
    ...Array.from({ length: 6 }, () => order(false, "2026-10-20")),
    order(true, "2026-10-26", 0), order(true, "2026-10-27", 0)
  ]
};

test("autoChecks: a payout reason with the wrong order count is questioned, in plain lines", () => {
  const checks = autoChecks(rep, { amount: 400, systemAmount: 7800, reason: "#200 base bonus for 41 orders is 8200 and not 7800" });
  assert.deepEqual(checks.map((check) => check.key), ["payout_count:400"]);
  const text = checks[0]!.text;
  assert.match(text, /Your reason says 41 orders\./);
  assert.match(text, /paid on 39 deliveries/);
  assert.match(text, /• 33 placed this week/);
  assert.match(text, /• 6 from earlier weeks/);
  assert.match(text, /41 is the delivery-rate count/);
});

test("autoChecks: the right count raises nothing; a big change is questioned", () => {
  assert.deepEqual(autoChecks(rep, { amount: 400, systemAmount: 7800, reason: "39 orders at 210" }), []);
  const big = autoChecks(rep, { amount: 3600, systemAmount: 13250, reason: "she met all criteria for 300 base bonus" });
  assert.deepEqual(big.map((check) => check.key), ["payout_size:3600"]);
  assert.match(big[0]!.text, /You changed it by \+₦3,600 \(27%\)\./);
  // Small change (under ₦1,000) is left alone.
  assert.deepEqual(autoChecks(rep, { amount: -700, systemAmount: 1600, reason: "half for low rate" }), []);
});

test("autoChecks: orders that do not add up to the bonus are questioned", () => {
  const off = { ...rep, totals: { ...rep.totals, baseBonus: 8000 } };
  assert.deepEqual(autoChecks(off, null).map((check) => check.key), ["orders_sum:200"]);
  assert.deepEqual(autoChecks(rep, null), []);
});
