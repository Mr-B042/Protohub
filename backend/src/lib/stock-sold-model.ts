// Pure counting for Pieces Sold (stock-sold.ts loads the rows). No database,
// so it can be tested.

/** One cell: pieces of one product delivered on one day, in one state, by one agent. */
export type SoldLine = { day: string; productId: string; state: string; agentId: string; pieces: number; orders: number };
/** Orders delivered on one day, in one state, by one agent (an order counted once, whatever it held). */
export type SoldOrderCell = { day: string; state: string; agentId: string; orders: number };
export type SoldDay = { day: string; pieces: number; orders: number };

export type SoldRow = {
  id: string; delivered_date: string | null; state: string | null; agent_id: string | null;
  [key: string]: unknown;
};
type Line = { productId: string; quantity: number };


/**
 * Pure: delivered orders → cells inside [start, end] plus a day-by-day total
 * for every day loaded (the quick-range counts on the filter chips).
 */
export function buildSold(
  rows: SoldRow[],
  linesOf: (row: SoldRow) => Line[],
  args: { start: string; end: string; productIds: Set<string> | null; tidyState?: (state: string) => string }
) {
  const lines = new Map<string, SoldLine>();
  const orderCells = new Map<string, SoldOrderCell>();
  const days = new Map<string, SoldDay>();
  for (const row of rows) {
    const day = String(row.delivered_date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const raw = String(row.state ?? "").trim().replace(/\s+/g, " ");
    const state = (raw && args.tidyState ? args.tidyState(raw) : raw) || "No state";
    const agentId = row.agent_id ? String(row.agent_id) : "";
    const pieces = new Map<string, number>();
    for (const line of linesOf(row)) {
      if (!line.productId || !(line.quantity > 0)) continue;
      if (args.productIds && !args.productIds.has(line.productId)) continue;
      pieces.set(line.productId, (pieces.get(line.productId) ?? 0) + line.quantity);
    }
    if (pieces.size === 0) continue;
    const total = [...pieces.values()].reduce((s, n) => s + n, 0);
    const dayEntry = days.get(day) ?? { day, pieces: 0, orders: 0 };
    dayEntry.pieces += total; dayEntry.orders += 1;
    days.set(day, dayEntry);
    if (day < args.start || day > args.end) continue;
    const cellKey = `${day}|${state}|${agentId}`;
    const cell = orderCells.get(cellKey) ?? { day, state, agentId, orders: 0 };
    cell.orders += 1;
    orderCells.set(cellKey, cell);
    for (const [productId, n] of pieces) {
      const key = `${day}|${productId}|${state}|${agentId}`;
      const entry = lines.get(key) ?? { day, productId, state, agentId, pieces: 0, orders: 0 };
      entry.pieces += n; entry.orders += 1;
      lines.set(key, entry);
    }
  }
  const byDay = (a: { day: string }, b: { day: string }) => a.day.localeCompare(b.day);
  return { lines: [...lines.values()].sort(byDay), orderCells: [...orderCells.values()].sort(byDay), days: [...days.values()].sort(byDay) };
}
