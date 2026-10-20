// Kept apart from missing-fee-penalty.ts so it can be tested without a database.

/**
 * What a week's hidden charges leave unpaid carries to the next week, like
 * other fines: due = this week's charges + carried, paid = up to the payout
 * the rep would otherwise get, the rest carries. Pure, for the tests.
 */
export function carryMissingFees(weeks: Array<{ charges: number; payable: number }>) {
  let carried = 0;
  for (const week of weeks) {
    const due = week.charges + carried;
    carried = Math.max(0, due - Math.max(0, week.payable));
  }
  return carried;
}
