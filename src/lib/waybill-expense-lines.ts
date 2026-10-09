// One line per product-week on the Expenses page (Bright, 9 Oct 2026).
//
// A product's weekly waybill cost is stored as the typed weekly total (less
// what the manager's wallet paid) plus each wallet payment ("MGRF-..."). The
// money is right, but it read as several costs for the same waybills. The
// table shows them as ONE line: the full amount, and how much came from the
// wallet. Display only - every row is still stored and counted as it was, and
// the line's amount is the sum of its rows, so totals never change.

export const WAYBILL_LINES_FROM = "2026-09-27"; // backend WAYBILL_ONCE_FROM

type Row = { id: string; type: string; amount: number; date: string; createdAt?: string; productId?: string; description: string; waybillId?: string };
export type WaybillLine<T extends Row> = T & { walletPaid?: number; walletCount?: number; partIds?: string[] };

const sundayOf = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
};
const isWallet = (row: Row) => row.id.startsWith("MGRF-");
const joins = (row: Row) => row.type === "Waybill" && !!row.productId && row.date >= WAYBILL_LINES_FROM
  && !row.waybillId && !row.id.startsWith("EXP-WB-");
/** The typed total's own words, without the "[total ...; ... already paid ...]" note. */
const plainText = (text: string) => text.split(" · [")[0].replace(/ · share \d+ of \d+$/, "");

export function mergeWaybillWeeks<T extends Row>(rows: T[]): Array<WaybillLine<T>> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (!joins(row)) continue;
    const key = `${sundayOf(row.date)}|${row.productId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const merged = new Map<string, WaybillLine<T>>(); // first row's id -> line
  const absorbed = new Set<string>();
  for (const parts of groups.values()) {
    if (parts.length < 2) continue;
    const lead = parts.find((row) => !isWallet(row)) ?? parts[0];
    const wallet = parts.filter(isWallet);
    const latest = parts.reduce((best, row) => (row.date > best.date || (row.date === best.date && (row.createdAt ?? "") > (best.createdAt ?? "")) ? row : best), parts[0]);
    merged.set(parts[0].id, {
      ...lead,
      date: latest.date,
      createdAt: latest.createdAt ?? lead.createdAt,
      amount: Math.round(parts.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
      description: plainText(lead.description),
      walletPaid: Math.round(wallet.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
      walletCount: wallet.length,
      partIds: parts.map((row) => row.id)
    });
    parts.forEach((row) => absorbed.add(row.id));
  }
  const out: Array<WaybillLine<T>> = [];
  for (const row of rows) {
    if (merged.has(row.id)) out.push(merged.get(row.id)!);
    else if (!absorbed.has(row.id)) out.push(row);
  }
  return out;
}
