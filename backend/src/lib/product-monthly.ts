/**
 * Monthly Performance (Product Trend tab, Bright 2 Nov 2026): every product
 * judged month by month, the way Ad Spend's "Since Start" judges a campaign.
 *
 * Bright's rules (chosen 2 Nov 2026):
 *  - Too new: fewer than 10 orders placed in the month - not judged.
 *  - Stop:    lost money after ads this month AND the month before.
 *  - Fix:     lost money after ads this month, or delivery rate under 60%,
 *             or profit after ads under 10% of delivered revenue.
 *  - Scale:   making money after ads with delivery rate 65% or more.
 *  - Keep:    making money after ads, delivery rate 60-64%.
 *
 * Profit after ads = delivered revenue − product cost − delivery fees − ad
 * spend: the same figure as Ad Spend's "Profit after ads". Orders are counted
 * in the month they were PLACED (Lagos), so delivery rate is the cohort rate
 * and a month that has not ended yet is "so far".
 *
 * Break-even = the campaign check's break-even cost per order
 * (lib/ad-since-start.ts breakEvenCpa): what a delivered order leaves after
 * product cost and delivery fee, times the share of orders delivered - worked
 * out on the month's own orders here, or the Owner's own figure when set.
 *
 * Net profit (Bright, 2 Nov 2026: "you didnt add net profit") = Product
 * Trend's / Finance's: delivered revenue − product cost − delivery fees −
 * every expense of the month except "Delivery". Costs tagged to a product
 * stay with it; untagged ones are shared by each product's share of the
 * month's delivered revenue (Finance's proportionalShare). The verdict stays
 * on profit after ads, as Bright chose.
 */

export const MONTHLY_RULES = { minOrders: 10, scaleRate: 65, keepRate: 60, thinShare: 0.1 };

export type MonthlyVerdict = "scale" | "keep" | "fix" | "stop" | "new";

export type MonthlyOrder = { productId: string | null; month: string; status: string; amount: number; productCost: number; deliveryFee: number };
export type MonthlyExpense = { productId: string | null; month: string; amount: number; category: string };

export type MonthStat = {
  month: string;
  orders: number;
  delivered: number;
  /** Delivered ÷ placed, as a percentage (null with no orders). */
  rate: number | null;
  revenue: number;
  productCost: number;
  deliveryFees: number;
  adSpend: number;
  profit: number;
  /** Other running costs: the product's own (not ads) + its share of untagged ones. */
  otherCosts: number;
  net: number;
  /** Ad spend ÷ orders placed (null with no spend or no orders). */
  costPerOrder: number | null;
  breakEven: number | null;
  breakEvenSource: "worked_out" | "set_by_you" | null;
  /** Null when the product sold nothing and spent nothing that month. */
  verdict: MonthlyVerdict | null;
  reason: string | null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthShort = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;

/** The `count` month keys ("YYYY-MM") ending with `last`, oldest first. */
export function monthsEnding(last: string, count: number): string[] {
  const [year, month] = last.split("-").map(Number);
  const out: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const index = year * 12 + (month - 1) - back;
    out.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/** First and last day ("YYYY-MM-DD") of a month key. */
export function monthBounds(month: string): { from: string; to: string } {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Same sum as the campaign check's breakEvenCpa, on one month's orders. */
function workedOutBreakEven(orders: MonthlyOrder[]): number | null {
  const delivered = orders.filter((order) => order.status === "Delivered");
  if (orders.length < MONTHLY_RULES.minOrders || delivered.length === 0) return null;
  const margin = delivered.reduce((sum, order) => sum + order.amount - order.productCost - order.deliveryFee, 0) / delivered.length;
  return margin > 0 ? margin * (delivered.length / orders.length) : null;
}

/** Finance's proportionalShare. */
const share = (value: number, total: number, pool: number, count: number, totalCount: number) =>
  pool === 0 ? 0 : total > 0 ? pool * (value / total) : totalCount > 0 ? pool * (count / totalCount) : 0;

export function judgeMonth(stat: Pick<MonthStat, "month" | "orders" | "rate" | "revenue" | "adSpend" | "profit">, previous: Pick<MonthStat, "month" | "profit" | "orders" | "adSpend"> | null): { verdict: MonthlyVerdict | null; reason: string | null } {
  if (stat.orders === 0 && stat.adSpend === 0) return { verdict: null, reason: null };
  if (stat.orders < MONTHLY_RULES.minOrders) {
    return { verdict: "new", reason: `${stat.orders} order${stat.orders === 1 ? "" : "s"}, needs ${MONTHLY_RULES.minOrders} to be judged` };
  }
  const rate = stat.rate ?? 0;
  const previousLost = previous !== null && (previous.orders > 0 || previous.adSpend > 0) && previous.profit < 0;
  if (stat.profit < 0 && previousLost) {
    return { verdict: "stop", reason: `Lost money after ads in ${monthShort(previous!.month)} and ${monthShort(stat.month)}` };
  }
  if (stat.profit < 0) return { verdict: "fix", reason: `Lost money after ads in ${monthShort(stat.month)}` };
  if (rate < MONTHLY_RULES.keepRate) return { verdict: "fix", reason: `Delivery rate ${round1(rate)}% is under ${MONTHLY_RULES.keepRate}%` };
  if (stat.revenue > 0 && stat.profit / stat.revenue < MONTHLY_RULES.thinShare) {
    return { verdict: "fix", reason: `Profit after ads is ${round1((stat.profit / stat.revenue) * 100)}% of revenue (under ${MONTHLY_RULES.thinShare * 100}%)` };
  }
  if (rate >= MONTHLY_RULES.scaleRate) return { verdict: "scale", reason: `Making money after ads, delivery rate ${round1(rate)}%` };
  const gap = round1(MONTHLY_RULES.scaleRate - rate);
  return { verdict: "keep", reason: `Making money after ads, delivery rate ${round1(rate)}% (${gap} point${gap === 1 ? "" : "s"} from Scale)` };
}

/**
 * Month-by-month stats for one product. `orders` and `expenses` hold every
 * product's rows: the untagged costs are shared across all of them.
 */
export function productMonths(input: { productId: string; months: string[]; orders: MonthlyOrder[]; expenses: MonthlyExpense[]; ownBreakEven: number | null }): MonthStat[] {
  const out: MonthStat[] = [];
  for (const month of input.months) {
    const monthOrders = input.orders.filter((order) => order.month === month);
    const orders = monthOrders.filter((order) => order.productId === input.productId);
    const delivered = orders.filter((order) => order.status === "Delivered");
    const allDelivered = monthOrders.filter((order) => order.status === "Delivered");
    const revenue = delivered.reduce((sum, order) => sum + order.amount, 0);
    const productCost = delivered.reduce((sum, order) => sum + order.productCost, 0);
    const deliveryFees = delivered.reduce((sum, order) => sum + order.deliveryFee, 0);
    const running = input.expenses.filter((row) => row.month === month && row.category !== "Delivery");
    const adSpend = running.filter((row) => row.productId === input.productId && row.category === "Ad Spend").reduce((sum, row) => sum + row.amount, 0);
    const ownOther = running.filter((row) => row.productId === input.productId && row.category !== "Ad Spend").reduce((sum, row) => sum + row.amount, 0);
    const sharedPool = running.filter((row) => !row.productId).reduce((sum, row) => sum + row.amount, 0);
    const sharedPart = share(revenue, allDelivered.reduce((sum, order) => sum + order.amount, 0), sharedPool, delivered.length, allDelivered.length);
    const profit = revenue - productCost - deliveryFees - adSpend;
    const workedOut = workedOutBreakEven(orders);
    const breakEven = input.ownBreakEven ?? workedOut;
    const base = {
      month, orders: orders.length, delivered: delivered.length,
      rate: orders.length ? (delivered.length / orders.length) * 100 : null,
      revenue, productCost, deliveryFees, adSpend, profit,
      otherCosts: ownOther + sharedPart,
      net: profit - ownOther - sharedPart,
      costPerOrder: adSpend > 0 && orders.length > 0 ? adSpend / orders.length : null,
      breakEven, breakEvenSource: input.ownBreakEven !== null ? "set_by_you" as const : workedOut !== null ? "worked_out" as const : null
    };
    out.push({ ...base, ...judgeMonth(base, out[out.length - 1] ?? null) });
  }
  return out;
}

/** The whole month as Finance sees it: every product, every running cost. */
export function monthNet(month: string, orders: MonthlyOrder[], expenses: MonthlyExpense[]): number {
  const delivered = orders.filter((order) => order.month === month && order.status === "Delivered");
  const margin = delivered.reduce((sum, order) => sum + order.amount - order.productCost - order.deliveryFee, 0);
  return margin - expenses.filter((row) => row.month === month && row.category !== "Delivery").reduce((sum, row) => sum + row.amount, 0);
}
