// Pure counting for Pieces Sold (stock-sold.ts loads the rows). No database,
// so it can be tested.
//
// An order counts under its MAIN product only (orders.product_id). Free gifts,
// cross-sells, extras and other parts of a package are NOT main products
// (Bright, 24 Nov 2026: "gifts shouldn't show as a main product, only inside
// it"), so they are kept apart as `extras`, each tied to the main product it
// shipped with.

export type ExtraKind = "gift" | "cross_sell" | "extra" | "package";

/** One cell: pieces of one MAIN product delivered on one day, in one state, by one agent. */
export type SoldLine = { day: string; productId: string; state: string; agentId: string; pieces: number; orders: number };
/** What shipped WITH a main product (never counted as a product of its own). */
export type SoldExtra = { day: string; productId: string; itemId: string; kind: ExtraKind; state: string; agentId: string; pieces: number };
/** Orders delivered on one day, in one state, by one agent (an order counted once). */
export type SoldOrderCell = { day: string; state: string; agentId: string; orders: number };
export type SoldDay = { day: string; pieces: number; orders: number };

export type SoldRow = {
  id: string; delivered_date: string | null; state: string | null; agent_id: string | null;
  product_id?: string | null; quantity?: number | null;
  [key: string]: unknown;
};
/** One shipped line, unmerged, with where it came from. */
export type SourcedLine = { productId: string; quantity: number; sourceType: string; isFreeGift?: boolean };

const kindOf = (line: SourcedLine, mainId: string): ExtraKind | "main" => {
  if (line.isFreeGift || line.sourceType === "free_gift") return "gift";
  if (line.sourceType === "cross_sell") return "cross_sell";
  if (line.sourceType === "additional") return "extra";
  return line.productId === mainId ? "main" : "package";
};

/**
 * Pure: delivered orders → main-product cells, extras, order cells and a
 * day-by-day total for every day in [start, end].
 */
export function buildSold(
  rows: SoldRow[],
  linesOf: (row: SoldRow) => SourcedLine[],
  args: { start: string; end: string; productIds: Set<string> | null; tidyState?: (state: string) => string }
) {
  const lines = new Map<string, SoldLine>();
  const extras = new Map<string, SoldExtra>();
  const orderCells = new Map<string, SoldOrderCell>();
  const days = new Map<string, SoldDay>();
  for (const row of rows) {
    const day = String(row.delivered_date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < args.start || day > args.end) continue;
    const mainId = String(row.product_id ?? "");
    if (!mainId) continue;
    if (args.productIds && !args.productIds.has(mainId)) continue;
    const raw = String(row.state ?? "").trim().replace(/\s+/g, " ");
    const state = (raw && args.tidyState ? args.tidyState(raw) : raw) || "No state";
    const agentId = row.agent_id ? String(row.agent_id) : "";

    let mainPieces = 0;
    const withIt = new Map<string, { itemId: string; kind: ExtraKind; pieces: number }>();
    for (const line of linesOf(row)) {
      if (!line.productId || !(line.quantity > 0)) continue;
      const kind = kindOf(line, mainId);
      if (kind === "main") { mainPieces += line.quantity; continue; }
      const key = `${line.productId}|${kind}`;
      const entry = withIt.get(key) ?? { itemId: line.productId, kind, pieces: 0 };
      entry.pieces += line.quantity;
      withIt.set(key, entry);
    }
    // A package made only of other products still sold the main product once per order unit.
    if (mainPieces === 0) mainPieces = Math.max(1, Math.round(Number(row.quantity) || 1));

    const dayEntry = days.get(day) ?? { day, pieces: 0, orders: 0 };
    dayEntry.pieces += mainPieces; dayEntry.orders += 1;
    days.set(day, dayEntry);
    const cellKey = `${day}|${state}|${agentId}`;
    const cell = orderCells.get(cellKey) ?? { day, state, agentId, orders: 0 };
    cell.orders += 1;
    orderCells.set(cellKey, cell);
    const key = `${day}|${mainId}|${state}|${agentId}`;
    const entry = lines.get(key) ?? { day, productId: mainId, state, agentId, pieces: 0, orders: 0 };
    entry.pieces += mainPieces; entry.orders += 1;
    lines.set(key, entry);
    for (const extra of withIt.values()) {
      const ek = `${key}|${extra.itemId}|${extra.kind}`;
      const e = extras.get(ek) ?? { day, productId: mainId, itemId: extra.itemId, kind: extra.kind, state, agentId, pieces: 0 };
      e.pieces += extra.pieces;
      extras.set(ek, e);
    }
  }
  const byDay = (a: { day: string }, b: { day: string }) => a.day.localeCompare(b.day);
  return {
    lines: [...lines.values()].sort(byDay), extras: [...extras.values()].sort(byDay),
    orderCells: [...orderCells.values()].sort(byDay), days: [...days.values()].sort(byDay)
  };
}
