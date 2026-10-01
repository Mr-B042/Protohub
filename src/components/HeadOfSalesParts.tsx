import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Crown, FileText, PauseCircle } from "lucide-react";
import { Avatar, Panel, longDate, nf, pctText, shortDateTime } from "./WeeklyReportParts";
import { salesScriptApi, type HeadOfSalesRepInfluence, type HeadOfSalesReview, type SalesScript } from "../lib/api";

/**
 * Head of Sales weekly script, the rep's "I used the script" tick, and the
 * Owner's release of the Head of Sales bonus (Bright, 1 Oct 2026).
 *
 * Bright's question before her bonus is released: did she make the reps
 * better, or did they do it on their own? She writes an upsell & cross-sell
 * script each week; reps tick it on the orders where they used it. If she
 * reaches a bonus level with no script, or nobody used it, the bonus is held
 * until the Owner releases or withholds it.
 */

/** Lilac crown badge that marks the Head of Sales Rep (Bright chose "Lilac queen"). */
export function HeadOfSalesBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800 dark:border-violet-400/30 dark:bg-violet-400/15 dark:text-violet-200 ${className}`}>
      <Crown className="h-3 w-3 text-violet-600 dark:text-violet-300" /> Head of Sales
    </span>
  );
}

const lagosToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const sundayOf = (dateKey: string) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
};
const plusDays = (dateKey: string, days: number) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

function ScriptText({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">{label}</p>
      <p className="m-0 mt-1 whitespace-pre-wrap text-sm text-gray-800 dark:text-slate-200">{text.trim() || "Not written."}</p>
    </div>
  );
}

/** On the Head of Sales "Upsell & Cross-sell" page: write this week's or next week's script. */
export function WeeklyScriptCard() {
  const thisWeek = sundayOf(lagosToday());
  const [week, setWeek] = useState(thisWeek);
  const [state, setState] = useState<{ script: SalesScript | null; canEdit: boolean } | null>(null);
  const [upsell, setUpsell] = useState("");
  const [crossSell, setCrossSell] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setMessage(null);
    salesScriptApi.week(week)
      .then((data) => {
        if (cancelled) return;
        setState({ script: data.script, canEdit: data.canEdit });
        setUpsell(data.script?.upsellScript ?? "");
        setCrossSell(data.script?.crossSellScript ?? "");
      })
      .catch((error: any) => { if (!cancelled) setMessage({ tone: "error", text: error?.message ?? "Could not load the script." }); });
    return () => { cancelled = true; };
  }, [week]);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await salesScriptApi.save({ weekStart: week, upsellScript: upsell, crossSellScript: crossSell });
      setState((current) => ({ canEdit: current?.canEdit ?? true, script: data.script }));
      setMessage({ tone: "ok", text: state?.script ? "Script updated." : "Script shared with the sales reps." });
    } catch (error: any) {
      setMessage({ tone: "error", text: error?.message ?? "Could not save the script." });
    } finally {
      setBusy(false);
    }
  };

  const weeks = [{ key: thisWeek, label: "This week" }, { key: plusDays(thisWeek, 7), label: "Next week" }];
  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-400/25 dark:bg-violet-400/[0.06]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="m-0 flex items-center gap-2 text-base font-black text-gray-900 dark:text-slate-100"><FileText className="h-4 w-4 text-violet-600" /> Weekly upsell &amp; cross-sell script</h3>
          <p className="m-0 mt-1 text-[12px] text-gray-600 dark:text-slate-400">
            Reps read it on their orders and tick when they use it. Without a script, or if no rep uses it, your weekly bonus is held for the Owner to decide.
          </p>
        </div>
        <div className="flex rounded-lg border border-violet-200 bg-white p-0.5 dark:border-violet-400/30 dark:bg-slate-900">
          {weeks.map((option) => (
            <button key={option.key} type="button" onClick={() => setWeek(option.key)}
              className={`!min-h-0 rounded-md px-3 py-1.5 text-xs font-bold ${week === option.key ? "bg-violet-600 text-white" : "text-violet-700 hover:bg-violet-50 dark:text-violet-200 dark:hover:bg-violet-400/10"}`}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <p className="m-0 mt-2 text-[12px] font-semibold text-gray-500 dark:text-slate-400">
        Week of {longDate(week)} · {state?.script ? `shared ${shortDateTime(state.script.submittedAt)}${state.script.updatedAt !== state.script.submittedAt ? `, last changed ${shortDateTime(state.script.updatedAt)}` : ""}` : "not shared yet"}
      </p>
      {!state && !message ? <p className="m-0 mt-3 text-sm text-gray-500">Loading…</p> : null}
      {state && state.canEdit ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-[12px] font-bold text-gray-700 dark:text-slate-300">Upsell script (more pieces of the same product)</span>
            <textarea value={upsell} onChange={(event) => setUpsell(event.target.value)} rows={6} maxLength={4000}
              placeholder="e.g. Most customers take 2 so they have one for the kitchen and one for the bathroom. Should I make it 2 for you?"
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <label className="block">
            <span className="text-[12px] font-bold text-gray-700 dark:text-slate-300">Cross-sell script (a different product)</span>
            <textarea value={crossSell} onChange={(event) => setCrossSell(event.target.value)} rows={6} maxLength={4000}
              placeholder="e.g. Customers who buy the rack usually add the shelf liner. Would you like me to add it?"
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <div className="md:col-span-2 flex items-center justify-end gap-3">
            {message ? <span className={`text-[12px] font-semibold ${message.tone === "ok" ? "text-emerald-700" : "text-rose-700"}`}>{message.text}</span> : null}
            <button type="button" disabled={busy} onClick={() => void save()}
              className="!min-h-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
              {busy ? "Saving…" : state.script ? "Update script" : "Share with reps"}
            </button>
          </div>
        </div>
      ) : state ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <ScriptText label="Upsell script" text={state.script?.upsellScript ?? ""} />
          <ScriptText label="Cross-sell script" text={state.script?.crossSellScript ?? ""} />
          {message ? <p className="m-0 text-[12px] font-semibold text-rose-700 md:col-span-2">{message.text}</p> : null}
        </div>
      ) : message ? <p className="m-0 mt-3 text-[12px] font-semibold text-rose-700">{message.text}</p> : null}
    </section>
  );
}

/**
 * On an order with an upsell or a rep-added cross-sell: read the week's script
 * and tick "I used this week's script". `version` changes when the order's
 * upsell / cross-sell lines change, so the card re-checks eligibility.
 */
export function OrderScriptTick({ orderId, version }: { orderId: string; version: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof salesScriptApi.forOrder>> | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    salesScriptApi.forOrder(orderId)
      .then((result) => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [orderId, version]);

  if (!data || !data.eligible) return null;
  if (!data.script) {
    return (
      <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/70 px-4 py-3 text-[12px] font-semibold text-violet-800 dark:border-violet-400/25 dark:bg-violet-400/[0.08] dark:text-violet-200">
        No upsell &amp; cross-sell script was shared for this order's week.
      </div>
    );
  }
  const toggle = async (used: boolean) => {
    setBusy(true);
    setError("");
    try {
      await salesScriptApi.tick(orderId, used);
      setData({ ...data, used, usedAt: used ? new Date().toISOString() : null });
    } catch (err: any) {
      setError(err?.message ?? "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/70 px-4 py-3 dark:border-violet-400/25 dark:bg-violet-400/[0.08]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((value) => !value)} className="!min-h-0 inline-flex items-center gap-1.5 text-[13px] font-black text-violet-800 dark:text-violet-200">
          <Crown className="h-4 w-4" /> This week's script {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {data.canTick ? (
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-bold text-gray-800 dark:text-slate-200">
            <input type="checkbox" checked={data.used} disabled={busy} onChange={(event) => void toggle(event.target.checked)} className="h-4 w-4 accent-violet-600" />
            I used this week's script on this order
          </label>
        ) : (
          <span className={`text-[12px] font-bold ${data.used ? "text-emerald-700 dark:text-emerald-300" : "text-gray-500 dark:text-slate-400"}`}>
            {data.used ? `Rep used the script${data.usedAt ? ` · ${shortDateTime(data.usedAt)}` : ""}` : "Script not ticked on this order"}
          </span>
        )}
      </div>
      {open ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ScriptText label="Upsell" text={data.script.upsellScript} />
          <ScriptText label="Cross-sell" text={data.script.crossSellScript} />
        </div>
      ) : null}
      {error ? <p className="m-0 mt-2 text-[12px] font-semibold text-rose-700">{error}</p> : null}
    </div>
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
  const [showScript, setShowScript] = useState(false);
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
          <div className="rounded-lg border border-gray-200 px-3 py-2.5 dark:border-slate-700"><span className="block text-[11px] font-semibold uppercase text-gray-400">Orders with the script</span><strong className="text-lg text-gray-900 dark:text-slate-100">{nf(review.scriptUses ?? 0)}</strong><span className="block text-[11px] text-gray-500">ticked by other reps</span></div>
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
          <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Was a script submitted for this week?</h3>
          {review.script ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Yes · {shortDateTime(review.script.submittedAt)}</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700"><AlertTriangle className="h-3.5 w-3.5" /> No script</span>
          )}
        </div>
        {review.script ? (
          <>
            <button type="button" onClick={() => setShowScript((value) => !value)} className="!min-h-0 mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-violet-700">
              {showScript ? "Hide the script" : "Read the script"} {showScript ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showScript ? (
              <div className="mt-3 grid gap-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3 md:grid-cols-2 dark:border-violet-400/25 dark:bg-violet-400/[0.06]">
                <ScriptText label="Upsell" text={review.script.upsellScript} />
                <ScriptText label="Cross-sell" text={review.script.crossSellScript} />
              </div>
            ) : null}
          </>
        ) : null}
      </Panel>

      <Panel className="p-5">
        <h3 className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">Did the reps get better because of her, or on their own?</h3>
        <p className="m-0 mt-1 text-[12px] text-gray-500">
          Each rep's upsell and cross-sell rate this week against their own last 4 weeks. "With script" counts the orders where they ticked that they used this week's script.
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
