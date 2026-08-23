import { expect, test } from "@playwright/test";
import {
  CRITICAL_ORDER_DAYS, isStaleOrder, STALE_ORDER_DAYS, staleOrderVerdict, summariseStaleOrders
} from "../src/lib/stale-orders";

const NOW = new Date("2026-08-23T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

test("an order inside the seven-day window is left alone", () => {
  const verdict = staleOrderVerdict({ status: "Confirmed", createdAt: daysAgo(3) }, NOW);
  expect(verdict.tier).toBe("none");
  expect(verdict.ageDays).toBe(3);
});

test("exactly seven days is still not stale - the rule is MORE than seven", () => {
  expect(staleOrderVerdict({ status: "Confirmed", createdAt: daysAgo(STALE_ORDER_DAYS) }, NOW).tier).toBe("none");
  expect(staleOrderVerdict({ status: "Confirmed", createdAt: daysAgo(8) }, NOW).tier).toBe("overdue");
});

test("a stuck order reports how far past the line it is", () => {
  const verdict = staleOrderVerdict({ status: "New", createdAt: daysAgo(10) }, NOW);
  expect(verdict.tier).toBe("overdue");
  expect(verdict.ageDays).toBe(10);
  expect(verdict.daysOverdue).toBe(3);
  expect(verdict.reason).toContain("Failed Delivery");
});

test("two weeks or more is abandoned, not merely late", () => {
  expect(staleOrderVerdict({ status: "Dispatched", createdAt: daysAgo(CRITICAL_ORDER_DAYS) }, NOW).tier).toBe("critical");
  expect(staleOrderVerdict({ status: "Dispatched", createdAt: daysAgo(30) }, NOW).tier).toBe("critical");
});

// Pulsing at a rep who already did the right thing turns the signal into wallpaper.
test("a future promised date suppresses the warning entirely", () => {
  const verdict = staleOrderVerdict(
    { status: "Postponed", createdAt: daysAgo(20), scheduledAt: inDays(2) }, NOW);
  expect(verdict.tier).toBe("none");
  expect(verdict.heldByPromise).toBe(true);
});

// A promise made and broken is worse than no promise.
test("a promised date that has passed does NOT suppress it", () => {
  const verdict = staleOrderVerdict(
    { status: "Postponed", createdAt: daysAgo(20), scheduledAt: daysAgo(4) }, NOW);
  expect(verdict.tier).toBe("critical");
  expect(verdict.reason).toContain("Promised date passed");
});

test("a fresh order with a passed promise is still inside its window", () => {
  const verdict = staleOrderVerdict(
    { status: "Confirmed", createdAt: daysAgo(2), scheduledAt: daysAgo(1) }, NOW);
  expect(verdict.tier).toBe("none");
});

test("delivered, cancelled and failed orders never pulse", () => {
  for (const status of ["Delivered", "Cancelled", "Failed"]) {
    expect(staleOrderVerdict({ status, createdAt: daysAgo(60) }, NOW).tier).toBe("none");
  }
});

test("every open status is eligible, not just one", () => {
  for (const status of ["New", "Confirmed", "In Process", "Dispatched", "Postponed"]) {
    expect(isStaleOrder({ status, createdAt: daysAgo(12) }, NOW)).toBe(true);
  }
});

test("an order with no created date is never flagged rather than flagged forever", () => {
  expect(staleOrderVerdict({ status: "New", createdAt: null }, NOW).tier).toBe("none");
  expect(staleOrderVerdict({ status: "New", createdAt: "not a date" }, NOW).tier).toBe("none");
});

test("a nonsense scheduled date does not suppress a genuinely stuck order", () => {
  const verdict = staleOrderVerdict(
    { status: "New", createdAt: daysAgo(20), scheduledAt: "rubbish" }, NOW);
  expect(verdict.tier).toBe("critical");
});

test("the summary counts orders and names the worst age", () => {
  const summary = summariseStaleOrders([
    { status: "New", createdAt: daysAgo(9) },
    { status: "Confirmed", createdAt: daysAgo(23) },
    { status: "Dispatched", createdAt: daysAgo(15) },
    { status: "Confirmed", createdAt: daysAgo(2) },
    { status: "Delivered", createdAt: daysAgo(40) },
    { status: "Postponed", createdAt: daysAgo(30), scheduledAt: inDays(1) }
  ], NOW);
  expect(summary.total).toBe(3);
  expect(summary.overdue).toBe(1);
  expect(summary.critical).toBe(2);
  expect(summary.oldestDays).toBe(23);
});

test("nothing stuck reports zero rather than an empty-looking total", () => {
  const summary = summariseStaleOrders([{ status: "Confirmed", createdAt: daysAgo(1) }], NOW);
  expect(summary.total).toBe(0);
  expect(summary.oldestDays).toBe(0);
});
