import { useState } from "react";
import { Gavel } from "lucide-react";
import { Avatar, Modal, Panel, nf, shortDateTime } from "./WeeklyReportParts";
import type { FineAppeal } from "../lib/api";

/**
 * Fine appeals on the weekly report (Bright, 4 Nov 2026). The rep says why a
 * fine should not stand; the Manager/Admin keeps or cancels it (a fine the
 * Owner charged waits for the Owner). Not deducted while the appeal is open.
 * Missed-log charges keep their own dispute (LogMissParts).
 */

const STATUS: Record<FineAppeal["status"], { label: string; tone: string }> = {
  open: { label: "Appeal with manager · not deducted", tone: "bg-blue-50 text-blue-700" },
  awaiting_owner: { label: "Appeal waiting for owner · not deducted", tone: "bg-amber-50 text-amber-700" },
  cancelled: { label: "Cancelled on appeal", tone: "bg-emerald-50 text-emerald-700" },
  kept: { label: "Appeal lost · deducted", tone: "bg-gray-100 text-gray-600" }
};

type Fine = { id: string; label: string; amount: number; date: string };

export function MyFinesPanel({ fines, appeals, canAppeal, closedNote, onAppeal }: {
  fines: Fine[];
  appeals: FineAppeal[];
  canAppeal: boolean;
  closedNote: string | null;
  onAppeal: (penaltyId: string, reason: string) => Promise<void>;
}) {
  const [appealing, setAppealing] = useState<Fine | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const appealFor = (id: string) => appeals.find((appeal) => appeal.penaltyId === id) ?? null;
  // Fines under appeal are not in `fines` (not deducted); cancelled ones are gone.
  const rows: Array<{ fine: Fine; appeal: FineAppeal | null }> = [
    ...fines.map((fine) => ({ fine, appeal: appealFor(fine.id) })),
    ...appeals.filter((appeal) => !fines.some((fine) => fine.id === appeal.penaltyId))
      .map((appeal) => ({ fine: { id: appeal.penaltyId, label: appeal.fineLabel, amount: appeal.amount, date: String(appeal.chargedAt ?? appeal.createdAt).slice(0, 10) }, appeal }))
  ];
  if (rows.length === 0) return null;
  return (
    <Panel>
      <div className="px-5 pt-4">
        <h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">My Fines</h2>
        <p className="m-0 mt-0.5 text-[12px] text-gray-500">If a fine is wrong, appeal it and say why. It is not taken off your bonus while your manager decides.{closedNote ? ` ${closedNote}` : ""}</p>
      </div>
      <ul className="m-0 list-none divide-y divide-gray-100 px-3 pb-4 pt-2 dark:divide-slate-800">
        {rows.map(({ fine, appeal }) => (
          <li key={fine.id} className="flex flex-wrap items-center justify-between gap-2 px-2 py-2.5 text-[12px]">
            <span className="min-w-0 flex-1 text-gray-800 dark:text-slate-200">{fine.label}</span>
            <span className="font-bold text-gray-900 dark:text-slate-100">₦{nf(fine.amount)}</span>
            {appeal ? (
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS[appeal.status].tone}`}>{STATUS[appeal.status].label}</span>
            ) : canAppeal ? (
              <button type="button" onClick={() => { setAppealing(fine); setReason(""); setError(""); }}
                className="!min-h-0 inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700 hover:bg-violet-100"><Gavel className="h-3.5 w-3.5" /> Appeal</button>
            ) : (
              <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">Deducted</span>
            )}
            {appeal && <span className="basis-full pl-2 text-[11px] text-gray-500">You: "{appeal.repReason}"{appeal.decisionNote && appeal.status !== "open" ? ` · ${appeal.decidedByName ?? "Manager"}: "${appeal.decisionNote}"` : ""}</span>}
          </li>
        ))}
      </ul>
      {appealing && (
        <Modal title="Appeal this fine" subtitle={`${appealing.label} · ₦${nf(appealing.amount)}. Your manager reads your reason and keeps or cancels it.`} onClose={() => setAppealing(null)}>
          <div className="space-y-3 px-6 py-5">
            <textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} autoFocus
              placeholder="Why should this fine not stand? e.g. The order reached me at 5:20pm and I sent it out at 10:05am the next morning."
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
            {error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAppealing(null)} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold dark:border-slate-700 dark:text-slate-200">Back</button>
              <button type="button" disabled={reason.trim().length < 5 || busy} onClick={async () => {
                setBusy(true); setError("");
                try { await onAppeal(appealing.id, reason.trim()); setAppealing(null); } catch (err: any) { setError(err?.message ?? "Could not send it."); } finally { setBusy(false); }
              }} className="!min-h-0 rounded-xl bg-violet-600 px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40">Send appeal</button>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

export function FineAppealsPanel({ appeals, repName, canDecide, isOwner, onDecide }: {
  appeals: FineAppeal[];
  repName: (repId: string) => string;
  canDecide: boolean;
  isOwner: boolean;
  onDecide: (id: string, outcome: "cancel" | "keep", note: string) => Promise<void>;
}) {
  const [deciding, setDeciding] = useState<{ appeal: FineAppeal; outcome: "cancel" | "keep" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = appeals.filter((appeal) => appeal.status === "open" || appeal.status === "awaiting_owner");
  return (
    <Panel>
      <div className="flex items-center gap-2 px-5 pt-4">
        <h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">Fine Appeals</h2>
        {open.length > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">{open.length}</span>}
      </div>
      <p className="m-0 px-5 text-[12px] text-gray-500">Reps who think a fine is wrong, with their reason. Not deducted until decided, and the week cannot go to the owner until every appeal is. Only the owner can cancel a fine the owner charged.</p>
      <div className="space-y-3 px-5 pb-5 pt-3">
        {appeals.length === 0 && <p className="m-0 rounded-xl bg-gray-50 px-4 py-5 text-center text-[13px] text-gray-500 dark:bg-slate-800">No appeals this week.</p>}
        {appeals.map((appeal) => {
          const decidable = canDecide && (appeal.status === "open" || (appeal.status === "awaiting_owner" && isOwner));
          const looked = repName(appeal.repId);
          const name = appeal.repName || (looked && looked !== "-" ? looked : "A rep");
          return (
            <div key={appeal.id} className="rounded-xl border border-gray-200 p-3 text-[12px] dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 font-semibold text-gray-900 dark:text-slate-100"><Avatar name={name} size={26} />{name}
                  <span className="font-normal text-gray-500">· {appeal.fineLabel} · ₦{nf(appeal.amount)}{appeal.chargedByName ? ` · charged by ${appeal.chargedByName}` : ""}</span></span>
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS[appeal.status].tone}`}>{STATUS[appeal.status].label}</span>
              </div>
              <p className="m-0 mt-2 text-[13px] text-gray-800 dark:text-slate-200">Rep: "{appeal.repReason}" <span className="text-[11px] text-gray-400">· {shortDateTime(appeal.createdAt)}</span></p>
              {appeal.decisionNote && <p className="m-0 mt-2 rounded-lg bg-gray-50 px-3 py-2 text-gray-700 dark:bg-slate-800 dark:text-slate-200">{appeal.decidedByName}: "{appeal.decisionNote}" · {shortDateTime(appeal.decidedAt)}</p>}
              {decidable && (
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => { setNote(""); setError(""); setDeciding({ appeal, outcome: "keep" }); }} className="!min-h-0 rounded-lg border border-gray-300 px-3 py-1.5 font-bold text-gray-700 dark:text-slate-200">Keep the fine</button>
                  <button type="button" onClick={() => { setNote(""); setError(""); setDeciding({ appeal, outcome: "cancel" }); }} className="!min-h-0 rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white">Cancel the fine</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {deciding && (
        <Modal title={deciding.outcome === "cancel" ? "Cancel this fine" : "Keep this fine"} subtitle={`₦${nf(deciding.appeal.amount)} · ${deciding.appeal.repName || repName(deciding.appeal.repId)}. The rep is told your reason.`} onClose={() => setDeciding(null)}>
          <div className="space-y-3 px-6 py-5">
            <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} autoFocus
              placeholder={deciding.outcome === "cancel" ? "e.g. You are right: the order reached you after closing time" : "e.g. The order sat in New for 40 minutes during working hours"}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
            {error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeciding(null)} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold dark:border-slate-700 dark:text-slate-200">Back</button>
              <button type="button" disabled={note.trim().length < 3 || busy} onClick={async () => {
                setBusy(true); setError("");
                try { await onDecide(deciding.appeal.id, deciding.outcome, note.trim()); setDeciding(null); } catch (err: any) { setError(err?.message ?? "Could not save."); } finally { setBusy(false); }
              }} className={`!min-h-0 rounded-xl px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40 ${deciding.outcome === "cancel" ? "bg-emerald-600" : "bg-gray-900"}`}>{deciding.outcome === "cancel" ? "Cancel the fine" : "Keep the fine"}</button>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
