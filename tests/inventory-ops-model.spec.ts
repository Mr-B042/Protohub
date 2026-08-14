import { expect, test } from "@playwright/test";
import type { OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "../src/pages/InventoryLogisticsOperationsPage";
import { buildProductRows, buildStateRows } from "../src/pages/inventory-ops-model";

const recent = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

test("inventory operations uses exact components, date windows, reservations and incoming stock", () => {
  const products: OpsProduct[] = [
    { id: "brush", name: "Brush", warehouseStock: 0, agentStock: 10, reorderPoint: 5 },
    { id: "mop", name: "Mop", warehouseStock: 0, agentStock: 5, reorderPoint: 2 },
  ];
  const hubs: OpsStateHub[] = [{
    state: "Lagos State", agentName: "Lagos Hub", stocks: [
      { productId: "brush", quantity: 10 },
      { productId: "mop", quantity: 5 },
    ],
  }];
  const orders: OpsOrder[] = [
    {
      state: "Lagos", quantity: 1, status: "Delivered", createdAt: recent(1), deliveredAt: recent(1),
      inventoryItems: [{ productId: "brush", quantity: 2 }, { productId: "mop", quantity: 1 }],
    },
    {
      state: "Lagos", quantity: 1, status: "Delivered", createdAt: recent(30), deliveredAt: recent(30),
      inventoryItems: [{ productId: "brush", quantity: 50 }],
    },
    {
      state: "Lagos", quantity: 1, status: "Ready", createdAt: recent(0),
      inventoryItems: [{ productId: "brush", quantity: 3 }],
    },
  ];
  const waybills: OpsWaybill[] = [{
    id: "WB-1", productId: "brush", productName: "Brush", quantity: 4, fee: 0,
    carrier: "Carrier", from: "Warehouse", to: "Lagos", toState: "Lagos", dateSent: recent(0), status: "In Transit",
  }];

  const states = buildStateRows(hubs, orders, waybills, 7, 3, 7);
  const lagos = states[0];
  expect(states).toHaveLength(1);
  expect(lagos.totalUnits).toBe(15);
  expect(lagos.openUnitsByProductId.get("brush")).toBe(3);
  expect(lagos.dailySalesByProductId.get("brush")).toBeCloseTo(2 / 7, 6);
  expect(lagos.dailySalesByProductId.get("mop")).toBeCloseTo(1 / 7, 6);
  expect(lagos.inTransitByProductId.get("brush")).toBe(4);

  const rows = buildProductRows(products, states, orders, 7, 3, 7, waybills);
  const brush = rows.find((row) => row.id === "brush")!;
  expect(brush.reserved).toBe(3);
  expect(brush.available).toBe(7);
  expect(brush.inTransit).toBe(4);
  expect(brush.dailySales).toBeCloseTo(2 / 7, 8);
  expect(brush.unitsNeeded14d).toBe(0);
});

test("FCT and Abuja labels share one state bucket", () => {
  const hubs: OpsStateHub[] = [
    { state: "FCT Abuja", agentName: "Hub A", stocks: [{ productId: "p", quantity: 5 }] },
    { state: "Abuja, Nigeria", agentName: "Hub B", stocks: [{ productId: "p", quantity: 7 }] },
  ];
  const states = buildStateRows(hubs, [], [], 7, 3, 7);
  expect(states).toHaveLength(1);
  expect(states[0].state).toBe("FCT Abuja");
  expect(states[0].totalUnits).toBe(12);
  expect(states[0].agents).toBe(2);
});

test("state restock need is product-specific and subtracts stock already in transit", () => {
  const products: OpsProduct[] = [{ id: "p", name: "Product", warehouseStock: 0, agentStock: 4, reorderPoint: 2 }];
  const hubs: OpsStateHub[] = [{ state: "Edo", agentName: "Hub", stocks: [{ productId: "p", quantity: 4 }] }];
  const orders: OpsOrder[] = [{
    state: "Edo", quantity: 14, status: "Delivered", createdAt: recent(1), deliveredAt: recent(1),
    inventoryItems: [{ productId: "p", quantity: 14 }],
  }, {
    state: "Edo", quantity: 1, status: "Confirmed", createdAt: recent(0),
    inventoryItems: [{ productId: "p", quantity: 1 }],
  }];
  const waybills: OpsWaybill[] = [{
    id: "WB-2", productId: "p", productName: "Product", quantity: 2, fee: 0,
    carrier: "Carrier", from: "Warehouse", to: "Edo", toState: "Edo", dateSent: recent(0), status: "Shipped",
  }];
  const states = buildStateRows(hubs, orders, waybills, 7, 3, 7);
  const product = buildProductRows(products, states, orders, 7, 3, 7, waybills)[0];
  expect(product.stateNeeds14d).toEqual([{ state: "Edo", units: 23 }]);
  expect(product.unitsNeeded14d).toBe(23);
});

test("stock with no delivered demand is reported as no data, not healthy", () => {
  const products: OpsProduct[] = [{ id: "slow", name: "Slow Product", warehouseStock: 0, agentStock: 9, reorderPoint: 2 }];
  const hubs: OpsStateHub[] = [{ state: "Ogun", agentName: "Hub", stocks: [{ productId: "slow", quantity: 9 }] }];
  const states = buildStateRows(hubs, [], [], 30, 3, 7);
  expect(states[0].status).toBe("No Data");
  expect(buildProductRows(products, states, [], 30, 3, 7)[0].status).toBe("No Data");
});

test("category-scoped state totals exclude every other product component", () => {
  const hubs: OpsStateHub[] = [{
    state: "Lagos", agentName: "Hub", stocks: [
      { productId: "cleaning", quantity: 10 },
      { productId: "health", quantity: 40 },
    ],
  }];
  const orders: OpsOrder[] = [{
    state: "Lagos", quantity: 1, status: "Ready", createdAt: recent(0),
    inventoryItems: [{ productId: "cleaning", quantity: 2 }, { productId: "health", quantity: 5 }],
  }];
  const rows = buildStateRows(hubs, orders, [], 7, 3, 7, new Set(["cleaning"]));
  expect(rows).toHaveLength(1);
  expect(rows[0].totalUnits).toBe(10);
  expect(rows[0].openUnits).toBe(2);
  expect(rows[0].unitsByProductId.has("health")).toBe(false);
  expect(rows[0].openUnitsByProductId.has("health")).toBe(false);
});

test("slow but real demand keeps full precision for forecasts", () => {
  const products: OpsProduct[] = [{ id: "p", name: "Product", warehouseStock: 0, agentStock: 1, reorderPoint: 1 }];
  const hubs: OpsStateHub[] = [{ state: "Edo", agentName: "Hub", stocks: [{ productId: "p", quantity: 1 }] }];
  const orders: OpsOrder[] = [{
    state: "Edo", quantity: 1, status: "Delivered", createdAt: recent(10), deliveredAt: recent(10),
    inventoryItems: [{ productId: "p", quantity: 1 }],
  }];
  const states = buildStateRows(hubs, orders, [], 30, 3, 7);
  const product = buildProductRows(products, states, orders, 30, 3, 7)[0];
  expect(states[0].dailySales).toBeCloseTo(1 / 30, 8);
  expect(product.dailySales).toBeCloseTo(1 / 30, 8);
  expect(product.status).not.toBe("No Data");
});
