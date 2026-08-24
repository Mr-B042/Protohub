import { expect, test } from "@playwright/test";
import {
  countdownMessage, countdownParts, countdownTier, formatCountdown, formatCountdownWords,
  msUntilEndOfLagosDay, msUntilLagosHour
} from "../src/lib/cart-log-countdown";

// 09:00 Lagos on 24 Aug 2026 is 08:00 UTC.
const at = (utc: string) => new Date(utc).getTime();

test("the deadline is the next LAGOS midnight, not the browser's", () => {
  // 23:30 UTC is already 00:30 the next day in Lagos, so most of a day is left.
  const ms = msUntilEndOfLagosDay(at("2026-08-24T23:30:00Z"));
  expect(countdownParts(ms).hours).toBe(23);
  expect(countdownParts(ms).minutes).toBe(30);
});

test("nine in the morning leaves fifteen hours", () => {
  const ms = msUntilEndOfLagosDay(at("2026-08-24T08:00:00Z"));
  expect(formatCountdown(ms)).toBe("15:00:00");
});

test("one minute before Lagos midnight leaves one minute", () => {
  const ms = msUntilEndOfLagosDay(at("2026-08-24T22:59:00Z"));
  expect(formatCountdown(ms)).toBe("0:01:00");
});

test("the clock never runs negative on a bad input", () => {
  expect(msUntilEndOfLagosDay(Number.NaN)).toBe(0);
  expect(formatCountdown(-5000)).toBe("0:00:00");
  expect(countdownParts(-1).hours).toBe(0);
});

test("minutes and seconds are zero padded so the clock does not jump", () => {
  expect(formatCountdown(3_600_000 + 4 * 60_000 + 9_000)).toBe("1:04:09");
});

test("it stays calm most of the day and only escalates near the end", () => {
  expect(countdownTier(10 * 3_600_000)).toBe("calm");
  expect(countdownTier(4 * 3_600_000)).toBe("calm");
  expect(countdownTier(3 * 3_600_000)).toBe("warning");
  expect(countdownTier(90 * 60_000)).toBe("warning");
  expect(countdownTier(60 * 60_000)).toBe("critical");
  expect(countdownTier(30 * 60_000)).toBe("critical");
  expect(countdownTier(0)).toBe("over");
});

test("the message names the carts and the money, not just the time", () => {
  expect(countdownMessage(5 * 3_600_000, 40, 20_000)).toBe("left to log 40 carts · ₦20,000 at risk");
  expect(countdownMessage(5 * 3_600_000, 1, 500)).toBe("left to log 1 cart · ₦500 at risk");
});

test("a clear board is never given a countdown to worry about", () => {
  expect(countdownMessage(5 * 3_600_000, 0, 0)).toMatch(/Board clear/);
  expect(countdownMessage(0, 0, 0)).toMatch(/Board clear/);
});

test("once the day is gone it says so, and that the Owner still decides", () => {
  const message = countdownMessage(0, 40, 20_000);
  expect(message).toMatch(/Day ended/);
  expect(message).toMatch(/₦20,000/);
  expect(message).toMatch(/Owner/);
});

// ── Shared with the follow-up charge banner ──

test("a cutoff hour that has already passed reads as closed, not as tomorrow", () => {
  // 22:30 Lagos is 21:30 UTC, half an hour past a 22:00 close.
  expect(msUntilLagosHour(at("2026-08-24T21:30:00Z"), 22)).toBe(0);
});

test("the ten-o-clock close counts down through the working day", () => {
  expect(formatCountdownWords(msUntilLagosHour(at("2026-08-24T10:15:41Z"), 22))).toBe("10h 44m 19s");
});

test("hour 24 is the end of the day, matching the plain day helper", () => {
  const now = at("2026-08-24T08:00:00Z");
  expect(msUntilLagosHour(now, 24)).toBe(msUntilEndOfLagosDay(now));
});

test("the words format drops a zero hours segment", () => {
  expect(formatCountdownWords(44 * 60_000 + 19_000)).toBe("44m 19s");
  expect(formatCountdownWords(0)).toBe("0m 0s");
});
