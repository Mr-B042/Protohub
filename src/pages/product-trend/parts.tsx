import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronDown, X } from "lucide-react";
import { NIGERIA_STATES, NIGERIA_VIEWBOX } from "./nigeria-states";

// Small shared pieces of the Product Trend page.

/** Five line colours, checked for colour-blind separation on light and dark. */
export const SERIES_COLORS = ["#1d4ed8", "#d97706", "#a21caf", "#15803d", "#dc2626"];

export const nf = (value: number) => Math.round(value).toLocaleString("en-NG");
export const pct1 = (value: number) => `${value.toFixed(1)}%`;

/** "↑ 12%" / "↓ 1.5%" under a figure. Points (pp) for rates. */
export function Delta({ value, points = false, invert = false, className = "" }: { value: number | null; points?: boolean; invert?: boolean; className?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className={`text-[11px] text-gray-400 ${className}`}>new</span>;
  const up = value >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11.5px] font-semibold ${good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"} ${className}`}>
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}{points ? " pts" : "%"}
    </span>
  );
}

/** Orders over the period, as a tiny line. */
export function Sparkline({ values, color = "#1d4ed8", width = 84 }: { values: number[]; color?: string; width?: number }) {
  const w = width, h = 26;
  if (values.length < 2) return <svg width={w} height={h} aria-hidden />;
  const max = Math.max(1, ...values);
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - (v / max) * (h - 6)).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={w - 2.5} cy={h - 3 - (last / max) * (h - 6)} r={2.5} fill={color} />
    </svg>
  );
}

/** A plain select styled like the design's dropdowns. */
export function SelectBox<T extends string>({ value, onChange, options, label, className = "" }: {
  value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string }>; label: string; className?: string;
}) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}
        className="!min-h-0 h-9 w-full appearance-none truncate rounded-lg border border-gray-200 bg-white pl-3 pr-8 text-[13px] text-gray-800 outline-none focus:border-[#1F8FE0] focus:ring-2 focus:ring-[#1F8FE0]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    </label>
  );
}

/** Two or three buttons side by side (Orders | Delivered ...). */
export function Segmented<T extends string>({ value, onChange, options, small = false, fill = false }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string }>; small?: boolean; fill?: boolean }) {
  return (
    <div className={`${fill ? "grid w-full" : "inline-flex"} rounded-lg border border-gray-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900`} role="group"
      style={fill ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)} aria-pressed={value === option.value}
          title={option.label}
          className={`!min-h-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-md ${small ? "px-1.5 py-1 text-[10.5px]" : "px-3 py-1.5 text-[12.5px]"} font-semibold transition-colors ${value === option.value ? "bg-[#1F8FE0] text-white shadow-sm" : "text-gray-600 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** White card with the design's heading row. */
export function Panel({ title, info, action, children, className = "" }: { title: ReactNode; info?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="m-0 flex min-w-0 items-center gap-1.5 text-[14px] font-bold leading-snug text-gray-900 dark:text-slate-100">
          {title}
          {info && <span title={info} className="cursor-help text-[11px] font-normal text-gray-400">ⓘ</span>}
        </h3>
        {action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Right-hand side panel (details). Closes on Escape and on the backdrop. */
export function SidePanel({ title, subtitle, onClose, children }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Portalled to <body>: the app's scroll area moves fixed elements inside it.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" className="!min-h-0 absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[720px] flex-col bg-white shadow-2xl dark:bg-slate-950">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="m-0 truncate text-[18px] font-bold text-gray-900 dark:text-slate-100">{title}</h2>
            {subtitle && <div className="mt-0.5 text-[12.5px] text-gray-500 dark:text-slate-400">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="!min-h-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/** Closes a popover when the user clicks anywhere else. */
export function useClickAway<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) close(); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);
  return ref;
}

/** Product photo, or its first letter when there is none. */
export function ProductThumb({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  return src
    ? <img src={src} alt="" loading="lazy" className="shrink-0 rounded-lg border border-gray-200 bg-white object-cover dark:border-slate-700" style={{ width: size, height: size }} />
    : <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-gray-100 text-[14px] font-bold text-gray-500 dark:bg-slate-800" style={{ width: size, height: size }} aria-hidden>{name.slice(0, 1)}</span>;
}

/** Download rows as a CSV file. */
export function downloadCsv(name: string, rows: Array<Array<string | number>>) {
  const csv = rows.map((row) => row.map((cell) => {
    const text = String(cell ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ── Map of Nigeria ──────────────────────────────────────────────────────────

/** Light → dark blue, one hue (magnitude). */
const RAMP = ["#e0ecff", "#bfd7fe", "#93bbfd", "#609afa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af"];

export type MapDatum = { value: number; tooltip: ReactNode };
export type MapBin = { label: string; color: string; test: (value: number | null) => boolean };

/** The design's legend bands for counts: 300+, 200 – 299, ..., 1 – 9, 0. */
export function countLegend(thresholds: number[]): MapBin[] {
  const blues = ["#1d4ed8", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe"];
  const bins: MapBin[] = thresholds.map((min, i) => {
    const upper = i === 0 ? null : thresholds[i - 1] - 1;
    return { label: upper === null ? `${nf(min)}+` : min === upper ? nf(min) : `${nf(min)} – ${nf(upper)}`, color: blues[i] ?? blues[blues.length - 1], test: (v) => v !== null && v >= min && (upper === null || v <= upper) };
  });
  return [...bins, { label: "0", color: "#eef2f7", test: (v) => !v }];
}

/**
 * Every state shaded by its value; the busiest few carry a label box (the top
 * one dark), as in the design. `data` is keyed by the MAP's state name (FCT).
 * With `legend` the states take the band colours and a legend box sits to the
 * right; without, a Low → High ramp.
 */
export function NigeriaMap({ data, labelTop = 6, formatValue = nf, onSelect, legend, zoomable = false }: {
  data: Record<string, MapDatum>; labelTop?: number; formatValue?: (value: number) => string; onSelect?: (state: string) => void;
  legend?: { title: string; bins: MapBin[] }; zoomable?: boolean;
}) {
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const max = Math.max(0, ...Object.values(data).map((d) => d.value));
  const colorOf = (value: number | null) => {
    if (legend) return legend.bins.find((bin) => bin.test(value))?.color ?? "#eef2f7";
    if (!value || max <= 0) return "#f1f5f9";
    const index = Math.min(RAMP.length - 1, Math.floor((value / max) * (RAMP.length - 1) + 0.0001));
    return RAMP[Math.max(1, index)];
  };
  const ranked = useMemo(() => Object.entries(data).filter(([, d]) => d.value > 0)
    .sort((a, b) => b[1].value - a[1].value).slice(0, labelTop).map(([name]) => name), [data, labelTop]);
  const [, , vw, vh] = NIGERIA_VIEWBOX.split(" ").map(Number);
  const box = { w: vw / zoom, h: vh / zoom };
  const viewBox = `${(vw - box.w) / 2} ${(vh - box.h) / 2} ${box.w} ${box.h}`;
  const map = (
    <div className="relative min-w-0 flex-1">
      {zoomable && (
        <div className="absolute left-0 top-0 z-10 flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + 0.5))} className="!min-h-0 h-7 w-7 text-[15px] text-gray-600 hover:bg-gray-50">+</button>
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} className="!min-h-0 h-7 w-7 border-t border-gray-200 text-[15px] text-gray-600 hover:bg-gray-50 dark:border-slate-700">−</button>
        </div>
      )}
      <svg viewBox={viewBox} className="h-auto w-full" role="img" aria-label="Map of Nigeria by state" onMouseLeave={() => setHover(null)}>
        {NIGERIA_STATES.map((state) => {
          const datum = data[state.name];
          return (
            <path key={state.name} d={state.d} fill={colorOf(datum ? datum.value : null)} stroke="#ffffff" strokeWidth={1.4 / zoom}
              className={`transition-opacity ${onSelect ? "cursor-pointer" : ""} ${hover && hover.name !== state.name ? "opacity-80" : ""}`}
              onMouseMove={(event) => {
                const rect = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setHover({ name: state.name, x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 });
              }}
              onClick={() => onSelect?.(state.name)}>
              <title>{state.name}{datum ? `: ${formatValue(datum.value)}` : ""}</title>
            </path>
          );
        })}
        {NIGERIA_STATES.filter((state) => ranked.includes(state.name)).map((state) => {
          const top = ranked[0] === state.name;
          const name = state.name === "FCT" ? "Abuja" : state.name;
          const value = formatValue(data[state.name].value);
          const s = 1 / zoom;
          const width = (Math.max(name.length, value.length) * 26 + 40) * s;
          const height = 108 * s;
          const x = state.cx - width / 2;
          const y = state.cy - height / 2;
          return (
            <g key={`label-${state.name}`} pointerEvents="none">
              <rect x={x} y={y} width={width} height={height} rx={12 * s} fill={top ? "#172554" : "#ffffff"} stroke={top ? "#172554" : "#cbd5e1"} strokeWidth={2 * s} />
              <text x={x + width / 2} y={y + 44 * s} textAnchor="middle" fontSize={34 * s} fontWeight={600} fill={top ? "#ffffff" : "#0f172a"}>{name}</text>
              <text x={x + width / 2} y={y + 88 * s} textAnchor="middle" fontSize={38 * s} fontWeight={800} fill={top ? "#ffffff" : "#0f172a"}>{value}</text>
            </g>
          );
        })}
      </svg>
      {hover && data[hover.name] && (
        <div className="pointer-events-none absolute z-10 w-52 -translate-x-1/2 -translate-y-full rounded-lg border border-gray-200 bg-white p-2.5 text-[12px] shadow-lg dark:border-slate-700 dark:bg-slate-900"
          style={{ left: `${Math.min(85, Math.max(15, hover.x))}%`, top: `${Math.max(12, hover.y - 2)}%` }}>
          <div className="mb-1 font-bold text-gray-900 dark:text-slate-100">{hover.name === "FCT" ? "Abuja (FCT)" : hover.name}</div>
          {data[hover.name].tooltip}
        </div>
      )}
    </div>
  );
  if (legend) {
    return (
      <div className="flex items-start gap-3">
        {map}
        <div className="w-[118px] shrink-0 rounded-xl border border-gray-200 p-2.5 dark:border-slate-700">
          <div className="mb-2 text-[11.5px] font-bold text-gray-800 dark:text-slate-200">{legend.title}</div>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {legend.bins.map((bin) => (
              <li key={bin.label} className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-slate-300">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: bin.color }} />{bin.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  return (
    <div>
      {map}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500 dark:text-slate-400">
        <span>Low</span>
        <span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${RAMP[0]}, ${RAMP[RAMP.length - 1]})` }} />
        <span>High</span>
      </div>
    </div>
  );
}

// ── Pieces the five other tabs share ────────────────────────────────────────

/** KPI tile with a little trend line, as in the tab designs. */
export function KpiTile({ Icon, tone, label, value, delta, deltaPoints = false, foot, spark, sparkColor = "#1d4ed8", info }: {
  Icon: (props: { className?: string }) => ReactNode; tone: string; label: string; value: string | null; delta?: number | null; deltaPoints?: boolean;
  foot?: ReactNode; spark?: number[]; sparkColor?: string; info?: string;
}) {
  const size = (value ?? "").length > 11 ? "text-[16px]" : (value ?? "").length > 8 ? "text-[18px]" : "text-[21px]";
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm dark:border-slate-800">
      <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon className="h-[18px] w-[18px]" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-medium leading-tight text-gray-600 dark:text-slate-400">{label}{info && <span title={info} className="ml-1 cursor-help text-gray-400">ⓘ</span>}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {value === null ? <div className="mt-1 h-6 w-20 animate-pulse rounded bg-gray-100 dark:bg-slate-800" />
            : <div className={`whitespace-nowrap font-black tracking-tight text-gray-900 dark:text-slate-50 ${size}`}>{value}</div>}
          {spark && spark.length > 1 && <span className="hidden shrink-0 sm:block"><Sparkline values={spark} color={sparkColor} width={56} /></span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-gray-500 dark:text-slate-400">
          {delta !== undefined && <><Delta value={delta} points={deltaPoints} /><span>vs previous period</span></>}
          {foot}
        </div>
      </div>
    </div>
  );
}

/** Ring chart with a figure in the middle. */
export function Donut({ slices, center, sub, size = 132 }: { slices: Array<{ label: string; value: number; color: string }>; center: ReactNode; sub?: ReactNode; size?: number }) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const r = 42, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx={50} cy={50} r={r} fill="none" stroke="#eef2f7" strokeWidth={13} />
        {total > 0 && slices.filter((slice) => slice.value > 0).map((slice) => {
          const length = (slice.value / total) * c;
          const el = <circle key={slice.label} cx={50} cy={50} r={r} fill="none" stroke={slice.color} strokeWidth={13} strokeDasharray={`${Math.max(0, length - 1)} ${c}`} strokeDashoffset={-offset}><title>{slice.label}</title></circle>;
          offset += length;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-[20px] font-black leading-none text-gray-900 dark:text-slate-50">{center}</div>
        {sub && <div className="mt-0.5 text-[11px] text-gray-500">{sub}</div>}
      </div>
    </div>
  );
}

const AVATAR_TONES = ["bg-blue-100 text-blue-700", "bg-violet-100 text-violet-700", "bg-amber-100 text-amber-700", "bg-emerald-100 text-emerald-700", "bg-rose-100 text-rose-700"];
/** Initials in a circle (agents have no photos). */
export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
  const tone = AVATAR_TONES[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_TONES.length];
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${tone}`} style={{ width: size, height: size }} aria-hidden>{initials}</span>;
}

export const PILL_TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  orange: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  red: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  gray: "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300"
};
/** Small coloured status label with a dot. */
export function Pill({ tone, children }: { tone: keyof typeof PILL_TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${PILL_TONES[tone]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{children}</span>;
}

/** One insight: icon, title, the figures behind it, and a View Details button. */
export function InsightCard({ Icon, tone, title, text, foot, onView }: {
  Icon: (props: { className?: string }) => ReactNode; tone: string; title: string; text: ReactNode; foot?: ReactNode; onView?: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-200 p-3 dark:border-slate-800">
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon className="h-[18px] w-[18px]" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-bold text-gray-900 dark:text-slate-100">{title}</div>
        <div className="mt-0.5 text-[11.5px] leading-snug text-gray-600 dark:text-slate-400">{text}</div>
        {(foot || onView) && (
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
            <span>{foot}</span>
            {onView && <button type="button" onClick={onView} className="!min-h-0 rounded-md border border-blue-200 px-2.5 py-1 text-[11px] font-semibold text-[#1F8FE0] hover:bg-blue-50">View Details</button>}
          </div>
        )}
      </div>
    </div>
  );
}
