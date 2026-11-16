import { useMemo } from "react";
import type { TabProps } from "./context";
import {
  BUDGET_COGS, BUDGET_LOGISTICS, budgetRows, costGroups, inRange, lastMonths, logisticsBy, logisticsTotals, monthEnd, monthStart, possibleDuplicates,
  productRows, smartAlerts, sum, adTotals, type Alert, type EExpense
} from "./model";

/** Spent this period against a budget key (expense category, or the two worked-out costs). */
export function spentFor(category: string, rows: EExpense[], cogs: number, logistics: number) {
  if (category === BUDGET_COGS) return cogs;
  if (category === BUDGET_LOGISTICS) return logistics;
  return sum(rows.filter((e) => e.category === category), (e) => e.amount);
}

/** The numbers most tabs share for the chosen month and its compare month. */
export function useMonthData(p: TabProps) {
  const { ctx, period, expensesIn, state } = p;
  return useMemo(() => {
    const exp = expensesIn(period.from, period.to);
    const cexp = expensesIn(period.cFrom, period.cTo);
    const now = ctx.profit(period.from, period.to);
    const before = ctx.profit(period.cFrom, period.cTo);
    const groups = costGroups(now, exp);
    const cgroups = costGroups(before, cexp);
    const business = now.cogs + now.recognizedLogistics + now.operatingExpense;
    const cbusiness = before.cogs + before.recognizedLogistics + before.operatingExpense;
    const recorded = sum(exp, (e) => e.amount);
    const crecorded = sum(cexp, (e) => e.amount);
    const log = logisticsTotals(ctx.orders, exp, period.from, period.to);
    const clog = logisticsTotals(ctx.orders, cexp, period.cFrom, period.cTo);
    const budgets = budgetRows(period.month, state.budgets, (c) => spentFor(c, exp, now.cogs, now.recognizedLogistics + log.failedCost));
    // Six months ending on the chosen one.
    const months = lastMonths(period.month, 6).map((m) => {
      const from = monthStart(m), to = monthEnd(m);
      const rows = expensesIn(from, to);
      const s = ctx.profit(from, to);
      return { m, from, to, rows, s, recorded: sum(rows, (e) => e.amount), business: s.cogs + s.recognizedLogistics + s.operatingExpense, groups: costGroups(s, rows) };
    });
    return { exp, cexp, now, before, groups, cgroups, business, cbusiness, recorded, crecorded, log, clog, budgets, months };
  }, [ctx, period, expensesIn, state.budgets]);
}

export function useProductRows(p: TabProps, from?: string, to?: string) {
  const { ctx, period, expensesIn } = p;
  const f = from ?? period.from, t = to ?? period.to;
  return useMemo(() => productRows(ctx.orders, expensesIn(f, t), f, t, ctx.profit, new Map(ctx.products.map((x) => [x.id, x.name]))), [ctx, f, t, expensesIn]);
}

/** Smart cost alerts for the month, minus the ones already resolved or dismissed. */
export function useAlerts(p: TabProps, d: ReturnType<typeof useMonthData>) {
  const { ctx, period, state } = p;
  return useMemo(() => {
    const incentives = (rows: EExpense[], bonus: number) => sum(rows.filter((e) => e.category === "Salary" || e.category === "Bonuses & Incentives"), (e) => e.amount) + bonus;
    const adNow = adTotals(ctx.orders, d.exp, period.from, period.to);
    const adBefore = adTotals(ctx.orders, d.cexp, period.cFrom, period.cTo);
    const statesNow = logisticsBy(ctx.orders, period.from, period.to, (o) => o.state).rows;
    const statesBefore = new Map(logisticsBy(ctx.orders, period.cFrom, period.cTo, (o) => o.state).rows.map((r) => [r.key, r]));
    const stateCostRises = statesNow.filter((r) => r.delivered >= 10 && r.avgCost !== null).flatMap((r) => {
      const b = statesBefore.get(r.key);
      return b && b.delivered >= 10 && b.avgCost !== null && r.avgCost! - b.avgCost >= 1000 ? [{ state: r.key, now: r.avgCost!, before: b.avgCost }] : [];
    });
    const all: Alert[] = smartAlerts({
      month: period.month, compare: period.compare, money: ctx.money, budgets: d.budgets,
      duplicates: possibleDuplicates(d.exp), stateCostRises,
      now: { adSpend: adNow.spend, delivered: adNow.delivered, failedCost: d.log.failedCost, logistics: d.log.total, waybill: d.log.waybill, incentives: incentives(d.exp, d.now.totalBonusExpense), netProfit: d.now.netProfit },
      before: { adSpend: adBefore.spend, delivered: adBefore.delivered, waybill: d.clog.waybill, incentives: incentives(d.cexp, d.before.totalBonusExpense), netProfit: d.before.netProfit }
    });
    const acted = new Map(state.alertActions.map((a) => [a.key, a]));
    return {
      open: all.filter((a) => { const x = acted.get(a.key); return !x || x.action === "assigned"; }),
      closed: all.filter((a) => { const x = acted.get(a.key); return x && x.action !== "assigned"; }),
      actionOf: (key: string) => acted.get(key) ?? null
    };
  }, [ctx, period, state.alertActions, d]);
}

export const inMonth = (day: string, m: string) => inRange(day, monthStart(m), monthEnd(m));
