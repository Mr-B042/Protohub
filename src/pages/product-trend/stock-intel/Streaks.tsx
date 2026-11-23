import { useEffect, useMemo, useState } from "react";
import { BarChart3, Flame, TrendingUp, Trophy } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Delta, SelectBox, nf } from "../parts";
import {
  AgentCell, Card, CardHead, ColumnsMenu, CreatePlanButton, DaysChip, ExportButton, FigureCard, InsightBar, PatternBars, PlanButton, ProductSwitch, RestockPill, RowMenu,
  SearchBox, StatusPill, StreakChip, csv, one, place, productOptions, rowMenuItems, units, useHubGroups, type IntelCtx
} from "./shared";

const COLS = { product: "Product", delivered: "7-Day Delivery (Units)", streak: "Delivery Streak", pattern: "7-Day Pattern", stock: "Available Stock", days: "Days Left", status: "Stock Status", restock: "Recommended Restock" } as const;
type Col = keyof typeof COLS;
const weekday = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const pctChange = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

export function StreaksView({ ctx }: { ctx: IntelCtx }) {
  const [product, setProduct] = useState("all");
  const [state, setState] = useState("all");
  const [agent, setAgent] = useState("all");
  const [streakMin, setStreakMin] = useState("all");
  const [search, setSearch] = useState("");
  const [cols, setCols] = useState<Record<Col, boolean>>({ product: true, delivered: true, streak: true, pattern: true, stock: true, days: true, status: true, restock: true });

  const base = useMemo(() => ctx.rows.filter((r) => (product === "all" || r.productId === product) && (state === "all" || r.state === state) && (agent === "all" || r.agentId === agent)), [ctx.rows, product, state, agent]);
  const { groups, shown, pick } = useHubGroups(base);
  // Per agent: the product it delivers most of is the headline unless picked.
  const listed = shown
    .map((row, i) => ({ row, list: groups[i] }))
    .filter(({ row }) => streakMin === "all" || (streakMin === "none" ? row.streak === 0 : row.streak >= Number(streakMin)))
    .filter(({ row }) => { const q = search.trim().toLowerCase(); return !q || `${row.agentName} ${row.hubName} ${row.state} ${place(row.state)}`.toLowerCase().includes(q); })
    .sort((a, b) => b.row.streak - a.row.streak || b.row.delivered - a.row.delivered);

  // Figures across agents (best product per agent = its longest streak).
  const perAgent = useMemo(() => groups.map((list) => list.reduce((best, r) => (r.streak > best.streak || (r.streak === best.streak && r.delivered > best.delivered) ? r : best), list[0])), [groups]);
  const active = perAgent.filter((r) => r.streak >= 3);
  const longest = [...perAgent].sort((a, b) => b.streak - a.streak)[0];
  const onStreak = perAgent.filter((r) => r.streak > 0);
  const avg = onStreak.length ? onStreak.reduce((s, r) => s + r.streak, 0) / onStreak.length : 0;
  const before = perAgent.filter((r) => r.streakBefore > 0);
  const avgBefore = before.length ? before.reduce((s, r) => s + r.streakBefore, 0) / before.length : 0;
  const now = base.reduce((s, r) => s + r.delivered, 0), prev = base.reduce((s, r) => s + r.deliveredPrev, 0);
  const growth = pctChange(now, prev);
  const days = ctx.data.result.days.slice(-7);
  const trend = days.map((day, i) => ({ day: weekday(day), units: base.reduce((s, r) => s + (r.daily.slice(-7)[i] ?? 0), 0) }));

  const exportRows = () => csv("delivery-streaks", [["Agent", "State", "Product", "Delivered (units)", "Change %", "Streak (days)", "Per day", "Available", "Days left", "Status", "Restock"],
    ...listed.map(({ row }) => [row.agentName, place(row.state), ctx.productName(row.productId), row.delivered, pctChange(row.delivered, row.deliveredPrev)?.toFixed(0) ?? "", row.streak, row.daily.slice(-7).join(" "), row.usable, row.daysLeft === null ? "" : one(row.daysLeft), row.status, row.restock])]);
  useEffect(() => { ctx.exportRef.current = exportRows; });

  const urgent = listed.map(({ row }) => row).filter((r) => r.streak >= 3 && r.restock > 0 && (r.status === "Critical" || r.status === "Restock Soon")).slice(0, 2);
  const states = [...new Set(ctx.rows.map((r) => r.state))].sort();
  const agents = [...new Map(ctx.rows.map((r) => [r.agentId, r.agentName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <CardHead title="Delivery Streaks" info="A streak counts days in a row with at least one unit delivered. A Sunday with no delivery does not break it. A streak alone never decides a restock: stock, speed, open orders and lead time do." sub="Track agents with consistent deliveries, delivery patterns, and stock health." />
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FigureCard Icon={Flame} tone="text-orange-500" bg="bg-blue-50/70 dark:bg-blue-500/10" label="Active Streaks" value={`${active.length} agent${active.length === 1 ? "" : "s"}`} foot="(Delivered for ≥ 3 days in a row)" />
            <FigureCard Icon={Trophy} tone="text-emerald-600" bg="bg-emerald-50/70 dark:bg-emerald-500/10" label="Longest Streak" value={longest && longest.streak > 0 ? longest.agentName : "—"} foot={longest && longest.streak > 0 ? <span className="text-[18px] font-black text-emerald-600">{longest.streak} days</span> : "No streaks yet"} />
            <FigureCard Icon={BarChart3} tone="text-violet-600" bg="bg-violet-50/70 dark:bg-violet-500/10" label="Avg. Agents Streak" value={`${one(avg)} days`} foot={before.length ? <span className={avg - avgBefore >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-rose-600"}>{avg - avgBefore >= 0 ? "↑ +" : "↓ "}{one(avg - avgBefore)} days</span> : undefined} />
            <FigureCard Icon={TrendingUp} tone="text-rose-500" bg="bg-rose-50/70 dark:bg-rose-500/10" label="Streak Growth" value={growth === null ? "—" : `${growth >= 0 ? "+" : ""}${growth.toFixed(0)}%`} foot={`units delivered vs previous ${ctx.windowDays} days`} />
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-100">Team Delivery Streak Trend <span className="font-semibold text-gray-500">(Last 7 Days)</span></h3>
          <div className="mt-2 h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip formatter={(v: number) => [`${nf(v)} units delivered`, ""]} />
                <Line type="monotone" dataKey="units" stroke="#1F8FE0" strokeWidth={2.5} dot={{ r: 4, fill: "#fff", stroke: "#1F8FE0", strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-gray-100 px-4 py-3 dark:border-slate-800">
          <Labeled label="Product"><SelectBox label="Product" value={product} onChange={setProduct} options={[{ value: "all", label: "All Products" }, ...ctx.data.products.filter((p) => ctx.rows.some((r) => r.productId === p.id)).map((p) => ({ value: p.id, label: p.name }))]} /></Labeled>
          <Labeled label="State"><SelectBox label="State" value={state} onChange={setState} options={[{ value: "all", label: "All States" }, ...states.map((s) => ({ value: s, label: place(s) }))]} /></Labeled>
          <Labeled label="Agent"><SelectBox label="Agent" value={agent} onChange={setAgent} options={[{ value: "all", label: "All Agents" }, ...agents.map(([id, name]) => ({ value: id, label: name }))]} /></Labeled>
          <Labeled label="Streak Filter"><SelectBox label="Streak Filter" value={streakMin} onChange={setStreakMin} options={[{ value: "all", label: "All Streaks" }, { value: "3", label: "3+ days" }, { value: "5", label: "5+ days" }, { value: "7", label: "7+ days" }, { value: "none", label: "No streak" }]} /></Labeled>
          <SearchBox value={search} onChange={setSearch} placeholder="Search agent or state..." />
          <ColumnsMenu labels={COLS} shown={cols} setShown={setCols} />
          <ExportButton onClick={exportRows} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full !min-w-[1100px] text-[12.5px]">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[11px] font-semibold text-gray-700 dark:border-slate-800 dark:text-slate-300">
                <th className="px-4 py-3">#</th><th>Agent / State</th>
                {cols.product && <th>Product</th>}{cols.delivered && <th>7-Day Delivery (Units)</th>}{cols.streak && <th>Delivery Streak</th>}
                {cols.pattern && <th>7-Day Pattern (Delivered per day)</th>}{cols.stock && <th>Available Stock</th>}{cols.days && <th>Days Left</th>}
                {cols.status && <th>Stock Status</th>}{cols.restock && <th>Recommended Restock</th>}<th className="pr-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {listed.map(({ row, list }, i) => {
                const change = pctChange(row.delivered, row.deliveredPrev);
                return (
                  <tr key={row.locationId} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                    <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                    <td className="py-2 pr-3"><AgentCell row={row} /></td>
                    {cols.product && <td className="pr-3"><ProductSwitch value={row.productId} options={productOptions(list, ctx.productName)} onChange={(p) => pick(row.locationId, p)} /></td>}
                    {cols.delivered && <td><div className="text-[14px] font-bold text-gray-900 dark:text-slate-100">{nf(row.delivered)}</div><Delta value={change} /></td>}
                    {cols.streak && <td><StreakChip days={row.streak} /></td>}
                    {cols.pattern && <td><PatternBars values={row.daily.slice(-7)} /></td>}
                    {cols.stock && <td className="whitespace-nowrap text-[13px] font-bold">{units(row.usable)}</td>}
                    {cols.days && <td><DaysChip row={row} /></td>}
                    {cols.status && <td><StatusPill status={row.status} /></td>}
                    {cols.restock && <td><RestockPill value={row.restock} /></td>}
                    <td className="pr-4"><div className="flex items-center justify-center gap-2"><PlanButton row={row} ctx={ctx} /><RowMenu items={rowMenuItems(row, ctx)} /></div></td>
                  </tr>
                );
              })}
              {listed.length === 0 && <tr><td colSpan={12} className="py-10 text-center text-gray-500">No agents match.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <InsightBar
        text={urgent.length > 0
          ? <>{urgent.map((r) => r.agentName).join(" and ")} {urgent.length > 1 ? "are" : "is"} on strong delivery streaks but will run out in ~{one(Math.min(...urgent.map((r) => r.daysLeft ?? 0)))} days. Start a restock ({urgent.map((r) => units(r.restock)).join(" and ")}) to avoid lost sales.</>
          : active.length > 0 ? <>{active.length} agent{active.length === 1 ? " is" : "s are"} delivering every day and {active.length === 1 ? "has" : "have"} enough stock to keep going.</> : <>No agent has delivered 3 days in a row yet this period.</>}
        action={<CreatePlanButton ctx={ctx} />} />
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="w-full min-w-[150px] sm:w-[180px]"><div className="mb-1 text-[11.5px] font-semibold text-gray-800 dark:text-slate-200">{label}</div>{children}</div>;
}
