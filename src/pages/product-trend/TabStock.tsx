import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, BarChart3, Boxes, CircleCheck, ClipboardCheck, Clock3, Info, PackageCheck, Pencil, ShieldAlert, TrendingUp, Users
} from "lucide-react";
import { ALL, buildStockPlan, figuresFor, growthPct, isDelivered, isOpen, stateLabel, type StockBand, type StockPlan } from "./product-trend-model";
import { Donut, InsightCard, KpiTile, NigeriaMap, Panel, Pill, ProductThumb, SERIES_COLORS, SelectBox, downloadCsv, nf, type MapBin } from "./parts";
import { td, th } from "./DetailPanels";
import { mapKey, type TabCtx } from "./tab-context";

// Stock Recommendation (Bright's design, 20 Oct 2026). Shares a product's
// WAREHOUSE stock across states. It recommends; it never moves stock:
// "Approve & Create Transfer" opens the normal Create Waybill form filled in
// for one state, and the transfer only happens when that form is confirmed.

const BAND_TONE: Record<StockBand, "red" | "orange" | "amber" | "green"> = { Critical: "red", High: "orange", Medium: "amber", Low: "green" };
const STATUS_OF: Record<StockBand, { label: string; tone: "red" | "orange" | "amber" | "green" }> = {
  Critical: { label: "Critical", tone: "red" }, High: { label: "Low", tone: "orange" }, Medium: { label: "Medium", tone: "amber" }, Low: { label: "Good", tone: "green" }
};
const unitLegend = (): MapBin[] => [
  { label: "30+ units", color: "#1d4ed8", test: (v) => v !== null && v >= 30 },
  { label: "20 – 29", color: "#3b82f6", test: (v) => v !== null && v >= 20 && v < 30 },
  { label: "10 – 19", color: "#22c55e", test: (v) => v !== null && v >= 10 && v < 20 },
  { label: "5 – 9", color: "#facc15", test: (v) => v !== null && v >= 5 && v < 10 },
  { label: "1 – 4", color: "#fb923c", test: (v) => v !== null && v >= 1 && v < 5 },
  { label: "0", color: "#f87171", test: (v) => v === 0 },
  { label: "No data", color: "#e5e7eb", test: (v) => v === null }
];
const daysPill = (days: number | null) => {
  if (days === null) return <span className="text-gray-400">—</span>;
  const tone = days < 10 ? "bg-rose-50 text-rose-700" : days < 15 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700";
  return <span className={`inline-block rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${tone}`}>{days > 365 ? "365+" : Math.round(days)} days</span>;
};

export function StockRecommendationTab({ ctx, filters }: { ctx: TabCtx; filters?: ReactNode }) {
  const { model, products, hubs, days, money, canSeeProfit } = ctx;
  const netPerUnit = (productId: string) => {
    const f = figuresFor(model.orders.filter((o) => o.productId === productId), model.costs);
    return f.unitsDelivered > 0 ? f.net / f.unitsDelivered : 0;
  };
  // A plan for every product that sold in the period.
  const plans = useMemo(() => {
    const ids = new Set(model.orders.map((o) => o.productId));
    return products.filter((p) => ids.has(p.id)).map((p) => ({
      product: p, plan: buildStockPlan({ orders: model.orders, productId: p.id, hubs, days, available: p.warehouseStock ?? 0, netPerUnit: netPerUnit(p.id) })
    }));
  }, [model, products, hubs, days]); // eslint-disable-line react-hooks/exhaustive-deps

  const needier = [...plans].sort((a, b) => b.plan.rows.reduce((s, r) => s + r.need, 0) - a.plan.rows.reduce((s, r) => s + r.need, 0));
  const [picked, setPicked] = useState<string>(ctx.productId !== ALL ? ctx.productId : "");
  const productId = picked || needier[0]?.product.id || "";
  const product = products.find((p) => p.id === productId);
  const [mapMetric, setMapMetric] = useState<"recommended" | "stock" | "forecast">("recommended");
  const [manual, setManual] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, number> | undefined>(undefined);
  const [sent, setSent] = useState<string[]>([]);

  const plan: StockPlan | null = useMemo(() => product
    ? buildStockPlan({ orders: model.orders, productId: product.id, hubs, days, available: product.warehouseStock ?? 0, netPerUnit: netPerUnit(product.id), overrides })
    : null, [product, model, hubs, days, overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownRows = (plan?.rows ?? []).filter((r) => ctx.stockStatus === ALL || r.priority === ctx.stockStatus);

  // KPIs across every product.
  const totalWithAgents = plans.reduce((s, x) => s + x.plan.totalStock, 0);
  const warehouse = plans.reduce((s, x) => s + (x.product.warehouseStock ?? 0), 0);
  const waiting = plans.reduce((s, x) => s + x.plan.waitingUnits, 0);
  const waitingBefore = model.previous.filter(isOpen).reduce((s, o) => s + o.units, 0);
  const low = plans.reduce((s, x) => s + x.plan.forecastLow, 0);
  const high = plans.reduce((s, x) => s + x.plan.forecastHigh, 0);
  const deliverable = plans.reduce((s, x) => s + x.plan.rows.reduce((t, r) => t + r.deliverable30, 0), 0);
  const cover = deliverable > 0 ? totalWithAgents / (deliverable / 30) : null;
  const needingStates = new Set(plans.flatMap((x) => x.plan.rows.filter((r) => r.priority === "Critical" || r.priority === "High").map((r) => r.state))).size;
  const realloc = plans.reduce((s, x) => s + Math.max(0, x.plan.reallocatable), 0);

  // Map.
  const mapData = Object.fromEntries((plan?.rows ?? []).map((r) => [mapKey(r.state), {
    value: mapMetric === "recommended" ? r.recommended : mapMetric === "stock" ? r.stock : Math.round(r.forecast30),
    tooltip: <div className="space-y-0.5 text-gray-600"><div>Stock with agents: <strong>{nf(r.stock)}</strong></div><div>Waiting units: <strong>{nf(r.waitingUnits)}</strong></div><div>30-day forecast: <strong>{nf(Math.round(r.forecast30))}</strong></div><div>Recommended: <strong>{nf(r.recommended)}</strong></div></div>
  }]));

  // Transfer queue: one waybill per state, highest priority first.
  const queue = (plan?.rows ?? []).filter((r) => r.recommended > 0 && !sent.includes(r.state));
  const next = queue[0];
  const agentFor = (state: string) => {
    const candidates = hubs.filter((h) => h.state === state && h.active);
    const delivered = (agentId: string) => model.orders.filter((o) => o.agentId === agentId && o.productId === productId && o.state === state && isDelivered(o)).length;
    return [...candidates].sort((a, b) => delivered(b.agentId) - delivered(a.agentId))[0];
  };
  const createTransfer = () => {
    if (!next || !product || !ctx.onCreateTransfer) return;
    const hub = agentFor(next.state);
    ctx.onCreateTransfer({ productId: product.id, quantity: next.recommended, toState: next.state, toAgentId: hub?.agentId });
    setSent((s) => [...s, next.state]);
  };

  const slices = (plan?.rows ?? []).filter((r) => r.recommended > 0).map((r, i) => ({ label: stateLabel(r.state), value: r.recommended, color: SERIES_COLORS[i % 5] }));
  const lift = plan && plan.withoutDelivered > 0 ? growthPct(plan.withDelivered, plan.withoutDelivered) : null;

  // Insights from the selected product's plan and the whole picture.
  const rows = plan?.rows ?? [];
  const critical = rows.find((r) => r.priority === "Critical");
  const strong = [...rows].sort((a, b) => b.forecast30 * b.rate - a.forecast30 * a.rate)[0];
  const bestRate = [...rows].filter((r) => r.forecast30 > 0).sort((a, b) => b.rate - a.rate)[0];
  const excess = [...rows].filter((r) => r.coverDays !== null && r.coverDays > 45).sort((a, b) => (b.coverDays ?? 0) - (a.coverDays ?? 0))[0];
  const insights = [
    critical && { Icon: ShieldAlert, tone: "bg-rose-50 text-rose-600", title: `${stateLabel(critical.state)} needs immediate stock`, text: `${nf(Math.round(critical.forecast30))} units forecast in 30 days and ${nf(critical.waitingUnits)} waiting, with only ${nf(critical.stock)} with agents.${critical.coverDays !== null ? ` Runs out in about ${Math.round(critical.coverDays)} days.` : ""}` },
    strong && strong.forecast30 > 0 && { Icon: Clock3, tone: "bg-amber-50 text-amber-600", title: `${stateLabel(strong.state)} has strong demand`, text: `${nf(Math.round(strong.forecast30))} units forecast with a ${strong.rate.toFixed(1)}% delivery rate. Recommended: ${nf(strong.recommended)} units.` },
    bestRate && bestRate.rate > 0 && bestRate !== critical && { Icon: PackageCheck, tone: "bg-emerald-50 text-emerald-600", title: `${stateLabel(bestRate.state)} delivers best`, text: `${bestRate.rate.toFixed(1)}% delivery rate and steady demand.` },
    excess && { Icon: BarChart3, tone: "bg-violet-50 text-violet-600", title: `${stateLabel(excess.state)} has excess stock`, text: `About ${Math.round(excess.coverDays ?? 0)} days of stock. Consider moving some to a busier state.` },
    lift !== null && lift > 0 && { Icon: Users, tone: "bg-blue-50 text-blue-600", title: "Overall stock opportunity", text: `Sending the ${nf(plan!.allocated)} recommended units could raise expected deliveries by ${lift.toFixed(0)}%.` }
  ].filter(Boolean) as Array<{ Icon: typeof BarChart3; tone: string; title: string; text: string }>;

  ctx.exportRef.current = () => downloadCsv(`stock-recommendation-${product?.name ?? "product"}.csv`, [
    ["State", "Stock with agents", "Waiting units", "30-day forecast (units)", "Delivery rate %", "Days of cover", "Recommended units", "Priority"],
    ...rows.map((r) => [stateLabel(r.state), r.stock, r.waitingUnits, Math.round(r.forecast30), r.rate.toFixed(1), r.coverDays === null ? "" : Math.round(r.coverDays), r.recommended, r.priority])
  ]);

  if (plans.length === 0) {
    return <>{filters}<div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-[13px] text-gray-500 shadow-sm">No orders in this period, so there is nothing to plan stock from. Pick a longer date range.</div></>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile Icon={Boxes} tone="bg-blue-50 text-blue-600" label="Total Available Stock" value={`${nf(totalWithAgents + warehouse)} units`} foot={<span>{nf(totalWithAgents)} with agents · {nf(warehouse)} in warehouse</span>} />
        <KpiTile Icon={ClipboardCheck} tone="bg-emerald-50 text-emerald-600" label="Total Confirmed Orders" value={`${nf(waiting)} units`} delta={growthPct(waiting, waitingBefore)} info="Units on orders not yet delivered (customers waiting)." />
        <KpiTile Icon={TrendingUp} tone="bg-blue-50 text-blue-600" label="Estimated 30-Day Demand" value={low === high ? `${nf(low)} units` : `${nf(low)} – ${nf(high)} units`} info="Units likely to be ordered in the next 30 days, at the period's pace and at the last 7 days' pace." />
        <KpiTile Icon={Clock3} tone="bg-amber-50 text-amber-500" label="Stock Coverage" value={cover === null ? "—" : `${Math.round(cover)} days`} foot={<span className="inline-flex items-center gap-1"><Info className="h-3 w-3" />based on forecast</span>} />
        <KpiTile Icon={AlertTriangle} tone="bg-rose-50 text-rose-500" label="States Needing Stock" value={`${needingStates} states`} foot={<span>low stock or high demand</span>} />
        <KpiTile Icon={ArrowLeftRight} tone="bg-emerald-50 text-emerald-600" label="Reallocation Opportunity" value={`${nf(realloc)} units`} foot={<span>can be moved to better states</span>} />
      </div>
      {filters}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.15fr_0.8fr]">
        <Panel title="Stock Demand Heatmap (Recommended Priority)">
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="text-[12px] text-gray-600">Select Product<SelectBox label="Product" className="mt-1" value={productId} onChange={(v) => { setPicked(v); setOverrides(undefined); setManual(false); setSent([]); }} options={plans.map((x) => ({ value: x.product.id, label: x.product.name }))} /></label>
            <label className="text-[12px] text-gray-600">View Metric<SelectBox label="Metric" className="mt-1" value={mapMetric} onChange={setMapMetric} options={[{ value: "recommended", label: "Stock Recommendation" }, { value: "stock", label: "Current Stock" }, { value: "forecast", label: "30-Day Forecast" }]} /></label>
          </div>
          <NigeriaMap data={mapData} zoomable legend={{ title: mapMetric === "recommended" ? "Recommended Units" : mapMetric === "stock" ? "Current Stock" : "30-Day Forecast", bins: unitLegend() }} />
        </Panel>

        <Panel title="Recommended Stock Allocation">
          {product && (
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[14px] font-bold"><ProductThumb src={ctx.imageOf(product.id)} name={product.name} size={30} />{product.name}</span>
              <SelectBox label="Change product" className="w-44" value={productId} onChange={(v) => { setPicked(v); setOverrides(undefined); setManual(false); setSent([]); }} options={plans.map((x) => ({ value: x.product.id, label: `Change: ${x.product.name}` }))} />
            </div>
          )}
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span><strong>We have {nf(plan?.available ?? 0)} units available for allocation</strong> (in the warehouse).<br />Based on demand, delivery performance and current stock levels, here is the recommended allocation.</span>
          </div>
          <div className="overflow-auto">
            <table className="w-full !min-w-[520px] border-separate border-spacing-0">
              <thead><tr><th className={th}>#</th><th className={th}>State</th><th className={th}>Current Stock</th><th className={th} title="Units on orders not yet delivered">Confirmed Orders</th><th className={th}>30-Day Forecast</th><th className={th}>Recommended Units</th><th className={th}>Priority</th></tr></thead>
              <tbody>
                {shownRows.slice(0, 8).map((r, i) => (
                  <tr key={r.state} className="[&>td]:[color:inherit]">
                    <td className={td}>{i + 1}</td><td className={`${td} font-semibold`}>{stateLabel(r.state)}</td><td className={td}>{nf(r.stock)}</td><td className={td}>{nf(r.waitingUnits)}</td><td className={td}>{nf(Math.round(r.forecast30))}</td>
                    <td className={`${td} !bg-emerald-50 text-center font-bold text-emerald-800 dark:!bg-emerald-500/10`}>
                      {manual
                        ? <input type="number" min={0} aria-label={`Units for ${stateLabel(r.state)}`} value={overrides?.[r.state] ?? r.recommended}
                          onChange={(e) => setOverrides({ ...Object.fromEntries((plan?.rows ?? []).map((x) => [x.state, overrides?.[x.state] ?? x.recommended])), [r.state]: Math.max(0, Number(e.target.value) || 0) })}
                          className="!min-h-0 w-16 rounded border border-emerald-300 bg-white px-1 py-0.5 text-center text-[12px]" />
                        : nf(r.recommended)}
                    </td>
                    <td className={td}><Pill tone={BAND_TONE[r.priority]}>{r.priority}</Pill></td>
                  </tr>
                ))}
                {shownRows.length === 0 && <tr><td colSpan={7} className={`${td} py-6 text-center text-gray-400`}>No state matches this stock status.</td></tr>}
                {shownRows.length > 0 && (
                  <tr className="[&>td]:[color:inherit]">
                    <td className={`${td} font-bold`} colSpan={2}>Total</td>
                    <td className={`${td} font-bold`}>{nf(shownRows.reduce((s, r) => s + r.stock, 0))}</td><td className={`${td} font-bold`}>{nf(shownRows.reduce((s, r) => s + r.waitingUnits, 0))}</td>
                    <td className={`${td} font-bold`}>{nf(Math.round(shownRows.reduce((s, r) => s + r.forecast30, 0)))}</td><td className={`${td} text-center font-bold`}>{nf(shownRows.reduce((s, r) => s + r.recommended, 0))}</td><td className={td} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {manual && plan && plan.allocated >= plan.available && <p className="m-0 mt-2 text-[11.5px] text-amber-700">All {nf(plan.available)} warehouse units are allocated - a state further down gets what is left, never more.</p>}
        </Panel>

        <Panel title="Allocation Summary">
          <div className="flex items-center gap-3">
            <Donut slices={slices} center={nf(plan?.allocated ?? 0)} sub="Units" />
            <ul className="m-0 min-w-0 flex-1 list-none space-y-1.5 p-0">
              {slices.slice(0, 6).map((s) => <li key={s.label} className="flex items-center justify-between gap-2 text-[11.5px]"><span className="flex min-w-0 items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} /><span className="truncate">{s.label}</span></span><span className="text-gray-600">{nf(s.value)} ({plan && plan.allocated > 0 ? Math.round((s.value / plan.allocated) * 100) : 0}%)</span></li>)}
              {slices.length === 0 && <li className="text-[12px] text-gray-400">Nothing to send right now.</li>}
            </ul>
          </div>
          <div className="mt-4 space-y-2">
            {ctx.canCreateTransfer && ctx.onCreateTransfer ? (
              <button type="button" disabled={!next} onClick={createTransfer}
                className="!min-h-0 flex w-full items-center justify-center gap-2 rounded-lg bg-[#1F8FE0] px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm hover:bg-[#1a7dc4] disabled:opacity-40">
                <Pencil className="h-4 w-4" /> Approve &amp; Create Transfer <ArrowRight className="h-4 w-4" />
              </button>
            ) : <p className="m-0 rounded-lg bg-gray-50 px-3 py-2 text-[11.5px] text-gray-600">Transfers are created by the Owner, Admins or the inventory team.</p>}
            {next && ctx.canCreateTransfer && <p className="m-0 text-center text-[11px] text-gray-500">Opens the waybill form for <strong>{stateLabel(next.state)} · {nf(next.recommended)} units</strong>. Nothing moves until it is confirmed there.{sent.length > 0 ? ` Done: ${sent.map(stateLabel).join(", ")}.` : ""}</p>}
            <button type="button" onClick={() => { setManual((m) => !m); if (manual) setOverrides(undefined); }}
              className="!min-h-0 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200">
              <Pencil className="h-4 w-4" /> {manual ? "Back to the recommendation" : "Adjust Allocation Manually"}
            </button>
            {ctx.onOpenReplenishment && <button type="button" onClick={ctx.onOpenReplenishment} className="!min-h-0 block w-full text-center text-[11.5px] font-semibold text-[#1F8FE0]">Per-agent detail: Who Needs Stock →</button>}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Top Products Needing Stock">
          <div className="overflow-x-auto"><table className="w-full !min-w-0 border-separate border-spacing-0">
            <thead><tr><th className={th}>#</th><th className={th}>Product</th><th className={th}>Current Stock</th><th className={th}>30-Day Forecast</th><th className={th}>Days Left</th><th className={th}>Recommended</th></tr></thead>
            <tbody>{needier.slice(0, 5).map(({ product: p, plan: pl }, i) => {
              const need = pl.rows.reduce((s, r) => s + r.need, 0);
              return (
                <tr key={p.id} className="cursor-pointer hover:bg-gray-50 [&>td]:[color:inherit]" onClick={() => { setPicked(p.id); setOverrides(undefined); setSent([]); }}>
                  <td className={td}>{i + 1}</td>
                  <td className={td}><span className="flex items-center gap-2"><ProductThumb src={ctx.imageOf(p.id)} name={p.name} size={28} /><span className="max-w-[140px] truncate">{p.name}</span></span></td>
                  <td className={td}>{nf(pl.totalStock)}</td><td className={td}>{nf(Math.round(pl.forecastHigh))}</td><td className={td}>{daysPill(pl.coverDays)}</td>
                  <td className={td}>{need > 0 ? <span className="inline-block rounded-md border border-blue-200 px-2 py-0.5 text-[11.5px] font-semibold text-[#1F8FE0]">+{nf(need)}</span> : "—"}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </Panel>

        <Panel title="State Stock Status for Selected Product">
          <div className="overflow-x-auto"><table className="w-full !min-w-0 border-separate border-spacing-0">
            <thead><tr><th className={th}>#</th><th className={th}>State</th><th className={th}>Current Stock</th><th className={th}>Confirmed Orders</th><th className={th}>30-Day Forecast</th><th className={th}>Stock Cover</th><th className={th}>Status</th></tr></thead>
            <tbody>{shownRows.slice(0, 10).map((r, i) => (
              <tr key={r.state} className="[&>td]:[color:inherit]">
                <td className={`${td} font-bold`} style={{ color: SERIES_COLORS[i % 5] }}>{i + 1}</td><td className={td}>{stateLabel(r.state)}</td><td className={td}>{nf(r.stock)}</td><td className={td}>{nf(r.waitingUnits)}</td>
                <td className={td}>{nf(Math.round(r.forecast30))}</td><td className={td}>{daysPill(r.coverDays)}</td><td className={td}><Pill tone={STATUS_OF[r.priority].tone}>{STATUS_OF[r.priority].label}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>

        <Panel title="Allocation Impact Forecast" info="Next 30 days for the selected product: deliveries are capped by stock in each state.">
          <div className="relative grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-gray-200 p-3 text-center dark:border-slate-700">
              <div className="text-[11px] font-semibold text-gray-500">Without Allocation</div>
              <div className="mt-1 text-[16px] font-black">{nf(plan?.withoutDelivered ?? 0)} units</div><div className="text-[10.5px] text-gray-500">Expected delivered</div>
              {canSeeProfit && <><div className="mt-2 text-[16px] font-black">{money((plan?.withoutDelivered ?? 0) * (plan?.netPerUnit ?? 0))}</div><div className="text-[10.5px] text-gray-500">Expected net profit</div></>}
            </div>
            <ArrowRight className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-[#1F8FE0]" aria-hidden />
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-center dark:border-blue-500/30 dark:bg-blue-500/10">
              <div className="text-[11px] font-semibold text-blue-700">With Allocation</div>
              <div className="mt-1 text-[16px] font-black text-[#1F8FE0]">{nf(plan?.withDelivered ?? 0)} units</div><div className="text-[10.5px] text-gray-500">Expected delivered</div>
              {lift !== null && <div className="text-[11px] font-semibold text-emerald-600">↑ {lift.toFixed(0)}%</div>}
              {canSeeProfit && <><div className="mt-1 text-[16px] font-black text-[#1F8FE0]">{money((plan?.withDelivered ?? 0) * (plan?.netPerUnit ?? 0))}</div><div className="text-[10.5px] text-gray-500">Expected net profit</div></>}
            </div>
          </div>
          <div className="mt-3 text-[12px] font-bold text-gray-800 dark:text-slate-200">Key Assumptions</div>
          <ul className="m-0 mt-1 list-none space-y-1 p-0 text-[11.5px] text-gray-600 dark:text-slate-300">
            {["Based on the period's demand pace", "Using current delivery rates by state", "Considers waiting orders and existing stock with agents", "Assumes normal advertising and operations"].map((t) => <li key={t} className="flex items-center gap-1.5"><CircleCheck className="h-3.5 w-3.5 text-[#1F8FE0]" />{t}</li>)}
          </ul>
        </Panel>
      </div>

      <Panel title="Stock Recommendation Insights">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
          {insights.length === 0 && <p className="m-0 py-4 text-center text-[12px] text-gray-400">Not enough orders for insights yet.</p>}
          {insights.map((item) => <InsightCard key={item.title} Icon={item.Icon} tone={item.tone} title={item.title} text={item.text} />)}
        </div>
      </Panel>
    </div>
  );
}

