/**
 * Expense & Cost Intelligence: pure numbers (Bright, 16 Nov 2026).
 *
 * No imports on purpose (tests load this file alone). Profit figures come in
 * from App.tsx's summarizeRecognizedProfit through `ProfitFn`, so every tab
 * agrees with the Dashboard and Finance pages to the naira.
 *
 * Definitions (shown on screen as "How this adds up"):
 *  - Recorded expenses   = every expense row in the period.
 *  - Business costs      = COGS + logistics (delivered orders' fees) + operating
 *                          expenses (all non-Delivery rows + sales/manager bonuses).
 *  - Delivery-category rows are NOT added on top of the orders' fees (that
 *    would count deliveries twice); they are listed apart in the reconciliation.
 */

export type EOrder = {
  id: string; status: string; amount: number; productId: string | null; productName: string;
  createdKey: string; deliveredKey: string; state: string; agentName: string;
  /** Delivery fee counted for this order (actual, or the provisional estimate). */
  logistics: number;
  /** Product cost of the order (main + bundle + cross-sell + gifts). */
  cogs: number;
  /** Units of the main product (for days of stock). */
  units: number;
  silent?: boolean;
};

/** Stock beyond 60 days of sales, valued at cost (cash tied up). */
export function slowStock(products: Array<{ id: string; stock: number; unitCost: number }>, orders: EOrder[], today: string) {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
  let value = 0, count = 0;
  for (const p of products) {
    if (p.stock <= 0 || p.unitCost <= 0) continue;
    const sold = orders.filter((o) => o.productId === p.id && o.status === "Delivered" && o.deliveredKey >= from && o.deliveredKey <= today).reduce((s, o) => s + (o.units || 1), 0);
    const perDay = sold / 30;
    const extra = p.stock - perDay * 60;
    if (extra > 0) { value += extra * p.unitCost; count += 1; }
  }
  return { value, products: count };
}

export type EExpense = {
  id: string; category: string; amount: number; date: string; createdAt?: string;
  productId?: string; productName: string; description: string; paidBy?: string;
  checkStatus: "auto" | "verified" | "unchecked"; recordedByName?: string; checkedByName?: string; checkedAt?: string;
  receiptUrl?: string; requestId?: string; waybillId?: string;
  /** Set on a merged waybill week line. */
  partIds?: string[]; walletPaid?: number; walletCount?: number;
};

export type ProfitSummary = {
  revenue: number; cogs: number; recognizedLogistics: number; recordedDeliveryExpense: number; deliveryExpenseNotRecognized: number;
  recordedOperatingExpense: number; bonusEstimate: number; managerBonusExpense: number; totalBonusExpense: number;
  operatingExpense: number; grossProfit: number; netProfit: number;
};
/** Company profit for a date range (with manager bonus), or one product's (without). */
export type ProfitFn = (from: string, to: string, productId?: string) => ProfitSummary;

// ---------- dates ----------
export const monthKey = (day: string) => day.slice(0, 7);
export const monthStart = (m: string) => `${m}-01`;
export function monthEnd(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}
export function addMonths(m: string, n: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export const monthLabel = (m: string, short = false) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-GB", { month: short ? "short" : "long", year: short ? undefined : "numeric", timeZone: "UTC" });
};
export const lastMonths = (m: string, count: number) => Array.from({ length: count }, (_, i) => addMonths(m, i - count + 1));
/** Days of the month counted so far (today included); a past month counts all its days. */
export function daysCounted(m: string, today: string) {
  const end = monthEnd(m);
  if (today >= end) return Number(end.slice(8));
  if (today < monthStart(m)) return 0;
  return Number(today.slice(8));
}
/** Same day-span of the compare month (like-for-like when the month is not over). */
export function likeForLikeEnd(compare: string, m: string, today: string) {
  if (today >= monthEnd(m)) return monthEnd(compare);
  const day = Math.min(Number(today.slice(8)), Number(monthEnd(compare).slice(8)));
  return `${compare}-${String(day).padStart(2, "0")}`;
}

// ---------- small helpers ----------
export const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((s, r) => s + (Number(pick(r)) || 0), 0);
export const pctChange = (now: number, before: number) => (before ? ((now - before) / Math.abs(before)) * 100 : null);
export const share = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
export const inRange = (day: string, from: string, to: string) => Boolean(day) && day >= from && day <= to;

// ---------- categories ----------
export const CATEGORY_LABEL: Record<string, string> = { "Ad Spend": "Advertising", "Salary": "Salaries", "Bonuses & Incentives": "Incentives" };
export const labelOf = (category: string) => CATEGORY_LABEL[category] ?? category;

/** The six cost groups the Overview/Breakdown donuts use; they add up to Business costs exactly. */
export type CostGroup = "COGS" | "Logistics" | "Advertising" | "Waybill & Shipping" | "Salaries & Incentives" | "Other Operating";
export const COST_GROUPS: CostGroup[] = ["COGS", "Logistics", "Advertising", "Waybill & Shipping", "Salaries & Incentives", "Other Operating"];
export function groupOfCategory(category: string): Exclude<CostGroup, "COGS" | "Logistics"> {
  if (category === "Ad Spend") return "Advertising";
  if (category === "Waybill" || category === "Clearing & Shipping") return "Waybill & Shipping";
  if (category === "Salary" || category === "Bonuses & Incentives") return "Salaries & Incentives";
  return "Other Operating";
}

export function costGroups(summary: ProfitSummary, expenses: EExpense[]) {
  const out = new Map<CostGroup, number>(COST_GROUPS.map((g) => [g, 0]));
  out.set("COGS", summary.cogs);
  out.set("Logistics", summary.recognizedLogistics);
  for (const e of expenses) if (e.category !== "Delivery") out.set(groupOfCategory(e.category), out.get(groupOfCategory(e.category))! + e.amount);
  // Sales bonuses and the manager bonus are worked out, not recorded as rows.
  out.set("Salaries & Incentives", out.get("Salaries & Incentives")! + summary.totalBonusExpense);
  return COST_GROUPS.map((group) => ({ group, amount: out.get(group)! }));
}

export function byCategory(expenses: EExpense[]) {
  const map = new Map<string, number>();
  for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
  const total = sum([...map.values()], (v) => v);
  return [...map.entries()].map(([category, amount]) => ({ category, amount, share: share(amount, total) })).sort((a, b) => b.amount - a.amount);
}

// ---------- reconciliation (the brief's "explain how these relate") ----------
export function reconcile(summary: ProfitSummary, expenses: EExpense[], rawRowCount: number, listedLines: number) {
  const deliveryRows = sum(expenses.filter((e) => e.category === "Delivery"), (e) => e.amount);
  const otherRows = sum(expenses.filter((e) => e.category !== "Delivery"), (e) => e.amount);
  return {
    recorded: deliveryRows + otherRows, deliveryRows, otherRows,
    cogs: summary.cogs, logistics: summary.recognizedLogistics, bonuses: summary.totalBonusExpense,
    business: summary.cogs + summary.recognizedLogistics + summary.operatingExpense,
    /** Delivery rows left out because the orders' own fees are counted instead. */
    deliveryNotCounted: summary.deliveryExpenseNotRecognized,
    rawRowCount, listedLines, mergedAway: rawRowCount - listedLines
  };
}

// ---------- products ----------
export type ProductRow = {
  productId: string; name: string; revenue: number; cogs: number; logistics: number; advertising: number; waybill: number;
  incentives: number; other: number; totalCost: number; contribution: number; margin: number | null;
  placed: number; delivered: number; deliveryRate: number | null; aov: number | null;
  cpp: number | null; costPerDelivered: number | null; breakEvenCpp: number | null; profitPerDelivered: number | null;
  failedCost: number; status: "Profitable" | "Low Margin" | "Losing Money" | "No Sales";
};

/** Every product with sales or costs in the range, worked out like Finance's per-product view. */
export function productRows(orders: EOrder[], expenses: EExpense[], from: string, to: string, profit: ProfitFn, names: Map<string, string>): ProductRow[] {
  const ids = new Set<string>();
  for (const o of orders) if (o.productId && (inRange(o.createdKey, from, to) || inRange(o.deliveredKey, from, to))) ids.add(o.productId);
  for (const e of expenses) if (e.productId) ids.add(e.productId);
  const rows: ProductRow[] = [];
  for (const id of ids) {
    const s = profit(from, to, id);
    const mine = expenses.filter((e) => e.productId === id);
    const advertising = sum(mine.filter((e) => e.category === "Ad Spend"), (e) => e.amount);
    const waybill = sum(mine.filter((e) => e.category === "Waybill" || e.category === "Clearing & Shipping"), (e) => e.amount);
    const incentiveRows = sum(mine.filter((e) => e.category === "Salary" || e.category === "Bonuses & Incentives"), (e) => e.amount);
    const otherRows = sum(mine.filter((e) => e.category !== "Delivery" && groupOfCategory(e.category) === "Other Operating"), (e) => e.amount);
    const placedRows = orders.filter((o) => o.productId === id && inRange(o.createdKey, from, to));
    const placed = placedRows.length;
    const cohortDelivered = placedRows.filter((o) => o.status === "Delivered").length;
    const delivered = orders.filter((o) => o.productId === id && o.status === "Delivered" && inRange(o.deliveredKey, from, to)).length;
    const failedCost = sum(placedRows.filter((o) => o.status === "Failed"), (o) => o.logistics);
    const totalCost = s.cogs + s.recognizedLogistics + s.operatingExpense;
    const contribution = s.revenue - totalCost;
    const deliveryRate = placed ? cohortDelivered / placed : null;
    const leftPerDelivery = delivered ? (s.revenue - s.cogs - s.recognizedLogistics) / delivered : null;
    const margin = s.revenue ? (contribution / s.revenue) * 100 : null;
    rows.push({
      productId: id, name: names.get(id) ?? "Product", revenue: s.revenue, cogs: s.cogs, logistics: s.recognizedLogistics,
      advertising, waybill, incentives: incentiveRows + s.totalBonusExpense, other: otherRows, totalCost, contribution, margin,
      placed, delivered, deliveryRate: deliveryRate === null ? null : deliveryRate * 100, aov: delivered ? s.revenue / delivered : null,
      cpp: placed && advertising ? advertising / placed : null,
      costPerDelivered: delivered && advertising ? advertising / delivered : null,
      breakEvenCpp: leftPerDelivery !== null && deliveryRate !== null && leftPerDelivery > 0 ? leftPerDelivery * deliveryRate : null,
      profitPerDelivered: delivered ? contribution / delivered : null,
      failedCost,
      status: !s.revenue && !totalCost ? "No Sales" : contribution < 0 ? "Losing Money" : margin !== null && margin < 25 ? "Low Margin" : "Profitable"
    });
  }
  return rows.sort((a, b) => b.totalCost - a.totalCost);
}

// ---------- logistics ----------
export type LogisticsRow = { key: string; orders: number; delivered: number; deliveryRate: number | null; totalCost: number; avgCost: number | null; status: "Efficient" | "Good" | "Review" | "—" };

function rateStatus(rate: number | null, avgCost: number | null, overallRate: number | null, overallAvg: number | null): LogisticsRow["status"] {
  if (rate === null || avgCost === null || overallRate === null || overallAvg === null) return "—";
  if (rate >= overallRate + 3 && avgCost <= overallAvg) return "Efficient";
  if (rate < overallRate - 5 || avgCost > overallAvg * 1.15) return "Review";
  return "Good";
}

export function logisticsBy(orders: EOrder[], from: string, to: string, keyOf: (o: EOrder) => string) {
  const placed = orders.filter((o) => inRange(o.createdKey, from, to));
  const deliveredInRange = orders.filter((o) => o.status === "Delivered" && inRange(o.deliveredKey, from, to));
  const keys = new Set([...placed.map(keyOf), ...deliveredInRange.map(keyOf)]);
  const overallRate = placed.length ? (placed.filter((o) => o.status === "Delivered").length / placed.length) * 100 : null;
  const overallAvg = deliveredInRange.length ? sum(deliveredInRange, (o) => o.logistics) / deliveredInRange.length : null;
  const rows: LogisticsRow[] = [...keys].filter(Boolean).map((key) => {
    const p = placed.filter((o) => keyOf(o) === key);
    const d = deliveredInRange.filter((o) => keyOf(o) === key);
    const cost = sum(d, (o) => o.logistics) + sum(p.filter((o) => o.status === "Failed"), (o) => o.logistics);
    const rate = p.length ? (p.filter((o) => o.status === "Delivered").length / p.length) * 100 : null;
    const avg = d.length ? sum(d, (o) => o.logistics) / d.length : null;
    return { key, orders: p.length, delivered: d.length, deliveryRate: rate, totalCost: cost, avgCost: avg, status: rateStatus(rate, avg, overallRate, overallAvg) };
  });
  return { rows: rows.sort((a, b) => b.totalCost - a.totalCost), overallRate, overallAvg };
}

export function logisticsTotals(orders: EOrder[], expenses: EExpense[], from: string, to: string) {
  const delivered = orders.filter((o) => o.status === "Delivered" && inRange(o.deliveredKey, from, to));
  const failed = orders.filter((o) => o.status === "Failed" && inRange(o.createdKey, from, to));
  const successful = sum(delivered, (o) => o.logistics);
  const failedOrders = sum(failed, (o) => o.logistics);
  const failedRows = sum(expenses.filter((e) => e.category === "Failed Delivery"), (e) => e.amount);
  const waybill = sum(expenses.filter((e) => e.category === "Waybill" || e.category === "Clearing & Shipping"), (e) => e.amount);
  // Delivery payments recorded as expenses but not tied to an order (bulk courier, wallet).
  const otherDelivery = sum(expenses.filter((e) => e.category === "Delivery" && !e.id.startsWith("EXP-DEL-")), (e) => e.amount);
  const failedCost = failedOrders + failedRows;
  return {
    successful, failedCost, failedOrders, failedRows, failedCount: failed.length, waybill, otherDelivery,
    total: successful + failedCost + waybill + otherDelivery,
    deliveredCount: delivered.length, avgPerDelivery: delivered.length ? successful / delivered.length : null
  };
}

// ---------- advertising ----------
export function adTotals(orders: EOrder[], expenses: EExpense[], from: string, to: string) {
  const ads = expenses.filter((e) => e.category === "Ad Spend" && inRange(e.date, from, to));
  const spend = sum(ads, (e) => e.amount);
  const placed = orders.filter((o) => inRange(o.createdKey, from, to));
  const delivered = orders.filter((o) => o.status === "Delivered" && inRange(o.deliveredKey, from, to));
  const revenue = sum(delivered, (o) => o.amount);
  return {
    spend, placed: placed.length, delivered: delivered.length, revenue,
    cpp: placed.length && spend ? spend / placed.length : null,
    costPerDelivered: delivered.length && spend ? spend / delivered.length : null,
    roas: spend ? revenue / spend : null,
    byPlatform: platformSplit(ads)
  };
}

export function platformOf(e: EExpense) {
  if (e.id.startsWith("ads-tiktok-") || /tiktok/i.test(e.description)) return "TikTok";
  if (e.id.startsWith("ads-auto-meta") || /meta|facebook|instagram/i.test(e.description)) return "Meta (Facebook & Instagram)";
  return "Typed by hand";
}
export function platformSplit(ads: EExpense[]) {
  const map = new Map<string, number>();
  for (const e of ads) map.set(platformOf(e), (map.get(platformOf(e)) ?? 0) + e.amount);
  const total = sum([...map.values()], (v) => v);
  return [...map.entries()].map(([platform, amount]) => ({ platform, amount, share: share(amount, total) })).sort((a, b) => b.amount - a.amount);
}

// ---------- budgets ----------
export type Budget = { month: string; category: string; amount: number; recurring: boolean };
/** Budget keys: expense categories, plus the two worked-out costs. */
export const BUDGET_COGS = "Cost of Goods (COGS)";
export const BUDGET_LOGISTICS = "Logistics (Delivery & Failed)";

/** This month's budgets: set ones, else the latest recurring one carried forward. */
export function budgetsFor(month: string, all: Budget[]) {
  const out = new Map(all.filter((b) => b.month === month).map((b) => [b.category, b]));
  // For a category not set this month: its latest earlier budget, if that one repeats.
  const latest = new Map<string, Budget>();
  for (const b of all) if (b.month < month && (!latest.has(b.category) || latest.get(b.category)!.month < b.month)) latest.set(b.category, b);
  for (const [category, b] of latest) if (!out.has(category) && b.recurring) out.set(category, { ...b, month });
  return [...out.values()];
}

export type BudgetRow = { category: string; budget: number; spent: number; remaining: number; usage: number | null; status: "On Track" | "At Risk" | "Over Budget"; recurring: boolean; carried: boolean };
export function budgetRows(month: string, all: Budget[], spentOf: (category: string) => number): BudgetRow[] {
  return budgetsFor(month, all).map((b): BudgetRow => {
    const spent = spentOf(b.category);
    const usage = b.amount ? (spent / b.amount) * 100 : null;
    return {
      category: b.category, budget: b.amount, spent, remaining: b.amount - spent, usage, recurring: b.recurring,
      carried: !all.some((x) => x.month === month && x.category === b.category),
      status: usage === null ? (spent > 0 ? "Over Budget" : "On Track") : usage >= 100 ? "Over Budget" : usage >= 90 ? "At Risk" : "On Track"
    };
  }).sort((a, b) => b.budget - a.budget);
}

// ---------- alerts ----------
export type Alert = { key: string; level: "critical" | "high" | "medium"; title: string; detail: string; tab: string };

export function smartAlerts(input: {
  month: string; compare: string;
  now: { adSpend: number; delivered: number; failedCost: number; logistics: number; waybill: number; incentives: number; netProfit: number };
  before: { adSpend: number; delivered: number; waybill: number; incentives: number; netProfit: number };
  budgets: BudgetRow[]; duplicates: Array<{ key: string; amount: number; count: number; label: string }>;
  stateCostRises: Array<{ state: string; now: number; before: number }>;
  money: (v: number) => string;
}): Alert[] {
  const { now, before, money } = input;
  const out: Alert[] = [];
  const m = input.month;
  const adUp = pctChange(now.adSpend, before.adSpend), delUp = pctChange(now.delivered, before.delivered);
  if (adUp !== null && delUp !== null && adUp > 10 && adUp > delUp + 10) {
    out.push({ key: `${m}:ad-vs-delivered`, level: "high", tab: "advertising", title: `Ad spend ↑ ${Math.round(adUp)}%`, detail: `Ad spend rose ${Math.round(adUp)}% while delivered orders ${delUp >= 0 ? `grew only ${Math.round(delUp)}%` : `fell ${Math.round(-delUp)}%`}.` });
  }
  const failShare = share(now.failedCost, now.logistics);
  if (now.logistics > 0 && failShare > 10) {
    out.push({ key: `${m}:failed-share`, level: "critical", tab: "logistics", title: "Failed delivery cost is high", detail: `${money(now.failedCost)} this month (${failShare.toFixed(1)}% of logistics). Target: 10% or less.` });
  }
  const wbUp = pctChange(now.waybill, before.waybill);
  if (wbUp !== null && wbUp > 15 && now.waybill - before.waybill >= 10_000) {
    out.push({ key: `${m}:waybill-up`, level: "medium", tab: "logistics", title: `Waybill expense ↑ ${Math.round(wbUp)}%`, detail: `${money(now.waybill)} vs ${money(before.waybill)} last month.` });
  }
  const incUp = pctChange(now.incentives, before.incentives), profitUp = pctChange(now.netProfit, before.netProfit);
  if (incUp !== null && incUp > 15 && (profitUp === null || incUp > profitUp + 10)) {
    out.push({ key: `${m}:incentives-up`, level: "medium", tab: "breakdown", title: `Incentives ↑ ${Math.round(incUp)}%`, detail: `${money(now.incentives)} vs ${money(before.incentives)} last month${profitUp !== null ? `, while net profit ${profitUp >= 0 ? `rose ${Math.round(profitUp)}%` : `fell ${Math.round(-profitUp)}%`}` : ""}.` });
  }
  for (const b of input.budgets.filter((row) => row.status === "Over Budget")) {
    out.push({ key: `${m}:budget:${b.category}`, level: "critical", tab: "budgets", title: `${labelOf(b.category)} over budget`, detail: `${money(b.spent)} spent of ${money(b.budget)}${b.usage !== null ? ` (${b.usage.toFixed(1)}%)` : ""}.` });
  }
  for (const d of input.duplicates) {
    out.push({ key: `${m}:dup:${d.key}`, level: "critical", tab: "expenses", title: "Possible duplicate expense", detail: `${d.count} × ${money(d.amount)} ${d.label}. Check before paying again.` });
  }
  for (const s of input.stateCostRises) {
    out.push({ key: `${m}:state:${s.state}`, level: "high", tab: "logistics", title: `Delivery cost up in ${s.state}`, detail: `Average ${money(s.now)} per delivery vs ${money(s.before)} last month (+${money(s.now - s.before)}).` });
  }
  const rank = { critical: 0, high: 1, medium: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** Same category, amount, day and product, typed by people (system rows never repeat). */
export function possibleDuplicates(expenses: EExpense[]) {
  const groups = new Map<string, EExpense[]>();
  for (const e of expenses) {
    if (e.checkStatus === "auto" || e.amount <= 0) continue;
    const key = `${e.category}|${e.amount}|${e.date}|${e.productId ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({
    key, amount: rows[0].amount, count: rows.length, ids: rows.map((r) => r.id),
    label: `${labelOf(rows[0].category)}${rows[0].productName ? ` for ${rows[0].productName}` : ""} on ${rows[0].date}`
  }));
}

// ---------- forecast ----------
/** Next n months by a straight line through the last points (at least 3), never below 0. */
export function forecast(values: number[], n: number) {
  const pts = values.map((y, x) => ({ x, y })).filter((p) => Number.isFinite(p.y));
  if (pts.length < 3) return Array.from({ length: n }, () => null as number | null);
  const mx = sum(pts, (p) => p.x) / pts.length, my = sum(pts, (p) => p.y) / pts.length;
  const den = sum(pts, (p) => (p.x - mx) ** 2);
  const slope = den ? sum(pts, (p) => (p.x - mx) * (p.y - my)) / den : 0;
  const start = values.length;
  return Array.from({ length: n }, (_, i) => Math.max(0, my + slope * (start + i - mx)));
}

// ---------- savings opportunities ----------
export type Opportunity = { key: string; title: string; current: string; target: string; savings: number; tab: string; kind: "ads" | "delivery" | "waybill" | "stock" };

export function opportunities(input: {
  month: string; money: (v: number) => string;
  cppByMonth: Array<number | null>; placedNow: number; cppNow: number | null;
  rateByMonth: Array<number | null>; rateNow: number | null; failedCostPerFail: number | null;
  waybillByMonth: number[]; waybillNow: number;
  slowStock: { value: number; products: number };
}): Opportunity[] {
  const { money } = input;
  const out: Opportunity[] = [];
  const bestCpp = input.cppByMonth.filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b)[0];
  if (input.cppNow !== null && bestCpp !== undefined && input.cppNow > bestCpp * 1.02 && input.placedNow > 0) {
    out.push({ key: `${input.month}:ads`, kind: "ads", tab: "advertising", title: "Reduce Advertising CPP", current: money(input.cppNow), target: money(bestCpp), savings: (input.cppNow - bestCpp) * input.placedNow });
  }
  const bestRate = input.rateByMonth.filter((v): v is number => v !== null).sort((a, b) => b - a)[0];
  if (input.rateNow !== null && bestRate !== undefined && bestRate > input.rateNow + 1 && input.failedCostPerFail && input.placedNow) {
    const fewerFails = ((bestRate - input.rateNow) / 100) * input.placedNow;
    out.push({ key: `${input.month}:delivery`, kind: "delivery", tab: "logistics", title: "Improve Delivery Rate", current: `${input.rateNow.toFixed(1)}%`, target: `${bestRate.toFixed(1)}%`, savings: fewerFails * input.failedCostPerFail });
  }
  const past = input.waybillByMonth.filter((v) => v > 0);
  const avg = past.length ? sum(past, (v) => v) / past.length : 0;
  if (avg && input.waybillNow > avg * 1.05) {
    out.push({ key: `${input.month}:waybill`, kind: "waybill", tab: "logistics", title: "Optimize Waybill Costs", current: money(input.waybillNow), target: `${money(avg)} (3-month average)`, savings: input.waybillNow - avg });
  }
  if (input.slowStock.value > 0) {
    out.push({ key: `${input.month}:stock`, kind: "stock", tab: "product", title: "Review Slow-Moving Inventory", current: `${input.slowStock.products} product${input.slowStock.products === 1 ? "" : "s"} over 60 days of stock`, target: "60 days of stock or less", savings: input.slowStock.value });
  }
  return out.sort((a, b) => b.savings - a.savings);
}

// ---------- rows ----------
/** Browser copy of backend expense-intel-rules paymentSourceOf: keep both alike. */
export function paymentSourceOf(row: { id: string; paidBy?: string | null }) {
  const id = row.id;
  if (id.startsWith("MGRF-")) return "Manager Wallet";
  if (id.startsWith("EXP-DEL-")) return "Agent";
  if (id.startsWith("ads-auto-") || id.startsWith("ads-tiktok-")) return "Company";
  if (id.startsWith("SAL-WEEKLY-") || id.startsWith("incentive-")) return "Payroll";
  const paid = String(row.paidBy ?? "").trim();
  if (/supplier/i.test(paid)) return "Supplier";
  if (/agent/i.test(paid)) return "Agent";
  if (/wallet/i.test(paid)) return "Manager Wallet";
  return "Company";
}
/** The order behind an order delivery-fee row ("EXP-DEL-5803" → "5803"). */
export const orderIdOf = (expenseId: string) => (expenseId.startsWith("EXP-DEL-") ? expenseId.slice(8) : null);
export const STATUS_LABEL: Record<EExpense["checkStatus"], string> = { auto: "Reconciled", verified: "Verified", unchecked: "Not checked" };
