import { useEffect, useState } from "react";
import { Loader2, Paperclip, Search } from "lucide-react";
import { waybillFollowUpApi, type WfLog, type WfResponseOption } from "../../lib/api";
import { Card, ChannelIcon, Pill, ResponsePill, lagosDateTime } from "./wf-ui";

const dayKey = (offset: number) => new Date(Date.now() + 60 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);

/** Follow-Up History: every log, newest first. Logs are never edited or deleted. */
export default function TabHistory({ options, waybill, onToast }: { options: WfResponseOption[]; waybill: string; onToast: (message: string) => void }) {
  const [from, setFrom] = useState(dayKey(-6));
  const [to, setTo] = useState(dayKey(0));
  const [search, setSearch] = useState(waybill);
  const [logs, setLogs] = useState<WfLog[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { setSearch(waybill); }, [waybill]);
  useEffect(() => {
    let live = true;
    setLogs(null);
    setError("");
    const timer = window.setTimeout(() => {
      waybillFollowUpApi.history({ from, to, waybill: search.trim() })
        .then((result) => { if (live) setLogs(result.logs); })
        .catch((err: Error) => { if (live) setError(err.message || "Could not load the history."); });
    }, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [from, to, search]);

  const openEvidence = async (id: string) => {
    try { window.open((await waybillFollowUpApi.evidence(id)).url, "_blank", "noopener"); } catch (err) { onToast((err as Error).message || "Could not open the file."); }
  };

  const field = "rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] dark:border-slate-700 dark:bg-slate-900";
  const th = "px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500";
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 px-5 pt-4">
        <div className="mr-auto">
          <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Follow-Up History</h3>
          <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Every follow-up logged, newest first. A log is never changed or deleted.</p>
        </div>
        <label className="text-[12px] text-gray-600">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className={`${field} ml-1`} /></label>
        <label className="text-[12px] text-gray-600">To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className={`${field} ml-1`} /></label>
        <span className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Waybill number" className={`${field} pl-8`} />
        </span>
      </div>
      {error && <p className="m-5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</p>}
      {!logs && !error && <p className="m-5 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>}
      {logs && (
        <div className="mt-3 overflow-x-auto">
          <table className="!min-w-[980px] w-full border-collapse text-[13px]">
            <thead className="bg-gray-50 dark:bg-slate-800/60">
              <tr><th className={th}>When</th><th className={th}>Waybill</th><th className={th}>Agent</th><th className={th}>Channel</th><th className={th}>Response</th><th className={th}>Agent's words</th><th className={th}>Next action</th><th className={th}>Session</th><th className={th}>Logged by</th><th className={th} /></tr>
            </thead>
            <tbody>
              {logs.length === 0 && <tr><td colSpan={10} className="px-5 py-10 text-center text-gray-500">No follow-up logged in these dates.</td></tr>}
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-gray-100 align-top last:border-0 dark:border-slate-800 [&>td]:[color:inherit]">
                  <td className="whitespace-nowrap px-3 py-2.5 text-gray-800 dark:text-slate-200">{lagosDateTime(log.at)}</td>
                  <td className="px-3 py-2.5"><b className="text-gray-900 dark:text-slate-100">{log.waybillId}</b>{log.batchId && <span className="block text-[11px] text-gray-500">same call as others</span>}</td>
                  <td className="px-3 py-2.5 text-gray-800 dark:text-slate-200">{log.agentName}<span className="block text-[11.5px] text-gray-500">{log.state}</span></td>
                  <td className="px-3 py-2.5"><span className="flex items-center gap-1.5 text-gray-800 dark:text-slate-200"><ChannelIcon channels={log.channels} />{log.channels.length > 1 ? "Both" : log.channels.includes("call") ? "Call" : "WhatsApp"}</span></td>
                  <td className="px-3 py-2.5"><ResponsePill response={log.response} options={options} /></td>
                  <td className="max-w-[220px] px-3 py-2.5 text-gray-700 dark:text-slate-300">{log.responseNote || "—"}</td>
                  <td className="max-w-[160px] px-3 py-2.5 text-gray-700 dark:text-slate-300">{log.nextAction || "—"}</td>
                  <td className="px-3 py-2.5">{log.sessionLabel ? <Pill tone="purple">{log.sessionLabel}</Pill> : <Pill tone="slate">Between sessions</Pill>}</td>
                  <td className="px-3 py-2.5 text-gray-700 dark:text-slate-300">{log.loggedByName || "—"}</td>
                  <td className="px-3 py-2.5">{log.hasEvidence && <button type="button" onClick={() => openEvidence(log.id)} className="!min-h-0 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#5B3FD9] hover:underline"><Paperclip className="h-3.5 w-3.5" />Evidence</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
