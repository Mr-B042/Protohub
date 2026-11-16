import { type ComponentType, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, X } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip } from "recharts";

/** Building blocks of the Expense & Cost Intelligence page (Bright's designs, 16 Nov 2026). */

export type Icon = ComponentType<{ className?: string }>;

export const C = {
  blue: "#2F6BFF", purple: "#8B5CF6", orange: "#F59E0B", green: "#10B981", pink: "#EC4899", grey: "#CBD5E1", red: "#EF4444", teal: "#14B8A6", sky: "#38BDF8", indigo: "#6366F1"
};
export const SERIES = [C.blue, C.purple, C.orange, C.green, C.pink, C.teal, C.grey];

export const card = "rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
export const btn = {
  primary: "!min-h-0 inline-flex h-10 items-center gap-2 rounded-xl bg-[#2F6BFF] px-4 text-[13.5px] font-bold text-white shadow-sm hover:bg-[#2258E0] disabled:opacity-50",
  outline: "!min-h-0 inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800",
  link: "!min-h-0 inline-flex items-center gap-1 text-[12.5px] font-bold text-[#2F6BFF] hover:underline",
  icon: "!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"
};
export const select = "h-10 rounded-xl border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
export const input = "h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-[13.5px] text-gray-900 outline-none focus:border-[#2F6BFF] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50";
/** styles.css colours every <td>: set text colour on the cell, never the row. */
export const td = "px-3 py-2.5 align-middle text-[13px] text-gray-800 dark:text-slate-200";
export const th = "px-3 py-2 text-left text-[12px] font-bold text-gray-600 dark:text-slate-400";

export function Card({ title, action, children, className = "", sub }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; sub?: ReactNode }) {
  return (
    <section className={`${card} min-w-0 p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h3 className="m-0 text-[15.5px] font-extrabold text-gray-900 dark:text-slate-50">{title}</h3>}
            {sub && <p className="m-0 mt-0.5 text-[12px] text-gray-500 dark:text-slate-400">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function LinkAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={btn.link}>{children}<ChevronRight className="h-3.5 w-3.5" /></button>;
}

/** Tiny line drawn from real points (nothing drawn with fewer than 2). */
export function Sparkline({ values, color = C.blue }: { values: Array<number | null>; color?: string }) {
  const pts = values.map((v, i) => [i, v] as const).filter(([, v]) => v !== null && Number.isFinite(v)) as Array<readonly [number, number]>;
  if (pts.length < 2) return null;
  const ys = pts.map(([, v]) => v);
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const w = 64, h = 28, n = Math.max(1, values.length - 1);
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${((i / n) * w).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`).join(" ");
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden><path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export type Delta = { text: string; good: boolean | null; up: boolean } | null;
/** "↓ -5.4% vs Sep (₦12,869,450)": lowerIsBetter for costs. */
export function delta(now: number | null, before: number | null, opts: { lowerIsBetter?: boolean; points?: boolean; label: string; beforeText?: string }): Delta {
  if (now === null || before === null) return null;
  if (opts.points) {
    const diff = now - before;
    return { text: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}pp vs ${opts.label}${opts.beforeText ? ` (${opts.beforeText})` : ""}`, up: diff >= 0, good: diff === 0 ? null : (diff > 0) !== Boolean(opts.lowerIsBetter) };
  }
  if (!before) return null;
  const pct = ((now - before) / Math.abs(before)) * 100;
  return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs ${opts.label}${opts.beforeText ? ` (${opts.beforeText})` : ""}`, up: pct >= 0, good: Math.abs(pct) < 0.05 ? null : (pct > 0) !== Boolean(opts.lowerIsBetter) };
}

export function Kpi({ icon: I, tone, label, value, d, spark, sub, onClick }: { icon: Icon; tone: string; label: string; value: string; d?: Delta; spark?: Array<number | null>; sub?: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={`${card} !min-h-0 flex min-w-0 flex-col gap-1 p-4 text-left ${onClick ? "hover:border-[#2F6BFF]/40" : ""}`}>
      <span className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: `${tone}1A`, color: tone }}><I className="h-[18px] w-[18px]" /></span>
        {spark && <Sparkline values={spark} color={tone} />}
      </span>
      <span className="mt-1 text-[12.5px] font-semibold text-gray-600 dark:text-slate-400">{label}</span>
      <b className="truncate text-[22px] font-black leading-tight text-gray-900 dark:text-slate-50">{value}</b>
      {d && (
        <span className={`flex items-center gap-1 text-[11.5px] font-semibold ${d.good === null ? "text-gray-500" : d.good ? "text-emerald-600" : "text-rose-600"}`}>
          {d.up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}<span className="truncate">{d.text}</span>
        </span>
      )}
      {sub && <span className="text-[11.5px] text-gray-500 dark:text-slate-400">{sub}</span>}
    </Tag>
  );
}

export function Donut({ data, center, sub, size = 190 }: { data: Array<{ name: string; value: number; color: string }>; center: string; sub: string; size?: number }) {
  const shown = data.filter((d) => d.value > 0);
  return (
    <div className="relative shrink-0 self-center" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={shown.length ? shown : [{ name: "None", value: 1, color: "#E5E7EB" }]} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="100%" paddingAngle={shown.length > 1 ? 1.5 : 0} stroke="none" isAnimationActive={false}>
            {(shown.length ? shown : [{ color: "#E5E7EB" }]).map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          {shown.length > 0 && <ChartTooltip formatter={(v: number) => v.toLocaleString("en-NG", { maximumFractionDigits: 0 })} />}
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <b className="text-[17px] font-black text-gray-900 dark:text-slate-50">{center}</b>
        <span className="text-[11.5px] text-gray-500 dark:text-slate-400">{sub}</span>
      </div>
    </div>
  );
}

const PILL: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  red: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  purple: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  grey: "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300",
  orange: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
};
export function Pill({ tone, children, icon: I }: { tone: keyof typeof PILL; children: ReactNode; icon?: Icon }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-bold ${PILL[tone]}`}>{I && <I className="h-3.5 w-3.5" />}{children}</span>;
}

export function Bar({ value, max, color = C.blue }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <span className="block h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-[13px] text-gray-500 dark:border-slate-700 dark:text-slate-400">{children}</p>;
}

export function Modal({ title, sub, onClose, children, wide, footer }: { title: string; sub?: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className={`${card} mt-10 w-full ${wide ? "max-w-3xl" : "max-w-lg"}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4 dark:border-slate-800">
          <div><h3 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-50">{title}</h3>{sub && <p className="m-0 mt-0.5 text-[12.5px] text-gray-500">{sub}</p>}</div>
          <button type="button" aria-label="Close" onClick={onClose} className={btn.icon}><X className="h-5 w-5" /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-slate-800">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/30" onClick={onClose}>
      <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-slate-800">
          <h3 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-50">{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose} className={btn.icon}><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap gap-2 border-t border-gray-100 px-5 py-4 dark:border-slate-800">{footer}</div>}
      </aside>
    </div>
  );
}

/** Field label wrapper for forms. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-[12.5px] font-bold text-gray-700 dark:text-slate-200">{label}
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-0.5 block text-[11px] font-normal text-gray-500">{hint}</span>}
    </label>
  );
}

/** CSV download built in the browser. */
export function downloadCsv(name: string, rows: Array<Array<string | number | null | undefined>>) {
  const text = rows.map((r) => r.map((c) => { const s = c === null || c === undefined ? "" : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
