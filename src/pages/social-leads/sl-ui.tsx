import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown, ArrowUp, Ban, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDot, Clock, Flame, Hourglass, MessageCircle,
  MessagesSquare, PauseCircle, PhoneCall, Send, Sparkles, UserCheck
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, Cell, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { spaceNaira } from "../../lib/naira-glyph";
import type { SlChange } from "../../lib/api";

/** Shared pieces of the Social Leads Inbox (Bright's nine designs, 12 Nov 2026). */

export const PURPLE = "#5B3FD9";

/** Server times come with 6-digit fractions ("…03.316519+00:00"); some browsers refuse those. */
export const toDate = (iso: string | number | Date | null | undefined) => {
  if (iso instanceof Date) return iso;
  if (typeof iso === "number") return new Date(iso);
  const s = String(iso ?? "").replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/([+-]\d\d)$/, "$1:00");
  return new Date(s);
};
export const toMs = (iso: string | null | undefined) => { const t = toDate(iso).getTime(); return Number.isFinite(t) ? t : NaN; };

export const money = (value: number | null | undefined, currency = "NGN") => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (currency === "ZMW") return `K${Math.round(value).toLocaleString("en-US")}`;
  return spaceNaira(`₦${Math.round(value).toLocaleString("en-NG")}`);
};
export const num = (value: number | null | undefined) => (value === null || value === undefined ? "—" : value.toLocaleString("en-NG"));
export const pctText = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${value}%`);
export const duration = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m ${String(r).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};
export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "—";
  const t = toMs(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : toDate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
}
export const shortAgo = (iso: string | null | undefined) => timeAgo(iso).replace(" ago", "").replace("just now", "now");
export const lagosTime = (iso: string) => !Number.isFinite(toMs(iso)) ? "" : toDate(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
export const lagosDateTime = (iso: string) => !Number.isFinite(toMs(iso)) ? "—" : toDate(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos" }).replace(" am", " AM").replace(" pm", " PM");
export const dayLabel = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Today, 11:00 AM" / "Tomorrow, 10:00 AM" / "14 Nov, 2:00 PM". */
export function whenLabel(iso: string) {
  const lagos = (ms: number) => new Date(ms + 3_600_000).toISOString().slice(0, 10);
  const day = lagos(toMs(iso)), today = lagos(Date.now()), tomorrow = lagos(Date.now() + 86_400_000);
  const time = lagosTime(iso).replace(/\s/g, " ");
  if (day === today) return `Today, ${time}`;
  if (day === tomorrow) return `Tomorrow, ${time}`;
  return `${dayLabel(day)}, ${time}`;
}
/** "Due in 15m" / "In 22h" / "In 2d" / "2h late". */
export function untilLabel(iso: string, now = Date.now()) {
  const ms = toMs(iso) - now;
  const abs = Math.abs(ms), m = Math.round(abs / 60_000), h = Math.round(abs / 3_600_000), d = Math.round(abs / 86_400_000);
  const span = m < 60 ? `${m}m` : h < 24 ? `${h}h${m % 60 && h < 3 ? ` ${m % 60}m` : ""}` : `${d}d`;
  return ms < 0 ? `${span} late` : abs < 6 * 3_600_000 ? `Due in ${span}` : `In ${span}`;
}

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)] dark:border-slate-800 dark:bg-slate-900 ${className}`}>{children}</section>;
}

export function CardTitle({ icon: Icon, title, right, sub }: { icon?: ComponentType<{ className?: string }>; title: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F1EEFD] text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-300"><Icon className="h-4 w-4" /></span>}
        <div className="min-w-0">
          <h3 className="m-0 text-[16px] font-bold leading-tight text-gray-900 dark:text-slate-50">{title}</h3>
          {sub && <p className="m-0 text-[12.5px] text-gray-500 dark:text-slate-400">{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

const TILE: Record<string, string> = {
  purple: "bg-[#F1EEFD] text-[#6E55E8] dark:bg-violet-500/15 dark:text-violet-300",
  blue: "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
  indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300",
  red: "bg-rose-50 text-rose-500 dark:bg-rose-500/15 dark:text-rose-300",
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
};
export function IconTile({ icon: Icon, tone = "purple", size = "lg" }: { icon: ComponentType<{ className?: string }>; tone?: string; size?: "lg" | "md" }) {
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-2xl ${TILE[tone] ?? TILE.purple} ${size === "lg" ? "h-12 w-12" : "h-9 w-9 rounded-xl"}`}><Icon className={size === "lg" ? "h-6 w-6" : "h-[18px] w-[18px]"} /></span>;
}

export function ChangeLine({ change, unit = "%", vs, invert }: { change: number | null | undefined; unit?: string; vs?: string; invert?: boolean }) {
  if (change === null || change === undefined) return <span className="text-[12px] text-gray-400">{vs ? "No earlier period" : " "}</span>;
  const up = change >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[12.5px] font-bold ${good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
      {up ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}{up ? "+" : ""}{change}{unit}
      {vs && <span className="ml-1 font-medium text-gray-500 dark:text-slate-400">vs. {vs}</span>}
    </span>
  );
}

/** The KPI card on every tab: icon tile, big number, label, change. */
export function Kpi({ icon, tone, value, label, change, unit, vs, labelOnTop, invert }: {
  icon: ComponentType<{ className?: string }>; tone: string; value: ReactNode; label: string; change?: number | null; unit?: string; vs?: string; labelOnTop?: boolean; invert?: boolean;
}) {
  return (
    <Card className="flex min-w-0 items-center gap-3 px-4 py-3.5">
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0">
        {labelOnTop && <span className="block text-[12.5px] font-medium leading-tight text-gray-600 dark:text-slate-400">{label}</span>}
        <b className="block truncate text-[22px] font-extrabold leading-7 text-gray-900 dark:text-slate-50">{value}</b>
        {!labelOnTop && <span className="block text-[12.5px] font-medium leading-tight text-gray-600 dark:text-slate-400">{label}</span>}
        {change !== undefined && <ChangeLine change={change} unit={unit} vs={vs} invert={invert} />}
      </div>
    </Card>
  );
}
export const fromChange = (c: SlChange | undefined) => ({ change: c?.change ?? null, unit: c?.unit ?? "%" });

// ── Status chips ──────────────────────────────────────────────────────────

type ChipDef = { label: string; cls: string; Icon: ComponentType<{ className?: string }> };
export const STATUS: Record<string, ChipDef> = {
  comment_captured: { label: "Comment Captured", cls: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300", Icon: MessageCircle },
  dm_sent: { label: "DM Sent", cls: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300", Icon: Send },
  engaged: { label: "Engaged", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", Icon: CheckCircle2 },
  new: { label: "New Lead", cls: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300", Icon: Sparkles },
  in_conversation: { label: "In Conversation", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", Icon: MessagesSquare },
  hot: { label: "Hot Lead", cls: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300", Icon: Flame },
  call_requested: { label: "Qualified", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", Icon: PhoneCall },
  awaiting_customer: { label: "Awaiting Customer", cls: "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200", Icon: Hourglass },
  awaiting_reply: { label: "Awaiting Reply", cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300", Icon: Clock },
  follow_up: { label: "Follow-up", cls: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300", Icon: CalendarDays },
  follow_up_due: { label: "Follow-up Due", cls: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300", Icon: CalendarDays },
  on_hold: { label: "On Hold", cls: "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300", Icon: PauseCircle },
  order_created: { label: "Converted", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", Icon: CheckCircle2 },
  delivered: { label: "Delivered", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", Icon: UserCheck },
  lost: { label: "Lost", cls: "bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-300", Icon: Ban },
  pending_off_hours: { label: "Pending (Off-Hours)", cls: "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300", Icon: Clock }
};
export const STATUS_FILTER_OPTIONS = ["new", "in_conversation", "hot", "awaiting_reply", "awaiting_customer", "call_requested", "follow_up_due", "on_hold", "order_created", "delivered", "lost", "comment_captured"];

export function StatusChip({ status, size = "md" }: { status: string; size?: "sm" | "md" }) {
  const def = STATUS[status] ?? { label: status, cls: "bg-slate-100 text-slate-600", Icon: CircleDot };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold ${def.cls} ${size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]"}`}>
      <def.Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />{def.label}
    </span>
  );
}

export function Pill({ children, tone = "slate", className = "" }: { children: ReactNode; tone?: string; className?: string }) {
  const map: Record<string, string> = {
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    red: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300", purple: "bg-[#EEEBFC] text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-300",
    blue: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300", slate: "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300"
  };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${map[tone] ?? map.slate} ${className}`}>{children}</span>;
}

/** Conversion % chip: green from 30%, amber below. */
export function RateChip({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-400">—</span>;
  return <Pill tone={value >= 30 ? "green" : value >= 15 ? "amber" : "red"}>{value}%</Pill>;
}

export function Avatar({ name, src, size = 36, platform, badge }: { name: string; src?: string | null; size?: number; platform?: ReactNode; badge?: ReactNode }) {
  const [broken, setBroken] = useState(false);
  const letters = (name || "?").replace(/^@/, "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  const hue = [...(name || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
  const tones = ["bg-amber-100 text-amber-800", "bg-sky-100 text-sky-800", "bg-violet-100 text-violet-800", "bg-emerald-100 text-emerald-800", "bg-rose-100 text-rose-800", "bg-indigo-100 text-indigo-800"];
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {src && !broken
        ? <img src={src} alt="" onError={() => setBroken(true)} className="h-full w-full rounded-full object-cover" />
        : <span className={`inline-flex h-full w-full items-center justify-center rounded-full font-bold dark:bg-slate-700 dark:text-slate-100 ${tones[hue]}`} style={{ fontSize: Math.max(10, size * 0.36) }}>{letters}</span>}
      {platform && <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-[1px] dark:bg-slate-900">{platform}</span>}
      {badge}
    </span>
  );
}

export function ProductThumb({ src, name, size = 32 }: { src?: string | null; name?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  return src && !broken
    ? <img src={src} alt="" onError={() => setBroken(true)} className="shrink-0 rounded-lg border border-gray-100 bg-white object-cover dark:border-slate-700" style={{ width: size, height: size }} />
    : <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-gray-100 text-[10px] font-bold text-gray-500 dark:bg-slate-800 dark:text-slate-400" style={{ width: size, height: size }}>{(name ?? "?").slice(0, 2).toUpperCase()}</span>;
}

// ── Controls ──────────────────────────────────────────────────────────────

export const btn = {
  primary: "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl bg-[#5B3FD9] px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm hover:bg-[#4C32C4] disabled:opacity-50",
  ghost: "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800",
  soft: "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl bg-[#EEEBFC] px-3.5 py-2.5 text-[14px] font-semibold text-[#5B3FD9] hover:bg-[#E3DEFA] disabled:opacity-50 dark:bg-violet-500/15 dark:text-violet-200",
  icon: "!min-h-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
  link: "!min-h-0 inline-flex items-center gap-1 text-[13px] font-semibold text-[#5B3FD9] hover:underline dark:text-violet-300"
};
export const field = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[14px] text-gray-900 focus:border-[#5B3FD9] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

export function Select({ value, onChange, options, label, className = "" }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; label: string; className?: string }) {
  return (
    <span className={`relative inline-flex min-w-0 ${className}`}>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
        className="!min-h-0 w-full appearance-none truncate rounded-xl border border-gray-200 bg-white py-2.5 pl-3.5 pr-9 text-[13.5px] font-medium text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
    </span>
  );
}

export const RANGES = [
  { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" }, { value: "90d", label: "Last 90 Days" }, { value: "all", label: "All Time" }
];
const fmtRange = (from: string | null | undefined, to: string | null | undefined) => {
  if (!from || !to) return "Since the first lead";
  const a = toDate(from), b = toDate(to);
  const f = (d: Date, year: boolean) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "Africa/Lagos" });
  return `${f(a, false)} – ${f(b, true)}`;
};
export const rangeLabel = (range: string) => RANGES.find((r) => r.value === range)?.label ?? "Custom";
export const rangeSpan = fmtRange;

/** "Last 7 Days / 6 – 12 Nov 2026 ▾" with quick picks and a custom from/to (portalled: cards clip popovers). */
export function DateRange({ range, from, to, onChange, compact }: { range: string; from?: string | null; to?: string | null; onChange: (r: { range: string; from?: string; to?: string }) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  const [cFrom, setCFrom] = useState(""), [cTo, setCTo] = useState("");
  const trigger = useRef<HTMLButtonElement | null>(null), panel = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 340;
    setPos({ left: Math.min(r.left, window.innerWidth - 300), ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { const t = e.target as Node; if (!trigger.current?.contains(t) && !panel.current?.contains(t)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen((v) => !v)} className={`${btn.ghost} !justify-between !px-3 ${compact ? "!py-2.5" : "!py-2"} min-w-[200px]`}>
        <span className="flex items-center gap-2.5 text-left">
          <CalendarDays className="h-5 w-5 text-gray-600 dark:text-slate-300" />
          {compact ? <span className="text-[13.5px] font-medium">{rangeLabel(range)}{range !== "all" && range !== "custom" ? "" : ""}</span>
            : <span><b className="block text-[13.5px] leading-4">{rangeLabel(range)}</b><span className="block text-[11.5px] font-medium text-gray-500 dark:text-slate-400">{fmtRange(from, to)}</span></span>}
        </span>
        <ChevronDown className="h-4 w-4 text-gray-500" />
      </button>
      {open && createPortal(
        <div ref={panel} className="fixed z-[90] w-[290px] rounded-2xl border border-gray-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900" style={pos}>
          {RANGES.map((r) => (
            <button key={r.value} type="button" onClick={() => { onChange({ range: r.value }); setOpen(false); }}
              className={`!min-h-0 block w-full rounded-lg px-3 py-2 text-left text-[13.5px] ${range === r.value ? "bg-[#EEEBFC] font-semibold text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-200" : "text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}>{r.label}</button>
          ))}
          <div className="mt-1 border-t border-gray-100 px-1 pt-2 dark:border-slate-800">
            <span className="text-[11.5px] font-semibold uppercase tracking-wide text-gray-500">Custom</span>
            <div className="mt-1 flex items-center gap-1.5">
              <input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} aria-label="From" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[12.5px] dark:border-slate-700 dark:bg-slate-900" />
              <input type="date" value={cTo} min={cFrom} onChange={(e) => setCTo(e.target.value)} aria-label="To" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[12.5px] dark:border-slate-700 dark:bg-slate-900" />
            </div>
            <button type="button" disabled={!cFrom} onClick={() => { onChange({ range: "custom", from: cFrom, to: cTo || cFrom }); setOpen(false); }} className={`${btn.primary} mt-2 w-full !py-2 !text-[13px]`}>Apply</button>
          </div>
        </div>, document.body)}
    </>
  );
}

export function Pager({ page, size, total, onPage, onSize, noun }: { page: number; size: number; total: number; onPage: (p: number) => void; onSize?: (s: number) => void; noun: string }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const nums = pages <= 7 ? Array.from({ length: pages }, (_, i) => i + 1)
    : page <= 4 ? [1, 2, 3, 4, 5, -1, pages] : page >= pages - 3 ? [1, -1, pages - 4, pages - 3, pages - 2, pages - 1, pages] : [1, -1, page - 1, page, page + 1, -2, pages];
  const from = total ? (page - 1) * size + 1 : 0, to = Math.min(page * size, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-[13px] text-gray-600 dark:text-slate-400">
      <span>Showing {from} – {to} of {total.toLocaleString()} {noun}</span>
      <div className="flex flex-wrap items-center gap-4">
        {onSize && (
          <span className="flex items-center gap-2">Rows per page:
            <Select label="Rows per page" value={String(size)} onChange={(v) => onSize(Number(v))} options={[10, 25, 50, 100].map((n) => ({ value: String(n), label: String(n) }))} className="w-[80px]" />
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 disabled:opacity-40 dark:border-slate-700"><ChevronLeft className="h-4 w-4" /></button>
          {nums.map((n, i) => n < 0 ? <span key={`g${i}`} className="px-1">…</span> : (
            <button key={n} type="button" onClick={() => onPage(n)} className={`!min-h-0 h-9 min-w-[36px] rounded-lg border px-2 font-semibold ${n === page ? "border-[#5B3FD9] bg-[#5B3FD9] text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>{n}</button>
          ))}
          <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 disabled:opacity-40 dark:border-slate-700"><ChevronRight className="h-4 w-4" /></button>
        </span>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-[13.5px] text-gray-500 dark:text-slate-400">{children}</div>;
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`!min-h-0 relative h-6 w-11 shrink-0 rounded-full p-0 transition-colors disabled:opacity-50 ${on ? "bg-[#5B3FD9]" : "bg-gray-300 dark:bg-slate-600"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** A modal window in the app's style. */
export function Modal({ title, sub, onClose, children, footer, width = "max-w-[560px]", icon }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string; icon?: ComponentType<{ className?: string }> }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-950 sm:rounded-2xl ${width}`}>
        <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4 dark:border-slate-800">
          {icon && <IconTile icon={icon} size="md" />}
          <div className="min-w-0 flex-1"><h2 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">{title}</h2>{sub && <p className="m-0 text-[13px] text-gray-500 dark:text-slate-400">{sub}</p>}</div>
          <button type="button" aria-label="Close" onClick={onClose} className={btn.icon}>✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-slate-800">{footer}</div>}
      </div>
    </div>, document.body);
}

// ── Charts ────────────────────────────────────────────────────────────────

export const CHART = { purple: "#6E55E8", blue: "#2F80ED", green: "#22C55E", teal: "#22C1C3", amber: "#F5A524", pink: "#EC4899", slate: "#94A3B8" };

/** Lines by day (first series filled), as on Leads & Orders Trend. */
export function TrendChart({ data, series, height = 210 }: { data: Array<Record<string, number | string>>; series: Array<{ key: string; label: string; color: string; fill?: boolean }>; height?: number }) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap justify-center gap-4 text-[12px] font-medium text-gray-700 dark:text-slate-300">
        {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
            <defs>{series.map((s) => <linearGradient key={s.key} id={`sl-${s.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity={0.22} /><stop offset="1" stopColor={s.color} stopOpacity={0} /></linearGradient>)}</defs>
            <CartesianGrid vertical={false} stroke="#E5E7EB" strokeOpacity={0.6} />
            <XAxis dataKey="label" tick={{ fontSize: 11.5, fill: "#6B7280" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11.5, fill: "#6B7280" }} tickLine={false} axisLine={false} width={44} />
            <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E5E7EB", fontSize: 12.5 }} />
            {series.map((s) => s.fill
              ? <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill={`url(#sl-${s.key})`} dot={{ r: 3.5, strokeWidth: 2, fill: "#fff" }} activeDot={{ r: 5 }} />
              : <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill="transparent" dot={{ r: 3.5, strokeWidth: 2, fill: "#fff" }} activeDot={{ r: 5 }} />)}
            <Line dataKey="__none" hide />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function Donut({ data, center, sub, size = 170, thickness = 26 }: { data: Array<{ label: string; value: number; color: string }>; center: ReactNode; sub: string; size?: number; thickness?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const rows = total ? data.filter((d) => d.value > 0) : [{ label: "none", value: 1, color: "#E5E7EB" }];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={rows} dataKey="value" nameKey="label" innerRadius={size / 2 - thickness} outerRadius={size / 2} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
            {rows.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <b className="text-[24px] font-extrabold leading-7 text-gray-900 dark:text-slate-50">{center}</b>
        <span className="max-w-[90px] text-[12px] leading-tight text-gray-600 dark:text-slate-400">{sub}</span>
      </div>
    </div>
  );
}

/** The stepped funnel on Overview / Analytics / Team. */
export function Funnel({ steps }: { steps: Array<{ label: string; value: number; color: string }> }) {
  const top = steps[0]?.value || 0;
  return (
    <div className="flex items-center gap-4">
      <div className="flex w-[40%] min-w-[120px] shrink-0 flex-col items-center gap-1.5">
        {steps.map((s, i) => (
          <div key={s.label} className="flex h-9 items-center justify-center text-[15px] font-extrabold text-white shadow-sm"
            style={{ background: s.color, width: `${100 - i * (56 / Math.max(1, steps.length - 1))}%`, clipPath: "polygon(0 0, 100% 0, 94% 100%, 6% 100%)", borderRadius: 6 }}>
            {s.value.toLocaleString()}
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1 space-y-[15px]">
        {steps.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-[13px]">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 text-[12.5px] leading-tight text-gray-800 dark:text-slate-200">{s.label}</span>
            <b className="w-10 text-right text-gray-900 dark:text-slate-100">{s.value.toLocaleString()}</b>
            <span className="w-12 text-right text-gray-500">{top ? `${Math.round((s.value / top) * 1000) / 10}%` : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Bar({ pct, color = CHART.purple }: { pct: number | null; color?: string }) {
  return <span className="block h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, background: color }} /></span>;
}

/** Download rows as a CSV file (Export buttons). */
export function downloadCsv(name: string, header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const esc = (v: string | number | null | undefined) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
