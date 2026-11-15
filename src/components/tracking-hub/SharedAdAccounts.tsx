import { useEffect, useState } from "react";
import { Share2 } from "lucide-react";
import { trackingHubApi } from "../../lib/api";
import { Card, Toggle } from "./HubParts";

/**
 * Ad accounts from other branches (Bright, 15 Nov 2026: "let 2nd Designers
 * Deluxe be available in Zambia"). Spend is read once by the account's home
 * branch; a campaign counts here only on proof (this branch's orders carry
 * it, its landing page sells this branch's product, or it is mapped here by
 * hand). Booked expenses stay in the home branch, in its currency.
 */
export default function SharedAdAccounts({ onToast }: { onToast: (text: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof trackingHubApi.adAccountShares>> | null>(null);
  const [busy, setBusy] = useState("");
  const load = () => trackingHubApi.adAccountShares().then(setData).catch(() => setData({ accounts: [], campaignsHere: 0 }));
  useEffect(() => { void load(); }, []);
  if (!data || data.accounts.length === 0) return null;
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
            Use an ad account that runs campaigns for this branch too. Its spend is read once; each campaign counts in one branch only. Here it counts when this branch's orders carry it, its landing page sells one of this branch's products, or you map it to one by hand. Everything else stays in its home branch. Booked ad expenses stay in the home branch, in its currency.
          </p>
          {data.campaignsHere > 0 && <p className="m-0 mt-1 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">{data.campaignsHere} campaign{data.campaignsHere === 1 ? "" : "s"} from shared accounts count here now.</p>}
          <ul className="m-0 mt-3 list-none space-y-2 p-0">
            {data.accounts.map((a) => (
              <li key={a.accountId} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 px-3 py-2.5 dark:border-slate-700">
                <span className="min-w-0 flex-1">
                  <b className="block text-[13.5px] text-gray-900 dark:text-slate-100">{a.name}</b>
                  <span className="block text-[11.5px] text-gray-500">act_{a.accountId} · home: {a.homeBranch}{a.currency ? ` · spends in ${a.currency}` : ""}</span>
                </span>
                <span className="flex items-center gap-2 text-[12.5px] text-gray-700 dark:text-slate-300">{a.shared ? "Used here" : "Not used here"}<Toggle checked={a.shared} disabled={busy === a.accountId} onChange={(on) => void toggle(a.accountId, on, a.name)} /></span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
