import { expect, test } from "@playwright/test";
import {
  costMovedSince, indexCostChanges, ProductCostChange, unitCostAsOf
} from "../src/lib/product-cost-history";

const shelf = (createdAt: string, previous: number, next: number): ProductCostChange => ({
  productId: "shelf", previousUnitCost: previous, newUnitCost: next, createdAt
});

test("with no cost changes the current cost applies to every day", () => {
  expect(unitCostAsOf(12_000, [], "2026-08-21")).toBe(12_000);
  expect(unitCostAsOf(12_000, [], "2020-01-01")).toBe(12_000);
});

test("a day BEFORE the change gets the old cost, not today's", () => {
  const changes = [shelf("2026-08-23T04:50:58Z", 11_500, 12_000)];
  expect(unitCostAsOf(12_000, changes, "2026-08-21")).toBe(11_500);
});

test("a day AFTER the change gets the new cost", () => {
  const changes = [shelf("2026-08-23T04:50:58Z", 11_500, 12_000)];
  expect(unitCostAsOf(12_000, changes, "2026-08-25")).toBe(12_000);
});

test("a change made on the day itself is already in force", () => {
  const changes = [shelf("2026-08-23T04:50:58Z", 11_500, 12_000)];
  expect(unitCostAsOf(12_000, changes, "2026-08-23")).toBe(12_000);
});

test("several changes step back to the one in force at the time", () => {
  const changes = [
    shelf("2026-03-01T00:00:00Z", 9_000, 10_000),
    shelf("2026-06-01T00:00:00Z", 10_000, 11_500),
    shelf("2026-08-23T04:50:58Z", 11_500, 12_000)
  ];
  expect(unitCostAsOf(12_000, changes, "2026-01-15")).toBe(9_000);
  expect(unitCostAsOf(12_000, changes, "2026-04-15")).toBe(10_000);
  expect(unitCostAsOf(12_000, changes, "2026-07-15")).toBe(11_500);
  expect(unitCostAsOf(12_000, changes, "2026-09-15")).toBe(12_000);
});

test("the log is not assumed to arrive in order", () => {
  const changes = [
    shelf("2026-08-23T04:50:58Z", 11_500, 12_000),
    shelf("2026-03-01T00:00:00Z", 9_000, 10_000),
    shelf("2026-06-01T00:00:00Z", 10_000, 11_500)
  ];
  expect(unitCostAsOf(12_000, changes, "2026-01-15")).toBe(9_000);
});

test("a missing day falls back to the current cost rather than guessing", () => {
  const changes = [shelf("2026-08-23T04:50:58Z", 11_500, 12_000)];
  expect(unitCostAsOf(12_000, changes, "")).toBe(12_000);
  expect(unitCostAsOf(12_000, changes, null)).toBe(12_000);
  expect(unitCostAsOf(12_000, changes, undefined)).toBe(12_000);
});

test("a full ISO timestamp works as well as a bare day", () => {
  const changes = [shelf("2026-08-23T04:50:58Z", 11_500, 12_000)];
  expect(unitCostAsOf(12_000, changes, "2026-08-21T09:14:00Z")).toBe(11_500);
});

test("a cost cut reads back just as well as a rise", () => {
  const changes = [shelf("2026-08-23T04:50:58Z", 12_000, 9_000)];
  expect(unitCostAsOf(9_000, changes, "2026-08-21")).toBe(12_000);
});

test("a non-numeric cost is treated as zero, never NaN", () => {
  expect(unitCostAsOf(Number.NaN, [], "2026-08-21")).toBe(0);
  const changes = [{ ...shelf("2026-08-23T00:00:00Z", 0, 12_000), previousUnitCost: Number.NaN }];
  expect(unitCostAsOf(12_000, changes, "2026-08-21")).toBe(0);
});

test("changes are indexed per product and never cross over", () => {
  const index = indexCostChanges([
    shelf("2026-08-23T04:50:58Z", 11_500, 12_000),
    { productId: "brusher", previousUnitCost: 400, newUnitCost: 500, createdAt: "2026-05-01T00:00:00Z" }
  ]);
  expect(index.get("shelf")).toHaveLength(1);
  expect(index.get("brusher")).toHaveLength(1);
  expect(unitCostAsOf(500, index.get("brusher") ?? [], "2026-04-01")).toBe(400);
  expect(unitCostAsOf(12_000, index.get("shelf") ?? [], "2026-04-01")).toBe(11_500);
});

test("rows with no product id are dropped rather than bucketed under blank", () => {
  const index = indexCostChanges([{ productId: "", previousUnitCost: 1, newUnitCost: 2, createdAt: "2026-01-01" }]);
  expect(index.size).toBe(0);
});

test("costMovedSince flags a figure that is historical", () => {
  const changes = [shelf("2026-08-23T04:50:58Z", 11_500, 12_000)];
  expect(costMovedSince(changes, "2026-08-21")).toBe(true);
  expect(costMovedSince(changes, "2026-08-25")).toBe(false);
  expect(costMovedSince([], "2026-08-21")).toBe(false);
  expect(costMovedSince(changes, null)).toBe(false);
});
