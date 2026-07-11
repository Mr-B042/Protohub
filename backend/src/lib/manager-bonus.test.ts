import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MANAGER_BONUS_SETTINGS,
  evaluateManagerBonus,
  normalizeManagerBonusSettings
} from "./manager-bonus.js";

test("profit below gate pays support only", () => {
  const result = evaluateManagerBonus(DEFAULT_MANAGER_BONUS_SETTINGS, 149_999, 80);

  assert.equal(result.status, "support_only");
  assert.equal(result.amount, 10_000);
  assert.equal(result.profitGateMet, false);
});

test("delivery tiers pay the configured amount once profit gate is met", () => {
  assert.equal(evaluateManagerBonus(DEFAULT_MANAGER_BONUS_SETTINGS, 150_000, 55).amount, 15_000);
  assert.equal(evaluateManagerBonus(DEFAULT_MANAGER_BONUS_SETTINGS, 150_000, 59.9).amount, 15_000);
  assert.equal(evaluateManagerBonus(DEFAULT_MANAGER_BONUS_SETTINGS, 150_000, 60).amount, 20_000);
  assert.equal(evaluateManagerBonus(DEFAULT_MANAGER_BONUS_SETTINGS, 150_000, 65).amount, 25_000);
  assert.equal(evaluateManagerBonus(DEFAULT_MANAGER_BONUS_SETTINGS, 150_000, 70).amount, 30_000);
  assert.equal(evaluateManagerBonus(DEFAULT_MANAGER_BONUS_SETTINGS, 150_000, 75).amount, 40_000);
  assert.equal(evaluateManagerBonus(DEFAULT_MANAGER_BONUS_SETTINGS, 150_000, 100).amount, 40_000);
});

test("profit met but delivery below first tier uses below-tier amount", () => {
  const result = evaluateManagerBonus(DEFAULT_MANAGER_BONUS_SETTINGS, 200_000, 54.9);

  assert.equal(result.status, "below_delivery_floor");
  assert.equal(result.amount, 0);
  assert.equal(result.profitGateMet, true);
});

test("owner edited tiers are normalized and sorted", () => {
  const settings = normalizeManagerBonusSettings({
    profitGateAmount: 300_000,
    supportBonusAmount: 12_000,
    belowTierAmount: 5_000,
    tiers: [
      { label: "Top", minRate: 80, maxRate: null, amount: 50_000 },
      { label: "Start", minRate: 50, maxRate: 79.9, amount: 20_000 }
    ]
  });

  assert.equal(settings.profitGateAmount, 300_000);
  assert.equal(settings.supportBonusAmount, 12_000);
  assert.equal(settings.belowTierAmount, 5_000);
  assert.deepEqual(settings.tiers.map((tier) => tier.label), ["Start", "Top"]);
  assert.equal(evaluateManagerBonus(settings, 300_000, 82).amount, 50_000);
});
