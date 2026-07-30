import assert from "node:assert/strict";
import test from "node:test";
import { weeksInSpreadMonth, weekStartsForMonth, weekAmountFor } from "./salary-spread.js";

const MONTHLY = 630_000;

function sundaysIn(year: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(year, 0, 1, 12));
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCFullYear() === year) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

function ownedSundays(fromYear: number, toYear: number): Map<string, number> {
  const owned = new Map<string, number>();
  for (let y = fromYear; y <= toYear; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      for (const s of weekStartsForMonth(key)) owned.set(s, (owned.get(s) ?? 0) + 1);
    }
  }
  return owned;
}

test("a month owns either 4 or 5 Sunday-anchored weeks", () => {
  for (let y = 2024; y <= 2030; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const n = weeksInSpreadMonth(key);
      assert.ok(n === 4 || n === 5, `${key} reported ${n} weeks`);
      assert.equal(weekStartsForMonth(key).length, n);
    }
  }
});

// The bug this guards: weekStartsForMonth used to hardcode 4 weeks, so four
// weeks a YEAR belonged to no month at all - nobody could spread them and the
// daily cron never fired for them, leaving those calendar weeks with zero
// salary in the weekly break-even view.
test("every Sunday belongs to exactly one month - no orphaned weeks", () => {
  const owned = ownedSundays(2023, 2031);
  for (const year of [2025, 2026, 2027, 2028]) {
    for (const sunday of sundaysIn(year)) {
      const claims = owned.get(sunday) ?? 0;
      assert.equal(claims, 1, `${sunday} is claimed by ${claims} months (expected exactly 1)`);
    }
  }
});

test("weeks run consecutively from the Sunday on or before the 1st", () => {
  // July 2026 opens on a Wednesday, so week 1 reaches back into June.
  assert.deepEqual(weekStartsForMonth("2026-07"), ["2026-06-28", "2026-07-05", "2026-07-12", "2026-07-19"]);
  // August 2026 is a 5-week month; Aug 23 used to be unreachable entirely.
  assert.deepEqual(weekStartsForMonth("2026-08"), ["2026-07-26", "2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23"]);
});

test("a month records exactly its monthly salary, whether it has 4 or 5 weeks", () => {
  for (let y = 2025; y <= 2028; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const weeks = weeksInSpreadMonth(key);
      let recorded = 0;
      for (let w = 1; w <= weeks; w++) recorded += weekAmountFor(key, w, MONTHLY, recorded);
      assert.equal(recorded, MONTHLY, `${key} (${weeks} weeks) recorded ${recorded}`);
    }
  }
});

test("the last week absorbs only what the month still owes, never more", () => {
  // 5-week month with the first four already spread in full -> nothing left.
  assert.equal(weekAmountFor("2026-08", 5, MONTHLY, MONTHLY), 0);
  // Same month with a week skipped -> the last week picks up that slack.
  assert.equal(weekAmountFor("2026-08", 5, MONTHLY, MONTHLY - 157_500), 157_500);
  // A mid-month week never exceeds the outstanding balance either.
  assert.equal(weekAmountFor("2026-08", 2, MONTHLY, MONTHLY - 50_000), 50_000);
  // Normal mid-month week is the familiar quarter.
  assert.equal(weekAmountFor("2026-07", 2, MONTHLY, 157_500), 157_500);
});

test("no week amount is ever negative", () => {
  assert.equal(weekAmountFor("2026-08", 5, MONTHLY, MONTHLY + 99_999), 0);
  assert.equal(weekAmountFor("2026-08", 3, MONTHLY, MONTHLY + 99_999), 0);
});
