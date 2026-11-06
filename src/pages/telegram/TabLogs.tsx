import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { telegramApi } from "../../lib/api";
import { Card, CardHead, IconBubble, TRIGGER_NAME, dateTime, pct, roleShort } from "./tg-ui";

type Data = Awaited<ReturnType<typeof telegramApi.logs>>;

const PERIODS = [{ value: "today", label: "Today" }, { value: "week", label: "Last 7 days" }, { value: "month", label: "Last 30 days" }];

/** Logs & Analytics: every message the bot sent or could not send. */
export default function TabLogs({ botConnected }: { botConnected: boolean }) {
  const [period, setPeriod] = useState("week");
  const [trigger, setTrigger] = useState("all");
  const [status, setStatus] = useState("all");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!botConnected) return;
    let live = true;
    setLoading(true);
    telegramApi.logs(period, trigger, status)
      .then((result) => { if (live) { setData(result); setError(""); } })
      .catch((err: Error) => { if (live) setError(err.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [period, trigger, status, botConnected]);

  if (!botConnected) return <Card className="p-8 text-center text-[14px] text-gray-600">Connect the bot first (Bot Configuration).</Card>;
  const max = Math.max(1, ...(data?.byDay ?? []).map((row) => row.sent + row.failed));
  const select = "h-10 rounded-xl border border-gray-200 bg-white px-3 text-[13.5px] dark:border-slate-700 dark:bg-slate-900";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Period" value={period} onChange={(event) => setPeriod(event.target.value)} className={select}>{PERIODS.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select>
        <select aria-label="Type" value={trigger} onChange={(event) => setTrigger(event.target.value)} className={select}>
          <option value="all">All types</option>{Object.entries(TRIGGER_NAME).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)} className={select}>
          <option value="all">Sent and failed</option><option value="sent">Sent</option><option value="failed">Failed</option>
        </select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>
      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">Could not load the log: {error}</p>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[["Messages sent", String(data?.totals.sent ?? 0)], ["Failed", String(data?.totals.failed ?? 0)], ["Delivery success rate", pct(data?.totals.rate)], ["Staff reached", String(data?.totals.people ?? 0)]].map(([label, value]) => (
          <Card key={label} className="p-4"><div className="text-[26px] font-extrabold text-gray-900 dark:text-slate-50">{value}</div><div className="text-[13.5px] text-gray-600 dark:text-slate-400">{label}</div></Card>
        ))}
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="pb-4">
          <CardHead title="Messages per day" action={<span className="flex items-center gap-3 text-[12px] text-gray-500"><span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#1F8FE0]" />Sent</span><span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-400" />Failed</span></span>} />
          <div className="mt-4 flex h-44 items-end gap-1 px-5">
            {(data?.byDay ?? []).map((row) => (
              <div key={row.day} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${row.day}: ${row.sent} sent, ${row.failed} failed`}>
                <div className="flex w-full max-w-[34px] flex-col justify-end overflow-hidden rounded-t-md" style={{ height: `${((row.sent + row.failed) / max) * 140}px` }}>
                  <div className="w-full bg-rose-400" style={{ height: `${row.sent + row.failed ? (row.failed / (row.sent + row.failed)) * 100 : 0}%` }} />
                  <div className="w-full flex-1 bg-[#1F8FE0]" />
                </div>
                <span className="text-[10.5px] text-gray-500">{new Date(`${row.day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: data && data.byDay.length > 10 ? undefined : "short", timeZone: "UTC" })}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="pb-3">
          <CardHead title="By type" />
          <table className="!min-w-0 mt-3 w-full border-collapse text-[13.5px]">
            <tbody>
              {(data?.byTrigger ?? []).map((row) => (
                <tr key={row.trigger} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                  <td className="px-5 py-2"><span className="flex items-center gap-2"><IconBubble trigger={row.trigger} size="sm" />{TRIGGER_NAME[row.trigger] ?? row.trigger}</span></td>
                  <td className="px-3 py-2 text-right font-semibold">{row.sent}</td>
                  <td className="px-5 py-2 text-right text-rose-600">{row.failed || ""}</td>
                </tr>
              ))}
              {data && data.byTrigger.length === 0 && <tr><td className="px-5 py-6 text-center text-gray-500">Nothing in this period.</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <CardHead title={`Messages${data ? ` (${data.total})` : ""}`} action={data && data.total > data.rows.length ? <span className="text-[12px] text-gray-500">Showing the latest {data.rows.length}</span> : undefined} />
        <div className="mt-3 overflow-x-auto">
          <table className="!min-w-0 w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:bg-slate-800/60">
                <th className="px-5 py-2">Time</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">To</th><th className="px-3 py-2">Message</th><th className="px-5 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((row) => (
                <tr key={row.id} className="border-b border-gray-100 align-top last:border-0 dark:border-slate-800">
                  <td className="whitespace-nowrap px-5 py-2.5 text-gray-600">{dateTime(row.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5"><span className="flex items-center gap-2"><IconBubble trigger={row.trigger} size="sm" />{TRIGGER_NAME[row.trigger] ?? row.trigger}</span></td>
                  <td className="whitespace-nowrap px-3 py-2.5"><b className="font-semibold text-gray-900 dark:text-slate-100">{row.recipient ?? "—"}</b>{row.role && <span className="block text-[11.5px] text-gray-500">{roleShort(row.role)}</span>}</td>
                  <td className="max-w-[460px] px-3 py-2.5 text-gray-700 dark:text-slate-300"><span className="line-clamp-2">{row.preview ?? row.title}</span>{row.error && <span className="block text-[12px] text-rose-600">{row.error}</span>}</td>
                  <td className="px-5 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${row.status === "sent" ? "bg-emerald-50 text-emerald-700" : row.status === "failed" ? "bg-rose-50 text-rose-700" : "bg-gray-100 text-gray-600"}`}>{row.status === "sent" ? "Sent" : row.status === "failed" ? "Failed" : "Sending"}</span></td>
                </tr>
              ))}
              {data && data.rows.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-500">No messages match.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
