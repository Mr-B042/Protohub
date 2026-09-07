type QuantityRow = { product_id?: unknown; quantity?: unknown };

/**
 * Physical stock remains unchanged until an officer closes delivered orders.
 * This helper converts that visible balance into available-to-promise stock by
 * subtracting every pending/exception delivery commitment for each product.
 */
export function availableAfterDeliveredReservations(
  balances: QuantityRow[],
  reservations: QuantityRow[]
) {
  const available = new Map<string, number>();
  for (const row of balances) {
    const productId = String(row.product_id ?? "");
    if (!productId) continue;
    available.set(productId, Math.max(0, Number(row.quantity ?? 0)));
  }
  for (const row of reservations) {
    const productId = String(row.product_id ?? "");
    if (!productId) continue;
    available.set(productId, Math.max(0, (available.get(productId) ?? 0) - Math.max(0, Number(row.quantity ?? 0))));
  }
  return available;
}
