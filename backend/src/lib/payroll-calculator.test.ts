import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductBonusConfigMap,
  buildWeeklyBonusContextMap,
  computeOrderBonus,
  defaultBonusConfig,
  type PayrollOrder
} from "./payroll-calculator.js";

const deliveredOrder = (id: string, patch: Partial<PayrollOrder> = {}): PayrollOrder => ({
  id,
  assigned_rep_id: "chelsea",
  status: "Delivered",
  amount: 20_000,
  product_id: "edge",
  quantity: 3,
  source: "Website",
  created_at: "2026-07-12T09:00:00",
  delivered_date: "2026-07-14",
  ...patch
});

test("backend defaults match the product bonus defaults used by the dashboard", () => {
  const config = defaultBonusConfig();

  assert.equal(config.baseDelivered.find((rule) => rule.quantity === 3)?.amount, 200);
  assert.equal(config.upgradeBonuses.find((rule) => rule.fromQty === 3 && rule.toQty === 15)?.amount, 3_000);
  assert.equal(config.crossSellPercent, 10);
  assert.equal(config.deliveryRateMinOrders, 50);
  assert.equal(config.poorDeliveryRatePercent, 55);
});

test("Chelsea legacy order bonuses reconcile to ₦5,980 using finalized delivery rate", () => {
  const edgeConfig = {
    ...defaultBonusConfig(),
    baseDelivered: [],
    manualOrderBonuses: [],
    upgradeBonuses: [{ fromQty: 3, toQty: 15, amount: 3_000 }],
    crossSellPercent: 10
  };
  const productMap = buildProductBonusConfigMap([
    { id: "edge", bonus_config: edgeConfig },
    { id: "corner", bonus_config: null }
  ]);
  const selected: PayrollOrder[] = [
    deliveredOrder("2024", { upsell_from_qty: 3, upsell_to_qty: 6 }),
    deliveredOrder("2087", { upsell_from_qty: 3, upsell_to_qty: 6 }),
    deliveredOrder("2099", { quantity: 15, upsell_from_qty: 3, upsell_to_qty: 15 }),
    deliveredOrder("2162", { upsell_from_qty: 3, upsell_to_qty: 6 }),
    deliveredOrder("2061", { cross_sell_lines: [{ amount: 4_900, selectionSource: "manual_rep" }] }),
    deliveredOrder("2130", { cross_sell_lines: [{ amount: 4_900, selectionSource: "manual_rep" }] }),
    deliveredOrder("2034", { product_id: "corner", cross_sell_lines: [{ amount: 10_000, selectionSource: "manual_rep" }] })
  ];
  const ordinaryDelivered: PayrollOrder[] = [
    ...Array.from({ length: 20 }, (_, index) => deliveredOrder(`edge-${index}`)),
    ...Array.from({ length: 4 }, (_, index) => deliveredOrder(`corner-${index}`, { product_id: "corner" }))
  ];
  const cohort: PayrollOrder[] = [
    ...selected,
    ...ordinaryDelivered,
    ...Array.from({ length: 30 }, (_, index) => deliveredOrder(`open-${index}`, { status: "Confirmed" })),
    ...Array.from({ length: 2 }, (_, index) => deliveredOrder(`failed-${index}`, { status: "Failed" }))
  ];
  const context = buildWeeklyBonusContextMap(cohort).get("chelsea::2026-07-12");

  assert.deepEqual(context, { placed: 63, delivered: 31, finalized: 33, amount: 620_000 });
  const rate = Math.round((context!.delivered / context!.finalized) * 100);
  const total = [...selected, ...ordinaryDelivered].reduce((sum, order) => (
    sum + computeOrderBonus(order, productMap, rate, 0, context!.placed)
  ), 0);

  assert.equal(rate, 94);
  assert.equal(total, 5_980);
});
