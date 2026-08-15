import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS, evaluateHeadOfSalesBonus } from "./head-of-sales-bonus.js";

test("below every threshold pays nothing", () => {
  const result = evaluateHeadOfSalesBonus(DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS, 15_000, 50);
  assert.equal(result.level, "none");
  assert.equal(result.amount, 0);
  assert.equal(result.nextTier?.id, "level1");
});

test("Level 1 needs no qualitative check", () => {
  const result = evaluateHeadOfSalesBonus(DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS, 19_500, 60);
  assert.equal(result.level, "level1");
  assert.equal(result.amount, 5_000);
});

test("meeting Level 2's numbers without the qualitative confirmation caps at Level 1", () => {
  const result = evaluateHeadOfSalesBonus(DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS, 21_000, 60, {
    upsellImprovement: false,
    initiativeSuccess: false
  });
  assert.equal(result.level, "level1");
  assert.equal(result.nextTier?.id, "level2");
});

test("Level 2 needs both the numbers and the confirmed upsell/cross-sell improvement", () => {
  const result = evaluateHeadOfSalesBonus(DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS, 21_000, 60, {
    upsellImprovement: true,
    initiativeSuccess: false
  });
  assert.equal(result.level, "level2");
  assert.equal(result.amount, 10_000);
});

test("Level 3 needs both gates' numbers and BOTH qualitative confirmations", () => {
  const missingInitiative = evaluateHeadOfSalesBonus(DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS, 23_000, 65, {
    upsellImprovement: true,
    initiativeSuccess: false
  });
  assert.equal(missingInitiative.level, "level2");

  const full = evaluateHeadOfSalesBonus(DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS, 23_000, 65, {
    upsellImprovement: true,
    initiativeSuccess: true
  });
  assert.equal(full.level, "level3");
  assert.equal(full.amount, 15_000);
  assert.equal(full.nextTier, null);
});

test("AOV alone is not enough - delivery rate must clear the same tier's floor too", () => {
  const result = evaluateHeadOfSalesBonus(DEFAULT_HEAD_OF_SALES_BONUS_SETTINGS, 30_000, 40);
  assert.equal(result.level, "none");
});
