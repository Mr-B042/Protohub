/**
 * Monthly Performance › Sales reps (Bright, 2 Nov 2026; design approved from
 * the preview). Who brings the company the most money, who needs teaching,
 * who should be reviewed.
 *
 * Money after their pay = delivered revenue − product cost − delivery fees −
 * their bonus (both bonus systems, as Marketing Performance takes out) − their
 * salary for the month (Pay Rates). Ad spend and office costs are shared by
 * the whole team, so they are not split by rep (Bright: "yes").
 *
 * Verdict (Bright chose "money + delivery rate + discipline"; thresholds kept):
 *  - Too new:          fewer than 10 orders in the month - not judged.
 *  - Review to let go: 12+ late order sends or 20+ missed follow-ups in the
 *                      month, or Watch this month AND last month.
 *  - Watch:            delivery rate under 55%, or the bottom quarter of the
 *                      judged reps on money after pay.
 *  - Coach:            delivery rate 55-59%, or upsell + cross-sell under half
 *                      the team's rate.
 *  - Star:             top half on money after pay AND delivery rate 65%+.
 *  - Solid:            everyone else (making money, rate 60%+).
 * Orders count in the month they were PLACED (Lagos), like the product view.
 */

export const REP_RULES = { minOrders: 10, starRate: 65, coachRate: 60, watchRate: 55, lateSends: 12, missedFollowUps: 20 };

export type RepVerdict = "star" | "solid" | "coach" | "watch" | "review" | "new";

export type RepOrder = {
  repId: string; month: string; productId: string | null; productName: string; status: string;
  amount: number; productCost: number; deliveryFee: number; bonus: number;
  upsold: boolean; upsellValue: number; upsellLabel: string | null;
  crossSells: Array<{ name: string; amount: number }>;
};
export type RepDiscipline = { lateSends: number; missedFollowUps: number; fines: number };
export type RepCarts = { handed: number; called: number; interested: number; converted: number };

export type RepMonthStat = {
  month: string; orders: number; delivered: number; rate: number | null; revenue: number; aov: number | null;
  productCost: number; deliveryFees: number; bonus: number; salary: number; pay: number; money: number;
  upsells: number; upsellValue: number; crossSells: number; crossSellValue: number; extraRate: number | null;
  lateSends: number; missedFollowUps: number; fines: number; carts: RepCarts;
  verdict: RepVerdict | null; reason: string | null; rank: number | null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShort = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
const EMPTY_CARTS: RepCarts = { handed: 0, called: 0, interested: 0, converted: 0 };

/** One rep's figures for one month (verdict filled in by judgeRepMonth). */
export function repMonthFigures(input: { month: string; orders: RepOrder[]; salary: number; discipline?: RepDiscipline; carts?: RepCarts }): RepMonthStat {
  const orders = input.orders;
  const delivered = orders.filter((order) => order.status === "Delivered");
  const revenue = delivered.reduce((sum, order) => sum + order.amount, 0);
  const productCost = delivered.reduce((sum, order) => sum + order.productCost, 0);
  const deliveryFees = delivered.reduce((sum, order) => sum + order.deliveryFee, 0);
  const bonus = delivered.reduce((sum, order) => sum + order.bonus, 0);
  // Salary only for a month they worked (had orders).
  const salary = orders.length > 0 ? input.salary : 0;
  const upsells = orders.filter((order) => order.upsold).length;
  const crossSells = orders.filter((order) => order.crossSells.length > 0).length;
  return {
    month: input.month, orders: orders.length, delivered: delivered.length,
    rate: orders.length ? (delivered.length / orders.length) * 100 : null,
    revenue, aov: delivered.length ? revenue / delivered.length : null,
    productCost, deliveryFees, bonus, salary, pay: salary + bonus,
    money: revenue - productCost - deliveryFees - bonus - salary,
    upsells, upsellValue: delivered.reduce((sum, order) => sum + (order.upsold ? order.upsellValue : 0), 0),
    crossSells, crossSellValue: delivered.reduce((sum, order) => sum + order.crossSells.reduce((t, line) => t + line.amount, 0), 0),
    extraRate: orders.length ? ((upsells + crossSells) / orders.length) * 100 : null,
    lateSends: input.discipline?.lateSends ?? 0, missedFollowUps: input.discipline?.missedFollowUps ?? 0, fines: input.discipline?.fines ?? 0,
    carts: input.carts ?? EMPTY_CARTS,
    verdict: null, reason: null, rank: null
  };
}

/**
 * Verdicts for every rep in one month. `previous` = each rep's verdict the
 * month before (for "Watch two months running").
 */
export function judgeRepMonth(stats: Map<string, RepMonthStat>, previous: Map<string, RepVerdict | null>): void {
  const working = [...stats.entries()].filter(([, stat]) => stat.orders > 0 || stat.lateSends > 0 || stat.missedFollowUps > 0);
  const judged = working.filter(([, stat]) => stat.orders >= REP_RULES.minOrders);
  const byMoney = [...judged].sort((a, b) => b[1].money - a[1].money);
  byMoney.forEach(([, stat], index) => { stat.rank = index + 1; });
  const median = byMoney.length ? byMoney[Math.floor((byMoney.length - 1) / 2)][1].money : 0;
  const bottomCount = Math.floor(byMoney.length * 0.25);
  const bottom = new Set(byMoney.slice(byMoney.length - bottomCount).map(([id]) => id));
  const teamOrders = judged.reduce((sum, [, stat]) => sum + stat.orders, 0);
  const teamExtra = teamOrders ? (judged.reduce((sum, [, stat]) => sum + stat.upsells + stat.crossSells, 0) / teamOrders) * 100 : 0;

  for (const [repId, stat] of working) {
    const set = (verdict: RepVerdict, reason: string) => { stat.verdict = verdict; stat.reason = reason; };
    const badDiscipline = stat.lateSends >= REP_RULES.lateSends || stat.missedFollowUps >= REP_RULES.missedFollowUps;
    if (badDiscipline) {
      // Name only what crossed the line.
      const parts = [
        stat.lateSends >= REP_RULES.lateSends ? `${stat.lateSends} late order sends` : null,
        stat.missedFollowUps >= REP_RULES.missedFollowUps ? `${stat.missedFollowUps} missed follow-ups` : null
      ].filter(Boolean);
      set("review", `${parts.join(" and ")} this month`);
      continue;
    }
    if (stat.orders < REP_RULES.minOrders) { set("new", `${stat.orders} order${stat.orders === 1 ? "" : "s"}, needs ${REP_RULES.minOrders} to be judged`); continue; }
    const rate = stat.rate ?? 0;
    if (rate < REP_RULES.watchRate || bottom.has(repId)) {
      if (previous.get(repId) === "watch" || previous.get(repId) === "review") { set("review", `Watch in ${monthShort(prevMonth(stat.month))} and ${monthShort(stat.month)}`); continue; }
      set("watch", rate < REP_RULES.watchRate ? `Delivery rate ${round1(rate)}% is under ${REP_RULES.watchRate}%` : "Bottom quarter of the team on money after pay");
      continue;
    }
    if (rate < REP_RULES.coachRate) { set("coach", `Delivery rate ${round1(rate)}% is ${REP_RULES.watchRate}–${REP_RULES.coachRate - 1}%`); continue; }
    if ((stat.extraRate ?? 0) < teamExtra / 2) { set("coach", `Upsell + cross-sell ${round1(stat.extraRate ?? 0)}% is under half the team's ${round1(teamExtra)}%`); continue; }
    if (rate >= REP_RULES.starRate && stat.money >= median) { set("star", `Top half on money, delivery rate ${round1(rate)}%`); continue; }
    set("solid", `Making money, delivery rate ${round1(rate)}%${rate < REP_RULES.starRate ? ` (${round1(REP_RULES.starRate - rate)} pts from Star)` : ""}`);
  }
}

export function prevMonth(month: string) {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 2;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** A rep's month split by product (money here is before salary: salary is not per product). */
export function repProducts(orders: RepOrder[]) {
  const groups = new Map<string, RepOrder[]>();
  for (const order of orders) {
    const key = order.productId ?? `name:${order.productName}`;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const delivered = rows.filter((order) => order.status === "Delivered");
    const revenue = delivered.reduce((sum, order) => sum + order.amount, 0);
    return {
      productId: key.startsWith("name:") ? null : key, name: rows[0].productName,
      orders: rows.length, delivered: delivered.length, rate: (delivered.length / rows.length) * 100,
      revenue, aov: delivered.length ? revenue / delivered.length : null,
      upsells: rows.filter((order) => order.upsold).length, crossSells: rows.filter((order) => order.crossSells.length > 0).length,
      moneyBeforeSalary: delivered.reduce((sum, order) => sum + order.amount - order.productCost - order.deliveryFee - order.bonus, 0)
    };
  }).sort((a, b) => b.orders - a.orders);
}

/** The most common item in a list ("Multi Corner Storage Shelf 1 → 2"), with its count. */
export function mostCommon(values: Array<string | null>): { name: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: { name: string; count: number } | null = null;
  for (const [name, count] of counts) if (!best || count > best.count) best = { name, count };
  return best;
}
