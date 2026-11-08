import type { ReactNode } from "react";
import { Bar, CartesianGrid, ComposedChart, Area, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, Lightbulb, type LucideIcon } from "lucide-react";
import type { EmHealthGrade } from "../../lib/api";
import { Card, Donut, IconTile, Pill, count, pct } from "./em-ui";

/**
 * Pieces shared by the seven Audience Health tabs (Bright's designs, 8 Nov
 * 2026). Two-line charts use purple + teal: checked for colour-blind
 * readers and contrast on both the light and the dark background.
 */

export const SERIES = { a: "#7C5CFF", b: "#0D9488" };
export const STATUS = { good: "#16A34A", warn: "#D97706", bad: "#E11D48", info: "#0284C7" };

const GRADE_TONE: Record<string, string> = { Excellent: "green", Good: "green", Fair: "amber", Poor: "red" };
export function GradePill({ grade, empty = "No data yet" }: { grade: EmHealthGrade; empty?: string }) {
  return grade ? <Pill tone={GRADE_TONE[grade]}>{grade}</Pill> : <Pill tone="slate">{empty}</Pill>;
}

export function InfoTip({ text }: { text: string }) {
  return <span title={text} aria-label={text} className="inline-flex cursor-help text-gray-400"><Info className="h-3.5 w-3.5" /></span>;
}

export function CardHead({ title, tip, right, sub }: { title: ReactNode; tip?: string; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <h3 className="m-0 flex items-center gap-1.5 text-[15.5px] font-bold text-gray-900 dark:text-slate-50">{title}{tip && <InfoTip text={tip} />}</h3>
        {sub && <div className="mt-0.5 text-[12px] text-gray-500 dark:text-slate-400">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/** A ring with the percent in the middle (the "score" cards). */
export function Ring({ value, label, color = SERIES.a, size = 148 }: { value: number | null; label: string; color?: string; size?: number }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <Donut slices={value === null ? [] : [{ value: v, color }, { value: 100 - v, color: "transparent" }]} size={size} stroke={14}>
      <span className="text-[25px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{value === null ? "—" : pct(value)}</span>
      <span className="text-[12.5px] text-gray-600 dark:text-slate-400">{label}</span>
    </Donut>
  );
}

/** Score card: ring, grade, a sentence and (optionally) the ticks under it. */
export function ScoreCard({ title, tip, value, ringLabel, grade, text, checks, color }: {
  title: string; tip?: string; value: number | null; ringLabel: string; grade: EmHealthGrade; text: string;
  checks?: Array<{ label: string; good: boolean }>; color?: string;
}) {
  return (
    <Card className="p-4">
      <CardHead title={title} tip={tip} />
      <div className="flex flex-wrap items-center gap-4">
        <Ring value={value} label={ringLabel} color={color ?? (grade === "Fair" ? STATUS.warn : grade === "Poor" ? STATUS.bad : SERIES.a)} />
        <div className="min-w-[180px] flex-1 space-y-2">
          <GradePill grade={grade} />
          <p className="m-0 text-[13px] leading-snug text-gray-700 dark:text-slate-300">{text}</p>
          {checks && (
            <ul className="m-0 list-none space-y-1.5 p-0">
              {checks.map((check) => (
                <li key={check.label} className="flex items-center gap-1.5 text-[12.5px] text-gray-700 dark:text-slate-300">
                  {check.good ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />}{check.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

const DAY_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const dayLabel = (day: string) => DAY_LABEL.format(new Date(`${day}T12:00:00Z`));

export type ChartSeries = { key: string; label: string; color: string; kind?: "line" | "area" | "bar"; axis?: "left" | "right"; unit?: "percent" | "count" };

/**
 * Day-by-day chart with a crosshair tooltip and the last value written at the
 * end of each line. A series on the "right" axis has its own scale (Bright's
 * growth and churn designs put people and a percent in one chart).
 */
export function TrendChart({ data, series, height = 220, domain, empty = "Shows once there is data for these days." }: {
  data: Array<Record<string, any>>; series: ChartSeries[]; height?: number; domain?: [number, number]; empty?: string;
}) {
  const hasData = data.some((row) => series.some((s) => row[s.key] !== null && row[s.key] !== undefined && (s.kind !== "bar" || row[s.key] > 0)));
  if (!hasData) return <div className="flex items-center justify-center rounded-xl bg-gray-50 text-center text-[12.5px] text-gray-500 dark:bg-slate-800/40 dark:text-slate-400" style={{ height }}>{empty}</div>;
  const rows: Array<Record<string, any>> = data.map((row) => ({ ...row, label: dayLabel(row.day) }));
  const fmt = (s: ChartSeries, value: number | null | undefined) => (value === null || value === undefined ? "—" : s.unit === "count" ? count(value) : pct(value));
  const right = series.some((s) => s.axis === "right");
  const leftUnit = series.find((s) => s.axis !== "right")?.unit ?? "percent";
  const rightUnit = series.find((s) => s.axis === "right")?.unit ?? "percent";
  const tick = (unit: string) => (value: number) => (unit === "count" ? count(value) : `${value}%`);
  // Few real points (one send a week, one reading a day so far): mark each, so a joining line is not read as daily data.
  const dotsFor = (key: string) => (rows.filter((row) => row[key] !== null && row[key] !== undefined).length < 12 ? { r: 3, strokeWidth: 0, fill: series.find((s) => s.key === key)!.color } : false);
  const lastIndex = (key: string) => { for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i][key] !== null && rows[i][key] !== undefined) return i; return -1; };
  const endLabel = (s: ChartSeries) => {
    const at = lastIndex(s.key);
    return (props: any) => (props.index === at && props.value !== null && props.value !== undefined
      ? <text x={props.x} y={props.y - 9} textAnchor="end" fontSize={11.5} fontWeight={700} fill="currentColor" className="text-gray-700 dark:text-slate-200">{fmt(s, props.value)}</text>
      : <g />);
  };
  return (
    <div style={{ height }} className="text-gray-700 dark:text-slate-300">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 22, right: right ? 4 : 12, bottom: 0, left: 0 }}>
          <defs>
            {series.filter((s) => s.kind === "area").map((s) => (
              <linearGradient key={s.key} id={`hl-${s.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity={0.28} /><stop offset="100%" stopColor={s.color} stopOpacity={0.02} /></linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="#E5E7EB" strokeOpacity={0.7} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} minTickGap={18} />
          <YAxis yAxisId="left" domain={domain ?? ["auto", "auto"]} tickFormatter={tick(leftUnit)} tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
          {right && <YAxis yAxisId="right" orientation="right" tickFormatter={tick(rightUnit)} tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />}
          <Tooltip cursor={{ stroke: "#9CA3AF", strokeDasharray: "3 3" }}
            formatter={(value: number, name: string) => { const s = series.find((item) => item.key === name)!; return [fmt(s, value), s.label]; }}
            labelFormatter={(label: string, payload: any[]) => (payload?.[0]?.payload?.day ? `${label}, ${String(payload[0].payload.day).slice(0, 4)}` : label)} />
          {series.map((s) => {
            const axis = s.axis === "right" ? "right" : "left";
            if (s.kind === "bar") return <Bar key={s.key} yAxisId={axis} dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />;
            if (s.kind === "area") return <Area key={s.key} yAxisId={axis} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={`url(#hl-${s.key})`} connectNulls dot={dotsFor(s.key)} activeDot={{ r: 4 }} label={endLabel(s)} isAnimationActive={false} />;
            return <Line key={s.key} yAxisId={axis} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} connectNulls dot={dotsFor(s.key)} activeDot={{ r: 4 }} label={endLabel(s)} isAnimationActive={false} />;
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string; bar?: boolean }> }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px] text-gray-600 dark:text-slate-400">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className={item.bar ? "h-2.5 w-2.5 rounded-sm" : "h-0.5 w-4 rounded-full"} style={{ background: item.color }} />{item.label}
        </span>
      ))}
    </div>
  );
}

/** A labelled bar row ("Quality Breakdown", "Issue Categories"). */
export function BarRow({ icon: Icon, label, value, percent, color, note }: { icon?: LucideIcon; label: string; value: string; percent: number | null; color: string; note?: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[13px]">
        {Icon && <Icon className="h-4 w-4 shrink-0" style={{ color }} />}
        <span className="min-w-0 flex-1 truncate font-semibold text-gray-800 dark:text-slate-200">{label}</span>
        <span className="font-bold text-gray-900 dark:text-slate-50">{value}</span>
        <span className="w-14 text-right text-gray-600 dark:text-slate-400">{note ?? pct(percent)}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%`, background: color }} />
      </div>
    </div>
  );
}

/** "Key Insights": each line is a fact worked out from the numbers on the tab. */
export function Insights({ title = "Key Insights", items, recommendation }: { title?: string; items: Array<{ ok: boolean; text: string }>; recommendation?: string }) {
  return (
    <Card className="p-4">
      <CardHead title={<span className="inline-flex items-center gap-2"><Lightbulb className="h-4 w-4 text-[#5B3FD9]" />{title}</span>} />
      {items.length === 0 && <p className="m-0 text-[13px] text-gray-500 dark:text-slate-400">Insights show once there is enough to go on: people on the list and emails sent.</p>}
      <ul className="m-0 list-none space-y-2 p-0">
        {items.map((item) => (
          <li key={item.text} className="flex items-start gap-2 text-[13px] leading-snug text-gray-700 dark:text-slate-300">
            {item.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}{item.text}
          </li>
        ))}
      </ul>
      {recommendation && (
        <div className="mt-3 rounded-xl bg-[#F5F2FE] px-3.5 py-3 text-[12.5px] leading-snug text-gray-700 dark:bg-violet-500/10 dark:text-slate-200">
          <span className="font-bold text-[#5B3FD9] dark:text-violet-300">Recommendation</span><br />{recommendation}
        </div>
      )}
    </Card>
  );
}

export type ActionItem = { icon: LucideIcon; tone?: "purple" | "green" | "amber" | "red" | "blue"; title: string; text: string; button: string; onClick: () => void };

/** `wide`: the cards span the page (four across from laptop width); otherwise two across until a very wide screen. */
export function ActionCards({ title = "Recommended Actions", sub, items, wide = false }: { title?: string; sub?: string; items: ActionItem[]; wide?: boolean }) {
  return (
    <Card className="p-4">
      <CardHead title={<span className="inline-flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-500" />{title}</span>} sub={sub} />
      <div className={`grid gap-3 sm:grid-cols-2 ${wide ? "xl:grid-cols-4" : "2xl:grid-cols-4"}`}>
        {items.map((item) => (
          <div key={item.title} className="flex flex-col rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/30">
            <div className="flex items-center gap-2.5">
              <IconTile tone={item.tone ?? "purple"} size="sm"><item.icon className="h-4 w-4" /></IconTile>
              <span className="text-[13.5px] font-bold text-gray-900 dark:text-slate-50">{item.title}</span>
            </div>
            <p className="m-0 mt-2 flex-1 text-[12.5px] leading-snug text-gray-600 dark:text-slate-400">{item.text}</p>
            <button type="button" onClick={item.onClick}
              className="!min-h-0 mt-3 inline-flex items-center gap-1 self-start text-[12.5px] font-semibold text-[#5B3FD9] hover:underline dark:text-violet-300">
              {item.button}<ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Label-first KPI tile with a change chip, in the Audience Health style. */
export function HealthKpi({ icon: Icon, tone = "purple", label, value, sub, children }: {
  icon: LucideIcon; tone?: "purple" | "green" | "amber" | "red" | "blue"; label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode;
}) {
  return (
    <Card className="flex items-start gap-3 p-3.5">
      <IconTile tone={tone}><Icon className="h-5 w-5" /></IconTile>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] leading-snug text-gray-600 dark:text-slate-400">{label}</div>
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-[21px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{value}</span>
          {sub && <span className="text-[13px] font-semibold text-gray-600 dark:text-slate-400">{sub}</span>}
        </div>
        {children && <div className="mt-1 flex flex-wrap items-center gap-1 text-[11.5px] text-gray-500">{children}</div>}
      </div>
    </Card>
  );
}

export const thRow = "border-y border-gray-100 bg-gray-50/70 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400";
export const tdRow = "border-b border-gray-100 last:border-0 dark:border-slate-800";

/** A gap in the data we can't fill without an outside service: said plainly. */
export function NotMeasured({ text }: { text: string }) {
  return <span className="text-[12px] font-medium text-gray-500 dark:text-slate-400">{text}</span>;
}
