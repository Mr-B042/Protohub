import { useEffect, useState, type ComponentType } from "react";
import { AlertOctagon, ChevronDown, Eye, Loader2, PauseCircle, RefreshCw, Rocket, SearchCheck } from "lucide-react";
import { trackingHubApi, type CampaignVerdict, type CampaignVerdictKind } from "../../lib/api";

/**
 * Campaign decisions (Bright, 15 Nov 2026): ONE decision per running campaign,
 * judged by its product's BREAK-EVEN cost per order and its delivered sales,
 * never by CPC. Replaces the 3-day / money lists that could say "turn it off"
 * and "it has been worth it" about the same campaign. Rules: backend
 * lib/campaign-verdict.ts.
 */

type Group = { title: string; rule: string; tone: string; head: string; Icon: ComponentType<{ className?: string }> };
const GROUPS: Record<Exclude<CampaignVerdictKind, "keep">, Group> = {
  turn_off: { title: "Turn off", rule: "2× break-even spent with no order, or above break-even lately AND since it started", tone: "border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/10", head: "text-rose-700 dark:text-rose-300", Icon: AlertOctagon },
  pause: { title: "Pause & check", rule: "1.5× break-even spent with no order, or deliveries losing money", tone: "border-orange-200 bg-orange-50/60 dark:border-orange-500/30 dark:bg-orange-500/10", head: "text-orange-700 dark:text-orange-300", Icon: PauseCircle },
  check_tracking: { title: "Check tracking", rule: "Meta counts purchases but no order reached Protohub", tone: "border-violet-200 bg-violet-50/60 dark:border-violet-500/30 dark:bg-violet-500/10", head: "text-violet-700 dark:text-violet-300", Icon: SearchCheck },
  watch: { title: "Watch", rule: "Close to break-even, a bad few days, or over 1× break-even with no order", tone: "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10", head: "text-amber-700 dark:text-amber-300", Icon: Eye },
  scale: { title: "Scale", rule: "Well under break-even (70% or less) with 3+ orders in 3 days", tone: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10", head: "text-emerald-700 dark:text-emerald-300", Icon: Rocket }
};
const SHOWN: Array<Exclude<CampaignVerdictKind, "keep">> = ["turn_off", "pause", "check_tracking", "watch", "scale"];
const money = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

function VerdictCard({ row, focused }: { row: CampaignVerdict; focused: boolean }) {
  const pct = row.recentCpo !== null ? Math.round((row.recentCpo / row.yardstick) * 100) : null;
  return (
    <li className={`rounded-lg bg-white p-2.5 text-[12.5px] shadow-sm dark:bg-slate-900 ${focused ? "ring-2 ring-blue-500" : ""}`}>
      <b className="block break-words text-[13px] text-gray-900 dark:text-slate-50">{row.campaignName}</b>
      <span className="block text-[11.5px] text-gray-500 dark:text-slate-400">{row.accountName}{row.productName ? ` · ${row.productName}` : ""}{row.platform === "tiktok" ? " · TikTok" : ""}</span>
      <span className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px] text-gray-600 dark:text-slate-400">
        <span>Break-even: <b className="text-gray-900 dark:text-slate-100">{money(row.yardstick)}</b>{row.yardstickKnown ? (row.targetSource === "set_by_you" ? " (your target)" : "") : " (not known: ₦7,500)"}</span>
        <span>Last 3 days: <b className={pct !== null && pct > 100 ? "text-rose-600" : "text-gray-900 dark:text-slate-100"}>{row.recentCpo !== null ? `${money(row.recentCpo)}/order` : "no order"}</b>{pct !== null ? ` (${pct}%)` : ""}</span>
        <span>Since last order: <b className="text-gray-900 dark:text-slate-100">{money(row.spendSinceLastOrder)}</b>{row.todaySpend >= 1 ? ` · today ${money(row.todaySpend)}` : ""}</span>
        <span>Since start: <b className="text-gray-900 dark:text-slate-100">{row.lifetimeCpo !== null ? `${money(row.lifetimeCpo)}/order` : "no order"}</b>{row.orders ? ` · ${row.delivered}/${row.orders} delivered` : ""}</span>
      </span>
      <span className="mt-1.5 block text-gray-800 dark:text-slate-200">{row.reason}</span>
      <span className="mt-0.5 block font-semibold text-gray-900 dark:text-slate-100">{row.action}</span>
    </li>
  );
}

export default function CampaignAlertsPanel({ focus }: { focus?: string | null }) {
  const [verdicts, setVerdicts] = useState<CampaignVerdict[] | null>(null);
  const [meta, setMeta] = useState<{ checkedAt: string; unchecked: number; accounts: Array<{ name: string; message: string }> } | null>(null);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setBusy(true);
    trackingHubApi.campaignAlerts(tick > 0)
      .then((result) => { if (live) { setVerdicts(result.verdicts ?? []); setMeta({ checkedAt: result.checkedAt, unchecked: result.unchecked ?? 0, accounts: result.uncheckedAccounts ?? [] }); setError(""); } })
      .catch((err: Error) => { if (live) setError(err.message || "Could not check the campaigns."); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [tick]);

  if (error) return <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-800">Could not check the campaigns: {error}</p>;
  if (!verdicts) return null;
  const keep = verdicts.filter((v) => v.verdict === "keep").length;
  const urgent = verdicts.filter((v) => v.verdict === "turn_off" || v.verdict === "pause" || v.verdict === "check_tracking").length;
  const listed = verdicts.filter((v) => v.verdict !== "keep");

  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
        className="!min-h-0 flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-left">
        <span className="flex items-center gap-2">
          {urgent > 0 && <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-2 text-[12px] font-extrabold text-white">{urgent}</span>}
          <span>
            <b className="block text-[15px] text-gray-900 dark:text-slate-50">Campaign decisions</b>
            <span className="block text-[12px] text-gray-500 dark:text-slate-400">Judged by each product's break-even cost per order and delivered sales, never by CPC alone.</span>
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-3 text-[12.5px] font-bold">
          {SHOWN.map((k) => { const n = verdicts.filter((v) => v.verdict === k).length; return n ? <span key={k} className={GROUPS[k].head}>{n} {GROUPS[k].title.toLowerCase()}</span> : null; })}
          <span className="text-gray-500">{keep} keep</span>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="space-y-3 px-5 pb-5">
          {meta && (
            <div className="flex flex-wrap items-start justify-between gap-2 text-[11.5px] text-gray-500 dark:text-slate-400">
              <span className="min-w-0 flex-1">
                Checked live with Meta at {new Date(meta.checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}: only campaigns with an ad delivering right now.
                {meta.unchecked > 0 && <span className="block font-semibold text-amber-700 dark:text-amber-300">{meta.unchecked} campaign{meta.unchecked === 1 ? "" : "s"} could not be checked{meta.accounts.length ? `: Meta did not answer for ${meta.accounts.map((a) => `${a.name} (${a.message})`).join("; ")}` : ""}. Press Check again.</span>}
              </span>
              <button type="button" onClick={() => setTick((n) => n + 1)} disabled={busy}
                className="!min-h-0 inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Check again
              </button>
            </div>
          )}
          {listed.length === 0 && <p className="m-0 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 text-[13px] font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">Every campaign delivering right now is under its break-even. Keep them running.</p>}
          {SHOWN.map((k) => {
            const rows = verdicts.filter((v) => v.verdict === k);
            if (!rows.length) return null;
            const g = GROUPS[k];
            return (
              <div key={k} className={`rounded-xl border p-3 ${g.tone}`}>
                <div className={`flex items-center gap-1.5 text-[13px] font-extrabold ${g.head}`}><g.Icon className="h-4 w-4" />{g.title} · {rows.length}</div>
                <p className="m-0 mt-0.5 text-[11.5px] text-gray-500 dark:text-slate-400">{g.rule}</p>
                <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-2 p-0 lg:grid-cols-2">
                  {rows.map((row) => <VerdictCard key={row.campaignId} row={row} focused={Boolean(focus && row.episodeKey === focus)} />)}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
