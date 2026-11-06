// ── Telegram commands for leadership: wording (Bright, 6 Nov 2026) ─────────
// "Commands for admin and owner/manager, strictly: this week, last week,
// side by side, best upselling and cross-selling, fines (sales reps see their
// own), best product, best sales rep, product trends."
//
// Pure: lib/telegram-insights.ts loads the numbers. Each number follows the
// app page that already shows it, so the two never disagree:
//  - company:  the Dashboard. Delivered by the day delivered; rate =
//              delivered ÷ orders in.
//  - reps:     the Manager Dashboard. Rate = of the orders a rep got in the
//              period, how many are delivered.
//  - upsells:  the Upsell Performance page. Delivered orders by the day
//              delivered; best = highest rate among Sales Reps with 5+.
//  - fines:    the weekly report. By the day logged; a fine under appeal is
//              not taken off until it is decided.
//  - products: Product Trend. Orders placed in the period, delivered of them.
//  - trend:    the Weekly Check-up. Last full week against the 4 weeks
//              before, each counted the same number of days after it ended.

import { tgEscape } from "./telegram-api.js";
import { naira, seesBusinessMoney, seesRevenue, type BusinessReport, type KeyboardSpec } from "./telegram-rules.js";

export type Reply = { text: string; keyboard?: KeyboardSpec };

// ── Weeks (Sunday to Saturday, Lagos date keys) ─────────────────────────────

const addDays = (key: string, days: number) => new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const sundayOf = (key: string) => addDays(key, -new Date(`${key}T00:00:00Z`).getUTCDay());
const noon = (key: string) => new Date(`${key}T12:00:00Z`);
const weekdayOf = (key: string) => noon(key).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const monthOf = (key: string) => noon(key).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

/** "Fri 6 Nov", "Sun 1 – Fri 6 Nov", "Sun 25 Oct – Sat 31 Oct". */
export function rangeLabel(from: string, to: string) {
  const day = (key: string) => noon(key).getUTCDate();
  if (from === to) return `${weekdayOf(from)} ${day(from)} ${monthOf(from)}`;
  const sameMonth = monthOf(from) === monthOf(to) && from.slice(0, 4) === to.slice(0, 4);
  return `${weekdayOf(from)} ${day(from)}${sameMonth ? "" : ` ${monthOf(from)}`} – ${weekdayOf(to)} ${day(to)} ${monthOf(to)}`;
}

export type Period = { from: string; to: string; label: string };

/** This week so far, last week, the same days of last week, and the week before last. */
export function weekPeriods(today: string) {
  const start = sundayOf(today);
  const lastStart = addDays(start, -7);
  const make = (from: string, to: string): Period => ({ from, to, label: rangeLabel(from, to) });
  return {
    today,
    thisWeek: make(start, today),
    lastWeek: make(lastStart, addDays(start, -1)),
    sameDaysLastWeek: make(lastStart, addDays(today, -7)),
    weekBefore: make(addDays(lastStart, -7), addDays(lastStart, -1))
  };
}

/** "/reps last", "/fines last week", "/compare full". */
export const wantsLastWeek = (args: string) => /^\s*(last|lastweek|prev|previous|full)\b/i.test(args);

// ── Numbers as text ─────────────────────────────────────────────────────────

/** Whole percent of part ÷ whole, or null when there is nothing to divide. */
export const percentOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
const pct0 = (value: number | null) => (value === null ? "–" : `${Math.round(value)}%`);
const pct1 = (value: number | null) => (value === null ? "–" : `${Math.round(value * 10) / 10}%`);
const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** Short money for the side-by-side table: ₦9,500 · ₦45,000 · ₦420k · ₦3.45m. */
export function shortNaira(value: number) {
  const v = Math.round(Number(value) || 0);
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}₦${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}m`;
  if (a >= 100_000) return `${sign}₦${Math.round(a / 1000)}k`;
  return `${sign}₦${a.toLocaleString("en-NG")}`;
}

/**
 * The change column. Rates move in points; small counts (both under 20) by
 * how many, so 3 → 7 reads "+4", not "+133%"; the rest in percent.
 */
export function changeText(now: number | null, before: number | null, kind: "count" | "money" | "rate"): string {
  if (now === null || before === null) return "";
  if (kind === "rate") {
    const points = Math.round(now - before);
    return points === 0 ? "same" : `${points > 0 ? "+" : ""}${points}pt`;
  }
  if (Math.round(now) === Math.round(before)) return "same";
  if (kind === "count" && Math.max(now, before) < 20) {
    const diff = Math.round(now - before);
    return `${diff > 0 ? "+" : ""}${diff}`;
  }
  if (before === 0) return "new";
  const change = Math.round(((now - before) / Math.abs(before)) * 100);
  if (change === 0) return "same";
  return `${change > 0 ? "+" : ""}${Math.max(-999, Math.min(999, change))}%`;
}

// ── /week and /lastweek ─────────────────────────────────────────────────────

export type FineTotals = { count: number; amount: number; heldCount: number; heldAmount: number };
export type TopRep = { name: string; orders: number; delivered: number };

export function weekDraft(input: {
  heading: string; period: Period; report: BusinessReport; fines: FineTotals; topRep: TopRep | null; live: boolean;
}, role: string): Reply {
  const { report, fines } = input;
  const revenue = seesRevenue(role);
  const money = seesBusinessMoney(role);
  const rate = percentOf(report.delivered, report.ordersIn);
  const lines = [
    `📊 <b>${tgEscape(input.heading)} · ${tgEscape(input.period.label)}</b>`,
    ``,
    `Orders in: <b>${report.ordersIn}</b>`,
    ...report.topProducts.slice(0, 3).map((row) => `  • ${tgEscape(row.name)}: ${row.orders}`),
    `Delivered: <b>${report.delivered}</b>${revenue ? ` · ${naira(report.deliveredRevenue)}` : ""}`,
    `Delivery rate: <b>${pct0(rate)}</b> (delivered ÷ orders in)`,
    `Failed: ${report.failed} · Cancelled: ${report.cancelled}`,
    `Sent out late (past 15 min): ${report.lateSendOuts}`,
    ...(input.live ? [`Still New right now: ${report.stillNew}`] : []),
    `Fines: ${fines.count} · ${naira(fines.amount)}${fines.heldCount ? ` (${fines.heldCount} more under appeal, ${naira(fines.heldAmount)})` : ""}`,
    ...(money && report.adSpend != null ? [`Ad spend: ${naira(report.adSpend)}${report.ordersIn ? ` · ${naira(report.adSpend / report.ordersIn)} per order` : ""}`] : []),
    ...(input.topRep ? [``, `🏆 Most delivered: <b>${tgEscape(input.topRep.name)}</b> – ${input.topRep.delivered} of ${input.topRep.orders} orders`] : []),
    ``,
    `More: /compare · /reps · /products · /upsells · /fines`
  ];
  return { text: lines.join("\n"), keyboard: [[{ text: "📈 Open Dashboard", path: "/dashboard" }]] };
}

// ── /compare: side by side ──────────────────────────────────────────────────

export type CompareSide = BusinessReport & { finesAmount: number };

const LABEL_W = 9;
const VALUE_W = 7;
const CHANGE_W = 5;
const cell = (text: string, width: number) => (text.length >= width ? text : " ".repeat(width - text.length) + text);
const row = (label: string, a: string, b: string, change: string) =>
  `${label.padEnd(LABEL_W)} ${cell(a, VALUE_W)} ${cell(b, VALUE_W)} ${cell(change, CHANGE_W)}`.trimEnd();

/**
 * This period against the one before, in a fixed-width table (Telegram
 * shows <pre> in a typewriter font, so the columns line up on a phone).
 */
export function compareDraft(input: {
  heading: string; nowLabel: string; beforeLabel: string; nowColumn: string; beforeColumn: string;
  now: CompareSide; before: CompareSide;
}, role: string): Reply {
  const { now, before } = input;
  const revenue = seesRevenue(role);
  const money = seesBusinessMoney(role);
  const rateNow = percentOf(now.delivered, now.ordersIn);
  const rateBefore = percentOf(before.delivered, before.ordersIn);
  const perOrder = (side: CompareSide) => (side.adSpend != null && side.ordersIn > 0 ? side.adSpend / side.ordersIn : null);
  type Line = { label: string; now: number | null; before: number | null; kind: "count" | "money" | "rate" };
  const table: Line[] = [
    { label: "Orders", now: now.ordersIn, before: before.ordersIn, kind: "count" },
    { label: "Delivered", now: now.delivered, before: before.delivered, kind: "count" },
    ...(revenue ? [{ label: "Revenue", now: now.deliveredRevenue, before: before.deliveredRevenue, kind: "money" as const }] : []),
    { label: "Del. rate", now: rateNow, before: rateBefore, kind: "rate" },
    { label: "Failed", now: now.failed, before: before.failed, kind: "count" },
    { label: "Cancelled", now: now.cancelled, before: before.cancelled, kind: "count" },
    { label: "Late send", now: now.lateSendOuts, before: before.lateSendOuts, kind: "count" },
    { label: "Fines", now: now.finesAmount, before: before.finesAmount, kind: "money" },
    ...(money && now.adSpend != null && before.adSpend != null ? [
      { label: "Ad spend", now: now.adSpend, before: before.adSpend, kind: "money" as const },
      { label: "Per order", now: perOrder(now), before: perOrder(before), kind: "money" as const }
    ] : [])
  ];
  const show = (line: Line, value: number | null) => value === null ? "–" : line.kind === "money" ? shortNaira(value) : line.kind === "rate" ? pct0(value) : String(value);
  const body = [
    row("", input.nowColumn, input.beforeColumn, "+/-"),
    ...table.map((line) => row(line.label, show(line, line.now), show(line, line.before), changeText(line.now, line.before, line.kind)))
  ];
  // The moves worth a sentence: orders, delivered, revenue (10%+), delivery rate (3+ points).
  const moves: string[] = [];
  const percentMove = (name: string, a: number, b: number) => {
    if (b <= 0 || Math.max(a, b) < 10) return;
    const change = Math.round(((a - b) / b) * 100);
    if (Math.abs(change) >= 10) moves.push(`${change > 0 ? "📈" : "📉"} ${name} ${change > 0 ? "up" : "down"} ${Math.abs(change)}%`);
  };
  percentMove("Orders", now.ordersIn, before.ordersIn);
  percentMove("Delivered", now.delivered, before.delivered);
  if (revenue) percentMove("Revenue", now.deliveredRevenue, before.deliveredRevenue);
  if (rateNow !== null && rateBefore !== null && Math.abs(Math.round(rateNow - rateBefore)) >= 3) {
    const points = Math.round(rateNow - rateBefore);
    moves.push(`${points > 0 ? "📈" : "📉"} Delivery rate ${points > 0 ? "up" : "down"} ${Math.abs(points)} points`);
  }
  return {
    text: [
      `📊 <b>${tgEscape(input.heading)}</b>`,
      `${tgEscape(input.nowLabel)} vs ${tgEscape(input.beforeLabel)}`,
      `<pre>${tgEscape(body.join("\n"))}</pre>`,
      moves.length ? moves.join("\n") : "No big changes.",
      ``,
      `Delivery rate = delivered ÷ orders in. +/- is how many more or fewer when both counts are under 20, otherwise the % change.`
    ].join("\n"),
    keyboard: [[{ text: "📈 Open Dashboard", path: "/dashboard" }]]
  };
}

// ── /reps: best sales reps ──────────────────────────────────────────────────

export type RepRow = { repId: string; name: string; orders: number; delivered: number; lateSends: number; finesAmount: number };
/** Fewer orders than this: listed, not ranked. */
export const MIN_ORDERS_TO_RANK = 5;
/** Best delivery rate needs this many orders, or one lucky order wins it. */
export const MIN_ORDERS_FOR_RATE = 10;
const MEDALS = ["🥇", "🥈", "🥉"];

/** Most delivered first; a tie goes to the better rate. */
export function rankReps(rows: RepRow[]) {
  const rate = (row: RepRow) => percentOf(row.delivered, row.orders) ?? -1;
  const ranked = rows.filter((row) => row.orders >= MIN_ORDERS_TO_RANK)
    .sort((a, b) => b.delivered - a.delivered || rate(b) - rate(a) || a.name.localeCompare(b.name));
  const unranked = rows.filter((row) => row.orders < MIN_ORDERS_TO_RANK).sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name));
  const bestRate = rows.filter((row) => row.orders >= MIN_ORDERS_FOR_RATE)
    .sort((a, b) => rate(b) - rate(a) || b.delivered - a.delivered || a.name.localeCompare(b.name))[0] ?? null;
  return { ranked, unranked, bestRate };
}

export function repsDraft(input: { heading: string; period: Period; rows: RepRow[] }): Reply {
  const { ranked, unranked, bestRate } = rankReps(input.rows);
  const extras = (row: RepRow) => [
    row.lateSends ? plural(row.lateSends, "late send") : "",
    row.finesAmount ? `${naira(row.finesAmount)} fines` : ""
  ].filter(Boolean).map((text) => ` · ${text}`).join("");
  const line = (row: RepRow, place: string) =>
    `${place} ${tgEscape(row.name)} – ${row.delivered} of ${row.orders} delivered (${pct0(percentOf(row.delivered, row.orders))})${extras(row)}`;
  const lines = [
    `🏆 <b>${tgEscape(input.heading)}</b>`,
    tgEscape(input.period.label),
    ``
  ];
  if (!ranked.length && !unranked.length) {
    lines.push("No sales rep had orders in this period.");
  } else {
    if (ranked[0]) lines.push(`Most delivered: <b>${tgEscape(ranked[0].name)}</b> (${ranked[0].delivered})`);
    if (bestRate) lines.push(`Best delivery rate (${MIN_ORDERS_FOR_RATE}+ orders): <b>${tgEscape(bestRate.name)}</b> (${pct0(percentOf(bestRate.delivered, bestRate.orders))})`);
    if (ranked.length) lines.push(``);
    ranked.forEach((row, index) => lines.push(line(row, MEDALS[index] ?? `${index + 1}.`)));
    for (const row of unranked) lines.push(`${line(row, "•")} · too few orders to rank`);
    lines.push(``, `Rate = of the orders a rep got in this period, how many are delivered so far (as on the Manager Dashboard).`);
  }
  return { text: lines.join("\n"), keyboard: [[{ text: "Open Manager Dashboard", path: "/dashboard/admin/manager-overview" }]] };
}

// ── /upsells: best at upselling and cross-selling ───────────────────────────

export type UpsellRow = { repId: string; name: string; salesRep: boolean; delivered: number; upsell: number; cross: number; either: number };
/** The Upsell Performance page's MIN_DELIVERED_TO_RANK. */
export const MIN_DELIVERED_TO_RANK = 5;

/** The page's "Best rate": Sales Reps with 5+ delivered, highest rate, then most orders. */
export function bestAt(rows: UpsellRow[], kind: "upsell" | "cross") {
  return rows
    .filter((row) => row.salesRep && row.delivered >= MIN_DELIVERED_TO_RANK)
    .map((row) => ({ row, rate: (row[kind] / row.delivered) * 100 }))
    .sort((a, b) => b.rate - a.rate || b.row[kind] - a.row[kind] || a.row.name.localeCompare(b.row.name))[0] ?? null;
}

export function upsellsDraft(input: { heading: string; period: Period; rows: UpsellRow[] }): Reply {
  const total = (pick: (row: UpsellRow) => number) => input.rows.reduce((sum, row) => sum + pick(row), 0);
  const delivered = total((row) => row.delivered);
  const upsold = total((row) => row.upsell);
  const crossSold = total((row) => row.cross);
  const either = total((row) => row.either);
  const lines = [
    `🔼 <b>${tgEscape(input.heading)}</b>`,
    tgEscape(input.period.label),
    ``,
    `Delivered orders: <b>${delivered}</b>`,
    `Upsold: <b>${upsold}</b> (${pct1(percentOf(upsold, delivered))}) · Cross-sold: <b>${crossSold}</b> (${pct1(percentOf(crossSold, delivered))})`,
    `Upsold or cross-sold: ${either} (${pct1(percentOf(either, delivered))})`
  ];
  const bestUp = bestAt(input.rows, "upsell");
  const bestCross = bestAt(input.rows, "cross");
  if (bestUp || bestCross) lines.push(``);
  if (bestUp) lines.push(`🥇 Best at upselling: <b>${tgEscape(bestUp.row.name)}</b> – ${bestUp.row.upsell} of ${bestUp.row.delivered} delivered (${pct1(bestUp.rate)})`);
  if (bestCross) lines.push(`🥇 Best at cross-selling: <b>${tgEscape(bestCross.row.name)}</b> – ${bestCross.row.cross} of ${bestCross.row.delivered} delivered (${pct1(bestCross.rate)})`);
  const reps = input.rows.filter((row) => row.salesRep && row.delivered > 0)
    .sort((a, b) => b.either - a.either || b.delivered - a.delivered || a.name.localeCompare(b.name));
  const others = input.rows.filter((row) => !row.salesRep && row.delivered > 0);
  if (reps.length || others.length) {
    lines.push(``, `<b>By rep</b> (upsold · cross-sold, of their delivered orders)`);
    for (const row of reps) {
      lines.push(`• ${tgEscape(row.name)}: ${row.upsell} (${pct1(percentOf(row.upsell, row.delivered))}) · ${row.cross} (${pct1(percentOf(row.cross, row.delivered))}) of ${row.delivered}`);
    }
    if (others.length) {
      lines.push(`• Other staff: ${total((row) => row.salesRep ? 0 : row.upsell)} · ${total((row) => row.salesRep ? 0 : row.cross)} of ${total((row) => row.salesRep ? 0 : row.delivered)}`);
    }
  }
  lines.push(``, `Counted on the day delivered. Best = highest rate among sales reps with ${MIN_DELIVERED_TO_RANK}+ delivered orders (as on the Upsell Performance page).`);
  return { text: lines.join("\n"), keyboard: [[{ text: "Open Manager Dashboard", path: "/dashboard/admin/manager-overview" }]] };
}

// ── /fines ──────────────────────────────────────────────────────────────────

export type FineItem = { repId: string; repName: string; amount: number; label: string; date: string; held: boolean };
/** Missed follow-up and cart logs: approved = taken off at the weekly report; pending = waiting for approval. */
export type MissedLogs = { approved: number; pending: number };

const fineSums = (fines: FineItem[]) => ({ count: fines.length, amount: fines.reduce((sum, fine) => sum + fine.amount, 0) });
const shortDay = (key: string) => `${weekdayOf(key)} ${noon(key).getUTCDate()} ${monthOf(key)}`;

export function fineTotals(fines: FineItem[]): FineTotals {
  const kept = fineSums(fines.filter((fine) => !fine.held));
  const held = fineSums(fines.filter((fine) => fine.held));
  return { count: kept.count, amount: kept.amount, heldCount: held.count, heldAmount: held.amount };
}

const logsLine = (logs: MissedLogs | null) => {
  const parts = logs ? [logs.approved > 0 ? `${naira(logs.approved)} approved` : "", logs.pending > 0 ? `${naira(logs.pending)} waiting for approval` : ""].filter(Boolean) : [];
  return parts.length ? [`Missed logs: ${parts.join(" · ")}`] : [];
};

/** Leadership: every rep's fines in the period. */
export function finesLeaderDraft(input: {
  heading: string; period: Period; fines: FineItem[]; logs: MissedLogs | null; previous: { label: string; fines: FineItem[] } | null;
}): Reply {
  const totals = fineTotals(input.fines);
  const byRep = new Map<string, { name: string; count: number; amount: number }>();
  for (const fine of input.fines.filter((row) => !row.held)) {
    const entry = byRep.get(fine.repId) ?? { name: fine.repName, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += fine.amount;
    byRep.set(fine.repId, entry);
  }
  const previous = input.previous ? fineTotals(input.previous.fines) : null;
  const lines = [
    `⚖️ <b>${tgEscape(input.heading)}</b>`,
    tgEscape(input.period.label),
    ``,
    totals.count ? `Fines: <b>${totals.count}</b> · <b>${naira(totals.amount)}</b>` : `✅ No fines logged.`,
    ...[...byRep.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
      .map((entry) => `• ${tgEscape(entry.name)}: ${entry.count} · ${naira(entry.amount)}`),
    ...(totals.heldCount ? [`Under appeal (not taken off yet): ${totals.heldCount} · ${naira(totals.heldAmount)}`] : []),
    ...logsLine(input.logs),
    ...(previous && input.previous ? [``, `${tgEscape(input.previous.label)}: ${plural(previous.count, "fine")} · ${naira(previous.amount)}`] : [])
  ];
  return { text: lines.join("\n"), keyboard: [[{ text: "Open Weekly Reports", path: "/dashboard/admin/weekly-reports" }]] };
}

/** A rep: only their own fines. */
export function finesRepDraft(input: {
  heading: string; period: Period; fines: FineItem[]; logs: MissedLogs | null; previous: { label: string; fines: FineItem[] } | null;
}): Reply {
  const kept = input.fines.filter((fine) => !fine.held);
  const held = input.fines.filter((fine) => fine.held);
  const previous = input.previous ? fineTotals(input.previous.fines) : null;
  const item = (fine: FineItem) => `• ${naira(fine.amount)} – ${tgEscape(fine.label.split("\n")[0].slice(0, 120))} · ${shortDay(fine.date)}`;
  const lines = [
    `⚖️ <b>${tgEscape(input.heading)}</b>`,
    tgEscape(input.period.label),
    ``,
    ...(kept.length ? [...kept.map(item), `Total: <b>${naira(fineSums(kept).amount)}</b>`] : [`✅ No fines.`]),
    ...(held.length ? [``, `Under appeal (not taken off while your appeal is open):`, ...held.map(item)] : []),
    ...logsLine(input.logs),
    ...(previous && input.previous ? [``, `${tgEscape(input.previous.label)}: ${plural(previous.count, "fine")} · ${naira(previous.amount)}`] : []),
    ...(kept.length ? [``, `If a fine is wrong, appeal it in Protohub.`] : [])
  ];
  return { text: lines.join("\n"), keyboard: [[{ text: "Open Protohub", path: "/dashboard/sales-rep" }]] };
}

// ── /products: best products ────────────────────────────────────────────────

export type ProductRow = { name: string; orders: number; delivered: number; revenue: number; ordersBefore: number };

export function productsDraft(input: { heading: string; period: Period; beforeLabel: string; rows: ProductRow[] }, role: string): Reply {
  const revenue = seesRevenue(role);
  const rows = [...input.rows].filter((row) => row.orders > 0)
    .sort((a, b) => (revenue ? b.revenue - a.revenue : 0) || b.delivered - a.delivered || b.orders - a.orders || a.name.localeCompare(b.name));
  const lines = [`⭐ <b>${tgEscape(input.heading)}</b>`, tgEscape(input.period.label), ``];
  if (!rows.length) lines.push("No orders in this period.");
  rows.slice(0, 8).forEach((row, index) => {
    const change = changeText(row.orders, row.ordersBefore, "count");
    lines.push(
      `${MEDALS[index] ?? `${index + 1}.`} <b>${tgEscape(row.name)}</b>${revenue ? ` – ${naira(row.revenue)}` : ""}`,
      `    ${plural(row.orders, "order")}${change && change !== "same" ? ` (${change} vs ${tgEscape(input.beforeLabel)})` : ""} · ${row.delivered} delivered (${pct0(percentOf(row.delivered, row.orders))})`
    );
  });
  if (rows.length > 8) lines.push(`…and ${rows.length - 8} more`);
  if (rows.length) lines.push(``, `${revenue ? "Ranked by money from delivered orders. " : ""}Delivered = of the orders placed in this period, how many are delivered so far (as on Product Trend).`);
  return { text: lines.join("\n"), keyboard: [[{ text: "Open Product Trend", path: "/dashboard/admin/product-trend" }]] };
}

// ── /trend: product trends ──────────────────────────────────────────────────

export type TrendVerdict = "strong" | "steady" | "weak" | "new" | "small";
export type TrendRow = {
  name: string;
  /** Orders per week, oldest first: the 4 weeks before, then last week. */
  weeks: number[];
  thisWeekSoFar: number;
  last: { orders: number; rate: number | null; profit: number };
  usual: { orders: number; rate: number | null; profit: number } | null;
  /** The Weekly Check-up's verdict (it is judged on profit after ads). */
  verdict: TrendVerdict;
};

const VERDICT_TEXT: Record<TrendVerdict, string> = {
  strong: "🟢 Strong week",
  steady: "⚪ Steady",
  weak: "🔴 Weak week",
  new: "🆕 Too new to judge",
  small: "Too few orders to judge"
};

export function trendDraft(input: { lastWeekLabel: string; ageDays: number; rows: TrendRow[] }, role: string): Reply {
  // The verdict and profit include ad spend: the Owner and Admins only.
  const money = seesBusinessMoney(role);
  const rows = [...input.rows].sort((a, b) => b.last.orders - a.last.orders || b.thisWeekSoFar - a.thisWeekSoFar || a.name.localeCompare(b.name));
  const lines = [
    `📈 <b>Product trends · last week vs the usual week</b>`,
    `Last week: ${tgEscape(input.lastWeekLabel)}. Usual week = average of the 4 weeks before.`,
    ``
  ];
  if (!rows.length) lines.push("No product had orders in the last 5 weeks.");
  for (const row of rows.slice(0, 8)) {
    const usual = row.usual;
    const ordersChange = usual ? changeText(row.last.orders, usual.orders, "count") : "";
    const rateChange = usual && row.last.rate !== null && usual.rate !== null ? changeText(row.last.rate, usual.rate, "rate") : "";
    lines.push(
      `<b>${tgEscape(row.name)}</b>${money ? ` ${VERDICT_TEXT[row.verdict]}` : ""}`,
      `    Orders ${row.last.orders}${usual ? ` (usual ${Math.round(usual.orders)}${ordersChange && ordersChange !== "same" ? `, ${ordersChange}` : ""})` : ""} · delivered ${pct0(row.last.rate)}${usual ? ` (usual ${pct0(usual.rate)}${rateChange && rateChange !== "same" ? `, ${rateChange.replace("pt", " pts")}` : ""})` : ""}`,
      ...(money && usual ? [`    Profit after ads ${shortNaira(row.last.profit)} (usual ${shortNaira(usual.profit)})`] : []),
      `    Orders a week: ${row.weeks.join(" → ")} · this week so far ${row.thisWeekSoFar}`,
      ``
    );
  }
  if (rows.length > 8) lines.push(`…and ${rows.length - 8} more`, ``);
  if (rows.length) {
    lines.push(`Orders a week = the 5 weeks up to last week, oldest first. Delivery rates are counted ${plural(input.ageDays, "day")} after each week ended, so older weeks are not favoured (as the Weekly Check-up).`);
  }
  return { text: lines.join("\n"), keyboard: [[{ text: "Open Product Trend", path: "/dashboard/admin/product-trend" }]] };
}
