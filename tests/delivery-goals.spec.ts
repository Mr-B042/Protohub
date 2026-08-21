import { expect, test } from "@playwright/test";
import {
  deliveriesNeededFor,
  deliveryGoalMessages,
  deliveryGoalProgress,
  deliveryRatePct,
  resolveDeliveryGoals
} from "../src/lib/delivery-goals";

// ── How many more deliveries ──────────────────────────────

test("delivering does not change the denominator", () => {
  // 32 placed, 11 delivered, 60% target: 60% of 32 is 19.2, so 20 must land.
  expect(deliveriesNeededFor(32, 11, 60)).toBe(9);
});

test("a part order is rounded UP - you cannot deliver 19.2 orders", () => {
  expect(deliveriesNeededFor(32, 0, 60)).toBe(20);
  expect(deliveriesNeededFor(3, 0, 70)).toBe(3);
});

test("a met target needs nothing more, and never goes negative", () => {
  expect(deliveriesNeededFor(122, 86, 70)).toBe(0);
  expect(deliveriesNeededFor(10, 10, 50)).toBe(0);
});

test("no orders placed asks for nothing rather than dividing by zero", () => {
  expect(deliveriesNeededFor(0, 0, 65)).toBe(0);
  expect(deliveryRatePct(0, 0)).toBe(0);
});

test("the real card numbers work out", () => {
  // Home Cleaning Tools: 2 of 3 delivered, 65% met, one more for 70%.
  expect(deliveryRatePct(3, 2)).toBe(67);
  expect(deliveriesNeededFor(3, 2, 65)).toBe(0);
  expect(deliveriesNeededFor(3, 2, 70)).toBe(1);
});

// ── Progress shape ────────────────────────────────────────

test("a rate past the stretch target still fits on the bar", () => {
  // The bar must be able to draw "better than the goal", so the track extends
  // past the stretch marker instead of ending on it.
  const progress = deliveryGoalProgress(100, 95, 65, 70);
  expect(progress.stretchMet).toBe(true);
  expect(progress.barPct).toBeGreaterThan(progress.stretchMarkerPct);
  expect(progress.barPct).toBeLessThanOrEqual(100);
});

test("markers sit in order and inside the track", () => {
  const progress = deliveryGoalProgress(46, 18, 60, 65);
  expect(progress.primaryMarkerPct).toBeLessThan(progress.stretchMarkerPct);
  expect(progress.stretchMarkerPct).toBeLessThanOrEqual(100);
  expect(progress.barPct).toBeGreaterThanOrEqual(0);
});

test("a stretch target below the primary is pulled up, never drawn behind it", () => {
  const progress = deliveryGoalProgress(50, 20, 70, 40);
  expect(progress.stretchTarget).toBe(70);
  expect(progress.stretchMarkerPct).toBeGreaterThanOrEqual(progress.primaryMarkerPct);
});

test("a zero stretch target does not divide by zero", () => {
  const progress = deliveryGoalProgress(10, 5, 0, 0);
  expect(Number.isFinite(progress.barPct)).toBe(true);
  expect(progress.barPct).toBeLessThanOrEqual(100);
});

// ── Default vs custom ─────────────────────────────────────

test("no product row falls back to the company default", () => {
  const goals = resolveDeliveryGoals(null, 65, 70);
  expect(goals.useCustomGoals).toBe(false);
  expect(goals.primaryTarget).toBe(65);
  expect(goals.stretchTarget).toBe(70);
});

test("turning custom goals off returns to the company numbers", () => {
  const goals = resolveDeliveryGoals(
    { useCustomGoals: false, primaryTarget: 90, stretchTarget: 95, goalBasis: "month", showProgressBar: true },
    60, 75
  );
  expect(goals.primaryTarget).toBe(60);
  expect(goals.stretchTarget).toBe(75);
  // Basis and bar visibility stay the product's own choice either way.
  expect(goals.goalBasis).toBe("month");
});

test("custom goals win over the company default", () => {
  const goals = resolveDeliveryGoals(
    { useCustomGoals: true, primaryTarget: 80, stretchTarget: 90, goalBasis: "period", showProgressBar: true },
    65, 70
  );
  expect(goals.primaryTarget).toBe(80);
  expect(goals.stretchTarget).toBe(90);
});

test("a product following the default can still hide its own bar", () => {
  const goals = resolveDeliveryGoals({ useCustomGoals: false, showProgressBar: false }, 65, 70);
  expect(goals.showProgressBar).toBe(false);
  expect(goals.primaryTarget).toBe(65);
});

// ── Wording ───────────────────────────────────────────────

test("hitting the primary target reads as achieved, with the stretch still to go", () => {
  const messages = deliveryGoalMessages(deliveryGoalProgress(3, 2, 65, 70));
  expect(messages.achieved).toEqual(["65% delivery goal achieved"]);
  expect(messages.remaining).toEqual(["1 more successful delivery to reach 70%"]);
});

test("beating the stretch target leaves nothing outstanding", () => {
  const messages = deliveryGoalMessages(deliveryGoalProgress(122, 100, 65, 70));
  expect(messages.remaining).toEqual([]);
  expect(messages.achieved[0]).toMatch(/stretch goal achieved/);
});

test("below both targets, each one is quoted separately", () => {
  const messages = deliveryGoalMessages(deliveryGoalProgress(32, 11, 60, 70));
  expect(messages.achieved.length).toBe(0);
  expect(messages.remaining.length).toBe(2);
  expect(messages.remaining[0]).toMatch(/9 more successful deliveries to reach 60%/);
  expect(messages.remaining[1]).toMatch(/12 more to reach 70%/);
});

test("one delivery reads in the singular", () => {
  const messages = deliveryGoalMessages(deliveryGoalProgress(3, 2, 70, 70));
  expect(messages.remaining[0]).toMatch(/1 more successful delivery/);
});

test("identical targets are not quoted twice", () => {
  const messages = deliveryGoalMessages(deliveryGoalProgress(100, 10, 50, 50));
  expect(messages.remaining.length).toBe(1);
});
