import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowLeftRight, ArrowUp, Check, CheckCircle2, ChevronRight, Clock, Lightbulb, PackageCheck, Truck, Undo2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { StockIntelWaybill } from "../../../lib/api";
import { Donut, SelectBox, SidePanel, nf } from "../parts";
import { Card, CardHead, ColumnsMenu, ProductSwitch, RowMenu, SearchBox, csv, one, units, type IntelCtx } from "./shared";

// Stock Movements (Bright's design): waybills of the period as movements.
// Inbound = from the main warehouse to an agent hub; Outbound = from one agent
// hub to another. Damaged (Defective) and Missing waybills are the
// discrepancies. Read-only: waybills are created and received on the Waybill page.

type Kind = "Inbound" | "Outbound";
type Stage = "Received" | "In Transit" | "Discrepancy" | "Returned" | "Cancelled";
export type Movement = StockIntelWaybill & { kind: Kind; stage: Stage; qty: number; day: string };

const stageOf = (status: string): Stage => status === "Received" ? "Received" : status === "In Transit" ? "In Transit" : status === "Defective" || status === "Missing" ? "Discrepancy" : status === "Returned" ? "Returned" : "Cancelled";
const addDays = (key: string, n: number) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const longDate = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const shortDate = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const pct = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);
const counted = (m: Movement) => m.stage !== "Cancelled" && m.stage !== "Returned";

export function movementFigures(ctx: IntelCtx) {
  const today = ctx.data.today;
  const from = addDays(today, -(ctx.windowDays - 1));
  const prevFrom = addDays(from, -ctx.windowDays);
  const all: Movement[] = ctx.data.waybills.map((w) => ({
    ...w, kind: w.fromLocationId ? "Outbound" : "Inbound", stage: stageOf(w.status),
    qty: w.items.reduce((s, i) => s + i.quantity, 0), day: (w.dispatched ?? w.createdAt.slice(0, 10))
  }));
  const current = all.filter((m) => m.stage === "In Transit" || m.day >= from);
  const previous = all.filter((m) => m.day >= prevFrom && m.day < from);
  const sum = (list: Movement[], test: (m: Movement) => boolean) => list.filter(test).reduce((s, m) => s + m.qty, 0);
  const figures = (list: Movement[]) => ({
    total: sum(list, counted),
    inboundReceived: sum(list, (m) => m.kind === "Inbound" && m.stage === "Received"),
    outboundReceived: sum(list, (m) => m.kind === "Outbound" && m.stage === "Received"),
    outboundSent: sum(list, (m) => m.kind === "Outbound" && counted(m)),
    inTransit: sum(list, (m) => m.stage === "In Transit"),
    received: sum(list, (m) => m.stage === "Received"),
    discrepancy: sum(list, (m) => m.stage === "Discrepancy")
  });
  const now = figures(current), before = figures(previous);
  const pendingPlans = ctx.data.decisions.filter((d) => d.status === "proposed" || d.status === "approved");
  return {
    all, current, now, before,
    transitWaybills: current.filter((m) => m.stage === "In Transit").length,
    discrepancyWaybills: current.filter((m) => m.stage === "Discrepancy").length,
    receiptRate: now.received + now.discrepancy > 0 ? (now.received / (now.received + now.discrepancy)) * 100 : null,
    pending: { plans: pendingPlans.length, units: pendingPlans.reduce((s, d) => s + d.units, 0) },
    deltas: { total: pct(now.total, before.total), inbound: pct(now.inboundReceived, before.inboundReceived), outbound: pct(now.outboundSent, before.outboundSent) }
  };
}

const COLS = { date: "Date", ref: "Waybill / Ref.", type: "Movement Type", from: "From", to: "To (Agent / State)", product: "Product", qty: "Quantity", status: "Status", when: "Expected / Received" } as const;
type Col = keyof typeof COLS;
type Chip = "all" | "Inbound" | "Outbound" | "In Transit" | "Discrepancy";

export function MovementsView({ ctx }: { ctx: IntelCtx }) {
  const f = useMemo(() => movementFigures(ctx), [ctx]);
  const [chip, setChip] = useState<Chip>("all");
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState("all");
  const [status, setStatus] = useState("all");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Movement | null>(null);
  const [cols, setCols] = useState<Record<Col, boolean>>({ date: true, ref: true, type: true, from: true, to: true, product: true, qty: true, status: true, when: true });
  const leadOf = useMemo(() => new Map(ctx.rows.map((r) => [r.locationId, r.leadDays])), [ctx.rows]);
  const eta = (m: Movement) => addDays(m.dispatched ?? m.createdAt.slice(0, 10), Math.ceil((m.toLocationId && leadOf.get(m.toLocationId)) || 4));

  const list = [...f.current].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((m) => chip === "all" || (chip === "Inbound" || chip === "Outbound" ? m.kind === chip : m.stage === chip))
    .filter((m) => product === "all" || m.items.some((i) => i.productId === product))
    .filter((m) => status === "all" || m.stage === status)
    .filter((m) => { const q = search.trim().toLowerCase(); return !q || `${m.id} ${m.fromLabel} ${m.toLabel} ${m.items.map((i) => i.productName).join(" ")}`.toLowerCase().includes(q); });
  const count = (c: Chip) => f.current.filter((m) => c === "all" || (c === "Inbound" || c === "Outbound" ? m.kind === c : m.stage === c)).length;

  const total = f.now.total;
  const share = (v: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : "0%");
  const donut = [
    { label: "Received (Inbound)", value: f.now.inboundReceived, color: "#22c55e" },
    { label: "Sent (Outbound)", value: f.now.outboundReceived, color: "#3b82f6" },
    { label: "In Transit", value: f.now.inTransit, color: "#f59e0b" },
    { label: "Discrepancy", value: f.now.discrepancy, color: "#ef4444" }
  ];
  const flow = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(ctx.data.today, i - 6);
    const onDay = f.all.filter((m) => m.day === day && counted(m));
    return { day: shortDate(day), inbound: onDay.filter((m) => m.kind === "Inbound").reduce((s, m) => s + m.qty, 0), outbound: onDay.filter((m) => m.kind === "Outbound").reduce((s, m) => s + m.qty, 0) };
  });
  const discrepancies = f.current.filter((m) => m.stage === "Discrepancy");
  const transit = f.current.filter((m) => m.stage === "In Transit").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const transitAgents = new Set(transit.map((m) => m.toLocationId ?? m.toLabel)).size;

  const exportRows = () => csv("stock-movements", [["Date", "Waybill", "Type", "From", "To", "Products", "Quantity", "Status", "Expected / received"],
    ...list.map((m) => [m.day, m.id, m.kind, m.fromLabel, m.toLabel, m.items.map((i) => `${i.productName} x${i.quantity}`).join("; "), m.qty, m.status, m.stage === "Received" ? m.received ?? "" : m.stage === "In Transit" ? `ETA ${eta(m)}` : ""])]);
  useEffect(() => { ctx.exportRef.current = exportRows; });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="m-0 flex items-center gap-1.5 text-[20px] font-black tracking-tight text-gray-900 dark:text-slate-50">Stock Movements <span title="Waybills of the period. Create and receive waybills on the Waybill page." className="cursor-help text-[13px] text-gray-300">ⓘ</span></h2>
        <p className="m-0 mt-0.5 text-[12.5px] text-gray-500">Track all stock transfers, waybills, receipts, and movements between warehouse, hubs, and agents.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1.1fr)]">
        <Card className="p-4">
          <h3 className="m-0 text-[14px] font-bold">Movement Summary</h3>
          <div className="mt-3 flex items-center gap-4">
            <Donut slices={donut} center={nf(total)} sub="Units moved" size={128} />
            <ul className="m-0 flex-1 list-none space-y-2 p-0 text-[12px]">
              {donut.map((d) => <li key={d.label} className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: d.color }} /><span className="flex-1">{d.label}</span><b>{nf(d.value)}</b><span className="w-10 text-right text-gray-500">({share(d.value)})</span></li>)}
            </ul>
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="m-0 text-[14px] font-bold">Stock Flow Trend <span className="font-semibold text-gray-500">(Units)</span></h3>
          <div className="mt-1 h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={flow} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip formatter={(v: number, n: string) => [`${nf(v)} units`, n === "inbound" ? "Inbound" : "Outbound"]} />
                <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: 11, top: -4 }} formatter={(v) => (v === "inbound" ? "Inbound" : "Outbound")} />
                <Bar dataKey="inbound" fill="#22c55e" radius={[3, 3, 0, 0]} barSize={11} />
                <Bar dataKey="outbound" fill="#3b82f6" radius={[3, 3, 0, 0]} barSize={11} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="m-0 text-[14px] font-bold">Stock Movement Status</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              [Clock, "Pending", nf(f.pending.plans), f.pending.plans ? `${units(f.pending.units)} planned` : "no plans", "bg-gray-50 text-gray-600 dark:bg-slate-800"],
              [Truck, "In Transit", nf(f.now.inTransit), `(${share(f.now.inTransit)})`, "bg-blue-50 text-blue-600 dark:bg-blue-500/10"],
              [CheckCircle2, "Received", nf(f.now.received), `(${share(f.now.received)})`, "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"],
              [AlertTriangle, "Discrepancy", nf(f.now.discrepancy), `(${share(f.now.discrepancy)})`, "bg-rose-50 text-rose-600 dark:bg-rose-500/10"]
            ] as Array<[typeof Clock, string, string, string, string]>).map(([Icon, label, value, foot, tone]) => (
              <div key={label} className={`flex flex-col items-center rounded-xl px-2 py-3 text-center ${tone}`} title={label === "Pending" ? "Stock Recommendation plans sent or approved, not yet finished" : undefined}>
                <Icon className="h-5 w-5" /><div className="mt-1 text-[12px] font-semibold text-gray-700 dark:text-slate-300">{label}</div>
                <div className="text-[20px] font-black text-gray-900 dark:text-slate-50">{value}</div><div className="text-[11px]">{foot}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-slate-800">
          <div className="flex flex-wrap gap-1 rounded-xl border border-gray-200 p-1 dark:border-slate-700">
            {([["all", "All Movements", ArrowDown], ["Inbound", "Inbound", ArrowDown], ["Outbound", "Outbound", ArrowUp], ["In Transit", "In Transit", Truck], ["Discrepancy", "Discrepancy", AlertTriangle]] as Array<[Chip, string, typeof Truck]>).map(([key, label, Icon]) => (
              <button key={key} type="button" onClick={() => setChip(key)} className={`!min-h-0 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold ${chip === key ? "bg-[#1F8FE0] text-white" : "text-gray-700 hover:bg-gray-50 dark:text-slate-300"}`}>
                <Icon className={`h-3.5 w-3.5 ${chip === key ? "" : key === "Inbound" ? "text-emerald-600" : key === "Outbound" ? "text-violet-600" : key === "In Transit" ? "text-orange-500" : key === "Discrepancy" ? "text-rose-500" : ""}`} />{label} ({count(key)})
              </button>
            ))}
          </div>
          <div className="w-full sm:w-[230px]"><SearchBox value={search} onChange={setSearch} placeholder="Search waybill, agent or product..." /></div>
          <div className="w-[160px]"><SelectBox label="Product" value={product} onChange={setProduct} options={[{ value: "all", label: "All Products" }, ...ctx.data.products.filter((p) => f.current.some((m) => m.items.some((i) => i.productId === p.id))).map((p) => ({ value: p.id, label: p.name }))]} /></div>
          <div className="w-[140px]"><SelectBox label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All Status" }, ...(["Received", "In Transit", "Discrepancy", "Returned", "Cancelled"] as Stage[]).map((s) => ({ value: s, label: s }))]} /></div>
          <ColumnsMenu labels={COLS} shown={cols} setShown={setCols} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full !min-w-[1150px] text-[12.5px]">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[11px] font-semibold text-gray-700 dark:border-slate-800 dark:text-slate-300">
                <th className="px-4 py-3">#</th>{cols.date && <th>Date</th>}{cols.ref && <th>Waybill / Ref.</th>}{cols.type && <th>Movement Type</th>}{cols.from && <th>From</th>}{cols.to && <th>To (Agent / State)</th>}
                {cols.product && <th>Product</th>}{cols.qty && <th>Quantity</th>}{cols.status && <th>Status</th>}{cols.when && <th>Expected / Received</th>}<th className="pr-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map((m, i) => {
                const item = m.items.find((it) => it.productId === picked[m.id]) ?? m.items[0];
                return (
                  <tr key={m.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                    <td className="px-4 py-2.5 text-gray-500">{i + 1}</td>
                    {cols.date && <td className="whitespace-nowrap">{longDate(m.day)}</td>}
                    {cols.ref && <td className="whitespace-nowrap font-bold">{m.id}</td>}
                    {cols.type && <td><KindPill kind={m.kind} /></td>}
                    {cols.from && <td className="max-w-[160px] truncate" title={m.fromLabel}>{m.fromLabel}</td>}
                    {cols.to && <td className="max-w-[170px] truncate" title={m.toLabel}>{m.toLabel}</td>}
                    {cols.product && <td>{item ? <ProductSwitch value={item.productId} options={m.items.map((it) => ({ value: it.productId, label: it.productName || ctx.productName(it.productId) }))} onChange={(p) => setPicked((x) => ({ ...x, [m.id]: p }))} /> : "—"}</td>}
                    {cols.qty && <td className="whitespace-nowrap font-semibold">{units(item?.quantity ?? m.qty)}</td>}
                    {cols.status && <td><StagePill stage={m.stage} /></td>}
                    {cols.when && <td className="whitespace-nowrap">{m.stage === "Received" ? <>Received: {m.received ? longDate(m.received) : "—"}</> : m.stage === "In Transit" ? <>ETA: {longDate(eta(m))}</> : m.stage === "Discrepancy" ? <span className="font-semibold text-rose-600">{m.status}: {units(m.qty)}</span> : m.status}</td>}
                    <td className="pr-4"><div className="flex items-center justify-center gap-2">
                      <button type="button" onClick={() => setOpen(m)} className={`!min-h-0 h-8 w-[70px] rounded-lg text-[12px] font-semibold ${m.stage === "In Transit" ? "bg-[#1F8FE0] text-white" : "border border-blue-200 text-[#1F8FE0] hover:bg-blue-50"}`}>{m.stage === "In Transit" ? "Track" : "View"}</button>
                      <RowMenu items={[{ label: "View details", onClick: () => setOpen(m) }, { label: "View receiving agent", onClick: () => m.toLocationId && ctx.openHub(m.toLocationId), hidden: !m.toLocationId }]} />
                    </div></td>
                  </tr>
                );
              })}
              {list.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-gray-500">No movements in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="p-4">
          <CardHead Icon={AlertTriangle} tone="bg-rose-50 text-rose-500" title="Recent Discrepancies"
            action={<button type="button" onClick={() => setChip("Discrepancy")} className="!min-h-0 inline-flex items-center text-[12px] font-semibold text-[#1F8FE0]">View All ({discrepancies.length}) <ChevronRight className="h-4 w-4" /></button>} />
          <table className="mt-2 w-full !min-w-0 text-[12px]">
            <thead><tr className="text-left text-[11px] text-gray-600"><th className="py-1.5">Waybill</th><th>Route</th><th>Product</th><th className="text-right">Sent</th><th className="text-right">Received</th><th className="text-right">Shortage</th></tr></thead>
            <tbody>
              {discrepancies.slice(0, 4).map((m) => (
                <tr key={m.id} className="border-t border-gray-100 dark:border-slate-800">
                  <td className="whitespace-nowrap py-1.5 pr-2 font-semibold">{m.id}</td><td className="max-w-[120px] truncate" title={`${m.fromLabel} → ${m.toLabel}`}>{short(m.fromLabel)} → {short(m.toLabel)}</td>
                  <td className="max-w-[110px] truncate">{m.items.map((i) => i.productName).join(", ")}</td><td className="text-right">{nf(m.qty)}</td><td className="text-right">0</td><td className="text-right font-bold text-rose-600">-{nf(m.qty)}</td>
                </tr>
              ))}
              {discrepancies.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-gray-500">No damaged or missing waybills.</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card className="p-4">
          <CardHead Icon={Truck} title={<>Active Waybills <span className="text-[13px] font-semibold text-gray-500">(In Transit)</span></>}
            action={<button type="button" onClick={() => setChip("In Transit")} className="!min-h-0 inline-flex items-center text-[12px] font-semibold text-[#1F8FE0]">View All ({transit.length}) <ChevronRight className="h-4 w-4" /></button>} />
          {transit.length === 0 ? <p className="m-0 py-6 text-center text-[12.5px] text-gray-500">Nothing on the way.</p> : transit.slice(0, 1).map((m) => (
            <div key={m.id} className="mt-2">
              <div className="text-[13px] font-bold">{m.id} — {m.fromLabel} → {m.toLabel}</div>
              <Stepper m={m} />
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-gray-600"><span>Product: <b className="text-gray-900 dark:text-slate-100">{m.items.map((i) => i.productName).join(", ")}</b></span><span>Qty: <b className="text-gray-900 dark:text-slate-100">{units(m.qty)}</b></span><span>ETA: <b className="text-gray-900 dark:text-slate-100">{longDate(eta(m))}</b></span></div>
            </div>
          ))}
        </Card>
        <Card className="p-4">
          <CardHead Icon={Lightbulb} tone="bg-violet-50 text-violet-600" title="Key Insight" />
          <ul className="m-0 mt-2 list-none space-y-2 p-0 text-[12.5px] text-gray-700 dark:text-slate-300">
            <li className="flex gap-2"><Truck className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />{units(f.now.inTransit)} {f.now.inTransit === 1 ? "is" : "are"} in transit to {transitAgents} agent{transitAgents === 1 ? "" : "s"}.</li>
            <li className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />{f.discrepancyWaybills} waybill{f.discrepancyWaybills === 1 ? " has" : "s have"} damaged or missing stock (total shortfall: {units(f.now.discrepancy)}).</li>
            <li className="flex gap-2"><PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />{units(f.now.received)} received and added to agent stock{f.receiptRate !== null ? ` (${Math.round(f.receiptRate)}% receipt rate)` : ""}.</li>
          </ul>
        </Card>
      </div>

      {open && <WaybillPanel m={open} eta={eta(open)} ctx={ctx} onClose={() => setOpen(null)} />}
    </div>
  );
}

const short = (label: string) => label.replace(/\s*\(.*\)$/, "").split(" ")[0];

function KindPill({ kind }: { kind: Kind }) {
  return kind === "Inbound"
    ? <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><ArrowDown className="h-3.5 w-3.5" />Inbound</span>
    : <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-violet-50 px-2 py-0.5 text-[11.5px] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><ArrowUp className="h-3.5 w-3.5" />Outbound</span>;
}
function StagePill({ stage }: { stage: Stage }) {
  const map: Record<Stage, [string, typeof Check]> = {
    Received: ["bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", CheckCircle2], "In Transit": ["bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300", Truck],
    Discrepancy: ["bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300", AlertTriangle], Returned: ["bg-gray-100 text-gray-600", Undo2], Cancelled: ["bg-gray-100 text-gray-500", ArrowLeftRight]
  };
  const [tone, Icon] = map[stage];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${tone}`}><Icon className="h-3.5 w-3.5" />{stage}</span>;
}

/** Prepared → Dispatched → In Transit → Received. A waybill is prepared and dispatched when it is created. */
function Stepper({ m }: { m: Movement }) {
  const steps = ["Prepared", "Dispatched", "In Transit", "Received"];
  const at = m.stage === "Received" ? 3 : m.stage === "In Transit" ? 2 : 1;
  return (
    <div className="mt-3 flex items-start">
      {steps.map((s, i) => (
        <div key={s} className="flex flex-1 flex-col items-center">
          <div className="flex w-full items-center">
            <span className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : i <= at ? "bg-[#1F8FE0]" : "bg-gray-200"}`} />
            <span className={`h-4 w-4 shrink-0 rounded-full border-[3px] ${i < at ? "border-[#1F8FE0] bg-white" : i === at ? "border-[#1F8FE0] bg-[#1F8FE0]" : "border-gray-300 bg-white"}`} />
            <span className={`h-0.5 flex-1 ${i === steps.length - 1 ? "opacity-0" : i < at ? "bg-[#1F8FE0]" : "bg-gray-200"}`} />
          </div>
          <span className={`mt-1 text-[11.5px] ${i === at ? "font-bold text-[#1F8FE0]" : "text-gray-600"}`}>{s}</span>
        </div>
      ))}
    </div>
  );
}

function WaybillPanel({ m, eta, ctx, onClose }: { m: Movement; eta: string; ctx: IntelCtx; onClose: () => void }) {
  return (
    <SidePanel title={m.id} subtitle={`${m.kind} · ${m.fromLabel} → ${m.toLabel}`} onClose={onClose}>
      <StagePill stage={m.stage} />
      {m.stage !== "Cancelled" && m.stage !== "Returned" && <Stepper m={m} />}
      <dl className="mt-4 grid grid-cols-2 gap-y-1.5 text-[12.5px]">
        {([["Created", longDate(m.createdAt.slice(0, 10))], ["Dispatched", m.dispatched ? longDate(m.dispatched) : "—"],
          [m.stage === "In Transit" ? "Expected" : "Received", m.stage === "In Transit" ? longDate(eta) : m.received ? longDate(m.received) : "—"],
          ["Status", m.status]] as Array<[string, string]>).map(([k, v]) => <div key={k} className="contents"><dt className="text-gray-500">{k}</dt><dd className="m-0 text-right font-semibold">{v}</dd></div>)}
      </dl>
      <h4 className="mb-1 mt-4 text-[12.5px] font-bold">Products</h4>
      <ul className="m-0 list-none space-y-1 p-0 text-[12.5px]">{m.items.map((i) => <li key={i.productId} className="flex justify-between border-b border-gray-100 py-1 dark:border-slate-800"><span>{i.productName || ctx.productName(i.productId)}</span><b>{nf(i.quantity)}</b></li>)}</ul>
      {m.stage === "In Transit" && <p className="mt-3 text-[11.5px] text-gray-500">ETA = dispatch date + the receiving agent's lead time ({one((m.toLocationId && ctx.rows.find((r) => r.locationId === m.toLocationId)?.leadDays) || 4)} days). Mark it received on the Waybill page.</p>}
    </SidePanel>
  );
}
