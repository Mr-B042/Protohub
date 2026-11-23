import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStockIntel, deliveryStreak, restockUnits, routesFor, statusFor, shiftDay,
  type IntelDelivery, type IntelHub, type IntelInput
} from "./stock-intel-model.js";

const TODAY = "2026-11-21"; // a Saturday
const hub = (locationId: string, state: string, stock: Record<string, number>, agentName = locationId): IntelHub => ({
  locationId, agentId: `agent-${locationId}`, agentName, hubName: agentName, state,
  stock: new Map(Object.entries(stock).map(([p, q]) => [p, { quantity: q, defective: 0, missing: 0 }]))
});
/** `perDay` units delivered on each of the last 7 days. */
const week = (locationId: string, productId: string, perDay: number): IntelDelivery[] =>
  Array.from({ length: 7 }, (_, i) => ({ locationId, productId, units: perDay, dayKey: shiftDay(TODAY, -i), orderId: `${locationId}-${i}` }));
const base = (over: Partial<IntelInput>): IntelInput => ({
  today: TODAY, windowDays: 7, hubs: [], deliveries: [], reserves: [], inbound: [], leadSamples: [], routes: [], settings: [], warehouse: new Map(), ...over
});

test("Bright's restock example: 12 in stock, 4 a day, 4-day lead time, 8 safety -> Critical, send 24", () => {
  assert.equal(statusFor({ usable: 12, inTransit: 0, speed: 4, leadDays: 4, safetyDays: 2, reserved: 0, onShelf: 12 }), "Critical");
  assert.equal(restockUnits({ speed: 4, safetyUnits: 8, usable: 12, inTransit: 0, reservedShort: 0 }), 24);
  const result = buildStockIntel(base({ hubs: [hub("lagos4", "Lagos", { shelf: 12 })], deliveries: week("lagos4", "shelf", 4) }));
  const row = result.rows[0];
  assert.equal(row.status, "Critical");
  assert.equal(row.restock, 24);
  assert.equal(row.daysLeft, 3);
  assert.equal(row.leadSource, "default");
});

test("status follows each hub's own lead time", () => {
  const args = { usable: 20, inTransit: 0, speed: 4, safetyDays: 2, reserved: 0, onShelf: 20 }; // 5 days of stock
  assert.equal(statusFor({ ...args, leadDays: 2 }), "Watch");
  assert.equal(statusFor({ ...args, leadDays: 4 }), "Restock Soon");
  assert.equal(statusFor({ ...args, leadDays: 6 }), "Critical");
  assert.equal(statusFor({ ...args, leadDays: 0.5, speed: 1 }), "Healthy");
});

test("stock already on the way counts, so it is not ordered twice", () => {
  const result = buildStockIntel(base({ hubs: [hub("h", "Lagos", { p: 12 })], deliveries: week("h", "p", 4), inbound: [{ locationId: "h", productId: "p", units: 20 }] }));
  assert.equal(result.rows[0].restock, 4); // 28 + 8 - 12 - 20
  assert.equal(result.rows[0].status, "Watch"); // 32 units = 8 days; lead 4 + safety 2 + 3 watch days = 9
});

test("streak: days in a row, a Sunday with no delivery does not break it", () => {
  const days = new Set(["2026-11-21", "2026-11-20", "2026-11-19", "2026-11-17", "2026-11-16", "2026-11-14"]);
  assert.equal(deliveryStreak(days, TODAY), 3); // 18 Nov missing (Wednesday) breaks it
  const withSunday = new Set(["2026-11-24", "2026-11-23", "2026-11-21", "2026-11-20"]); // 22 Nov is a Sunday
  assert.equal(deliveryStreak(withSunday, "2026-11-24"), 4);
  assert.equal(deliveryStreak(new Set(["2026-11-20", "2026-11-19"]), TODAY), 2); // nothing yet today
});

test("measured lead time is the median of the hub's received waybills; the Owner's setting wins", () => {
  const input = base({
    hubs: [hub("h", "Edo", { p: 10 })], deliveries: week("h", "p", 1),
    leadSamples: [{ locationId: "h", days: 2, receivedKey: "2026-11-01" }, { locationId: "h", days: 6, receivedKey: "2026-11-05" }, { locationId: "h", days: 3, receivedKey: "2026-11-09" }]
  });
  assert.equal(buildStockIntel(input).rows[0].leadDays, 3);
  assert.equal(buildStockIntel(input).rows[0].leadSource, "measured");
  const set = buildStockIntel({ ...input, settings: [{ locationId: "h", productId: null, leadTimeDays: 7, safetyDays: 1 }] }).rows[0];
  assert.equal(set.leadDays, 7);
  assert.equal(set.safetyDays, 1);
  assert.equal(set.leadSource, "set");
});

test("Bright's hub example: Abuja 40 on hand, needs 15 itself + 35 for the north -> 10 short", () => {
  const north = ["Kano", "Kaduna", "Plateau", "Niger", "Benue"].map((state) => hub(`n-${state}`, state, { p: 0 }));
  const result = buildStockIntel(base({
    hubs: [hub("abuja", "FCT Abuja", { p: 40 }, "Abuja Hub"), ...north],
    // Abuja sells 1.5 a day -> 7 days 10.5 -> 11, safety 3 -> 14... use a clean 15 via settings.
    deliveries: week("abuja", "p", 1),
    settings: [{ locationId: "abuja", productId: null, leadTimeDays: 4, safetyDays: 8 }], // 7 + 8 = 15
    reserves: north.map((h) => ({ locationId: h.locationId, productId: "p", units: 7, orderId: h.locationId })), // each owes 7 -> 35
    routes: north.map((h) => ({ destState: h.state, productId: null, sourceState: "FCT Abuja", priority: 1 }))
  }));
  const risk = result.hubRisks.find((r) => r.sourceState === "FCT Abuja")!;
  assert.equal(risk.available, 40);
  assert.equal(risk.ownDemand, 15);
  assert.equal(risk.networkDemand, 35);
  assert.equal(risk.shortage, 10);
  assert.equal(risk.dependents.length, 5);
});

test("fallback: Ogun only gives what it can spare after its own week", () => {
  const result = buildStockIntel(base({
    hubs: [hub("ibadan", "Oyo", { p: 2 }, "Ibadan Agent"), hub("ogun", "Ogun", { p: 30 }, "Ogun Agent")],
    deliveries: [...week("ibadan", "p", 3), ...week("ogun", "p", 2)],
    routes: [{ destState: "Oyo", productId: null, sourceState: null, priority: 1 }, { destState: "Oyo", productId: null, sourceState: "Ogun", priority: 2 }]
  }));
  const ibadan = result.rows.find((r) => r.locationId === "ibadan")!;
  assert.equal(ibadan.status, "Critical");
  // Ogun: 30 − (14 own week + 4 safety) = 12 spare. Warehouse empty -> 12 from Ogun, not 30.
  const fromOgun = ibadan.sources.find((s) => s.locationId === "ogun")!;
  assert.equal(fromOgun.spare, 12);
  assert.equal(fromOgun.units, 12);
  assert.equal(result.fallbacks.length, 1);
  assert.equal(result.fallbacks[0].from.label, "Ogun Agent");
});

test("a product's own route replaces the general one; no route = main warehouse", () => {
  const routes = [
    { destState: "Kano", productId: null, sourceState: "FCT Abuja", priority: 1 },
    { destState: "Kano", productId: "rack", sourceState: null, priority: 1 }
  ];
  assert.equal(routesFor(routes, "Kano", "shelf")[0].sourceState, "FCT Abuja");
  assert.equal(routesFor(routes, "Kano", "rack")[0].sourceState, null);
  assert.equal(routesFor(routes, "Imo", "shelf")[0].sourceState, null);
});

test("open orders bigger than the shelf are Critical and counted as at-risk orders", () => {
  const result = buildStockIntel(base({ hubs: [hub("h", "Imo", { p: 1 })], reserves: [{ locationId: "h", productId: "p", units: 3, orderId: "o" }] }));
  assert.equal(result.rows[0].status, "Critical");
  assert.equal(result.rows[0].atRiskUnits, 2);
  assert.equal(result.rows[0].restock, 2);
});
