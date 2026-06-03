import test from "node:test";
import assert from "node:assert/strict";
import {
  computeBatchEconomics,
  type CostTier,
  type StatusTierEntry,
  type BatchInputs,
  type BatchOrder
} from "./batch-economics.js";

const TIERS: CostTier[] = [
  { tierKey: "delivered",           label: "Delivered",             earnsRevenue: true,  chargeAd: true, chargeProduct: true,  chargeDelivery: true,  sortOrder: 0 },
  { tierKey: "dispatched_failed",   label: "Dispatched — failed",   earnsRevenue: false, chargeAd: true, chargeProduct: false, chargeDelivery: true,  sortOrder: 1 },
  { tierKey: "pre_dispatch_failed", label: "Pre-dispatch — failed", earnsRevenue: false, chargeAd: true, chargeProduct: false, chargeDelivery: false, sortOrder: 2 }
];
const STATUS_MAP: StatusTierEntry[] = [
  { orderStatus: "Delivered",  tierKey: "delivered",           isOpen: false },
  { orderStatus: "Dispatched", tierKey: "dispatched_failed",   isOpen: true },
  { orderStatus: "Failed",     tierKey: "dispatched_failed",   isOpen: false },
  { orderStatus: "New",        tierKey: "pre_dispatch_failed", isOpen: true },
  { orderStatus: "Confirmed",  tierKey: "pre_dispatch_failed", isOpen: true },
  { orderStatus: "In Process", tierKey: "pre_dispatch_failed", isOpen: true },
  { orderStatus: "Postponed",  tierKey: "pre_dispatch_failed", isOpen: true },
  { orderStatus: "Cancelled",  tierKey: "pre_dispatch_failed", isOpen: false }
];
const BATCH: BatchInputs = { adSpend: 10000, productCostPerSet: 1000, deliveryCostPerOrder: 500, status: "open" };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.001, `${a} !~= ${b}`);

test("all-delivered: revenue, product (set-weighted), delivered delivery, net", () => {
  const orders: BatchOrder[] = [
    { status: "Delivered", amount: 5000, sets: 1 },
    { status: "Delivered", amount: 5000, sets: 1 },
    { status: "Delivered", amount: 5000, sets: 1 }
  ];
  const e = computeBatchEconomics(orders, BATCH, TIERS, STATUS_MAP);
  const w = e.worstCase;
  assert.equal(w.revenue, 15000);
  assert.equal(w.productCost, 3000);          // 3 sets x 1000
  assert.equal(w.deliveredDelivery, 1500);    // 3 x 500
  assert.equal(w.wastedDelivery, 0);
  assert.equal(w.adCost, 10000);
  assert.equal(w.totalCost, 14500);
  assert.equal(w.netProfit, 500);
  close(w.trueDeliveryRate, 1);
  assert.equal(w.aovValue, 5000);
  assert.equal(w.aovSets, 1);
});

test("mixed tiers: DISPATCHED_FAILED charges WASTED delivery, PRE_DISPATCH_FAILED charges nothing", () => {
  const orders: BatchOrder[] = [
    { status: "Delivered", amount: 5000, sets: 1 },
    { status: "Delivered", amount: 5000, sets: 1 },
    { status: "Failed",    amount: 5000, sets: 1 }, // dispatched-failed -> wasted delivery, no revenue/product
    { status: "Cancelled", amount: 5000, sets: 1 }  // pre-dispatch-failed -> nothing but ad
  ];
  const w = computeBatchEconomics(orders, BATCH, TIERS, STATUS_MAP).worstCase;
  assert.equal(w.revenue, 10000);
  assert.equal(w.deliveredOrders, 2);
  assert.equal(w.productCost, 2000);          // only delivered sets
  assert.equal(w.deliveredDelivery, 1000);    // 2 delivered
  assert.equal(w.wastedDelivery, 500);        // 1 dispatched-failed (Cancelled adds none)
  assert.equal(w.totalCost, 13500);           // 10000 ad + 2000 + 1000 + 500
  assert.equal(w.netProfit, -3500);
  close(w.trueDeliveryRate, 0.5);
  close(w.failureRate, 0.5);
});

test("worst-case (headline) is the floor; best-case lifts only OPEN orders to delivered", () => {
  const orders: BatchOrder[] = [
    { status: "Delivered", amount: 5000, sets: 1 },
    { status: "New",       amount: 5000, sets: 1 }, // open -> best-case delivers
    { status: "Cancelled", amount: 5000, sets: 1 }  // resolved failure -> stays failed
  ];
  const e = computeBatchEconomics(orders, BATCH, TIERS, STATUS_MAP);
  assert.equal(e.worstCase.deliveredOrders, 1);
  assert.equal(e.worstCase.revenue, 5000);
  assert.equal(e.bestCase.deliveredOrders, 2);     // New assumed delivered
  assert.equal(e.bestCase.revenue, 10000);
  assert.ok(e.bestCase.netProfit > e.worstCase.netProfit);
});

test("closed batch: writeOffCount = orders that never delivered", () => {
  const orders: BatchOrder[] = [
    { status: "Delivered", amount: 5000, sets: 1 },
    { status: "Failed",    amount: 5000, sets: 1 },
    { status: "Cancelled", amount: 5000, sets: 1 }
  ];
  const e = computeBatchEconomics(orders, { ...BATCH, status: "closed" }, TIERS, STATUS_MAP);
  assert.equal(e.closed, true);
  assert.equal(e.writeOffCount, 2);
});

test("zero orders: no NaN / divide-by-zero, ad still sunk", () => {
  const e = computeBatchEconomics([], BATCH, TIERS, STATUS_MAP);
  assert.equal(e.worstCase.totalOrders, 0);
  assert.equal(e.worstCase.netProfit, -10000);   // ad spend lost
  assert.equal(e.worstCase.profitPerOrder, 0);
  assert.equal(e.worstCase.cpp, 0);
  assert.equal(e.worstCase.trueDeliveryRate, 0);
  assert.equal(e.worstCase.aovSets, 0);
  assert.equal(e.breakevenAovValue, null);
});

test("N-tier extensibility: a custom 4th tier needs no code change", () => {
  // "Returned — restocked": no revenue, product recovered (no product cost), delivery wasted.
  const tiers: CostTier[] = [
    ...TIERS,
    { tierKey: "returned_restocked", label: "Returned — restocked", earnsRevenue: false, chargeAd: true, chargeProduct: false, chargeDelivery: true, sortOrder: 3 }
  ];
  const statusMap: StatusTierEntry[] = [
    ...STATUS_MAP,
    { orderStatus: "Returned", tierKey: "returned_restocked", isOpen: false }
  ];
  const orders: BatchOrder[] = [{ status: "Returned", amount: 5000, sets: 2 }];
  const w = computeBatchEconomics(orders, BATCH, tiers, statusMap).worstCase;
  assert.equal(w.revenue, 0);
  assert.equal(w.productCost, 0);     // restocked -> recovered
  assert.equal(w.wastedDelivery, 500);
  assert.equal(w.tierCounts["returned_restocked"], 1);
});

test("breakeven AOV = min revenue per delivered order for net >= 0", () => {
  const orders: BatchOrder[] = [
    { status: "Delivered", amount: 5000, sets: 1 },
    { status: "Delivered", amount: 5000, sets: 1 },
    { status: "Delivered", amount: 5000, sets: 1 }
  ];
  const e = computeBatchEconomics(orders, BATCH, TIERS, STATUS_MAP);
  // totalCost 14500 / 3 delivered = 4833.33; current aovValue 5000 > breakeven -> profitable
  close(e.breakevenAovValue!, 14500 / 3);
  assert.ok(e.worstCase.aovValue > e.breakevenAovValue!);
  assert.ok(e.worstCase.netProfit > 0);
});

test("unmapped status earns nothing and costs nothing but ad (counted as unmapped)", () => {
  const orders: BatchOrder[] = [{ status: "SomeWeirdStatus", amount: 5000, sets: 1 }];
  const w = computeBatchEconomics(orders, BATCH, TIERS, STATUS_MAP).worstCase;
  assert.equal(w.revenue, 0);
  assert.equal(w.productCost, 0);
  assert.equal(w.deliveredDelivery, 0);
  assert.equal(w.wastedDelivery, 0);
  assert.equal(w.tierCounts["unmapped"], 1);
});

test("add-on COGS is charged only on product-charging (delivered) tiers, on TOP of per-set cost", () => {
  const orders: BatchOrder[] = [
    { status: "Delivered", amount: 5000, sets: 1, addonCost: 800 }, // delivered -> add-on charged
    { status: "Failed",    amount: 5000, sets: 1, addonCost: 800 }, // dispatched-failed -> no product, no add-on (delivery wasted)
    { status: "New",       amount: 5000, sets: 1, addonCost: 800 }  // pre-dispatch open -> nothing but ad (worst); delivered in best
  ];
  const e = computeBatchEconomics(orders, BATCH, TIERS, STATUS_MAP);
  const w = e.worstCase;
  assert.equal(w.addonCost, 800);                 // only the delivered order
  assert.equal(w.productCost, 1000);              // 1 delivered set x 1000 (add-on is ON TOP)
  assert.equal(w.totalCost, 10000 + 1000 + 800 + 500 + 500); // ad + product + add-on + delivered-delivery + wasted
  assert.equal(w.netProfit, 5000 - 12800);
  assert.equal(e.bestCase.addonCost, 1600);       // New re-tiered to delivered -> its add-on now charged; Failed stays failed
});

test("breakeven AOV includes add-on COGS in total cost", () => {
  const orders: BatchOrder[] = [
    { status: "Delivered", amount: 6000, sets: 1, addonCost: 500 },
    { status: "Delivered", amount: 6000, sets: 1, addonCost: 500 }
  ];
  const e = computeBatchEconomics(orders, BATCH, TIERS, STATUS_MAP);
  assert.equal(e.worstCase.addonCost, 1000);
  // totalCost = ad 10000 + product 2000 + add-on 1000 + delivery 1000 = 14000; / 2 delivered = 7000
  close(e.breakevenAovValue!, 7000);
});

test("absent addonCost defaults to 0 (back-compat with set-only orders)", () => {
  const orders: BatchOrder[] = [{ status: "Delivered", amount: 5000, sets: 1 }];
  assert.equal(computeBatchEconomics(orders, BATCH, TIERS, STATUS_MAP).worstCase.addonCost, 0);
});

test("add-on revenue is split out of total revenue (bonus value, delivered orders only)", () => {
  const orders: BatchOrder[] = [
    { status: "Delivered", amount: 5000, sets: 1, addonRevenue: 1500, addonCost: 800 },
    { status: "Failed",    amount: 5000, sets: 1, addonRevenue: 1500, addonCost: 800 } // not delivered -> no revenue at all
  ];
  const w = computeBatchEconomics(orders, BATCH, TIERS, STATUS_MAP).worstCase;
  assert.equal(w.revenue, 5000);                  // total delivered revenue (incl add-on)
  assert.equal(w.addonRevenue, 1500);             // the bonus portion
  assert.equal(w.revenue - w.addonRevenue, 3500); // implied main-product revenue
});

test("addonRevenue is capped at the order amount and defaults to 0", () => {
  const over: BatchOrder[] = [{ status: "Delivered", amount: 5000, sets: 1, addonRevenue: 9999 }];
  assert.equal(computeBatchEconomics(over, BATCH, TIERS, STATUS_MAP).worstCase.addonRevenue, 5000); // capped at amount
  const none: BatchOrder[] = [{ status: "Delivered", amount: 5000, sets: 1 }];
  assert.equal(computeBatchEconomics(none, BATCH, TIERS, STATUS_MAP).worstCase.addonRevenue, 0);    // default
});
