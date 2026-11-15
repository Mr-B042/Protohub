import { useEffect, useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { trackingHubApi } from "../../lib/api";
import { Card, Toggle, smallButton } from "./HubParts";

/**
 * Ad accounts from other branches (Bright, 15 Nov 2026: "let 2nd Designers
 * Deluxe be available in Zambia"). Spend is read once by the account's home
 * branch; a campaign counts here only on proof (this branch's orders carry
 * it, its landing page sells this branch's product, or it is mapped here by
 * hand). Booked expenses stay in the home branch, in its currency.
 */
/**
 * The rate Zambia books naira ad spend at (Bright, 15 Nov 2026): kwacha in the
 * books with the naira amount underneath. Default = recent mid-market rate.
 */
function RateEditor({ onToast }: { onToast: (text: string) => void }) {
  const [rate, setRate] = useState<Awaited<ReturnType<typeof trackingHubApi.currencyRate>>["rate"]>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { trackingHubApi.currencyRate("NGN", "ZMW").then((r) => { setRate(r.rate); setValue(r.rate ? String(r.rate.fromPerTo) : ""); }).catch(() => undefined); }, []);
  if (!rate) return null;
  const n = Number(value.replace(/,/g, ""));
  const save = async () => {
    setSaving(true);
    try { const r = await trackingHubApi.setCurrencyRate("NGN", "ZMW", n); setRate(r.rate); onToast(`Saved: ₦${n} = K1. This month's ad expenses were re-booked at it.`); }
    catch (err: any) { onToast(err?.message ?? "Could not save the rate."); } finally { setSaving(false); }
  };
  return (
    <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5 dark:border-blue-900 dark:bg-blue-950/20">
      <b className="block text-[13px] text-gray-900 dark:text-slate-100">Booking rate: naira ad spend in kwacha</b>
      <span className="block text-[12px] text-gray-600 dark:text-slate-400">A naira account's campaigns that count in a kwacha branch are booked in kwacha, with the naira amount shown underneath. {rate.isDefault ? rate.source : `Set by ${rate.setBy ?? "you"}${rate.updatedAt ? ` on ${new Date(rate.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}`}.</span>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="font-semibold">₦</span>
        <input aria-label="Naira per kwacha" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ""))} className="h-9 w-28 rounded-lg border border-gray-200 bg-white px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900" />
        <span className="font-semibold">= K1</span>
        {n > 0 && <span className="text-[12px] text-gray-500">(₦10,000 = K{(10000 / n).toLocaleString("en", { maximumFractionDigits: 2 })})</span>}
        <button type="button" className={smallButton} disabled={saving || !(n > 0) || n === rate.fromPerTo} onClick={() => void save()}>{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save rate</button>
      </div>
    </div>
  );
}

export default function SharedAdAccounts({ onToast, localAccountIds }: { onToast: (text: string) => void; localAccountIds?: Set<string> }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof trackingHubApi.adAccountShares>> | null>(null);
  const [busy, setBusy] = useState("");
  const load = () => trackingHubApi.adAccountShares().then(setData).catch(() => setData({ accounts: [], campaignsHere: 0 }));
  useEffect(() => { void load(); }, []);
  if (!data || data.accounts.length === 0) return null;
  // Accounts of a business connected here are switched on in that business's card instead.
  const list = data.accounts.filter((a) => !localAccountIds?.has(a.accountId));
  const ngnShared = data.accounts.some((a) => a.shared && a.currency === "NGN") || list.some((a) => a.currency === "NGN");
  if (!list.length && !ngnShared) return null;
  const toggle = async (accountId: string, on: boolean, name: string) => {
    setBusy(accountId);
    try { await trackingHubApi.setAdAccountShare(accountId, on); onToast(on ? `${name} is now used here. Its campaigns count here once this branch's orders or pages prove them.` : `${name} is no longer used here.`); await load(); }
    catch (err: any) { onToast(err?.message ?? "Could not change it."); }
    finally { setBusy(""); }
  };
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40"><Share2 className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">Ad accounts from other branches</h2>
          <p className="m-0 mt-0.5 text-[12.5px] text-gray-600 dark:text-slate-400">
            Use an ad account that runs campaigns for this branch too. Its spend is read once; each campaign counts in one branch only. Here it counts when this branch's orders carry it, its landing page sells one of this branch's products, or you map it to one by hand. Everything else stays in its home branch. Ad expenses are booked in the branch each campaign counts in; naira spend booked in a kwacha branch is converted at the rate below, the naira amount kept underneath.
          </p>
          {data.campaignsHere > 0 && <p className="m-0 mt-1 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">{data.campaignsHere} campaign{data.campaignsHere === 1 ? "" : "s"} from shared accounts count here now.</p>}
          {list.length > 0 && <ul className="m-0 mt-3 list-none space-y-2 p-0">
            {list.map((a) => (
              <li key={a.accountId} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 px-3 py-2.5 dark:border-slate-700">
                <span className="min-w-0 flex-1">
                  <b className="block text-[13.5px] text-gray-900 dark:text-slate-100">{a.name}</b>
                  <span className="block text-[11.5px] text-gray-500">act_{a.accountId} · home: {a.homeBranch}{a.currency ? ` · spends in ${a.currency}` : ""}</span>
                </span>
                <span className="flex items-center gap-2 text-[12.5px] text-gray-700 dark:text-slate-300">{a.shared ? "Used here" : "Not used here"}<Toggle checked={a.shared} disabled={busy === a.accountId} onChange={(on) => void toggle(a.accountId, on, a.name)} /></span>
              </li>
            ))}
          </ul>}
          {ngnShared && <RateEditor onToast={onToast} />}
        </div>
      </div>
    </Card>
  );
}
