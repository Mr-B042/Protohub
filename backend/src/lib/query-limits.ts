/**
 * PostgREST caps an unbounded select at 1000 rows and returns NO error when it
 * truncates. That is not a theoretical risk here - it silently dropped 712 of
 * 1,712 orders on the Head of Sales Rep dashboard and made one rep's AOV read
 * as zero for a week she had really worked (PR #456). Because those queries
 * carried no ORDER BY either, which rows survived was arbitrary, so the numbers
 * looked plausible while being wrong.
 *
 * Any reporting query that scans a range rather than fetching one row states an
 * explicit ceiling with this constant. It is deliberately far above real
 * volumes (the org is at ~2,600 orders total, ~861 in a month) so it never
 * shapes a result - it exists to make truncation impossible rather than silent.
 * If a query ever legitimately needs more than this, page it with .range()
 * instead of raising the number.
 */
export const REPORT_ROW_CEILING = 20000;
