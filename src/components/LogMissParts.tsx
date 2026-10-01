import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, SearchCheck } from "lucide-react";
import { Avatar, Modal, Panel, nf, shortDateTime } from "./WeeklyReportParts";
import type { LogMissDispute, WeeklyLogMissRow } from "../lib/api";

/**
 * Missed follow-up / cart log charges on the weekly report (Bright, 1 Oct
 * 2026). Approved charges are deducted; pending ones wait for the Owner. A
 * rep who thinks one is wrong asks the system first: it shows what they
 * logged that day. A wrong charge goes to the manager automatically; a
 * confirmed one can still be escalated with a reason.
 */

type Finding = { level: "issue" | "info" | "ok"; text: string };
const icon = (level: Finding["level"]) => level === "issue"
  ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
  : level === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />;

const STATUS: Record<WeeklyLogMissRow["status"], { label: string; tone: string }> = {
  pending: { label: "Waiting for owner · not deducted", tone: "bg-amber-50 text-amber-700" },
  approved: { label: "Deducted", tone: "bg-rose-50 text-rose-700" },
  waived: { label: "Cancelled", tone: "bg-gray-100 text-gray-500" }
};

const DISPUTE_STATUS: Record<LogMissDispute["status"], { label: string; tone: string }> = {
  open: { label: "With manager", tone: "bg-blue-50 text-blue-700" },
  awaiting_owner: { label: "Waiting for owner", tone: "bg-amber-50 text-amber-700" },
  cancelled: { label: "Cancelled", tone: "bg-emerald-50 text-emerald-700" },
  kept: { label: "Kept", tone: "bg-gray-100 text-gray-600" }
};

export function MyMissedLogsPanel({ misses, disputes, canDispute, onCheck, onEscalate, onChecked }: {
  misses: WeeklyLogMissRow[];
  disputes: LogMissDispute[];
  canDispute: boolean;
  onCheck: (kind: WeeklyLogMissRow["kind"], ref: string) => Promise<{ verdict: "miss_confirmed" | "miss_wrong"; findings: Finding[]; disputeId: string | null }>;
  onEscalate: (kind: WeeklyLogMissRow["kind"], ref: string, reason: string) => Promise<void>;
  onChecked: () => void;
}) {
  const [checking, setChecking] = useState<WeeklyLogMissRow | null>(null);
  const [result, setResult] = useState<{ verdict: "miss_confirmed" | "miss_wrong"; findings: Finding[]; disputeId: string | null } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const disputeFor = (ref: string) => disputes.find((dispute) => dispute.ref === ref) ?? null;
  const pending = misses.filter((miss) => miss.status === "pending").reduce((sum, miss) => sum + miss.amount, 0);
  const deducted = misses.filter((miss) => miss.status === "approved").reduce((sum, miss) => sum + miss.amount, 0);

  const start = async (miss: WeeklyLogMissRow) => {
    setChecking(miss); setResult(null); setReason(""); setError(""); setSent(false); setBusy(true);
    try { const check = await onCheck(miss.kind, miss.ref); setResult(check); if (check.disputeId) onChecked(); }
    catch (err: any) { setError(err?.message ?? "Could not check it."); }
    finally { setBusy(false); }
  };

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4">
        <div>
          <h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">My Missed Logs</h2>
          <p className="m-0 mt-0.5 text-[12px] text-gray-500">Follow-up logs (₦50 per order per day) and cart logs (₦500 per cart per day) you missed this week. Only charges the owner approved are taken off your bonus.</p>
        </div>
        <div className="flex gap-2 text-[12px]">
          <span className="rounded-lg bg-rose-50 px-2.5 py-1 font-bold text-rose-700">Deducted ₦{nf(deducted)}</span>
          <span className="rounded-lg bg-amber-50 px-2.5 py-1 font-bold text-amber-700">Waiting ₦{nf(pending)}</span>
        </div>
      </div>
      <div className="px-3 pb-4 pt-3">
        {misses.length === 0 ? (
          <p className="m-0 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200"><CheckCircle2 className="h-4 w-4" /> No missed logs this week.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
            {misses.map((miss) => {
              const dispute = disputeFor(miss.ref);
              return (
                <li key={`${miss.kind}-${miss.ref}`} className="flex flex-wrap items-center justify-between gap-2 px-2 py-2.5 text-[12px]">
                  <span className="min-w-0 flex-1 text-gray-800 dark:text-slate-200">{miss.label}</span>
                  <span className="font-bold text-gray-900 dark:text-slate-100">₦{nf(miss.amount)}</span>
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS[miss.status].tone}`}>{STATUS[miss.status].label}</span>
                  {dispute ? (
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${DISPUTE_STATUS[dispute.status].tone}`} title={dispute.decisionNote ?? undefined}>Dispute: {DISPUTE_STATUS[dispute.status].label}</span>
                  ) : miss.status !== "waived" && canDispute ? (
                    <button type="button" onClick={() => void start(miss)} className="!min-h-0 inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700 hover:bg-violet-100"><SearchCheck className="h-3.5 w-3.5" /> Dispute</button>
                  ) : null}
                  {dispute?.decisionNote && dispute.status !== "open" && <span className="basis-full pl-2 text-[11px] text-gray-500">Manager: "{dispute.decisionNote}"</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {checking && (
        <Modal title="Check this charge" subtitle={`${checking.label} · ₦${nf(checking.amount)}. The system checks what you logged that day.`} onClose={() => setChecking(null)}>
          <div className="space-y-4 px-6 py-5">
            {busy && !result && <p className="m-0 text-[13px] text-gray-500">Checking…</p>}
            {result && (
              <>
                {result.verdict === "miss_wrong" ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
                    <p className="m-0 font-bold">The check says this charge looks wrong.</p>
                    <p className="m-0 mt-1 text-[12px]">{result.disputeId ? "It has gone to your manager to cancel. You'll get a notification." : "It is already with your manager."}</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
                    <p className="m-0 font-bold">The check confirms the miss.</p>
                    <p className="m-0 mt-1 text-[12px]">Here is what was logged that day. If you still think it is wrong, tell your manager why.</p>
                  </div>
                )}
                <ul className="m-0 max-h-[40vh] list-none space-y-2 overflow-y-auto p-0">
                  {result.findings.map((finding, index) => <li key={index} className="flex items-start gap-2 text-[13px] text-gray-800 dark:text-slate-200">{icon(finding.level)}<span>{finding.text}</span></li>)}
                </ul>
                {result.verdict === "miss_confirmed" && !sent && (
                  <div className="space-y-2 border-t border-gray-100 pt-4 dark:border-slate-800">
                    <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000}
                      placeholder="Why is it wrong? e.g. The order was not mine that day / I called but forgot to log it"
                      className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                    <div className="flex justify-end">
                      <button type="button" disabled={reason.trim().length < 5 || busy} onClick={async () => {
                        setBusy(true); setError("");
                        try { await onEscalate(checking.kind, checking.ref, reason.trim()); setSent(true); } catch (err: any) { setError(err?.message ?? "Could not send it."); } finally { setBusy(false); }
                      }} className="!min-h-0 rounded-xl border border-amber-300 px-4 py-2 text-[13px] font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-40">Escalate to my manager</button>
                    </div>
                  </div>
                )}
                {sent && <p className="m-0 rounded-lg bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-800">Sent to your manager. You'll get a notification when they decide.</p>}
              </>
            )}
            {error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p>}
            <div className="flex justify-end"><button type="button" onClick={() => setChecking(null)} className="!min-h-0 rounded-xl bg-gray-900 px-4 py-2 text-[13px] font-bold text-white">Done</button></div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

export function LogMissDisputesPanel({ disputes, repName, canDecide, isOwner, onDecide }: {
  disputes: LogMissDispute[];
  repName: (repId: string) => string;
  canDecide: boolean;
  isOwner: boolean;
  onDecide: (id: string, outcome: "cancel" | "keep", note: string) => Promise<void>;
}) {
  const [deciding, setDeciding] = useState<{ dispute: LogMissDispute; outcome: "cancel" | "keep" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = disputes.filter((dispute) => dispute.status === "open" || dispute.status === "awaiting_owner");
  return (
    <Panel>
      <div className="flex items-center gap-2 px-5 pt-4">
        <h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">Missed-Log Disputes</h2>
        {open.length > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">{open.length}</span>}
      </div>
      <p className="m-0 px-5 text-[12px] text-gray-500">Reps who think a missed follow-up or cart-log charge is wrong. The system check is shown with each one. Only the owner can cancel a charge that was already approved.</p>
      <div className="space-y-3 px-5 pb-5 pt-3">
        {disputes.length === 0 && <p className="m-0 rounded-xl bg-gray-50 px-4 py-5 text-center text-[13px] text-gray-500 dark:bg-slate-800">No disputes.</p>}
        {disputes.map((dispute) => {
          const decidable = canDecide && (dispute.status === "open" || (dispute.status === "awaiting_owner" && isOwner));
          return (
            <div key={dispute.id} className="rounded-xl border border-gray-200 p-3 text-[12px] dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-100"><Avatar name={repName(dispute.repId)} size={26} />{repName(dispute.repId)}
                  <span className="font-normal text-gray-500">· {dispute.kind === "cart_log" ? "Cart logs" : `Follow-up, order #${dispute.orderId}`} · {dispute.missDate} · ₦{nf(dispute.amount)}</span></span>
                <span className="flex gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${dispute.checkVerdict === "miss_wrong" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{dispute.checkVerdict === "miss_wrong" ? "System supports the rep" : "System confirmed the miss"}</span>
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${DISPUTE_STATUS[dispute.status].tone}`}>{DISPUTE_STATUS[dispute.status].label}</span>
                </span>
              </div>
              {dispute.repReason && <p className="m-0 mt-2 text-[13px] text-gray-800 dark:text-slate-200">Rep: "{dispute.repReason}"</p>}
              <ul className="m-0 mt-2 list-none space-y-1 p-0">
                {(dispute.checkResult?.findings ?? []).slice(0, 8).map((finding, index) => <li key={index} className="flex items-start gap-1.5 text-gray-700 dark:text-slate-300">{icon(finding.level)}<span>{finding.text}</span></li>)}
              </ul>
              {dispute.decisionNote && <p className="m-0 mt-2 rounded-lg bg-gray-50 px-3 py-2 text-gray-700 dark:bg-slate-800 dark:text-slate-200">{dispute.decidedByName}: "{dispute.decisionNote}" · {shortDateTime(dispute.decidedAt)}</p>}
              {decidable && (
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => { setNote(""); setError(""); setDeciding({ dispute, outcome: "keep" }); }} className="!min-h-0 rounded-lg border border-gray-300 px-3 py-1.5 font-bold text-gray-700 dark:text-slate-200">Keep the charge</button>
                  <button type="button" onClick={() => { setNote(""); setError(""); setDeciding({ dispute, outcome: "cancel" }); }} className="!min-h-0 rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white">Cancel the charge</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {deciding && (
        <Modal title={deciding.outcome === "cancel" ? "Cancel this charge" : "Keep this charge"} subtitle={`₦${nf(deciding.dispute.amount)} · ${repName(deciding.dispute.repId)}. The rep is told your reason.`} onClose={() => setDeciding(null)}>
          <div className="space-y-3 px-6 py-5">
            <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000}
              placeholder={deciding.outcome === "cancel" ? "e.g. She did call; the log was saved under the wrong order" : "e.g. No log that day; the call came the next morning"}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
            {error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeciding(null)} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold dark:border-slate-700 dark:text-slate-200">Back</button>
              <button type="button" disabled={note.trim().length < 3 || busy} onClick={async () => {
                setBusy(true); setError("");
                try { await onDecide(deciding.dispute.id, deciding.outcome, note.trim()); setDeciding(null); } catch (err: any) { setError(err?.message ?? "Could not save."); } finally { setBusy(false); }
              }} className={`!min-h-0 rounded-xl px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40 ${deciding.outcome === "cancel" ? "bg-emerald-600" : "bg-gray-900"}`}>{deciding.outcome === "cancel" ? "Cancel the charge" : "Keep the charge"}</button>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
