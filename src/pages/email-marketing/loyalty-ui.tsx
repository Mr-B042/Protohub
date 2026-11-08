import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Crown, Gem, MoreHorizontal, Plus, Star, Trash2, type LucideIcon } from "lucide-react";
import type { EmLoyaltyLevel } from "../../lib/api";
import { Card, IconTile, btn, count, input, naira, pct } from "./em-ui";

/**
 * Pieces shared by the Loyalty & Rewards tabs (Bright's design 55, 8 Nov
 * 2026): level badges, the monthly chart, the levels editor, tiles, menus.
 */

// Bronze, Silver, Gold as in the design; a 4th and 5th level get blue and violet.
export const LEVEL_LOOK: Array<{ badge: string; card: string; text: string; color: string; icon: LucideIcon }> = [
  { badge: "from-[#EDB27A] to-[#B4622A]", card: "border-orange-100 bg-orange-50/70 dark:border-orange-500/20 dark:bg-orange-500/5", text: "text-orange-700 dark:text-orange-300", color: "#C2773A", icon: Star },
  { badge: "from-[#E5E9F0] to-[#8C9AAE]", card: "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40", text: "text-slate-600 dark:text-slate-300", color: "#8C9AAE", icon: Star },
  { badge: "from-[#FDE68A] to-[#F59E0B]", card: "border-amber-100 bg-amber-50/80 dark:border-amber-500/20 dark:bg-amber-500/5", text: "text-amber-600 dark:text-amber-300", color: "#F5B000", icon: Crown },
  { badge: "from-[#BFDBFE] to-[#3B82F6]", card: "border-sky-100 bg-sky-50/70 dark:border-sky-500/20 dark:bg-sky-500/5", text: "text-sky-700 dark:text-sky-300", color: "#3B82F6", icon: Gem },
  { badge: "from-[#DDD6FE] to-[#7C3AED]", card: "border-violet-100 bg-violet-50/70 dark:border-violet-500/20 dark:bg-violet-500/5", text: "text-violet-700 dark:text-violet-300", color: "#7C3AED", icon: Gem }
];
export const levelLook = (index: number) => LEVEL_LOOK[Math.max(0, Math.min(LEVEL_LOOK.length - 1, index))];

export function LevelBadge({ index, size = 44 }: { index: number; size?: number }) {
  const look = levelLook(index);
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${look.badge} text-white shadow-sm ring-2 ring-white/70 dark:ring-slate-900/60`} style={{ width: size, height: size }}>
      <look.icon className="fill-white/90" style={{ width: size * 0.48, height: size * 0.48 }} />
    </span>
  );
}

export function LevelPill({ index, name }: { index: number; name: string }) {
  const look = levelLook(index);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-[12px] font-bold ${look.card} ${look.text}`}>
      <span className={`h-2 w-2 rounded-full bg-gradient-to-br ${look.badge}`} />{name}
    </span>
  );
}

/** Label-first tile, as on Coupons & Offers. */
export function Tile({ icon: Icon, label, value, chip, note }: { icon: LucideIcon; label: string; value: React.ReactNode; chip?: React.ReactNode; note?: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <IconTile size="lg"><Icon className="h-6 w-6" /></IconTile>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-snug text-gray-600 dark:text-slate-400">{label}</div>
        <div className="flex flex-wrap items-center gap-x-2"><span className="text-[22px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{value}</span>{chip}</div>
        {note && <div className="text-[11.5px] leading-snug text-gray-500">{note}</div>}
      </div>
    </Card>
  );
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
export const monthLabel = (month: string) => MONTH.format(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 15)));
const compactNaira = (value: number) => (value >= 1e6 ? `₦${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M` : value >= 1e3 ? `₦${Math.round(value / 1e3)}k` : `₦${Math.round(value)}`);

export type MonthSeries = { key: string; label: string; color: string; kind: "area" | "bar" | "line"; unit: "naira" | "count" | "percent" };

/** One value per month (last six). One axis: every series shares a unit. */
export function MonthChart({ data, series, height = 220, empty = "Shows once there is data." }: { data: Array<Record<string, any>>; series: MonthSeries[]; height?: number; empty?: string }) {
  const hasData = data.some((row) => series.some((s) => Number(row[s.key]) > 0));
  if (!hasData) return <div className="flex items-center justify-center rounded-xl bg-gray-50 px-4 text-center text-[12.5px] text-gray-500 dark:bg-slate-800/40 dark:text-slate-400" style={{ height }}>{empty}</div>;
  const unit = series[0].unit;
  const fmt = (value: number | null | undefined) => (value === null || value === undefined ? "—" : unit === "naira" ? naira(value) : unit === "percent" ? pct(value) : count(value));
  const tick = (value: number) => (unit === "naira" ? compactNaira(value) : unit === "percent" ? `${value}%` : count(value));
  const rows = data.map((row) => ({ ...row, label: monthLabel(row.month) }));
  return (
    <div style={{ height }} className="text-gray-700 dark:text-slate-300">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
          <defs>
            {series.filter((s) => s.kind === "area").map((s) => (
              <linearGradient key={s.key} id={`ly-${s.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity={0.3} /><stop offset="100%" stopColor={s.color} stopOpacity={0.03} /></linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="#E5E7EB" strokeOpacity={0.7} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={tick} tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={52} allowDecimals={false} />
          <Tooltip cursor={{ stroke: "#9CA3AF", strokeDasharray: "3 3" }} formatter={(value: number, name: string) => [fmt(value), series.find((s) => s.key === name)?.label ?? name]}
            labelFormatter={(label: string, payload: any[]) => (payload?.[0]?.payload?.month ? `${label} ${String(payload[0].payload.month).slice(0, 4)}` : label)} />
          {series.map((s) => {
            if (s.kind === "bar") return <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />;
            if (s.kind === "area") return <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={`url(#ly-${s.key})`} dot={{ r: 4, strokeWidth: 2, fill: "#fff", stroke: s.color }} activeDot={{ r: 5 }} isAnimationActive={false} />;
            return <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "#fff", stroke: s.color }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />;
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A "…" menu that opens above everything (portalled, so a table never clips it). */
export function RowMenu({ label, disabled, items }: { label: string; disabled?: boolean; items: Array<{ key: string; label: string; icon: LucideIcon; run: () => void; danger?: boolean }> }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, [at]);
  return (
    <>
      <button ref={button} type="button" disabled={disabled} aria-label={label} onClick={(event) => {
        event.stopPropagation();
        const rect = button.current!.getBoundingClientRect();
        setAt(at ? null : { top: rect.bottom + 4, left: Math.min(window.innerWidth - 200, rect.right - 190) });
      }} className={btn.icon}><MoreHorizontal className="h-4 w-4" /></button>
      {at && createPortal(
        <div style={{ top: at.top, left: at.left }} className="fixed z-[80] w-[190px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
          {items.map((item) => (
            <button key={item.key} type="button" onClick={() => { setAt(null); item.run(); }} className={`!min-h-0 flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-gray-50 dark:hover:bg-slate-800 ${item.danger ? "text-rose-600" : "text-gray-700 dark:text-slate-200"}`}>
              <item.icon className="h-4 w-4" />{item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

const DEFAULT_NEW_LEVEL = (levels: EmLoyaltyLevel[]): EmLoyaltyLevel => {
  const top = levels[levels.length - 1];
  return { key: "", name: "", minSpend: Math.max(0, (top?.minSpend ?? 0) * 2 || 100_000), multiplier: Math.min(10, (top?.multiplier ?? 1) + 1), welcomeVoucher: 0, monthlyVoucher: 0, perks: [] };
};

/** Edit the VIP levels: name, where each starts, the points multiplier and the vouchers. */
export function LevelsEditor({ levels, baseRate, onChange }: { levels: EmLoyaltyLevel[]; baseRate: number; onChange: (next: EmLoyaltyLevel[]) => void }) {
  const set = (index: number, patch: Partial<EmLoyaltyLevel>) => onChange(levels.map((level, i) => (i === index ? { ...level, ...patch } : level)));
  const label = "block text-[12px] font-semibold text-gray-700 dark:text-slate-300";
  const numberBox = (value: number, onValue: (n: number) => void, extra = "") => (
    <input type="number" min={0} value={value || ""} placeholder="0" onChange={(event) => onValue(Math.max(0, Number(event.target.value) || 0))} className={`${input} mt-1 !py-2 ${extra}`} />
  );
  return (
    <div className="space-y-3">
      {levels.map((level, index) => (
        <div key={index} className={`rounded-xl border p-3 ${levelLook(index).card}`}>
          <div className="mb-2 flex items-center gap-2">
            <LevelBadge index={index} size={30} />
            <input value={level.name} maxLength={30} onChange={(event) => set(index, { name: event.target.value })} placeholder="Level name" aria-label="Level name" className={`${input} !py-2 font-bold`} />
            {levels.length > 2 && (
              <button type="button" aria-label={`Remove ${level.name || "this level"}`} onClick={() => onChange(levels.filter((_, i) => i !== index))} className={btn.icon}><Trash2 className="h-4 w-4" /></button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className={label}>Starts at spend (₦)
              {index === 0 ? <input value="0" disabled className={`${input} mt-1 !py-2 opacity-70`} /> : numberBox(level.minSpend, (n) => set(index, { minSpend: n }))}
            </label>
            <label className={label}>Points × (multiplier)
              <input type="number" min={0.5} max={10} step={0.5} value={level.multiplier} onChange={(event) => set(index, { multiplier: Number(event.target.value) || 1 })} className={`${input} mt-1 !py-2`} />
              <span className="block text-[11px] font-normal text-gray-500">{`${Math.round(baseRate * level.multiplier * 10) / 10} per ₦1,000`}</span>
            </label>
            <label className={label}>Welcome voucher (₦){numberBox(level.welcomeVoucher, (n) => set(index, { welcomeVoucher: n }))}<span className="block text-[11px] font-normal text-gray-500">Once, on reaching it</span></label>
            <label className={label}>Monthly voucher (₦){numberBox(level.monthlyVoucher, (n) => set(index, { monthlyVoucher: n }))}<span className="block text-[11px] font-normal text-gray-500">One order a month</span></label>
          </div>
          <label className={`${label} mt-2`}>Other perks you offer (one per line, optional)
            <textarea rows={2} value={level.perks.join("\n")} maxLength={400} onChange={(event) => set(index, { perks: event.target.value.split("\n").slice(0, 6) })} placeholder="e.g. Priority delivery" className={`${input} mt-1 !py-2`} />
          </label>
        </div>
      ))}
      {levels.length < 5 && (
        <button type="button" onClick={() => onChange([...levels, DEFAULT_NEW_LEVEL(levels)])} className={btn.outline}><Plus className="h-3.5 w-3.5" />Add a level</button>
      )}
    </div>
  );
}
