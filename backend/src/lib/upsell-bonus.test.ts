import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_UPSELL_BONUS_SETTINGS,
  evaluateUpsellBonus,
  normalizeUpsellBonusSettings
} from "./upsell-bonus.js";

test("profit below gate pays nothing, regardless of delivery rate or expansion rate", () => {
  const result = evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 249_999, 80, 35, 1_000_000);
  assert.equal(result.status, "profit_gate_miss");
  assert.equal(result.finalAmount, 0);
  assert.equal(result.profitGateMet, false);
});

test("profit gate met but delivery rate below 60% pays nothing", () => {
  const result = evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 59.9, 35, 1_000_000);
  assert.equal(result.status, "delivery_gate_miss");
  assert.equal(result.finalAmount, 0);
  assert.equal(result.profitGateMet, true);
  assert.equal(result.deliveryGateMet, false);
});

test("both gates met but expansion rate below first tier pays nothing", () => {
  const result = evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 9.9, 1_000_000);
  assert.equal(result.status, "below_tier");
  assert.equal(result.finalAmount, 0);
});

test("expansion-rate tiers pay the configured amount once both gates are met (contribution profit huge, no cap bite)", () => {
  const huge = 100_000_000;
  assert.equal(evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 10, huge).finalAmount, 5_000);
  assert.equal(evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 14.9, huge).finalAmount, 5_000);
  assert.equal(evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 15, huge).finalAmount, 10_000);
  assert.equal(evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 20, huge).finalAmount, 15_000);
  assert.equal(evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 25, huge).finalAmount, 20_000);
  assert.equal(evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 30, huge).finalAmount, 25_000);
  assert.equal(evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 100, huge).finalAmount, 25_000);
});

test("Bright's own worked example: 25-29.9% tier (₦20,000) capped to ₦10,000 when contribution profit is only ₦50,000 (20% of 50k)", () => {
  const result = evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 27, 50_000);
  assert.equal(result.tierAmount, 20_000);
  assert.equal(result.cappedAmount, 10_000);
  assert.equal(result.finalAmount, 10_000);
  assert.equal(result.capApplied, true);
});

test("cap does not reduce the payout when contribution profit comfortably covers the tier", () => {
  const result = evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 27, 500_000);
  assert.equal(result.tierAmount, 20_000);
  assert.equal(result.cappedAmount, 20_000);
  assert.equal(result.finalAmount, 20_000);
  assert.equal(result.capApplied, false);
});

test("zero or negative contribution profit caps the bonus to zero even when tier is hit", () => {
  const zero = evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 27, 0);
  assert.equal(zero.finalAmount, 0);
  assert.equal(zero.capApplied, true);

  const negative = evaluateUpsellBonus(DEFAULT_UPSELL_BONUS_SETTINGS, 300_000, 65, 27, -10_000);
  assert.equal(negative.finalAmount, 0);
});

test("owner-edited tiers, gates, and cap are normalized, sorted, and evaluated correctly", () => {
  const settings = normalizeUpsellBonusSettings({
    profitGateAmount: 400_000,
    deliveryRateGatePct: 70,
    contributionCapPct: 25,
    tiers: [
      { label: "Top", minRate: 40, maxRate: null, amount: 60_000 },
      { label: "Start", minRate: 20, maxRate: 39.9, amount: 30_000 }
    ]
  });

  assert.equal(settings.profitGateAmount, 400_000);
  assert.equal(settings.deliveryRateGatePct, 70);
  assert.equal(settings.contributionCapPct, 25);
  assert.deepEqual(settings.tiers.map((tier) => tier.label), ["Start", "Top"]);

  const result = evaluateUpsellBonus(settings, 400_000, 72, 45, 1_000_000);
  assert.equal(result.tierAmount, 60_000);
  assert.equal(result.finalAmount, 60_000);
});
