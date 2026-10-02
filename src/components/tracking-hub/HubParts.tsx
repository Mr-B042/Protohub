import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUp, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CodeXml, Copy, Ghost, Infinity as InfinityIcon, MoreHorizontal, Music2, Search, ShoppingBag, X
} from "lucide-react";
import type { HubDataSource, HubLedgerStatus, HubPlatform } from "../../lib/api";

// Shared pieces for the Tracking Hub tabs (Bright's seven tab images, 2 Oct 2026).

export type HubTab = "overview" | "sources" | "websites" | "links" | "ledger" | "reconciliation" | "diagnostics" | "settings";
export type Range = { from: string; to: string };
export type Toast = (message: string) => void;

// ---------------------------------------------------------------- dates / numbers

export const lagosToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
export const shift = (key: string, days: number) => { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
export const longDay = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const shortDay = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
export const timeWithSeconds = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "Africa/Lagos" });
export const dateTime = (iso: string) => `${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Africa/Lagos" })} • ${timeOf(iso)}`;
export const ago = (iso: string | null | undefined) => {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};
export const naira = (value: number, currency = "NGN") => `${currency === "NGN" ? "₦" : ""}${Math.round(value).toLocaleString("en-NG")}`;
export const nf = (value: number) => Math.round(value).toLocaleString("en-NG");
export const pctText = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${Number(value.toFixed(1))}%`);
export const STRATEGY_LABEL: Record<string, string> = { browser_capi: "Browser + CAPI", capi_only: "CAPI only", landing_page: "Thank-you page Pixel", off: "Off" };
export const PLATFORM_LABEL: Record<string, string> = { meta: "Meta", tiktok: "TikTok", google: "Google", snapchat: "Snapchat", other: "Other" };

export const PRESETS = [
  { key: "today", label: "Today", range: (): Range => { const t = lagosToday(); return { from: t, to: t }; } },
  { key: "yesterday", label: "Yesterday", range: (): Range => { const y = shift(lagosToday(), -1); return { from: y, to: y }; } },
  { key: "7d", label: "Last 7 days", range: (): Range => ({ from: shift(lagosToday(), -6), to: lagosToday() }) },
  { key: "30d", label: "Last 30 days", range: (): Range => ({ from: shift(lagosToday(), -29), to: lagosToday() }) }
];
export const presetLabel = (range: Range) => PRESETS.find((item) => { const r = item.range(); return r.from === range.from && r.to === range.to; })?.label ?? "Custom";
export const compareWord = (range: Range) => (presetLabel(range) === "Today" ? "vs yesterday" : presetLabel(range) === "Yesterday" ? "vs day before" : "vs previous period");

export function copyText(text: string, onToast: Toast, what = "Copied.") {
  void navigator.clipboard?.writeText(text);
  onToast(what);
}

// ---------------------------------------------------------------- classes

export const input = "mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
export const labelCls = "block text-[12px] font-bold text-gray-700 dark:text-slate-300";
export const primaryButton = "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-[14px] font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50";
export const darkButton = "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-[14px] font-bold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";
export const outlineButton = "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
export const smallButton = "!min-h-0 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
export const smallBlueButton = "!min-h-0 inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-900 dark:bg-slate-900";
export const selectCls = "!min-h-0 h-10 rounded-lg border border-gray-200 bg-white px-3 pr-8 text-[13px] text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
// Tables: undo the app-wide td padding / min-width so the hub's dense tables fit.
export const tableCls = "!min-w-0 w-full text-left text-[12.5px] [&_td]:!px-2 [&_th]:!px-2 [&_th]:!py-2.5 [&_th]:!text-[12px] [&_th]:!font-semibold";
// List tables beside a detail panel: one line per cell, tighter padding.
export const listTableCls = "!min-w-0 w-full text-left text-[11.5px] [&_td]:!px-1.5 [&_th]:!px-1.5 [&_th]:!py-2.5 [&_th]:!text-[11.5px] [&_th]:!font-semibold [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap";
export const rowCls = "border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit]";

// ---------------------------------------------------------------- layout

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${className}`}>{children}</section>;
}

/** Page header for a tab: breadcrumb, title, subtitle, actions. */
export function HubHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 xl:flex-nowrap">
      <div className="min-w-0 flex-1">
        <p className="m-0 flex items-center gap-2 text-[14px] text-gray-500 dark:text-slate-400">Tracking Hub <ChevronRight className="h-3.5 w-3.5" /> <span className="font-semibold text-gray-800 dark:text-slate-200">{title}</span></p>
        <h1 className="m-0 mt-2 text-[30px] font-black tracking-tight text-gray-900 dark:text-slate-50">{title}</h1>
        <p className="m-0 mt-1 text-[15px] text-gray-500 dark:text-slate-400">{subtitle}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-stretch gap-3">{actions}</div> : null}
    </div>
  );
}

export function DateRangeButton({ range, onChange }: { range: Range; onChange: (range: Range) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className="!min-h-0 flex h-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-left dark:border-slate-700 dark:bg-slate-900">
        <CalendarDays className="h-5 w-5 text-gray-500" />
        <span>
          <span className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">{longDay(range.from)} – {longDay(range.to)}</span>
          <span className="block text-[12px] text-gray-500">{presetLabel(range)}</span>
        </span>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map((item) => (
                <button key={item.key} type="button" onClick={() => { onChange(item.range()); setOpen(false); }}
                  className={`!min-h-0 rounded-lg px-3 py-2 text-[13px] font-semibold ${presetLabel(range) === item.label ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-700 hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-200"}`}>{item.label}</button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
              <label>From<input type="date" value={range.from} max={range.to} onChange={(event) => onChange({ ...range, from: event.target.value })} className={input} /></label>
              <label>To<input type="date" value={range.to} min={range.from} max={lagosToday()} onChange={(event) => onChange({ ...range, to: event.target.value })} className={input} /></label>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Dropdown button ("Scan Website ▾", "Bulk Actions ▾", "Export ▾"). */
export function MenuButton({ label, icon, items, className = outlineButton, align = "right" }: { label: ReactNode; icon?: ReactNode; items: Array<{ label: string; onClick: () => void; danger?: boolean; disabled?: boolean }>; className?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className={`${className} h-full`}>{icon}{label}<ChevronDown className="h-4 w-4 text-gray-500" /></button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={`absolute ${align === "right" ? "right-0" : "left-0"} z-20 mt-1 max-h-80 min-w-[200px] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900`}>
            {items.length === 0 ? <p className="m-0 px-3 py-2 text-[13px] text-gray-500">Nothing here yet.</p> : null}
            {items.map((item) => (
              <button key={item.label} type="button" disabled={item.disabled} onClick={() => { setOpen(false); item.onClick(); }} className={`!min-h-0 block w-full rounded-lg px-3 py-2 text-left text-[13px] font-semibold hover:bg-gray-50 disabled:opacity-40 dark:hover:bg-slate-800 ${item.danger ? "text-rose-700" : "text-gray-700 dark:text-slate-200"}`}>{item.label}</button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ActionMenu({ items }: { items: Array<{ label: string; onClick: () => void; danger?: boolean }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block" onClick={(event) => event.stopPropagation()}>
      <button type="button" aria-label="More" onClick={() => setOpen((value) => !value)} className="!min-h-0 rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><MoreHorizontal className="h-4 w-4" /></button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {items.map((item) => (
              <button key={item.label} type="button" onClick={() => { setOpen(false); item.onClick(); }} className={`!min-h-0 block w-full rounded-md px-3 py-2 text-left text-[13px] font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 ${item.danger ? "text-rose-700" : "text-gray-700 dark:text-slate-200"}`}>{item.label}</button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className={`mt-10 w-full ${wide ? "max-w-4xl" : "max-w-xl"} rounded-2xl bg-white shadow-xl dark:bg-slate-900`} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4 dark:border-slate-800">
          <div><h3 className="m-0 text-lg font-black text-gray-900 dark:text-slate-100">{title}</h3>{subtitle ? <p className="m-0 mt-0.5 text-[13px] text-gray-500">{subtitle}</p> : null}</div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/** Underlined tabs (detail panels, ledger, reconciliation views, settings). */
export function UnderlineTabs<T extends string>({ tabs, value, onChange, className = "" }: { tabs: Array<{ key: T; label: string; icon?: ReactNode; count?: number }>; value: T; onChange: (value: T) => void; className?: string }) {
  return (
    <div className={`overflow-x-auto border-b border-gray-200 dark:border-slate-800 ${className}`}>
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => (
          <button key={tab.key} type="button" onClick={() => onChange(tab.key)}
            className={`!min-h-0 -mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-[13.5px] font-semibold ${value === tab.key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900 dark:text-slate-300"}`}>
            {tab.icon}{tab.label}{tab.count !== undefined ? <span className="text-[11px] font-semibold text-gray-400">({nf(tab.count)})</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Two-column list/detail layout: table on the left, detail panel on the right. */
export function SplitLayout({ list, panel, narrow }: { list: ReactNode; panel: ReactNode | null; narrow?: boolean }) {
  const cols = narrow ? "xl:grid-cols-[minmax(0,1fr)_370px] min-[1700px]:grid-cols-[minmax(0,1fr)_440px]" : "xl:grid-cols-[minmax(0,1fr)_400px] min-[1700px]:grid-cols-[minmax(0,1fr)_470px]";
  return <div className={`grid grid-cols-1 gap-4 ${panel ? cols : ""}`}>{list}{panel}</div>;
}

export function PanelClose({ onClose }: { onClose: () => void }) {
  return <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>;
}

// ---------------------------------------------------------------- KPI tiles

export type Tone = "blue" | "green" | "orange" | "red" | "purple" | "gray";
export const TONE_BG: Record<Tone, string> = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/40", green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40", orange: "bg-amber-50 text-amber-500 dark:bg-amber-950/40",
  red: "bg-rose-50 text-rose-600 dark:bg-rose-950/40", purple: "bg-violet-50 text-violet-600 dark:bg-violet-950/40", gray: "bg-gray-100 text-gray-500 dark:bg-slate-800"
};

export function Delta({ value, suffix = "%", invert = false }: { value: number | null | undefined; suffix?: string; invert?: boolean }) {
  if (value === null || value === undefined) return null;
  const good = invert ? value <= 0 : value >= 0;
  return <span className={`inline-flex items-center gap-0.5 whitespace-nowrap text-[12.5px] font-bold ${good ? "text-emerald-600" : "text-rose-600"}`}><ArrowUp className={`h-3.5 w-3.5 ${value < 0 ? "rotate-180" : ""}`} />{Math.abs(Number(value.toFixed(1)))}{suffix}</span>;
}

export function Kpi({ icon, tone, label, value, delta, sub, right, onClick }: { icon: ReactNode; tone: Tone; label: string; value: ReactNode; delta?: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={`!min-h-0 flex w-full min-w-0 items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-4 text-left dark:border-slate-800 dark:bg-slate-900 ${onClick ? "hover:border-blue-300" : ""}`}>
      <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${TONE_BG[tone]}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium leading-tight text-gray-600 dark:text-slate-400">{label}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <strong className="whitespace-nowrap text-[24px] font-black leading-none text-gray-900 dark:text-slate-50">{value}</strong>
          {delta ?? null}
        </span>
        {sub ? <span className="mt-1 block truncate text-[11px] text-gray-400">{sub}</span> : null}
      </span>
      {right}
    </Tag>
  );
}

/** Small stat tile used inside detail panels ("1,284 Purchase ↑12%"). */
export function MiniStat({ tone, value, label, change }: { tone: Tone; value: ReactNode; label: string; change?: number | null }) {
  const tones: Record<Tone, string> = {
    green: "border-emerald-100 bg-emerald-50/70 text-emerald-700", blue: "border-blue-100 bg-blue-50/70 text-blue-700", orange: "border-amber-100 bg-amber-50/70 text-amber-600",
    purple: "border-violet-100 bg-violet-50/70 text-violet-700", red: "border-rose-100 bg-rose-50/70 text-rose-700", gray: "border-gray-100 bg-gray-50 text-gray-700"
  };
  return (
    <div className={`rounded-xl border px-3.5 py-3 dark:border-slate-700 dark:bg-slate-800/50 ${tones[tone]}`}>
      <strong className="block text-[20px] font-black leading-tight">{value}</strong>
      <span className="block text-[12px] text-gray-600 dark:text-slate-300">{label}</span>
      {change !== undefined ? <span className="mt-1 block">{change === null ? <span className="text-[12px] text-gray-400">—</span> : <Delta value={change} />}</span> : null}
    </div>
  );
}

/** Progress ring (match rate, health). */
export function Ring({ value, size = 64, stroke = 7, color, children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const tint = color ?? (value >= 90 ? "#16a34a" : value >= 75 ? "#f59e0b" : "#e11d48");
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={tint} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.max(0, Math.min(100, value)) / 100)} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-center">{children}</div>
    </div>
  );
}

/** Tiny line under the link stats (views/orders over the period). */
export function Sparkline({ points, width = 96, height = 22, color }: { points: number[]; width?: number; height?: number; color?: string }) {
  if (points.length < 2) return <span className="block h-[22px]" />;
  const max = Math.max(1, ...points);
  const step = width / (points.length - 1);
  const path = points.map((value, index) => `${(index * step).toFixed(1)},${(height - 2 - (value / max) * (height - 4)).toFixed(1)}`).join(" ");
  const trend = points[points.length - 1] - points[0];
  const stroke = color ?? (trend >= 0 ? "#16a34a" : "#e11d48");
  return <svg width={width} height={height} className="block"><polyline points={path} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

export function Pagination({ page, pageSize, total, noun, onPage, onPageSize, sizes = [10, 15, 25, 50] }: { page: number; pageSize: number; total: number; noun: string; onPage: (page: number) => void; onPageSize: (size: number) => void; sizes?: number[] }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const nums: Array<number | "…"> = [];
  for (let n = 1; n <= pages; n += 1) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 1 || (page <= 3 && n <= 5) || (page >= pages - 2 && n >= pages - 4)) nums.push(n);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  const btn = "!min-h-0 inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-[13px] font-semibold";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-3">
      <span className="text-[13px] text-gray-500">Showing {first} – {last} of {nf(total)} {noun}</span>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label="Previous" disabled={page <= 1} onClick={() => onPage(page - 1)} className={`${btn} border-gray-200 text-gray-500 disabled:opacity-40 dark:border-slate-700`}><ChevronLeft className="h-4 w-4" /></button>
        {nums.map((n, index) => n === "…"
          ? <span key={`gap${index}`} className={`${btn} border-gray-200 text-gray-400 dark:border-slate-700`}>…</span>
          : <button key={n} type="button" onClick={() => onPage(n)} className={`${btn} ${n === page ? "border-blue-500 text-blue-600" : "border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-300"}`}>{n}</button>)}
        <button type="button" aria-label="Next" disabled={page >= pages} onClick={() => onPage(page + 1)} className={`${btn} border-gray-200 text-gray-500 disabled:opacity-40 dark:border-slate-700`}><ChevronRight className="h-4 w-4" /></button>
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} className={`${selectCls} !h-9`}>{sizes.map((size) => <option key={size} value={size}>{size} / page</option>)}</select>
      </div>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, className = "" }: { value: string; onChange: (value: string) => void; placeholder: string; className?: string }) {
  return (
    <label className={`relative block ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-[13px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
    </label>
  );
}

export function FilterSelect({ value, onChange, children, className = "" }: { value: string; onChange: (value: string) => void; children: ReactNode; className?: string }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className={`${selectCls} ${className}`}>{children}</select>;
}

export function CheckBox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <input type="checkbox" checked={checked} onClick={(event) => event.stopPropagation()} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-gray-300 accent-blue-600" />;
}

export function CopyButton({ text, onToast }: { text: string; onToast: Toast }) {
  return <button type="button" aria-label="Copy" onClick={(event) => { event.stopPropagation(); copyText(text, onToast); }} className="!min-h-0 rounded p-0.5 text-gray-400 hover:text-gray-700"><Copy className="h-3.5 w-3.5" /></button>;
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className={`!min-h-0 relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${checked ? "bg-blue-600" : "bg-gray-300 dark:bg-slate-600"}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}

// ---------------------------------------------------------------- status

export function StatusPill({ tone, children, size = "md" }: { tone: "green" | "orange" | "red" | "blue" | "gray" | "purple"; children: ReactNode; size?: "sm" | "md" }) {
  const tones = { green: "bg-emerald-50 text-emerald-700", orange: "bg-amber-50 text-amber-700", red: "bg-rose-50 text-rose-700", blue: "bg-blue-50 text-blue-700", gray: "bg-gray-100 text-gray-600", purple: "bg-violet-50 text-violet-700" };
  const dots = { green: "bg-emerald-500", orange: "bg-amber-500", red: "bg-rose-500", blue: "bg-blue-500", gray: "bg-gray-400", purple: "bg-violet-500" };
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ${size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]"} ${tones[tone]}`}><span className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} />{children}</span>;
}

export const sourceTone = (source: Pick<HubDataSource, "health">): ["green" | "orange" | "red" | "gray", string] =>
  source.health === "healthy" ? ["green", "Healthy"] : source.health === "testing" ? ["orange", "Testing"] : source.health === "error" ? ["red", "Error"]
    : source.health === "no_token" ? ["red", "No token"] : source.health === "disconnected" ? ["red", "Disconnected"] : ["gray", "Not tested"];

export const LEDGER_TONE: Record<HubLedgerStatus, "green" | "blue" | "orange" | "red" | "gray" | "purple"> = {
  deduped: "green", server_only: "blue", browser_only: "orange", capi_failed: "red", test: "blue", not_tracked: "red", page_pixel: "gray", capi_only: "purple", sending: "orange"
};

export function CheckDot({ ok, state }: { ok?: boolean | null; state?: "ok" | "fail" | "off" | "pending" }) {
  const s = state ?? (ok ? "ok" : "off");
  if (s === "ok") return <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-3 w-3" strokeWidth={3} /></span>;
  if (s === "fail") return <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-rose-500 text-white"><X className="h-3 w-3" strokeWidth={3} /></span>;
  if (s === "pending") return <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-dashed border-gray-300" />;
  return <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-white dark:bg-slate-700"><Check className="h-3 w-3" strokeWidth={3} /></span>;
}

// ---------------------------------------------------------------- icons

export function PlatformIcon({ platform, size = "md" }: { platform: HubPlatform | string; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 rounded-xl" : size === "sm" ? "h-5 w-5 rounded" : "h-7 w-7 rounded-md";
  const icon = size === "lg" ? "h-7 w-7" : size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  if (platform === "tiktok") return <span className={`inline-flex shrink-0 items-center justify-center bg-black text-white ${box}`}><Music2 className={icon} /></span>;
  if (platform === "google") return <span className={`inline-flex shrink-0 items-center justify-center border border-gray-200 bg-white font-black ${box} ${size === "lg" ? "text-[22px]" : size === "sm" ? "text-[11px]" : "text-[15px]"}`}><span className="bg-gradient-to-br from-blue-500 via-rose-500 to-amber-400 bg-clip-text text-transparent">G</span></span>;
  if (platform === "snapchat") return <span className={`inline-flex shrink-0 items-center justify-center bg-yellow-300 text-black ${box}`}><Ghost className={icon} /></span>;
  if (platform === "other") return <span className={`inline-flex shrink-0 items-center justify-center bg-violet-600 text-white ${box}`}><InfinityIcon className={icon} /></span>;
  return <span className={`inline-flex shrink-0 items-center justify-center bg-blue-600 text-white ${box}`}><InfinityIcon className={icon} /></span>;
}

export function SiteIcon({ platform, size = "md" }: { platform: string; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-11 w-11 text-[20px]" : "h-7 w-7 text-[13px]";
  if (platform === "Shopify") return <span className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ${box}`}><ShoppingBag className="h-4 w-4" /></span>;
  if (platform === "Custom" || platform === "Other") return <span className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ${box}`}><CodeXml className="h-4 w-4" /></span>;
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-full border-[2.5px] border-slate-700 font-black text-slate-700 dark:border-slate-300 dark:text-slate-300 ${box}`}>W</span>;
}

export function ProductThumb({ src, size = 40 }: { src: string | null | undefined; size?: number }) {
  return src
    ? <img src={src} alt="" className="shrink-0 rounded-lg border border-gray-100 object-cover" style={{ width: size, height: size }} />
    : <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-gray-100 text-[10px] font-bold text-gray-400 dark:bg-slate-800" style={{ width: size, height: size }}>IMG</span>;
}

// ---------------------------------------------------------------- data loading

export function useLoad<T>(load: () => Promise<T>, deps: unknown[], onError?: Toast) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    load().then((result) => { if (!cancelled) setData(result); }).catch((err: any) => { if (!cancelled) { setError(err?.message ?? "Could not load."); onError?.(err?.message ?? "Could not load."); } });
    return () => { cancelled = true; };
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((value) => value + 1), setData };
}

export function Loading({ text = "Loading…" }: { text?: string }) {
  return <Card className="p-10 text-center text-sm text-gray-500">{text}</Card>;
}

export function DetailRow({ label, children, copy, onToast }: { label: string; children: ReactNode; copy?: string | null; onToast?: Toast }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[13px] odd:bg-gray-50/60 dark:odd:bg-slate-800/30">
      <span className="pl-2 text-gray-500">{label}</span>
      <span className="flex min-w-0 items-center gap-2 pr-2 text-right font-medium text-gray-800 dark:text-slate-200"><span className="min-w-0 truncate">{children}</span>{copy && onToast ? <CopyButton text={copy} onToast={onToast} /> : null}</span>
    </div>
  );
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: ReactNode }) {
  return <tr><td colSpan={colSpan} className="py-10 text-center text-[13px] text-gray-500">{text}</td></tr>;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SetupGuide({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Setup guide" subtitle="Five steps from a Meta Pixel to tracked orders." onClose={onClose}>
      <ol className="m-0 list-decimal space-y-3 pl-5 text-[13.5px] text-gray-700 dark:text-slate-300">
        <li><strong>Connect a data source.</strong> In Meta Events Manager copy the Pixel (dataset) ID. In Business Settings → System Users create a token with ads_read. Paste both in Data Sources → Connect Data Source, then press Test Connection.</li>
        <li><strong>Add each website</strong> and choose the data source it should use. Press Scan Website to check the Pixel on its pages.</li>
        <li><strong>Create a tracking link</strong> for each landing page: product, website, form and thank-you page. Copy its embed code onto the landing page.</li>
        <li><strong>Remove the Purchase Pixel from the thank-you page</strong> for Browser + CAPI links (Protohub sends Purchase), place a test order and look for ONE Purchase in Meta Test Events. Tick the go-live checklist.</li>
        <li><strong>Add the URL parameters</strong> from Settings → Attribution &amp; UTM to every ad, so each order carries its campaign, ad set and ad.</li>
      </ol>
    </Modal>
  );
}
