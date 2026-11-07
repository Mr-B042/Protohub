import { useEffect, useRef, useState } from "react";
import { Check, Clock3, Loader2, Megaphone, TimerReset } from "lucide-react";
import type { WfActiveRow, WfNotice, WfSession } from "../../lib/api";
import { Card, IconTile, lagosTime, naira } from "./wf-ui";

/**
 * Live countdowns for the Waybill Follow-Up Center (Bright, 7 Nov 2026: "a
 * timer countdown for FOMO and urgency, so she stays alert"). Every second,
 * set by the server's clock so a phone with the wrong time still counts right.
 */
export function useLiveNow(serverNowMs: number | undefined) {
  const offset = useRef(0);
  useEffect(() => { if (serverNowMs) offset.current = serverNowMs - Date.now(); }, [serverNowMs]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);
  return now + offset.current;
}

/** 1:05:09 / 42:17 / 00:09. */
export function clockText(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

/** Green with time to spare, amber under a third left, red (and pulsing) in the last 10 minutes or late. */
export function timerTone(leftMs: number, totalMs: number) {
  if (leftMs <= 0) return { text: "text-rose-700 dark:text-rose-300", box: "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10", pulse: false };
  if (leftMs <= 10 * 60_000) return { text: "text-rose-600 dark:text-rose-300", box: "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10", pulse: true };
  if (leftMs <= Math.max(15 * 60_000, totalMs / 3)) return { text: "text-amber-700 dark:text-amber-300", box: "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10", pulse: false };
  return { text: "text-emerald-700 dark:text-emerald-300", box: "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10", pulse: false };
}

/** The pill at the top of the page: the open session's countdown, or the next one's. */
export function SessionTimer({ sessions, nowMs, isToday, workingDay }: { sessions: WfSession[]; nowMs: number; isToday: boolean; workingDay: boolean }) {
  if (!isToday || !workingDay) return null;
  const open = sessions.find((session) => nowMs >= Date.parse(session.openAt) && nowMs <= Date.parse(session.closeAt));
  const next = sessions.find((session) => nowMs < Date.parse(session.openAt));
  if (!open && !next) return null;
  const left = open ? Date.parse(open.closeAt) - nowMs : Date.parse(next!.openAt) - nowMs;
  const urgent = !!open && left <= 5 * 60_000;
  return (
    <span role="timer" aria-live="off"
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[13.5px] font-semibold ${open
        ? urgent ? "animate-pulse border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200" : "border-[#C9BEF5] bg-[#F5F2FE] text-[#3F2AA8] dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200"
        : "border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
      <Clock3 className="h-4 w-4" />
      {open ? <>{open.label} closes in <b className="font-mono text-[15px] tabular-nums">{clockText(left)}</b></> : <>{next!.label} ({next!.timeLabel}) opens in <b className="font-mono text-[15px] tabular-nums">{clockText(left)}</b></>}
    </span>
  );
}

/** A waybill's "tell the agent's group" timer, small (for the table). */
export function NoticeChip({ notice, nowMs, busy, onInform }: { notice: WfNotice | null; nowMs: number; busy: boolean; onInform: () => void }) {
  if (!notice) return <span className="text-gray-400">—</span>;
  if (notice.state === "done" || notice.state === "done_late") {
    return (
      <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold ${notice.state === "done" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
        <Check className="h-3.5 w-3.5" strokeWidth={3} />{lagosTime(notice.informedAt)}{notice.state === "done_late" ? " (late)" : ""}
      </span>
    );
  }
  if (notice.state === "closed") return <span className="whitespace-nowrap text-[12.5px] text-gray-500">Received first</span>;
  const left = Date.parse(notice.dueAt) - nowMs;
  const total = Date.parse(notice.dueAt) - Date.parse(notice.startAt);
  const started = nowMs >= Date.parse(notice.startAt);
  const tone = timerTone(left, total);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[12.5px] font-bold tabular-nums ${tone.box} ${tone.text} ${tone.pulse ? "animate-pulse" : ""}`}>
        {!started ? `from ${lagosTime(notice.startAt)}` : left > 0 ? clockText(left) : `LATE ${clockText(-left)}`}
      </span>
      <button type="button" disabled={busy} onClick={onInform} className="!min-h-0 rounded-md border border-emerald-300 bg-white px-1.5 py-0.5 text-[11.5px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-500/40 dark:bg-slate-900 dark:text-emerald-300">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Tick"}
      </button>
    </span>
  );
}

/**
 * The top of the dashboard: new waybills whose agent's group must be told,
 * each with its countdown and a one-tap tick (Bright, 7 Nov 2026).
 */
export function NoticePanel({ rows, nowMs, minutes, amount, charged, busyIds, onInform }: {
  rows: WfActiveRow[]; nowMs: number; minutes: number; amount: number; charged: boolean; busyIds: Set<string>; onInform: (ids: string[]) => void;
}) {
  const pending = rows.filter((row) => row.notice && (row.notice.state === "waiting" || row.notice.state === "late"))
    .sort((a, b) => Date.parse(a.notice!.dueAt) - Date.parse(b.notice!.dueAt));
  const today = new Date(nowMs + 60 * 60_000).toISOString().slice(0, 10);
  const toldToday = rows.filter((row) => row.notice?.informedAt && new Date(Date.parse(row.notice.informedAt) + 60 * 60_000).toISOString().slice(0, 10) === today);
  const late = pending.filter((row) => Date.parse(row.notice!.dueAt) <= nowMs).length;
  if (pending.length === 0 && toldToday.length === 0) return null;
  return (
    <Card className={`overflow-hidden ${late ? "border-rose-200 dark:border-rose-500/30" : ""}`}>
      <div className="flex flex-wrap items-start gap-3 px-5 pt-4">
        <IconTile tone={late ? "red" : "purple"}><Megaphone className="h-5 w-5" /></IconTile>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Tell the agent's group: new waybills</h3>
          <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">
            Within {minutes} minutes of making a waybill (from 8:00 AM when made after 5 PM, before 8 AM or on a day off). {charged ? `Late costs ${naira(amount)} each.` : "Practice days: nothing is charged yet."} Follow-ups start the next working day.
          </p>
        </div>
        {pending.length > 1 && (
          <button type="button" onClick={() => onInform(pending.map((row) => row.id))} disabled={pending.some((row) => busyIds.has(row.id))}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-[13px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            <Check className="h-4 w-4" strokeWidth={3} />All {pending.length} told
          </button>
        )}
      </div>
      {pending.length > 0 ? (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-4 md:grid-cols-2 2xl:grid-cols-3">
          {pending.map((row) => {
            const notice = row.notice!;
            const left = Date.parse(notice.dueAt) - nowMs;
            const total = Date.parse(notice.dueAt) - Date.parse(notice.startAt);
            const started = nowMs >= Date.parse(notice.startAt);
            const tone = timerTone(left, total);
            return (
              <li key={row.id} className={`flex items-center gap-3 rounded-2xl border p-3 ${tone.box}`}>
                <div className="min-w-0 flex-1">
                  <b className="block text-[14.5px] text-gray-900 dark:text-slate-50">{row.id}</b>
                  <span className="block truncate text-[12.5px] text-gray-700 dark:text-slate-300">{row.state || "—"} · {row.agentName}</span>
                  <span className="block truncate text-[12px] text-gray-500 dark:text-slate-400">{row.productName} × {row.quantity} · made {lagosTime(row.createdAt)}</span>
                </div>
                <div className="text-right">
                  <span role="timer" className={`block font-mono text-[26px] font-black leading-none tabular-nums ${tone.text} ${tone.pulse ? "animate-pulse" : ""}`}>
                    {!started ? lagosTime(notice.startAt) : left > 0 ? clockText(left) : `+${clockText(-left)}`}
                  </span>
                  <span className={`mt-1 block text-[11.5px] font-bold uppercase tracking-wide ${tone.text}`}>{!started ? "clock starts" : left > 0 ? "left" : "late"}</span>
                </div>
                <button type="button" disabled={busyIds.has(row.id)} onClick={() => onInform([row.id])}
                  className="!min-h-0 inline-flex shrink-0 flex-col items-center justify-center rounded-xl bg-emerald-600 px-3 py-2 text-[12.5px] font-bold leading-tight text-white hover:bg-emerald-700 disabled:opacity-50">
                  {busyIds.has(row.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={3} />}Agent<br />informed
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 flex items-center gap-2 px-5 py-4 text-[13.5px] font-semibold text-emerald-700 dark:text-emerald-300"><TimerReset className="h-4 w-4" />Every new waybill's agent has been told.</p>
      )}
      {toldToday.length > 0 && (
        <p className="m-0 border-t border-gray-100 px-5 py-2.5 text-[12.5px] text-gray-600 dark:border-slate-800 dark:text-slate-400">
          Told today: {toldToday.map((row) => `${row.id} at ${lagosTime(row.notice!.informedAt)}${row.notice!.state === "done_late" ? " (late)" : ""}`).join(" · ")}
        </p>
      )}
    </Card>
  );
}
