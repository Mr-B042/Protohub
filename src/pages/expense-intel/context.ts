import type { EiState } from "../../lib/api";
import { addMonths, inRange, likeForLikeEnd, monthEnd, monthStart, type EExpense, type EOrder, type ProfitFn } from "./model";

/** What App.tsx hands the page (its own data and profit helpers). */
export type EiCtx = {
  role: string;
  userName: string;
  today: string;
  orders: EOrder[];
  expenses: EExpense[];
  products: Array<{ id: string; name: string; image: string | null; stock: number; unitCost: number }>;
  profit: ProfitFn;
  money: (value: number) => string;
  /** Owner/Admin/Manager: the app's own Add Expense form. */
  onAddExpense: () => void;
  onOpenOrder: (orderId: string) => void;
  refresh: () => void;
  toast: (message: string) => void;
  /** Merges a product's waybill payments of one week into one line (display only). */
  mergeWaybills: (rows: EExpense[]) => EExpense[];
};

export type Period = { month: string; compare: string; from: string; to: string; cFrom: string; cTo: string; label: string; cLabel: string };

export function periodOf(month: string, compare: string, today: string): Period {
  const short = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return { month, compare, from: monthStart(month), to: monthEnd(month), cFrom: monthStart(compare), cTo: likeForLikeEnd(compare, month, today), label: short(month), cLabel: short(compare) };
}
export const prevMonth = (m: string) => addMonths(m, -1);

export type TabProps = {
  ctx: EiCtx; state: EiState; reload: () => void; period: Period;
  expensesIn: (from: string, to: string) => EExpense[];
  go: (tab: TabKey, extra?: Record<string, string>) => void;
};

export const TAB_KEYS = ["overview", "expenses", "breakdown", "product", "logistics", "advertising", "budgets", "approvals", "optimization", "reports"] as const;
export type TabKey = (typeof TAB_KEYS)[number];

/** Owner/Admin: everything. Manager & Accountant: the list + approvals. Inventory roles: the list. */
export function tabsFor(role: string): TabKey[] {
  if (role === "Owner" || role === "Admin") return [...TAB_KEYS];
  if (role === "Manager" || role === "Accountant") return ["expenses", "approvals"];
  return ["expenses"];
}

export const expensesBetween = (rows: EExpense[], from: string, to: string) => rows.filter((e) => inRange(e.date, from, to));
export type { EExpense, EOrder };
