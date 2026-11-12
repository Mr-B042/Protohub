import { useEffect, useState } from "react";
import { AlertTriangle, Bell, BellOff, CheckCircle2, ChevronDown, CreditCard, Loader2, RefreshCw, Wallet } from "lucide-react";
import { trackingHubApi, type AdFundsAccount, type AdFundsView } from "../../lib/api";

/**
 * Ad account funds (Bright, 12 Nov 2026: "alert whenever my ads account is
 * low of funds like minimum of 5000 so I can fund it ... add off and on").
 * Money left per Meta ad account, read every 30 minutes; the alert goes to
 * whoever Settings › Alert routing picks for "Ad account low on funds".
 */

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
const lagosTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });

function sourceText(row: AdFundsAccount) {
  if (row.source === "prepaid") return "Prepaid balance";
  if (row.source === "spend_limit") return "Left of the account spending limit";
  if (!row.fundingText) return "No payment method added in Meta yet";
  return "Card charged after spending, no limit set";
}

function AccountCard({ row, threshold }: { row: AdFundsAccount; threshold: number }) {
  const low = row.lowReason === "low";
  const unpaid = row.lowReason === "unpaid";
  const tone = unpaid || low ? "border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10" : "border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900";
  return (
    <div className={`rounded-xl border px-3.5 py-3 ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <b className="min-w-0 truncate text-[13.5px] text-gray-900 dark:text-slate-50" title={row.name}>{row.name}</b>
        {unpaid ? <span className="shrink-0 rounded-md bg-rose-600 px-2 py-0.5 text-[11.5px] font-bold text-white">Ads stopped</span>
          : low ? <span className="shrink-0 rounded-md bg-rose-600 px-2 py-0.5 text-[11.5px] font-bold text-white">Low · add funds</span>
            : row.fundsLeft !== null ? <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">OK</span> : null}
      </div>
      {unpaid ? (
        <p className="m-0 mt-1 text-[12.5px] text-rose-800 dark:text-rose-200">Meta could not take payment. Pay the bill in Ads Manager › Billing to restart the ads.</p>
      ) : (
        <>
          <span className={`mt-1 block text-[22px] font-extrabold leading-7 ${low ? "text-rose-600 dark:text-rose-300" : "text-gray-900 dark:text-slate-50"}`}>
            {row.fundsLeft === null ? <span className="text-[15px] font-semibold text-gray-500">{row.fundingText ? "No limit to run out of" : "Not set up for payment"}</span> : row.currency === "NGN" ? naira(row.fundsLeft) : `${row.currency} ${row.fundsLeft.toLocaleString()}`}
          </span>
          <span className="flex items-center gap-1 text-[11.5px] text-gray-500 dark:text-slate-400">
            {row.fundsLeft === null ? <CreditCard className="h-3 w-3" /> : <Wallet className="h-3 w-3" />}{sourceText(row)}
            {low && row.fundsLeft !== null && <> · {naira(threshold - row.fundsLeft)} under your level</>}
          </span>
        </>
      )}
      {row.error && <p className="m-0 mt-1.5 text-[11.5px] text-amber-700 dark:text-amber-300">Last read failed: {row.error}{row.checkedAt ? ` (showing ${lagosTime(row.checkedAt)})` : ""}</p>}
    </div>
  );
}

export default function AdFundsPanel({ onToast, focus }: { onToast: (message: string) => void; focus?: boolean }) {
  const [view, setView] = useState<AdFundsView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "check" | "save">("");
  const [open, setOpen] = useState(true);
  const [level, setLevel] = useState("");

  const take = (next: AdFundsView) => { setView(next); setLevel(String(next.settings.threshold)); setError(""); };
  useEffect(() => {
    let live = true;
    trackingHubApi.adFunds()
      .then(async (next) => {
        if (!live) return;
        take(next);
        // Nothing read yet (just switched on): ask Meta now instead of waiting 30 minutes.
        if (next.accounts.length === 0 && next.unchecked > 0) { setBusy("check"); const fresh = await trackingHubApi.checkAdFunds(); if (live) take(fresh); }
      })
      .catch((err: Error) => { if (live) setError(err.message || "Could not load the ad account funds."); })
      .finally(() => { if (live) setBusy(""); });
    return () => { live = false; };
  }, []);
  useEffect(() => { if (focus) document.getElementById("ad-funds-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [focus, view !== null]);

  const save = async (body: { enabled?: boolean; threshold?: number }, message: string) => {
    setBusy("save");
    try { take(await trackingHubApi.saveAdFundsSettings(body)); onToast(message); }
    catch (err) { onToast((err as Error).message || "Could not save."); }
    finally { setBusy(""); }
  };
  const check = async () => {
    setBusy("check");
    try { take(await trackingHubApi.checkAdFunds()); }
    catch (err) { onToast((err as Error).message || "Could not check the ad accounts."); }
    finally { setBusy(""); }
  };

  if (error) return <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-800">Could not load the ad account funds: {error}</p>;
  if (!view) return null;
  const { settings, accounts } = view;
  const lowCount = accounts.filter((row) => row.lowReason).length;
  const levelNumber = Math.round(Number(level.replace(/[^\d.]/g, "")));
  const levelChanged = Number.isFinite(levelNumber) && levelNumber >= 0 && levelNumber !== settings.threshold && level.trim() !== "";
  const lastRead = accounts.map((row) => row.checkedAt).filter(Boolean).sort().pop() ?? null;

  return (
    <section id="ad-funds-panel" className={`rounded-2xl border bg-white shadow-sm dark:bg-slate-900 ${lowCount ? "border-rose-200 dark:border-rose-500/30" : "border-gray-200 dark:border-slate-800"}`}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="!min-h-0 mr-auto flex min-w-0 items-center gap-2.5 text-left">
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${lowCount ? "bg-rose-50 text-rose-600 dark:bg-rose-500/15" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15"}`}>
            {lowCount ? <AlertTriangle className="h-[18px] w-[18px]" /> : <Wallet className="h-[18px] w-[18px]" />}
          </span>
          <span className="min-w-0">
            <b className="block text-[15px] text-gray-900 dark:text-slate-50">Ad account funds</b>
            <span className={`block text-[12.5px] ${lowCount ? "font-semibold text-rose-700 dark:text-rose-300" : "text-gray-500 dark:text-slate-400"}`}>
              {lowCount ? (lowCount === 1 ? "1 account needs funding" : `${lowCount} accounts need funding`) : accounts.length ? `All ${accounts.length} accounts above ${naira(settings.threshold)}` : "Not read yet"}
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        <label className="flex items-center gap-1.5 text-[12.5px] text-gray-600 dark:text-slate-300">
          Alert me below
          <span className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12.5px] text-gray-500">₦</span>
            <input value={level} inputMode="numeric" onChange={(event) => setLevel(event.target.value)} aria-label="Low funds level in naira"
              onKeyDown={(event) => { if (event.key === "Enter" && levelChanged) void save({ threshold: levelNumber }, `Low funds level set to ${naira(levelNumber)}.`); }}
              className="w-[96px] rounded-lg border border-gray-200 bg-white py-1.5 pl-5 pr-2 text-[13px] font-semibold dark:border-slate-700 dark:bg-slate-900" />
          </span>
          {levelChanged && (
            <button type="button" disabled={busy !== ""} onClick={() => save({ threshold: levelNumber }, `Low funds level set to ${naira(levelNumber)}.`)}
              className="!min-h-0 rounded-lg bg-[#5B3FD9] px-2.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50">Save</button>
          )}
        </label>

        <button type="button" role="switch" aria-checked={settings.enabled} aria-label="Low funds alerts" disabled={busy !== ""}
          onClick={() => save({ enabled: !settings.enabled }, settings.enabled ? "Low funds alerts are off." : "Low funds alerts are on.")}
          className={`!min-h-0 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-bold disabled:opacity-60 ${settings.enabled
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
            : "border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"}`}>
          {settings.enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
          Alerts {settings.enabled ? "on" : "off"}
          <span className={`relative h-4 w-7 rounded-full transition-colors ${settings.enabled ? "bg-emerald-500" : "bg-gray-300 dark:bg-slate-600"}`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${settings.enabled ? "left-3.5" : "left-0.5"}`} />
          </span>
        </button>
      </div>

      {open && (
        <div className="space-y-3 px-5 pb-4">
          {accounts.length === 0 && (
            <p className="m-0 rounded-xl border border-dashed border-gray-300 px-4 py-5 text-center text-[13px] text-gray-500 dark:border-slate-700">
              {busy === "check" ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Asking Meta how much is left in each account…</span> : "No switched-on Meta ad account has been read yet."}
            </p>
          )}
          {accounts.length > 0 && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {accounts.map((row) => <AccountCard key={row.accountId} row={row} threshold={settings.threshold} />)}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-gray-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {settings.enabled
                ? `Checked with Meta every 30 minutes${lastRead ? `, last at ${lagosTime(lastRead)}` : ""}. You are alerted the moment an account goes under ${naira(settings.threshold)}, then reminded every 6 hours in the day until it is funded. Who gets it: Settings › Alert routing › Ad account low on funds.`
                : "Alerts are off: the numbers still update every 30 minutes, but nobody is told."}
            </span>
            <button type="button" onClick={check} disabled={busy !== ""}
              className="!min-h-0 inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">
              {busy === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Check now
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
