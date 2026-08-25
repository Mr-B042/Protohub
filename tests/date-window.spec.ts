import { expect, test } from "@playwright/test";
import {
  formatWindow, matchPreset, normaliseWindow, presetRange, resizeWindow, shiftDay,
  shiftWindow, windowContains, windowLabel, windowSize, windowSizeLabel, weekStart
} from "../src/lib/date-window";

// Tue 25 Aug 2026. Mon 24th, Sun 23rd, so last week is Sun 16 – Sat 22.
const TODAY = "2026-08-25";

test("window size counts both ends", () => {
  expect(windowSize({ start: "2026-08-16", end: "2026-08-22" })).toBe(7);
  expect(windowSize({ start: "2026-08-16", end: "2026-08-16" })).toBe(1);
});

// ⚠️ The arrows move by ONE DAY, not by one period. Jumping a whole week is
// exactly the behaviour this replaces.
test("an arrow moves the whole window one day and keeps its width", () => {
  const week = { start: "2026-08-16", end: "2026-08-22" };
  expect(shiftWindow(week, 1)).toEqual({ start: "2026-08-17", end: "2026-08-23" });
  expect(shiftWindow(week, -1)).toEqual({ start: "2026-08-15", end: "2026-08-21" });
  expect(windowSize(shiftWindow(week, 5))).toBe(7);
});

test("stepping forward then back returns to where it started", () => {
  const week = { start: "2026-08-16", end: "2026-08-22" };
  expect(shiftWindow(shiftWindow(week, 1), -1)).toEqual(week);
});

test("a shift crosses month and year boundaries cleanly", () => {
  expect(shiftWindow({ start: "2026-08-29", end: "2026-09-04" }, 1))
    .toEqual({ start: "2026-08-30", end: "2026-09-05" });
  expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
});

test("a leap day is a real day", () => {
  expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
  expect(shiftDay("2028-02-29", 1)).toBe("2028-03-01");
});

// Narrowing should land on the most RECENT days, not walk backwards in time.
test("resizing keeps the end date fixed", () => {
  const week = { start: "2026-08-16", end: "2026-08-22" };
  expect(resizeWindow(week, 3)).toEqual({ start: "2026-08-20", end: "2026-08-22" });
  expect(resizeWindow(week, 1)).toEqual({ start: "2026-08-22", end: "2026-08-22" });
  expect(resizeWindow(week, 14)).toEqual({ start: "2026-08-09", end: "2026-08-22" });
});

test("a resized window then moves at its new width", () => {
  const three = resizeWindow({ start: "2026-08-16", end: "2026-08-22" }, 3);
  expect(shiftWindow(three, 1)).toEqual({ start: "2026-08-21", end: "2026-08-23" });
  expect(windowSize(shiftWindow(three, 1))).toBe(3);
});

test("weeks are Sunday anchored, like everything else in the app", () => {
  expect(weekStart("2026-08-25")).toBe("2026-08-23");
  expect(weekStart("2026-08-23")).toBe("2026-08-23");
});

test("presets resolve to the ranges a rep expects", () => {
  expect(presetRange("today", TODAY)).toEqual({ start: "2026-08-25", end: "2026-08-25" });
  expect(presetRange("yesterday", TODAY)).toEqual({ start: "2026-08-24", end: "2026-08-24" });
  expect(presetRange("thisWeek", TODAY)).toEqual({ start: "2026-08-23", end: "2026-08-29" });
  expect(presetRange("lastWeek", TODAY)).toEqual({ start: "2026-08-16", end: "2026-08-22" });
  expect(presetRange("thisMonth", TODAY)).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  expect(presetRange("lastMonth", TODAY)).toEqual({ start: "2026-07-01", end: "2026-07-31" });
});

// ⚠️ "Last 7 Days" includes today, so it is today minus SIX.
test("rolling ranges include today and are the width they claim", () => {
  expect(presetRange("last7", TODAY)).toEqual({ start: "2026-08-19", end: "2026-08-25" });
  expect(windowSize(presetRange("last7", TODAY))).toBe(7);
  expect(windowSize(presetRange("last14", TODAY))).toBe(14);
  expect(windowSize(presetRange("last30", TODAY))).toBe(30);
});

test("a February last-month resolves its real length", () => {
  expect(presetRange("lastMonth", "2026-03-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  expect(presetRange("lastMonth", "2028-03-10")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
});

test("a January last-month rolls back a year", () => {
  expect(presetRange("lastMonth", "2026-01-15")).toEqual({ start: "2025-12-01", end: "2025-12-31" });
});

test("a known range is named after its preset", () => {
  expect(windowLabel({ start: "2026-08-16", end: "2026-08-22" }, TODAY)).toBe("Last Week");
  expect(windowLabel({ start: "2026-08-25", end: "2026-08-25" }, TODAY)).toBe("Today");
  expect(windowLabel({ start: "2026-08-24", end: "2026-08-24" }, TODAY)).toBe("Yesterday");
  expect(windowLabel({ start: "2026-08-01", end: "2026-08-31" }, TODAY)).toBe("This Month");
});

// ⚠️ The single most important rule here: a nudged window stops using the
// preset's name, because the reader trusts the label over the dates.
test("a window moved off a preset stops claiming that preset's name", () => {
  const moved = shiftWindow(presetRange("lastWeek", TODAY), 1);
  expect(moved).toEqual({ start: "2026-08-17", end: "2026-08-23" });
  expect(windowLabel(moved, TODAY)).toBe("Custom 7 Days");
  expect(matchPreset(moved, TODAY)).toBeNull();
});

test("a one-day custom window is singular", () => {
  expect(windowLabel({ start: "2026-08-11", end: "2026-08-11" }, TODAY)).toBe("Custom 1 Day");
});

test("moving back onto a preset picks its name up again", () => {
  const moved = shiftWindow(presetRange("lastWeek", TODAY), 1);
  expect(windowLabel(shiftWindow(moved, -1), TODAY)).toBe("Last Week");
});

test("named window sizes are used where they exist", () => {
  expect(windowSizeLabel(7)).toBe("1 week");
  expect(windowSizeLabel(14)).toBe("2 weeks");
  expect(windowSizeLabel(1)).toBe("1 day");
  expect(windowSizeLabel(45)).toBe("45 days");
});

test("containment is inclusive at both ends", () => {
  const week = { start: "2026-08-16", end: "2026-08-22" };
  expect(windowContains(week, "2026-08-16")).toBe(true);
  expect(windowContains(week, "2026-08-22")).toBe(true);
  expect(windowContains(week, "2026-08-15")).toBe(false);
  expect(windowContains(week, "2026-08-23")).toBe(false);
});

// A typo in the picker should be corrected, not crash the list.
test("a backwards range is swapped rather than rejected", () => {
  expect(normaliseWindow({ start: "2026-08-22", end: "2026-08-16" }))
    .toEqual({ start: "2026-08-16", end: "2026-08-22" });
  expect(normaliseWindow({ start: "2026-08-16", end: "2026-08-22" }))
    .toEqual({ start: "2026-08-16", end: "2026-08-22" });
});

test("a single day reads as one date, not a range of itself", () => {
  expect(formatWindow({ start: "2026-08-16", end: "2026-08-16" })).not.toContain("–");
  expect(formatWindow({ start: "2026-08-16", end: "2026-08-22" })).toContain("–");
});

test("junk input never throws", () => {
  expect(windowSize({ start: "nope", end: "2026-08-22" })).toBe(0);
  expect(formatWindow({ start: "", end: "" })).toBe("—");
  expect(windowContains({ start: "2026-08-16", end: "2026-08-22" }, "")).toBe(false);
});
