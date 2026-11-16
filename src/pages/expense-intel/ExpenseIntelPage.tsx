import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign, CalendarDays, ChartPie, ClipboardCheck, FileBarChart, Gauge, Home, Layers3, Loader2, Megaphone, ReceiptText, Truck, Users2
} from "lucide-react";
import { expenseIntelApi, type EiState } from "../../lib/api";
import { addMonths, lastMonths, monthKey, monthLabel } from "./model";
import { TAB_KEYS, expensesBetween, periodOf, tabsFor, type EiCtx, type TabKey, type TabProps } from "./context";
import { select, type Icon } from "./ui";
import OverviewTab from "./OverviewTab";
import AllExpensesTab from "./AllExpensesTab";
import BreakdownTab from "./BreakdownTab";
import ProductCostTab from "./ProductCostTab";
import LogisticsTab from "./LogisticsTab";
import AdvertisingTab from "./AdvertisingTab";
import BudgetsTab from "./BudgetsTab";
import ApprovalsTab from "./ApprovalsTab";
import OptimizationTab from "./OptimizationTab";
import ReportsTab from "./ReportsTab";

/**
 * Expense & Cost Intelligence (Bright's 10 designs, 16 Nov 2026). Replaces the
 * old Expenses page. The app's own sidebar, branch switcher and bell stay as
 * they are; this page is the title, the tab strip and the tabs.
 */

const TABS: Record<TabKey, { label: string; icon: Icon }> = {
  overview: { label: "Overview", icon: Home },
  expenses: { label: "All Expenses", icon: ReceiptText },
  breakdown: { label: "Expense Breakdown", icon: ChartPie },
  product: { label: "Product Cost Intelligence", icon: Users2 },
  logistics: { label: "Logistics Costs", icon: Truck },
  advertising: { label: "Advertising Costs", icon: Megaphone },
  budgets: { label: "Budgets & Limits", icon: Gauge },
  approvals: { label: "Approvals", icon: ClipboardCheck },
  optimization: { label: "Cost Optimization", icon: BadgeDollarSign },
  reports: { label: "Reports & Forecasts", icon: FileBarChart }
};

const readTab = (): string | null => {
  const query = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(query).get("tab");
};

export default function ExpenseIntelPage({ ctx }: { ctx: EiCtx }) {
  const allowed = tabsFor(ctx.role);
  const [tab, setTab] = useState<TabKey>(() => { const t = readTab() as TabKey | null; return t && allowed.includes(t) ? t : allowed[0]; });
  const [state, setState] = useState<EiState | null>(null);
  const [error, setError] = useState("");
  const thisMonth = monthKey(ctx.today);
  const [month, setMonth] = useState(thisMonth);
  const [compare, setCompare] = useState(addMonths(thisMonth, -1));
  const [extra, setExtra] = useState<Record<string, string>>(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    q.delete("tab");
    return Object.fromEntries(q.entries());
  });

  const reload = useCallback(() => {
    expenseIntelApi.state().then((s) => { setState(s); setError(""); }).catch((e: Error) => setError(e.message || "Could not load."));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  // A deep link (alert, notification) can open a tab: #/dashboard/admin/expenses?tab=approvals&request=…
  useEffect(() => {
    const onHash = () => { const t = readTab() as TabKey | null; if (t && allowed.includes(t)) setTab(t); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [allowed.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((next: TabKey, more: Record<string, string> = {}) => {
    if (!allowed.includes(next)) return;
    setTab(next); setExtra(more);
    const base = window.location.hash.split("?")[0] || "#/dashboard/admin/expenses";
    const q = new URLSearchParams({ tab: next, ...more }).toString();
    window.history.replaceState(null, "", `${base}?${q}`);
    window.scrollTo({ top: 0 });
  }, [allowed.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const period = useMemo(() => periodOf(month, compare, ctx.today), [month, compare, ctx.today]);
  const expensesIn = useCallback((from: string, to: string) => expensesBetween(ctx.expenses, from, to), [ctx.expenses]);
  const months = useMemo(() => lastMonths(thisMonth, 18).reverse(), [thisMonth]);

  const props: TabProps | null = state ? { ctx, state, reload, period, expensesIn, go } : null;
  const monthPicker = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative inline-flex items-center">
        <CalendarDays className="pointer-events-none absolute left-3 h-4 w-4 text-gray-500" />
        <select aria-label="Month" value={month} onChange={(e) => { setMonth(e.target.value); setCompare(addMonths(e.target.value, -1)); }} className={`${select} !pl-9 min-w-[170px]`}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === thisMonth ? " (so far)" : ""}</option>)}
        </select>
      </label>
      <span className="text-[12.5px] text-gray-500 dark:text-slate-400">Compare with:</span>
      <select aria-label="Compare with" value={compare} onChange={(e) => setCompare(e.target.value)} className={`${select} min-w-[150px]`}>
        {months.filter((m) => m < month).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
      </select>
    </div>
  );

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#2F6BFF]/10 text-[#2F6BFF]"><Layers3 className="h-6 w-6" /></span>
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-black text-gray-900 dark:text-slate-50">Expense &amp; Cost Intelligence</h1>
          <p className="m-0 text-[13px] text-gray-500 dark:text-slate-400">Track, control and reduce every business expense for higher profit.</p>
        </div>
      </header>

      {allowed.length > 1 && (
        <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Expense sections">
          {allowed.map((key) => {
            const T = TABS[key];
            const on = tab === key;
            const pending = key === "approvals" && state ? state.requests.filter((r) => r.status === "pending").length : 0;
            return (
              <button key={key} type="button" onClick={() => go(key)} aria-current={on ? "page" : undefined}
                className={`!min-h-0 inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[12.5px] font-bold ${on ? "border-[#2F6BFF] bg-[#2F6BFF] text-white shadow-sm" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
                <T.icon className="h-4 w-4" />{T.label}
                {pending > 0 && <span className={`ml-0.5 rounded-full px-1.5 text-[10.5px] ${on ? "bg-white/25" : "bg-rose-500 text-white"}`}>{pending}</span>}
              </button>
            );
          })}
        </nav>
      )}

      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-800">Could not load this page: {error} <button type="button" className="font-bold underline" onClick={reload}>Try again</button></p>}
      {!props && !error && <p className="m-0 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>}
      {props && (
        tab === "overview" ? <OverviewTab {...props} picker={monthPicker} />
        : tab === "expenses" ? <AllExpensesTab {...props} focus={extra} />
        : tab === "breakdown" ? <BreakdownTab {...props} picker={monthPicker} />
        : tab === "product" ? <ProductCostTab {...props} picker={monthPicker} />
        : tab === "logistics" ? <LogisticsTab {...props} picker={monthPicker} />
        : tab === "advertising" ? <AdvertisingTab {...props} picker={monthPicker} />
        : tab === "budgets" ? <BudgetsTab {...props} picker={monthPicker} />
        : tab === "approvals" ? <ApprovalsTab {...props} picker={monthPicker} focus={extra} />
        : tab === "optimization" ? <OptimizationTab {...props} picker={monthPicker} />
        : <ReportsTab {...props} picker={monthPicker} />
      )}
    </div>
  );
}

export { TAB_KEYS };
