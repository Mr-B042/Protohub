import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { waybillFollowUpApi, type WfMiss } from "../../lib/api";
import { Card, Pill, btn, naira, shortDate } from "./wf-ui";

const dayKey = (offset: number) => new Date(Date.now() + 60 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);

const STATE_LOOK: Record<WfMiss["state"], { label: string; tone: string }> = {
  charged: { label: "Charged", tone: "red" },
  disputed: { label: "Disputed", tone: "amber" },
  cancelled: { label: "Cancelled", tone: "slate" },
  not_charged: { label: "Not charged", tone: "slate" }
};

/**
 * The ₦500 ledger (Bright chose: charged automatically). The person charged
 * can dispute a charge; the Owner keeps or cancels it (cancel removes the
 * fine). Every decision stays on the row.
 */
export default function TabMisses({ currentRole, onToast, onChanged }: { currentRole: string; onToast: (message: string) => void; onChanged: () => void }) {
  const [from, setFrom] = useState(dayKey(-13));
  const [to, setTo] = useState(dayKey(0));
  const [rows, setRows] = useState<WfMiss[] | null>(null);
  const [viewerId, setViewerId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError("");
    waybillFollowUpApi.misses({ from, to })
      .then((result) => { setRows(result.misses); setViewerId(result.viewerId); })
      .catch((err: Error) => setError(err.message || "Could not load the charges."));
  }, [from, to]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    const live = list.filter((row) => row.state === "charged" || row.state === "disputed");
    return { charged: live.reduce((sum, row) => sum + row.amount, 0), count: live.length, disputed: list.filter((row) => row.state === "disputed").length, cancelled: list.filter((row) => row.state === "cancelled").length };
  }, [rows]);

  const act = async (id: string, action: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try { await action(); onToast(done); load(); onChanged(); } catch (err) { onToast((err as Error).message || "Could not save."); } finally { setBusy(null); }
  };
  const dispute = (row: WfMiss) => {
    const reason = window.prompt(`Why is the charge for ${row.waybillId} (${row.timeLabel}, ${shortDate(row.sessionDate)}) wrong?`);
    if (reason === null) return;
    void act(row.id, () => waybillFollowUpApi.dispute(row.id, reason), "Dispute sent to the Owner.");
  };
  const decide = (row: WfMiss, decision: "keep" | "cancel") => {
    const note = window.prompt(decision === "cancel" ? `Cancel the ${naira(row.amount)} charge for ${row.waybillId}? Add a note (optional).` : `Keep the charge for ${row.waybillId}? Add a note (optional).`, "");
    if (note === null) return;
    void act(row.id, () => waybillFollowUpApi.decide(row.id, decision, note), decision === "cancel" ? "Charge cancelled; the fine is removed." : "Charge kept.");
  };

  const field = "rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] dark:border-slate-700 dark:bg-slate-900";
  const th = "px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Charged", naira(totals.charged), "text-rose-600"], ["Missed follow-ups", String(totals.count), "text-gray-900 dark:text-slate-50"], ["Disputed", String(totals.disputed), "text-amber-700"], ["Cancelled", String(totals.cancelled), "text-gray-600"]].map(([label, value, tone]) => (
          <Card key={label} className="p-4"><p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">{label}</p><b className={`text-[24px] ${tone}`}>{value}</b></Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 px-5 pt-4">
          <div className="mr-auto">
            <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Missed Logs & Charges</h3>
            <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Each waybill not followed up in a session costs ₦500, charged automatically and taken off in payroll. Disputes go to the Owner.</p>
          </div>
          <label className="text-[12px] text-gray-600">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className={`${field} ml-1`} /></label>
          <label className="text-[12px] text-gray-600">To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className={`${field} ml-1`} /></label>
        </div>
        {error && <p className="m-5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</p>}
        {!rows && !error && <p className="m-5 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>}
        {rows && (
          <div className="mt-3 overflow-x-auto">
            <table className="!min-w-[900px] w-full border-collapse text-[13px]">
              <thead className="bg-gray-50 dark:bg-slate-800/60">
                <tr><th className={th}>Day</th><th className={th}>Session</th><th className={th}>Waybill</th><th className={th}>Agent</th><th className={th}>Charged to</th><th className={th}>Amount</th><th className={th}>State</th><th className={th}>Action</th></tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center text-gray-500">No missed follow-up in these dates.</td></tr>}
                {rows.map((row) => {
                  const mine = row.responsibleUserId === viewerId;
                  return (
                    <tr key={row.id} className="border-b border-gray-100 align-top last:border-0 dark:border-slate-800 [&>td]:[color:inherit]">
                      <td className="whitespace-nowrap px-3 py-2.5 text-gray-800 dark:text-slate-200">{shortDate(row.sessionDate)}</td>
                      <td className="px-3 py-2.5 text-gray-800 dark:text-slate-200">{row.sessionLabel}<span className="block text-[11.5px] text-gray-500">{row.timeLabel}</span></td>
                      <td className="px-3 py-2.5"><b className="text-gray-900 dark:text-slate-100">{row.waybillId}</b></td>
                      <td className="px-3 py-2.5 text-gray-800 dark:text-slate-200">{row.agentName}<span className="block text-[11.5px] text-gray-500">{row.placeState}</span></td>
                      <td className="px-3 py-2.5 text-gray-800 dark:text-slate-200">{row.responsibleName || "Nobody set"}</td>
                      <td className="px-3 py-2.5 font-semibold text-gray-900 dark:text-slate-100">{row.state === "not_charged" ? "—" : naira(row.amount)}</td>
                      <td className="px-3 py-2.5">
                        <Pill tone={STATE_LOOK[row.state].tone}>{STATE_LOOK[row.state].label}</Pill>
                        {row.disputeReason && <span className="mt-1 block max-w-[220px] text-[11.5px] text-gray-600">“{row.disputeReason}”</span>}
                        {row.decidedByName && <span className="mt-1 block text-[11.5px] text-gray-500">{row.decidedByName}{row.decisionNote ? `: ${row.decisionNote}` : ""}</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1.5">
                          {row.state === "charged" && (mine || currentRole !== "Owner") && <button type="button" disabled={busy === row.id} onClick={() => dispute(row)} className={btn.outline}>Dispute</button>}
                          {currentRole === "Owner" && row.state === "disputed" && <button type="button" disabled={busy === row.id} onClick={() => decide(row, "keep")} className={btn.outline}>Keep</button>}
                          {currentRole === "Owner" && (row.state === "charged" || row.state === "disputed") && <button type="button" disabled={busy === row.id} onClick={() => decide(row, "cancel")} className="!min-h-0 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-rose-700 hover:bg-rose-50">Cancel charge</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
