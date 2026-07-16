import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_UPSELL_BONUS_SETTINGS,
  evaluateUpsellBonus,
  normalizeUpsellBonusSettings
} from "./upsell-bonus.js";

test("profit below gate pays nothing, regardless of delivery rate or contribution profit", () => {
  const result = evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 249_999, 80, 1_000_000);
  assert.equal(result.status, "profit_gate_miss");
  assert.equal(result.finalAmount, 0);
  assert.equal(result.profitGateMet, false);
});

test("profit gate met but delivery rate below 60% pays nothing", () => {
  const result = evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 59.9, 1_000_000);
  assert.equal(result.status, "delivery_gate_miss");
  assert.equal(result.finalAmount, 0);
  assert.equal(result.profitGateMet, true);
  assert.equal(result.deliveryGateMet, false);
});

test("both gates met but negative contribution profit is below the first tier", () => {
  const result = evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, -1_000);
  assert.equal(result.status, "below_tier");
  assert.equal(result.finalAmount, 0);
});

test("contribution-profit tiers pay the configured amount once both gates are met and the cap doesn't bite", () => {
  // Each sample profit sits comfortably inside its band so 20% of it still
  // covers the tier amount - see the dedicated cap tests below for the case
  // where it doesn't.
  assert.equal(evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 40_000).finalAmount, 5_000);
  assert.equal(evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 60_000).finalAmount, 10_000);
  assert.equal(evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 120_000).finalAmount, 15_000);
  assert.equal(evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 160_000).finalAmount, 20_000);
  assert.equal(evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 250_000).finalAmount, 25_000);
  assert.equal(evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 100_000_000).finalAmount, 25_000);
});

test("the lowest tier's payout can still be capped when contribution profit is thin (₦10,000 profit caps ₦5,000 down to ₦2,000)", () => {
  const result = evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 10_000);
  assert.equal(result.tierAmount, 5_000);
  assert.equal(result.cappedAmount, 2_000);
  assert.equal(result.finalAmount, 2_000);
  assert.equal(result.capApplied, true);
});

test("higher tiers never get capped below their flat amount, because their minimum profit already clears 20%", () => {
  // At each band's own floor, 20% of that floor already meets or exceeds the
  // tier amount, so the cap only ever bites in the bottom tier.
  const atFloor = evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 50_000);
  assert.equal(atFloor.tierAmount, 10_000);
  assert.equal(atFloor.finalAmount, 10_000);
  assert.equal(atFloor.capApplied, false);
});

test("zero contribution profit still matches the first tier but is capped to zero", () => {
  const result = evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 0);
  assert.equal(result.status, "tier_bonus");
  assert.equal(result.tierAmount, 5_000);
  assert.equal(result.finalAmount, 0);
  assert.equal(result.capApplied, true);
});

test("owner-edited tiers, gates, and cap are normalized, sorted, and evaluated correctly", () => {
  const settings = normalizeUpsellBonusSettings({
    profitGateAmount: 400_000,
    deliveryRateGatePct: 70,
    contributionCapPct: 25,
    tiers: [
      { label: "Top", minProfit: 300_000, maxProfit: null, amount: 60_000 },
      { label: "Start", minProfit: 100_000, maxProfit: 299_999, amount: 30_000 }
    ]
  });

  assert.equal(settings.profitGateAmount, 400_000);
  assert.equal(settings.deliveryRateGatePct, 70);
  assert.equal(settings.contributionCapPct, 25);
  assert.deepEqual(settings.tiers.map((tier) => tier.label), ["Start", "Top"]);

  const result = evaluateUpsellBonus(settings, 400_000, 72, 1_000_000);
  assert.equal(result.tierAmount, 60_000);
  assert.equal(result.finalAmount, 60_000);
});
