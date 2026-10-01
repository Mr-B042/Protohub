import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Crown, PauseCircle } from "lucide-react";
import { Avatar, Panel, longDate, nf, pctText, shortDateTime } from "./WeeklyReportParts";
import { salesScriptApi, type HeadOfSalesRepInfluence, type HeadOfSalesReview } from "../lib/api";

/**
 * The Head of Sales bonus on the weekly report and the Owner's release of it
 * (Bright, 1 Oct 2026).
 *
 * Bright's question before her bonus is released: did she make the reps
 * better, or did they do it on their own? She writes the sales scripts (Sales
 * Scripting); once approved, reps record which upsell / cross-sell script they
 * used on each order. If she reaches a bonus level with no approved script
 * live, or nobody used one, the bonus is held until the Owner decides.
 */

/** Lilac crown badge that marks the Head of Sales Rep (Bright chose "Lilac queen"). */
export function HeadOfSalesBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800 dark:border-violet-400/30 dark:bg-violet-400/15 dark:text-violet-200 ${className}`}>
      <Crown className="h-3 w-3 text-violet-600 dark:text-violet-300" /> Head of Sales
    </span>
  );
}

/** Loads the Head of Sales review for a weekly-report week. */
export function useHeadOfSalesReview(weekStart: string, enabled: boolean) {
  const [review, setReview] = useState<HeadOfSalesReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!enabled || !weekStart) return;
    setLoading(true);
    setError("");
    try {
      setReview(await salesScriptApi.headReview(weekStart));
    } catch (err: any) {
      setError(err?.message ?? "Could not load the Head of Sales review.");
    } finally {
      setLoading(false);
    }
  }, [enabled, weekStart]);
  useEffect(() => { void load(); }, [load]);
  return { review: review && review.weekStart === weekStart ? review : null, loading, error, reload: load, setReview };
}

const SCRIPT_TYPE: Record<string, string> = { closing: "Closing", upsell: "Upsell", cross_sell: "Cross-sell", objection: "Objection" };

const VERDICT: Record<HeadOfSalesRepInfluence["verdict"], { label: string; tone: string }> = {
  influenced: { label: "Her influence", tone: "bg-violet-100 text-violet-800" },
  mixed: { label: "Partly her influence", tone: "bg-sky-50 text-sky-700" },
  own_effort: { label: "Own effort", tone: "bg-amber-50 text-amber-700" },
  no_improvement: { label: "No improvement", tone: "bg-gray-100 text-gray-600" },
  no_sales: { label: "No upsells", tone: "bg-gray-100 text-gray-500" }
};

/** One status for the whole bonus: what the Owner sees first. */
export function headOfSalesBonusStatus(review: HeadOfSalesReview | null) {
  if (!review?.head || !review.evaluation) return null;
  if (review.record?.status === "Paid") return { key: "paid", label: "Paid", tone: "bg-emerald-50 text-emerald-700" };
  if (review.release?.decision === "released") return { key: "released", label: "Released", tone: "bg-emerald-50 text-emerald-700" };
  if (review.release?.decision === "withheld") return { key: "withheld", label: "Withheld", tone: "bg-rose-50 text-rose-700" };
  if (review.evaluation.amount <= 0) return { key: "none", label: "No bonus this week", tone: "bg-gray-100 text-gray-600" };
  if (review.hold?.held) return { key: "held", label: "On hold", tone: "bg-amber-50 text-amber-800" };
  return { key: "ready", label: review.weekOver ? "Ready to release" : "Week still running", tone: "bg-blue-50 text-blue-700" };
}

export function HeadOfSalesReviewPanel({ review, loading, error, isOwner, sym = "₦", onDecide }: {
  review: HeadOfSalesReview | null;
  loading: boolean;
  error: string;
  isOwner: boolean;
  sym?: string;
  onDecide?: (body: { decision: "release" | "withhold"; upsellImprovement: boolean; initiativeSuccess: boolean; note: string }) => Promise<void>;
}) {
  const [upsellImprovement, setUpsellImprovement] = useState(false);
  const [initiativeSuccess, setInitiativeSuccess] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setUpsellImprovement(Boolean(review?.qualitative?.upsellImprovement));
    setInitiativeSuccess(Boolean(review?.qualitative?.initiativeSuccess));
    setNote("");
    setFormError("");
  }, [review?.weekStart, review?.qualitative?.upsellImprovement, review?.qualitative?.initiativeSuccess]);

  if (loading && !review) return <Panel className="p-6 text-sm text-gray-500">Loading the Head of Sales review…</Panel>;
  if (error && !review) return <Panel className="p-6 text-sm font-semibold text-rose-700">{error}</Panel>;
  if (!review?.head) return <Panel className="p-6 text-sm text-gray-500">Nobody is Head of Sales Rep, so there is no Head of Sales bonus this week.</Panel>;

  const status = headOfSalesBonusStatus(review);
  const reps = review.reps ?? [];
  const others = reps.filter((rep) => !rep.isHead);
  const influenced = others.filter((rep) => rep.verdict === "influenced" || rep.verdict === "mixed");
  const ownEffort = others.filter((rep) => rep.verdict === "own_effort");
  const decided = Boolean(review.release) || review.record?.status === "Paid";
  const canDecide = isOwner && !!onDecide && !decided && (review.evaluation?.amount ?? 0) > 0 && review.weekOver;

  const decide = async (decision: "release" | "withhold") => {
    setFormError("");
    if ((decision === "withhold" || review.hold?.held) && note.trim().length < 5) {
      setFormError(decision === "withhold" ? "Say why the bonus is withheld." : "This bonus is on hold. Say why you are releasing it anyway.");
      return;
    }
    setBusy(true);
    try {
      await onDecide!({ decision, upsellImprovement, initiativeSuccess, note: note.trim() });
    } catch (err: any) {
      setFormError(err?.message ?? "Could not save the decision.");
    } finally {
      setBusy(false);
    }
  };

  const rateCell = (now: number, before: number) => (
    <span className="whitespace-nowrap">
      <strong className={now > before ? "text-emerald-700" : now < before ? "text-rose-700" : "text-gray-800 dark:text-slate-200"}>{pctText(now)}</strong>
      <span className="ml-1 text-[11px] text-gray-400">was {pctText(before)}</span>
    </span>
  );

  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={review.head.name} size={40} />
            <div>
              <p className="m-0 flex flex-wrap items-center gap-2 text-base font-black text-gray-900 dark:text-slate-100">{review.head.name} <HeadOfSalesBadge /></p>
              <p className="m-0 mt-0.5 text-[12px] text-gray-500">Head of Sales bonus · week of {longDate(review.weekStart)}</p>
            </div>
          </div>
          {status ? <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.tone}`}>{status.label}</span> : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 px-3 py-2.5 dark:border-slate-700"><span className="block text-[11px] font-semibold uppercase text-gray-400">Bonus reached</span><strong className="text-lg text-gray-900 dark:text-slate-100">{sym}{nf(review.release ? review.release.amount : review.evaluation?.amount ?? 0)}</strong><span className="block text-[11px] text-gray-500">{review.evaluation?.label}</span></div>
          <div className="rounded-lg border border-gray-200 px-3 py-2.5 dark:border-slate-700"><span className="block text-[11px] font-semibold uppercase text-gray-400">Team order value</span><strong className="text-lg text-gray-900 dark:text-slate-100">{sym}{nf(review.team?.aov ?? 0)}</strong></div>
          <div className="rounded-lg border border-gray-200 px-3 py-2.5 dark:border-slate-700"><span className="block text-[11px] font-semibold uppercase text-gray-400">Team delivery rate</span><strong className="text-lg text-gray-900 dark:text-slate-100">{pctText(review.team?.deliveryRate ?? 0)}</strong></div>
          <div className="rounded-lg border border-gray-200 px-3 py-2.5 dark:border-slate-700"><span className="block text-[11px] font-semibold uppercase text-gray-400">Orders with the script</span><strong className="text-lg text-gray-900 dark:text-slate-100">{nf(review.scriptUses ?? 0)}</strong><span className="block text-[11px] text-gray-500">recorded by other reps</span></div>
        </div>
        {review.hold?.held && !decided ? (
          <div className="mt-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
            <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div><strong>On hold for the Owner.</strong> {review.hold.reasons.join(" ")}</div>
          </div>
        ) : null}
        {review.release ? (
          <div className={`mt-4 flex gap-2 rounded-lg border p-3 text-[13px] ${review.release.decision === "released" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
            {review.release.decision === "released" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <div>
              <strong>{review.release.decision === "released" ? `Released ${sym}${nf(review.release.amount)}` : "Withheld"}</strong> by {review.release.decidedBy ?? "the Owner"} · {shortDateTime(review.release.decidedAt)}
              {review.release.wasHeld ? " · it was on hold" : ""}{review.release.note ? <span className="block">“{review.release.note}”</span> : null}
              {review.release.decision === "released" && review.record?.status !== "Paid" ? <span className="block text-[12px]">Mark it paid on Head of Sales Rep → Bonus &amp; Payouts.</span> : null}
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Were approved scripts live and used this week?</h3>
          {(review.scripts?.live ?? 0) > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> {nf(review.scripts!.live)} approved script{review.scripts!.live === 1 ? "" : "s"} live</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700"><AlertTriangle className="h-3.5 w-3.5" /> No approved script</span>
          )}
        </div>
        {(review.scripts?.used ?? []).length === 0 ? (
          <p className="m-0 mt-2 text-[13px] text-gray-500">No rep recorded using a script on an order this week.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="!min-w-[560px] w-full text-left text-[13px]">
              <thead><tr className="text-[11px] uppercase tracking-wide text-gray-400"><th className="px-2 py-2">Script</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Used</th><th className="px-2 py-2">Customer said yes</th><th className="px-2 py-2">By other reps</th></tr></thead>
              <tbody>
                {review.scripts!.used.map((row) => (
                  <tr key={row.scriptId} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit]">
                    <td className="px-2 py-2"><strong>{row.title}</strong><span className="block text-[11px] text-gray-500">{row.productName}</span></td>
                    <td className="px-2 py-2">{SCRIPT_TYPE[row.category] ?? row.category}</td>
                    <td className="px-2 py-2">{nf(row.used)}</td>
                    <td className="px-2 py-2">{nf(row.accepted)}</td>
                    <td className="px-2 py-2">{nf(row.byOthers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel className="p-5">
        <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Did the reps get better because of her, or on their own?</h3>
        <p className="m-0 mt-1 text-[12px] text-gray-500">
          Each rep's upsell and cross-sell rate this week against their own last 4 weeks. "With script" counts the orders where they recorded which approved upsell or cross-sell script they used.
          {others.length > 0 ? ` ${influenced.length} of ${others.length} reps improved with the script; ${ownEffort.length} improved on their own.` : ""}
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="!min-w-[720px] w-full text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-400">
                <th className="px-2 py-2">Rep</th><th className="px-2 py-2">Upsell rate</th><th className="px-2 py-2">Cross-sell rate</th>
                <th className="px-2 py-2">Upsells + cross-sells</th><th className="px-2 py-2">With script</th><th className="px-2 py-2">What drove it</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((rep) => (
                <tr key={rep.repId} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit]">
                  <td className="px-2 py-2.5"><span className="flex flex-wrap items-center gap-2 font-semibold"><Avatar name={rep.repName} size={26} />{rep.repName}{rep.isHead ? <HeadOfSalesBadge /> : null}</span></td>
                  <td className="px-2 py-2.5">{rateCell(rep.upsellRate, rep.baselineUpsellRate)}</td>
                  <td className="px-2 py-2.5">{rateCell(rep.crossSellRate, rep.baselineCrossSellRate)}</td>
                  <td className="px-2 py-2.5">{nf(rep.expansionOrders)}</td>
                  <td className="px-2 py-2.5">{nf(rep.scriptOrders)}</td>
                  <td className="px-2 py-2.5">
                    {rep.isHead ? <span className="text-[12px] text-gray-500">Her own sales</span> : (
                      <span title={rep.label} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${VERDICT[rep.verdict].tone}`}>{VERDICT[rep.verdict].label}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {canDecide ? (
        <Panel className="p-5">
          <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Your decision</h3>
          <div className="mt-3 space-y-2 text-[13px]">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={upsellImprovement} onChange={(event) => setUpsellImprovement(event.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-600" />
              <span>Upsell / cross-sell really improved (needed for Level 2).{review.teamImproved ? <span className="text-emerald-700"> The team's rates beat their last 4 weeks.</span> : <span className="text-gray-500"> The team's rates did not beat their last 4 weeks.</span>}</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={initiativeSuccess} onChange={(event) => setInitiativeSuccess(event.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-600" />
              <span>Her initiative worked (needed for Level 3).</span>
            </label>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={2000}
              placeholder={review.hold?.held ? "Required: why are you releasing a held bonus, or why withhold it?" : "Note (required if you withhold)"}
              className="w-full rounded-lg border border-gray-200 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-900" />
          </div>
          {formError ? <p className="m-0 mt-2 text-[12px] font-semibold text-rose-700">{formError}</p> : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => void decide("withhold")} className="!min-h-0 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Withhold</button>
            <button type="button" disabled={busy} onClick={() => void decide("release")} className="!min-h-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
              {review.hold?.held ? "Release anyway" : "Release bonus"}
            </button>
          </div>
          <p className="m-0 mt-2 text-[11px] text-gray-500">The amount is worked out again from the ticks above when you release.</p>
        </Panel>
      ) : isOwner && !decided && (review.evaluation?.amount ?? 0) > 0 && !review.weekOver ? (
        <Panel className="p-4 text-[13px] text-gray-500">You can release or withhold this bonus once the week is over.</Panel>
      ) : null}
    </div>
  );
}
