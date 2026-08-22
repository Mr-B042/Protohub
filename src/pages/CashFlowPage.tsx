import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import {
  ArrowDownLeft, ArrowUpRight, Boxes, CalendarDays, ChevronLeft, ChevronRight, Download,
  Eye, Filter, Info, Landmark, Lock, Pencil, RefreshCw, Search, ShieldCheck, TrendingUp, Users, Wallet, X
} from "lucide-react";
import BankAccountsTab, { type BankAccountsTabProps } from "./BankAccountsTab";
import WeeklyReconciliationTab, { type WeeklyReconciliationTabProps } from "./WeeklyReconciliationTab";
import ReservesTab, { type ReservesTabProps } from "./ReservesTab";
import InventoryValueTab, { type InventoryValueTabProps } from "./InventoryValueTab";
import AccountReconciliationTab, { type AccountReconciliationTabProps } from "./AccountReconciliationTab";
import PeriodCloseTab, { type PeriodCloseTabProps } from "./PeriodCloseTab";

// ⚠️ Cash, not profit. Profit is recognised when an order is Delivered; the
// money arrives when the agent remits, days later and sometimes never. A week
// can show a healthy profit and a negative cash position at once - that gap is
// why this page exists, so nothing here is sourced from delivered orders.

export type CashFlowTransaction = {
  id: string; at: string; direction: "in" | "out";
  category: string; description: string; source: string;
  cashIn: number; cashOut: number; balance: number;
};

export type CashFlowView = {
  period: { from: string; to: string };
  openingCash: number;
  /** False when no one has anchored a real bank figure yet. */
  openingAnchored: boolean;
  /** How this week's opening was arrived at. Only a counted week is frozen. */
  openingSource?: "weekly_count" | "derived_accounts" | "standalone_anchor" | "derived_ledger";
  openingAnchor: { id: string; amount: number; effectiveAt: string; method: string; reason: string; setByName: string } | null;
  cashIn: number; cashOut: number; netCashFlow: number; closingCash: number;
  netChangeVsPreviousPct: number | null;
  cashStillWithAgents: number;
  trend: Array<{ day: string; cashIn: number; cashOut: number; net: number }>;
  cashInBreakdown: { slices: Array<{ label: string; amount: number; sharePct: number }>; total: number };
  cashOutBreakdown: { slices: Array<{ label: string; amount: number; sharePct: number }>; total: number };
  transactions: CashFlowTransaction[];
};

export type OpeningBalanceRow = {
  id: string; amount: number; effectiveAt: string;
  method: "manual" | "carry_forward" | string; reason: string; setByName: string; createdAt: string;
};

export type CashFlowPeriod = "Today" | "Yesterday" | "This Week" | "Last Week" | "This Month" | "Custom";
export const CASH_FLOW_PERIODS: CashFlowPeriod[] = ["Today", "Yesterday", "This Week", "Last Week", "This Month", "Custom"];

const OUT_COLORS = ["#EF4444", "#3B82F6", "#8B5CF6", "#EC4899", "#F59E0B"];
const IN_COLORS = ["#10B981", "#CBD5E1"];

const naira = (value: number) => `₦${Math.round(Number(value) || 0).toLocaleString("en-NG")}`;
const shortNaira = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `₦${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `₦${Math.round(value / 1_000)}K`;
  return `₦${Math.round(value)}`;
};
const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { month: "short", day: "numeric" });
const dowLabel = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short" });
const stampLabel = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-NG", { year: "numeric", month: "short", day: "numeric" });
};
const timeLabel = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
};

export type CashFlowPageProps = {
  view: CashFlowView | null;
  loading: boolean;
  error: string;
  period: CashFlowPeriod;
  onPeriodChange: (period: CashFlowPeriod) => void;
  /** Owner/Admin may anchor opening cash; Manager may only read it. */
  canSetOpeningCash: boolean;
  openingHistory: OpeningBalanceRow[];
  savingOpeningCash: boolean;
  onRefresh: () => void;
  onSaveOpeningCash: (body: { amount: number; effectiveAt: string; method: "manual" | "carry_forward"; reason: string }) => Promise<void>;
  onLoadOpeningHistory: () => void;
  onViewAgentReceivables: () => void;
  onDownloadReport: () => void;
  /** Bank Accounts lives inside this page: same question, asked twice. */
  bank: Omit<BankAccountsTabProps, "transactions" | "loading">;
  /** Re-open the weekly opening-cash wizard for an already-opened week. */
  onEditWeeklyOpening: () => void;
  /** Weekly Reconciliation lives here too: recorded cash vs counted cash. */
  reconciliation: WeeklyReconciliationTabProps;
  /** Reserves: cash that is still here but already spoken for. */
  reserves: ReservesTabProps;
  /** Inventory Value: cash tied up in stock, valued at cost. */
  inventory: InventoryValueTabProps;
  /** Account Reconciliation: our books vs each bank statement. */
  accountReconciliation: AccountReconciliationTabProps;
  /** Period Close: the week is finished and the books are fixed. */
  periodClose: PeriodCloseTabProps;
};

const CASH_FLOW_TABS = ["Overview", "Bank Accounts", "Reconciliation", "Account Reconciliation", "Reserves", "Inventory Value", "Period Close"] as const;
type CashFlowTab = (typeof CASH_FLOW_TABS)[number];
const TAB_ICON: Record<CashFlowTab, typeof TrendingUp> = {
  "Overview": TrendingUp,
  "Bank Accounts": Wallet,
  "Reconciliation": ShieldCheck,
  "Account Reconciliation": Landmark,
  "Reserves": Lock,
  "Inventory Value": Boxes,
  "Period Close": Lock
};

export default function CashFlowPage(props: CashFlowPageProps) {
  const { view, loading, error, period } = props;
  const [search, setSearch] = useState("");
  const [directionFilter, setDirectionFilter] = useState<"all" | "in" | "out">("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [openingModal, setOpeningModal] = useState(false);
  const [topTab, setTopTab] = useState<CashFlowTab>("Overview");

  useEffect(() => { setPage(1); }, [search, directionFilter, pageSize, period]);

  const transactions = useMemo(() => {
    const rows = view?.transactions ?? [];
    const query = search.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (directionFilter !== "all" && row.direction !== directionFilter) return false;
      if (!query) return true;
      return row.description.toLowerCase().includes(query)
        || row.category.toLowerCase().includes(query)
        || row.source.toLowerCase().includes(query);
    });
    // The API returns newest-first because the balance column had to be walked
    // oldest-first to be correct. Flipping here never recomputes the balance.
    return newestFirst ? filtered : [...filtered].reverse();
  }, [view, search, directionFilter, newestFirst]);

  const totalPages = Math.max(1, Math.ceil(transactions.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = transactions.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstShown = transactions.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastShown = Math.min(currentPage * pageSize, transactions.length);

  const cards = [
    { label: "Opening Cash", value: view?.openingCash ?? 0, hint: view ? `As of ${stampLabel(`${view.period.from}T00:00:00Z`)}` : "", icon: Landmark, tone: "bg-blue-50 text-blue-600", valueTone: "text-gray-900" },
    { label: "Cash In", value: view?.cashIn ?? 0, hint: "From all cash inflows", icon: ArrowDownLeft, tone: "bg-emerald-50 text-emerald-600", valueTone: "text-gray-900" },
    { label: "Cash Out", value: view?.cashOut ?? 0, hint: "From all cash outflows", icon: ArrowUpRight, tone: "bg-rose-50 text-rose-600", valueTone: "text-gray-900" },
    { label: "Net Cash Flow", value: view?.netCashFlow ?? 0, hint: "", icon: TrendingUp, tone: "bg-violet-50 text-violet-600", valueTone: (view?.netCashFlow ?? 0) >= 0 ? "text-violet-700" : "text-rose-700" },
    { label: "Closing Cash", value: view?.closingCash ?? 0, hint: view ? `As of ${stampLabel(`${view.period.to}T00:00:00Z`)}` : "", icon: Landmark, tone: "bg-blue-50 text-blue-600", valueTone: "text-gray-900" }
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="m-0 flex items-center gap-2 text-2xl font-black text-gray-900">
            Cash Flow
            <span title="Cash actually received and paid out. This is NOT profit: an order counts as profit when it is delivered, but the money only appears here when the agent remits." className="cursor-help text-gray-300 hover:text-gray-500">
              <Info className="h-4 w-4" />
            </span>
          </h1>
          <p className="m-0 mt-1 text-sm text-gray-500">Track liquid cash moving in and out of the business.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap items-center rounded-xl bg-gray-100 p-1">
            {CASH_FLOW_PERIODS.map((item) => (
              <button key={item} type="button" onClick={() => props.onPeriodChange(item)}
                className={`!min-h-0 rounded-lg px-3 py-1.5 text-[13px] font-bold transition-colors ${period === item ? "bg-[#1F8FE0] text-white shadow-sm" : "text-gray-600 hover:text-gray-900"}`}>
                {item === "Custom" ? <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Custom</span> : item}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="inline-flex w-full items-center rounded-xl bg-gray-100 p-1 sm:w-auto">
        {CASH_FLOW_TABS.map((tab) => {
          const Icon = TAB_ICON[tab];
          return (
            <button key={tab} type="button" onClick={() => setTopTab(tab)}
              className={`!min-h-0 flex-1 rounded-lg px-4 py-2 text-[13px] font-black transition-colors sm:flex-none ${topTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}>
              <span className="inline-flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" /> {tab}
              </span>
            </button>
          );
        })}
      </div>

      {topTab === "Bank Accounts" ? (
        <BankAccountsTab {...props.bank} transactions={view?.transactions ?? []} loading={loading} />
      ) : topTab === "Reconciliation" ? (
        <WeeklyReconciliationTab {...props.reconciliation} />
      ) : topTab === "Reserves" ? (
        <ReservesTab {...props.reserves} />
      ) : topTab === "Inventory Value" ? (
        <InventoryValueTab {...props.inventory} />
      ) : topTab === "Account Reconciliation" ? (
        <AccountReconciliationTab {...props.accountReconciliation} />
      ) : topTab === "Period Close" ? (
        <PeriodCloseTab {...props.periodClose} />
      ) : (
      <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><CalendarDays className="h-4 w-4" /></span>
          <span>
            <span className="block text-[13px] font-black text-gray-900">
              {view ? `${dayLabel(view.period.from)} – ${stampLabel(`${view.period.to}T00:00:00Z`)}` : "—"}
            </span>
            <span className="block text-[11px] font-semibold text-gray-400">{period}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={props.onRefresh}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button type="button" onClick={props.onDownloadReport}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">
            <Download className="h-4 w-4" /> Download Report
          </button>
        </div>
      </div>

      {error && (
        <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>
      )}

      {/* An unanchored opening balance is a derived figure, not money in the
          bank. Saying so is the difference between a useful page and a
          confidently wrong one. */}
      {view && view.openingAnchored && view.openingSource === "derived_accounts" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="m-0 text-[13px] font-bold text-blue-900">
            This week was never opened, so its opening cash is worked out from your account opening balances rather than counted.
            {" "}It will move if you edit an account. Counted weeks are frozen.
          </p>
          {props.canSetOpeningCash && (
            <button type="button" onClick={props.onEditWeeklyOpening}
              className="!min-h-0 shrink-0 rounded-lg bg-[#1F8FE0] px-3 py-1.5 text-[12px] font-black text-white hover:bg-[#1a7ec4]">
              Count this week
            </button>
          )}
        </div>
      )}

      {view && !view.openingAnchored && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="m-0 text-[13px] font-bold text-amber-900">
            Opening cash has never been set, so this is net cash recorded since the first remittance — not your bank balance.
            {" "}Stock purchases, capital and transfers are not in these figures.
          </p>
          {props.canSetOpeningCash && (
            <button type="button" onClick={() => { setOpeningModal(true); props.onLoadOpeningHistory(); }}
              className="!min-h-0 shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-black text-white hover:bg-amber-700">
              Set opening cash
            </button>
          )}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
            <div className="flex items-start justify-between gap-2">
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${card.tone}`}>
                <card.icon className="h-4 w-4" />
              </span>
              {card.label === "Opening Cash" && props.canSetOpeningCash && (
                <button type="button" title="Update this week's opening cash"
                  onClick={props.onEditWeeklyOpening}
                  className="!min-h-0 rounded-lg bg-transparent p-1 text-gray-300 hover:text-[#1F8FE0]">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <p className="m-0 mt-2 text-[13px] font-bold text-gray-500">{card.label}</p>
            <p className={`m-0 mt-0.5 break-words text-2xl font-black ${card.valueTone}`}>
              {loading && !view ? "—" : naira(card.value)}
            </p>
            {card.label === "Net Cash Flow" && view?.netChangeVsPreviousPct !== null && view?.netChangeVsPreviousPct !== undefined ? (
              <p className={`m-0 mt-1 text-[11px] font-bold ${view.netChangeVsPreviousPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {view.netChangeVsPreviousPct >= 0 ? "↑" : "↓"} {Math.abs(view.netChangeVsPreviousPct)}% vs previous period
              </p>
            ) : (
              <p className="m-0 mt-1 text-[11px] font-semibold text-gray-400">{card.hint}</p>
            )}
          </div>
        ))}
      </div>

      {/* Position · agent-held cash · trend */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
          <h2 className="m-0 text-sm font-black text-gray-900">Operational Cash Position</h2>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><TrendingUp className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className={`m-0 text-2xl font-black ${(view?.netCashFlow ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{naira(view?.netCashFlow ?? 0)}</p>
              <p className="m-0 text-[11px] font-semibold text-gray-400">
                {(view?.netCashFlow ?? 0) >= 0 ? "more cash came in than went out this period" : "more cash went out than came in this period"}
              </p>
            </div>
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3 border-b border-gray-50 pb-2">
              <dt className="text-gray-500">Cash Received (In)</dt>
              <dd className="m-0 font-black text-gray-900">{naira(view?.cashIn ?? 0)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-gray-50 pb-2">
              <dt className="text-gray-500">Cash Spent (Out)</dt>
              <dd className="m-0 font-black text-gray-900">{naira(view?.cashOut ?? 0)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="font-bold text-gray-700">Net Cash Flow</dt>
              <dd className={`m-0 font-black ${(view?.netCashFlow ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{naira(view?.netCashFlow ?? 0)}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
          <h2 className="m-0 text-sm font-black text-gray-900">Cash Still With Agents</h2>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600"><Users className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="m-0 text-2xl font-black text-amber-600">{naira(view?.cashStillWithAgents ?? 0)}</p>
              <p className="m-0 text-[11px] font-semibold text-gray-400">Not yet remitted to the company</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <p className="m-0 text-[11px] font-medium leading-4 text-amber-900">
              This is cash collected from customers but not yet remitted by agents. It is already counted as profit, but it is not in the bank.
            </p>
          </div>
          <button type="button" onClick={props.onViewAgentReceivables}
            className="!min-h-0 mt-3 inline-flex w-full items-center justify-between rounded-lg bg-transparent px-0 py-1 text-[13px] font-bold text-[#1F8FE0] hover:underline">
            View agent receivables <ChevronRight className="h-4 w-4" />
          </button>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
          <h2 className="m-0 text-sm font-black text-gray-900">Cash Flow Trend</h2>
          <div className="mt-2 h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={view?.trend ?? []} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(value) => `${dayLabel(String(value))}`} tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value) => shortNaira(Number(value))} tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={54} />
                <Tooltip
                  formatter={(value: any, name: any) => [naira(Number(value)), name]}
                  labelFormatter={(label) => `${dowLabel(String(label))} ${dayLabel(String(label))}`}
                  contentStyle={{ borderRadius: 12, border: "1px solid #E2E8F0", fontSize: 12 }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="cashIn" name="Cash In" stroke="#10B981" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="cashOut" name="Cash Out" stroke="#EF4444" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="net" name="Net" stroke="#3B82F6" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {[
          { title: "Cash In Breakdown", data: view?.cashInBreakdown, colors: IN_COLORS, totalLabel: "Total Cash In", totalTone: "text-emerald-600" },
          { title: "Cash Out Breakdown", data: view?.cashOutBreakdown, colors: OUT_COLORS, totalLabel: "Total Cash Out", totalTone: "text-rose-600" }
        ].map((panel) => (
          <section key={panel.title} className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="m-0 text-sm font-black text-gray-900">{panel.title}</h2>
              <span className="text-sm font-black text-gray-900">{naira(panel.data?.total ?? 0)}</span>
            </div>
            <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-[150px] w-[150px] shrink-0">
                {(panel.data?.total ?? 0) > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={(panel.data?.slices ?? []).filter((slice) => slice.amount > 0)}
                        dataKey="amount" nameKey="label" innerRadius={45} outerRadius={72} paddingAngle={2}>
                        {(panel.data?.slices ?? []).filter((slice) => slice.amount > 0).map((slice, index) => (
                          <Cell key={slice.label} fill={panel.colors[index % panel.colors.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: any, name: any) => [naira(Number(value)), name]}
                        contentStyle={{ borderRadius: 12, border: "1px solid #E2E8F0", fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-full border-[14px] border-gray-100 text-[11px] font-bold text-gray-300">
                    Nothing yet
                  </div>
                )}
              </div>
              <ul className="m-0 min-w-0 flex-1 list-none space-y-2 p-0">
                {(panel.data?.slices ?? []).map((slice, index) => (
                  <li key={slice.label} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: panel.colors[index % panel.colors.length] }} />
                      <span className="truncate font-medium text-gray-700">{slice.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="font-black text-gray-900">{naira(slice.amount)}</span>
                      <span className="w-14 text-right text-[11px] font-bold text-gray-400">{slice.sharePct}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
              <span className="text-[13px] font-bold text-gray-700">{panel.totalLabel}</span>
              <span className={`text-sm font-black ${panel.totalTone}`}>{naira(panel.data?.total ?? 0)}</span>
            </div>
            {panel.title === "Cash Out Breakdown" && (panel.data?.slices ?? []).some((slice) => slice.label === "Stock Purchases" && slice.amount === 0) && (
              <p className="m-0 mt-2 text-[11px] font-medium leading-4 text-amber-700">
                Stock Purchases reads zero because buying inventory has never been recorded as an expense. Until it is, cash out here is lower than what actually left the bank.
              </p>
            )}
          </section>
        ))}
      </div>

      {/* Transactions */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="m-0 text-sm font-black text-gray-900">Cash Flow Transactions</h2>
            <p className="m-0 mt-0.5 text-[12px] font-medium text-gray-400">All cash in and out transactions for this period</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[190px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions..."
                className="w-full rounded-xl border border-gray-200 py-2 pl-8 pr-3 text-[13px] font-medium text-gray-900 placeholder:text-gray-400" />
            </div>
            <select value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value as "all" | "in" | "out")}
              className="rounded-xl border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700">
              <option value="all">Filters: All</option>
              <option value="in">Cash In only</option>
              <option value="out">Cash Out only</option>
            </select>
            <select value={newestFirst ? "new" : "old"} onChange={(event) => setNewestFirst(event.target.value === "new")}
              className="rounded-xl border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700">
              <option value="new">Newest First</option>
              <option value="old">Oldest First</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/80">
              <tr className="text-[10px] font-black uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Date &amp; Time</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Source / Agent</th>
                <th className="px-4 py-3 text-right">Cash In (₦)</th>
                <th className="px-4 py-3 text-right">Cash Out (₦)</th>
                <th className="px-4 py-3 text-right">Balance (₦)</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && !view ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">Loading cash flow…</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">
                  {(view?.transactions.length ?? 0) === 0 ? "No cash moved in this period." : "No transactions match those filters."}
                </td></tr>
              ) : pageRows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50/60">
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="font-medium text-gray-700">{stampLabel(row.at)}</span>
                    <span className="ml-2 text-[11px] font-semibold text-gray-400">{timeLabel(row.at)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold ${row.direction === "in" ? "text-emerald-700" : "text-rose-700"}`}>
                      {row.direction === "in" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                      {row.direction === "in" ? "Cash In" : "Cash Out"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] font-medium text-gray-600">{row.category}</td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-[13px] text-gray-700" title={row.description}>{row.description}</td>
                  <td className="px-4 py-3 text-[13px] font-medium text-gray-600">{row.source}</td>
                  <td className="px-4 py-3 text-right text-[13px] font-black text-emerald-700">{row.cashIn > 0 ? Math.round(row.cashIn).toLocaleString("en-NG") : "–"}</td>
                  <td className="px-4 py-3 text-right text-[13px] font-black text-rose-700">{row.cashOut > 0 ? Math.round(row.cashOut).toLocaleString("en-NG") : "–"}</td>
                  <td className="px-4 py-3 text-right text-[13px] font-black text-gray-900">{Math.round(row.balance).toLocaleString("en-NG")}</td>
                  <td className="px-4 py-3 text-right">
                    <span title={`${row.category} · ${row.description}`} className="inline-flex cursor-help text-gray-300 hover:text-[#1F8FE0]">
                      <Eye className="h-4 w-4" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3.5">
          <p className="m-0 text-[12px] font-medium text-gray-500">
            Showing {firstShown} to {lastShown} of {transactions.length} transactions
          </p>
          <div className="flex items-center gap-1.5">
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}
              className="!min-h-0 rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).slice(0, 5).map((number) => (
              <button key={number} type="button" onClick={() => setPage(number)}
                className={`!min-h-0 h-8 w-8 rounded-lg border text-[12px] font-bold ${number === currentPage ? "border-[#1F8FE0] bg-[#1F8FE0] text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                {number}
              </button>
            ))}
            {totalPages > 5 && <span className="px-1 text-xs text-gray-400">…</span>}
            {totalPages > 5 && (
              <button type="button" onClick={() => setPage(totalPages)}
                className={`!min-h-0 h-8 w-8 rounded-lg border text-[12px] font-bold ${totalPages === currentPage ? "border-[#1F8FE0] bg-[#1F8FE0] text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                {totalPages}
              </button>
            )}
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}
              className="!min-h-0 rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-[12px] font-bold text-gray-700">
            {[5, 10, 25, 50].map((size) => <option key={size} value={size}>{size} / page</option>)}
          </select>
        </div>
      </section>

      </>
      )}

      {openingModal && (
        <SetOpeningCashModal
          view={view}
          history={props.openingHistory}
          saving={props.savingOpeningCash}
          onClose={() => setOpeningModal(false)}
          onSave={async (body) => { await props.onSaveOpeningCash(body); setOpeningModal(false); }}
        />
      )}
    </div>
  );
}

// ══ Set Opening Cash ══════════════════════════════════════

function SetOpeningCashModal({ view, history, saving, onClose, onSave }: {
  view: CashFlowView | null;
  history: OpeningBalanceRow[];
  saving: boolean;
  onClose: () => void;
  onSave: (body: { amount: number; effectiveAt: string; method: "manual" | "carry_forward"; reason: string }) => Promise<void>;
}) {
  // Carry forward is offered only when a previous closing figure actually
  // exists to carry; otherwise the option would promise a number it cannot
  // produce. Closing cash of the period BEFORE this one is what carries.
  const carryAmount = view ? view.openingCash : 0;
  const [method, setMethod] = useState<"carry_forward" | "manual">("carry_forward");
  const [amount, setAmount] = useState(String(Math.round(carryAmount)));
  const [date, setDate] = useState(view?.period.from ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("09:00");
  const [reason, setReason] = useState("");

  const applyMethod = (next: "carry_forward" | "manual") => {
    setMethod(next);
    if (next === "carry_forward") {
      setAmount(String(Math.round(carryAmount)));
      setReason((current) => current || `Carried forward from the previous period's closing cash.`);
    }
  };

  const numericAmount = Number(String(amount).replace(/[^\d.-]/g, ""));
  const invalid = !Number.isFinite(numericAmount) || numericAmount < 0 || !reason.trim() || !date;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose}
        className="!min-h-0 absolute inset-0 cursor-default bg-slate-900/40 p-0" />
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-6 py-5">
          <div>
            <h3 className="m-0 text-xl font-black text-gray-900">Set Opening Cash</h3>
            <p className="m-0 mt-0.5 text-[13px] font-medium text-gray-500">
              Opening cash is the actual liquid cash available at the beginning of the selected period.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="!min-h-0 rounded-lg bg-transparent p-1 text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50/70 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><CalendarDays className="h-5 w-5" /></span>
              <div>
                <p className="m-0 text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">Period</p>
                <p className="m-0 text-sm font-black text-gray-900">
                  {view ? `${dayLabel(view.period.from)} – ${stampLabel(`${view.period.to}T00:00:00Z`)}` : "—"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="m-0 text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">Current opening cash</p>
              <p className="m-0 text-lg font-black text-gray-900">{naira(view?.openingCash ?? 0)}</p>
              <p className="m-0 text-[11px] font-semibold text-gray-400">
                {view?.openingAnchor
                  ? `Set on ${stampLabel(view.openingAnchor.effectiveAt)} by ${view.openingAnchor.setByName || "Unknown"}`
                  : "Never set — derived from recorded cash"}
              </p>
            </div>
          </div>

          <p className="m-0 mt-5 text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">Choose how to set opening cash</p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([
              { key: "carry_forward" as const, title: "Carry forward previous period closing cash", hint: "Use the closing cash from the previous period as opening cash.", right: naira(carryAmount), rightHint: "Closing cash" },
              { key: "manual" as const, title: "Set opening cash manually", hint: "Enter the actual liquid cash available at the beginning of this period.", right: "", rightHint: "" }
            ]).map((option) => (
              <label key={option.key}
                className={`flex cursor-pointer gap-3 rounded-xl border px-4 py-3.5 ${method === option.key ? "border-[#1F8FE0] bg-blue-50/50 ring-1 ring-[#1F8FE0]/30" : "border-gray-200 bg-white"}`}>
                <input type="radio" className="mt-0.5 h-4 w-4 border-gray-300 text-[#1F8FE0]"
                  checked={method === option.key} onChange={() => applyMethod(option.key)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-black text-gray-900">{option.title}</span>
                    {option.right && (
                      <span className="shrink-0 text-right">
                        <span className="block text-[13px] font-black text-[#1F8FE0]">{option.right}</span>
                        <span className="block text-[10px] font-semibold text-gray-400">{option.rightHint}</span>
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-[11px] font-medium leading-4 text-gray-500">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-gray-200 px-4 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">
                Opening cash amount (₦) <span className="text-rose-500">*</span>
                <span className="relative mt-1.5 flex items-center">
                  <span className="pointer-events-none absolute left-3 text-sm font-black text-gray-400">₦</span>
                  <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric"
                    disabled={method === "carry_forward"}
                    className="w-full rounded-xl border border-gray-200 py-2.5 pl-8 pr-3 text-sm font-bold text-gray-900 disabled:bg-gray-50 disabled:text-gray-500" />
                </span>
                <span className="mt-1 block text-[11px] font-medium normal-case tracking-normal text-gray-400">
                  Enter only cash in hand / bank that is available for operations.
                </span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">
                  Effective date <span className="text-rose-500">*</span>
                  <input type="date" value={date} onChange={(event) => setDate(event.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900" />
                </label>
                <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">
                  Time <span className="text-rose-500">*</span>
                  <input type="time" value={time} onChange={(event) => setTime(event.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900" />
                </label>
              </div>
            </div>

            <label className="mt-4 block text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">
              Reason / notes <span className="text-rose-500">*</span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value.slice(0, 250))} rows={3}
                placeholder="Physical cash and bank balance counted before operations began."
                className="mt-1.5 w-full resize-y rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-900" />
              <span className="mt-1 block text-right text-[11px] font-semibold text-gray-400">{reason.length} / 250</span>
            </label>

            <div className="mt-2 flex gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-3.5 py-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              <p className="m-0 text-[12px] font-medium leading-5 text-blue-900">
                This opening cash amount will be used to calculate cash flow for this period.<br />
                Every change is kept in the history below — entries are never edited or removed, so a correction is a new entry.
              </p>
            </div>
          </div>

          <p className="m-0 mt-5 text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">Opening cash history</p>
          <div className="mt-2 overflow-hidden rounded-xl border border-gray-200">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr className="text-[10px] font-black uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2.5">Date &amp; Time</th>
                    <th className="px-3 py-2.5">Set By</th>
                    <th className="px-3 py-2.5 text-right">Amount (₦)</th>
                    <th className="px-3 py-2.5">Method</th>
                    <th className="px-3 py-2.5">Reason / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-[13px] text-gray-400">No opening cash has been set yet.</td></tr>
                  ) : history.map((row, index) => (
                    <tr key={row.id} className={index === 0 ? "bg-emerald-50/40" : ""}>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {index === 0 && (
                          <span className="mr-2 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">Current</span>
                        )}
                        <span className="text-[12px] font-medium text-gray-700">{stampLabel(row.effectiveAt)}</span>
                        <span className="ml-1.5 text-[11px] font-semibold text-gray-400">{timeLabel(row.effectiveAt)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-[12px] font-medium text-gray-700">{row.setByName || "Unknown"}</td>
                      <td className="px-3 py-2.5 text-right text-[12px] font-black text-gray-900">{Math.round(row.amount).toLocaleString("en-NG")}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${row.method === "carry_forward" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                          {row.method === "carry_forward" ? "Carry Forward" : "Manual"}
                        </span>
                      </td>
                      <td className="max-w-[240px] truncate px-3 py-2.5 text-[12px] text-gray-500" title={row.reason}>{row.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/70 px-3.5 py-2.5">
            <Filter className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <p className="m-0 text-[11px] font-medium text-gray-500">
              Opening cash entries are append-only and record who set them, so a disputed balance can always be traced.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2.5 border-t border-gray-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13px] font-black text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" disabled={saving || invalid}
            onClick={() => void onSave({
              amount: numericAmount,
              effectiveAt: `${date}T${time || "09:00"}:00+01:00`,
              method,
              reason: reason.trim()
            })}
            className="!min-h-0 rounded-xl bg-[#1F8FE0] px-4 py-2.5 text-[13px] font-black text-white hover:bg-[#1a7ec4] disabled:opacity-50">
            {saving ? "Saving…" : "Save Opening Cash"}
          </button>
        </div>
      </div>
    </div>
  );
}
