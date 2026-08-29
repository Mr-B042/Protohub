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
/**
 * ⚠️ DO NOT USE THIS TO MAKE A LIST READ SAFE. It cannot.
 *
 * PostgREST enforces its OWN max-rows ceiling and silently truncates to it, so
 * a query carrying .limit(REPORT_ROW_CEILING) can still be handed 1,000 rows
 * and report them as the complete set. That is not theoretical: /api/expenses
 * carried this constant and still cut the ledger off at 2026-07-18, hiding
 * 1,145 rows and every ad cost before that date.
 *
 * It remains useful only as a sanity bound on a query already narrowed to far
 * fewer rows - a guard against a runaway scan, not against truncation.
 *
 * For anything that must return every matching row, use fetchAllRows() below.
 *
 * ⚠️ AND A MONTH FILTER IS NO LONGER A SHIELD. As at 2026-08, single-month
 * volumes already exceed the cap on their own:
 *   order_contact_attempts  5,198 / month
 *   stock_movements         1,723 / month
 *   abandoned_carts         1,129 / month
 *   cart_contact_attempts   1,078 / month
 *   orders                    918 / month  (crosses next month)
 *   expenses                  757 / month
 * Scoping a query to "this month" used to keep it comfortably under 1,000. On
 * these tables it no longer does.
 */
export const REPORT_ROW_CEILING = 20000;

/**
 * Fetch every row a query matches, in pages.
 *
 * ⚠️ A CLIENT .limit() CANNOT BEAT A SERVER CAP. PostgREST enforces its own
 * max-rows ceiling, and when it truncates it returns no error - so a route can
 * ask for 20,000 rows, be handed 1,000, and report them as the complete set.
 * That is how 1,145 expenses stopped reaching the browser: /api/expenses had
 * an explicit .limit(REPORT_ROW_CEILING) and STILL returned only the newest
 * 1,000, cutting the ledger off at 2026-07-18.
 *
 * .range() is the only way to get past it: ask for a window at a time and stop
 * when a page comes back short.
 */
export async function fetchAllRows<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> },
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * pageSize;
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    // A short page means the end. A full page might be the end too, so the
    // next request settles it rather than guessing from the count.
    if (batch.length < pageSize) return rows;
    // Belt and braces: never spin forever on a table that keeps growing.
    if (page > 200) return rows;
  }
}
