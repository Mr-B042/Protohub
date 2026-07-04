import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSalesBonusForRep,
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
  starts_on: "2026-06-28",
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
  weekStart: "2026-06-28",
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
