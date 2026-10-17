import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, ChevronDown, Filter, MoreVertical, Package, Search, X } from "lucide-react";
import { productMediaApi, type ProductCategory, type StockMovementRow } from "../../lib/api";
import { timeAgo } from "../../lib/media-upload";
import { CATEGORY_HEX, MenuItem, OTHERS_HEX, PopoverMenu, cardShell } from "./shared";

// Stock Overview (Bright's design, 17 Oct 2026). Every figure is live:
// stock from the agent/warehouse rows the app already loads, value at the
// selling price (as the Inventory page counts it), movements from
// stock_movements. Charts follow the dataviz rules: colour follows the
// category, legend + direct labels, hover for exact values.

export type StockRow = {
  id: string;
  name: string;
  sku: string;
  thumbUrl: string | null;
  categoryId: string | null;
  categoryName: string;
  stock: number;
  value: number;
  stateQty: (state: string) => number;
  status: "ok" | "low" | "out";
};

/** What a stock movement means for the company's total. */
export function movementDirection(type: string, qty: number): { label: "IN" | "OUT" | "ADJ" | "MOVED"; signed: number | null } {
  if (["Stock Added", "Return", "Status Reversal"].includes(type)) return { label: "IN", signed: Math.abs(qty) };
  if (type === "Order Fulfilled") return { label: "OUT", signed: -Math.abs(qty) };
  if (type === "Correction") return { label: "ADJ", signed: qty };
  return { label: "MOVED", signed: null }; // Waybill In/Out, Distributed to Agent: stock changes place, not total
}

const isoDay = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const prettyDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function useDateRange() {
  const now = new Date();
  const [range, setRange] = useState({ from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)) });
  return { range, setRange };
}

export function DateRangeButton({ range, onChange }: { range: { from: string; to: string }; onChange: (next: { from: string; to: string }) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const now = new Date();
  const presets: Array<[string, { from: string; to: string }]> = [
    ["This month", { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }],
    ["Last 7 days", { from: isoDay(new Date(Date.now() - 6 * 86400000)), to: isoDay(now) }],
    ["Last 30 days", { from: isoDay(new Date(Date.now() - 29 * 86400000)), to: isoDay(now) }],
    ["Last month", { from: isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)) }]
  ];
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen((value) => !value)}
        className="!min-h-0 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] font-semibold text-gray-800 shadow-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
        {prettyDay(range.from)} - {prettyDay(range.to)}<ChevronDown className="h-4 w-4 text-gray-400" />
      </button>
      <PopoverMenu anchor={anchor.current} open={open} onClose={() => setOpen(false)} width={260}>
        {presets.map(([label, value]) => (
          <MenuItem key={label} icon={value.from === range.from && value.to === range.to ? <Check /> : <span className="block h-4 w-4" />} onClick={() => { onChange(value); setOpen(false); }}>{label}</MenuItem>
        ))}
        <div className="grid grid-cols-2 gap-2 border-t border-gray-100 px-3.5 pb-2 pt-2.5 dark:border-slate-800">
          <label className="text-[11px] font-bold text-gray-500">From<input type="date" value={range.from} max={range.to} onChange={(event) => event.target.value && onChange({ ...range, from: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-2 text-[12px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
          <label className="text-[11px] font-bold text-gray-500">To<input type="date" value={range.to} min={range.from} onChange={(event) => event.target.value && onChange({ ...range, to: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-2 text-[12px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
        </div>
      </PopoverMenu>
    </>
  );
}

type Slice = { key: string; name: string; color: string; units: number; value: number };

function categorySlices(rows: StockRow[], categories: ProductCategory[]): Slice[] {
  const map = new Map<string, Slice>();
  for (const row of rows) {
    const category = row.categoryId ? categories.find((entry) => entry.id === row.categoryId) : null;
    const key = category?.id ?? "__none";
    const slice = map.get(key) ?? { key, name: category?.name ?? "No category", color: category ? CATEGORY_HEX[category.color] ?? OTHERS_HEX : OTHERS_HEX, units: 0, value: 0 };
    slice.units += Math.max(0, row.stock);
    slice.value += Math.max(0, row.value);
    map.set(key, slice);
  }
  // Five named categories, then "Others": never a seventh generated colour.
  const named = Array.from(map.values()).filter((slice) => slice.key !== "__none").sort((a, b) => b.units - a.units || b.value - a.value);
  const head = named.slice(0, 5);
  const rest = [...named.slice(5), ...(map.get("__none") ? [map.get("__none")!] : [])];
  if (rest.length) head.push({ key: "__others", name: named.length > 5 ? "Others" : "No category", color: OTHERS_HEX, units: rest.reduce((sum, slice) => sum + slice.units, 0), value: rest.reduce((sum, slice) => sum + slice.value, 0) });
  return head;
}

function Donut({ slices, measure, total, centerText, centerLabel, format }: { slices: Slice[]; measure: "units" | "value"; total: number; centerText: string; centerLabel: string; format: (value: number) => string }) {
  const [hover, setHover] = useState<string>("");
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const gap = slices.length > 1 ? 3 : 0;
  let offset = 0;
  const hovered = slices.find((slice) => slice.key === hover);
  return (
    <div className="relative h-[170px] w-[170px] shrink-0">
      <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90" role="img" aria-label={`Stock by category: ${slices.map((slice) => `${slice.name} ${slice[measure]}`).join(", ")}`}>
        <circle cx="90" cy="90" r={radius} fill="none" stroke="currentColor" strokeWidth="26" className="text-gray-100 dark:text-slate-800" />
        {total > 0 && slices.map((slice) => {
          const length = (slice[measure] / total) * circumference;
          const dash = Math.max(0, length - gap);
          const element = (
            <circle key={slice.key} cx="90" cy="90" r={radius} fill="none" stroke={slice.color} strokeWidth={hover === slice.key ? 30 : 26}
              strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} className="cursor-pointer transition-[stroke-width]"
              onMouseEnter={() => setHover(slice.key)} onMouseLeave={() => setHover("")} onClick={() => setHover(hover === slice.key ? "" : slice.key)} />
          );
          offset += length;
          return element;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <strong className="text-[22px] font-black leading-none text-gray-900 dark:text-slate-100">{hovered ? (measure === "units" ? hovered.units.toLocaleString() : format(hovered.value)) : centerText}</strong>
        <span className="mt-1 max-w-[6.5rem] truncate text-[12px] font-semibold text-gray-500 dark:text-slate-400">{hovered ? hovered.name : centerLabel}</span>
      </div>
    </div>
  );
}


function Bars({ slices, measure, format }: { slices: Slice[]; measure: "units" | "value"; format: (value: number) => string }) {
  const [hover, setHover] = useState("");
  const max = Math.max(1, ...slices.map((slice) => slice[measure]));
  const ticks = [max, max * 2 / 3, max / 3, 0];
  return (
    <div className="flex gap-2">
      <div className="flex h-[150px] shrink-0 flex-col justify-between pb-0 text-right text-[10.5px] font-semibold text-gray-400">
        {ticks.map((tick, index) => <span key={index}>{measure === "value" ? format(tick).replace(/\.0(?=[KM])/, "") : Math.round(tick).toLocaleString()}</span>)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative flex h-[150px] items-end gap-2 border-b border-l border-gray-100 px-1 dark:border-slate-800 sm:gap-3">
          {[1, 2].map((line) => <span key={line} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-gray-100 dark:border-slate-800" style={{ bottom: `${(line / 3) * 100}%` }} />)}
          {slices.map((slice) => {
            const height = Math.max(2, (slice[measure] / max) * 100);
            return (
              <div key={slice.key} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                onMouseEnter={() => setHover(slice.key)} onMouseLeave={() => setHover("")} onClick={() => setHover(hover === slice.key ? "" : slice.key)}>
                <span className="mb-1 truncate text-[10.5px] font-black text-gray-700 dark:text-slate-200">{measure === "value" ? format(slice.value) : slice.units.toLocaleString()}</span>
                <span className={`w-full max-w-[3.5rem] rounded-t-[4px] transition-opacity ${hover && hover !== slice.key ? "opacity-50" : ""}`} style={{ height: `${height}%`, background: slice.color }} />
                {hover === slice.key && (
                  <span className="pointer-events-none absolute bottom-full z-10 mb-6 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-lg">
                    {slice.name}: {slice.units.toLocaleString()} units · {format(slice.value)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-2 px-1 sm:gap-3">
          {slices.map((slice) => <span key={slice.key} className="min-w-0 flex-1 text-center text-[10.5px] font-semibold leading-tight text-gray-500 [overflow-wrap:anywhere] dark:text-slate-400">{slice.name}</span>)}
        </div>
      </div>
    </div>
  );
}

function SelectChip({ value, onChange, children, label }: { value: string; onChange: (value: string) => void; children: ReactNode; label: string }) {
  return (
    <span className="relative inline-block">
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}
        className="h-9 appearance-none rounded-lg border border-gray-200 bg-white pl-3 pr-8 text-[12.5px] font-semibold text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200">{children}</select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
    </span>
  );
}

const statusPill = (status: StockRow["status"]) => status === "out"
  ? <span className="rounded-md bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">Out of Stock</span>
  : status === "low"
    ? <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Low Stock</span>
    : <span className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">In Stock</span>;

export function StockOverviewTab({ rows, categories, states, defaultState, range, formatValue, onRowAction, canManageCatalog, showStockNumbers, unitsWord, showValue }: {
  rows: StockRow[];
  categories: ProductCategory[];
  states: string[];
  defaultState: string;
  range: { from: string; to: string };
  formatValue: (amount: number) => string;
  onRowAction: (action: "details" | "gallery" | "stock" | "crosssell", productId: string) => void;
  canManageCatalog: boolean;
  showStockNumbers: boolean;
  unitsWord: string;
  // Owner / Admin / Manager only (Bright, 17 Oct 2026).
  showValue: boolean;
}) {
  const [distMeasure, setDistMeasure] = useState<"units" | "value">("units");
  const [barMeasure, setBarMeasure] = useState<"value" | "units">("value");
  const [movements, setMovements] = useState<StockMovementRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<"" | StockRow["status"]>("");
  const [state, setState] = useState(defaultState);
  const [sort, setSort] = useState<"stock" | "name" | "value">("stock");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [menuFor, setMenuFor] = useState<{ id: string; el: HTMLElement } | null>(null);
  const filtersButton = useRef<HTMLButtonElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMovements(null);
    productMediaApi.stockMovements(range.from, range.to, 30).then((result) => { if (!cancelled) setMovements(result.movements ?? []); }).catch(() => { if (!cancelled) setMovements([]); });
    return () => { cancelled = true; };
  }, [range.from, range.to]);

  const slices = useMemo(() => categorySlices(rows, categories), [rows, categories]);
  const legendMeasure: "units" | "value" = showValue ? distMeasure : "units";
  const totalUnits = rows.reduce((sum, row) => sum + Math.max(0, row.stock), 0);
  const totalValue = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  const counts = { ok: rows.filter((row) => row.status === "ok").length, low: rows.filter((row) => row.status === "low").length, out: rows.filter((row) => row.status === "out").length };
  const lowest = [...rows].filter((row) => row.stock > 0).sort((a, b) => a.stock - b.stock).slice(0, 5);
  const thumbOf = new Map(rows.map((row) => [row.id, row.thumbUrl]));

  const filtered = rows.filter((row) => (!search.trim() || `${row.name} ${row.sku} ${row.categoryName}`.toLowerCase().includes(search.trim().toLowerCase()))
    && (!category || (category === "none" ? !row.categoryId : row.categoryId === category)) && (!status || row.status === status))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "value" ? b.value - a.value : b.stock - a.stock);
  const shown = showAll ? filtered : filtered.slice(0, 10);
  const units = (value: number) => showStockNumbers ? value.toLocaleString() : value > 0 ? "In stock" : "Out";

  const jumpToTable = (nextStatus: "" | StockRow["status"]) => { setStatus(nextStatus); setShowAll(true); tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className={`${cardShell} p-4`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-100">Stock Distribution by Category</h2>
            {showValue && <SelectChip value={distMeasure} onChange={(value) => setDistMeasure(value as "units" | "value")} label="Measure"><option value="units">Units</option><option value="value">Value (₦)</option></SelectChip>}
          </div>
          {totalUnits === 0 && totalValue === 0 ? <p className="m-0 py-12 text-center text-[13px] text-gray-400">No stock to show yet.</p> : (
            <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-center">
              <Donut slices={slices} measure={showValue ? distMeasure : "units"} total={showValue && distMeasure === "value" ? totalValue : totalUnits}
                centerText={showValue && distMeasure === "value" ? formatValue(totalValue) : totalUnits.toLocaleString()} centerLabel={showValue && distMeasure === "value" ? "Value" : "Units"} format={formatValue} />
              <ul className="m-0 w-full min-w-0 flex-1 list-none space-y-2 p-0">
                {slices.map((slice) => {
                  const amount = slice[legendMeasure];
                  const share = (legendMeasure === "units" ? totalUnits : totalValue) > 0 ? Math.round((amount / (legendMeasure === "units" ? totalUnits : totalValue)) * 100) : 0;
                  return (
                    <li key={slice.key} className="grid grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-3 text-[13px]">
                      <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} /><span className="truncate font-semibold text-gray-700 dark:text-slate-200">{slice.name}</span></span>
                      <strong className="font-black tabular-nums text-gray-900 dark:text-slate-100">{legendMeasure === "units" ? amount.toLocaleString() : formatValue(amount)}</strong>
                      <span className="text-right tabular-nums text-gray-400">{share}%</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
        <section className={`${cardShell} p-4`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-100">Stock {barMeasure === "value" && showValue ? "Value" : "Units"} by Category</h2>
            {showValue && <SelectChip value={barMeasure} onChange={(value) => setBarMeasure(value as "units" | "value")} label="Measure"><option value="value">Value (₦)</option><option value="units">Units</option></SelectChip>}
          </div>
          <div className="mt-4">{slices.length === 0 ? <p className="m-0 py-12 text-center text-[13px] text-gray-400">No stock to show yet.</p> : <Bars slices={slices} measure={showValue ? barMeasure : "units"} format={formatValue} />}</div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`${cardShell} p-4`}>
          <h2 className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-100">Stock Status</h2>
          <div className="mt-4 flex h-9 overflow-hidden rounded-lg" role="img" aria-label={`In stock ${counts.ok}, low ${counts.low}, out ${counts.out} products`}>
            {(["ok", "low", "out"] as const).map((key, index) => counts[key] > 0 && (
              <button key={key} type="button" onClick={() => jumpToTable(key)} title={`${counts[key]} products`} style={{ width: `${(counts[key] / Math.max(1, rows.length)) * 100}%` }}
                className={`!min-h-0 h-full ${index > 0 ? "border-l-2 border-white dark:border-[#0c1722]" : ""} ${key === "ok" ? "bg-emerald-500" : key === "low" ? "bg-amber-400" : "bg-rose-500"}`} />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {([["ok", "In Stock", "bg-emerald-500", <Check key="i" className="h-3 w-3" />], ["low", "Low Stock", "bg-amber-400", <span key="i" className="text-[10px] font-black">!</span>], ["out", "Out of Stock", "bg-rose-500", <X key="i" className="h-3 w-3" />]] as const).map(([key, label, tone, icon]) => (
              <button key={key} type="button" onClick={() => jumpToTable(key)} className="!min-h-0 flex items-start gap-2 text-left">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${tone}`}>{icon}</span>
                <span><strong className="block text-[15px] font-black leading-tight text-gray-900 dark:text-slate-100">{counts[key]}</strong>
                  <span className="block text-[11.5px] text-gray-500 dark:text-slate-400">{label} ({rows.length ? Math.round((counts[key] / rows.length) * 100) : 0}%)</span></span>
              </button>
            ))}
          </div>
          <p className="m-0 mt-3 text-[11px] text-gray-400">Counted in products.</p>
        </section>

        <section className={`${cardShell} p-4`}>
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-100">Top 5 Low Stock Products</h2>
            <button type="button" onClick={() => jumpToTable("low")} className="!min-h-0 inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200">View all <ArrowRight className="h-3 w-3" /></button>
          </div>
          <ol className="m-0 mt-2 list-none space-y-1 p-0">
            {lowest.length === 0 && <li className="py-6 text-center text-[13px] text-gray-400">Nothing in stock yet.</li>}
            {lowest.map((row, index) => (
              <li key={row.id}>
                <button type="button" onClick={() => onRowAction("details", row.id)} className="!min-h-0 flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-slate-900">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-black text-gray-500 dark:bg-slate-800">{index + 1}</span>
                  <Thumb url={row.thumbUrl} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-800 dark:text-slate-100">{row.name}</span>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-bold ${row.status === "low" ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300"}`}>{units(row.stock)} {showStockNumbers ? unitsWord : ""}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className={`${cardShell} p-4`}>
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-100">Recent Stock Movements</h2>
          </div>
          <ul className="m-0 mt-2 list-none space-y-1 p-0">
            {movements === null && <li className="py-6 text-center text-[13px] text-gray-400">Loading...</li>}
            {movements?.length === 0 && <li className="py-6 text-center text-[13px] text-gray-400">No movements in these dates.</li>}
            {movements?.slice(0, 5).map((move) => {
              const direction = movementDirection(move.type, move.qty);
              const tone = direction.label === "IN" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                : direction.label === "OUT" ? "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
                : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300";
              return (
                <li key={move.id} className="flex items-center gap-2.5 py-1.5" title={`${move.type}${move.byName ? ` · ${move.byName}` : ""}${move.from || move.to ? ` · ${move.from ?? "?"} → ${move.to ?? "?"}` : ""}`}>
                  <span className={`w-12 shrink-0 rounded-md py-0.5 text-center text-[10.5px] font-black ${tone}`}>{direction.label}</span>
                  <Thumb url={thumbOf.get(move.productId) ?? null} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-800 dark:text-slate-100">{move.productName}</span>
                  <span className={`shrink-0 text-[12.5px] font-black tabular-nums ${direction.signed === null ? "text-gray-500" : direction.signed >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {direction.signed === null ? `${move.qty} moved` : `${direction.signed > 0 ? "+" : ""}${direction.signed} ${Math.abs(direction.signed) === 1 ? unitsWord.replace(/s$/, "") : unitsWord}`}
                  </span>
                  <span className="hidden w-16 shrink-0 text-right text-[11px] text-gray-400 sm:block">{timeAgo(move.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section ref={tableRef} className={`${cardShell} scroll-mt-20 overflow-hidden`}>
        <div className="flex flex-col gap-2 p-4 xl:flex-row xl:items-center">
          <h2 className="m-0 shrink-0 text-[16px] font-black text-gray-900 dark:text-slate-100">All Products <span className="text-gray-400">({filtered.length})</span></h2>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
            <label className="relative block min-w-0 sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products..."
                className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-[13px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
            </label>
            <div className="flex gap-2 overflow-x-auto pb-0.5">
              <SelectChip value={category} onChange={setCategory} label="Category"><option value="">All Categories</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}<option value="none">No category</option></SelectChip>
              <SelectChip value={status} onChange={(value) => setStatus(value as "" | StockRow["status"])} label="Stock status"><option value="">All Stock Status</option><option value="ok">In Stock</option><option value="low">Low Stock</option><option value="out">Out of Stock</option></SelectChip>
              <SelectChip value={state} onChange={setState} label="State">{states.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</SelectChip>
              <button ref={filtersButton} type="button" onClick={() => setFiltersOpen((value) => !value)} className="!min-h-0 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[12.5px] font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200"><Filter className="h-3.5 w-3.5" />Filters</button>
            </div>
          </div>
        </div>
        <PopoverMenu anchor={filtersButton.current} open={filtersOpen} onClose={() => setFiltersOpen(false)} width={210}>
          <p className="m-0 px-3.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">Sort by</p>
          {([["stock", "Most stock"], ...(showValue ? [["value", "Highest value"]] as const : []), ["name", "Name A-Z"]] as const).map(([key, label]) => (
            <MenuItem key={key} icon={sort === key ? <Check /> : <span className="block h-4 w-4" />} onClick={() => { setSort(key); setFiltersOpen(false); }}>{label}</MenuItem>
          ))}
        </PopoverMenu>

        {/* Phones: a card per product. Computers: the design's table. */}
        <div className="divide-y divide-gray-100 border-t border-gray-100 md:hidden dark:divide-slate-800 dark:border-slate-800">
          {shown.map((row) => (
            <button key={row.id} type="button" onClick={() => onRowAction("details", row.id)} className="!min-h-0 flex w-full items-center gap-3 px-4 py-3 text-left">
              <Thumb url={row.thumbUrl} size="h-11 w-11" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold text-gray-900 dark:text-slate-100">{row.name}</span>
                <span className="block truncate text-[11.5px] text-gray-500">{row.categoryName || "No category"} · {state}: {units(row.stateQty(state))}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[13px] font-black tabular-nums text-gray-900 dark:text-slate-100">{units(row.stock)}</span>
                {statusPill(row.status)}
              </span>
            </button>
          ))}
        </div>
        <div className="hidden overflow-x-auto border-t border-gray-100 md:block dark:border-slate-800">
          <table className="w-full [&_td]:align-middle min-w-[56rem] text-left text-[13px]">
            <thead className="bg-gray-50 text-[11.5px] font-bold text-gray-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="w-10 px-4 py-2.5"><input type="checkbox" aria-label="Select all" checked={shown.length > 0 && shown.every((row) => selected.has(row.id))} onChange={(event) => setSelected(event.target.checked ? new Set(shown.map((row) => row.id)) : new Set())} className="accent-[#1F8FE0]" /></th>
                <th className="w-8 py-2.5">#</th><th className="py-2.5">Product</th><th className="py-2.5">Category</th><th className="py-2.5">SKU</th>
                <th className="py-2.5 text-right">Total Stock</th><th className="py-2.5 text-right">Available in {state}</th><th className="py-2.5 text-right">Other States</th>
                {showValue && <th className="py-2.5 text-right">Stock Value</th>}<th className="py-2.5 pl-6">Status</th><th className="px-4 py-2.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {shown.map((row, index) => {
                const here = row.stateQty(state);
                return (
                  <tr key={row.id} className="hover:bg-gray-50/70 dark:hover:bg-slate-900/50">
                    <td className="px-4 py-2.5"><input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })} className="accent-[#1F8FE0]" /></td>
                    <td className="py-2.5 text-gray-400">{index + 1}</td>
                    <td className="py-2.5"><button type="button" onClick={() => onRowAction("details", row.id)} className="!min-h-0 flex items-center gap-2.5 text-left font-bold text-gray-900 hover:text-[#1F8FE0] dark:text-slate-100"><Thumb url={row.thumbUrl} />{row.name}</button></td>
                    <td className="py-2.5 text-gray-500 dark:text-slate-400">{row.categoryName || "—"}</td>
                    <td className="py-2.5 text-gray-500 dark:text-slate-400">{row.sku}</td>
                    <td className="py-2.5 text-right font-semibold tabular-nums text-gray-900 dark:text-slate-100">{units(row.stock)}</td>
                    <td className="py-2.5 text-right tabular-nums text-gray-700 dark:text-slate-300">{units(here)}</td>
                    <td className="py-2.5 text-right tabular-nums text-gray-700 dark:text-slate-300">{units(Math.max(0, row.stock - here))}</td>
                    {showValue && <td className="py-2.5 text-right font-semibold tabular-nums text-gray-900 dark:text-slate-100">{formatValue(row.value)}</td>}
                    <td className="py-2.5 pl-6">{statusPill(row.status)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button type="button" aria-label={`Actions for ${row.name}`} onClick={(event) => setMenuFor({ id: row.id, el: event.currentTarget })}
                        className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300"><MoreVertical className="h-4 w-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <p className="m-0 py-10 text-center text-[13px] text-gray-400"><Package className="mx-auto mb-2 h-7 w-7 text-gray-300" />No products match.</p>}
        {filtered.length > 10 && (
          <button type="button" onClick={() => setShowAll((value) => !value)} className="!min-h-0 w-full border-t border-gray-100 py-3 text-[13px] font-bold text-[#1F8FE0] dark:border-slate-800">
            {showAll ? "Show fewer" : `Show all ${filtered.length}`}
          </button>
        )}
        <PopoverMenu anchor={menuFor?.el ?? null} open={Boolean(menuFor)} onClose={() => setMenuFor(null)} width={200}>
          {menuFor && (
            <>
              <MenuItem onClick={() => { onRowAction("details", menuFor.id); setMenuFor(null); }}>View details</MenuItem>
              <MenuItem onClick={() => { onRowAction("gallery", menuFor.id); setMenuFor(null); }}>Open gallery</MenuItem>
              <MenuItem onClick={() => { onRowAction("crosssell", menuFor.id); setMenuFor(null); }}>Cross-sell helper</MenuItem>
              {canManageCatalog && <MenuItem onClick={() => { onRowAction("stock", menuFor.id); setMenuFor(null); }}>Manage stock</MenuItem>}
            </>
          )}
        </PopoverMenu>
      </section>
    </div>
  );
}

function Thumb({ url, size = "h-8 w-8" }: { url: string | null; size?: string }) {
  return (
    <span className={`${size} shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-slate-800`}>
      {url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Package className="m-auto mt-[25%] h-1/2 w-1/2 text-gray-300" />}
    </span>
  );
}

export const csvDownload = (fileName: string, header: string[], rows: Array<Array<unknown>>) => {
  const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const text = [header.map(cell).join(","), ...rows.map((row) => row.map(cell).join(","))].join("\n");
  const href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = href; link.download = fileName; link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 4000);
};
