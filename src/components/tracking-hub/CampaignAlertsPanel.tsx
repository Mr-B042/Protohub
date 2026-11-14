import { useEffect, useState } from "react";
import { AlertOctagon, ChevronDown, Eye, Flame, Loader2, RefreshCw, TrendingDown, Wrench } from "lucide-react";
import { trackingHubApi, type CampaignDrought, type CampaignDroughtGroup, type CampaignMoneyAlert } from "../../lib/api";

/**
 * Campaigns with no order for 3 days (Bright, 5 Nov 2026), on top of Ad
 * Spend. Grouped by cost per order since the campaign started: Turn off /
 * Watch / Check and adjust. Rules: backend lib/campaign-drought.ts.
 */

const GROUPS: Record<CampaignDroughtGroup, { title: string; rule: string; tone: string; head: string; Icon: typeof Eye }> = {
  off: { title: "Turn off", rule: "Over ₦7,500 per order since it started, or no order at all", tone: "border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/10", head: "text-rose-700 dark:text-rose-300", Icon: AlertOctagon },
  watch: { title: "Watch", rule: "₦6,500 - ₦7,500 per order since it started", tone: "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10", head: "text-amber-700 dark:text-amber-300", Icon: Eye },
  adjust: { title: "Check and adjust", rule: "Under ₦6,500 per order since it started: it has been worth it", tone: "border-sky-200 bg-sky-50/60 dark:border-sky-500/30 dark:bg-sky-500/10", head: "text-sky-700 dark:text-sky-300", Icon: Wrench }
};
const ORDER: CampaignDroughtGroup[] = ["off", "watch", "adjust"];
const money = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

export default function CampaignAlertsPanel({ focus }: { focus?: string | null }) {
  const [droughts, setDroughts] = useState<CampaignDrought[] | null>(null);
  const [moneyAlerts, setMoneyAlerts] = useState<CampaignMoneyAlert[]>([]);
  const [meta, setMeta] = useState<{ checkedAt: string; unchecked: number } | null>(null);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setBusy(true);
    trackingHubApi.campaignAlerts(tick > 0)
      .then((result) => { if (live) { setDroughts(result.droughts); setMoneyAlerts(result.money ?? []); setMeta({ checkedAt: result.checkedAt, unchecked: result.unchecked ?? 0 }); setError(""); } })
      .catch((err: Error) => { if (live) setError(err.message || "Could not check the campaigns."); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [tick]);

  // Live with Meta: only campaigns with an ad delivering right now (Bright, 5 Nov 2026).
  const footer = meta && (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-gray-500 dark:text-slate-400">
      <span>Checked live with Meta at {new Date(meta.checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}: only campaigns with an ad delivering right now are listed.{meta.unchecked > 0 ? ` ${meta.unchecked} could not be checked with Meta, so they are left out.` : ""}</span>
      <button type="button" onClick={() => setTick((n) => n + 1)} disabled={busy}
        className="!min-h-0 inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Check again
      </button>
    </div>
  );

  if (error) return <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-800">Could not check campaigns for missing orders: {error}</p>;
  if (!droughts) return null;
  const moneyBox = moneyAlerts.length > 0 && <MoneyAlerts alerts={moneyAlerts} focus={focus} />;
  if (droughts.length === 0) {
    return (
      <div className="space-y-3">
        {moneyBox}
        <div className="space-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <p className="m-0 text-[13px] font-semibold text-emerald-800 dark:text-emerald-200">Every campaign delivering right now has had an order in the last 3 full days.</p>
          {footer}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
    {moneyBox}
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
        className="!min-h-0 flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-left">
        <span className="flex items-center gap-2">
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-2 text-[12px] font-extrabold text-white">{droughts.length}</span>
          <b className="text-[15px] text-gray-900 dark:text-slate-50">Campaign{droughts.length === 1 ? "" : "s"} with no order for 3+ full days</b>
        </span>
        <span className="flex items-center gap-3 text-[12.5px] font-bold">
          {ORDER.map((group) => {
            const count = droughts.filter((d) => d.group === group).length;
            return count ? <span key={group} className={GROUPS[group].head}>{count} {GROUPS[group].title.toLowerCase()}</span> : null;
          })}
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && <div className="px-5 pb-2">{footer}</div>}
      {open && (
        <div className="grid grid-cols-1 gap-3 px-5 pb-5 lg:grid-cols-3">
          {ORDER.map((group) => {
            const rows = droughts.filter((d) => d.group === group);
            const meta = GROUPS[group];
            return (
              <div key={group} className={`rounded-xl border p-3 ${meta.tone}`}>
                <div className={`flex items-center gap-1.5 text-[13px] font-extrabold ${meta.head}`}><meta.Icon className="h-4 w-4" />{meta.title} · {rows.length}</div>
                <p className="m-0 mt-0.5 text-[11.5px] text-gray-500 dark:text-slate-400">{meta.rule}</p>
                {rows.length === 0 && <p className="m-0 mt-3 text-[12.5px] text-gray-500">None.</p>}
                <ul className="m-0 mt-2 list-none space-y-2 p-0">
                  {rows.map((row) => (
                    <li key={row.campaignId} className={`rounded-lg bg-white p-2.5 text-[12.5px] shadow-sm dark:bg-slate-900 ${focus && row.episodeKey === focus ? "ring-2 ring-blue-500" : ""}`}>
                      <b className="block break-words text-[13px] text-gray-900 dark:text-slate-50">{row.campaignName}</b>
                      <span className="block text-[11.5px] text-gray-500 dark:text-slate-400">{row.accountName}{row.productName ? ` · ${row.productName}` : ""}{row.platform === "tiktok" ? " · TikTok" : ""}</span>
                      <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-semibold text-gray-800 dark:text-slate-200">
                        <span className="text-rose-600">No order: {row.daysWithoutOrder} full day{row.daysWithoutOrder === 1 ? "" : "s"} running</span>
                        <span>{money(row.spendSinceLastOrder)} spent since {row.lastOrderDay ? "the last order" : "it started"}</span>
                        <span>{row.cpa === null ? "No order yet" : `${money(row.cpa)} per order since start`}</span>
                      </span>
                      {/* Ads Manager's day rows stop at yesterday: say what of this is today (Bright, 6 Nov 2026). */}
                      {(row.todaySpend ?? 0) >= 1 && <span className="mt-0.5 block text-[11.5px] text-gray-500 dark:text-slate-400">Includes today's {money(row.todaySpend ?? 0)} so far. Only full days the campaign ran are counted: not today, not days it was switched off, nor the day it was switched back on.</span>}
                      <span className="mt-1 block text-gray-600 dark:text-slate-400">{row.advice}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
    </div>
  );
}

/**
 * Money alerts (Bright, 14 Nov 2026): a campaign can burn ₦30,000+ in two
 * days before the 3-day no-order rule speaks. Rules: campaign-drought.ts.
 */
function MoneyAlerts({ alerts, focus }: { alerts: CampaignMoneyAlert[]; focus?: string | null }) {
  const burn = alerts.filter((m) => m.kind === "burn"), pricey = alerts.filter((m) => m.kind === "pricey");
  const campaigns = new Set(alerts.map((m) => m.campaignId)).size;
  const block = (rows: CampaignMoneyAlert[], title: string, rule: string, Icon: typeof Flame, tone: string, head: string) => rows.length > 0 && (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className={`flex items-center gap-1.5 text-[13px] font-extrabold ${head}`}><Icon className="h-4 w-4" />{title} · {rows.length}</div>
      <p className="m-0 mt-0.5 text-[11.5px] text-gray-500 dark:text-slate-400">{rule}</p>
      <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-2 p-0 lg:grid-cols-2">
        {rows.map((row) => (
          <li key={row.episodeKey} className={`rounded-lg bg-white p-2.5 text-[12.5px] shadow-sm dark:bg-slate-900 ${focus && row.episodeKey === focus ? "ring-2 ring-blue-500" : ""}`}>
            <b className="block break-words text-[13px] text-gray-900 dark:text-slate-50">{row.campaignName}</b>
            <span className="block text-[11.5px] text-gray-500 dark:text-slate-400">{row.accountName}{row.productName ? ` · ${row.productName}` : ""}{row.platform === "tiktok" ? " · TikTok" : ""}</span>
            <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-semibold text-gray-800 dark:text-slate-200">
              {row.kind === "burn"
                ? <><span className="text-rose-600">{money(row.spend)} spent, no order</span>{row.todaySpend >= 1 && <span>today {money(row.todaySpend)} so far</span>}</>
                : <><span className="text-rose-600">{money(row.costPerOrder ?? 0)} per order</span><span>{money(row.spend)} for {row.orders} order{row.orders === 1 ? "" : "s"}</span></>}
            </span>
            <span className="mt-1 block text-gray-600 dark:text-slate-400">{row.advice}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <section className="space-y-3 rounded-2xl border border-rose-200 bg-white p-4 shadow-sm dark:border-rose-500/30 dark:bg-slate-900">
      <b className="flex items-center gap-2 text-[15px] text-gray-900 dark:text-slate-50"><span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-2 text-[12px] font-extrabold text-white">{campaigns}</span>Campaign{campaigns === 1 ? "" : "s"} spending too much per order</b>
      {block(burn, "Spending with no order", "Over ₦7,500 spent since the last order (or since it was switched on), today included", Flame, "border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/10", "text-rose-700 dark:text-rose-300")}
      {block(pricey, "Too expensive", "Over ₦7,500 per order over the last 2 full days, even with orders", TrendingDown, "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10", "text-amber-700 dark:text-amber-300")}
    </section>
  );
}
