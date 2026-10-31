/** Apply a resource as soon as it settles, without waiting for unrelated requests. */
export async function settleBootstrapResource<T>(
  request: Promise<T>,
  hydrate: (result: PromiseSettledResult<T>) => void,
  isCurrent: () => boolean
): Promise<PromiseSettledResult<T>> {
  const result: PromiseSettledResult<T> = await request.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason })
  );
  if (isCurrent()) {
    try {
      hydrate(result);
    } catch (reason) {
      const failed: PromiseRejectedResult = { status: "rejected", reason };
      // A malformed successful payload follows the same controlled failure path
      // as a failed request, including releasing that resource's loading UI.
      if (result.status === "fulfilled" && isCurrent()) hydrate(failed);
      return failed;
    }
  }
  return result;
}

/** Older snapshots may add history, but cannot overwrite newer visible/live rows. */
export function mergeOlderRows<T extends { id: string }>(current: T[], older: T[]): T[] {
  const ids = new Set(current.map((row) => row.id));
  const added: T[] = [];
  for (const row of older) {
    if (ids.has(row.id)) continue;
    ids.add(row.id);
    added.push(row);
  }
  return added.length ? [...current, ...added] : current;
}

/** A capped or failed half must never unlock writes based on a complete history. */
export function isCompleteOrderChunk(result: PromiseSettledResult<unknown>): boolean {
  if (result.status !== "fulfilled" || !result.value || typeof result.value !== "object") return false;
  const chunk = result.value as { data?: unknown; total?: unknown };
  if (!Array.isArray(chunk.data)) return false;
  const total = chunk.total === undefined ? chunk.data.length : Number(chunk.total);
  return Number.isFinite(total) && total >= 0 && chunk.data.length >= total;
}

/** Visible Orders can load early; persisted calculations require every input. */
export function isCompleteWorkspaceHistory(
  orders: PromiseSettledResult<unknown>[],
  carts: PromiseSettledResult<unknown>[],
  dependencies: PromiseSettledResult<unknown>[]
): boolean {
  return orders.every(isCompleteOrderChunk)
    && carts.every((result) => result.status === "fulfilled" && Array.isArray(result.value))
    && dependencies.every((result) => result.status === "fulfilled");
}
