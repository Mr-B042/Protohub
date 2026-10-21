import { useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, BarChart3, LayoutGrid, MapPin, Search, Table2 } from "lucide-react";
import { ResponsiveContainer } from "recharts";
import type { DateWindow, PresetKey } from "../lib/date-window";
import type { RepProductOrder } from "./RepProductPerformancePage";

// Shared by every tab of Product Performance (Sales Rep): the context a tab
// gets from the page, and the pieces the designs repeat.

export type FunnelFigures = { placed: number; confirmed: number; pending: number; cancelled: number; dispatched: number; delivered: number; failed: number; revenue: number; net: number };
export type AddOnMoney = { revenue: number; profit: number; bonus: number; upsellRevenue: number; crossSellRevenue: number };

export type RppCtx = {
  /** Orders PLACED in the period, after the filters. */
  current: RepProductOrder[];
  /** The same-length period just before, same filters. */
  before: RepProductOrder[];
  window: DateWindow;
  /** Today (Lagos): daily charts stop here instead of drawing future days as zero. */
  todayKey: string;
  preset: PresetKey | "custom";
  /** "This Week", "This Month" ... for chart titles. */
  periodName: string;
  /** "vs last week" ... */
  compare: string;
  periodLabel: string;
  repIds: string[];
  nameOfRep: (id: string) => string;
  imageOf: (productKey: string) => string | null;
  productName: (productKey: string) => string;
  funnelOf: (list: RepProductOrder[]) => FunnelFigures;
  bonusFor: (orderIds: string[]) => number;
  addOnFor: (orderId: string) => AddOnMoney | null;
  target: number;
  canSeeProfit: boolean;
  openList: (title: string, subtitle: string, list: RepProductOrder[]) => void;
};

export const SERIES = ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b", "#94a3b8"];
export const OTHERS_COLOR = "#cbd5e1";
export const nf = (value: number) => Math.round(value).toLocaleString("en-NG");
export const pct = (value: number | null, digits = 0) => (value === null ? "-" : `${value.toFixed(digits)}%`);
export const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
export const change = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

export function LowerToolbar<T extends string>({ tabs, active, onTab, search, onSearch, placeholder, view, onView }: {
  tabs: readonly T[]; active: T; onTab: (tab: T) => void; search: string; onSearch: (value: string) => void; placeholder: string;
  view: "table" | "chart"; onView: (view: "table" | "chart") => void;
}) {
  return (
    <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
      <div className="-mx-1 overflow-x-auto"><div className="flex min-w-max gap-2 px-1">
        {tabs.map((tab) => (
          <button key={tab} type="button" onClick={() => onTab(tab)}
            className={`!min-h-0 whitespace-nowrap rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors ${active === tab ? "bg-indigo-600 text-white shadow-sm" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>{tab}</button>
        ))}
      </div></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative block w-full sm:w-[220px]">
          <span className="sr-only">{placeholder}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-[13px] outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
        </label>
        <div className="flex gap-1">
          {([["table", "Table View", Table2], ["chart", "Chart View", BarChart3]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => onView(key)} aria-pressed={view === key}
              className={`!min-h-0 inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold ${view === key ? "border border-indigo-500 bg-white text-indigo-700 dark:bg-slate-900 dark:text-indigo-300" : "text-gray-600 hover:bg-gray-100 dark:text-slate-300"}`}><Icon className="h-4 w-4" />{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WaitingForDesign({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900">
      <LayoutGrid className="mx-auto h-8 w-8 text-gray-300" />
      <p className="m-0 mt-3 text-[15px] font-bold text-gray-800 dark:text-slate-100">{what} is waiting for its design</p>
      <p className="m-0 mt-1 text-[13px] text-gray-500">Send the screen for this view and it will be built exactly like it.</p>
    </div>
  );
}

export function ChartCard({ title, legend, action, height = 210, children }: { title: string; legend?: Array<[string, string]>; action?: ReactNode; height?: number; children: React.ReactElement }) {
  return (
    <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 text-[14.5px] font-bold text-gray-900 dark:text-slate-100">{title}</h2>
        {legend && <div className="flex flex-wrap gap-3 text-[11px] text-gray-600 dark:text-slate-400">{legend.map(([color, label]) => <span key={label} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{label}</span>)}</div>}
        {action}
      </div>
      <div style={{ height }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
    </section>
  );
}

export function TableCard({ title, action, children, className = "" }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4"><h2 className="m-0 text-[14.5px] font-bold text-gray-900 dark:text-slate-100">{title}</h2>{action}</div>
      <div className="mt-2 overflow-x-auto px-2 pb-2">{children}</div>
    </section>
  );
}

export function MiniSelect({ value, onChange, options, label, className = "w-[170px]" }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; label: string; className?: string }) {
  return (
    <label className={`relative block ${className}`}><span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="!min-h-0 h-8 w-full appearance-none truncate rounded-lg border border-gray-200 bg-white pl-2.5 pr-6 text-[12px] text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">▼</span>
    </label>
  );
}

/** States have no flags in Protohub: a map pin in a coloured tile instead. */
export function StateIcon({ name, size = 26 }: { name: string; size?: number }) {
  const tones = ["bg-emerald-100 text-emerald-700", "bg-blue-100 text-blue-700", "bg-violet-100 text-violet-700", "bg-amber-100 text-amber-700", "bg-rose-100 text-rose-700"];
  const tone = tones[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % tones.length];
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-md ${tone}`} style={{ width: size, height: size }} aria-hidden><MapPin className="h-3.5 w-3.5" /></span>;
}

/** Little bars, one per day, coloured by the direction of travel. */
export function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const half = Math.floor(values.length / 2);
  const first = values.slice(0, half).reduce((a, b) => a + b, 0), last = values.slice(values.length - half).reduce((a, b) => a + b, 0);
  const color = last > first * 1.1 ? "#22c55e" : last < first * 0.9 ? "#ef4444" : "#f59e0b";
  return (
    <span className="inline-flex h-5 items-end gap-[2px]" aria-label={`Orders by day: ${values.join(", ")}`}>
      {values.map((value, index) => <span key={index} className="w-[5px] rounded-sm" style={{ height: `${Math.max(12, (value / max) * 100)}%`, background: value === 0 ? "#e5e7eb" : color }} />)}
    </span>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3"><h2 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-100">{title}</h2><button type="button" onClick={onClose} className="!min-h-0 rounded-lg px-2 text-gray-500 hover:bg-gray-100">✕</button></div>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  return [on, useCallback(() => setOn((value) => !value), [])] as const;
}

export function KpiCard({ icon, tone, value, label, delta, points = false, compare = "" }: { icon: ReactNode; tone: string; value: string; label: string; delta?: number | null; points?: boolean; compare?: string }) {
  const size = value.length > 10 ? "text-[16px] sm:text-[17px]" : value.length > 7 ? "text-[18px] sm:text-[19px]" : "text-[20px] sm:text-[22px]";
  const deltaText = delta === undefined ? null : delta === null ? <span className="text-[11px] text-gray-400">—</span> : (
    <span className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[11.5px] font-bold ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
      {delta >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(Math.round(delta))}{points ? " pts" : "%"}
    </span>
  );
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-3.5 dark:border-slate-800 dark:bg-slate-900">
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-11 sm:w-11 ${tone} dark:bg-white/5`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-1">
          <div className={`whitespace-nowrap font-black tracking-tight text-gray-900 dark:text-slate-50 ${size}`}>{value}</div>
          {deltaText && <div className="hidden shrink-0 text-right leading-tight 2xl:block">{deltaText}<div className="text-[10px] text-gray-400">{compare}</div></div>}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-gray-500 dark:text-slate-400" title={label}>{label}</div>
        {deltaText && <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-gray-400 2xl:hidden">{deltaText}<span className="truncate">{compare}</span></div>}
      </div>
    </div>
  );
}

export function Card({ title, sub, action, children }: { title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-100">{title}</h2>{sub && <p className="m-0 mt-0.5 text-[12px] text-gray-500">{sub}</p>}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function RankBadge({ rank }: { rank: number }) {
  const tone = rank === 1 ? "bg-amber-100 text-amber-700 ring-amber-300" : rank === 2 ? "bg-slate-100 text-slate-600 ring-slate-300" : rank === 3 ? "bg-orange-100 text-orange-700 ring-orange-300" : "bg-blue-50 text-blue-700 ring-blue-200";
  return <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black ring-2 ${tone}`}>{rank}</span>;
}
