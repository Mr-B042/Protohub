import { fetchAllRows, type PagedQueryResult } from "./paginated-query.js";

export type CartListAttempt = { cart_id: string; outcome_code: string | null; attempted_at: string | null };
export type CartListDeletedOrder = { order_id: string; source_cart_id: string | null; deleted_at: string; deleted_by_name: string | null; note: string | null };
type CartMetadataClient = { from: (table: string) => any };
export type CartListEnrichment = {
  attempts: PagedQueryResult<CartListAttempt>;
  deleted: PagedQueryResult<CartListDeletedOrder> | null;
};

/**
 * A recent or exact-cart list only needs history belonging to the carts that
 * passed the route's org/branch/role filters. Filter by those IDs, not dates:
 * a cart's creation date can be corrected while its earlier history stays put.
 * Keep URLs below PostgREST's length limit and at most four metadata reads in
 * flight. Each batch is paged so an active cart cannot hide a quieter cart's
 * latest call behind the database's 1,000-row response cap.
 */
export async function readScopedCartListEnrichment(
  client: CartMetadataClient,
  { orgId, cartIds, includeDeleted }: { orgId: string; cartIds: string[]; includeDeleted: boolean }
): Promise<CartListEnrichment> {
  const ids = [...new Set(cartIds.filter(Boolean))];
  const batches: string[][] = [];
  let batch: string[] = [];
  let encodedLength = 0;
  for (const id of ids) {
    const length = encodeURIComponent(id).length + 3;
    if (batch.length && (batch.length === 200 || encodedLength + length > 6000)) {
      batches.push(batch);
      batch = [];
      encodedLength = 0;
    }
    batch.push(id);
    encodedLength += length;
  }
  if (batch.length) batches.push(batch);
  const attempts: Array<PagedQueryResult<CartListAttempt>> = new Array(batches.length);
  const deleted: Array<PagedQueryResult<CartListDeletedOrder>> = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const index = next++;
      const batch = batches[index];
      [attempts[index], deleted[index]] = await Promise.all([
        fetchAllRows<CartListAttempt>((from, to) => client.from("cart_contact_attempts")
          .select("cart_id, outcome_code, attempted_at")
          .eq("org_id", orgId).in("cart_id", batch)
          .order("attempted_at", { ascending: false }).order("id", { ascending: false })
          .range(from, to)),
        includeDeleted ? fetchAllRows<CartListDeletedOrder>((from, to) => client.from("deleted_orders")
          .select("order_id, source_cart_id, deleted_at, deleted_by_name, note")
          .eq("org_id", orgId).in("source_cart_id", batch)
          .order("deleted_at", { ascending: false }).order("id", { ascending: false })
          .range(from, to)) : Promise.resolve({ data: [], error: null })
      ]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, batches.length) }, worker));
  const combine = <T>(pages: Array<PagedQueryResult<T>>): PagedQueryResult<T> => {
    const error = pages.find((page) => page.error)?.error ?? null;
    return { data: error ? null : pages.flatMap((page) => page.data ?? []), error };
  };
  return { attempts: combine(attempts), deleted: includeDeleted ? combine(deleted) : null };
}
