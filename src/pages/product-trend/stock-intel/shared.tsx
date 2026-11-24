import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Columns3, Download, Ellipsis, Flame, Home, Info, Loader2, MapPin, Search, Target, Truck, Warehouse, X } from "lucide-react";
import { stockIntelApi, type StockIntelData, type StockIntelRow, type StockIntelSource, type StockIntelStatus } from "../../../lib/api";
import { SidePanel, downloadCsv, nf, useClickAway } from "../parts";
import type { TransferRequest } from "../tab-context";

// Shared pieces of the Stock Intelligence tab (Bright's designs, 23 Nov 2026).

export type View = "overview" | "streaks" | "forecast" | "network" | "movements";

export type IntelCtx = {
  data: StockIntelData;
  rows: StockIntelRow[];
  productName: (id: string) => string;
  windowDays: number;
  /** The product picked at the top of the tab (null = all products). */
  productId: string | null;
  canCreateTransfer: boolean;
  onCreateTransfer?: (request: TransferRequest) => void;
  canEdit: boolean;
  setView: (view: View, statusFilter?: StockIntelStatus | "all") => void;
  statusFilter: StockIntelStatus | "all";
  openHub: (locationId: string) => void;
  openPlan: (row: StockIntelRow) => void;
  openPlanAll: () => void;
  openSettings: (locationId: string) => void;
  openRoutes: () => void;
  reload: () => void;
  exportRef: { current: () => void };
};

export const place = (state: string) => (state === "FCT Abuja" ? "Abuja" : state);
export const hubTitle = (row: { agentName: string; hubName: string }) => row.agentName;
/** "Abuja (North Hub)" style second line: state, plus the hub's own name when it says more. */
export const hubPlace = (row: { state: string; hubName: string; agentName: string }) =>
  row.hubName && row.hubName !== row.agentName && !row.hubName.toLowerCase().includes(place(row.state).toLowerCase())
    ? `${place(row.state)} (${row.hubName})` : row.hubName && row.hubName !== row.agentName ? row.hubName : place(row.state);
export const daysText = (days: number | null) => (days === null ? "—" : days >= 99 ? "99+ days" : `${days.toFixed(1)} days`);
export const one = (value: number) => (Math.round(value * 10) / 10).toFixed(1);
export const units = (n: number) => `${nf(n)} unit${Math.round(n) === 1 ? "" : "s"}`;

export const STATUS_TONE: Record<StockIntelStatus, { pill: string; chip: string; dot: string; fill: string; soft: string }> = {
  Critical: { pill: "bg-rose-500 text-white", chip: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300", dot: "bg-rose-500", fill: "#ef4444", soft: "bg-rose-50 dark:bg-rose-500/10" },
  "Restock Soon": { pill: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300", chip: "bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300", dot: "bg-orange-500", fill: "#f97316", soft: "bg-orange-50 dark:bg-orange-500/10" },
  Watch: { pill: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300", chip: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300", dot: "bg-amber-400", fill: "#facc15", soft: "bg-amber-50 dark:bg-amber-500/10" },
  Healthy: { pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300", chip: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300", dot: "bg-emerald-500", fill: "#22c55e", soft: "bg-emerald-50 dark:bg-emerald-500/10" }
};
export const STATUS_ORDER: Record<StockIntelStatus, number> = { Critical: 0, "Restock Soon": 1, Watch: 2, Healthy: 3 };
export const STATUS_HINT: Record<StockIntelStatus, string> = {
  Critical: "Runs out before a restock sent today can arrive",
  "Restock Soon": "Send stock now: it runs out within lead time + safety days",
  Watch: "Getting close to the restock point",
  Healthy: "Enough for the lead time and safety days"
};

export function StatusPill({ status }: { status: StockIntelStatus }) {
  return <span title={STATUS_HINT[status]} className={`inline-flex whitespace-nowrap rounded-md px-2.5 py-1 text-[11.5px] font-semibold ${STATUS_TONE[status].pill}`}>{status}</span>;
}
export function DaysChip({ row }: { row: Pick<StockIntelRow, "daysLeft" | "status"> }) {
  return <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-semibold ${STATUS_TONE[row.status].chip}`}>{row.daysLeft === null ? "No sales" : daysText(row.daysLeft)}</span>;
}
export function RestockPill({ value }: { value: number }) {
  return value > 0 ? <span className="inline-flex whitespace-nowrap rounded-md bg-rose-50 px-2.5 py-1 text-[12px] font-bold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">{units(value)}</span> : <span className="text-gray-400">–</span>;
}
export function StreakChip({ days }: { days: number }) {
  if (days <= 0) return <span className="text-[12px] text-gray-400">–</span>;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-orange-50 px-2 py-1 text-[12px] font-semibold text-gray-800 dark:bg-orange-500/15 dark:text-orange-200"><Flame className="h-3.5 w-3.5 text-orange-500" />{days} day{days === 1 ? "" : "s"}</span>;
}

const HOUSE_TONES = ["bg-blue-50 text-blue-600", "bg-violet-50 text-violet-600", "bg-emerald-50 text-emerald-600", "bg-amber-50 text-amber-600", "bg-rose-50 text-rose-500"];
export const houseTone = (key: string) => HOUSE_TONES[[...key].reduce((s, c) => s + c.charCodeAt(0), 0) % HOUSE_TONES.length];
export function HouseIcon({ seed, size = 34 }: { seed: string; size?: number }) {
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-full ${houseTone(seed)} dark:bg-white/5`} style={{ width: size, height: size }}><Home className="h-[17px] w-[17px]" /></span>;
}
export function AgentCell({ row }: { row: { agentName: string; hubName: string; state: string; locationId: string } }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <HouseIcon seed={row.locationId} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-bold text-gray-900 dark:text-slate-100">{hubTitle(row)}</div>
        <div className="flex items-center gap-0.5 truncate text-[11.5px] text-gray-500"><MapPin className="h-3 w-3 shrink-0" />{hubPlace(row)}</div>
      </div>
    </div>
  );
}

/** Seven little bars (Overview cards). */
export function MiniBars({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-9 items-end gap-1.5" aria-hidden>
      {values.map((v, i) => <span key={i} className="flex-1 rounded-sm" style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: color, opacity: v > 0 ? 0.55 + 0.45 * (v / max) : 0.18 }} />)}
    </div>
  );
}
/** 7-Day Pattern: bars with the number under each (Delivery Streaks). */
export function PatternBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-1" aria-label={`Delivered per day: ${values.join(", ")}`}>
      {values.map((v, i) => (
        <div key={i} className="flex w-[15px] flex-col items-center gap-0.5">
          <span className="block w-full rounded-[2px]" style={{ height: `${v > 0 ? Math.max(4, (v / max) * 16) : 3}px`, background: v > 0 ? "#22c55e" : "#d1fae5" }} />
          <span className="text-[9.5px] text-gray-600 dark:text-slate-400">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>{children}</section>;
}
export function CardHead({ Icon, title, sub, info, action, tone = "bg-blue-50 text-[#1F8FE0]" }: { Icon?: (p: { className?: string }) => ReactNode; title: ReactNode; sub?: ReactNode; info?: string; action?: ReactNode; tone?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone} dark:bg-white/5`}><Icon className="h-[18px] w-[18px]" /></span>}
        <div className="min-w-0">
          <h3 className="m-0 flex items-center gap-1.5 text-[16.5px] font-black tracking-tight text-gray-900 dark:text-slate-50">{title}{info && <span title={info} className="cursor-help text-gray-300"><Info className="h-3.5 w-3.5" /></span>}</h3>
          {sub && <p className="m-0 mt-0.5 text-[12px] text-gray-500 dark:text-slate-400">{sub}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
/** Tinted figure card used inside panels (Delivery Streaks / Restock Forecast tops). */
export function FigureCard({ Icon, tone, bg, label, value, foot }: { Icon: (p: { className?: string }) => ReactNode; tone: string; bg: string; label: ReactNode; value: ReactNode; foot?: ReactNode }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border border-gray-100 p-3.5 dark:border-slate-800 ${bg}`}>
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/80 ${tone} dark:bg-white/5`}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-gray-700 dark:text-slate-300">{label}</div>
        <div className="mt-0.5 text-[20px] font-black leading-tight tracking-tight text-gray-900 dark:text-slate-50">{value}</div>
        {foot && <div className="mt-0.5 text-[11.5px] text-gray-600 dark:text-slate-400">{foot}</div>}
      </div>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative block min-w-[200px] flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="!min-h-0 h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-[13px] outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
    </label>
  );
}
export function ExportButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="!min-h-0 inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><Download className="h-4 w-4" /> Export</button>;
}

/** "Columns" menu: tick which columns show. */
export function ColumnsMenu<K extends string>({ labels, shown, setShown }: { labels: Record<K, string>; shown: Record<K, boolean>; setShown: (next: Record<K, boolean>) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickAway<HTMLDivElement>(open, close);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="!min-h-0 inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><Columns3 className="h-4 w-4" /> Columns</button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {(Object.keys(labels) as K[]).map((key) => (
            <button key={key} type="button" onClick={() => setShown({ ...shown, [key]: !shown[key] })} className="!min-h-0 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-gray-50 dark:hover:bg-slate-800">
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${shown[key] ? "border-[#1F8FE0] bg-[#1F8FE0] text-white" : "border-gray-300"}`}>{shown[key] && <Check className="h-3 w-3" />}</span>{labels[key]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Per-row product chip (an agent's other products). */
export function ProductSwitch({ value, options, onChange }: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) {
  return (
    <label className="relative inline-block max-w-[170px]">
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={options.length < 2}
        className="!min-h-0 h-8 w-full appearance-none truncate rounded-lg border border-gray-200 bg-white pl-2.5 pr-7 text-[11.5px] font-medium text-gray-800 disabled:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
    </label>
  );
}

/** ⋯ menu on a row. */
export function RowMenu({ items }: { items: Array<{ label: string; onClick: () => void; hidden?: boolean }> }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickAway<HTMLDivElement>(open, close);
  const shown = items.filter((i) => !i.hidden);
  if (shown.length === 0) return null;
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label="More" onClick={() => setOpen((o) => !o)} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700"><Ellipsis className="h-4 w-4" /></button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {shown.map((item) => <button key={item.label} type="button" onClick={() => { setOpen(false); item.onClick(); }} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left text-[12.5px] hover:bg-gray-50 dark:hover:bg-slate-800">{item.label}</button>)}
        </div>
      )}
    </div>
  );
}
export function PlanButton({ row, ctx }: { row: StockIntelRow; ctx: IntelCtx }) {
  if (row.restock > 0) return <button type="button" onClick={() => ctx.openPlan(row)} className="!min-h-0 h-8 whitespace-nowrap rounded-lg bg-[#1F8FE0] px-3.5 text-[12px] font-semibold text-white hover:bg-[#1a7dc4]">Plan Restock</button>;
  return <button type="button" onClick={() => ctx.openHub(row.locationId)} className="!min-h-0 h-8 w-[92px] rounded-lg border border-blue-200 bg-white text-[12px] font-semibold text-[#1F8FE0] hover:bg-blue-50 dark:bg-slate-900">View</button>;
}
export function rowMenuItems(row: StockIntelRow, ctx: IntelCtx) {
  return [
    { label: "View agent", onClick: () => ctx.openHub(row.locationId) },
    { label: "Plan restock", onClick: () => ctx.openPlan(row), hidden: !ctx.canCreateTransfer },
    { label: "Lead time & safety stock", onClick: () => ctx.openSettings(row.locationId) }
  ];
}

export function InsightBar({ text, action }: { text: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600"><Target className="h-5 w-5" /></span>
      <p className="m-0 flex-1 text-[13px] text-gray-700 dark:text-slate-300"><b className="text-gray-900 dark:text-slate-100">Insight:</b> {text}</p>
      {action}
    </div>
  );
}
export function CreatePlanButton({ ctx, label = "Create Restock Plan" }: { ctx: IntelCtx; label?: string }) {
  return <button type="button" onClick={ctx.openPlanAll} className="!min-h-0 inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-[#1F8FE0] px-5 text-[13px] font-semibold text-white shadow-sm hover:bg-[#1a7dc4]"><Truck className="h-4 w-4" /> {label}</button>;
}

/** Rows grouped per agent hub, with the product each row shows (worst first). */
export function useHubGroups(rows: StockIntelRow[]) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const groups = useMemo(() => {
    const map = new Map<string, StockIntelRow[]>();
    for (const row of rows) { const list = map.get(row.locationId); if (list) list.push(row); else map.set(row.locationId, [row]); }
    return [...map.values()];
  }, [rows]);
  const shown = groups.map((list) => list.find((r) => r.productId === picked[list[0].locationId]) ?? list[0]);
  return { groups, shown, pick: (locationId: string, productId: string) => setPicked((p) => ({ ...p, [locationId]: productId })) };
}
export const productOptions = (list: StockIntelRow[], name: (id: string) => string) => list.map((r) => ({ value: r.productId, label: name(r.productId) }));

export const csv = (name: string, rows: Array<Array<string | number>>) => downloadCsv(name, rows);

// ── Panels and modals ───────────────────────────────────────────────────────

function Modal({ title, sub, onClose, children, wide = false }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal onClick={onClose}>
      <div className={`max-h-[90vh] w-full ${wide ? "max-w-3xl" : "max-w-lg"} overflow-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900`} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div><h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-50">{title}</h3>{sub && <p className="m-0 mt-0.5 text-[12px] text-gray-500">{sub}</p>}</div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function sourceLine(source: StockIntelSource) {
  if (source.kind === "warehouse") return `Main warehouse · ${nf(source.spare)} in stock`;
  return `${source.label} · ${source.sameState ? "same state" : source.priority > 1 ? "fallback" : "supply hub"} · can spare ${nf(source.spare)}`;
}

/** Plan Restock: where the units can come from. Each choice opens the normal Create Waybill form. */
export function PlanModal({ row, ctx, onClose }: { row: StockIntelRow; ctx: IntelCtx; onClose: () => void }) {
  const send = (source: StockIntelSource | null, qty: number) => {
    ctx.onCreateTransfer?.({
      productId: row.productId, quantity: Math.max(1, qty), toState: row.state, toAgentId: row.agentId, toAgentLocationId: row.locationId,
      ...(source?.kind === "hub" ? { fromAgentId: source.agentId, fromAgentLocationId: source.locationId } : {})
    });
    onClose();
  };
  const useful = row.sources.filter((s) => s.units > 0);
  const covered = useful.reduce((sum, s) => sum + s.units, 0);
  return (
    <Modal title={`Plan restock — ${row.agentName}`} sub={`${ctx.productName(row.productId)} · ${place(row.state)} · ${row.status}`} onClose={onClose}>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[["Send", units(row.restock)], ["Days left", daysText(row.daysLeft)], ["Lead time", `${one(row.leadDays)} days`]].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-gray-50 p-2.5 dark:bg-slate-800"><div className="text-[11px] text-gray-500">{label}</div><div className="text-[15px] font-black text-gray-900 dark:text-slate-100">{value}</div></div>
        ))}
      </div>
      <p className="m-0 mt-3 text-[12px] text-gray-600 dark:text-slate-400">
        {one(row.speed)} a day × 7 days + {nf(row.safetyUnits)} safety − {nf(row.usable)} free on the shelf{row.inTransit > 0 ? ` − ${nf(row.inTransit)} on the way` : ""} = <b>{units(row.restock)}</b>.
        A nearby agent only gives what it can spare after its own week.
      </p>
      <div className="mt-3 space-y-2">
        {row.sources.length === 0 && <p className="m-0 text-[12.5px] text-gray-500">Restocked from: {row.primarySource}.</p>}
        {row.sources.map((source, i) => (
          <div key={i} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${source.units > 0 ? "border-blue-200 bg-blue-50/50 dark:border-blue-500/30 dark:bg-blue-500/10" : "border-gray-200 opacity-70 dark:border-slate-700"}`}>
            <div className="flex min-w-0 items-center gap-2.5">
              {source.kind === "warehouse" ? <Warehouse className="h-4 w-4 shrink-0 text-[#1F8FE0]" /> : <Home className="h-4 w-4 shrink-0 text-emerald-600" />}
              <div className="min-w-0"><div className="truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100">{source.units > 0 ? `Send ${units(source.units)}` : "Nothing to spare"}</div><div className="truncate text-[11.5px] text-gray-500">{sourceLine(source)}</div></div>
            </div>
            {ctx.canCreateTransfer && source.units > 0 && <button type="button" onClick={() => send(source, source.units)} className="!min-h-0 h-8 shrink-0 rounded-lg bg-[#1F8FE0] px-3 text-[12px] font-semibold text-white">Create waybill</button>}
          </div>
        ))}
        {covered < row.restock && row.sources.length > 0 && <p className="m-0 text-[12px] font-semibold text-rose-600">{units(row.restock - covered)} has no source with stock to spare.</p>}
      </div>
      {ctx.canCreateTransfer && useful.length === 0 && (
        <button type="button" onClick={() => send(null, row.restock)} className="!min-h-0 mt-3 h-9 w-full rounded-lg bg-[#1F8FE0] text-[13px] font-semibold text-white">Create waybill for {units(row.restock)}</button>
      )}
      {!ctx.canCreateTransfer && <p className="m-0 mt-3 text-[12px] text-gray-500">Only Owner, Admin and inventory staff can create waybills.</p>}
    </Modal>
  );
}

/** Create Restock Plan: every restock in one list, most urgent first. */
export function PlanAllModal({ ctx, onClose }: { ctx: IntelCtx; onClose: () => void }) {
  const list = ctx.rows.filter((r) => r.restock > 0).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.daysLeft ?? 99) - (b.daysLeft ?? 99));
  const total = list.reduce((s, r) => s + r.restock, 0);
  return (
    <Modal wide title="Restock plan" sub={`${list.length} restock${list.length === 1 ? "" : "s"} · ${units(total)} · most urgent first. Each line opens the normal Create Waybill form.`} onClose={onClose}>
      {list.length === 0 ? <p className="m-0 py-6 text-center text-[13px] text-gray-500">Nothing needs restocking right now.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full !min-w-0 text-[12.5px]">
            <thead><tr className="text-left text-[11px] font-semibold text-gray-500"><th className="py-2">Agent / State</th><th>Product</th><th>Days left</th><th>Send</th><th>From</th><th /></tr></thead>
            <tbody>
              {list.map((row) => {
                const from = row.sources.filter((s) => s.units > 0).map((s) => `${s.label} (${s.units})`).join(", ") || row.primarySource;
                return (
                  <tr key={row.key} className="border-t border-gray-100 dark:border-slate-800">
                    <td className="py-2"><div className="font-semibold">{row.agentName}</div><div className="text-[11px] text-gray-500">{place(row.state)}</div></td>
                    <td>{ctx.productName(row.productId)}</td><td><DaysChip row={row} /></td><td className="font-bold">{nf(row.restock)}</td>
                    <td className="max-w-[200px] truncate text-gray-600" title={from}>{from}</td>
                    <td className="text-right"><button type="button" onClick={() => ctx.openPlan(row)} className="!min-h-0 h-8 rounded-lg bg-[#1F8FE0] px-3 text-[12px] font-semibold text-white">Plan</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {list.length > 0 && <button type="button" onClick={() => csv("restock-plan", [["Agent", "State", "Product", "Days left", "Send", "From"], ...list.map((r) => [r.agentName, place(r.state), ctx.productName(r.productId), r.daysLeft === null ? "" : one(r.daysLeft), r.restock, r.sources.filter((s) => s.units > 0).map((s) => `${s.label} (${s.units})`).join("; ") || r.primarySource])])}
        className="!min-h-0 mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[12.5px] font-semibold"><Download className="h-4 w-4" /> Download plan (CSV)</button>}
    </Modal>
  );
}

/** One agent hub: every product, with the numbers behind its status. */
export function HubPanel({ locationId, ctx, onClose }: { locationId: string; ctx: IntelCtx; onClose: () => void }) {
  const hub = ctx.data.hubs.find((h) => h.locationId === locationId);
  const list = ctx.rows.filter((r) => r.locationId === locationId);
  if (!hub) return null;
  return (
    <SidePanel title={hub.agentName} subtitle={`${hubPlace(hub)} · restocked from ${list[0]?.primarySource ?? "Main warehouse"}`} onClose={onClose}>
      {list.length === 0 ? <p className="text-[13px] text-gray-500">No stock, sales or orders for this agent right now.</p> : list.map((row) => (
        <div key={row.key} className="mb-3 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
          <div className="flex items-center justify-between gap-2"><b className="text-[13px]">{ctx.productName(row.productId)}</b><StatusPill status={row.status} /></div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
            {([
              ["On the shelf", units(row.onShelf)], ["Promised to open orders", units(row.reserved)], ["Free to sell", units(row.usable)], ["On the way", units(row.inTransit)],
              ["Delivered (last " + ctx.windowDays + " days)", units(row.delivered)], ["Sells a day", one(row.speed)], ["Days left", daysText(row.daysLeft)],
              ["Delivery streak", `${row.streak} days`], ["Lead time", `${one(row.leadDays)} days (${row.leadSource === "set" ? "set by Owner" : row.leadSource === "measured" ? "from past waybills" : "standard"})`],
              ["Safety stock", `${nf(row.safetyUnits)} (${one(row.safetyDays)} days)`], ["Send", units(row.restock)], ["Orders at risk", nf(row.atRiskOrders)],
              ["Damaged / missing", units(row.defective + row.missing)]
            ] as Array<[string, string]>).map(([k, v]) => <div key={k} className="contents"><dt className="text-gray-500">{k}</dt><dd className="m-0 text-right font-semibold">{v}</dd></div>)}
          </dl>
          {row.restock > 0 && ctx.canCreateTransfer && <button type="button" onClick={() => ctx.openPlan(row)} className="!min-h-0 mt-2 h-8 w-full rounded-lg bg-[#1F8FE0] text-[12px] font-semibold text-white">Plan Restock</button>}
        </div>
      ))}
    </SidePanel>
  );
}

/** Owner: lead time and safety stock for one agent hub (blank = measured / standard). */
export function SettingsModal({ locationId, ctx, onClose }: { locationId: string; ctx: IntelCtx; onClose: () => void }) {
  const hub = ctx.data.hubs.find((h) => h.locationId === locationId);
  const saved = ctx.data.settings.find((s) => s.locationId === locationId && s.productId === null);
  const measured = ctx.rows.find((r) => r.locationId === locationId);
  const [lead, setLead] = useState(saved?.leadTimeDays != null ? String(saved.leadTimeDays) : "");
  const [safety, setSafety] = useState(saved?.safetyDays != null ? String(saved.safetyDays) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    const leadTimeDays = lead.trim() === "" ? null : Number(lead);
    const safetyDays = safety.trim() === "" ? null : Number(safety);
    if (leadTimeDays !== null && !(leadTimeDays > 0 && leadTimeDays <= 60)) { setError("Lead time must be between 0.5 and 60 days."); return; }
    if (safetyDays !== null && !(safetyDays >= 0 && safetyDays <= 30)) { setError("Safety stock must be between 0 and 30 days."); return; }
    setBusy(true); setError("");
    try { await stockIntelApi.saveSetting({ locationId, productId: null, leadTimeDays, safetyDays }); ctx.reload(); onClose(); }
    catch (err: any) { setError(err?.message ?? "Could not save."); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Lead time & safety stock — ${hub?.agentName ?? "Agent"}`} sub="Leave a box empty to use the measured or standard figure." onClose={onClose}>
      <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">
        Now: lead time <b>{one(measured?.leadDays ?? 4)} days</b> ({measured?.leadSource === "set" ? "set by you" : measured?.leadSource === "measured" ? "from this agent's past waybills" : "standard 4 days — no received waybills yet"}),
        safety stock <b>{one(measured?.safetyDays ?? 2)} days</b> of sales.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-[12px] font-semibold">Lead time (days)<input type="number" min={0.5} max={60} step={0.5} value={lead} onChange={(e) => setLead(e.target.value)} placeholder="Measured" className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-[13px] dark:border-slate-700 dark:bg-slate-950" /></label>
        <label className="text-[12px] font-semibold">Safety stock (days of sales)<input type="number" min={0} max={30} step={0.5} value={safety} onChange={(e) => setSafety(e.target.value)} placeholder="2" className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-[13px] dark:border-slate-700 dark:bg-slate-950" /></label>
      </div>
      {error && <p className="m-0 mt-2 text-[12px] font-semibold text-rose-600">{error}</p>}
      {ctx.canEdit ? (
        <button type="button" disabled={busy} onClick={save} className="!min-h-0 mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#1F8FE0] text-[13px] font-semibold text-white disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
      ) : <p className="m-0 mt-3 text-[12px] text-gray-500">Only the Owner can change these.</p>}
    </Modal>
  );
}

/** Owner: where each state's restock comes from (first choice + fallback). */
export function RoutesModal({ ctx, onClose }: { ctx: IntelCtx; onClose: () => void }) {
  const general = ctx.data.routes.filter((r) => r.productId === null);
  const states = [...new Set([...ctx.data.hubs.map((h) => h.state), ...general.map((r) => r.destState)])].filter(Boolean).sort();
  const hubStates = [...new Set(ctx.data.hubs.map((h) => h.state))].sort();
  const initial = Object.fromEntries(states.map((s) => {
    const list = general.filter((r) => r.destState === s).sort((a, b) => a.priority - b.priority);
    return [s, [list[0]?.sourceState ?? "", list[1] ? (list[1].sourceState ?? "") : "none"]];
  })) as Record<string, [string, string]>;
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = (dest: string) => [{ value: "", label: "Main warehouse" }, ...hubStates.filter((s) => s !== dest).map((s) => ({ value: s, label: `${place(s)} hub` }))];
  const save = async () => {
    setBusy(true); setError("");
    try {
      for (const state of states) {
        const [first, second] = draft[state];
        if (first === initial[state][0] && second === initial[state][1]) continue;
        const sources: Array<string | null> = [first || null];
        if (second !== "none" && second !== first) sources.push(second || null);
        await stockIntelApi.saveRoute({ destState: state, productId: null, sources });
      }
      ctx.reload(); onClose();
    } catch (err: any) { setError(err?.message ?? "Could not save."); } finally { setBusy(false); }
  };
  const sel = "h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-[12.5px] dark:border-slate-700 dark:bg-slate-950";
  return (
    <Modal wide title="Supply routes" sub="Where each state's restock comes from. Orders still go only to agents in their own state — this only decides where stock is sent from." onClose={onClose}>
      <table className="w-full !min-w-0 text-[12.5px]">
        <thead><tr className="text-left text-[11px] font-semibold text-gray-500"><th className="py-1.5">State</th><th>Restocked from</th><th>Fallback</th></tr></thead>
        <tbody>
          {states.map((state) => (
            <tr key={state} className="border-t border-gray-100 dark:border-slate-800">
              <td className="py-1.5 font-semibold">{place(state)}</td>
              <td className="pr-2"><select disabled={!ctx.canEdit} className={sel} value={draft[state][0]} onChange={(e) => setDraft({ ...draft, [state]: [e.target.value, draft[state][1]] })}>{options(state).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></td>
              <td><select disabled={!ctx.canEdit} className={sel} value={draft[state][1]} onChange={(e) => setDraft({ ...draft, [state]: [draft[state][0], e.target.value] })}><option value="none">None</option>{options(state).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="m-0 mt-2 text-[12px] font-semibold text-rose-600">{error}</p>}
      {ctx.canEdit ? <button type="button" disabled={busy} onClick={save} className="!min-h-0 mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#1F8FE0] text-[13px] font-semibold text-white disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save routes</button>
        : <p className="m-0 mt-3 text-[12px] text-gray-500">Only the Owner can change routes.</p>}
    </Modal>
  );
}
