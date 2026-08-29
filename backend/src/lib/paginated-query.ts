export type PagedQueryResult<T> = {
  data: T[] | null;
  error: any | null;
};

/**
 * THE paging loop. Every paged read in the backend runs through this function,
 * either directly or via fetchAllRowsOrThrow() in query-limits.ts, which is a
 * thin throwing wrapper over it. There used to be two separate implementations
 * called fetchAllRows with different signatures and opposite error handling -
 * one threw, one returned - and seven routes split between them by import
 * path. Nothing was broken by it; it was simply a trap for whoever converted
 * the next call site.
 *
 * ⚠️ A CLIENT .limit() CANNOT BEAT A SERVER CAP. PostgREST enforces its own
 * max-rows ceiling and truncates with NO error, so a route can ask for 20,000
 * rows, be handed 1,000, and report them as the complete set. That is how
 * 1,145 expenses stopped reaching the browser while carrying an explicit
 * .limit(). .range() is the only way past it: ask for a window at a time and
 * stop when a page comes back short.
 *
 * ⚠️ CALLERS MUST GIVE THE QUERY A TIE-BREAKING SORT (add .order("id") after
 * the real sort key). Paging a query whose sort has ties repeats or skips rows
 * across page boundaries, which turns one silent truncation into a subtler one.
 *
 * ⚠️ CALLERS MUST REBUILD THE QUERY PER PAGE. A PostgREST builder is
 * single-use; handing the same one to every .range() call returns page one
 * forever.
 */
export const fetchAllRows = async <T>(
  fetchPage: (from: number, to: number) => PromiseLike<PagedQueryResult<T>>,
  pageSize = 1000
): Promise<PagedQueryResult<T>> => {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const rows: T[] = [];

  // Belt and braces: never spin forever on a table that keeps growing. Carried
  // over from the implementation this one absorbed - the other loop had it and
  // this one did not, which is the sort of difference two copies accumulate.
  const maxPages = 200;
  for (let page = 0; ; page += 1) {
    const from = page * safePageSize;
    const result = await fetchPage(from, from + safePageSize - 1);
    if (result.error) return { data: rows, error: result.error };

    const batch = Array.isArray(result.data) ? result.data : [];
    rows.push(...batch);
    // A short page means the end. A full page might be the end too, so the
    // next request settles it rather than guessing from the count.
    if (batch.length < safePageSize) break;
    if (page >= maxPages) break;
  }

  return { data: rows, error: null };
};
