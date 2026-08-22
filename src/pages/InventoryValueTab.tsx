import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, CalendarDays, Camera, CheckCircle2,
  ChevronLeft, ChevronRight, Coins, Download, Info, Layers, MapPin, Package, Plus,
  Scale, Tag, TrendingUp, Users, X
} from "lucide-react";
import type { InventoryValueView, StockConditionKey, ValuedProductRow } from "../lib/api";
// ⚠️ Shared formatters, NOT a local `naira()`. A private one silently
// ignores the topbar "hide money" toggle - which is exactly how these
// pages kept showing real figures with privacy mode on.
import { naira } from "../lib/money-privacy";

// Inventory Value: how much cash is tied up in stock.
//
// ⚠️ Valued AT COST, never at what it might sell for. Stock is money already
// spent; counting it at retail would book profit that has not been earned.
// Retail sits alongside, always labelled an estimate.

const signedUnits = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value))}`;
const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { month: "short", day: "numeric" });
const fullDay = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
const stamp = (iso: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—"
    : date.toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" })
      + " " + date.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
};
const addDays = (key: string, days: number) => {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const sundayOf = (key: string) => {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
};
const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

const CONDITION_STYLE: Record<StockConditionKey, { label: string; chip: string; dot: string }> = {
  healthy: { label: "Healthy", chip: "bg-emerald-50 text-emerald-700", dot: "#10B981" },
  slow_moving: { label: "Slow Moving", chip: "bg-amber-50 text-amber-700", dot: "#F59E0B" },
  at_risk: { label: "At Risk", chip: "bg-rose-50 text-rose-700", dot: "#EF4444" },
  damaged: { label: "Damaged / Obsolete", chip: "bg-violet-50 text-violet-700", dot: "#8B5CF6" }
};

const GROUP_TABS = ["By Product", "By Type", "By Location", "By Agent"] as const;
type GroupTab = (typeof GROUP_TABS)[number];

function Modal({ title, subtitle, icon: Icon, width, onClose, children, footer }: {
  title: string; subtitle: string; icon: typeof Info; width: string;
  onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose}
        className="!min-h-0 absolute inset-0 cursor-default bg-slate-900/40 p-0" />
      <div className={`relative flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <h3 className="m-0 text-lg font-black text-gray-900">{title}</h3>
              <p className="m-0 mt-0.5 text-[13px] font-medium text-gray-500">{subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="!min-h-0 rounded-lg bg-transparent p-1 text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">{children}</div>
        <div className="flex flex-wrap justify-end gap-2.5 border-t border-gray-100 px-6 py-4">{footer}</div>
      </div>
    </div>
  );
}

export type InventoryValueTabProps = {
  view: InventoryValueView | null;
  loading: boolean;
  error: string;
  weekStart: string;
  onWeekChange: (weekStart: string) => void;
  saving: boolean;
  onSaveSnapshot: (body: {
    weekStart: string; status: "draft" | "final"; notes: string;
    lines: Array<{ productId: string | null; productName: string; units: number; unitCost: number; condition: StockConditionKey; note: string }>;
  }) => Promise<void>;
  onExport: () => void;
};

export default function InventoryValueTab(props: InventoryValueTabProps) {
  const { view, loading, error, weekStart } = props;
  const [groupTab, setGroupTab] = useState<GroupTab>("By Product");
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const isThisWeek = sundayOf(todayKey()) === weekStart;

  const groups = useMemo(() => {
    if (!view) return [];
    if (groupTab === "By Type") return view.byType;
    if (groupTab === "By Location") return view.byLocation;
    if (groupTab === "By Agent") return view.byAgent;
    return [];
  }, [view, groupTab]);

  const cards = [
    { label: "Total Inventory (At Cost)", value: naira(view?.totals.totalCostValue ?? 0), hint: `Across ${view?.totals.productLines ?? 0} product lines`, icon: Boxes, tone: "bg-violet-50 text-violet-600" },
    { label: "Total Units in Stock", value: `${(view?.totals.totalUnits ?? 0).toLocaleString("en-NG")} Units`, hint: "All locations", icon: Layers, tone: "bg-blue-50 text-blue-600" },
    { label: "Avg. Cost per Unit", value: naira(view?.totals.averageUnitCost ?? 0), hint: "Weighted average", icon: Scale, tone: "bg-emerald-50 text-emerald-600" },
    { label: "Stock Movement (This Week)", value: `${signedUnits(view?.movements.netUnits ?? 0)} Units`, hint: "Net change", icon: TrendingUp, tone: "bg-amber-50 text-amber-600" },
    { label: "Potential Retail Value", value: naira(view?.totals.totalRetailValue ?? 0), hint: "Estimate, based on selling price", icon: Coins, tone: "bg-rose-50 text-rose-600" }
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-2xl font-black text-gray-900">
            Inventory Value
            <span title="Stock is valued at what it cost, not at what it might sell for. Retail value is an estimate and is never counted as cash."
              className="cursor-help text-gray-300 hover:text-gray-500"><Info className="h-4 w-4" /></span>
          </h2>
          <p className="m-0 mt-1 text-sm text-gray-500">Track inventory quantities and value at cost to understand how much cash is tied up in stock.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2 py-1.5">
            <button type="button" aria-label="Previous week" onClick={() => props.onWeekChange(addDays(weekStart, -7))}
              className="!min-h-0 rounded-lg bg-transparent p-1.5 text-gray-500 hover:bg-gray-50">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="inline-flex items-center gap-1.5 px-1">
              <CalendarDays className="h-4 w-4 text-blue-600" />
              <span className="text-[13px] font-black text-gray-900">
                {view ? `${dayLabel(view.weekStart)} – ${fullDay(view.weekEnd)}` : "—"}
              </span>
              {isThisWeek && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-black text-blue-700">This Week</span>}
            </span>
            <button type="button" aria-label="Next week" disabled={isThisWeek}
              onClick={() => props.onWeekChange(addDays(weekStart, 7))}
              className="!min-h-0 rounded-lg bg-transparent p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </span>
          <button type="button" onClick={() => setSnapshotOpen(true)} disabled={!view}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-[#1F8FE0] bg-white px-3.5 py-2.5 text-sm font-bold text-[#1F8FE0] hover:bg-blue-50 disabled:opacity-50">
            <Camera className="h-4 w-4" /> Inventory Valuation Snapshot
          </button>
        </div>
      </div>

      {error && (
        <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>
      )}

      {(view?.totals.unpricedLines ?? 0) > 0 && (
        <p className="m-0 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] font-bold text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {view!.totals.unpricedLines} product{view!.totals.unpricedLines === 1 ? "" : "s"} holding{" "}
          {view!.totals.unpricedUnits.toLocaleString("en-NG")} units have no unit cost on file, so they value at ₦0.
          The total below is understated by whatever that stock actually cost.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.tone}`}>
                <Icon className="h-5 w-5" />
              </span>
              <p className="m-0 mt-2.5 text-[11px] font-black uppercase tracking-wide text-gray-500">{card.label}</p>
              <p className="m-0 mt-0.5 text-xl font-black text-gray-900">{card.value}</p>
              <p className="m-0 mt-0.5 text-[11px] font-semibold text-gray-400">{card.hint}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-2xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
            <div className="inline-flex flex-wrap items-center rounded-xl bg-gray-100 p-1">
              {GROUP_TABS.map((tab) => (
                <button key={tab} type="button" onClick={() => setGroupTab(tab)}
                  className={`!min-h-0 rounded-lg px-3 py-1.5 text-[12px] font-black transition-colors ${groupTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}>
                  {tab}
                </button>
              ))}
            </div>
            <button type="button" onClick={props.onExport}
              className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] font-bold text-gray-700 hover:bg-gray-50">
              <Download className="h-3.5 w-3.5" /> Export
            </button>
          </div>

          {loading && !view ? (
            <p className="m-0 px-4 py-10 text-center text-[13px] font-semibold text-gray-500">Loading inventory…</p>
          ) : groupTab === "By Product" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[11px] font-black uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2.5">Product</th>
                    <th className="px-4 py-2.5 text-right">Units Available</th>
                    <th className="px-4 py-2.5 text-right">Avg. Cost/Unit (₦)</th>
                    <th className="px-4 py-2.5 text-right">Inventory Value (At Cost)</th>
                    <th className="px-4 py-2.5 text-right">Retail Value (Est.)</th>
                    <th className="px-4 py-2.5">Stock Status</th>
                    <th className="px-4 py-2.5 text-right">Trend (This Week)</th>
                  </tr>
                </thead>
                <tbody>
                  {(view?.products ?? []).map((row) => (
                    <tr key={row.productId} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2.5">
                          {row.imageUrl ? (
                            <img src={row.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                          ) : (
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
                              <Package className="h-4 w-4" />
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold text-gray-900">{row.name}</span>
                            <span className="block text-[11px] font-semibold text-gray-400">
                              {row.sku || "No SKU"}
                              {row.damagedUnits > 0 && ` · ${row.damagedUnits} damaged/missing`}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-[13px] font-bold text-gray-900">{row.units.toLocaleString("en-NG")}</td>
                      <td className="px-4 py-3 text-right text-[13px] font-semibold text-gray-700">
                        {row.missingCost ? <span className="text-amber-600">No cost</span> : naira(row.unitCost)}
                      </td>
                      <td className="px-4 py-3 text-right text-[13px] font-black text-gray-900">{naira(row.costValue)}</td>
                      <td className="px-4 py-3 text-right text-[13px] font-semibold text-gray-500">{naira(row.retailValue)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${CONDITION_STYLE[row.condition].chip}`}>
                          {CONDITION_STYLE[row.condition].label}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right text-[13px] font-black ${row.weekTrend > 0 ? "text-emerald-600" : row.weekTrend < 0 ? "text-rose-600" : "text-gray-400"}`}>
                        <span className="inline-flex items-center gap-1">
                          {row.weekTrend > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : row.weekTrend < 0 ? <ArrowDownRight className="h-3.5 w-3.5" /> : null}
                          {signedUnits(row.weekTrend)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {(view?.products.length ?? 0) === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] font-semibold text-gray-500">No stock on hand.</td></tr>
                  )}
                </tbody>
                {(view?.products.length ?? 0) > 0 && (
                  <tfoot>
                    <tr className="border-t border-gray-200 bg-gray-50 text-[13px] font-black text-gray-900">
                      <td className="px-4 py-3">Total</td>
                      <td className="px-4 py-3 text-right">{(view?.totals.totalUnits ?? 0).toLocaleString("en-NG")}</td>
                      <td className="px-4 py-3 text-right">{naira(view?.totals.averageUnitCost ?? 0)}</td>
                      <td className="px-4 py-3 text-right">{naira(view?.totals.totalCostValue ?? 0)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{naira(view?.totals.totalRetailValue ?? 0)}</td>
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3 text-right">{signedUnits(view?.movements.netUnits ?? 0)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[11px] font-black uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2.5">{groupTab.replace("By ", "")}</th>
                    <th className="px-4 py-2.5 text-right">Units</th>
                    <th className="px-4 py-2.5 text-right">Value (At Cost)</th>
                    <th className="px-4 py-2.5 text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={group.key} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-3 text-[13px] font-bold text-gray-900">{group.label}</td>
                      <td className="px-4 py-3 text-right text-[13px] font-semibold text-gray-700">{group.units.toLocaleString("en-NG")}</td>
                      <td className="px-4 py-3 text-right text-[13px] font-black text-gray-900">{naira(group.amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
                            <span className="block h-full rounded-full bg-violet-500" style={{ width: `${Math.min(group.sharePct, 100)}%` }} />
                          </span>
                          <span className="text-[12px] font-black text-gray-700">{group.sharePct.toFixed(2)}%</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {groups.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-[13px] font-semibold text-gray-500">Nothing to group.</td></tr>
                  )}
                </tbody>
              </table>
              {groupTab === "By Type" && (
                <p className="m-0 flex gap-2 border-t border-gray-100 px-4 py-3 text-[12px] font-semibold text-gray-500">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Products do not carry a merchandising category yet, so this groups by catalogue type. Add a category
                  field to products and this becomes a real category breakdown.
                </p>
              )}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-gray-200 bg-white">
            <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
              Inventory Health Summary
            </h3>
            <div className="px-5 py-4">
              {(view?.health.total ?? 0) === 0 ? (
                <p className="m-0 text-[12px] font-semibold text-gray-500">No stock to assess.</p>
              ) : (
                <>
                  <div className="relative h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={view!.health.slices.filter((slice) => slice.amount > 0)}
                          dataKey="amount" nameKey="label" innerRadius={48} outerRadius={68} paddingAngle={2} stroke="none">
                          {view!.health.slices.filter((slice) => slice.amount > 0).map((slice) => (
                            <Cell key={slice.condition} fill={CONDITION_STYLE[slice.condition].dot} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => naira(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-base font-black text-gray-900">{naira(view!.health.total)}</span>
                      <span className="text-[11px] font-semibold text-gray-400">Total at Cost</span>
                    </span>
                  </div>
                  <ul className="m-0 mt-3 list-none space-y-2 p-0">
                    {view!.health.slices.map((slice) => (
                      <li key={slice.condition} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CONDITION_STYLE[slice.condition].dot }} />
                          <span className="truncate text-[12px] font-semibold text-gray-600">{slice.label}</span>
                        </span>
                        <span className="shrink-0 text-[12px] font-black text-gray-900">
                          {naira(slice.amount)} <span className="font-semibold text-gray-400">({slice.sharePct.toFixed(2)}%)</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="m-0 mt-3 text-[11px] font-semibold text-gray-400">
                    Slow moving = nothing sold in {view?.slowMovingWindowDays ?? 30} days. At risk = at or below reorder point.
                  </p>
                </>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white">
            <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
              Inventory by Location (At Cost)
            </h3>
            <ul className="m-0 list-none space-y-2.5 p-0 px-5 py-4">
              {(view?.byLocation ?? []).slice(0, 8).map((row) => (
                <li key={row.key}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      <span className="truncate text-[12px] font-bold text-gray-700">{row.label}</span>
                    </span>
                    <span className="shrink-0 text-[12px] font-black text-gray-900">
                      {naira(row.amount)} <span className="font-semibold text-gray-400">({row.sharePct.toFixed(2)}%)</span>
                    </span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <span className="block h-full rounded-full bg-violet-500" style={{ width: `${Math.min(row.sharePct, 100)}%` }} />
                  </span>
                </li>
              ))}
              {(view?.byLocation.length ?? 0) === 0 && (
                <li className="text-[12px] font-semibold text-gray-500">No stock held at any hub.</li>
              )}
            </ul>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white">
            <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
              Low Stock Alerts
            </h3>
            <ul className="m-0 list-none space-y-2.5 p-0 px-5 py-4">
              {(view?.lowStock ?? []).slice(0, 6).map((row) => (
                <li key={row.productId} className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-bold text-gray-900">{row.name}</span>
                    <span className="block text-[11px] font-semibold text-gray-400">{row.units} units left</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${CONDITION_STYLE[row.condition].chip}`}>
                    {CONDITION_STYLE[row.condition].label}
                  </span>
                </li>
              ))}
              {(view?.lowStock.length ?? 0) === 0 && (
                <li className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> Nothing is running low.
                </li>
              )}
            </ul>
          </section>
        </aside>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white">
        <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
          Inventory Movement (This Week)
        </h3>
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Stock In", units: view?.movements.stockInUnits ?? 0, value: view?.movements.stockInValue ?? 0, tone: "text-emerald-600", icon: ArrowUpRight },
            { label: "Stock Out (Delivered/Sold)", units: -(view?.movements.stockOutUnits ?? 0), value: view?.movements.stockOutValue ?? 0, tone: "text-rose-600", icon: ArrowDownRight },
            { label: "Adjustments", units: view?.movements.adjustmentUnits ?? 0, value: view?.movements.adjustmentValue ?? 0, tone: "text-amber-600", icon: Tag },
            { label: "Net Change", units: view?.movements.netUnits ?? 0, value: view?.movements.netValue ?? 0, tone: "text-violet-600", icon: TrendingUp }
          ].map((tile) => {
            const Icon = tile.icon;
            return (
              <div key={tile.label} className="rounded-xl border border-gray-200 px-3 py-3">
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide ${tile.tone}`}>
                  <Icon className="h-3.5 w-3.5" /> {tile.label}
                </span>
                <p className={`m-0 mt-1 text-lg font-black ${tile.tone}`}>{signedUnits(tile.units)} Units</p>
                <p className="m-0 text-[12px] font-semibold text-gray-500">{naira(Math.abs(tile.value))}</p>
              </div>
            );
          })}
        </div>
        <p className="m-0 flex gap-2 border-t border-gray-100 px-5 py-3 text-[12px] font-semibold text-gray-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Stock moved between our own hubs is excluded — distributing to an agent or sending a waybill does not change
          how much stock the business holds, exactly as a bank transfer is not cash flow.
        </p>
      </section>

      <p className="m-0 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 px-3.5 py-3 text-[12px] font-semibold text-gray-500">
        <span className="inline-flex gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Inventory is valued at cost. Retail values are estimated from current selling prices and are never counted as cash.
        </span>
        {view?.snapshot && (
          <span className="font-bold text-gray-700">
            Last valuation: {stamp(view.snapshot.capturedAt)} by {view.snapshot.capturedByName || "—"}
            {view.snapshot.status === "final" && " · final"}
          </span>
        )}
      </p>

      {snapshotOpen && view && (
        <SnapshotModal
          view={view} saving={props.saving}
          onClose={() => setSnapshotOpen(false)}
          onSave={async (body) => { await props.onSaveSnapshot(body); setSnapshotOpen(false); }}
        />
      )}
    </div>
  );
}

type SnapshotLine = {
  key: string;
  productId: string | null;
  productName: string;
  units: string;
  unitCost: string;
  condition: StockConditionKey;
  note: string;
};

function SnapshotModal({ view, saving, onClose, onSave }: {
  view: InventoryValueView;
  saving: boolean;
  onClose: () => void;
  onSave: (body: {
    weekStart: string; status: "draft" | "final"; notes: string;
    lines: Array<{ productId: string | null; productName: string; units: number; unitCost: number; condition: StockConditionKey; note: string }>;
  }) => Promise<void>;
}) {
  const fromLive = (): SnapshotLine[] => view.products.map((row) => ({
    key: row.productId,
    productId: row.productId,
    productName: row.name,
    units: String(row.units),
    unitCost: String(row.unitCost),
    condition: row.condition,
    note: ""
  }));

  const [lines, setLines] = useState<SnapshotLine[]>(() => {
    const saved = view.snapshot?.lines ?? [];
    if (saved.length === 0) return fromLive();
    return saved.map((row, index) => ({
      key: row.productId ?? `line-${index}`,
      productId: row.productId,
      productName: row.productName,
      units: String(row.units),
      unitCost: String(row.unitCost),
      condition: row.condition,
      note: row.note
    }));
  });
  const [notes, setNotes] = useState(view.snapshot?.notes ?? "");
  const [error, setError] = useState("");
  const alreadyFinal = view.snapshot?.status === "final";

  const parsed = lines.map((line) => {
    const units = Number(String(line.units).replace(/,/g, "")) || 0;
    const unitCost = Number(String(line.unitCost).replace(/,/g, "")) || 0;
    return { line, units, unitCost, value: units * unitCost };
  });
  const totalUnits = parsed.reduce((sum, entry) => sum + entry.units, 0);
  const totalValue = parsed.reduce((sum, entry) => sum + entry.value, 0);
  const byCondition = (condition: StockConditionKey) =>
    parsed.filter((entry) => entry.line.condition === condition).reduce((sum, entry) => sum + entry.value, 0);

  const submit = async (status: "draft" | "final") => {
    setError("");
    if (parsed.length === 0) { setError("A valuation needs at least one product."); return; }
    if (parsed.some((entry) => !entry.line.productName.trim())) { setError("Every line needs a product name."); return; }
    try {
      await onSave({
        weekStart: view.weekStart, status, notes,
        lines: parsed.map((entry) => ({
          productId: entry.line.productId,
          productName: entry.line.productName.trim(),
          units: entry.units,
          unitCost: entry.unitCost,
          condition: entry.line.condition,
          note: entry.line.note
        }))
      });
    } catch (saveError: any) {
      setError(saveError?.message ?? "Could not save the valuation.");
    }
  };

  return (
    <Modal
      title="Inventory Valuation Snapshot"
      subtitle="Capture the inventory value at cost for this week. This snapshot is used for weekly closing and reporting."
      icon={Camera} width="max-w-6xl" onClose={onClose}
      footer={
        <>
          {error && <p className="m-0 mr-auto text-[12px] font-bold text-rose-600">{error}</p>}
          <button type="button" onClick={onClose}
            className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" disabled={saving || alreadyFinal} onClick={() => void submit("draft")}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Save as Draft
          </button>
          <button type="button" disabled={saving || alreadyFinal} onClick={() => void submit("final")}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
            <CheckCircle2 className="h-4 w-4" /> Save &amp; Use This Snapshot
          </button>
        </>
      }
    >
      <div className="grid gap-3 rounded-2xl bg-gray-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <span>
          <span className="block text-[11px] font-black uppercase tracking-wide text-gray-500">Valuation Week</span>
          <span className="block text-[13px] font-black text-gray-900">{dayLabel(view.weekStart)} – {fullDay(view.weekEnd)}</span>
        </span>
        <span>
          <span className="block text-[11px] font-black uppercase tracking-wide text-gray-500">Valuation Method</span>
          <span className="block text-[13px] font-black text-gray-900">At Cost</span>
        </span>
        <span>
          <span className="block text-[11px] font-black uppercase tracking-wide text-gray-500">Snapshot Date</span>
          <span className="block text-[13px] font-black text-gray-900">{stamp(view.snapshot?.capturedAt ?? new Date().toISOString())}</span>
        </span>
        <span>
          <span className="block text-[11px] font-black uppercase tracking-wide text-gray-500">Captured By</span>
          <span className="block text-[13px] font-black text-gray-900">{view.snapshot?.capturedByName || "You"}</span>
        </span>
      </div>

      {alreadyFinal && (
        <p className="m-0 flex gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-3 text-[12px] font-bold text-violet-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          This week's valuation is already final. It is what the accounts were reported on, so it cannot be replaced.
        </p>
      )}

      <p className="m-0 flex gap-2 rounded-xl bg-blue-50 px-3.5 py-3 text-[12px] font-semibold text-blue-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        A snapshot is a record, not a correction. Saving it never changes your stock levels — if a physical count
        disagrees with the system, make a stock adjustment so the change is auditable.
      </p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-2xl border border-gray-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
            <h4 className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-700">Products in Stock</h4>
            <button type="button" onClick={() => setLines(fromLive())}
              className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] font-bold text-gray-700 hover:bg-gray-50">
              Import from Inventory
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] font-black uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2.5">#</th>
                  <th className="px-3 py-2.5">Product</th>
                  <th className="px-3 py-2.5 text-right">Units</th>
                  <th className="px-3 py-2.5 text-right">Cost per Unit (₦)</th>
                  <th className="px-3 py-2.5 text-right">Value (₦)</th>
                  <th className="px-3 py-2.5">Condition</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((entry, index) => (
                  <tr key={entry.line.key} className="border-b border-gray-50 last:border-0">
                    <td className="px-3 py-2.5 text-[12px] font-semibold text-gray-400">{index + 1}</td>
                    <td className="px-3 py-2.5">
                      {entry.line.productId ? (
                        <span className="text-[13px] font-bold text-gray-900">{entry.line.productName}</span>
                      ) : (
                        <input value={entry.line.productName} placeholder="Product name"
                          onChange={(event) => setLines((prev) => prev.map((line, i) =>
                            i === index ? { ...line, productName: event.target.value } : line))}
                          className="w-40 rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] font-bold text-gray-900" />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <input inputMode="numeric" value={entry.line.units} disabled={alreadyFinal}
                        onChange={(event) => setLines((prev) => prev.map((line, i) =>
                          i === index ? { ...line, units: event.target.value } : line))}
                        className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-right text-[13px] font-bold text-gray-900 disabled:bg-gray-50" />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <input inputMode="decimal" value={entry.line.unitCost} disabled={alreadyFinal}
                        onChange={(event) => setLines((prev) => prev.map((line, i) =>
                          i === index ? { ...line, unitCost: event.target.value } : line))}
                        className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-right text-[13px] font-bold text-gray-900 disabled:bg-gray-50" />
                    </td>
                    <td className="px-3 py-2.5 text-right text-[13px] font-black text-gray-900">{naira(entry.value)}</td>
                    <td className="px-3 py-2.5">
                      <select value={entry.line.condition} disabled={alreadyFinal}
                        onChange={(event) => setLines((prev) => prev.map((line, i) =>
                          i === index ? { ...line, condition: event.target.value as StockConditionKey } : line))}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-[12px] font-bold text-gray-900 disabled:bg-gray-50">
                        {(Object.keys(CONDITION_STYLE) as StockConditionKey[]).map((key) => (
                          <option key={key} value={key}>{CONDITION_STYLE[key].label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50 text-[13px] font-black text-gray-900">
                  <td className="px-3 py-3" colSpan={2}>Total</td>
                  <td className="px-3 py-3 text-right">{totalUnits.toLocaleString("en-NG")}</td>
                  <td className="px-3 py-3 text-right text-gray-500">At Cost</td>
                  <td className="px-3 py-3 text-right text-violet-700">{naira(totalValue)}</td>
                  <td className="px-3 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
          {!alreadyFinal && (
            <button type="button"
              onClick={() => setLines((prev) => [...prev, {
                key: `extra-${Date.now()}`, productId: null, productName: "",
                units: "", unitCost: "", condition: "healthy", note: ""
              }])}
              className="!min-h-0 m-3 inline-flex w-[calc(100%-1.5rem)] items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-2.5 text-[13px] font-bold text-[#1F8FE0] hover:bg-blue-50">
              <Plus className="h-4 w-4" /> Add Product
            </button>
          )}
        </div>

        <aside className="rounded-2xl border border-gray-200">
          <h4 className="m-0 border-b border-gray-100 px-4 py-3 text-[12px] font-black uppercase tracking-wide text-gray-700">
            Valuation Summary
          </h4>
          <ul className="m-0 list-none space-y-2.5 p-0 px-4 py-4">
            {(Object.keys(CONDITION_STYLE) as StockConditionKey[]).map((key) => {
              const amount = byCondition(key);
              return (
                <li key={key} className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CONDITION_STYLE[key].dot }} />
                    <span className="truncate text-[12px] font-semibold text-gray-600">{CONDITION_STYLE[key].label}</span>
                  </span>
                  <span className="shrink-0 text-[12px] font-black text-gray-900">
                    {naira(amount)}
                    <span className="ml-1 font-semibold text-gray-400">
                      ({totalValue > 0 ? ((amount / totalValue) * 100).toFixed(2) : "0.00"}%)
                    </span>
                  </span>
                </li>
              );
            })}
            <li className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2.5">
              <span className="text-[12px] font-black text-gray-900">Total Inventory (At Cost)</span>
              <span className="text-base font-black text-violet-700">{naira(totalValue)}</span>
            </li>
            <li className="text-right text-[11px] font-semibold text-gray-400">{totalUnits.toLocaleString("en-NG")} units</li>
          </ul>
          <div className="border-t border-gray-100 px-4 py-4">
            <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
              Valuation Notes (Optional)
              <textarea value={notes} maxLength={500} rows={4} disabled={alreadyFinal}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Enter any notes about this inventory valuation..."
                className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-medium text-gray-900 disabled:bg-gray-50" />
            </label>
            <p className="m-0 mt-1 text-right text-[11px] font-semibold text-gray-400">{notes.length} / 500</p>
          </div>
        </aside>
      </div>
    </Modal>
  );
}
