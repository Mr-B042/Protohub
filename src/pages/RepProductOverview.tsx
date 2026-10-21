import { useMemo, useState, type ReactNode } from "react";
import { ClipboardList, Lightbulb, Target } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, shortMoney } from "../lib/money-privacy";
import { Avatar, ProductThumb } from "./product-trend/parts";
import { rateTone } from "./RepProductPerformancePage";

// ── Overview tab (Bright's design, 21 Oct 2026) ─────────────────────────────
// Three trend charts, the product and rep overview tables, and three cards of
// findings. Every sentence in the cards is worked out from the figures on
// this page; none names a cause the figures cannot show.

export type OverviewBucket = { label: string; placed: number; delivered: number; revenue: number; net: number };
export type OverviewProduct = { key: string; name: string; image: string | null; isOthers?: boolean; placed: number; delivered: number; cancelled: number; revenue: number; net: number };
export type OverviewRep = { id: string; name: string; placed: number; delivered: number; revenue: number; net: number; bonus: number };

type Props = {
  title: string;
  compare: string;
  buckets: OverviewBucket[];
  products: OverviewProduct[];
  allProducts: OverviewProduct[];
  reps: OverviewRep[];
  total: { placed: number; delivered: number; revenue: number; net: number; bonus: number; pending: number; dispatched: number };
  rate: number | null;
  priorRate: number | null;
  target: number;
  canSeeProfit: boolean;
};

const rateOf = (placed: number, delivered: number) => (placed > 0 ? (delivered / placed) * 100 : null);
const pct = (value: number | null) => (value === null ? "-" : `${Math.round(value)}%`);
const signedMoney = (value: number) => (value < 0 ? `-${money(Math.abs(value))}` : money(value));
const MIN = 5;
type RepSort = "delivered" | "placed" | "rate" | "revenue";

export default function RepProductOverview({ title, compare, buckets, products, allProducts, reps, total, rate, priorRate, target, canSeeProfit }: Props) {
  const [allOpen, setAllOpen] = useState(false);
  const [repSort, setRepSort] = useState<RepSort>("delivered");
  const sortedReps = useMemo(() => [...reps].sort((a, b) =>
    repSort === "placed" ? b.placed - a.placed
    : repSort === "rate" ? (rateOf(b.placed, b.delivered) ?? -1) - (rateOf(a.placed, a.delivered) ?? -1)
    : repSort === "revenue" ? b.revenue - a.revenue
    : b.delivered - a.delivered || b.placed - a.placed), [reps, repSort]);
  const productRows = allOpen ? allProducts : products;
  const chartData = buckets.map((bucket) => ({ ...bucket, rate: bucket.placed > 0 ? Math.round((bucket.delivered / bucket.placed) * 100) : null }));

  // ── Findings ──────────────────────────────────────────────────────────────
  const findings = useMemo(() => {
    const insights: string[] = [], opportunities: string[] = [], actions: string[] = [];
    const real = allProducts.filter((product) => product.placed > 0);
    const judged = real.filter((product) => product.placed >= MIN);
    const byRate = [...judged].sort((a, b) => (rateOf(a.placed, a.delivered) ?? 0) - (rateOf(b.placed, b.delivered) ?? 0));
    const top = [...real].sort((a, b) => b.delivered - a.delivered)[0];
    if (top && total.delivered > 0) insights.push(`${top.name} is the top performing product with ${Math.round((top.delivered / total.delivered) * 100)}% of delivered orders.`);
    if (rate !== null && priorRate !== null && Math.round(rate - priorRate) !== 0) insights.push(`Delivery rate ${rate < priorRate ? "dropped" : "rose"} by ${Math.abs(Math.round(rate - priorRate))} points ${compare.replace(/^vs /, "compared to ")}.`);
    const worst = byRate[0];
    if (worst && byRate.length > 1) insights.push(`${worst.name} has the lowest delivery rate (${pct(rateOf(worst.placed, worst.delivered))})${canSeeProfit && worst.net < 0 ? " and is making a loss" : ""}.`);
    const repJudged = reps.filter((rep) => rep.placed >= MIN);
    const bestRep = [...repJudged].sort((a, b) => (rateOf(b.placed, b.delivered) ?? 0) - (rateOf(a.placed, a.delivered) ?? 0))[0];
    if (bestRep) insights.push(`${bestRep.name} has the highest delivery rate (${pct(rateOf(bestRep.placed, bestRep.delivered))}) with ${money(bestRep.revenue)} delivered revenue.`);
    const bestAov = [...real].filter((product) => product.delivered >= 2).sort((a, b) => b.revenue / b.delivered - a.revenue / a.delivered)[0];
    if (bestAov) insights.push(`${bestAov.name} has the highest delivered order value (${money(bestAov.revenue / bestAov.delivered)}).`);

    const belowTarget = byRate.filter((product) => (rateOf(product.placed, product.delivered) ?? 100) < target).slice(0, 2);
    if (belowTarget.length) opportunities.push(`Focus on improving the delivery rate for ${belowTarget.map((p) => p.name).join(" and ")}.`);
    if (bestAov) opportunities.push(`Push upsell and cross-sell on ${bestAov.name}: it brings the highest value per delivered order.`);
    const weakReps = repJudged.filter((rep) => (rateOf(rep.placed, rep.delivered) ?? 100) < 40);
    if (weakReps.length) opportunities.push(`Review calls and order confirmations with ${weakReps.map((rep) => rep.name).join(", ")} (delivery rate below 40%).`);
    if (bestRep && worst && byRate.length > 1) opportunities.push(`Ask ${bestRep.name} to share how they confirm orders with the rest of the team.`);

    if (total.pending + total.dispatched > 0) actions.push(`Follow up on ${total.pending} pending and ${total.dispatched} dispatched order${total.pending + total.dispatched === 1 ? "" : "s"} still open.`);
    const underTarget = repJudged.filter((rep) => (rateOf(rep.placed, rep.delivered) ?? 100) < target);
    if (underTarget.length) actions.push(`Coach reps below the ${target}% target: ${underTarget.map((rep) => rep.name).join(", ")}.`);
    const cancelHeavy = judged.filter((product) => product.cancelled / product.placed >= 0.1);
    if (cancelHeavy.length) actions.push(`Check why orders are cancelled on ${cancelHeavy.map((p) => p.name).join(", ")} (10% or more cancelled).`);
    const losing = canSeeProfit ? real.filter((product) => product.delivered > 0 && product.net < 0) : [];
    if (losing.length) actions.push(`Review the price and costs of ${losing.map((p) => p.name).join(", ")}: delivered orders made a loss.`);
    return { insights, opportunities, actions };
  }, [allProducts, reps, total, rate, priorRate, target, canSeeProfit, compare]);

  const th = "px-1.5 py-2.5 text-[10.5px] font-medium leading-tight text-gray-500 dark:text-slate-400";
  const td = "px-1.5 py-2.5 text-center text-[12px] text-gray-800 dark:text-slate-200";
  const tone = (placed: number, delivered: number) => `px-1.5 py-2.5 text-center text-[12px] font-bold ${rateTone(rateOf(placed, delivered), placed, target)}`;
  const profitCell = (value: number) => <td className={`px-1.5 py-2.5 text-center text-[12px] font-bold ${canSeeProfit ? (value < 0 ? "text-rose-600" : value > 0 ? "text-emerald-600" : "text-gray-500") : "text-gray-400"}`}>{canSeeProfit ? signedMoney(value) : "—"}</td>;

  return (
    <div className="space-y-4">
      {/* ── Trends ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title={`Orders Trend (${title})`} legend={[["#c4b5fd", "Placed Orders"], ["#7c3aed", "Delivered Orders"]]}>
          <BarChart data={chartData} margin={{ top: 18, right: 4, left: -22, bottom: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="placed" name="Placed" fill="#c4b5fd" radius={[3, 3, 0, 0]}><LabelList dataKey="placed" position="top" fontSize={10} /></Bar>
            <Bar dataKey="delivered" name="Delivered" fill="#7c3aed" radius={[3, 3, 0, 0]}><LabelList dataKey="delivered" position="top" fontSize={10} /></Bar>
          </BarChart>
        </ChartCard>
        <ChartCard title={`Delivery Rate Trend (${title})`}>
          <LineChart data={chartData} margin={{ top: 18, right: 14, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
            <Tooltip formatter={(value: number) => `${value}%`} />
            <Line type="linear" dataKey="rate" name="Delivery rate" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3, fill: "#fff", strokeWidth: 2 }} connectNulls>
              <LabelList dataKey="rate" position="top" fontSize={10} formatter={(value: number | null) => (value === null ? "" : `${value}%`)} />
            </Line>
          </LineChart>
        </ChartCard>
        <ChartCard title={`Revenue & Net Profit Trend (${title})`} legend={[["#3b82f6", "Revenue (Delivered)"], ...(canSeeProfit ? [["#22c55e", "Net Profit"] as [string, string]] : [])]}>
          <BarChart data={chartData} margin={{ top: 18, right: 4, left: -4, bottom: 0 }} barGap={3}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(value: number) => shortMoney(value)} />
            <Tooltip formatter={(value: number) => money(value)} />
            <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[3, 3, 0, 0]}><LabelList dataKey="revenue" position="top" fontSize={9} formatter={(value: number) => (value ? shortMoney(value) : "")} /></Bar>
            {canSeeProfit && <Bar dataKey="net" name="Net profit" fill="#22c55e" radius={[3, 3, 0, 0]}><LabelList dataKey="net" position="top" fontSize={9} formatter={(value: number) => (value ? shortMoney(value) : "")} /></Bar>}
          </BarChart>
        </ChartCard>
      </div>

      {/* ── Two tables ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-2">
        <TableCard title="Product Performance Overview" action={allProducts.length > products.length && (
          <button type="button" onClick={() => setAllOpen((open) => !open)} className="!min-h-0 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-1 text-[12.5px] font-semibold text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">{allOpen ? "Show Top Products" : "View All Products"}</button>
        )}>
          <table className="w-full min-w-[580px] border-collapse">
            <thead><tr className="border-b border-gray-200 dark:border-slate-700">
              {["#", "Product", "Placed Orders", "Delivered", "Delivery Rate", "Delivered AOV", "Revenue (Delivered)", "Net Profit", "Share"].map((label, index) => <th key={label} className={`${th} ${index === 1 ? "text-left" : ""}`}>{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {productRows.map((product, index) => (
                <tr key={product.key}>
                  <td className={`${td} text-gray-500`}>{index + 1}</td>
                  <td className="px-2 py-2"><span className="flex items-center gap-2">
                    {product.isOthers ? <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-[11px] text-gray-500 dark:bg-slate-800">+</span> : <ProductThumb src={product.image} name={product.name} size={28} />}
                    <span className="max-w-[100px] text-[11.5px] font-semibold leading-tight text-gray-900 dark:text-slate-100">{product.name}</span></span></td>
                  <td className={td}>{product.placed}</td>
                  <td className={td}>{product.delivered}</td>
                  <td className={tone(product.placed, product.delivered)}>{pct(rateOf(product.placed, product.delivered))}</td>
                  <td className={`${td} whitespace-nowrap`}>{product.delivered > 0 ? money(product.revenue / product.delivered) : "-"}</td>
                  <td className={`${td} whitespace-nowrap`}>{money(product.revenue)}</td>
                  {profitCell(product.net)}
                  <td className={`${td} font-semibold`}>{total.delivered > 0 ? `${Math.round((product.delivered / total.delivered) * 100)}%` : "-"}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-200 font-bold dark:border-slate-700">
                <td />
                <td className="px-2 py-3 text-left text-[13px] font-bold text-gray-900 dark:text-slate-100">Total</td>
                <td className={`${td} font-bold`}>{total.placed}</td>
                <td className={`${td} font-bold`}>{total.delivered}</td>
                <td className={tone(total.placed, total.delivered)}>{pct(rateOf(total.placed, total.delivered))}</td>
                <td className={`${td} whitespace-nowrap font-bold`}>{total.delivered > 0 ? money(total.revenue / total.delivered) : "-"}</td>
                <td className={`${td} whitespace-nowrap font-bold`}>{money(total.revenue)}</td>
                {profitCell(total.net)}
                <td className={`${td} font-bold`}>100%</td>
              </tr>
            </tbody>
          </table>
        </TableCard>

        <TableCard title="Sales Rep Performance Overview" action={(
          <label className="relative block w-[150px]"><span className="sr-only">Sort reps by</span>
            <select value={repSort} onChange={(event) => setRepSort(event.target.value as RepSort)} className="!min-h-0 h-8 w-full appearance-none rounded-lg border border-gray-200 bg-white px-2.5 text-[12px] text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              <option value="delivered">Delivered Orders</option><option value="placed">Placed Orders</option><option value="rate">Delivery Rate</option><option value="revenue">Revenue</option>
            </select>
          </label>
        )}>
          <table className="w-full min-w-[580px] border-collapse">
            <thead><tr className="border-b border-gray-200 dark:border-slate-700">
              {["#", "Sales Rep", "Placed Orders", "Delivered", "Delivery Rate", "Delivered AOV", "Revenue (Delivered)", "Net Profit", "Rep Bonus"].map((label, index) => <th key={label} className={`${th} ${index === 1 ? "text-left" : ""}`}>{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {sortedReps.map((rep, index) => (
                <tr key={rep.id}>
                  <td className={`${td} text-gray-500`}>{index + 1}</td>
                  <td className="px-2 py-2"><span className="flex items-center gap-2"><Avatar name={rep.name} size={24} /><span className="max-w-[95px] text-[11.5px] font-semibold leading-tight text-gray-900 dark:text-slate-100">{rep.name}</span></span></td>
                  <td className={td}>{rep.placed}</td>
                  <td className={td}>{rep.delivered}</td>
                  <td className={tone(rep.placed, rep.delivered)}>{pct(rateOf(rep.placed, rep.delivered))}</td>
                  <td className={`${td} whitespace-nowrap`}>{rep.delivered > 0 ? money(rep.revenue / rep.delivered) : "-"}</td>
                  <td className={`${td} whitespace-nowrap`}>{money(rep.revenue)}</td>
                  {profitCell(rep.net)}
                  <td className={`${td} whitespace-nowrap font-semibold`}>{money(rep.bonus)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-200 dark:border-slate-700">
                <td />
                <td className="px-2 py-3 text-left text-[13px] font-bold text-gray-900 dark:text-slate-100">Team Total</td>
                <td className={`${td} font-bold`}>{total.placed}</td>
                <td className={`${td} font-bold`}>{total.delivered}</td>
                <td className={tone(total.placed, total.delivered)}>{pct(rateOf(total.placed, total.delivered))}</td>
                <td className={`${td} whitespace-nowrap font-bold`}>{total.delivered > 0 ? money(total.revenue / total.delivered) : "-"}</td>
                <td className={`${td} whitespace-nowrap font-bold`}>{money(total.revenue)}</td>
                {profitCell(total.net)}
                <td className={`${td} whitespace-nowrap font-bold`}>{money(total.bonus)}</td>
              </tr>
            </tbody>
          </table>
        </TableCard>
      </div>

      {/* ── Findings ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <FindingCard icon={<Lightbulb className="h-5 w-5" />} tone="border-violet-200 bg-violet-50/70 dark:border-violet-500/20 dark:bg-violet-500/5" iconTone="bg-violet-100 text-violet-600" dot="bg-violet-500" title="Key Insights" items={findings.insights} />
        <FindingCard icon={<Target className="h-5 w-5" />} tone="border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-emerald-500/5" iconTone="bg-emerald-100 text-emerald-600" dot="bg-emerald-500" title="Opportunities" items={findings.opportunities} />
        <FindingCard icon={<ClipboardList className="h-5 w-5" />} tone="border-blue-200 bg-blue-50/70 dark:border-blue-500/20 dark:bg-blue-500/5" iconTone="bg-blue-100 text-blue-600" dot="bg-blue-500" title="Actions" items={findings.actions} />
      </div>
    </div>
  );
}

function ChartCard({ title, legend, children }: { title: string; legend?: Array<[string, string]>; children: React.ReactElement }) {
  return (
    <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 text-[14.5px] font-bold text-gray-900 dark:text-slate-100">{title}</h2>
        {legend && <div className="flex flex-wrap gap-3 text-[11px] text-gray-600 dark:text-slate-400">{legend.map(([color, label]) => <span key={label} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{label}</span>)}</div>}
      </div>
      <div className="h-[210px]"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
    </section>
  );
}

function TableCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3 px-4 pt-4"><h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-100">{title}</h2>{action}</div>
      <div className="mt-2 overflow-x-auto px-2 pb-2">{children}</div>
    </section>
  );
}

function FindingCard({ icon, tone, iconTone, dot, title, items }: { icon: ReactNode; tone: string; iconTone: string; dot: string; title: string; items: string[] }) {
  return (
    <section className={`flex gap-3 rounded-2xl border p-4 ${tone}`}>
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconTone}`}>{icon}</span>
      <div className="min-w-0">
        <h2 className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-100">{title}</h2>
        {items.length === 0
          ? <p className="m-0 mt-1.5 text-[12.5px] text-gray-500">Nothing stands out for these filters yet.</p>
          : <ul className="m-0 mt-1.5 list-none space-y-1 p-0">{items.map((item) => <li key={item} className="flex gap-2 text-[12.5px] leading-snug text-gray-700 dark:text-slate-300"><span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />{item}</li>)}</ul>}
      </div>
    </section>
  );
}
