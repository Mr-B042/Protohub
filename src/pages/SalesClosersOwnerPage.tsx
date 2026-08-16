import { useState } from "react";
import { ArrowLeft, Award, Package, ShoppingCart, Target, TrendingUp, Trophy, UserPlus, Wallet } from "lucide-react";
import type { SalesCloserLeaderboardRow } from "../lib/api";

type Props = {
  rows: SalesCloserLeaderboardRow[];
  loading: boolean;
  error: string;
};

const money = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

const MEDAL_TONE = ["bg-amber-100 text-amber-700", "bg-gray-200 text-gray-600", "bg-orange-100 text-orange-700"];

function StatCard({ icon: Icon, label, value, tone }: { icon: typeof Package; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <span className={`flex h-9 w-9 items-center justify-center rounded-full ${tone}`}><Icon className="h-4 w-4" /></span>
      <p className="mt-3 text-xs font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-black text-gray-950">{value}</p>
    </div>
  );
}

export function SalesClosersOwnerPage({ rows, loading, error }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((row) => row.closerId === selectedId) ?? null;

  if (selected) {
    return (
      <div className="space-y-5 p-4 sm:p-6">
        <button type="button" className="!min-h-0 flex items-center gap-1.5 text-sm font-bold text-blue-600" onClick={() => setSelectedId(null)}>
          <ArrowLeft className="h-4 w-4" /> Back to Sales Closers
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-950">{selected.closerName}</h1>
            <p className="mt-1 text-sm font-medium text-gray-500">Sales Closer {selected.active ? "" : "· Inactive"}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={UserPlus} label="Leads" value={selected.leads.toLocaleString()} tone="bg-blue-100 text-blue-600" />
          <StatCard icon={ShoppingCart} label="Orders Created" value={selected.orders.toLocaleString()} tone="bg-amber-100 text-amber-600" />
          <StatCard icon={Target} label="Delivered Orders" value={selected.delivered.toLocaleString()} tone="bg-emerald-100 text-emerald-600" />
          <StatCard icon={Wallet} label="Delivered Revenue" value={money(selected.revenue)} tone="bg-teal-100 text-teal-600" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Lead → Order Rate</p>
            <p className="mt-2 text-2xl font-black text-gray-950">{selected.leadToOrderRate}%</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Lead → Delivered Rate</p>
            <p className="mt-2 text-2xl font-black text-gray-950">{selected.leadToDeliveredRate}%</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Average Order Value</p>
            <p className="mt-2 text-2xl font-black text-gray-950">{money(selected.aov)}</p>
          </div>
        </div>

        <div className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center">
          <TrendingUp className="mx-auto h-6 w-6 text-gray-300" />
          <h3 className="mt-3 text-sm font-black text-gray-900">Cost & Profitability</h3>
          <p className="mt-1.5 text-sm font-medium text-gray-500">Ad spend, COGS, and net profit for this closer ship in a later stage.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Sales Closers</p>
        <h1 className="mt-1 text-2xl font-black text-gray-950">Sales Closer Performance</h1>
        <p className="mt-1 text-sm font-medium text-gray-500">This month - ranked by delivered revenue</p>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                <th className="px-5 py-3">Closer</th>
                <th className="px-5 py-3">Leads</th>
                <th className="px-5 py-3">Orders</th>
                <th className="px-5 py-3">Lead → Order</th>
                <th className="px-5 py-3">Delivered</th>
                <th className="px-5 py-3">Lead → Delivered</th>
                <th className="px-5 py-3">AOV</th>
                <th className="px-5 py-3">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-gray-400">Loading leaderboard...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-gray-400">No Sales Closer accounts yet.</td></tr>
              ) : rows.map((row, index) => (
                <tr key={row.closerId} className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50/60" onClick={() => setSelectedId(row.closerId)}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      {index < 3 ? (
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${MEDAL_TONE[index]}`}><Trophy className="h-3.5 w-3.5" /></span>
                      ) : (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-black text-gray-500">{index + 1}</span>
                      )}
                      <span className="font-bold text-gray-900">{row.closerName}</span>
                      {!row.active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">Inactive</span>}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-gray-700">{row.leads}</td>
                  <td className="px-5 py-3 text-gray-700">{row.orders}</td>
                  <td className="px-5 py-3 text-gray-700">{row.leadToOrderRate}%</td>
                  <td className="px-5 py-3 text-gray-700">{row.delivered}</td>
                  <td className="px-5 py-3 text-gray-700">{row.leadToDeliveredRate}%</td>
                  <td className="px-5 py-3 text-gray-700">{money(row.aov)}</td>
                  <td className="px-5 py-3 font-bold text-gray-900">{money(row.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {!loading && rows.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-gray-400"><Award className="h-3.5 w-3.5" /> Click a closer to see her full performance breakdown.</p>
      )}
    </div>
  );
}
