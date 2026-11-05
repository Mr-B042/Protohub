/**
 * Product Trend › Weekly Check-up (Bright, 5 Nov 2026): for each product, why
 * a week went well or badly, in naira, and what to fix.
 *
 * Bright's choices: compared with the AVERAGE OF THE 4 WEEKS BEFORE (weeks
 * with no orders and no ad spend are skipped); CPC from Meta clicks (saved
 * from 5 Nov 2026, so older weeks have no CPC).
 *
 * Weeks are Sunday to Saturday (Lagos), orders counted in the week PLACED.
 *
 * ⚠️ LIKE FOR LIKE. Last week's orders are still being delivered, so its
 * delivery rate would always look worse than older weeks'. Every week is
 * counted as it stood the same number of days after it ended: an older week's
 * order only counts as delivered if its delivered_date is within that age.
 *
 * Profit after ads = delivered revenue − product cost − delivery fees − ad
 * spend (Monthly Performance's figure). It splits exactly into four parts:
 *   P = orders × (rate × margin per delivered order − ad cost per order)
 * and the change against the usual week is split the same way, one part at
 * a time (orders, then delivery rate, then margin, then ad cost), so the four
 * naira amounts add up to the whole change.
 */

export const WEEKLY_RULES = {
  baselineWeeks: 4,
  /** Fewer previous active weeks than this: too new to compare. */
  minBaselineWeeks: 2,
  /** Fewer orders than this in the week: figures only, no verdict. */
  minOrders: 5,
  /** A week is strong/weak when profit moves by this share of the usual... */
  moveShare: 0.15,
  /** ...and by at least this many naira (small products jump around). */
  moveFloor: 10_000,
  /** A cost or rate counts as "changed" past this share. */
  changeShare: 0.15
};

export type WeeklyOrder = {
  productId: string;
  /** Sunday of the week placed (Lagos). */
  week: string;
  placedAt: number;
  status: string;
  deliveredDate: string | null;
  amount: number;
  productCost: number;
  deliveryFee: number;
  state: string | null;
  upsold: boolean;
  /** call_outcome of a Failed / Cancelled order. */
  failReason: string | null;
};

export type WeeklyAdDay = { productId: string; day: string; spend: number };
/** Meta pieces with clicks (null before clicks were saved). */
export type WeeklyClickDay = { productId: string; day: string; spend: number; linkClicks: number | null; impressions: number | null };
export type WeeklyCart = { productId: string; week: string };

/** noHub: no hub in that state has ever held the product. */
export type StockOut = { state: string; daysOut: number; ordersWhileOut: number; noHub?: boolean };

export type WeekFigures = {
  week: string;
  orders: number;
  delivered: number;
  /** Delivered ÷ orders (like for like), %. */
  rate: number | null;
  revenue: number;
  productCost: number;
  deliveryFees: number;
  adSpend: number;
  profit: number;
  /** Form starts (carts) for the product. */
  carts: number;
  /** Orders ÷ form starts, %. */
  formRate: number | null;
  costPerOrder: number | null;
  /** Ad spend ÷ link clicks (Meta, days with clicks only). */
  cpc: number | null;
  linkClicks: number | null;
  /** Link clicks ÷ impressions, %. */
  ctr: number | null;
  clicksPerOrder: number | null;
  aov: number | null;
  /** (revenue − product cost − delivery) ÷ delivered. */
  marginPerDelivered: number | null;
  upsellRate: number | null;
  failed: number;
  /** Placed, not delivered and not failed/cancelled yet (as of now). */
  open: number;
};

export type Driver = {
  key: "orders" | "rate" | "margin" | "adcost";
  label: string;
  /** Naira this part added (+) or took away (−) against the usual week. */
  impact: number;
  headline: string;
  details: string[];
  fix: string | null;
  praise: string | null;
};

export type WeeklyVerdict = "strong" | "steady" | "weak" | "new" | "small";

export type ProductWeek = {
  week: WeekFigures;
  usual: WeekFigures | null;
  baselineWeeks: number;
  verdict: WeeklyVerdict;
  summary: string;
  drivers: Driver[];
  fixes: string[];
  wins: string[];
  stockOuts: StockOut[];
  failReasons: Array<{ reason: string; count: number }>;
  history: Array<{ week: string; profit: number; orders: number; rate: number | null }>;
};

const naira = (value: number) => `₦${Math.round(Math.abs(value)).toLocaleString("en-NG")}`;
const signed = (value: number) => `${value < 0 ? "−" : "+"}${naira(value)}`;
/** A sum of money, minus only when below zero. */
const amount = (value: number) => `${value < 0 ? "−" : ""}${naira(value)}`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const pct = (value: number | null) => (value === null ? "-" : `${Math.round(value * 10) / 10}%`);
const div = (a: number, b: number) => (b > 0 ? a / b : null);
const up = (now: number | null, usual: number | null, share = WEEKLY_RULES.changeShare) =>
  now !== null && usual !== null && usual > 0 && now > usual * (1 + share);
const down = (now: number | null, usual: number | null, share = WEEKLY_RULES.changeShare) =>
  now !== null && usual !== null && usual > 0 && now < usual * (1 - share);

/** Figures of one week for one product, delivered counted up to `cutoff` (a date key). */
export function weekFigures(input: {
  week: string; weekEnd: string; cutoff: string;
  orders: WeeklyOrder[]; ads: WeeklyAdDay[]; clicks: WeeklyClickDay[]; carts: number;
}): WeekFigures {
  const orders = input.orders;
  const delivered = orders.filter((order) => order.status === "Delivered" && (!order.deliveredDate || order.deliveredDate <= input.cutoff));
  const revenue = delivered.reduce((sum, order) => sum + order.amount, 0);
  const productCost = delivered.reduce((sum, order) => sum + order.productCost, 0);
  const deliveryFees = delivered.reduce((sum, order) => sum + order.deliveryFee, 0);
  const inWeek = (day: string) => day >= input.week && day <= input.weekEnd;
  const adSpend = input.ads.filter((row) => inWeek(row.day)).reduce((sum, row) => sum + row.spend, 0);
  const clickRows = input.clicks.filter((row) => inWeek(row.day) && row.linkClicks !== null);
  const clickSpend = clickRows.reduce((sum, row) => sum + row.spend, 0);
  const linkClicks = clickRows.length ? clickRows.reduce((sum, row) => sum + (row.linkClicks ?? 0), 0) : null;
  const impressions = clickRows.length ? clickRows.reduce((sum, row) => sum + (row.impressions ?? 0), 0) : null;
  const margin = revenue - productCost - deliveryFees;
  return {
    week: input.week,
    orders: orders.length,
    delivered: delivered.length,
    rate: orders.length ? (delivered.length / orders.length) * 100 : null,
    revenue, productCost, deliveryFees, adSpend,
    profit: margin - adSpend,
    carts: input.carts,
    formRate: input.carts > 0 ? Math.min(100, (orders.length / input.carts) * 100) : null,
    costPerOrder: adSpend > 0 ? div(adSpend, orders.length) : null,
    cpc: linkClicks ? clickSpend / linkClicks : null,
    linkClicks,
    ctr: impressions ? ((linkClicks ?? 0) / impressions) * 100 : null,
    clicksPerOrder: linkClicks !== null && orders.length ? linkClicks / orders.length : null,
    aov: div(revenue, delivered.length),
    marginPerDelivered: div(margin, delivered.length),
    upsellRate: orders.length ? (orders.filter((order) => order.upsold).length / orders.length) * 100 : null,
    failed: orders.filter((order) => order.status === "Failed" || order.status === "Cancelled").length,
    open: orders.filter((order) => order.status !== "Delivered" && order.status !== "Failed" && order.status !== "Cancelled").length
  };
}

/** The usual week: totals of the active previous weeks, divided by how many there were. */
export function usualWeek(weeks: WeekFigures[]): WeekFigures | null {
  const active = weeks.filter((week) => week.orders > 0 || week.adSpend > 0);
  if (active.length < WEEKLY_RULES.minBaselineWeeks) return null;
  const n = active.length;
  const sum = (pick: (week: WeekFigures) => number) => active.reduce((total, week) => total + pick(week), 0);
  const orders = sum((w) => w.orders), delivered = sum((w) => w.delivered), revenue = sum((w) => w.revenue);
  const productCost = sum((w) => w.productCost), deliveryFees = sum((w) => w.deliveryFees), adSpend = sum((w) => w.adSpend);
  const carts = sum((w) => w.carts);
  const withClicks = active.filter((w) => w.linkClicks !== null && w.cpc !== null);
  const clickSpend = withClicks.reduce((total, w) => total + (w.cpc ?? 0) * (w.linkClicks ?? 0), 0);
  const clicks = withClicks.reduce((total, w) => total + (w.linkClicks ?? 0), 0);
  const clickOrders = withClicks.reduce((total, w) => total + w.orders, 0);
  const ctrWeeks = active.filter((w) => w.ctr !== null);
  const margin = revenue - productCost - deliveryFees;
  const upsold = active.reduce((total, w) => total + ((w.upsellRate ?? 0) / 100) * w.orders, 0);
  return {
    week: "usual",
    orders: orders / n, delivered: delivered / n,
    rate: orders ? (delivered / orders) * 100 : null,
    revenue: revenue / n, productCost: productCost / n, deliveryFees: deliveryFees / n, adSpend: adSpend / n,
    profit: (margin - adSpend) / n,
    carts: carts / n,
    formRate: carts > 0 ? Math.min(100, (orders / carts) * 100) : null,
    costPerOrder: adSpend > 0 ? div(adSpend, orders) : null,
    cpc: clicks > 0 ? clickSpend / clicks : null,
    linkClicks: withClicks.length ? clicks / withClicks.length : null,
    ctr: ctrWeeks.length ? ctrWeeks.reduce((total, w) => total + (w.ctr ?? 0), 0) / ctrWeeks.length : null,
    clicksPerOrder: clicks > 0 && clickOrders > 0 ? clicks / clickOrders : null,
    aov: div(revenue, delivered),
    marginPerDelivered: div(margin, delivered),
    upsellRate: orders ? (upsold / orders) * 100 : null,
    failed: sum((w) => w.failed) / n,
    open: sum((w) => w.open) / n
  };
}

/** The four parts of the change in profit after ads, one at a time (they add up to the whole). */
export function splitChange(now: WeekFigures, usual: WeekFigures) {
  const r0 = (usual.rate ?? 0) / 100, m0 = usual.marginPerDelivered ?? 0, c0 = usual.costPerOrder ?? 0;
  const r1 = (now.rate ?? 0) / 100;
  const m1 = now.marginPerDelivered ?? m0;
  const c1 = now.orders > 0 ? now.adSpend / now.orders : c0;
  const o0 = usual.orders, o1 = now.orders;
  const orders = (o1 - o0) * (r0 * m0 - c0);
  const rate = o1 * (r1 - r0) * m0;
  const margin = o1 * r1 * (m1 - m0);
  const adcost = -o1 * (c1 - c0);
  // When the week had no orders, the ad spend still went out: it sits in ad cost.
  const unexplained = (now.profit - usual.profit) - (orders + rate + margin + adcost);
  return { orders, rate, margin, adcost: adcost + unexplained };
}

const REASON_FIX: Array<[RegExp, string]> = [
  [/(not\s*(answer|pick|reach)|unreach|switch(ed)?\s*off|no\s*answer|can.?t be contacted|not available|busy)/i, "call them faster - within the first hour, and again the same evening"],
  [/(incomplete|wrong|invalid)\s*(number|phone)|number.*(incomplete|wrong)/i, "the form now refuses short numbers; check old orders by WhatsApp"],
  [/(cancel|changed.*mind|not\s*interested|no longer|don.?t want)/i, "confirm the customer still wants it, and the price, on the first call"],
  [/(price|money|expensive|cost|afford|cash)/i, "say the price and payment on delivery clearly before sending it out"],
  [/(travel|out of town|not around|relocat)/i, "agree a date before sending it out, not after"],
  [/(stock|not available in|no stock)/i, "restock that state"],
  [/(fake|prank|joke|test)/i, "check new customers by WhatsApp before sending to the rider"]
];

function fixForReason(reason: string) {
  for (const [pattern, fix] of REASON_FIX) if (pattern.test(reason)) return fix;
  return null;
}

/** Most common reasons failed / cancelled orders gave (rough wording groups). */
export function topFailReasons(orders: WeeklyOrder[], limit = 3) {
  const counts = new Map<string, { reason: string; count: number }>();
  for (const order of orders) {
    if (order.status !== "Failed" && order.status !== "Cancelled") continue;
    const text = String(order.failReason ?? "").trim() || "No reason written";
    const key = text.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    const row = counts.get(key) ?? { reason: text.length > 60 ? `${text.slice(0, 57)}...` : text, count: 0 };
    row.count += 1;
    counts.set(key, row);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/** Judge one product's week against its usual week. */
export function judgeProductWeek(input: {
  week: WeekFigures; previous: WeekFigures[]; targetCpa: number | null;
  stockOuts: StockOut[]; failReasons: Array<{ reason: string; count: number }>; ageDays: number;
}): ProductWeek {
  const now = input.week;
  const usual = usualWeek(input.previous);
  const history = [...input.previous, now].map((w) => ({ week: w.week, profit: w.profit, orders: w.orders, rate: w.rate }));
  const base = { week: now, usual, baselineWeeks: input.previous.filter((w) => w.orders > 0 || w.adSpend > 0).length, stockOuts: input.stockOuts, failReasons: input.failReasons, history };
  const stockFix = input.stockOuts.filter((row) => row.ordersWhileOut > 0 || row.daysOut > 0);
  const stockLine = stockFix.length
    ? `Send stock to ${stockFix.slice(0, 4).map((row) => row.state).join(", ")}: ${plural(stockFix.reduce((sum, row) => sum + row.ordersWhileOut, 0), "order")} came in while it was out of stock there`
    : null;

  if (now.orders < WEEKLY_RULES.minOrders && now.adSpend === 0) {
    return { ...base, verdict: "small", summary: `${now.orders} order${now.orders === 1 ? "" : "s"} this week - too few to judge.`, drivers: [], fixes: stockLine ? [stockLine] : [], wins: [] };
  }
  if (!usual) {
    return { ...base, verdict: "new", summary: `Not enough earlier weeks to compare (needs ${WEEKLY_RULES.minBaselineWeeks}). Profit after ads ${amount(now.profit)}.`, drivers: [], fixes: stockLine ? [stockLine] : [], wins: [] };
  }

  const parts = splitChange(now, usual);
  const drivers: Driver[] = [];

  // Orders
  {
    const details = [`${now.orders} orders (usual ${Math.round(usual.orders)})`];
    if (now.adSpend > 0 || usual.adSpend > 0) details.push(`Ad spend ${naira(now.adSpend)} (usual ${naira(usual.adSpend)})`);
    if (now.carts > 0 || usual.carts > 0) details.push(`${now.carts} people started the form (usual ${Math.round(usual.carts)}); ${pct(now.formRate)} of them ordered (usual ${pct(usual.formRate)})`);
    let fix: string | null = null;
    if (parts.orders < 0) {
      if (down(now.adSpend, usual.adSpend)) fix = `Ad spend was ${Math.round((1 - now.adSpend / usual.adSpend) * 100)}% lower than usual - spend back up if the cost per order is fine`;
      else if (down(now.carts, usual.carts)) fix = "Fewer people reached the form - check the ads are running and the landing page link works";
      else if (down(now.formRate, usual.formRate)) fix = "People started the form but fewer finished - work the abandoned carts and check the price and form";
      else fix = "Fewer orders came in - check the ads and the landing page";
    }
    drivers.push({ key: "orders", label: "Orders", impact: parts.orders, headline: `${now.orders} orders vs usual ${Math.round(usual.orders)}`, details, fix,
      praise: parts.orders > 0 ? (up(now.adSpend, usual.adSpend) ? "More ad spend brought more orders" : up(now.formRate, usual.formRate) ? "More of the people who started the form finished it" : "More orders came in") : null });
  }

  // Delivery rate
  {
    const details = [`${pct(now.rate)} delivered (usual ${pct(usual.rate)}), counted ${input.ageDays} day${input.ageDays === 1 ? "" : "s"} after each week ended`];
    if (now.open > 0) details.push(`${now.open} order${now.open === 1 ? " is" : "s are"} still open and may still deliver`);
    if (input.failReasons.length) details.push(`Main reasons for ${now.failed} failed/cancelled: ${input.failReasons.map((row) => `"${row.reason}" (${row.count})`).join(", ")}`);
    for (const row of stockFix.slice(0, 3)) details.push(`${row.noHub ? `No hub holds it in ${row.state}` : `Out of stock in ${row.state}${row.daysOut ? ` for ${row.daysOut} day${row.daysOut === 1 ? "" : "s"}` : ""}`}${row.ordersWhileOut ? ` - ${row.ordersWhileOut} order${row.ordersWhileOut === 1 ? "" : "s"} came in then` : ""}`);
    let fix: string | null = null;
    if (parts.rate < 0) {
      const top = input.failReasons[0];
      const reasonFix = top ? fixForReason(top.reason) : null;
      fix = top ? `Most failed orders said "${top.reason}" (${top.count})${reasonFix ? ` - ${reasonFix}` : " - go through them with the reps"}`
          : "Delivery rate fell - go through the failed orders with the reps";
    }
    drivers.push({ key: "rate", label: "Delivery rate", impact: parts.rate, headline: `${pct(now.rate)} delivered vs usual ${pct(usual.rate)}`, details, fix,
      praise: parts.rate > 0 ? "More of the orders were delivered" : null });
  }

  // Ad cost per order
  {
    const details: string[] = [];
    if (now.costPerOrder !== null || usual.costPerOrder !== null) details.push(`Cost per order ${now.costPerOrder === null ? "-" : naira(now.costPerOrder)} (usual ${usual.costPerOrder === null ? "-" : naira(usual.costPerOrder)}${input.targetCpa ? `, your target ${naira(input.targetCpa)}` : ""})`);
    if (now.cpc !== null) details.push(`CPC ${naira(now.cpc)} (usual ${usual.cpc === null ? "not saved yet" : naira(usual.cpc)})${now.ctr !== null ? `, ${pct(now.ctr)} of people who saw the ad clicked` : ""}`);
    if (now.clicksPerOrder !== null) details.push(`${Math.round(now.clicksPerOrder * 10) / 10} clicks per order (usual ${usual.clicksPerOrder === null ? "-" : Math.round(usual.clicksPerOrder * 10) / 10})`);
    let fix: string | null = null;
    if (parts.adcost < 0) {
      if (up(now.cpc, usual.cpc)) fix = `Clicks cost more than usual (CPC ${naira(now.cpc!)} vs ${naira(usual.cpc!)}) - refresh the ad picture/video or widen the audience`;
      else if (up(now.clicksPerOrder, usual.clicksPerOrder)) fix = "It took more clicks to get an order - check the landing page, the price shown and the form";
      else if (input.targetCpa && now.costPerOrder !== null && now.costPerOrder > input.targetCpa) fix = `Cost per order ${naira(now.costPerOrder)} is above your target ${naira(input.targetCpa)} - cut the ads that cost most per order`;
      else if (now.orders === 0 && now.adSpend > 0) fix = `${naira(now.adSpend)} was spent on ads with no orders - check the ad is linked to the right form`;
      else fix = "Each order cost more in ads than usual - cut the ads that cost most per order";
    }
    drivers.push({ key: "adcost", label: "Ad cost", impact: parts.adcost, headline: `Cost per order ${now.costPerOrder === null ? "-" : naira(now.costPerOrder)} vs usual ${usual.costPerOrder === null ? "-" : naira(usual.costPerOrder)}`, details, fix,
      praise: parts.adcost > 0 ? (down(now.cpc, usual.cpc) ? "Clicks were cheaper" : "Each order cost less in ads") : null });
  }

  // Margin per delivered order
  {
    const details = [`Left per delivered order after product cost and delivery: ${now.marginPerDelivered === null ? "-" : naira(now.marginPerDelivered)} (usual ${usual.marginPerDelivered === null ? "-" : naira(usual.marginPerDelivered)})`];
    if (now.aov !== null) details.push(`Average delivered order ${naira(now.aov)} (usual ${usual.aov === null ? "-" : naira(usual.aov)})`);
    if (now.upsellRate !== null) details.push(`${pct(now.upsellRate)} of orders upsold (usual ${pct(usual.upsellRate)})`);
    let fix: string | null = null;
    if (parts.margin < 0) {
      if (down(now.upsellRate, usual.upsellRate, 0.2)) fix = `Fewer upsells (${pct(now.upsellRate)} vs ${pct(usual.upsellRate)}) - push the bigger packs on every call`;
      else if (down(now.aov, usual.aov, 0.05)) fix = "Customers took smaller packs - lead with the bigger pack on calls and on the form";
      else fix = "Delivery fees or product cost per order went up - check the riders' fees for this product";
    }
    drivers.push({ key: "margin", label: "Money per order", impact: parts.margin, headline: `${now.marginPerDelivered === null ? "-" : naira(now.marginPerDelivered)} per delivered order vs usual ${usual.marginPerDelivered === null ? "-" : naira(usual.marginPerDelivered)}`, details, fix,
      praise: parts.margin > 0 ? (up(now.upsellRate, usual.upsellRate, 0.2) ? "More upsells" : "Each delivered order left more money") : null });
  }

  drivers.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const change = now.profit - usual.profit;
  const threshold = Math.max(WEEKLY_RULES.moveFloor, Math.abs(usual.profit) * WEEKLY_RULES.moveShare);
  const verdict: WeeklyVerdict = change >= threshold ? "strong" : change <= -threshold || (now.profit < 0 && usual.profit >= 0) ? "weak" : "steady";
  const main = verdict === "weak" ? drivers.find((d) => d.impact < 0) : verdict === "strong" ? drivers.find((d) => d.impact > 0) : null;
  const summary = `Profit after ads ${amount(now.profit)} vs usual ${amount(usual.profit)} (${signed(change)}).${main ? ` Biggest reason: ${main.label.toLowerCase()} (${signed(main.impact)}).` : ""}`;

  const fixes = drivers.filter((d) => d.impact < 0 && d.fix).map((d) => d.fix!);
  // Stock sits right after the delivery-rate fix (it is part of why orders failed), else last.
  if (stockLine) {
    const rateFix = drivers.find((d) => d.key === "rate" && d.impact < 0)?.fix;
    const at = rateFix ? fixes.indexOf(rateFix) + 1 : fixes.length;
    fixes.splice(at, 0, stockLine);
  }
  const wins = drivers.filter((d) => d.impact > 0 && d.praise).map((d) => `${d.praise} (${signed(d.impact)})`);
  return { ...base, verdict, summary, drivers, fixes, wins };
}

// ── Stock as it stood (agent_stock_audit, from 26 Aug 2026) ──────────────────

export type StockChange = { at: number; old: number; next: number };

/** A hub's quantity at a moment, from its change log (sorted by time) and today's figure. */
export function stockAt(current: number, changes: StockChange[], at: number) {
  let before: StockChange | null = null;
  for (const change of changes) {
    if (change.at <= at) before = change;
    else return before ? before.next : change.old;
  }
  return before ? before.next : current;
}
