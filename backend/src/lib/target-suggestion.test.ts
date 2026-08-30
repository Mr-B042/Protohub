import assert from "node:assert/strict";
import test from "node:test";
import { suggestTargets, type MonthActual } from "./target-suggestion.js";

const month = (over: Partial<MonthActual> & { monthKey: string; days: number }): MonthActual => ({
  periodStart: `${over.monthKey}-01`, periodEnd: `${over.monthKey}-28`,
  contribution: 0, ordersPlaced: 0, delivered: 0, pieces: 0, adSpend: 0,
  ...over
});

test("months are normalised per day before being scaled to the new period", () => {
  // February: 28 days, 280 orders = 10/day. Planning a 31-day month must give
  // 310, not February's 280 handed over unchanged.
  const feb = month({ monthKey: "2026-02", days: 28, ordersPlaced: 280, delivered: 210, pieces: 840, contribution: 2_800_000, adSpend: 1_400_000 });
  const out = suggestTargets([feb], "2026-03-01", "2026-03-31", 0);

  assert.equal(out.daysInTargetPeriod, 31);
  assert.equal(out.baseline.orderTarget, 310);
  assert.equal(out.baseline.deliveredTarget, 233);
});

test("the stretch lifts every volume lever", () => {
  const m = month({ monthKey: "2026-07", days: 31, ordersPlaced: 620, delivered: 465, pieces: 1860, contribution: 3_100_000, adSpend: 3_100_000 });
  const out = suggestTargets([m], "2026-08-01", "2026-08-31", 10);

  assert.equal(out.baseline.orderTarget, 620);
  assert.equal(out.suggested.orderTarget, 682);          // +10%
  assert.equal(out.suggested.deliveredTarget, 512);      // +10%
  assert.ok(out.suggested.contributionTarget > out.baseline.contributionTarget);
});

test("delivery rate is pooled, not a mean of monthly percentages", () => {
  // A tiny month at 100% and a big month at 50%. The mean of the rates is 75%,
  // which neither month ever achieved and the combined business never did.
  const tiny = month({ monthKey: "2026-06", days: 30, ordersPlaced: 2, delivered: 2 });
  const big = month({ monthKey: "2026-07", days: 31, ordersPlaced: 1000, delivered: 500 });

  const out = suggestTargets([tiny, big], "2026-08-01", "2026-08-31", 0);
  // 502 delivered of 1002 placed = 50.1%.
  assert.equal(out.suggested.deliveryRateTarget, 50.1);
});

test("delivery rate is NOT stretched a second time", () => {
  // Orders and deliveries both rise by the uplift, so their ratio is unchanged.
  // Stretching the rate as well would be a hidden second stretch.
  const m = month({ monthKey: "2026-07", days: 31, ordersPlaced: 1000, delivered: 750 });
  const out = suggestTargets([m], "2026-08-01", "2026-08-31", 20);
  assert.equal(out.suggested.deliveryRateTarget, 75);
  assert.equal(out.baseline.deliveryRateTarget, 75);
});

test("the incentive bands sit symmetrically around whatever target is proposed", () => {
  const m = month({ monthKey: "2026-07", days: 31, ordersPlaced: 620, delivered: 465, contribution: 3_100_000 });
  const out = suggestTargets([m], "2026-08-01", "2026-08-31", 0, 10);

  assert.ok(out.suggested.contributionMinimum < out.suggested.contributionTarget);
  assert.ok(out.suggested.contributionExceptional > out.suggested.contributionTarget);
});

test("a dead month is skipped rather than averaged into the baseline", () => {
  // Averaging a zero month in would halve the run rate for no real reason.
  const live = month({ monthKey: "2026-07", days: 31, ordersPlaced: 620, delivered: 465, contribution: 3_100_000 });
  const dead = month({ monthKey: "2026-06", days: 30 });

  const out = suggestTargets([live, dead], "2026-08-01", "2026-08-31", 0);
  assert.deepEqual(out.skipped, ["2026-06"]);
  assert.equal(out.basedOn.length, 1);
  assert.equal(out.suggested.orderTarget, 620);
});

test("no usable history returns zeros and says so rather than inventing a target", () => {
  const out = suggestTargets([month({ monthKey: "2026-06", days: 30 })], "2026-08-01", "2026-08-31", 10);
  assert.equal(out.suggested.contributionTarget, 0);
  assert.ok(out.notes.some((n) => /enter the targets by hand/i.test(n)));
});

test("a single month of history is flagged as not a trend", () => {
  const m = month({ monthKey: "2026-07", days: 31, ordersPlaced: 620, delivered: 465, contribution: 3_100_000 });
  const out = suggestTargets([m], "2026-08-01", "2026-08-31", 10);
  assert.ok(out.notes.some((n) => /only one month/i.test(n)));
});

test("money figures are rounded to readable steps, not false precision", () => {
  const m = month({ monthKey: "2026-07", days: 31, ordersPlaced: 620, delivered: 465, contribution: 2_650_617 });
  const out = suggestTargets([m], "2026-08-01", "2026-08-31", 0);
  // A target of ₦2,650,617 invites a precision nobody has; round to 50k steps.
  assert.equal(out.suggested.contributionTarget % 50_000, 0);
});
