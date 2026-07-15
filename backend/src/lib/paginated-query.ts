export type PagedQueryResult<T> = {
  data: T[] | null;
  error: any | null;
};

/**
 * Supabase projects commonly cap a single response at 1,000 rows even when
 * the client does not specify a limit. Reports must walk every page or older
 * rows silently disappear as an organization grows.
 */
export const fetchAllRows = async <T>(
  fetchPage: (from: number, to: number) => PromiseLike<PagedQueryResult<T>>,
  pageSize = 1000
): Promise<PagedQueryResult<T>> => {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const rows: T[] = [];

  for (let from = 0; ; from += safePageSize) {
    const result = await fetchPage(from, from + safePageSize - 1);
    if (result.error) return { data: rows, error: result.error };

    const page = Array.isArray(result.data) ? result.data : [];
    rows.push(...page);
    if (page.length < safePageSize) break;
  }

  return { data: rows, error: null };
};
