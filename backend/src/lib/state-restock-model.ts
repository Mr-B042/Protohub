// Stock left per state / agent, and the busy-state restock rule (Bright,
// 26 Nov 2026). Pure, so it can be tested; state-restock.ts loads the data.
//
// "Left" = what the hub can hand out now: shelf - defective - missing.
// A waybill SENT OUT of a hub already took its pieces off that hub when it
// was dispatched (routes/waybills.ts), and a waybill deleted in transit puts
// them back - so "left" already follows Bright's rule. Pieces still in
// transit TO a hub are shown apart as "on the way" and count toward cover.
//
// Busy state = sold BUSY_STATE_MIN_PIECES+ of a product in the last 7 days.
// It needs a restock when left + on the way is less than what it sold in
// those 7 days ("less than a week left"); send at least the difference.

export const BUSY_STATE_MIN_PIECES = 12;
export const RESTOCK_WINDOW_DAYS = 7;

export type HubStockRow = { locationId: string; agentId: string; state: string; productId: string; left: number; onTheWay: number };
export type StockTotal = { left: number; onTheWay: number };
export type StateRestock = { state: string; productId: string; sold: number; left: number; onTheWay: number; send: number };

/** Stock summed per key (state, agent, or state::agent), optionally for some products only. */
export function stockTotals(rows: HubStockRow[], keyOf: (row: HubStockRow) => string, productIds?: Set<string> | null): Map<string, StockTotal> {
  const out = new Map<string, StockTotal>();
  for (const row of rows) {
    if (productIds && productIds.size > 0 && !productIds.has(row.productId)) continue;
    const key = keyOf(row);
    if (!key) continue;
    const cur = out.get(key) ?? { left: 0, onTheWay: 0 };
    cur.left += row.left; cur.onTheWay += row.onTheWay;
    out.set(key, cur);
  }
  return out;
}

/** Busy states (state x product) with less than a week of stock. Worst first. */
export function stateRestockNeeds(args: { sold: Array<{ state: string; productId: string; pieces: number }>; stock: HubStockRow[]; min?: number }): StateRestock[] {
  const min = args.min ?? BUSY_STATE_MIN_PIECES;
  const sold = new Map<string, number>();
  for (const line of args.sold) {
    if (!line.state || !line.productId) continue;
    const key = `${line.state}::${line.productId}`;
    sold.set(key, (sold.get(key) ?? 0) + line.pieces);
  }
  const stock = stockTotals(args.stock, (row) => `${row.state}::${row.productId}`);
  const out: StateRestock[] = [];
  for (const [key, pieces] of sold) {
    if (pieces < min) continue;
    const have = stock.get(key) ?? { left: 0, onTheWay: 0 };
    const cover = have.left + have.onTheWay;
    if (cover >= pieces) continue;
    const [state, productId] = key.split("::");
    out.push({ state, productId, sold: pieces, left: have.left, onTheWay: have.onTheWay, send: pieces - cover });
  }
  return out.sort((a, b) => b.send - a.send || b.sold - a.sold);
}
