import assert from "node:assert/strict";
import test from "node:test";
import { nextDeliveryRateBonusGoal } from "./bonus-coach.js";
import { defaultBonusConfig } from "./payroll-calculator.js";

test("next delivery-rate bonus goal uses weekly bonus tiers, not the base-only gate", () => {
  const productMap = new Map([
    ["edge-brusher", {
      ...defaultBonusConfig(),
      poorDeliveryRatePercent: 60,
      upgradeRequiresMinDeliveryRate: 65,
      aovRequiresMinDeliveryRate: 65,
      deliveryRateBonuses: [
        { ratePercent: 70, amount: 10_000 },
        { ratePercent: 80, amount: 20_000 }
      ]
    }]
  ]);

  const result = nextDeliveryRateBonusGoal(productMap, ["edge-brusher"], 0, 14);

  assert.equal(result.nextDeliveryRateTarget, 70);
  assert.equal(result.deliveriesNeededForRateTarget, 10);
});

test("next delivery-rate bonus goal ignores products with no weekly rate tiers", () => {
  const productMap = new Map([
    ["base-only", {
      ...defaultBonusConfig(),
      poorDeliveryRatePercent: 60,
      deliveryRateBonuses: []
    }]
  ]);

  const result = nextDeliveryRateBonusGoal(productMap, ["base-only"], 0, 14);

  assert.equal(result.nextDeliveryRateTarget, null);
  assert.equal(result.deliveriesNeededForRateTarget, null);
});
