import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { ArrowDown, ArrowUp, Calendar, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { money } from "../lib/money-privacy";
import {
  CORRECTION_PROBLEMS, CORRECTION_SECTION_LABEL, REP_STATUS_LABEL, COMPANY_STATUS_LABEL, AUDIT_ACTION_LABEL,
  type WeeklyReportDayRow, type WeeklyReportProductRow
} from "../pages/weekly-report-model";
import type { WeeklyReportAuditEntry, WeeklyReportCorrection } from "../lib/api";

/**
 * Shared pieces of the three Weekly Report pages (rep, manager, owner), built
 * to Bright's three designs (1 Oct 2026). Kept here so the three pages look
 * the same: KPI cards, numbered sections, the workflow steps, the week picker,
 * the charts and the correction form.
 */

// ── Formatting ──────────────────────────────────────────────────────────────

export const nf = (value: number) => Math.round(value || 0).toLocaleString("en-NG");
export const pctText = (value: number, digits = 1) => `${(Number.isFinite(value) ? value : 0).toFixed(digits)}%`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
export const longDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]} ${y}`;
};
export const shortDay = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[(m || 1) - 1] === "Sept" ? "Sep" : MONTHS[(m || 1) - 1]}`;
};
export const dateTimeText = (iso: string | null | undefined) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const lagos = new Date(date.getTime() + 60 * 60 * 1000);
  const hours = lagos.getUTCHours();
  const minutes = String(lagos.getUTCMinutes()).padStart(2, "0");
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${lagos.getUTCDate()} ${MONTHS[lagos.getUTCMonth()]} ${lagos.getUTCFullYear()}, ${String(h12).padStart(2, "0")}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
};
export const shortDateTime = (iso: string | null | undefined) => {
  const full = dateTimeText(iso);
  // "14 Sept 2026, 10:24 AM" -> "14 Sept, 10:24 AM"
  return full.replace(/ \d{4},/, ",");
};

export const deltaPct = (now: number, before: number | null | undefined) => {
  if (before === null || before === undefined) return null;
  if (before === 0) return now > 0 ? 100 : 0;
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
};

// ── Status pills ────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, string> = {
  draft: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30",
  submitted: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:ring-blue-500/30",
  returned: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-500/30",
  manager_approved: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30",
  owner_approved: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30",
  locked: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-200 dark:ring-slate-600",
  open: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:ring-blue-500/30",
  submitted_to_owner: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30",
  returned_to_manager: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-500/30"
};

export function RepStatusPill({ status, approvedLabel }: { status: string; approvedLabel?: string }) {
  const label = status === "manager_approved" && approvedLabel ? approvedLabel : REP_STATUS_LABEL[status] ?? status;
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${STATUS_TONE[status] ?? STATUS_TONE.draft}`}>
      {label}
    </span>
  );
}

export function CompanyStatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${STATUS_TONE[status] ?? STATUS_TONE.open}`}>
      {COMPANY_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function OrderStatusPill({ status }: { status: string }) {
  const tone = status === "Delivered"
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200"
    : status === "Cancelled" || status === "Failed"
      ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200"
      : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200";
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold ${tone}`}>{status}</span>;
}

export function OrderTypePill({ type }: { type: string }) {
  const tone = type === "Cross-Sell"
    ? "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:ring-blue-500/30"
    : type === "Upsell"
      ? "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-500/30"
      : type === "Standard"
        ? "bg-gray-50 text-gray-600 ring-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
        : "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-200 dark:ring-indigo-500/30";
  return <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${tone}`}>{type}</span>;
}

// ── Cards and sections ──────────────────────────────────────────────────────

type Tone = "blue" | "green" | "orange" | "purple" | "red";
const TONES: Record<Tone, { card: string; tile: string }> = {
  blue: { card: "border-blue-100 bg-blue-50/40 dark:border-blue-500/20 dark:bg-blue-500/5", tile: "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-200" },
  green: { card: "border-emerald-100 bg-emerald-50/40 dark:border-emerald-500/20 dark:bg-emerald-500/5", tile: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-200" },
  orange: { card: "border-orange-100 bg-orange-50/40 dark:border-orange-500/20 dark:bg-orange-500/5", tile: "bg-orange-100 text-orange-500 dark:bg-orange-500/20 dark:text-orange-200" },
  purple: { card: "border-violet-100 bg-violet-50/40 dark:border-violet-500/20 dark:bg-violet-500/5", tile: "bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-200" },
  red: { card: "border-rose-100 bg-rose-50/40 dark:border-rose-500/20 dark:bg-rose-500/5", tile: "bg-rose-100 text-rose-500 dark:bg-rose-500/20 dark:text-rose-200" }
};

export function KpiCard({ tone, icon: Icon, label, value, delta, sub, labelTone }: {
  tone: Tone;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  delta?: number | null;
  sub: string;
  labelTone?: string;
}) {
  return (
    <div className={`flex min-w-0 items-center gap-3 rounded-2xl border px-3.5 py-4 shadow-sm ${TONES[tone].card}`}>
      <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${TONES[tone].tile}`}>
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`m-0 text-[13px] font-semibold leading-tight ${labelTone ?? "text-gray-700 dark:text-slate-300"}`}>{label}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-[22px] font-black tracking-tight text-gray-900 dark:text-slate-50">{value}</span>
          {delta === undefined ? null : delta === null ? (
            <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-bold text-gray-500 dark:bg-slate-800 dark:text-slate-400">-</span>
          ) : (
            <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${delta >= 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200"}`}>
              {delta >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(delta).toFixed(Math.abs(delta) < 10 ? 1 : 0)}%
            </span>
          )}
        </div>
        <p className="m-0 mt-1 text-[11px] leading-tight text-gray-500 dark:text-slate-400">{sub}</p>
      </div>
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {children}
    </section>
  );
}

export function NumberedHeader({ n, title, subtitle, right, icon: Icon }: {
  n?: number;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4">
      <div className="flex items-start gap-3">
        {n !== undefined ? (
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1F8FE0] text-[13px] font-bold text-white">{n}</span>
        ) : Icon ? (
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-200"><Icon className="h-4 w-4" /></span>
        ) : null}
        <div>
          <h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">{title}</h2>
          {subtitle && <p className="m-0 mt-0.5 text-[12px] text-gray-500 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

export function RateBar({ value, tone }: { value: number; tone?: "auto" | "green" | "blue" }) {
  const color = tone === "green"
    ? "bg-emerald-500"
    : tone === "blue"
      ? "bg-blue-500"
      : value >= 55 ? "bg-emerald-500" : value >= 50 ? "bg-amber-400" : "bg-rose-500";
  return (
    <span className="block h-2 w-full min-w-[36px] overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
      <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
  const hue = Array.from(name).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
      style={{ width: size, height: size, background: `hsl(${hue} 55% 42%)` }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

// ── Week picker (calendar box + arrows, as drawn) ───────────────────────────

export function WeekPicker({ weekStart, weekEnd, onShift, canGoNext, onPick }: {
  weekStart: string;
  weekEnd: string;
  onShift: (weeks: number) => void;
  canGoNext: boolean;
  onPick?: (dateKey: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="relative flex h-11 items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-800 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <Calendar className="h-4 w-4 text-gray-500" />
        <span className="border-l border-gray-200 pl-3 dark:border-slate-700">Week: {longDate(weekStart)} – {longDate(weekEnd)}</span>
        <ArrowUp className="h-4 w-4 text-gray-500" />
        {onPick && (
          <input
            type="date"
            aria-label="Pick a week"
            className="absolute inset-0 cursor-pointer opacity-0"
            value={weekStart}
            onChange={(event) => event.target.value && onPick(event.target.value)}
          />
        )}
      </label>
      <div className="flex h-11 items-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <button type="button" aria-label="Previous week" onClick={() => onShift(-1)} className="!min-h-0 px-2.5 text-gray-600 hover:text-gray-900 dark:text-slate-300">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Next week" disabled={!canGoNext} onClick={() => onShift(1)} className="!min-h-0 px-2.5 text-gray-600 hover:text-gray-900 disabled:opacity-30 dark:text-slate-300">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Workflow steps ──────────────────────────────────────────────────────────

export type WorkflowStep = {
  title: string;
  detail: string;
  state: "done" | "current" | "pending";
  badge?: ReactNode;
};

export function WorkflowSteps({ steps }: { steps: WorkflowStep[] }) {
  return (
    <ol className="m-0 list-none space-y-0 p-0">
      {steps.map((step, index) => (
        <li key={step.title} className="relative flex gap-3 pb-5 last:pb-0">
          {index < steps.length - 1 && (
            <span className={`absolute left-[15px] top-8 bottom-0 w-px ${step.state === "done" ? "bg-emerald-300" : "bg-gray-200 dark:bg-slate-700"}`} aria-hidden="true" />
          )}
          <span className={`relative z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
            step.state === "done"
              ? "bg-emerald-500 text-white"
              : step.state === "current"
                ? "bg-[#1F8FE0] text-white"
                : "border border-gray-300 bg-white text-gray-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400"
          }`}>
            {step.state === "done" ? <Check className="h-4 w-4" strokeWidth={3} /> : index + 1}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="m-0 text-[13px] font-semibold text-gray-900 dark:text-slate-100">{step.title}</p>
            <p className="m-0 mt-0.5 text-[12px] leading-snug text-gray-500 dark:text-slate-400">{step.detail}</p>
            {step.badge && <div className="mt-1.5">{step.badge}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function StepBadge({ tone, children }: { tone: "green" | "blue" | "gray"; children: ReactNode }) {
  const cls = tone === "green"
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200"
    : tone === "blue"
      ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
      : "bg-transparent text-gray-500 dark:text-slate-400";
  const dot = tone === "green" ? "bg-emerald-500" : tone === "blue" ? "bg-blue-600" : "border border-gray-400";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${cls}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />{children}
    </span>
  );
}

// ── Note box ────────────────────────────────────────────────────────────────

export function NoteBox({ label, value, onChange, placeholder, disabled, max = 500 }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  max?: number;
}) {
  return (
    <div>
      <p className="m-0 mb-2 text-[13px] font-semibold text-gray-800 dark:text-slate-200">{label}</p>
      <textarea
        value={value}
        disabled={disabled}
        maxLength={max}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-[#1F8FE0] disabled:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      <p className="m-0 mt-1 text-right text-[11px] text-gray-400">{value.length}/{max}</p>
    </div>
  );
}

// ── Charts ──────────────────────────────────────────────────────────────────

const axisTick = { fontSize: 11, fill: "#6b7280" };

/** Bars for orders and delivered, a line for the delivery rate on the right axis. */
export function OrdersRateChart({ rows, ordersColor, deliveredColor, height = 230 }: {
  rows: Array<{ label: string; orders: number; delivered: number; deliveryRate: number }>;
  ordersColor: string;
  deliveredColor: string;
  height?: number;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
          <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
          <YAxis yAxisId="left" tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(value) => `${value}%`} tick={axisTick} axisLine={false} tickLine={false} />
          <Tooltip formatter={(value: any, name: any) => (name === "Delivery Rate" ? `${Number(value).toFixed(1)}%` : value)} />
          <Bar yAxisId="left" dataKey="orders" name="Orders" fill={ordersColor} radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Bar yAxisId="left" dataKey="delivered" name="Delivered" fill={deliveredColor} radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Line yAxisId="right" dataKey="deliveryRate" name="Delivery Rate" stroke="#f97316" strokeWidth={2} dot={{ r: 4, fill: "#f97316" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-4 px-5 pt-3 text-[12px] text-gray-600 dark:text-slate-300">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />{item.label}
        </span>
      ))}
    </div>
  );
}

export const dailyChartRows = (daily: WeeklyReportDayRow[]) =>
  daily.map((day) => ({ label: shortDay(day.date), orders: day.orders, delivered: day.delivered, deliveryRate: day.deliveryRate }));

const DONUT_COLORS = ["#3b82f6", "#10b981", "#f97316", "#a855f7", "#9ca3af"];

/** Top four products plus "Others", as the designs draw it. */
export const topProductsWithOthers = (products: WeeklyReportProductRow[], limit = 4) => {
  const sorted = [...products].sort((a, b) => b.orders - a.orders);
  if (sorted.length <= limit + 1) return sorted;
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const orders = rest.reduce((sum, row) => sum + row.orders, 0);
  const delivered = rest.reduce((sum, row) => sum + row.delivered, 0);
  return [...top, { key: "__others", name: "Others", orders, delivered, deliveryRate: orders > 0 ? Math.round((delivered / orders) * 1000) / 10 : 0 }];
};

export function ProductDonut({ products, metric = "orders", compact }: {
  products: WeeklyReportProductRow[];
  metric?: "orders" | "delivered";
  compact?: boolean;
}) {
  const rows = topProductsWithOthers(products);
  const total = rows.reduce((sum, row) => sum + row[metric], 0);
  const data = rows.map((row) => ({ name: row.name, value: row[metric] }));
  return (
    <div className={`flex flex-col items-center gap-4 px-5 pb-5 pt-2 ${compact ? "sm:flex-row" : "md:flex-row"}`}>
      <div className={`relative shrink-0 ${compact ? "h-[150px] w-[150px]" : "h-[170px] w-[170px]"}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={total > 0 ? data : [{ name: "None", value: 1 }]} dataKey="value" innerRadius={compact ? 46 : 52} outerRadius={compact ? 70 : 78} startAngle={90} endAngle={-270} stroke="none">
              {(total > 0 ? data : [{ name: "None", value: 1 }]).map((_, index) => (
                <Cell key={index} fill={total > 0 ? DONUT_COLORS[index % DONUT_COLORS.length] : "#e5e7eb"} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-black text-gray-900 dark:text-slate-50">{nf(total)}</span>
          <span className="text-[11px] text-gray-500 dark:text-slate-400">Total {metric === "orders" ? "Orders" : "Delivered"}</span>
        </div>
      </div>
      <ul className="m-0 w-full list-none space-y-2.5 p-0">
        {rows.map((row, index) => (
          <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-[12px]">
            <span className="flex min-w-0 items-center gap-2 text-gray-700 dark:text-slate-300">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }} />
              <span className="truncate">{row.name}</span>
            </span>
            <span className="text-right font-bold text-gray-900 dark:text-slate-100">{nf(row[metric])}</span>
            <span className="w-12 text-right text-gray-500 dark:text-slate-400">{compact ? `(${pctText(total > 0 ? (row[metric] / total) * 100 : 0)})` : pctText(total > 0 ? (row[metric] / total) * 100 : 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Modal shell ─────────────────────────────────────────────────────────────

export function Modal({ title, subtitle, onClose, children, wide }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-slate-900 ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h3 className="m-0 text-base font-bold text-gray-900 dark:text-slate-50">{title}</h3>
            {subtitle && <p className="m-0 mt-0.5 text-[12px] text-gray-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// ── Return / flag form ──────────────────────────────────────────────────────

export type CorrectionDraft = { section: string; problem: string; comment: string; orderRef: string };

/**
 * No vague returns: a section, a problem and a comment are all required
 * (Bright, 1 Oct 2026). Used for the manager's Return / Flag and the owner's
 * Return to Manager.
 */
export function CorrectionForm({ title, subtitle, submitLabel, tone, initialComment, onCancel, onSubmit }: {
  title: string;
  subtitle: string;
  submitLabel: string;
  tone: "rose" | "amber";
  initialComment?: string;
  onCancel: () => void;
  onSubmit: (draft: CorrectionDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<CorrectionDraft>({ section: "", problem: "", comment: initialComment ?? "", orderRef: "" });
  const [customProblem, setCustomProblem] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const problems = draft.section ? CORRECTION_PROBLEMS[draft.section] ?? [] : [];
  const problem = draft.problem === "__other" || (draft.section === "other") ? customProblem.trim() : draft.problem;
  const ready = !!draft.section && problem.length >= 3 && draft.comment.trim().length >= 3;
  const field = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  return (
    <Modal title={title} subtitle={subtitle} onClose={onCancel}>
      <div className="space-y-4 px-6 py-5">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Which section?</span>
          <select className={field} value={draft.section} onChange={(event) => setDraft({ ...draft, section: event.target.value, problem: "" })}>
            <option value="">Choose a section</option>
            {Object.entries(CORRECTION_SECTION_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        {draft.section && draft.section !== "other" && (
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-bold text-gray-700 dark:text-slate-300">What is the problem?</span>
            <select className={field} value={draft.problem} onChange={(event) => setDraft({ ...draft, problem: event.target.value })}>
              <option value="">Choose a problem</option>
              {problems.map((item) => <option key={item} value={item}>{item}</option>)}
              <option value="__other">Something else…</option>
            </select>
          </label>
        )}
        {(draft.problem === "__other" || draft.section === "other") && (
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Describe the problem</span>
            <input className={field} value={customProblem} maxLength={300} onChange={(event) => setCustomProblem(event.target.value)} placeholder="e.g. Cross-sell on #4307 needs verification" />
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Order number (if it is about one order)</span>
          <input className={field} value={draft.orderRef} maxLength={60} onChange={(event) => setDraft({ ...draft, orderRef: event.target.value })} placeholder="e.g. #4307" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Comment</span>
          <textarea className={`${field} resize-none`} rows={4} maxLength={2000} value={draft.comment} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} placeholder="What should be checked or fixed?" />
        </label>
        {error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200">Cancel</button>
          <button
            type="button"
            disabled={!ready || saving}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                await onSubmit({ ...draft, problem, comment: draft.comment.trim(), orderRef: draft.orderRef.trim() });
              } catch (err: any) {
                setError(err?.message ?? "Could not save.");
                setSaving(false);
              }
            }}
            className={`!min-h-0 rounded-xl px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40 ${tone === "rose" ? "bg-rose-600 hover:bg-rose-700" : "bg-amber-500 hover:bg-amber-600"}`}
          >
            {saving ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Corrections and audit tables ────────────────────────────────────────────

export function CorrectionList({ corrections, repNameById, empty }: {
  corrections: WeeklyReportCorrection[];
  repNameById?: (repReportId: string | null) => string;
  empty: ReactNode;
}) {
  if (corrections.length === 0) return <>{empty}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full !min-w-[600px] text-left text-[12px]">
        <thead className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]">
          <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
            <th className="px-4 py-2.5 font-bold">Date</th>
            <th className="px-4 py-2.5 font-bold">Reported by</th>
            {repNameById && <th className="px-4 py-2.5 font-bold">Sales rep</th>}
            <th className="px-4 py-2.5 font-bold">Issue / comment</th>
            <th className="px-4 py-2.5 font-bold">Status</th>
            <th className="px-4 py-2.5 font-bold">Answer</th>
          </tr>
        </thead>
        <tbody>
          {corrections.map((row) => (
            <tr key={row.id} className="border-t border-gray-100 align-top dark:border-slate-800">
              <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{shortDateTime(row.createdAt)}</td>
              <td className="px-4 py-3 text-gray-800 dark:text-slate-200">{row.raisedByName ?? "-"}<span className="block text-[11px] text-gray-500">{row.raisedByRole}</span></td>
              {repNameById && <td className="px-4 py-3 text-gray-800 dark:text-slate-200">{repNameById(row.repReportId)}</td>}
              <td className="min-w-[260px] px-4 py-3 text-gray-800 dark:text-slate-200">
                <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${row.kind === "flag" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>{row.kind === "flag" ? "Flag" : "Return"}</span>
                <strong>{CORRECTION_SECTION_LABEL[row.section] ?? row.section}:</strong> {row.problem}{row.orderRef ? ` (${row.orderRef})` : ""}
                <span className="mt-0.5 block text-gray-500 dark:text-slate-400">{row.comment}</span>
              </td>
              <td className="px-4 py-3">
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${row.status === "open" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{row.status === "open" ? "Open" : "Resolved"}</span>
              </td>
              <td className="min-w-[120px] px-4 py-3 text-gray-600 dark:text-slate-300">{row.response ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const auditDetailText = (entry: WeeklyReportAuditEntry) => {
  const detail = entry.detail ?? {};
  const parts: string[] = [];
  if (detail.section) parts.push(`${CORRECTION_SECTION_LABEL[detail.section] ?? detail.section}: ${detail.problem ?? ""}${detail.orderRef ? ` (${detail.orderRef})` : ""}`);
  if (detail.comment) parts.push(`"${detail.comment}"`);
  if (detail.orders !== undefined && detail.orders !== null) parts.push(`${detail.orders} orders, ${detail.delivered ?? 0} delivered`);
  if (detail.finalBonus !== undefined && detail.finalBonus !== null) parts.push(`bonus ${money(Number(detail.finalBonus))}`);
  if (detail.totalBonus !== undefined && detail.totalBonus !== null) parts.push(`bonus ${money(Number(detail.totalBonus))}`);
  if (detail.repReportsLocked !== undefined) parts.push(`${detail.repReportsLocked} rep reports locked`);
  if (detail.reason) parts.push(`Reason: ${detail.reason}`);
  if (detail.note) parts.push(`Note: ${detail.note}`);
  return parts.join(" · ");
};

export function AuditTable({ entries, repName }: { entries: WeeklyReportAuditEntry[]; repName?: (repId: string | null) => string }) {
  if (entries.length === 0) {
    return <p className="m-0 px-5 py-8 text-center text-[13px] text-gray-500 dark:text-slate-400">Nothing has happened on this week yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full !min-w-[720px] text-left text-[12px]">
        <thead className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]">
          <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
            <th className="px-4 py-2.5 font-bold">When</th>
            <th className="px-4 py-2.5 font-bold">Who</th>
            <th className="px-4 py-2.5 font-bold">What happened</th>
            {repName && <th className="px-4 py-2.5 font-bold">Report</th>}
            <th className="px-4 py-2.5 font-bold">Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-gray-100 align-top dark:border-slate-800">
              <td className="whitespace-nowrap px-4 py-3 text-gray-600 dark:text-slate-300">{dateTimeText(entry.createdAt)}</td>
              <td className="px-4 py-3 text-gray-800 dark:text-slate-200">{entry.actorName ?? "-"}<span className="block text-[11px] text-gray-500">{entry.actorRole}</span></td>
              <td className="px-4 py-3 font-semibold text-gray-900 dark:text-slate-100">{AUDIT_ACTION_LABEL[entry.action] ?? entry.action}</td>
              {repName && <td className="px-4 py-3 text-gray-700 dark:text-slate-300">{entry.repId ? repName(entry.repId) : "Company week"}</td>}
              <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{auditDetailText(entry) || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


/** Downloads rows as a CSV file. */
export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  const escape = (value: string | number) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
