import assert from "node:assert/strict";
import test from "node:test";
import { suggestTargets, completeMonthsBefore, daysInWindow, type MonthActual } from "./target-suggestion.js";

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

// ── Which months a suggestion is allowed to look at ──────
// Bright's question: "i hope august and next month like sept and rest will show
// their real history when necessary?" These assert it rolls forward on its own.

test("planning September DURING August does not use the unfinished August", () => {
  // 30 August: August sits before September but is a day short. Using it would
  // depress every suggested target by roughly a day's trading.
  const windows = completeMonthsBefore("2026-09-01", 2, "2026-08-30");
  assert.deepEqual(windows.map((w) => w.monthKey), ["2026-06", "2026-07"]);
});

test("planning September AFTER August closes uses August's real history", () => {
  // 1 September: August has finished, so it becomes the most recent evidence
  // and June drops out of the window. Nothing has to be changed by hand.
  const windows = completeMonthsBefore("2026-09-01", 2, "2026-09-01");
  assert.deepEqual(windows.map((w) => w.monthKey), ["2026-07", "2026-08"]);
});

test("the window rolls forward on its own, month after month", () => {
  assert.deepEqual(
    completeMonthsBefore("2026-10-01", 2, "2026-10-01").map((w) => w.monthKey),
    ["2026-08", "2026-09"]
  );
  assert.deepEqual(
    completeMonthsBefore("2026-11-01", 2, "2026-11-05").map((w) => w.monthKey),
    ["2026-09", "2026-10"]
  );
});

test("the lookback crosses a year boundary correctly", () => {
  const windows = completeMonthsBefore("2027-01-01", 3, "2027-01-02");
  assert.deepEqual(windows.map((w) => w.monthKey), ["2026-10", "2026-11", "2026-12"]);
});

test("each window spans its whole month, including a leap February", () => {
  const feb = completeMonthsBefore("2028-03-01", 1, "2028-03-01")[0];
  assert.equal(feb.start, "2028-02-01");
  assert.equal(feb.end, "2028-02-29");
  assert.equal(daysInWindow(feb), 29);

  const jan = completeMonthsBefore("2026-02-01", 1, "2026-02-01")[0];
  assert.equal(daysInWindow(jan), 31);
});

test("a longer lookback still drops only the unfinished month", () => {
  // Asking for 3 months mid-August returns the 3 complete ones, not 2.
  const windows = completeMonthsBefore("2026-09-01", 3, "2026-08-30");
  assert.deepEqual(windows.map((w) => w.monthKey), ["2026-05", "2026-06", "2026-07"]);
});

test("a baseline month predating commission settlement is flagged, not silently averaged", () => {
  // Contribution deducts commissions, and the engine settles nothing before its
  // launch week. June carries none at all and July only part of one, so their
  // contribution reads high against a September that bears a full month's.
  const june = month({ monthKey: "2026-06", days: 30, periodStart: "2026-06-01", periodEnd: "2026-06-30",
    ordersPlaced: 656, delivered: 463, contribution: 2_047_886 });
  const july = month({ monthKey: "2026-07", days: 31, periodStart: "2026-07-01", periodEnd: "2026-07-31",
    ordersPlaced: 742, delivered: 534, contribution: 2_542_710 });

  const out = suggestTargets([june, july], "2026-09-01", "2026-09-30", 10, 10, "2026-07-05");
  const warning = out.notes.find((n) => n.includes("Commission settlement began"));

  assert.ok(warning, "expected a commission-basis warning");
  assert.match(warning!, /2026-06 carries no commission at all/);
  assert.match(warning!, /2026-07 only from 2026-07-05/);
  assert.match(warning!, /optimistic/);
});

test("no warning once every baseline month is after settlement began", () => {
  const aug = month({ monthKey: "2026-08", days: 31, periodStart: "2026-08-01", periodEnd: "2026-08-31",
    ordersPlaced: 638, delivered: 481, contribution: 2_650_600 });
  const sep = month({ monthKey: "2026-09", days: 30, periodStart: "2026-09-01", periodEnd: "2026-09-30",
    ordersPlaced: 700, delivered: 520, contribution: 2_700_000 });

  const out = suggestTargets([aug, sep], "2026-10-01", "2026-10-31", 10, 10, "2026-07-05");
  assert.equal(out.notes.some((n) => n.includes("Commission settlement began")), false);
});
