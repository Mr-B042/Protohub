import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  Box, CalendarDays, Check, CheckCircle2, Clock, Copy, Flag, History, Layers, Loader2, MapPin, Megaphone, MessageSquareText, Paperclip, Phone, PhoneMissed, Plus, UserRound, X
} from "lucide-react";
import { WhatsAppIcon } from "../../components/WhatsAppIcon";
import { waybillFollowUpApi, type WfActiveRow, type WfLog, type WfResponseOption } from "../../lib/api";
import { Pill, STATUS_LOOK, lagosTime } from "./wf-ui";

type Props = {
  row: WfActiveRow;
  options: WfResponseOption[];
  onClose: () => void;
  onLog: () => void;
  onOpenWaybills: () => void;
  onToast: (message: string) => void;
};

type Filter = "all" | "call" | "whatsapp" | "news" | "silent";

const LAGOS = 60 * 60_000;
const lagosDay = (iso: string) => new Date(new Date(iso).getTime() + LAGOS).toISOString().slice(0, 10);
const dayTitle = (key: string) => {
  const today = lagosDay(new Date().toISOString());
  const yesterday = new Date(new Date(`${today}T12:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  const long = new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return key === today ? `Today · ${long}` : key === yesterday ? `Yesterday · ${long}` : long;
};
const shortDay = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const channelText = (channels: string[]) => (channels.length > 1 ? "Call + WhatsApp" : channels.includes("call") ? "Phone call" : "WhatsApp");

/**
 * Every follow-up of one waybill in one window (Bright, 12 Nov 2026: "we want
 * to see all logs in a place"). Opens from the waybill number, the last
 * follow-up or the agent's answer in the table; all time, not just 7 days.
 */
export default function WaybillLogsModal({ row, options, onClose, onLog, onOpenWaybills, onToast }: Props) {
  const [logs, setLogs] = useState<WfLog[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    waybillFollowUpApi.waybillLogs(row.id)
      .then((result) => { if (live) setLogs(result.logs); })
      .catch((err: Error) => { if (live) setError(err.message || "Could not load the follow-ups."); });
    return () => { live = false; };
  }, [row.id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  const optionOf = (key: string) => options.find((option) => option.key === key);
  const isNews = (log: WfLog) => optionOf(log.response)?.useful !== false;
  const counts = useMemo(() => {
    const all = logs ?? [];
    return {
      all: all.length,
      call: all.filter((log) => log.channels.includes("call")).length,
      whatsapp: all.filter((log) => log.channels.includes("whatsapp")).length,
      news: all.filter(isNews).length,
      silent: all.filter((log) => !isNews(log)).length,
      days: new Set(all.map((log) => lagosDay(log.at))).size
    };
  }, [logs, options]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (logs ?? []).filter((log) =>
    filter === "all" || (filter === "call" && log.channels.includes("call")) || (filter === "whatsapp" && log.channels.includes("whatsapp"))
    || (filter === "news" && isNews(log)) || (filter === "silent" && !isNews(log))), [logs, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(() => {
    const out: Array<{ key: string; logs: WfLog[] }> = [];
    for (const log of shown) {
      const key = lagosDay(log.at);
      const last = out[out.length - 1];
      if (last?.key === key) last.logs.push(log); else out.push({ key, logs: [log] });
    }
    return out;
  }, [shown]);

  const openEvidence = async (id: string) => {
    try { window.open((await waybillFollowUpApi.evidence(id)).url, "_blank", "noopener"); } catch (err) { onToast((err as Error).message || "Could not open the file."); }
  };
  const copyId = async () => {
    try { await navigator.clipboard.writeText(row.id); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard: nothing to do */ }
  };

  const dispatched = row.dispatchedDate ?? row.createdAt.slice(0, 10);
  const transitDays = Math.max(0, Math.floor((Date.now() - new Date(`${dispatched}T00:00:00+01:00`).getTime()) / 86_400_000));
  const notice = row.notice;
  const noticeText = !notice ? "Made before this rule"
    : notice.informedAt ? `${lagosTime(notice.informedAt)}${notice.informedByName ? ` by ${notice.informedByName}` : ""}${notice.state === "done_late" ? " (late)" : ""}`
      : notice.state === "late" ? "Not yet · late" : "Not yet";

  const detail = (Icon: ComponentType<{ className?: string }>, label: string, value: ReactNode) => (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#5B3FD9] dark:bg-slate-900 dark:text-violet-300"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block text-[11.5px] font-medium text-gray-500 dark:text-slate-400">{label}</span>
        <span className="block break-words text-[13.5px] font-semibold text-gray-900 dark:text-slate-100">{value}</span>
      </span>
    </div>
  );
  const stat = (label: string, value: ReactNode, hint: string, tone = "text-gray-900 dark:text-slate-50") => (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
      <span className="block text-[11.5px] font-medium text-gray-500 dark:text-slate-400">{label}</span>
      <b className={`block text-[22px] font-extrabold leading-7 ${tone}`}>{value}</b>
      <span className="block text-[11.5px] text-gray-500 dark:text-slate-400">{hint}</span>
    </div>
  );
  const chips: Array<{ key: Filter; label: string; n: number }> = [
    { key: "all", label: "All", n: counts.all },
    { key: "call", label: "Calls", n: counts.call },
    { key: "whatsapp", label: "WhatsApp", n: counts.whatsapp },
    { key: "news", label: "Got news", n: counts.news },
    { key: "silent", label: "No response", n: counts.silent }
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[1px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Follow-ups for ${row.id}`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-950 sm:max-w-[860px] sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4 dark:border-slate-800">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white"><History className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-gray-500 dark:text-slate-400">All follow-ups for waybill</span>
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-[22px] font-extrabold leading-7 tracking-tight text-gray-900 dark:text-slate-50">{row.id}</b>
              <button type="button" aria-label="Copy waybill number" title={copied ? "Copied" : "Copy waybill number"} onClick={copyId}
                className="!min-h-0 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              <Pill tone={STATUS_LOOK[row.status].tone}>{STATUS_LOOK[row.status].label}</Pill>
              {row.noNewsStreak >= 2 && <Pill tone={row.noNewsStreak >= 3 ? "red" : "amber"}>{row.noNewsStreak >= 3 ? `No response ×${row.noNewsStreak} · escalate` : "No response twice"}</Pill>}
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Waybill details */}
          <section className="grid grid-cols-2 gap-3 rounded-[14px] bg-[#F5F2FE] p-3.5 dark:bg-violet-500/10 sm:grid-cols-3">
            {detail(UserRound, "Receiving agent", <>{row.agentName || "—"}{row.agentPhone && <a href={`tel:${row.agentPhone}`} className="!min-h-0 block text-[12.5px] font-medium text-[#2F5BEA] hover:underline">{row.agentPhone}</a>}</>)}
            {detail(MapPin, "Destination", [row.city, row.state].filter(Boolean).join(", ") || "—")}
            {detail(Box, "Products", `${row.productName} (${row.quantity} pcs)`)}
            {detail(CalendarDays, "Dispatched", shortDay(dispatched))}
            {detail(Clock, "In transit", plural(transitDays, "day"))}
            {detail(Megaphone, "Agent's group told", noticeText)}
          </section>

          {/* Totals */}
          <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {stat("Follow-ups", logs ? counts.all : "…", logs ? `over ${plural(counts.days, "day")}` : "loading")}
            {stat("Calls · WhatsApp", logs ? `${counts.call} · ${counts.whatsapp}` : "…", "how the agent was reached")}
            {stat("Got news", logs ? counts.news : "…", "agent gave an update", "text-emerald-700 dark:text-emerald-300")}
            {stat("No response", logs ? counts.silent : "…", "no answer, no reply or away", counts.silent ? "text-rose-600 dark:text-rose-300" : undefined)}
          </section>

          {/* Filter */}
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Show">
            {chips.map((chip) => (
              <button key={chip.key} type="button" role="tab" aria-selected={filter === chip.key} onClick={() => setFilter(chip.key)}
                className={`!min-h-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-semibold ${filter === chip.key
                  ? "border-[#5B3FD9] bg-[#5B3FD9] text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
                {chip.label}<span className={`rounded-full px-1.5 text-[11px] ${filter === chip.key ? "bg-white/25" : "bg-gray-100 dark:bg-slate-800"}`}>{chip.n}</span>
              </button>
            ))}
          </div>

          {/* Timeline */}
          {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</p>}
          {!logs && !error && <p className="m-0 flex items-center gap-2 py-6 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading every follow-up…</p>}
          {logs && shown.length === 0 && (
            <p className="m-0 rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-[13px] text-gray-500 dark:border-slate-700">
              {logs.length === 0 ? "No follow-up has been logged for this waybill yet." : "No follow-up matches this filter."}
            </p>
          )}
          {days.map((day) => (
            <section key={day.key}>
              <div className="sticky top-[-16px] z-[1] -mx-5 flex items-center justify-between bg-white/95 px-5 py-1.5 backdrop-blur dark:bg-slate-950/95">
                <b className="text-[13px] text-gray-900 dark:text-slate-100">{dayTitle(day.key)}</b>
                <span className="text-[12px] text-gray-500">{plural(day.logs.length, "follow-up")}</span>
              </div>
              <ol className="relative m-0 mt-1 list-none space-y-2.5 p-0 pl-11 before:absolute before:bottom-3 before:left-[17px] before:top-3 before:w-px before:bg-gray-200 dark:before:bg-slate-700">
                {day.logs.map((log) => {
                  const option = optionOf(log.response);
                  const news = option?.useful !== false;
                  const Icon = log.channels.includes("call") ? (news ? Phone : PhoneMissed) : null;
                  return (
                    <li key={log.id} className="relative">
                      <span className={`absolute -left-11 top-2 inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-white shadow-sm dark:border-slate-950 ${news ? "bg-emerald-50 dark:bg-emerald-500/15" : "bg-rose-50 dark:bg-rose-500/15"}`}>
                        {Icon ? <Icon className={`h-4 w-4 ${news ? "text-sky-600" : "text-rose-600"}`} /> : <WhatsAppIcon className="h-4 w-4 text-[#1FAF52]" />}
                      </span>
                      <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <b className="text-[14px] text-gray-900 dark:text-slate-50">{lagosTime(log.at)}</b>
                          <span className="text-[12.5px] text-gray-500">{channelText(log.channels)}</span>
                          {log.sessionLabel ? <Pill tone="purple">{log.sessionLabel}</Pill> : <Pill tone="slate">Between sessions</Pill>}
                          <Pill tone={option?.tone ?? "slate"} className="sm:ml-auto">{option?.label ?? log.response}</Pill>
                        </div>
                        {log.responseNote && (
                          <p className="m-0 mt-2 flex gap-2 whitespace-pre-wrap break-words rounded-lg bg-gray-50 px-3 py-2 text-[13.5px] leading-[1.45] text-gray-800 dark:bg-slate-800/60 dark:text-slate-200">
                            <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" /><span>“{log.responseNote}”</span>
                          </p>
                        )}
                        {log.nextAction && (
                          <p className="m-0 mt-2 flex items-start gap-2 text-[13px] text-gray-700 dark:text-slate-300">
                            <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /><span><b className="font-semibold">Next:</b> {log.nextAction}</span>
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-500 dark:text-slate-400">
                          <span>Logged by <b className="font-semibold text-gray-700 dark:text-slate-300">{log.loggedByName || "—"}</b></span>
                          {log.batchId && <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" />Same call covered other waybills</span>}
                          {log.hasEvidence && (
                            <button type="button" onClick={() => openEvidence(log.id)} className="!min-h-0 inline-flex items-center gap-1 font-semibold text-[#5B3FD9] hover:underline dark:text-violet-300">
                              <Paperclip className="h-3.5 w-3.5" />Evidence
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-5 py-3 dark:border-slate-800 sm:flex-row sm:items-center">
          <span className="text-[12px] text-gray-500 sm:mr-auto">A follow-up is never changed or deleted.</span>
          <button type="button" onClick={onOpenWaybills} className="!min-h-0 inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-gray-300 bg-white px-4 text-[14px] font-semibold text-gray-900 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />Mark received
          </button>
          <button type="button" onClick={onLog} className="!min-h-0 inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-[#5B3FD9] px-4 text-[14px] font-semibold text-white hover:bg-[#4C32C4]">
            <Plus className="h-4 w-4" />Log Follow-Up
          </button>
        </div>
      </div>
    </div>
  );
}

