import { expect, test } from "@playwright/test";
import { moveToWeek } from "../src/pages/ManagerFundsTab";

// "Which week is this for?" (Bright, 12 Oct 2026): one tap files an entry in
// another week by moving its date there.

test("choosing a week moves the date to the same weekday and time in that week", () => {
  const now = "2026-10-12T09:30"; // Monday
  // A Friday 9 Oct entry, sent to the week before (27 Sept - 3 Oct): Friday 2 Oct, same time.
  expect(moveToWeek("2026-10-09T05:33", "2026-09-27", now)).toBe("2026-10-02T05:33");
  // Back to its own week leaves it where it was.
  expect(moveToWeek("2026-10-09T05:33", "2026-10-04", now)).toBe("2026-10-09T05:33");
  // A Sunday stays the first day of the chosen week.
  expect(moveToWeek("2026-10-11T21:49", "2026-10-04", now)).toBe("2026-10-04T21:49");
  // Across a month and a year end.
  expect(moveToWeek("2027-01-06T10:00", "2026-12-27", "2027-01-08T10:00")).toBe("2026-12-30T10:00");
});

test("a day still to come in this week is pulled back to now, never the future", () => {
  const now = "2026-10-12T09:30"; // Monday of the week starting 11 Oct
  // Last week's Friday entry sent to this week would be Friday 16 Oct: not yet.
  expect(moveToWeek("2026-10-09T05:33", "2026-10-11", now)).toBe(now);
  // Earlier today is fine.
  expect(moveToWeek("2026-10-05T08:00", "2026-10-11", now)).toBe("2026-10-12T08:00");
  // No date yet: start from now.
  expect(moveToWeek("", "2026-10-04", now)).toBe("2026-10-05T09:30");
});
