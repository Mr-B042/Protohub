/**
 * Read a long list in 1,000-row pages, all at once instead of one after
 * another (30 Oct 2026, the app is slow on low-end phones). Orders and carts
 * were read page by page - five or six trips to the database, each waiting
 * for the last - which was most of the ~9 s before the server started
 * answering. The first page also asks for the total, so every other page can
 * be asked for together. Same rows, same order as before.
 */
export type PageResult = { data: any[] | null; error: { message: string } | null; count?: number | null };

export async function fetchPagesTogether(
  readPage: (from: number, to: number, withCount: boolean) => PromiseLike<PageResult>,
  { start = 0, limit, pageSize = 1000, together = 4 }: { start?: number; limit: number; pageSize?: number; together?: number }
): Promise<{ rows: any[]; total: number | null; error: { message: string } | null }> {
  const end = start + limit; // exclusive
  const first = await readPage(start, Math.min(end, start + pageSize) - 1, true);
  if (first.error) return { rows: [], total: null, error: first.error };
  const firstRows = first.data ?? [];
  const total = typeof first.count === "number" ? first.count : null;
  if (firstRows.length < pageSize || start + pageSize >= end) return { rows: firstRows, total, error: null };

  const pages: any[][] = [firstRows];
  if (total === null) {
    // No total to plan with: the old way, one page after another.
    for (let from = start + pageSize; from < end; from += pageSize) {
      const page = await readPage(from, Math.min(end, from + pageSize) - 1, false);
      if (page.error) return { rows: [], total, error: page.error };
      pages.push(page.data ?? []);
      if ((page.data ?? []).length < pageSize) break;
    }
    return { rows: pages.flat(), total, error: null };
  }

  const starts: number[] = [];
  for (let from = start + pageSize; from < Math.min(end, total); from += pageSize) starts.push(from);
  const results: PageResult[] = new Array(starts.length);
  let next = 0;
  const worker = async () => {
    while (next < starts.length) {
      const index = next++;
      results[index] = await readPage(starts[index], Math.min(end, starts[index] + pageSize) - 1, false);
    }
  };
  await Promise.all(Array.from({ length: Math.min(together, starts.length) }, worker));
  for (const page of results) {
    if (page.error) return { rows: [], total, error: page.error };
    pages.push(page.data ?? []);
  }
  return { rows: pages.flat(), total, error: null };
}
