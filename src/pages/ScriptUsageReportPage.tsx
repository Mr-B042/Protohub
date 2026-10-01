import { useEffect, useState } from "react";
import { Award, BarChart3, CheckCircle2, Clock, Settings, ShoppingCart, TrendingUp, TriangleAlert, Wallet } from "lucide-react";
import { Modal } from "../components/WeeklyReportParts";
import { salesScriptingApi, type ScriptHealth, type ScriptLibrary, type ScriptSettings, type ScriptUsageReport } from "../lib/api";

/**
 * Head of Sales Rep -> Script Usage Report (Bright, 1 Oct 2026). Not "how
 * often was it opened" but: shown -> used -> customer said yes -> delivered ->
 * extra revenue, per script, per rep and per product pairing. Health is set by
 * the numbers (thresholds in Settings), never by hand.
 */

const lagosToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const shift = (key: string, days: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const sundayOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return shift(key, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
};
const PERIODS = (() => {
  const today = lagosToday();
  const sunday = sundayOf(today);
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shift(monthStart, -1);
  return [
    { key: "this_week", label: "This Week", from: sunday, to: today },
    { key: "last_week", label: "Last Week", from: shift(sunday, -7), to: shift(sunday, -1) },
    { key: "last_4", label: "Last 4 Weeks", from: shift(today, -27), to: today },
    { key: "this_month", label: "This Month", from: monthStart, to: today },
    { key: "last_month", label: "Last Month", from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd }
  ];
})();

const HEALTH_TONE: Record<ScriptHealth, string> = {
  high: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  performing: "bg-blue-50 text-blue-700 ring-blue-200",
  needs_review: "bg-amber-50 text-amber-800 ring-amber-200",
  underperforming: "bg-rose-50 text-rose-700 ring-rose-200",
  insufficient: "bg-gray-100 text-gray-600 ring-gray-200"
};
const HEALTH_DOT: Record<ScriptHealth, string> = { high: "🟢", performing: "🔵", needs_review: "🟠", underperforming: "🔴", insufficient: "⚪" };
const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
const pct = (value: number) => `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`;

export default function ScriptUsageReportPage({ canEditSettings, onToast }: { canEditSettings: boolean; onToast: (message: string) => void }) {
  const [period, setPeriod] = useState(PERIODS[2]);
  const [data, setData] = useState<ScriptUsageReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [repsFor, setRepsFor] = useState<ScriptUsageReport["scripts"][number] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [healthFilter, setHealthFilter] = useState<ScriptHealth | "all">("all");

  const load = async () => {
    setLoading(true);
    try {
      setData(await salesScriptingApi.usage({ from: period.from, to: period.to }));
      setError("");
    } catch (err: any) {
      setError(err?.message ?? "Could not load the report.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [period.key]);

  const kpis = data ? [
    { label: "Active Approved Scripts", value: String(data.kpis.activeApproved), icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-600" },
    { label: "Pending Approval", value: String(data.kpis.pending), icon: Clock, tone: "bg-amber-100 text-amber-600" },
    { label: "Scripts Needing Review", value: String(data.kpis.needsReview), icon: TriangleAlert, tone: "bg-rose-100 text-rose-600" },
    { label: "Scripts Used", value: String(data.kpis.used), icon: BarChart3, tone: "bg-blue-100 text-blue-600" },
    { label: "Script-Assisted Sales", value: String(data.kpis.scriptAssistedSales), icon: ShoppingCart, tone: "bg-violet-100 text-violet-600", sub: "Delivered orders where a script got a yes" },
    { label: "Upsell Conversion", value: pct(data.kpis.upsellConversion), icon: TrendingUp, tone: "bg-emerald-100 text-emerald-600", sub: "Customer said yes / used" },
    { label: "Cross-Sell Conversion", value: pct(data.kpis.crossSellConversion), icon: TrendingUp, tone: "bg-amber-100 text-amber-600", sub: "Customer said yes / used" },
    { label: "Incremental Revenue", value: naira(data.kpis.incrementalRevenue), icon: Wallet, tone: "bg-sky-100 text-sky-600", sub: "Delivered upsells & cross-sells only" }
  ] : [];
  const rows = (data?.scripts ?? []).filter((row) => healthFilter === "all" || row.health === healthFilter);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 dark:bg-slate-800">
          {PERIODS.map((item) => (
            <button key={item.key} type="button" onClick={() => setPeriod(item)} className={`!min-h-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${period.key === item.key ? "bg-white text-gray-900 shadow-sm dark:bg-slate-900 dark:text-slate-100" : "text-gray-500 hover:text-gray-900"}`}>{item.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[12px] text-gray-500">
          {data ? <span>{data.period.from} → {data.period.to} · compared with {data.period.previousFrom} → {data.period.previousTo}</span> : null}
          {canEditSettings ? <button type="button" onClick={() => setSettingsOpen(true)} className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-bold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><Settings className="h-3.5 w-3.5" /> Settings</button> : null}
        </div>
      </div>

      {error ? <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {!data && loading ? <p className="m-0 rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">Loading the report…</p> : null}

      {data ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((card) => (
              <div key={card.label} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
                <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${card.tone}`}><card.icon className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <span className="block text-[12px] font-semibold text-gray-500">{card.label}</span>
                  <strong className="block text-xl font-black text-gray-900 dark:text-slate-50">{card.value}</strong>
                  {card.sub ? <span className="block truncate text-[11px] text-gray-400">{card.sub}</span> : null}
                </div>
              </div>
            ))}
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="m-0 flex items-center gap-2 text-base font-black text-gray-900 dark:text-slate-100"><Award className="h-4 w-4 text-violet-600" /> The script that converts best</h3>
            <p className="m-0 mt-0.5 text-[12px] text-gray-500">For each product and type, the script with the best delivered conversion this period compared with the others.</p>
            {data.leaders.length === 0 ? <p className="m-0 mt-3 text-sm text-gray-500">No script has been used in this period yet.</p> : (
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.leaders.map((group) => (
                  <div key={`${group.productName}-${group.category}`} className="rounded-xl border border-violet-200 bg-violet-50/50 p-3.5 dark:border-violet-400/25 dark:bg-violet-400/[0.06]">
                    <p className="m-0 text-[11px] font-black uppercase tracking-wide text-violet-700">{group.productName} · {group.categoryLabel}</p>
                    <p className="m-0 mt-1 text-[14px] font-black text-gray-900 dark:text-slate-100">{group.best.title}</p>
                    <p className="m-0 text-[12px] text-gray-600 dark:text-slate-300">{pct(group.best.deliveredConversion)} delivered · {pct(group.best.acceptanceRate)} said yes · used {group.best.used}×{group.early ? " · early, few uses" : ""}</p>
                    {group.others.length > 0 ? (
                      <ul className="m-0 mt-2 list-none space-y-0.5 p-0 text-[12px] text-gray-500">
                        {group.others.slice(0, 4).map((other) => <li key={other.scriptId}>{other.title}: {pct(other.deliveredConversion)} delivered · used {other.used}×</li>)}
                      </ul>
                    ) : <p className="m-0 mt-2 text-[12px] text-gray-400">No other script of this type used yet.</p>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="m-0 text-base font-black text-gray-900 dark:text-slate-100">Script performance</h3>
                <p className="m-0 mt-0.5 text-[12px] text-gray-500">Shown → used → customer said yes → delivered. Click a script to see each rep.</p>
              </div>
              <select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value as ScriptHealth | "all")} className="!min-h-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] dark:border-slate-700 dark:bg-slate-900">
                <option value="all">All health</option><option value="high">🟢 High Performing</option><option value="performing">🔵 Performing</option>
                <option value="needs_review">🟠 Needs Review</option><option value="underperforming">🔴 Underperforming</option><option value="insufficient">⚪ Insufficient Data</option>
              </select>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="!min-w-[980px] w-full text-left text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-gray-400">
                    <th className="px-2 py-2">Script</th><th className="px-2 py-2">Shown</th><th className="px-2 py-2">Used</th><th className="px-2 py-2">Said yes</th>
                    <th className="px-2 py-2">Delivered</th><th className="px-2 py-2">Delivered conversion</th><th className="px-2 py-2">Extra revenue</th><th className="px-2 py-2">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const change = row.previousFunnel.used > 0 ? Math.round((row.funnel.deliveredConversion - row.previousFunnel.deliveredConversion) * 10) / 10 : null;
                    return (
                      <tr key={row.scriptId} onClick={() => setRepsFor(row)} className="cursor-pointer border-t border-gray-100 text-gray-800 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/50 [&>td]:[color:inherit]">
                        <td className="px-2 py-2.5">
                          <strong className="block">{row.title} <span className="font-normal text-gray-400">v{row.versionNo}</span>{row.live ? null : <span className="ml-1 text-[11px] font-semibold text-gray-400">(not live)</span>}</strong>
                          <span className="block text-[11px] text-gray-500">{row.productName} · {row.categoryLabel}{row.upgradePath ? ` · ${row.upgradePath}` : ""}{row.pairName ? ` · → ${row.pairName}` : ""}</span>
                        </td>
                        <td className="px-2 py-2.5">{row.funnel.shown}</td>
                        <td className="px-2 py-2.5">{row.funnel.used}</td>
                        <td className="px-2 py-2.5">{row.funnel.accepted} <span className="text-[11px] text-gray-400">({pct(row.funnel.acceptanceRate)})</span></td>
                        <td className="px-2 py-2.5">{row.funnel.delivered}</td>
                        <td className="px-2 py-2.5"><strong>{pct(row.funnel.deliveredConversion)}</strong>{change !== null ? <span className={`ml-1 text-[11px] font-semibold ${change >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{change >= 0 ? "↑" : "↓"} {Math.abs(change)}pp</span> : null}</td>
                        <td className="px-2 py-2.5">{naira(row.funnel.incrementalRevenue)}</td>
                        <td className="px-2 py-2.5"><span title={row.healthReason} className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${HEALTH_TONE[row.health]}`}>{HEALTH_DOT[row.health]} {row.healthLabel}</span><span className="block text-[11px] text-gray-400">{row.healthReason}</span></td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 ? <tr><td colSpan={8} className="px-2 py-8 text-center text-gray-500">No scripts to show.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="m-0 text-base font-black text-gray-900 dark:text-slate-100">Product pairings</h3>
            <p className="m-0 mt-0.5 text-[12px] text-gray-500">Which cross-sell combinations actually work.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="!min-w-[640px] w-full text-left text-[13px]">
                <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400"><th className="px-2 py-2">Pairing</th><th className="px-2 py-2">Used</th><th className="px-2 py-2">Said yes</th><th className="px-2 py-2">Conversion</th><th className="px-2 py-2">Delivered</th><th className="px-2 py-2">Extra revenue</th></tr></thead>
                <tbody>
                  {data.pairs.map((pair) => (
                    <tr key={`${pair.productName}-${pair.pairName}`} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit]">
                      <td className="px-2 py-2.5 font-semibold">{pair.productName} → {pair.pairName}</td>
                      <td className="px-2 py-2.5">{pair.used}</td><td className="px-2 py-2.5">{pair.accepted}</td>
                      <td className="px-2 py-2.5"><strong>{pct(pair.acceptanceRate)}</strong></td><td className="px-2 py-2.5">{pair.delivered}</td><td className="px-2 py-2.5">{naira(pair.incrementalRevenue)}</td>
                    </tr>
                  ))}
                  {data.pairs.length === 0 ? <tr><td colSpan={6} className="px-2 py-6 text-center text-gray-500">No cross-sell script used in this period.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {repsFor ? <RepBreakdownModal row={repsFor} period={{ from: period.from, to: period.to }} onClose={() => setRepsFor(null)} /> : null}
      {settingsOpen && data ? <SettingsModal settings={data.settings} onClose={() => setSettingsOpen(false)} onSaved={async () => { setSettingsOpen(false); onToast("Script settings saved."); await load(); }} /> : null}
    </div>
  );
}

function RepBreakdownModal({ row, period, onClose }: { row: ScriptUsageReport["scripts"][number]; period: { from: string; to: string }; onClose: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof salesScriptingApi.usageReps>> | null>(null);
  useEffect(() => { salesScriptingApi.usageReps(row.scriptId, period).then(setData).catch(() => undefined); }, [row.scriptId, period.from, period.to]);
  return (
    <Modal title={row.title} subtitle={`${row.productName} · ${row.categoryLabel} · ${period.from} → ${period.to}`} onClose={onClose} wide>
      <div className="space-y-4 px-6 py-5">
        {data?.diagnosis ? <p className="m-0 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[13px] font-semibold text-violet-900">{data.diagnosis}</p> : null}
        <table className="!min-w-0 w-full text-left text-[13px]">
          <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400"><th className="py-2">Rep</th><th className="py-2">Used</th><th className="py-2">Said yes</th><th className="py-2">Delivered</th><th className="py-2">Delivered conversion</th><th className="py-2">Extra revenue</th></tr></thead>
          <tbody>
            {(data?.rows ?? []).map((rep) => (
              <tr key={rep.repId} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit]">
                <td className="py-2 font-semibold">{rep.repName}</td><td className="py-2">{rep.used}</td><td className="py-2">{rep.accepted}</td><td className="py-2">{rep.delivered}</td>
                <td className="py-2"><strong>{pct(rep.deliveredConversion)}</strong></td><td className="py-2">{naira(rep.incrementalRevenue)}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-gray-500">No rep used this script in the period.</td></tr> : null}
          </tbody>
        </table>
        {data ? <p className="m-0 text-[12px] text-gray-500">Similar scripts ({row.productName}, {row.categoryLabel}) average {pct(data.categoryAverage)} delivered conversion.</p> : null}
        {data && data.versions.length > 1 ? (
          <div>
            <p className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-500">By version</p>
            <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-[12px] text-gray-700">
              {data.versions.map((version) => <li key={version.versionNo}>Version {version.versionNo} ({version.status}): used {version.used}, said yes {version.accepted}, delivered {version.delivered} ({pct(version.deliveredConversion)})</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function SettingsModal({ settings, onClose, onSaved }: { settings: ScriptSettings; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<ScriptSettings>(settings);
  const [library, setLibrary] = useState<ScriptLibrary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { salesScriptingApi.library().then(setLibrary).catch(() => undefined); }, []);
  const num = (key: keyof ScriptSettings, label: string, hint: string, step = 1) => (
    <label className="block">
      <span className="text-[12px] font-bold text-gray-700">{label}</span>
      <input type="number" step={step} min={0} value={Number(draft[key])} onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })} className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm" />
      <span className="block text-[11px] text-gray-500">{hint}</span>
    </label>
  );
  return (
    <Modal title="Script settings" subtitle="Health thresholds, the playbook minimum and the delivery offer reps quote." onClose={onClose} wide>
      <div className="space-y-4 px-6 py-5">
        <div className="grid gap-3 sm:grid-cols-3">
          {num("minPerCategory", "Scripts per category", "Approved scripts each product should have for closing, upselling and cross-selling.")}
          {num("minUses", "Uses before judging", "Fewer uses than this = Insufficient Data.")}
          {num("dropPoints", "Drop that needs review", "Percentage points down on the previous period.", 0.5)}
          {num("highRatio", "High performing at", "× the average of similar scripts.", 0.05)}
          {num("performingRatio", "Performing at", "× the average of similar scripts.", 0.05)}
          {num("underRatio", "Underperforming below", "× the average of similar scripts.", 0.05)}
        </div>
        <label className="block">
          <span className="text-[12px] font-bold text-gray-700">Delivery offer (fills {"{{delivery_offer}}"})</span>
          <input value={draft.deliveryOffer} onChange={(event) => setDraft({ ...draft, deliveryOffer: event.target.value })} placeholder="e.g. Free delivery within Lagos this week" className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm" />
        </label>
        {library ? (
          <details className="rounded-lg border border-gray-200 p-3">
            <summary className="cursor-pointer text-[12px] font-bold text-gray-700">A different delivery offer for a product</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {library.products.map((product) => (
                <label key={product.id} className="block text-[12px]">
                  <span className="font-semibold text-gray-700">{product.name}</span>
                  <input value={draft.productDeliveryOffers[product.id] ?? ""} placeholder="Same as above"
                    onChange={(event) => setDraft({ ...draft, productDeliveryOffers: { ...draft.productDeliveryOffers, [product.id]: event.target.value } })}
                    className="mt-0.5 h-8 w-full rounded-lg border border-gray-200 px-2 text-sm" />
                </label>
              ))}
            </div>
          </details>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="text-[12px] font-bold text-gray-700">Must communicate (pre-filled on new scripts, one per line)</span>
            <textarea rows={4} value={draft.defaultMustSay.join("\n")} onChange={(event) => setDraft({ ...draft, defaultMustSay: event.target.value.split("\n") })} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" />
          </label>
          <label className="block"><span className="text-[12px] font-bold text-gray-700">Never say (pre-filled on new scripts, one per line)</span>
            <textarea rows={4} value={draft.defaultNeverSay.join("\n")} onChange={(event) => setDraft({ ...draft, defaultNeverSay: event.target.value.split("\n") })} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" />
          </label>
        </div>
        {error ? <p className="m-0 text-[12px] font-semibold text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="!min-h-0 rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700">Cancel</button>
          <button type="button" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const offers = Object.fromEntries(Object.entries(draft.productDeliveryOffers).filter(([, value]) => value.trim()));
              await salesScriptingApi.saveSettings({ ...draft, productDeliveryOffers: offers });
              await onSaved();
            } catch (err: any) { setError(err?.message ?? "Could not save."); setBusy(false); }
          }} className="!min-h-0 rounded-lg bg-[#1F8FE0] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Save settings</button>
        </div>
      </div>
    </Modal>
  );
}
