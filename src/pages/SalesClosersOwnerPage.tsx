import { useEffect, useState } from "react";
import { ArrowLeft, Award, Package, Settings, ShoppingCart, Target, TrendingDown, TrendingUp, Trophy, UserPlus, Wallet } from "lucide-react";
import type { SalesCloserBonusComponent, SalesCloserCostProfitability, SalesCloserLeaderboardRow } from "../lib/api";
import { LoadingState } from "../components/ui/loading-state";

type Props = {
  rows: SalesCloserLeaderboardRow[];
  loading: boolean;
  error: string;
  canEditCostSettings: boolean;
  costSettings: { allocatedSalaryMonthly: number; packagingCostPerUnit: number } | null;
  onSaveCostSettings: (values: { allocatedSalaryMonthly: number; packagingCostPerUnit: number }) => Promise<void>;
  bonusComponents: SalesCloserBonusComponent[] | null;
  onSaveBonusComponents: (components: SalesCloserBonusComponent[]) => Promise<void>;
  onLoadCostProfitability: (closerId: string) => Promise<SalesCloserCostProfitability>;
};

const money = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

const MEDAL_TONE = ["bg-amber-100 text-amber-700", "bg-gray-200 text-gray-600", "bg-orange-100 text-orange-700"];

const BONUS_METRIC_UNIT: Record<string, "percent" | "money"> = {
  leadToOrderRate: "percent",
  leadToDeliveredRate: "percent",
  aov: "money",
  upsellCrossSellRevenue: "money",
  activityScore: "percent",
  deliveryRate: "percent"
};

function StatCard({ icon: Icon, label, value, tone }: { icon: typeof Package; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <span className={`flex h-9 w-9 items-center justify-center rounded-full ${tone}`}><Icon className="h-4 w-4" /></span>
      <p className="mt-3 text-xs font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-black text-gray-950">{value}</p>
    </div>
  );
}

function CostSettingsPanel({
  settings,
  onSave
}: {
  settings: { allocatedSalaryMonthly: number; packagingCostPerUnit: number };
  onSave: (values: { allocatedSalaryMonthly: number; packagingCostPerUnit: number }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [salary, setSalary] = useState(String(settings.allocatedSalaryMonthly));
  const [packaging, setPackaging] = useState(String(settings.packagingCostPerUnit));
  const [saving, setSaving] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <button type="button" className="!min-h-0 flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setOpen((v) => !v)}>
        <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-gray-500"><Settings className="h-4 w-4" /> Cost & Profitability Settings</span>
        <span className="text-xs font-bold text-blue-600">{open ? "Close" : "Edit"}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-3 border-t border-gray-100 p-4 sm:grid-cols-3 sm:items-end">
          <label className="block text-xs font-bold text-gray-500">
            Allocated Salary (monthly, per closer)
            <input type="number" min="0" className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900" value={salary} onChange={(event) => setSalary(event.target.value)} />
          </label>
          <label className="block text-xs font-bold text-gray-500">
            Packaging Cost (per delivered unit)
            <input type="number" min="0" className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900" value={packaging} onChange={(event) => setPackaging(event.target.value)} />
          </label>
          <button
            type="button"
            disabled={saving}
            className="!min-h-0 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-200 disabled:opacity-50"
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({ allocatedSalaryMonthly: Math.max(0, Number(salary) || 0), packagingCostPerUnit: Math.max(0, Number(packaging) || 0) });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <p className="sm:col-span-3 text-[11px] font-medium text-gray-400">
            Allocated Salary is one flat number applied to every closer's monthly profitability, not read per-person from payroll. Packaging is a fixed per-unit assumption - neither is tracked anywhere else in the app.
          </p>
        </div>
      )}
    </div>
  );
}

function BonusRulesSettingsPanel({
  components,
  onSave
}: {
  components: SalesCloserBonusComponent[];
  onSave: (components: SalesCloserBonusComponent[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SalesCloserBonusComponent[]>(components);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setDraft(components);
  }, [components, open]);

  const updateTier = (componentId: string, tierId: string, field: "minValue" | "amount", value: number) => {
    setDraft((prev) => prev.map((component) => component.id === componentId
      ? { ...component, tiers: component.tiers.map((tier) => tier.id === tierId ? { ...tier, [field]: value } : tier) }
      : component));
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <button type="button" className="!min-h-0 flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setOpen((v) => !v)}>
        <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-gray-500"><Target className="h-4 w-4" /> Bonus Tier Settings</span>
        <span className="text-xs font-bold text-blue-600">{open ? "Close" : "Edit"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-gray-100 p-4">
          {draft.map((component) => (
            <div key={component.id} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
              <p className="text-xs font-black text-gray-900">{component.label}</p>
              <p className="text-[11px] font-medium text-gray-400">{component.description}</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {component.tiers.map((tier) => (
                  <div key={tier.id} className="rounded-lg border border-gray-200 bg-white p-2.5">
                    <p className="text-[10px] font-black uppercase text-gray-400">{tier.label}</p>
                    <label className="mt-1.5 block text-[10px] font-bold text-gray-500">
                      Min {BONUS_METRIC_UNIT[component.metric] === "money" ? "value (₦)" : "%"}
                      <input type="number" min="0" className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm font-semibold text-gray-900"
                        value={tier.minValue} onChange={(event) => updateTier(component.id, tier.id, "minValue", Number(event.target.value) || 0)} />
                    </label>
                    <label className="mt-1.5 block text-[10px] font-bold text-gray-500">
                      Amount (₦)
                      <input type="number" min="0" className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm font-semibold text-gray-900"
                        value={tier.amount} onChange={(event) => updateTier(component.id, tier.id, "amount", Number(event.target.value) || 0)} />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            disabled={saving}
            className="!min-h-0 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-200 disabled:opacity-50"
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(draft);
                setOpen(false);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving..." : "Save Bonus Tiers"}
          </button>
        </div>
      )}
    </div>
  );
}

export function SalesClosersOwnerPage({ rows, loading, error, canEditCostSettings, costSettings, onSaveCostSettings, bonusComponents, onSaveBonusComponents, onLoadCostProfitability }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cost, setCost] = useState<SalesCloserCostProfitability | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costError, setCostError] = useState("");
  const selected = rows.find((row) => row.closerId === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) {
      setCost(null);
      return;
    }
    let cancelled = false;
    setCostLoading(true);
    setCostError("");
    onLoadCostProfitability(selectedId)
      .then((result) => { if (!cancelled) setCost(result); })
      .catch((err: any) => { if (!cancelled) setCostError(err?.message ?? "Could not load cost & profitability."); })
      .finally(() => { if (!cancelled) setCostLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, onLoadCostProfitability]);

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

        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4"><h3 className="text-sm font-bold text-gray-900">Cost & Profitability (This Month)</h3></div>
          {costLoading || !cost ? (
            costError ? <p className="px-5 py-6 text-sm font-bold text-rose-700">{costError}</p> : <LoadingState label="Loading profitability" compact />
          ) : (
            <div className="divide-y divide-gray-50 px-5">
              <div className="flex items-center justify-between py-3"><span className="text-sm font-semibold text-gray-600">Delivered Revenue</span><span className="text-sm font-black text-gray-950">{money(cost.deliveredRevenue)}</span></div>
              <div className="flex items-center justify-between py-3"><span className="text-sm font-semibold text-gray-600">Product Cost (COGS)</span><span className="text-sm font-bold text-rose-600">-{money(cost.productCost)}</span></div>
              <div className="flex items-center justify-between py-3"><span className="text-sm font-semibold text-gray-600">Delivery Cost</span><span className="text-sm font-bold text-rose-600">-{money(cost.deliveryCost)}</span></div>
              <div className="flex items-center justify-between py-3"><span className="text-sm font-semibold text-gray-600">Packaging</span><span className="text-sm font-bold text-rose-600">-{money(cost.packaging)}</span></div>
              <div className="flex items-center justify-between py-3"><span className="text-sm font-semibold text-gray-600">Discounts</span><span className="text-sm font-bold text-rose-600">-{money(cost.discounts)}</span></div>
              <div className="flex items-center justify-between py-3"><span className="text-sm font-semibold text-gray-600">Closer Bonus</span><span className="text-sm font-bold text-rose-600">-{money(cost.closerBonus)}</span></div>
              <div className="flex items-center justify-between py-3"><span className="text-sm font-semibold text-gray-600">Allocated Salary</span><span className="text-sm font-bold text-rose-600">-{money(cost.allocatedSalary)}</span></div>
              <div className="flex items-center justify-between py-3">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-500">Advertising <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">Not tracked per closer</span></span>
                <span className="text-sm font-bold text-gray-400">-</span>
              </div>
              <div className="flex items-center justify-between py-4">
                <span className="text-sm font-black text-gray-900">Net Profit</span>
                <span className={`flex items-center gap-1.5 text-lg font-black ${cost.netProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {cost.netProfit >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />} {money(cost.netProfit)}
                </span>
              </div>
              <p className="pb-4 text-[11px] font-medium leading-4 text-gray-400">
                Advertising is excluded on purpose - ad spend is logged by Marketers, not linked to which closer ultimately worked the resulting lead, so showing a number here would mean guessing an attribution the data doesn't support.
              </p>
            </div>
          )}
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
      {canEditCostSettings && costSettings && <CostSettingsPanel settings={costSettings} onSave={onSaveCostSettings} />}
      {canEditCostSettings && bonusComponents && <BonusRulesSettingsPanel components={bonusComponents} onSave={onSaveBonusComponents} />}

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
        <p className="flex items-center gap-1.5 text-xs font-medium text-gray-400"><Award className="h-3.5 w-3.5" /> Click a closer to see her full performance and cost breakdown.</p>
      )}
    </div>
  );
}
