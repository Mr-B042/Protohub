import assert from "node:assert/strict";
import test from "node:test";
import {
  SALES_BONUS_LAUNCH_WEEK_START,
  attributeRuleEarningsToOrders,
  computeSalesBonusForRep,
  salesBonusWeekStartsForPeriod,
  type SalesBonusOrder,
  type SalesBonusProgram,
  type SalesBonusRep,
  type SalesBonusRule
} from "./sales-bonus-engine.js";

const rep: SalesBonusRep = {
  id: "rep-1",
  name: "Precious",
  role: "Sales Rep",
  active: true
};

const activeProgram: SalesBonusProgram = {
  id: "program-1",
  org_id: "org-1",
  name: "Weekly Sales Rep Bonus",
  status: "active",
  starts_on: SALES_BONUS_LAUNCH_WEEK_START,
  applies_to_user_ids: []
};

const order = (id: string, patch: Partial<SalesBonusOrder> = {}): SalesBonusOrder => ({
  id,
  assigned_rep_id: rep.id,
  customer: `Customer ${id}`,
  status: "Delivered",
  amount: 10_000,
  quantity: 3,
  created_at: "2026-07-01T10:00:00",
  review_hold: false,
  ...patch
});

const run = (rules: SalesBonusRule[], orders: SalesBonusOrder[]) => computeSalesBonusForRep({
  rep,
  weekStart: SALES_BONUS_LAUNCH_WEEK_START,
  programs: [activeProgram],
  rules,
  orders
});

test("5 upgrade customers unlocks ₦2,000", () => {
  const rule: SalesBonusRule = {
    id: "upgrade",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "Upgrade 5 customers",
    type: "upgrade_count",
    status: "active",
    config: { fromQty: 3, toQtyMin: 4, targetCount: 5, amount: 2_000 },
    display_order: 10
  };
  const result = run(rule ? [rule] : [], Array.from({ length: 5 }, (_, index) => order(`u${index}`, {
    upsell_from_qty: 3,
    upsell_to_qty: 5
  })));

  assert.equal(result.earnedSoFar, 2_000);
  assert.equal(result.rules[0]?.completed, true);
});

test("2 rep-driven cross-sells unlocks ₦4,000", () => {
  const rule: SalesBonusRule = {
    id: "cross",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "Cross-sell 2 customers",
    type: "cross_sell_count",
    status: "active",
    config: { targetCount: 2, amount: 4_000, repDrivenOnly: true },
    display_order: 20
  };
  const result = run([rule], [
    order("c1", { cross_sell_lines: [{ selectionSource: "manual_rep", amount: 1_000 }] }),
    order("c2", { cross_sell_lines: [{ selection_source: "manual_rep", amount: 1_000 }] }),
    order("public", { cross_sell_lines: [{ selectionSource: "public_form", amount: 1_000 }] })
  ]);

  assert.equal(result.earnedSoFar, 4_000);
  assert.deepEqual(result.rules[0]?.qualifiedOrderIds.sort(), ["c1", "c2"]);
});

test("upfront 5% pays only when full upfront is marked and order is delivered", () => {
  const rule: SalesBonusRule = {
    id: "upfront",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "Full upfront payment commission",
    type: "upfront_percent",
    status: "active",
    config: { percent: 5, requiresDelivered: true },
    display_order: 30
  };
  const result = run([rule], [
    order("paid-delivered", { amount: 20_000, full_upfront_paid: true }),
    order("paid-pending", { status: "Confirmed", amount: 20_000, full_upfront_paid: true }),
    order("not-paid", { amount: 20_000, full_upfront_paid: false })
  ]);

  assert.equal(result.earnedSoFar, 1_000);
  assert.deepEqual(result.rules[0]?.qualifiedOrderIds, ["paid-delivered"]);
});

test("delivery-rate rule pays ₦200 below gate and ₦400 at 70% with 50+ orders", () => {
  const rule: SalesBonusRule = {
    id: "delivery",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "Delivery-rate pay boost",
    type: "delivery_rate_per_delivered",
    status: "active",
    config: { minOrders: 50, targetRatePercent: 70, fallbackPerDelivered: 200, qualifiedPerDelivered: 400 },
    display_order: 40
  };
  const belowGate = run([rule], [
    ...Array.from({ length: 34 }, (_, index) => order(`d${index}`)),
    ...Array.from({ length: 16 }, (_, index) => order(`p${index}`, { status: "Confirmed" }))
  ]);
  const qualified = run([rule], [
    ...Array.from({ length: 35 }, (_, index) => order(`qd${index}`)),
    ...Array.from({ length: 15 }, (_, index) => order(`qp${index}`, { status: "Confirmed" }))
  ]);

  assert.equal(belowGate.earnedSoFar, 34 * 200);
  assert.equal(qualified.earnedSoFar, 35 * 400);
});

test("product/package-scoped rules do not mix different generated-link products", () => {
  const upgradeRule: SalesBonusRule = {
    id: "corner-upgrade",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "5-in-1 Corner Rack upgrades",
    type: "upgrade_count",
    status: "active",
    config: {
      scopeProductId: "corner-rack",
      scopeProductName: "5-in-1 Corner Racks",
      scopePackageId: "corner-lite",
      scopePackageName: "Lite Pack",
      fromQty: 3,
      toQtyMin: 4,
      targetCount: 2,
      amount: 2_000
    },
    display_order: 10
  };
  const deliveryRule: SalesBonusRule = {
    id: "corner-delivery",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "5-in-1 delivery rate",
    type: "delivery_rate_per_delivered",
    status: "active",
    config: {
      scopeProductId: "corner-rack",
      scopeProductName: "5-in-1 Corner Racks",
      minOrders: 2,
      targetRatePercent: 70,
      fallbackPerDelivered: 200,
      qualifiedPerDelivered: 400
    },
    display_order: 20
  };
  const result = run([upgradeRule, deliveryRule], [
    order("corner-1", { product_id: "corner-rack", product_name: "5-in-1 Corner Racks", package_id: "corner-lite", package_name: "Lite Pack", upsell_from_qty: 3, upsell_to_qty: 5 }),
    order("corner-2", { product_id: "corner-rack", product_name: "5-in-1 Corner Racks", package_id: "corner-lite", package_name: "Lite Pack", upsell_from_qty: 3, upsell_to_qty: 5 }),
    order("edge-1", { product_id: "edge-brusher", product_name: "Edge Brusher Max", package_id: "edge-trial", package_name: "Trial Pack", upsell_from_qty: 3, upsell_to_qty: 5 }),
    order("edge-open", { product_id: "edge-brusher", product_name: "Edge Brusher Max", package_id: "edge-trial", package_name: "Trial Pack", status: "Confirmed" })
  ]);

  assert.equal(result.rules[0]?.earnedAmount, 2_000);
  assert.deepEqual(result.rules[0]?.qualifiedOrderIds.sort(), ["corner-1", "corner-2"]);
  assert.equal(result.rules[0]?.scopeLabel, "Product: 5-in-1 Corner Racks · Package: Lite Pack");
  assert.equal(result.rules[1]?.earnedAmount, 2 * 400);
  assert.equal(result.rules[1]?.progressCurrent, 100);
});

test("cross-sell product scope only counts matching rep-driven add-on lines", () => {
  const rule: SalesBonusRule = {
    id: "soap-cross",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "Soap holder cross-sell",
    type: "cross_sell_count",
    status: "active",
    config: {
      scopeProductId: "soap-holder",
      scopeProductName: "Shark Soap Holder",
      targetCount: 1,
      amount: 4_000,
      repDrivenOnly: true
    },
    display_order: 10
  };
  const result = run([rule], [
    order("soap-line", {
      product_id: "edge-brusher",
      cross_sell_lines: [{ productId: "soap-holder", productName: "Shark Soap Holder", selectionSource: "manual_rep" }]
    }),
    order("wrong-line", {
      product_id: "edge-brusher",
      cross_sell_lines: [{ productId: "mini-mop", productName: "Mini Mop", selectionSource: "manual_rep" }]
    }),
    order("public-soap-line", {
      product_id: "edge-brusher",
      cross_sell_lines: [{ productId: "soap-holder", productName: "Shark Soap Holder", selectionSource: "public_form" }]
    })
  ]);

  assert.equal(result.earnedSoFar, 4_000);
  assert.deepEqual(result.rules[0]?.qualifiedOrderIds, ["soap-line"]);
});

test("cross-sell specific offer only counts lines meeting both the quantity and price floor", () => {
  const rule: SalesBonusRule = {
    id: "soap-offer",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "Soap holder offer",
    type: "cross_sell_offer",
    status: "active",
    config: {
      scopeProductId: "soap-holder",
      scopeProductName: "Shark Soap Holder",
      offerQty: 2,
      offerAmount: 4_900,
      targetCount: 1,
      amount: 2_000,
      repDrivenOnly: true
    },
    display_order: 10
  };
  const result = run([rule], [
    order("meets-both", {
      product_id: "edge-brusher",
      cross_sell_lines: [{ productId: "soap-holder", productName: "Shark Soap Holder", quantity: 2, amount: 4_900, selectionSource: "manual_rep" }]
    }),
    order("under-priced", {
      product_id: "edge-brusher",
      cross_sell_lines: [{ productId: "soap-holder", productName: "Shark Soap Holder", quantity: 2, amount: 3_000, selectionSource: "manual_rep" }]
    }),
    order("under-qty", {
      product_id: "edge-brusher",
      cross_sell_lines: [{ productId: "soap-holder", productName: "Shark Soap Holder", quantity: 1, amount: 6_000, selectionSource: "manual_rep" }]
    }),
    order("public-form-meets-both", {
      product_id: "edge-brusher",
      cross_sell_lines: [{ productId: "soap-holder", productName: "Shark Soap Holder", quantity: 2, amount: 4_900, selectionSource: "public_form" }]
    })
  ]);

  assert.equal(result.earnedSoFar, 2_000);
  assert.deepEqual(result.rules[0]?.qualifiedOrderIds, ["meets-both"]);
});

test("paused and deleted rules do not count for future weeks", () => {
  const rules: SalesBonusRule[] = [
    {
      id: "paused",
      org_id: "org-1",
      program_id: activeProgram.id,
      name: "Paused upgrade",
      type: "upgrade_count",
      status: "paused",
      config: { fromQty: 3, toQtyMin: 4, targetCount: 1, amount: 2_000 },
      display_order: 1
    },
    {
      id: "deleted",
      org_id: "org-1",
      program_id: activeProgram.id,
      name: "Deleted cross-sell",
      type: "cross_sell_count",
      status: "deleted",
      config: { targetCount: 1, amount: 4_000 },
      display_order: 2
    }
  ];
  const result = run(rules, [
    order("u", { upsell_from_qty: 3, upsell_to_qty: 5, cross_sell_lines: [{ selectionSource: "manual_rep" }] })
  ]);

  assert.equal(result.earnedSoFar, 0);
  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0]?.active, false);
});

test("new bonus engine does not pay before launch week", () => {
  const rule: SalesBonusRule = {
    id: "pre-launch-delivery",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "Delivery-rate pay boost",
    type: "delivery_rate_per_delivered",
    status: "active",
    config: { minOrders: 1, targetRatePercent: 70, fallbackPerDelivered: 200, qualifiedPerDelivered: 400 },
    display_order: 1
  };
  const preLaunch = computeSalesBonusForRep({
    rep,
    weekStart: "2026-06-28",
    programs: [activeProgram],
    rules: [rule],
    orders: [order("pre-launch", { manual_bonus_override: 500, bonus_manually_adjusted: true })]
  });
  const launch = computeSalesBonusForRep({
    rep,
    weekStart: SALES_BONUS_LAUNCH_WEEK_START,
    programs: [activeProgram],
    rules: [rule],
    orders: [order("launch")]
  });

  assert.equal(preLaunch.earnedSoFar, 0);
  assert.equal(preLaunch.manualAdjustments, 0);
  assert.equal(preLaunch.rules[0]?.active, false);
  assert.equal(launch.earnedSoFar, 400);
});

test("payroll week collection starts at sales bonus launch week", () => {
  assert.deepEqual(
    salesBonusWeekStartsForPeriod("2026-06-01", "2026-07-20"),
    ["2026-07-05", "2026-07-12", "2026-07-19"]
  );
});

test("attributeRuleEarningsToOrders: upfront_percent recovers each order's own exact share", () => {
  const rule: SalesBonusRule = {
    id: "upfront",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "Full upfront payment commission",
    type: "upfront_percent",
    status: "active",
    config: { percent: 5 },
    display_order: 30
  };
  const result = run([rule], [
    order("small", { amount: 20_000, full_upfront_paid: true }),
    order("big", { amount: 30_000, full_upfront_paid: true })
  ]);
  const orderAmountById = new Map([["small", 20_000], ["big", 30_000]]);
  const map = attributeRuleEarningsToOrders(result.rules[0]!, orderAmountById);

  assert.equal(map.get("small"), 1_000);
  assert.equal(map.get("big"), 1_500);
  assert.equal([...map.values()].reduce((s, a) => s + a, 0), result.rules[0]!.earnedAmount);
});

test("attributeRuleEarningsToOrders: delivery_rate_per_delivered splits the exact flat rate evenly", () => {
  const rule: SalesBonusRule = {
    id: "delivery",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "Delivery-rate pay boost",
    type: "delivery_rate_per_delivered",
    status: "active",
    config: { minOrders: 50, targetRatePercent: 70, fallbackPerDelivered: 200, qualifiedPerDelivered: 400 },
    display_order: 40
  };
  const result = run([rule], [
    ...Array.from({ length: 35 }, (_, index) => order(`d${index}`)),
    ...Array.from({ length: 15 }, (_, index) => order(`p${index}`, { status: "Confirmed" }))
  ]);
  const map = attributeRuleEarningsToOrders(result.rules[0]!, new Map());

  assert.equal(map.size, 35);
  assert.ok([...map.values()].every((amount) => amount === 400));
  assert.equal([...map.values()].reduce((s, a) => s + a, 0), result.rules[0]!.earnedAmount);
});

test("attributeRuleEarningsToOrders: step-function rule types even-split the flat payout across all qualifying orders", () => {
  const rule: SalesBonusRule = {
    id: "upgrade",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "Upgrade 5 customers",
    type: "upgrade_count",
    status: "active",
    config: { fromQty: 3, toQtyMin: 4, targetCount: 5, amount: 2_000 },
    display_order: 10
  };
  const result = run([rule], Array.from({ length: 5 }, (_, index) => order(`u${index}`, {
    upsell_from_qty: 3,
    upsell_to_qty: 4
  })));
  const map = attributeRuleEarningsToOrders(result.rules[0]!, new Map());

  assert.equal(map.size, 5);
  assert.ok([...map.values()].every((amount) => amount === 400));
  assert.equal([...map.values()].reduce((s, a) => s + a, 0), 2_000);
});

test("attributeRuleEarningsToOrders: every_target_count repeat mode still splits across ALL qualifying orders, not just the first target", () => {
  const rule: SalesBonusRule = {
    id: "upgrade-repeat",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "Upgrade repeat bonus",
    type: "upgrade_count",
    status: "active",
    config: { fromQty: 3, toQtyMin: 4, targetCount: 2, amount: 1_000, repeatMode: "every_target_count" },
    display_order: 10
  };
  const result = run([rule], Array.from({ length: 5 }, (_, index) => order(`u${index}`, {
    upsell_from_qty: 3,
    upsell_to_qty: 4
  })));
  // floor(5/2) * 1000 = 2000 earned, but all 5 qualifying orders drove it.
  assert.equal(result.rules[0]!.earnedAmount, 2_000);
  const map = attributeRuleEarningsToOrders(result.rules[0]!, new Map());

  assert.equal(map.size, 5);
  assert.equal([...map.values()].reduce((s, a) => s + a, 0), 2_000);
});

test("attributeRuleEarningsToOrders: inactive rule or zero earnings yields an empty map", () => {
  const rule: SalesBonusRule = {
    id: "upgrade",
    org_id: "org-1",
    program_id: activeProgram.id,
    name: "Upgrade 5 customers",
    type: "upgrade_count",
    status: "active",
    config: { fromQty: 3, toQtyMin: 4, targetCount: 5, amount: 2_000 },
    display_order: 10
  };
  // Only 2 of 5 needed - qualifiedOrderIds is non-empty but earnedAmount is 0.
  const partial = run([rule], Array.from({ length: 2 }, (_, index) => order(`u${index}`, {
    upsell_from_qty: 3,
    upsell_to_qty: 4
  })));
  assert.ok(partial.rules[0]!.qualifiedOrderIds.length > 0);
  assert.equal(attributeRuleEarningsToOrders(partial.rules[0]!, new Map()).size, 0);

  // Paused program - active is false even with qualifying orders.
  const pausedProgram: SalesBonusProgram = { ...activeProgram, id: "paused-program", status: "paused" };
  const pausedRule: SalesBonusRule = { ...rule, program_id: pausedProgram.id };
  const paused = computeSalesBonusForRep({
    rep,
    weekStart: SALES_BONUS_LAUNCH_WEEK_START,
    programs: [pausedProgram],
    rules: [pausedRule],
    orders: Array.from({ length: 5 }, (_, index) => order(`p${index}`, { upsell_from_qty: 3, upsell_to_qty: 4 }))
  });
  assert.equal(paused.rules[0]!.active, false);
  assert.equal(attributeRuleEarningsToOrders(paused.rules[0]!, new Map()).size, 0);
});
