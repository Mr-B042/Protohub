import { expect, test } from "@playwright/test";
import {
  EMPTY_FILTERS, buildAgentRows, buildCostBook, buildStockPlan, forecastConfidence, waybillUnitsByState, worstProducts, buildProductRows, buildStateRows, figuresFor, filterOrders, previousPeriod, seriesOver,
  type TrendOrder
} from "../src/pages/product-trend/product-trend-model";

const order = (id: string, productId: string, state: string, status: string, amount = 0, extra: Partial<TrendOrder> = {}): TrendOrder => ({
  id, productId, state, agentId: extra.agentId ?? "", status, amount, units: extra.units ?? 1, createdKey: extra.createdKey ?? "2026-09-10",
  logisticsCost: extra.logisticsCost ?? 0, cogs: extra.cogs ?? 0, deliveredKey: extra.deliveredKey
});

test("net profit matches Finance: direct opex stays with its product, shared opex follows delivered sales", () => {
  const orders = [
    order("1", "rack", "Lagos", "Delivered", 30000, { cogs: 10000, logisticsCost: 3000 }),
    order("2", "rack", "Abuja", "Delivered", 10000, { cogs: 4000, logisticsCost: 2000 }),
    order("3", "shelf", "Lagos", "Delivered", 20000, { cogs: 8000, logisticsCost: 2000 }),
    order("4", "rack", "Lagos", "Failed", 30000)
  ];
  const expenses = [
    { amount: 6000, dateKey: "2026-09-05", productId: "rack", type: "Ad Spend" },
    { amount: 3000, dateKey: "2026-09-06", productId: null, type: "Salary" },
    { amount: 9999, dateKey: "2026-09-06", productId: null, type: "Delivery" }, // never counted: delivery is the order's own fee
    { amount: 5000, dateKey: "2026-10-01", productId: null, type: "Salary" } // outside the period
  ];
  const costs = buildCostBook(orders, expenses, "2026-09-01", "2026-09-30");
  const rack = figuresFor(orders.filter((o) => o.productId === "rack"), costs);
  // Finance: revenue 40000 - cogs 14000 - logistics 5000 - direct 6000 - shared 3000 × 40000/60000
  expect(rack.net).toBeCloseTo(40000 - 14000 - 5000 - 6000 - 2000, 6);
  expect(rack.rate).toBeCloseTo((2 / 3) * 100, 6);
  const shelf = figuresFor(orders.filter((o) => o.productId === "shelf"), costs);
  expect(shelf.net).toBeCloseTo(20000 - 8000 - 2000 - 1000, 6);
  // Every naira of running cost lands somewhere exactly once.
  const all = figuresFor(orders, costs);
  expect(all.runningCosts).toBeCloseTo(9000, 6);
  // A state carries its orders' shares: Lagos rack 30000/40000 of rack's 8000.
  const lagos = figuresFor(filterOrders(orders, { ...EMPTY_FILTERS, state: "Lagos" }), costs);
  expect(lagos.runningCosts).toBeCloseTo(6000 + 1000, 6);
});

test("a product with costs but no delivered order keeps the cost on its row", () => {
  const orders = [order("1", "rack", "Lagos", "New", 30000)];
  const costs = buildCostBook(orders, [{ amount: 4000, dateKey: "2026-09-02", productId: "rack", type: "Ad Spend" }], "2026-09-01", "2026-09-30");
  const rows = buildProductRows({
    products: [{ id: "rack", name: "Rack", active: true }], orders, previousOrders: [], costs, previousCosts: buildCostBook([], [], "2026-08-01", "2026-08-31"),
    hubs: [], from: "2026-09-01", to: "2026-09-30", wholeProduct: true
  });
  expect(rows[0].now.net).toBe(-4000);
});

test("orders count orders, units count pieces", () => {
  const orders = [order("1", "rack", "Lagos", "Delivered", 1, { units: 3 }), order("2", "rack", "Lagos", "New", 1, { units: 2 })];
  const figures = figuresFor(orders, buildCostBook(orders, [], "2026-09-01", "2026-09-30"));
  expect(figures.orders).toBe(2);
  expect(figures.units).toBe(5);
  expect(figures.unitsDelivered).toBe(3);
});

test("previous period is the same length just before", () => {
  expect(previousPeriod("2026-09-01", "2026-09-30")).toEqual({ from: "2026-08-02", to: "2026-08-31" });
  expect(previousPeriod("2026-10-11", "2026-10-17")).toEqual({ from: "2026-10-04", to: "2026-10-10" });
});

test("state rows add stock with agents and count active agents once", () => {
  const orders = [order("1", "rack", "Lagos", "Delivered", 10), order("2", "rack", "Lagos", "New", 10)];
  const costs = buildCostBook(orders, [], "2026-09-01", "2026-09-30");
  const rows = buildStateRows({
    orders, previousOrders: [], costs, previousCosts: costs, productId: "rack",
    hubs: [
      { agentId: "a", agentName: "A", state: "Lagos", active: true, stocks: [{ productId: "rack", quantity: 5 }, { productId: "mop", quantity: 9 }] },
      { agentId: "a", agentName: "A", state: "Lagos", active: true, stocks: [{ productId: "rack", quantity: 2 }] }
    ]
  });
  expect(rows[0].stockWithAgents).toBe(7);
  expect(rows[0].activeAgents).toBe(1);
  expect(rows[0].now.rate).toBe(50);
});

test("agents are only compared with peers when both sides have enough orders", () => {
  const many = (prefix: string, agentId: string, delivered: number, total: number) =>
    Array.from({ length: total }, (_, i) => order(`${prefix}${i}`, "rack", "Lagos", i < delivered ? "Delivered" : "Failed", 1, { agentId }));
  const orders = [...many("a", "A", 16, 20), ...many("b", "B", 10, 20), ...many("c", "C", 1, 3)];
  const costs = buildCostBook(orders, [], "2026-09-01", "2026-09-30");
  const rows = buildAgentRows({ orders, previousOrders: [], costs, previousCosts: costs, hubs: [], agents: [], productId: "all" });
  const a = rows.find((row) => row.agentId === "A")!;
  expect(a.vsPeers).toBeCloseTo(80 - (11 / 23) * 100, 6);
  expect(rows.find((row) => row.agentId === "C")!.vsPeers).toBeNull();
});

test("time series fills empty days with zero and leaves rate blank", () => {
  const orders = [order("1", "rack", "Lagos", "Delivered", 1, { createdKey: "2026-09-02" })];
  const rows = seriesOver({ all: orders }, "2026-09-01", "2026-09-03", "daily", "orders");
  expect(rows.map((row) => row.all)).toEqual([0, 1, 0]);
  expect(seriesOver({ all: orders }, "2026-09-01", "2026-09-03", "daily", "rate").map((row) => row.all)).toEqual([null, 100, null]);
});

test("stock plan serves waiting customers first and never hands out more than the warehouse has", () => {
  const orders = [
    ...Array.from({ length: 12 }, (_, i) => order(`a${i}`, "rack", "Abuja", i < 9 ? "Delivered" : "Confirmed", 1, { units: 1 })),
    ...Array.from({ length: 12 }, (_, i) => order(`l${i}`, "rack", "Lagos", i < 6 ? "Delivered" : "Cancelled", 1, { units: 1 }))
  ];
  const hubs = [
    { agentId: "x", agentName: "X", state: "Abuja", active: true, stocks: [{ productId: "rack", quantity: 1 }] },
    { agentId: "y", agentName: "Y", state: "Lagos", active: true, stocks: [{ productId: "rack", quantity: 30 }] }
  ];
  const plan = buildStockPlan({ orders, productId: "rack", hubs, days: 30, available: 10, netPerUnit: 1000 });
  const abuja = plan.rows.find((r) => r.state === "Abuja")!;
  expect(abuja.priority).toBe("Critical"); // 3 waiting, 1 in stock
  expect(plan.rows[0].state).toBe("Abuja");
  expect(abuja.need).toBe(Math.round(3 + 12 * 0.75 - 1));
  expect(plan.allocated).toBeLessThanOrEqual(10);
  expect(abuja.recommended).toBe(10);
  expect(plan.rows.find((r) => r.state === "Lagos")!.recommended).toBe(0);
  expect(plan.withDelivered).toBeGreaterThanOrEqual(plan.withoutDelivered);
});

test("average delivery time counts order day to delivered day", () => {
  const orders = [order("1", "rack", "Lagos", "Delivered", 1, { createdKey: "2026-09-01", deliveredKey: "2026-09-04" } as any), order("2", "rack", "Lagos", "Delivered", 1, { createdKey: "2026-09-01", deliveredKey: "2026-09-02" } as any)];
  expect(figuresFor(orders, buildCostBook(orders, [], "2026-09-01", "2026-09-30")).avgDeliveryDays).toBe(2);
});

test("forecast confidence: no precise forecast without the data", () => {
  const few = [order("1", "rack", "Lagos", "New", 1)];
  expect(forecastConfidence(few, 30).level).toBe("Insufficient Data");
  const plan = buildStockPlan({ orders: few, productId: "rack", hubs: [], days: 30, available: 10, netPerUnit: 0 });
  expect(plan.rows[0].forecast).toBe(0);
  expect(plan.forecastHigh).toBe(0);
  const steady = Array.from({ length: 90 }, (_, i) => order(`s${i}`, "rack", "Lagos", "New", 1, { createdKey: `2026-09-${String((i % 30) + 1).padStart(2, "0")}` }));
  expect(forecastConfidence(steady, 30).level).toBe("High");
});

test("the horizon scales the forecast", () => {
  const orders = Array.from({ length: 30 }, (_, i) => order(`h${i}`, "rack", "Lagos", "New", 1, { createdKey: `2026-09-${String(i + 1).padStart(2, "0")}` }));
  const week = buildStockPlan({ orders, productId: "rack", hubs: [], days: 30, available: 0, netPerUnit: 0, horizonDays: 7 });
  const quarter = buildStockPlan({ orders, productId: "rack", hubs: [], days: 30, available: 0, netPerUnit: 0, horizonDays: 90 });
  expect(week.rows[0].forecast).toBeCloseTo(7, 6);
  expect(quarter.rows[0].forecast).toBeCloseTo(90, 6);
});

test("waybills sent after approval are counted per state, by location first", () => {
  const hubs = [
    { agentId: "a", agentName: "A", state: "Lagos", active: true, stocks: [], locationId: "loc-lagos" },
    { agentId: "a", agentName: "A", state: "Oyo", active: true, stocks: [], locationId: "loc-oyo" }
  ];
  const waybills = [
    { id: "w1", product_id: null, quantity: 5, items: [{ productId: "rack", quantity: 5 }], to_agent_id: "a", to_agent_location_id: "loc-oyo", status: "In Transit", created_at: "2026-10-02T10:00:00Z", received_date: null },
    { id: "w2", product_id: "rack", quantity: 3, items: null, to_agent_id: "a", to_agent_location_id: "loc-lagos", status: "Received", created_at: "2026-10-03T10:00:00Z", received_date: "2026-10-04" },
    { id: "w3", product_id: "rack", quantity: 9, items: null, to_agent_id: "a", to_agent_location_id: "loc-lagos", status: "Received", created_at: "2026-09-01T10:00:00Z", received_date: "2026-09-02" }
  ];
  const byState = waybillUnitsByState(waybills, "rack", "2026-10-01T00:00:00Z", hubs);
  expect(byState.get("Oyo")).toEqual({ units: 5, waybills: ["w1"], received: 0 });
  expect(byState.get("Lagos")).toEqual({ units: 3, waybills: ["w2"], received: 3 });
});

test("worst products: rate needs enough orders, drop needs a real fall", () => {
  const mk = (id: string, delivered: number, total: number, before: number) => {
    const now = Array.from({ length: total }, (_, i) => order(`${id}${i}`, id, "Lagos", i < delivered ? "Delivered" : "Failed", 1000));
    const prev = Array.from({ length: before }, (_, i) => order(`${id}p${i}`, id, "Lagos", "Delivered", 1000));
    return { now, prev };
  };
  const a = mk("a", 4, 20, 30), b = mk("b", 9, 10, 10), c = mk("c", 0, 3, 0);
  const orders = [...a.now, ...b.now, ...c.now], previous = [...a.prev, ...b.prev];
  const costs = buildCostBook(orders, [], "2026-09-01", "2026-09-30");
  const rows = buildProductRows({ products: ["a", "b", "c"].map((id) => ({ id, name: id, active: true })), orders, previousOrders: previous, costs, previousCosts: costs, hubs: [], from: "2026-09-01", to: "2026-09-30", wholeProduct: true });
  const rate = worstProducts(rows, "rate", 50);
  expect(rate.map((w) => w.row.product.id)).toEqual(["a"]); // c has only 3 orders; b (90%) is above the 50% overall
  const drop = worstProducts(rows, "drop", 50);
  expect(drop.map((w) => w.row.product.id)).toEqual(["a"]); // b did not fall
  expect(drop[0].value).toBeCloseTo(-33.33, 1);
});
