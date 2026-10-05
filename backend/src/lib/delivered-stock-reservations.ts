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

export type DeliveredStockShortfall = {
  agentName: string;
  hubName?: string | null;
  productName: string;
  needed: number;
  onShelf: number;
  reservations: Array<{ orderId: string; quantity: number }>;
};

/**
 * The "available" number is shelf stock minus units already promised to
 * Delivered orders the Inventory Officer hasn't closed yet. Telling a user
 * "0 in stock" when the shelf shows 1 is false, so spell out both numbers and
 * name the orders holding the reserved units.
 */
export function deliveredStockShortfallMessage(input: DeliveredStockShortfall) {
  const units = (n: number) => `${n} unit${n === 1 ? "" : "s"}`;
  const where = input.hubName ? `${input.agentName} (${input.hubName})` : input.agentName;
  const reserved = input.reservations.reduce((sum, row) => sum + Math.max(0, row.quantity), 0);
  const free = Math.max(0, input.onShelf - reserved);
  const head = `Not enough stock to mark this order Delivered. This order needs ${units(input.needed)} of ${input.productName}.`;

  if (reserved === 0) {
    return `${head} ${where} has ${units(input.onShelf)} on the shelf. Restock ${input.agentName} or reassign this order to an agent with enough stock, then try again.`;
  }

  const orderIds = input.reservations.map((row) => row.orderId);
  const orderList = orderIds.length === 1 ? `order ${orderIds[0]}` : `orders ${orderIds.join(", ")}`;
  return `${head} ${where} has ${units(input.onShelf)} on the shelf, but ${units(reserved)} ${reserved === 1 ? "is" : "are"} already reserved for ${orderList} - marked Delivered and waiting for the Inventory Officer to close the stock - so ${units(free)} ${free === 1 ? "is" : "are"} free. If ${orderList} really ${orderIds.length === 1 ? "was" : "were"} delivered, restock ${input.agentName} or reassign this order. If not, correct ${orderList} first, then try again.`;
}
