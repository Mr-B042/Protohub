import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DeferredCharts } from "./DeferredCharts";
import { ArrowDown, ArrowUp, Calendar, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { money } from "../lib/money-privacy";
import {
  CORRECTION_PROBLEMS, CORRECTION_SECTION_LABEL, REP_STATUS_LABEL, COMPANY_STATUS_LABEL, AUDIT_ACTION_LABEL,
  type MissingFeeDetail, type OrderDecisionView, type WeeklyReportDayRow, type WeeklyReportProductRow
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
export const pctText = (value: number, _digits = 0) => `${Math.round(Number.isFinite(value) ? value : 0)}%`;

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
      <DeferredCharts>{({ Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis }) => (
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
      )}</DeferredCharts>
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
        <DeferredCharts>{({ Cell, Pie, PieChart, ResponsiveContainer }) => (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={total > 0 ? data : [{ name: "None", value: 1 }]} dataKey="value" innerRadius={compact ? 46 : 52} outerRadius={compact ? 70 : 78} startAngle={90} endAngle={-270} stroke="none">
              {(total > 0 ? data : [{ name: "None", value: 1 }]).map((_, index) => (
                <Cell key={index} fill={total > 0 ? DONUT_COLORS[index % DONUT_COLORS.length] : "#e5e7eb"} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        )}</DeferredCharts>
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

export function Modal({ title, subtitle, onClose, children, wide, closeOnBackdrop = true }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  closeOnBackdrop?: boolean;
}) {
  const pointerStartedOnBackdrop = useRef(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onPointerDown={(event) => { pointerStartedOnBackdrop.current = event.target === event.currentTarget; }}
      onPointerCancel={() => { pointerStartedOnBackdrop.current = false; }}
      onClick={(event) => {
        const dismiss = closeOnBackdrop && pointerStartedOnBackdrop.current && event.target === event.currentTarget;
        pointerStartedOnBackdrop.current = false;
        if (dismiss) onClose();
      }}
    >
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

// ── Payout change (Bright, 11 Oct 2026) ─────────────────────────────────────

/** What a payout line needs to say it was changed: the system figure, the change, who and why. */
export type PayoutChangeView = { systemAmount: number; amount: number; reason: string; changedByName: string | null };

/**
 * Under a rep's Total: "System 21,150 · -2,000" with an Edited tag, so the
 * changed amount never appears without the figure it replaced.
 */
export function PayoutChangeNote({ change, sym }: { change: PayoutChangeView; sym: string }) {
  return (
    <span className="mt-0.5 block whitespace-nowrap text-[10.5px] font-semibold text-amber-700 dark:text-amber-300" title={`Changed by ${change.changedByName ?? "a manager"}: ${change.reason}`}>
      <span className="mr-1 rounded bg-amber-50 px-1 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">Edited</span>
      System {sym}{nf(change.systemAmount)} · {change.amount < 0 ? "-" : "+"}{sym}{nf(Math.abs(change.amount))}
    </span>
  );
}

/** "1 order · 1 to decide" / "charged ₦1,000" / "skipped" for a list of flagged orders. */
function decisionStatus(orders: Array<{ decision?: OrderDecisionView | null }>, sym: string, extraCharged = 0) {
  const open = orders.filter((order) => !order.decision).length;
  const charged = orders.reduce((sum, order) => sum + (order.decision?.decision === "charged" && !order.decision.earlier ? order.decision.amount : 0), 0) + extraCharged;
  if (open > 0) return { text: open === orders.length ? `${open} waiting` : `${open} of ${orders.length} waiting`, urgent: true };
  if (charged > 0) return { text: `Charged ${sym}${nf(charged)}`, urgent: false };
  return { text: orders.length ? "Skipped" : "Nothing to decide", urgent: false };
}

/**
 * The "No fee" / "Late send" chip under a rep's payout. A real button (Bright,
 * 28 Oct 2026: the small text tags were missed): red, with a blinking ring and
 * dot, while any order waits for a charge or skip. Hidden once all are
 * decided (the decisions stay in the window and the report). Clicking it
 * opens the window with the orders.
 */
function FlaggedChip({ kind, count, status, onOpen }: { kind: "Fee missing" | "Sent late"; count: number; status: { text: string; urgent: boolean }; onOpen?: () => void }) {
  const cls = status.urgent
    ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200"
    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";
  const body = (
    <>
      {status.urgent && (
        <span aria-hidden className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-600" />
        </span>
      )}
      <span className={`rounded px-1 text-[9.5px] font-black uppercase tracking-wide ${kind === "Fee missing" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" : "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200"}`}>{kind}</span>
      <span>{status.urgent ? status.text : `${count} · ${status.text}`}</span>
      {onOpen && <span aria-hidden className="ml-0.5 font-black">›</span>}
    </>
  );
  const base = `relative mt-1 inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-1.5 py-1 text-[11px] font-bold ${cls}`;
  // A soft blinking ring round the chip while something waits.
  const halo = status.urgent ? <span aria-hidden className="pointer-events-none absolute -inset-0.5 rounded-[10px] ring-2 ring-rose-400/70 motion-safe:animate-pulse" /> : null;
  return onOpen
    ? <button type="button" onClick={onOpen} className={`!min-h-0 ${base}`} title="Open these orders and decide: charge or don't charge">{halo}{body}</button>
    : <span className={base}>{halo}{body}</span>;
}

/** Under the payout figure: delivered orders with no delivery fee. Each must be charged or skipped (leadership only). */
export function MissingFeeNote({ detail, sym = "₦", onOpen }: { detail: MissingFeeDetail | undefined; sym?: string; onOpen?: () => void }) {
  if (!detail || detail.orders.length === 0) return null;
  const status = decisionStatus(detail.orders, sym);
  // Only while something waits (Bright, 28 Oct 2026): decided chips go away.
  if (!status.urgent) return null;
  return <span className="block"><FlaggedChip kind="Fee missing" count={detail.orders.length} status={status} onOpen={onOpen} /></span>;
}

/**
 * The manager adds to, or takes off, a rep's final payout. A reason is
 * required, and the payout cannot go below nothing. The system's own figure
 * stays on record beside the change for the owner to compare.
 */
/** The "Initial" and "Taken off" cells of a rep row (Bright, 14 Oct 2026). */
export function BonusInitialCells({ info, sym }: { info: { initial: number; takenOff: number; items: Array<{ label: string; amount: number }>; extraInInitial?: number; deliveryInInitial?: number }; sym: string }) {
  return (
    <>
      <td className="px-2 py-3 font-semibold text-gray-800 dark:text-slate-200">
        {nf(info.initial)}
        {/* Cross-sell + Upsell + Base = Initial, unless corrections or an amount
            the manager added come on top: then say so. */}
        {(info.deliveryInInitial ?? 0) > 0 && <span className="mt-0.5 block whitespace-nowrap text-[10.5px] font-semibold text-emerald-700">incl. +{sym}{nf(info.deliveryInInitial ?? 0)} delivery bonus</span>}
        {(info.extraInInitial ?? 0) > 0 && <span className="mt-0.5 block whitespace-nowrap text-[10.5px] font-semibold text-gray-500">incl. +{sym}{nf(info.extraInInitial ?? 0)} corrections / added</span>}
      </td>
      <td className="px-2 py-3 align-top">
        {info.takenOff > 0 ? (
          <>
            <span className="font-bold text-rose-600">-{nf(info.takenOff)}</span>
            {info.items.map((item) => (
              <span key={item.label} className="mt-0.5 block max-w-[12rem] text-[10.5px] font-semibold leading-snug text-rose-700/80 dark:text-rose-300/80">
                {item.label}: -{sym}{nf(item.amount)}
              </span>
            ))}
          </>
        ) : <span className="text-gray-400">0</span>}
      </td>
    </>
  );
}

export function PayoutChangeForm({ repName, sym, systemAmount, existing, onCancel, onSave, onRemove }: {
  repName: string;
  sym: string;
  /** The rep's final bonus as the system worked it out. */
  systemAmount: number;
  existing: { amount: number; reason: string } | null;
  onCancel: () => void;
  onSave: (amount: number, reason: string) => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const [direction, setDirection] = useState<"off" | "add">(existing && existing.amount > 0 ? "add" : "off");
  const [amountText, setAmountText] = useState(existing ? String(Math.abs(Math.round(existing.amount))) : "");
  const [reason, setReason] = useState(existing?.reason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // "5,000" and "₦5,000" are read as 5000; anything else is not a number.
  const cleaned = amountText.replace(/[₦,\s]/g, "");
  const typed = /^\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
  const signed = direction === "off" ? -typed : typed;
  const result = systemAmount + (Number.isFinite(signed) ? signed : 0);
  const problem = !amountText.trim() ? ""
    : !Number.isFinite(typed) || typed <= 0 ? "Enter a whole amount above 0."
      : result < 0 ? `You cannot take off more than the payout (${sym}${nf(systemAmount)}).` : "";
  const ready = Number.isFinite(typed) && typed > 0 && result >= 0 && reason.trim().length >= 3;
  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    setError("");
    try { await action(); } catch (err: any) { setError(err?.message ?? "Could not save."); } finally { setSaving(false); }
  };
  const field = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  const choice = (key: "off" | "add", label: string) => (
    <button type="button" onClick={() => setDirection(key)}
      className={`!min-h-0 flex-1 rounded-lg px-3 py-2 text-[12px] font-bold ${direction === key ? (key === "off" ? "bg-rose-600 text-white" : "bg-emerald-600 text-white") : "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-200"}`}>
      {label}
    </button>
  );
  return (
    <Modal title={`Change ${repName}'s payout`} subtitle="The system figure stays on record. The owner sees the change before approving." onClose={onCancel}>
      <div className="space-y-4 px-6 py-5">
        <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 dark:bg-slate-800/60">
          <span className="text-[12px] font-semibold text-gray-600 dark:text-slate-300">System figure</span>
          <strong className="text-[15px] text-gray-900 dark:text-slate-50">{sym}{nf(systemAmount)}</strong>
        </div>
        <div>
          <span className="mb-1.5 block text-[12px] font-bold text-gray-700 dark:text-slate-300">What do you want to do?</span>
          <div className="flex gap-2">{choice("off", "Take off")}{choice("add", "Add")}</div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Amount ({sym})</span>
          <input className={field} inputMode="numeric" value={amountText} onChange={(event) => setAmountText(event.target.value)} placeholder="e.g. 2,000" />
          {problem && <span className="mt-1 block text-[11px] font-semibold text-rose-600">{problem}</span>}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Reason</span>
          <textarea className={`${field} min-h-[84px]`} maxLength={600} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Order #4381 was counted as an upgrade but the customer bought 1 piece" />
        </label>
        <div className={`flex items-center justify-between rounded-xl px-4 py-3 ${Number.isFinite(typed) && typed > 0 && result >= 0 ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-gray-50 dark:bg-slate-800/60"}`}>
          <span className="text-[12px] font-semibold text-gray-700 dark:text-slate-300">Payout after the change</span>
          <strong className="text-[16px] text-emerald-700 dark:text-emerald-300">{sym}{nf(Math.max(0, result))}</strong>
        </div>
        {error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {existing && onRemove
            ? <button type="button" disabled={saving} onClick={() => run(onRemove)} className="!min-h-0 rounded-xl px-3 py-2.5 text-[12px] font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40">Remove the change</button>
            : <span />}
          <span className="flex gap-2">
            <button type="button" onClick={onCancel} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-700 dark:border-slate-700 dark:text-slate-200">Cancel</button>
            <button type="button" disabled={!ready || saving} onClick={() => run(() => onSave(signed, reason.trim()))}
              className="!min-h-0 rounded-xl bg-[#1F8FE0] px-4 py-2.5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Saving…" : "Save change"}</button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

// ── Return / flag form ──────────────────────────────────────────────────────

export type CorrectionDraft = { section: string; problem: string; comment: string; orderRef: string; repIds?: string[] };
/** A rep the owner can send back on its own: name and the bonus now on the report. */
export type CorrectionRepChoice = { id: string; name: string; amountLabel: string };

// Ready-made comments (Bright, 13 Oct 2026: "a quick comment suggestions so we
// dont need to type all the time"). One press fills the box; it can still be
// edited or added to. Chosen by section, so they fit what is being returned.
const COMMENT_SUGGESTIONS: Record<string, string[]> = {
  bonus: [
    "Put the actual bonus to be paid.",
    "Bonus looks too high. Check and put the correct amount.",
    "Bonus looks too low. Check and put the correct amount.",
    "Check the upsell bonus and correct it.",
    "Check the cross-sell bonus and correct it.",
    "Take off the bonus for the order that was not delivered."
  ],
  orders: [
    "Order count does not match. Check and correct.",
    "An order here belongs to another rep. Check and correct.",
    "A duplicate order was counted. Remove it."
  ],
  delivery: [
    "Delivered count does not match. Check and correct.",
    "An order marked delivered was not delivered. Correct it.",
    "Delivery rate looks wrong. Check the figures."
  ],
  upsell_cross_sell: [
    "Upsell was counted but the customer bought the normal package. Correct it.",
    "Cross-sell was counted but the customer did not take it. Correct it.",
    "Check the upsell and cross-sell orders and confirm each one."
  ],
  product_breakdown: [
    "Product figures do not add up. Check and correct.",
    "Wrong product on an order. Correct it."
  ],
  funds: [
    "Add the receipt or proof for this entry.",
    "This amount looks wrong. Check and correct it.",
    "This entry is in the wrong week. Move it."
  ],
  other: ["Please check this and correct it.", "Explain this figure before I approve."]
};
const DEFAULT_COMMENT_SUGGESTIONS = ["Put the actual bonus to be paid.", "Please check this and correct it.", "Explain this figure before I approve."];

/**
 * No vague returns: a section, a problem and a comment are all required
 * (Bright, 1 Oct 2026). Used for the manager's Return / Flag and the owner's
 * Return to Manager.
 */
export function CorrectionForm({ title, subtitle, submitLabel, tone, initialComment, reps, onCancel, onSubmit }: {
  title: string;
  subtitle: string;
  submitLabel: string;
  tone: "rose" | "amber";
  initialComment?: string;
  /** Owner's return only: tick the reps whose bonus needs correcting. */
  reps?: CorrectionRepChoice[];
  onCancel: () => void;
  onSubmit: (draft: CorrectionDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<CorrectionDraft>({ section: "", problem: "", comment: initialComment ?? "", orderRef: "" });
  const [customProblem, setCustomProblem] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pickedReps, setPickedReps] = useState<string[]>([]);
  const toggleRep = (id: string) => {
    const next = pickedReps.includes(id) ? pickedReps.filter((item) => item !== id) : [...pickedReps, id];
    setPickedReps(next);
    // Picking a rep is about their bonus: save the owner a step.
    if (next.length > 0 && !draft.section) setDraft({ ...draft, section: "bonus", problem: "" });
  };
  const problems = draft.section ? CORRECTION_PROBLEMS[draft.section] ?? [] : [];
  const problem = draft.problem === "__other" || (draft.section === "other") ? customProblem.trim() : draft.problem;
  const ready = !!draft.section && problem.length >= 3 && draft.comment.trim().length >= 3;
  const field = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  return (
    <Modal title={title} subtitle={subtitle} onClose={onCancel}>
      <div className="space-y-4 px-6 py-5">
        {reps && reps.length > 0 && (
          <div>
            <span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Which sales reps need their bonus corrected?</span>
            <span className="mb-2 block text-[11.5px] text-gray-500 dark:text-slate-400">Tick only the ones to send back. The others stay approved. Tick none to return the whole week.</span>
            <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
              {reps.map((rep) => {
                const on = pickedReps.includes(rep.id);
                return (
                  <button key={rep.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggleRep(rep.id)}
                    className={`!min-h-0 flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left ${on ? "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10" : "border-gray-200 bg-white hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900"}`}>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${on ? "border-rose-600 bg-rose-600 text-white" : "border-gray-300 bg-white dark:border-slate-600 dark:bg-slate-900"}`}>{on && <Check className="h-3.5 w-3.5" />}</span>
                    <Avatar name={rep.name} size={26} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-800 dark:text-slate-100">{rep.name}</span>
                    <span className="shrink-0 text-[13px] font-bold text-gray-900 dark:text-slate-50">{rep.amountLabel}</span>
                  </button>
                );
              })}
            </div>
            {pickedReps.length > 0 && (
              <p className="m-0 mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[11.5px] font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
                {pickedReps.length} sales rep{pickedReps.length === 1 ? "" : "s"} will go back to the manager to put the actual bonus to be paid.
              </p>
            )}
          </div>
        )}
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
          <span className="mb-1.5 block text-[11.5px] text-gray-500 dark:text-slate-400">Press one to add it, or type your own.</span>
          <span className="mb-2 flex flex-wrap gap-1.5">
            {(COMMENT_SUGGESTIONS[draft.section] ?? DEFAULT_COMMENT_SUGGESTIONS).map((text) => {
              const used = draft.comment.includes(text);
              return (
                <button key={text} type="button" aria-pressed={used}
                  onClick={(event) => {
                    event.preventDefault();
                    // Press to add it after what is there; press again to take it out.
                    const next = used ? draft.comment.replace(text, "").replace(/\s{2,}/g, " ").trim() : `${draft.comment.trim()} ${text}`.trim();
                    setDraft({ ...draft, comment: next.slice(0, 2000) });
                  }}
                  className={`!min-h-0 rounded-full border px-2.5 py-1 text-left text-[11.5px] font-semibold ${used ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200" : "border-gray-200 bg-gray-50 text-gray-700 hover:border-[#1F8FE0] hover:bg-blue-50 hover:text-[#1F8FE0] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>
                  {used ? "✓ " : "+ "}{text}
                </button>
              );
            })}
          </span>
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
                await onSubmit({ ...draft, problem, comment: draft.comment.trim(), orderRef: draft.orderRef.trim(), ...(pickedReps.length > 0 ? { repIds: pickedReps } : {}) });
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
  if (entry.action === "payout_changed" && detail.systemAmount !== undefined) {
    parts.push(`system ${money(Number(detail.systemAmount))} → ${money(Number(detail.newAmount ?? 0))} (${Number(detail.amount) < 0 ? "-" : "+"}${money(Math.abs(Number(detail.amount ?? 0)))})`);
    if (detail.previousAmount !== null && detail.previousAmount !== undefined) parts.push(`the change before was ${Number(detail.previousAmount) < 0 ? "-" : "+"}${money(Math.abs(Number(detail.previousAmount)))}`);
    if (detail.reason) parts.push(`reason: ${detail.reason}`);
  }
  if (entry.action === "payout_change_removed" && detail.systemAmount !== undefined) {
    parts.push(`${Number(detail.amount) < 0 ? "-" : "+"}${money(Math.abs(Number(detail.amount ?? 0)))} removed, back to the system figure ${money(Number(detail.systemAmount))}`);
    if (detail.why) parts.push(String(detail.why));
  }
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

// ── Orders not sent out in 15 working minutes (Bright, 23 Oct 2026) ─────────
// The system only lists them. Admin / Manager / Owner charge or skip each one
// in OrderDecisionsModal (28 Oct 2026); a charge is an ordinary fine the rep sees.

export type LateSendWeek = {
  orders: Array<{
    orderId: string; customer: string; arrivedAt: string; clockStart: string; deadline: string; sentAt: string | null; sentStatus: string | null; minutesLate: number;
    product?: string; quantity?: number; amount?: number; state?: string;
    placedAt?: string; assignedAt?: string | null; sentByName?: string | null; sentByRep?: boolean;
    workingMinutesTaken?: number; workingMinutesLate?: number;
    decision?: OrderDecisionView | null;
  }>;
  fines: Array<{ id: string; amount: number; reason: string; byName: string; createdAt: string }>;
};

/** Under the payout figure: how many orders were sent out late. Opens the decisions window. */
export function LateSendNote({ detail, sym, onOpen }: { detail: LateSendWeek | null | undefined; sym: string; onOpen?: () => void }) {
  if (!detail || (detail.orders.length === 0 && detail.fines.length === 0)) return null;
  // Lump fines from before order-by-order decisions still count as charged.
  const lump = detail.fines.reduce((sum, fine) => sum + fine.amount, 0);
  const status = decisionStatus(detail.orders, sym, lump);
  // Only while something waits (Bright, 28 Oct 2026): decided chips go away.
  if (!status.urgent) return null;
  return <span className="block"><FlaggedChip kind="Sent late" count={detail.orders.length} status={status} onOpen={onOpen} /></span>;
}
