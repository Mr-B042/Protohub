import { BarChart3, CalendarDays, CheckCircle2, CircleDot, Clock, ClipboardList, MessageSquareMore, RotateCw, ShieldAlert, Target, Truck, XCircle } from "lucide-react";
import type { WfDashboard, WfSession } from "../../lib/api";
import WaybillTable from "./WaybillTable";
import { NoticePanel, clockText } from "./Timers";
import { Card, ChannelIcon, IconTile, Pill, lagosTime, naira, shortDate } from "./wf-ui";

type Props = {
  data: WfDashboard;
  nowMs: number;
  onLog: (ids: string[]) => void;
  onHistory: (waybillId?: string) => void;
  onOpenWaybills: () => void;
  onInform: (ids: string[]) => void;
  informing: Set<string>;
};

function Kpi({ icon, iconLook, label, value, pill }: { icon: React.ReactNode; iconLook: string; label: string; value: string | number; pill: React.ReactNode }) {
  return (
    <Card className="flex items-start gap-3 p-4">
      <span className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconLook}`}>{icon}</span>
      <div className="min-w-0">
        <p className="m-0 text-[13.5px] font-semibold leading-tight text-gray-800 dark:text-slate-200">{label}</p>
        <p className="m-0 mt-1 text-[26px] font-extrabold leading-none text-gray-900 dark:text-slate-50">{value}</p>
        <div className="mt-2 [&>span]:whitespace-normal">{pill}</div>
      </div>
    </Card>
  );
}

const SESSION_WORD: Record<string, string> = { completed: "Completed", missed: "Missed", upcoming: "Upcoming", nothing_due: "Nothing due", off: "Day off", open: "Due now" };

function SessionBox({ session, isNext, nowMs }: { session: WfSession; isNext: boolean; nowMs: number }) {
  const dueMs = Date.parse(session.dueAt), closeMs = Date.parse(session.closeAt);
  // Solid backgrounds: the line joining the boxes runs behind them.
  const look = session.status === "completed" ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-[#0f2a22]"
    : session.status === "missed" ? "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-[#2c1519]"
      : session.status === "open" || isNext ? "border-[#5B3FD9] bg-white ring-1 ring-[#5B3FD9] dark:bg-slate-900"
        : "border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900";
  const icon = session.status === "completed" ? <CheckCircle2 className="h-6 w-6 fill-emerald-500 text-white" />
    : session.status === "missed" ? <XCircle className="h-6 w-6 fill-rose-500 text-white" />
      : session.status === "nothing_due" ? <CheckCircle2 className="h-6 w-6 text-gray-400" />
        : <Clock className={`h-6 w-6 ${session.status === "open" || isNext ? "text-[#5B3FD9]" : "text-gray-500"}`} />;
  const line = session.status === "completed" ? <><span className="block text-emerald-700 dark:text-emerald-300">Completed</span><span className="block text-[11.5px] text-emerald-700 dark:text-emerald-300">{lagosTime(session.completedAt)}</span></>
    : session.status === "missed" ? <><span className="block text-rose-600">Missed</span><span className="block text-[11.5px] text-rose-600">{session.missing} waybill{session.missing === 1 ? "" : "s"}</span></>
      : session.status === "open" ? <span className="block font-semibold text-[#5B3FD9]">Due now · {session.logged}/{session.owed}<span className="block font-mono text-[12px] font-bold tabular-nums">closes in {clockText(closeMs - nowMs)}</span></span>
        : isNext ? <span className="block font-semibold text-[#5B3FD9]">Due in <span className="font-mono tabular-nums">{clockText(dueMs - nowMs)}</span></span>
          : <span className="block text-gray-500">{SESSION_WORD[session.status]}</span>;
  return (
    <div className={`relative z-[1] flex min-w-[124px] flex-1 flex-col items-center rounded-xl border px-2 py-3 text-center ${look}`}>
      <b className={`text-[13px] ${session.status === "open" || isNext ? "text-[#5B3FD9]" : "text-gray-900 dark:text-slate-100"}`}>{session.label}</b>
      <span className={`text-[12.5px] ${session.status === "open" || isNext ? "text-[#5B3FD9]" : "text-gray-700 dark:text-slate-300"}`}>{session.timeLabel}</span>
      <span className="my-2">{icon}</span>
      <span className="text-[12.5px] leading-tight">{line}</span>
    </div>
  );
}

function Ring({ done, total }: { done: number; total: number }) {
  const radius = 52, circumference = 2 * Math.PI * radius;
  const share = total > 0 ? done / total : 0;
  return (
    <div className="relative h-[136px] w-[136px] shrink-0">
      <svg viewBox="0 0 136 136" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="68" cy="68" r={radius} fill="none" stroke="currentColor" strokeWidth="11" className="text-gray-100 dark:text-slate-800" />
        {share > 0 && <circle cx="68" cy="68" r={radius} fill="none" stroke="#16A34A" strokeWidth="11" strokeLinecap="round" strokeDasharray={`${share * circumference} ${circumference}`} />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <b className="text-[28px] leading-none text-gray-900 dark:text-slate-50">{done}/{total}</b>
        <span className="mt-1 text-[12.5px] text-gray-600 dark:text-slate-400">Follow-Ups</span>
      </div>
    </div>
  );
}

/** The Follow-Up Dashboard, built to Bright's design (7 Nov 2026). */
export default function TabDashboard({ data, nowMs, onLog, onHistory, onOpenWaybills, onInform, informing }: Props) {
  const isToday = data.date === data.today;
  const nextKey = isToday && data.next && !data.next.open ? data.next.key : null;
  const workingSessions = data.sessions.filter((session) => session.status !== "off");
  const done = data.sessions.filter((session) => session.status === "completed" || session.status === "nothing_due").length;
  const practice = data.date < data.settings.chargesFrom;

  return (
    <div className="space-y-4">
      {isToday && (
        <NoticePanel rows={data.waybills} nowMs={nowMs} minutes={data.settings.noticeMinutes} amount={data.settings.noticeAmount}
          charged={data.today >= data.settings.chargesFrom} busyIds={informing} onInform={onInform} />
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={<Truck className="h-5 w-5" />} iconLook="bg-sky-50 text-sky-600 dark:bg-sky-500/10" label="Active Waybills" value={data.cards.activeWaybills} pill={<Pill tone="blue">Awaiting receipt</Pill>} />
        <Kpi icon={<Clock className="h-5 w-5" />} iconLook="bg-amber-50 text-amber-600 dark:bg-amber-500/10" label="Follow-Ups Due" value={data.cards.dueNow} pill={<Pill tone="amber">{data.next?.open ? "Action required now" : data.next ? `Next at ${data.next.timeLabel}` : "Nothing due"}</Pill>} />
        <Kpi icon={<RotateCw className="h-5 w-5" />} iconLook="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10" label={isToday ? "Completed Today" : "Completed"} value={data.cards.completedToday} pill={<Pill tone="green">{data.cards.compliance === null ? "No session yet" : `↑ ${data.cards.compliance}% compliance`}</Pill>} />
        <Kpi icon={<XCircle className="h-5 w-5" />} iconLook="bg-rose-50 text-rose-600 dark:bg-rose-500/10" label="Missed Follow-Ups" value={data.cards.missed} pill={<Pill tone="red">{naira(data.cards.missedAmount)} charges</Pill>} />
        <Kpi icon={<MessageSquareMore className="h-5 w-5" />} iconLook="bg-amber-50 text-amber-600 dark:bg-amber-500/10" label="Pending Agent Responses" value={data.cards.pendingResponses} pill={<Pill tone="amber">Awaiting update</Pill>} />
        <Kpi icon={<CheckCircle2 className="h-5 w-5" />} iconLook="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10" label={isToday ? "Received Today" : "Received"} value={data.cards.receivedToday} pill={<Pill tone="green">✓ Closed</Pill>} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_390px]">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <IconTile><CalendarDays className="h-5 w-5" /></IconTile>
              <div>
                <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Follow-Up Schedule ({isToday ? "Today" : shortDate(data.date)})</h3>
                <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Required follow-ups: 5 times daily (2 Morning, 2 Afternoon, 1 Evening)</p>
              </div>
            </div>
            {isToday && data.next && (
              <span className="inline-flex items-center gap-2 rounded-xl bg-[#EEEBFC] px-3 py-2 text-[13px] font-semibold text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-200">
                <Clock className="h-4 w-4" />
                {data.next.open ? <>Now: {data.next.timeLabel} (closes in <span className="font-mono tabular-nums">{clockText(Date.parse(data.next.closeAt) - nowMs)}</span>)</> : <>Next: {data.next.timeLabel} (in <span className="font-mono tabular-nums">{clockText(Date.parse(data.next.dueAt) - nowMs)}</span>)</>}
              </span>
            )}
          </div>
          {!data.workingDay && <p className="m-0 mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[13px] text-gray-600 dark:bg-slate-800/60 dark:text-slate-300">Day off: no follow-ups are owed today.</p>}
          <div className="relative mt-4 flex gap-3 overflow-x-auto pb-1">
            <span className="pointer-events-none absolute left-6 right-6 top-1/2 h-0.5 bg-gray-200 dark:bg-slate-700" aria-hidden="true" />
            {data.sessions.map((session) => <SessionBox key={session.key} session={session} isNext={session.key === nextKey} nowMs={nowMs} />)}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-[#5B3FD9]" />
            <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">{isToday ? "Today's" : shortDate(data.date)} Follow-Up Progress</h3>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-5">
            <Ring done={done} total={workingSessions.length || 5} />
            <ul className="m-0 min-w-[180px] flex-1 list-none space-y-2 p-0 text-[13px]">
              {data.sessions.map((session) => (
                <li key={session.key} className="flex items-center gap-2 text-gray-800 dark:text-slate-200">
                  {session.status === "completed" || session.status === "nothing_due" ? <CheckCircle2 className="h-5 w-5 shrink-0 fill-emerald-500 text-white" />
                    : session.status === "missed" ? <XCircle className="h-5 w-5 shrink-0 fill-rose-500 text-white" />
                      : <CircleDot className={`h-5 w-5 shrink-0 ${session.status === "open" ? "text-[#5B3FD9]" : "text-gray-300"}`} />}
                  <span><b className="font-semibold">{session.timeLabel}</b> – {session.status === "open" || session.key === nextKey ? "Due" : SESSION_WORD[session.status]}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_390px]">
        <Card className="overflow-hidden">
          <div className="flex items-start gap-3 px-5 pt-4">
            <IconTile><ClipboardList className="h-5 w-5" /></IconTile>
            <div>
              <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Active Waybills ({data.waybills.length})</h3>
              <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Waybills awaiting receipt and follow-up.</p>
            </div>
          </div>
          <WaybillTable rows={data.waybills} options={data.options.responses} pageSize={5} onLog={onLog} onHistory={(id) => onHistory(id)} onOpenWaybills={onOpenWaybills}
            nowMs={nowMs} onInform={onInform} informing={informing} />
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <IconTile><ClipboardList className="h-5 w-5" /></IconTile>
              <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Recent Follow-Up Logs</h3>
            </span>
            <button type="button" onClick={() => onHistory()} className="!min-h-0 text-[13px] font-semibold text-[#5B3FD9] hover:underline">View All</button>
          </div>
          {data.recentLogs.length === 0
            ? <p className="m-0 mt-6 text-center text-[13px] text-gray-500">No follow-up logged {isToday ? "today" : "on this day"} yet.</p>
            : (
              <ol className="m-0 mt-3 list-none space-y-0 p-0">
                {data.recentLogs.map((log) => {
                  const option = data.options.responses.find((row) => row.key === log.response);
                  return (
                    <li key={log.id} className="relative flex gap-3 border-b border-gray-100 py-3 pl-4 last:border-0 dark:border-slate-800">
                      <span className="absolute left-0 top-0 h-full w-px bg-gray-200 dark:bg-slate-700" aria-hidden="true" />
                      <span className="absolute -left-[3px] top-5 h-1.5 w-1.5 rounded-full bg-gray-400" aria-hidden="true" />
                      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${log.channels.includes("call") ? "bg-rose-50 dark:bg-rose-500/10" : "bg-emerald-50 dark:bg-emerald-500/10"}`}><ChannelIcon channels={log.channels} callTone="text-rose-500" /></span>
                      <span className="w-[62px] shrink-0 pt-1 text-[13px] text-gray-800 dark:text-slate-200">{lagosTime(log.at)}</span>
                      <span className="min-w-0 pt-1">
                        <button type="button" onClick={() => onHistory(log.waybillId)} title="See every follow-up of this waybill" className="!min-h-0 block text-left text-[13px] font-bold text-gray-900 hover:text-[#5B3FD9] hover:underline dark:text-slate-100">{log.waybillId}{log.state ? ` (${log.state})` : ""}</button>
                        <span className="block truncate text-[12.5px] text-gray-600 dark:text-slate-400">{log.response === "other" && log.responseNote ? log.responseNote : option?.short ?? log.response} – {log.agentName}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50/80 to-white p-5 dark:border-rose-500/20 dark:from-rose-500/10 dark:to-slate-900">
          <div className="flex items-start gap-3">
            <IconTile tone="red"><ShieldAlert className="h-5 w-5" /></IconTile>
            <div>
              <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Accountability ({isToday ? "Today" : shortDate(data.date)})</h3>
              <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Missed follow-ups attract {naira(data.accountability.amountEach)} per waybill per session.</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 divide-x divide-rose-100 rounded-xl bg-white text-center dark:divide-slate-800 dark:bg-slate-900">
            <div className="px-2 py-3"><p className="m-0 text-[13px] text-rose-700">Missed Follow-Ups</p><b className="text-[24px] text-rose-600">{data.accountability.missed}</b></div>
            <div className="px-2 py-3"><p className="m-0 text-[13px] text-gray-700 dark:text-slate-300">Charge per Follow-Up</p><b className="text-[24px] text-rose-600">{naira(data.accountability.amountEach)}</b></div>
            <div className="px-2 py-3"><p className="m-0 text-[13px] text-rose-700">Total Charges</p><b className="text-[24px] text-rose-600">{naira(data.accountability.total)}</b></div>
          </div>
          {(practice || !data.settings.responsibleName) && (
            <p className="m-0 mt-3 text-[12.5px] text-gray-600 dark:text-slate-400">
              {practice ? `Practice days: nothing is charged before ${shortDate(data.settings.chargesFrom)}. ` : ""}
              {!data.settings.responsibleName ? "Nobody is set as responsible, so misses are recorded but not charged (Reports & Settings)." : `Charged to ${data.settings.responsibleName}.`}
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-violet-100 bg-gradient-to-br from-[#F5F2FE] to-white p-5 dark:border-violet-500/20 dark:from-violet-500/10 dark:to-slate-900">
          <div className="flex items-start gap-3">
            <IconTile><BarChart3 className="h-5 w-5" /></IconTile>
            <div>
              <h3 className="m-0 text-[18px] font-bold text-[#3F2AA8] dark:text-violet-200">Compliance (This Week)</h3>
              <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Follow-up performance and accountability.</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 divide-x divide-violet-100 rounded-xl bg-white text-center dark:divide-slate-800 dark:bg-slate-900">
            <div className="px-2 py-3"><p className="m-0 text-[13px] text-gray-700 dark:text-slate-300">Compliance Rate</p><span className="mt-1 inline-block rounded-full bg-emerald-50 px-3 py-0.5 text-[20px] font-bold text-emerald-700 dark:bg-emerald-500/10">{data.week.complianceRate === null ? "—" : `${data.week.complianceRate}%`}</span></div>
            <div className="px-2 py-3"><p className="m-0 text-[13px] text-gray-700 dark:text-slate-300">Total Sessions</p><b className="text-[24px] text-gray-900 dark:text-slate-50">{data.week.totalSessions}</b></div>
            <div className="px-2 py-3"><p className="m-0 text-[13px] text-gray-700 dark:text-slate-300">Missed Sessions</p><b className="text-[24px] text-rose-600">{data.week.missedSessions}</b></div>
          </div>
        </section>
      </div>
    </div>
  );
}
