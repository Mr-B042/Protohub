import type { ReactNode } from "react";
import {
  AlertTriangle, Archive, ArrowDown, ArrowUp, Ban, Box, CalendarClock, CalendarDays, Clock, Crown, FileText, Gift, Heart, Hourglass, Layers, Mail, MapPin, PauseCircle, RefreshCw, Rocket, Send, ShoppingCart,
  Sparkles, Star, Tag, TrendingUp, Truck, Upload, UserPlus, Users, Zap, type LucideIcon
} from "lucide-react";
import { spaceNaira } from "../../lib/naira-glyph";

/** Shared pieces of the Email Marketing pages (Bright's designs, 8 Nov 2026). */

/** "health" is Audience & Segments › Audience Health (its own page, highlighted under Audience & Segments). */
export type EmSection = "overview" | "campaigns" | "automations" | "audience" | "health" | "templates" | "forms" | "journey" | "offers" | "loyalty" | "analytics" | "settings";

export const PURPLE = "#5B3FD9";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)] dark:border-slate-800 dark:bg-slate-900 ${className}`}>{children}</section>;
}

export function IconTile({ children, tone = "purple", size = "md" }: { children: ReactNode; tone?: "purple" | "green" | "amber" | "red" | "blue"; size?: "sm" | "md" | "lg" }) {
  const look = {
    purple: "bg-[#EEEBFC] text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-300",
    green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
    red: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300",
    blue: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300"
  }[tone];
  const box = size === "sm" ? "h-8 w-8 rounded-lg" : size === "lg" ? "h-12 w-12 rounded-2xl" : "h-10 w-10 rounded-xl";
  return <span className={`inline-flex shrink-0 items-center justify-center ${box} ${look}`}>{children}</span>;
}

const PILL: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  blue: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  red: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300",
  orange: "bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300",
  purple: "bg-[#EEEBFC] text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300"
};
export function Pill({ tone, children, className = "" }: { tone: string; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-semibold ${PILL[tone] ?? PILL.slate} ${className}`}>{children}</span>;
}

export const btn = {
  primary: "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl bg-[#5B3FD9] px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm hover:bg-[#4C32C4] disabled:opacity-50",
  soft: "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl bg-[#EEEBFC] px-4 py-2.5 text-[14px] font-semibold text-[#5B3FD9] hover:bg-[#E3DEFA] disabled:opacity-50 dark:bg-violet-500/15 dark:text-violet-200",
  ghost: "!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
  outline: "!min-h-0 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#C9BEF5] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#5B3FD9] hover:bg-[#F5F2FE] disabled:opacity-50 dark:border-violet-500/40 dark:bg-slate-900 dark:text-violet-200",
  icon: "!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
};

export const input = "!min-h-0 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-[14px] text-gray-900 outline-none focus:border-[#8B74EE] focus:ring-2 focus:ring-[#5B3FD9]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
export const select = `${input} !h-auto !font-normal pr-8`;

export const naira = (value: number) => spaceNaira(`₦${Math.round(Number(value) || 0).toLocaleString("en-NG")}`);
export const count = (value: number) => Math.round(Number(value) || 0).toLocaleString("en-NG");
export const pct = (value: number | null | undefined, digits = 1) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : `${(Math.round(value * 10 ** digits) / 10 ** digits).toFixed(digits)}%`);
export const rate = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

export function lagosDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return withTime
    ? DATE_TIME.format(date).replace(" at ", ", ")
    : DATE_ONLY.format(date);
}
const DATE_ONLY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Africa/Lagos" });
const DATE_TIME = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
const TIME_ONLY = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
export const lagosTime = (iso: string) => TIME_ONLY.format(new Date(iso));

/** "+18.4%" / "−6.2%" chip; green when the change is good. */
export function Delta({ value, suffix = "%", goodWhenDown = false, note }: { value: number | null | undefined; suffix?: string; goodWhenDown?: boolean; note?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return note ? <span className="text-[12px] text-gray-400">{note}</span> : null;
  const up = value >= 0;
  const good = goodWhenDown ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[12px] font-bold ${good ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300"}`}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{up ? "+" : "−"}{Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
}

export function KpiCard({ icon: Icon, tone = "purple", value, label, children }: { icon: LucideIcon; tone?: "purple" | "green" | "amber" | "red" | "blue"; value: ReactNode; label: string; children?: ReactNode }) {
  return (
    <Card className="flex items-start gap-2.5 p-3.5">
      <IconTile tone={tone}><Icon className="h-5 w-5" /></IconTile>
      <div className="min-w-0">
        <div className="whitespace-nowrap text-[21px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{value}</div>
        <div className="whitespace-nowrap text-[12.5px] text-gray-600 dark:text-slate-400">{label}</div>
        {children && <div className="mt-1.5 flex flex-wrap items-center gap-1 whitespace-nowrap">{children}</div>}
      </div>
    </Card>
  );
}

/** Label-first KPI (Campaigns / Audience designs). */
export function KpiTile({ icon: Icon, tone = "purple", label, value, children }: { icon: LucideIcon; tone?: "purple" | "green" | "amber" | "red" | "blue"; label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <Card className="flex items-center gap-3.5 p-4">
      <IconTile tone={tone} size="lg"><Icon className="h-6 w-6" /></IconTile>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-gray-600 dark:text-slate-400" title={label}>{label}</div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[24px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{value}</span>
          {children}
        </div>
      </div>
    </Card>
  );
}

export function SectionTitle({ title, sub, icon: Icon, right }: { title: ReactNode; sub?: ReactNode; icon?: LucideIcon; right?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {Icon && <IconTile><Icon className="h-5 w-5" /></IconTile>}
      <div className="min-w-0 flex-1">
        <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">{title}</h3>
        {sub && <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`!min-h-0 relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${on ? "bg-[#5B3FD9]" : "bg-gray-300 dark:bg-slate-600"}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}

/** The round tick on the right of a chosen card. */
export function Tick({ on }: { on: boolean }) {
  return on
    ? <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5B3FD9] text-white"><svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3.5 8.5l3 3 6-6.5" /></svg></span>
    : <span className="inline-flex h-5 w-5 shrink-0 rounded-full border-2 border-gray-300 dark:border-slate-600" />;
}

/** A ring chart from plain slices (SVG; no chart library needed). */
export function Donut({ slices, size = 150, stroke = 22, children }: { slices: Array<{ value: number; color: string }>; size?: number; stroke?: number; children?: ReactNode }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-gray-100 dark:text-slate-800" />
        {total > 0 && slices.map((slice, index) => {
          const length = (Math.max(0, slice.value) / total) * circumference;
          const node = <circle key={index} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={slice.color} strokeWidth={stroke} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} />;
          offset += length;
          return node;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export const SLICE_COLORS = ["#6D4AFF", "#B9A3FF", "#3B82F6", "#22C55E", "#F5B000", "#CBD5E1"];

/** Icons for groups and goals (kept as names so the server can store them). */
export const SEGMENT_ICONS: Record<string, LucideIcon> = {
  crown: Crown, refresh: RefreshCw, cart: ShoppingCart, clock: Clock, cartx: ShoppingCart, sparkles: Sparkles, tag: Tag, pin: MapPin,
  users: Users, userplus: UserPlus, alert: AlertTriangle, pause: PauseCircle, upload: Upload, gift: Gift, star: Star, layers: Layers,
  mail: Mail, ban: Ban, trend: TrendingUp, calendar: CalendarDays, heart: Heart, box: Box, truck: Truck, form: FileText, archive: Archive
};
export function SegmentIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const Icon = SEGMENT_ICONS[name] ?? Users;
  return <Icon className={className} />;
}

export const GOAL_TYPES: Record<string, { label: string; tone: string; icon: LucideIcon }> = {
  retention: { label: "Retention", tone: "blue", icon: RefreshCw },
  upsell: { label: "Upsell", tone: "orange", icon: ShoppingCart },
  promotion: { label: "Promotion", tone: "amber", icon: Tag },
  launch: { label: "Product Launch", tone: "purple", icon: Rocket },
  cart: { label: "Recovery", tone: "red", icon: ShoppingCart },
  winback: { label: "Win-Back", tone: "blue", icon: Users },
  appreciation: { label: "Loyalty", tone: "amber", icon: Crown },
  announcement: { label: "Announcement", tone: "slate", icon: Send }
};

export const STATUS_LOOK: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "slate" },
  scheduled: { label: "Scheduled", tone: "amber" },
  sending: { label: "Sending", tone: "blue" },
  active: { label: "Active", tone: "green" },
  paused: { label: "Paused", tone: "slate" },
  completed: { label: "✓ Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "red" },
  archived: { label: "Archived", tone: "slate" }
};

/** A tab with no design yet: say so plainly instead of guessing a layout. */
export function WaitingForDesign({ title, note }: { title: string; note?: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <IconTile size="lg"><Hourglass className="h-6 w-6" /></IconTile>
      <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">{title}</h3>
      <p className="m-0 max-w-md text-[14px] text-gray-600 dark:text-slate-400">{note ?? "This tab is waiting for its design. Send the screen and it will be built to match."}</p>
    </Card>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return message ? <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">{message}</p> : null;
}

export function Loading() {
  return <p className="m-0 flex items-center gap-2 text-[13px] text-gray-500"><RefreshCw className="h-4 w-4 animate-spin" />Loading…</p>;
}

export const ICONS = { CalendarClock, Zap };

/** A small product picture, or a coloured square with a mail icon. */
export function Thumb({ src, size = 44, goal }: { src: string | null | undefined; size?: number; goal?: string }) {
  const look = GOAL_TYPES[goal ?? ""] ?? GOAL_TYPES.retention;
  const Icon = look.icon;
  return src
    ? <img src={src} alt="" className="shrink-0 rounded-lg border border-gray-100 object-cover dark:border-slate-800" style={{ width: size, height: size }} />
    : <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#EDE7FF] to-[#D9CCFF] text-[#5B3FD9]" style={{ width: size, height: size }}><Icon className="h-5 w-5" /></span>;
}

/** Download rows as a CSV file. */
export function downloadCsv(name: string, header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const cell = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Tag pills (Tags design): a colour and an icon per tag. */
export const TAG_LOOK: Record<string, string> = {
  purple: "bg-[#EEEBFC] text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-200",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  blue: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  red: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300",
  orange: "bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300",
  pink: "bg-pink-50 text-pink-600 dark:bg-pink-500/10 dark:text-pink-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300"
};
export function TagPill({ name, color, icon, size = "md" }: { name: string; color: string; icon: string; size?: "sm" | "md" }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg font-bold ${size === "sm" ? "px-1.5 py-0.5 text-[11.5px]" : "px-2.5 py-1 text-[13.5px]"} ${TAG_LOOK[color] ?? TAG_LOOK.purple}`}>
      <SegmentIcon name={icon} className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} />{name}
    </span>
  );
}

/** Signal bars: High (3 green), Medium (2 amber), Low (1 red), none (—). */
export function EngagementBars({ level, withLabel = true }: { level: "high" | "medium" | "low" | "none"; withLabel?: boolean }) {
  if (level === "none") return <span className="text-gray-400">—</span>;
  const lit = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const tone = level === "high" ? "bg-emerald-500" : level === "medium" ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2, 3].map((i) => <span key={i} className={`w-[3px] rounded-sm ${i < lit + (level === "high" ? 1 : 0) ? tone : "bg-gray-200 dark:bg-slate-700"}`} style={{ height: 5 + i * 3 }} />)}
      </span>
      {withLabel && <span className="text-[13px] text-gray-800 dark:text-slate-200">{level === "high" ? "High" : level === "medium" ? "Medium" : "Low"}</span>}
    </span>
  );
}

/** A round initial, coloured from the name. */
export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const colours = ["#8B5CF6", "#A855F7", "#7C3AED", "#C026D3", "#6D28D9", "#9333EA", "#DB2777", "#4F46E5"];
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  const colour = colours[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % colours.length];
  return <span className="inline-flex shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ width: size, height: size, background: colour }}>{letter}</span>;
}

/** 08134567890 → +234 813 456 7890. */
export function phoneText(phone: string | null | undefined) {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("234")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length === 10 ? `+234 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}` : phone;
}
