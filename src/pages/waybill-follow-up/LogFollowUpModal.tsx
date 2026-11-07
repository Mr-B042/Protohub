import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  AlertTriangle, Box, CalendarDays, Check, CheckCircle2, ChevronDown, Clock, CloudUpload, Copy, Flag, Info, Loader2, MapPin,
  MoreHorizontal, Paperclip, Phone, PhoneMissed, Search, Truck, UserRound, Users, X, XCircle
} from "lucide-react";
import { WhatsAppIcon } from "../../components/WhatsAppIcon";
import { waybillFollowUpApi, type WfActiveRow, type WfDashboard } from "../../lib/api";
import { Pill, STATUS_LOOK } from "./wf-ui";

type Props = {
  waybills: WfActiveRow[];
  preselected: string[];
  options: WfDashboard["options"];
  graceMinutes: number;
  workingDays: number[];
  onClose: () => void;
  onSaved: (message: string) => void;
};

const NOTE_MAX = 500;
const FILE_MAX = 5 * 1024 * 1024;
const LAGOS = 60 * 60_000;

/** Today's five sessions (Lagos), from the same times as the server. */
const SESSIONS = [
  { key: "m1", label: "Morning 1", time: "8:00 AM", at: 480 },
  { key: "m2", label: "Morning 2", time: "10:00 AM", at: 600 },
  { key: "a1", label: "Afternoon 1", time: "12:00 PM", at: 720 },
  { key: "a2", label: "Afternoon 2", time: "2:00 PM", at: 840 },
  { key: "ev", label: "Evening", time: "4:00 – 5:00 PM", at: 960, end: 1020 }
] as const;

function todaySessions(nowMs: number, grace: number) {
  const today = new Date(nowMs + LAGOS).toISOString().slice(0, 10);
  const base = Date.parse(`${today}T00:00:00+01:00`);
  return SESSIONS.map((session) => ({
    ...session,
    openMs: base + (session.at - grace) * 60_000,
    dueMs: base + session.at * 60_000,
    closeMs: base + ("end" in session ? session.end : session.at + grace) * 60_000
  }));
}

type IconType = ComponentType<{ className?: string }>;
const RESPONSE_LOOK: Record<string, { Icon: IconType; tone: string; tint: string }> = {
  received: { Icon: CheckCircle2, tone: "text-emerald-600", tint: "bg-emerald-50 dark:bg-emerald-500/10" },
  receive_today: { Icon: CalendarDays, tone: "text-[#5B3FD9] dark:text-violet-300", tint: "bg-[#EEEBFC] dark:bg-violet-500/15" },
  receive_tomorrow: { Icon: CalendarDays, tone: "text-[#2F6BEA]", tint: "bg-blue-50 dark:bg-blue-500/10" },
  in_transit: { Icon: Truck, tone: "text-[#2F6BEA]", tint: "bg-blue-50 dark:bg-blue-500/10" },
  unavailable: { Icon: UserRound, tone: "text-violet-600 dark:text-violet-300", tint: "bg-violet-50 dark:bg-violet-500/10" },
  no_answer: { Icon: PhoneMissed, tone: "text-rose-500", tint: "bg-rose-50 dark:bg-rose-500/10" },
  no_reply: { Icon: WhatsAppIcon, tone: "text-[#1FAF52]", tint: "bg-emerald-50 dark:bg-emerald-500/10" },
  problem: { Icon: AlertTriangle, tone: "text-orange-500", tint: "bg-orange-50 dark:bg-orange-500/10" },
  more_info: { Icon: Info, tone: "text-[#2F6BEA]", tint: "bg-blue-50 dark:bg-blue-500/10" },
  other: { Icon: MoreHorizontal, tone: "text-gray-600 dark:text-slate-300", tint: "bg-gray-100 dark:bg-slate-800" }
};

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ""));
  reader.onerror = () => reject(new Error("Could not read the file."));
  reader.readAsDataURL(file);
});

const clock = (value: string | number) => new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
const day = (key: string | null) => key ? new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

const panel = "rounded-[18px] border border-[#E7E8F4] bg-white dark:border-slate-800 dark:bg-slate-900";
const lavender = "bg-[#F1EDFE] dark:bg-violet-500/10";

function Step({ n, title, hint, required }: { n: number; title: string; hint?: string; required?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E9E4FE] text-[14px] font-bold text-[#5B3FD9] dark:bg-violet-500/20 dark:text-violet-200">{n}</span>
      <b className="text-[15.5px] text-gray-900 dark:text-slate-50">{title}{required && <span className="text-rose-500"> *</span>}</b>
      {hint && <span className="text-[12.5px] text-gray-500 dark:text-slate-400">({hint})</span>}
    </div>
  );
}

/** A section heading with its icon in a soft round tile (Next Action, Evidence). */
function Heading({ Icon, title, hint }: { Icon: IconType; title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E9E4FE] text-[#5B3FD9] dark:bg-violet-500/20 dark:text-violet-200"><Icon className="h-[15px] w-[15px]" /></span>
      <b className="text-[15.5px] text-gray-900 dark:text-slate-50">{title}</b>
      {hint && <span className="text-[12.5px] text-gray-500 dark:text-slate-400">({hint})</span>}
    </div>
  );
}

/** Square tick box (the app's --radius makes rounded-md almost a circle, so the radius is set in px). */
function Tick({ on }: { on: boolean }) {
  return (
    <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] ${on ? "border-[#5B3FD9] bg-[#5B3FD9] text-white" : "border-gray-300 bg-white dark:border-slate-600 dark:bg-slate-900"}`}>
      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] bg-white dark:bg-slate-900 ${on ? "border-[#5B3FD9]" : "border-gray-300 dark:border-slate-600"}`}>
      {on && <span className="h-2.5 w-2.5 rounded-full bg-[#5B3FD9]" />}
    </span>
  );
}

/** One dot of today's progress line. */
function Dot({ state }: { state: string }) {
  if (state === "done") return <CheckCircle2 className="relative z-[1] h-5 w-5 shrink-0 fill-emerald-500 text-white" />;
  if (state === "missed") return <XCircle className="relative z-[1] h-5 w-5 shrink-0 fill-rose-500 text-white" />;
  return (
    <span className="relative z-[1] inline-flex h-5 w-5 shrink-0 items-center justify-center">
      {state === "now"
        ? <span className="h-3.5 w-3.5 rounded-full bg-[#5B3FD9] ring-[3px] ring-[#DED7FD] dark:ring-violet-500/30" />
        : <span className="h-4 w-4 rounded-full border-2 border-gray-300 bg-white dark:border-slate-600 dark:bg-slate-900" />}
    </span>
  );
}

/**
 * Log Follow-Up, built to Bright's design (7 Nov 2026). A channel, what the
 * agent said and the notes are required; no reply is logged as "no
 * response", never an invented answer. One call can cover several waybills,
 * but only the ones ticked.
 */
export default function LogFollowUpModal({ waybills, preselected, options, graceMinutes, workingDays, onClose, onSaved }: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set(preselected));
  const [search, setSearch] = useState("");
  const [channels, setChannels] = useState<Set<string>>(new Set());
  const [response, setResponse] = useState("");
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [otherAction, setOtherAction] = useState("");
  const [file, setFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const tick = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => { window.removeEventListener("keydown", onKey); window.clearInterval(tick); };
  }, [onClose]);

  const chosen = useMemo(() => waybills.filter((row) => picked.has(row.id)), [waybills, picked]);
  // Opened from one waybill's row: its details. Opened from the header or with several ticked: the picker, all the time.
  const single = preselected.length === 1 ? chosen[0] ?? null : null;
  const pickList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return waybills.filter((row) => !q || `${row.id} ${row.agentName} ${row.state}`.toLowerCase().includes(q));
  }, [waybills, search]);

  const workingToday = workingDays.includes(new Date(nowMs + LAGOS).getUTCDay());
  const sessions = todaySessions(nowMs, graceMinutes);
  const current = workingToday ? sessions.find((session) => nowMs >= session.openMs && nowMs <= session.closeMs) ?? null : null;
  const next = workingToday ? sessions.find((session) => nowMs < session.openMs) ?? null : null;

  const both = channels.has("whatsapp") && channels.has("call");
  // "Both" is WhatsApp + call; picking one card while Both is on switches to just that one.
  const toggleChannel = (key: "whatsapp" | "call" | "both") => setChannels((value) => {
    const isBoth = value.has("whatsapp") && value.has("call");
    if (key === "both") return isBoth ? new Set() : new Set(["whatsapp", "call"]);
    if (isBoth) return new Set([key]);
    const out = new Set(value);
    if (out.has(key)) out.delete(key); else out.add(key);
    return out;
  });

  const save = async () => {
    setError("");
    if (chosen.length === 0) { setError("Choose at least one waybill."); return; }
    if (channels.size === 0) { setError("Select at least one communication channel."); return; }
    if (!response) { setError("Select the agent's response. If there was no reply, choose a 'no response' answer."); return; }
    if (note.trim().length < 3) { setError("Write the follow-up notes: what was said and what happens next."); return; }
    setSaving(true);
    try {
      const result = await waybillFollowUpApi.log({
        waybillIds: chosen.map((row) => row.id), channels: [...channels], response, responseNote: note.trim(),
        nextAction: nextAction === "Other" ? otherAction.trim() : nextAction, evidence: file ? { dataUrl: file.dataUrl } : null
      });
      onSaved(`Follow-up saved for ${result.logged} waybill${result.logged === 1 ? "" : "s"}${result.sessionLabel ? ` (${result.sessionLabel})` : " (between sessions: kept in the history)"}.`);
    } catch (err) {
      setError((err as Error).message || "Could not save the follow-up.");
    } finally {
      setSaving(false);
    }
  };

  const copyId = async (id: string) => {
    try { await navigator.clipboard.writeText(id); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  const daysInTransit = single ? Math.max(0, Math.floor((nowMs - Date.parse(single.dispatchedDate ? `${single.dispatchedDate}T12:00:00+01:00` : single.createdAt)) / 86_400_000)) : 0;
  const detail = (Icon: IconType, label: string, value: ReactNode) => (
    <div className="flex items-start gap-3">
      <Icon className="mt-[9px] h-[18px] w-[18px] shrink-0 text-gray-700 dark:text-slate-400" />
      <div className="flex min-w-0 flex-1 items-start gap-2 border-b border-gray-100 py-2 dark:border-slate-800">
        <span className="w-[128px] shrink-0 text-[13px] leading-5 text-gray-700 dark:text-slate-400">{label}</span>
        <span className="min-w-0 text-[14px] font-semibold leading-5 text-gray-900 dark:text-slate-100">{value}</span>
      </div>
    </div>
  );

  // This waybill's own day, session by session.
  const progress = single ? sessions.map((session) => {
    const log = single.todayLogs.find((row) => row.sessionKey === session.key);
    const owed = Date.parse(single.createdAt) <= session.dueMs;
    const state = !workingToday ? "off"
      : log ? "done"
        : nowMs >= session.openMs && nowMs <= session.closeMs ? "now"
          : nowMs < session.openMs ? "pending"
            : owed ? "missed" : "not_due";
    return { ...session, state, at: log?.at ?? null };
  }) : [];
  const progressText = (state: string, at: string | null) =>
    state === "done" ? `Completed (${clock(at!)})` : state === "now" ? "In Progress" : state === "missed" ? "Missed"
      : state === "not_due" ? "Not due (before dispatch)" : state === "off" ? "Day off" : "Pending";

  // The session a log made now counts for; between sessions it counts for none.
  const sessionValue = !workingToday ? "Day off" : current ? `${current.label} – ${current.time}` : next ? `Next: ${next.time}` : "No more sessions today";
  const sessionHint = !workingToday ? "Nothing is owed today. This log is kept in the history."
    : current ? "" : `This log won't count for a session.${next ? ` ${next.label} opens at ${clock(next.openMs)}.` : ""}`;

  const channelCard = (key: "whatsapp" | "call" | "both", label: ReactNode, icon: ReactNode) => {
    const on = key === "both" ? both : channels.has(key) && !both;
    return (
      <button type="button" onClick={() => toggleChannel(key)} aria-pressed={on}
        className={`!min-h-0 flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left text-[13.5px] font-medium leading-[17px] shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${on ? "border-[#5B3FD9] bg-[#F4F1FE] text-gray-900 ring-1 ring-[#5B3FD9]/40 dark:bg-violet-500/10 dark:text-slate-50" : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
        {icon}<span className="min-w-0 flex-1">{label}</span><Tick on={on} />
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[1px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Log follow-up" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex max-h-[94vh] w-full max-w-[1060px] flex-col overflow-hidden rounded-t-[22px] bg-white shadow-2xl dark:bg-slate-900 sm:max-h-[calc(100vh-32px)] sm:rounded-[22px]">
        <div className="flex items-start gap-4 bg-gradient-to-r from-white via-[#F5F5FE] to-[#E9E4FD] px-5 pb-4 pt-5 dark:from-slate-900 dark:via-slate-900 dark:to-violet-950/40 sm:px-7">
          <span className="inline-flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#8E5BF6] to-[#6A3FE6] text-white shadow-sm"><PhoneMissed className="h-[26px] w-[26px]" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[24px] font-extrabold leading-tight text-gray-900 dark:text-slate-50 sm:text-[26px]">Log Follow-Up</h2>
            <p className="m-0 mt-0.5 text-[14px] text-gray-600 dark:text-slate-400 sm:text-[15px]">Record your follow-up with the receiving agent for this waybill.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-y-auto bg-[#F6F6FC] p-2.5 dark:bg-slate-950/40 lg:grid-cols-[352px_minmax(0,1fr)]">
          {/* Left: the waybill, the session, this waybill's day */}
          <div className={`${panel} space-y-3 p-3`}>
            {single ? (
              <>
                <div className={`flex items-start justify-between gap-2 rounded-[14px] px-4 py-3.5 ${lavender}`}>
                  <div className="min-w-0">
                    <span className="text-[14px] font-semibold text-gray-800 dark:text-slate-200">Waybill</span>
                    <div className="mt-1 flex items-center gap-2.5">
                      <b className="text-[30px] font-extrabold leading-[34px] tracking-tight text-gray-900 dark:text-slate-50">{single.id}</b>
                      <button type="button" aria-label="Copy waybill number" title={copied ? "Copied" : "Copy waybill number"} onClick={() => copyId(single.id)}
                        className="!min-h-0 inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <Pill tone={STATUS_LOOK[single.status].tone} className="mt-0.5 !px-3 !py-1 !text-[13.5px]">{STATUS_LOOK[single.status].label}</Pill>
                </div>
                <div className="px-1">
                  {detail(MapPin, "Destination / State", [single.city, single.state].filter(Boolean).join(", ") || "—")}
                  {detail(Users, "Receiving Agent", single.agentName)}
                  {detail(Truck, "Shipment Status", <Pill tone="blue" className="!text-[13px]">In Transit</Pill>)}
                  {detail(CalendarDays, "Date Dispatched", day(single.dispatchedDate ?? single.createdAt.slice(0, 10)))}
                  {detail(Clock, "Days in Transit", `${daysInTransit} day${daysInTransit === 1 ? "" : "s"}`)}
                  {detail(Box, "Products", <>{single.productName} <span className="whitespace-nowrap">({single.quantity} pcs)</span></>)}
                </div>
              </>
            ) : (
              <div>
                <b className="text-[15px] text-gray-900 dark:text-slate-50">Waybills this call covered ({chosen.length})</b>
                <p className="m-0 mt-0.5 text-[12.5px] text-gray-500">Tick only the waybills you actually discussed.</p>
                <span className="relative mt-2 block">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search waybill, agent or state"
                    className="w-full rounded-[10px] border border-gray-200 bg-white py-2 pl-8 pr-2 text-[13px] dark:border-slate-700 dark:bg-slate-900" />
                </span>
                <div className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
                  {pickList.length === 0 && <p className="m-0 px-2 py-3 text-[13px] text-gray-500">No waybill is waiting for receipt.</p>}
                  {pickList.map((row) => (
                    <label key={row.id} className="flex cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-[13px] hover:bg-gray-50 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={picked.has(row.id)} onChange={() => setPicked((value) => { const out = new Set(value); if (out.has(row.id)) out.delete(row.id); else out.add(row.id); return out; })} />
                      <b className="text-gray-900 dark:text-slate-100">{row.id}</b><span className="truncate text-gray-500">{row.state} · {row.agentName}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <section className={`rounded-[14px] px-3 py-3 ${lavender}`}>
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-white text-[#5B3FD9] shadow-sm dark:bg-slate-900 dark:text-violet-300"><CalendarDays className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <span className="block text-[12.5px] leading-[18px] text-gray-700 dark:text-slate-300">Follow-Up Session (Today)</span>
                  <b className="block text-[15px] leading-[21px] text-gray-900 dark:text-slate-50">{sessionValue}</b>
                </div>
                {current && <span className="shrink-0 rounded-[8px] bg-[#E6DCFE] px-2.5 py-1 text-[13px] font-bold text-[#5B3FD9] dark:bg-violet-500/20 dark:text-violet-200">Due Now</span>}
              </div>
              {sessionHint && <p className={`m-0 mt-2 text-[12px] leading-[17px] ${workingToday ? "font-semibold text-amber-800 dark:text-amber-200" : "text-gray-600 dark:text-slate-400"}`}>{sessionHint}</p>}
            </section>

            {single && (
              <section className="rounded-[14px] border border-[#E7E8F4] px-3.5 pb-3 pt-3 dark:border-slate-800">
                <b className="text-[15px] text-gray-900 dark:text-slate-50">Today's Follow-Up Progress</b>
                <ol className="m-0 mt-2 list-none p-0 pl-3">
                  {progress.map((session, index) => (
                    <li key={session.key} className="relative flex items-center gap-2">
                      {index < progress.length - 1 && <span aria-hidden="true" className={`absolute left-[9px] top-1/2 h-full w-0.5 ${session.state === "done" ? "bg-[#9A8BEF]" : "bg-gray-200 dark:bg-slate-700"}`} />}
                      <Dot state={session.state} />
                      <span className={`min-w-0 flex-1 rounded-[8px] px-2.5 py-[5px] text-[13.5px] leading-5 ${session.state === "now" ? "bg-[#F0EEFE] font-semibold text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-200" : session.state === "missed" ? "text-rose-600" : "text-gray-700 dark:text-slate-300"}`}>
                        <span className={session.state === "now" || session.state === "missed" ? "font-semibold" : "font-semibold text-gray-900 dark:text-slate-100"}>{session.time}</span> – {progressText(session.state, session.at)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          {/* Right: what happened */}
          <div className={`${panel} px-4 pb-4 pt-3.5`}>
            <Step n={1} title="Communication Channel" hint="Select at least one" />
            <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-[1.15fr_1fr_1.15fr]">
              {channelCard("whatsapp", "WhatsApp Group Reminder",
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/10"><WhatsAppIcon className="h-[22px] w-[22px] text-[#1FAF52]" /></span>)}
              {channelCard("call", "Phone Call",
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-50 dark:bg-orange-500/10"><Phone className="h-[19px] w-[19px] text-orange-500" /></span>)}
              {channelCard("both", <>Both<span className="block whitespace-nowrap text-[12.5px]">(WhatsApp + Call)</span></>,
                <span className="flex shrink-0 items-center gap-1"><WhatsAppIcon className="h-[22px] w-[22px] text-[#1FAF52]" /><Phone className="h-[19px] w-[19px] text-[#2F5BEA]" /></span>)}
            </div>

            <div className="my-3.5 h-px bg-gray-100 dark:bg-slate-800" />
            <Step n={2} title="Agent Response" hint="Select the most accurate outcome" />
            <div className="mt-2.5 grid grid-cols-1 gap-x-3 gap-y-[7px] md:grid-cols-2" role="radiogroup" aria-label="Agent response">
              {options.responses.map((option) => {
                const look = RESPONSE_LOOK[option.key] ?? RESPONSE_LOOK.other;
                const on = response === option.key;
                return (
                  <button key={option.key} type="button" role="radio" aria-checked={on} onClick={() => setResponse(option.key)}
                    className={`!min-h-0 flex items-center gap-2.5 rounded-[12px] border px-2 py-1.5 text-left text-[12.5px] font-medium leading-[18px] shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${on ? "border-[#5B3FD9] bg-[#F4F1FE] text-gray-900 ring-1 ring-[#5B3FD9]/40 dark:bg-violet-500/10 dark:text-slate-50" : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
                    <span className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full ${look.tint}`}><look.Icon className={`h-[17px] w-[17px] ${look.tone}`} /></span>
                    <span className="min-w-0 flex-1">{option.key === "other" ? "Other (specify)" : option.label}</span>
                    <Radio on={on} />
                  </button>
                );
              })}
            </div>

            <div className="my-3.5 h-px bg-gray-100 dark:bg-slate-800" />
            <Step n={3} title="Follow-Up Notes" required />
            <div className="mt-2.5 rounded-[12px] border border-gray-200 bg-white focus-within:border-[#5B3FD9] focus-within:ring-1 focus-within:ring-[#5B3FD9]/40 dark:border-slate-700 dark:bg-slate-900">
              <textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, NOTE_MAX))} rows={2} aria-label="Follow-up notes"
                placeholder={response === "other" ? "Write what the agent said" : "What the agent said, and what happens next"}
                className="!min-h-0 block w-full resize-none rounded-[12px] border-0 bg-transparent px-3.5 pb-0 pt-2.5 text-[14px] leading-[21px] text-gray-900 outline-none dark:text-slate-100" />
              <span className="block px-3.5 pb-2 text-right text-[12px] text-gray-500">{note.length} / {NOTE_MAX}</span>
            </div>

            <div className="my-3.5 h-px bg-gray-100 dark:bg-slate-800" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-0">
              <div className="md:pr-5">
                <Heading Icon={Flag} title="Next Action" />
                <span className="relative mt-2.5 block">
                  <select value={nextAction} onChange={(event) => setNextAction(event.target.value)} aria-label="Next action"
                    className="!min-h-0 h-10 w-full appearance-none rounded-[10px] border border-gray-200 bg-white py-0 pl-3.5 pr-9 text-[14px] !font-normal text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                    <option value="">Choose the next action</option>
                    {options.nextActions.map((action) => <option key={action} value={action}>{action}</option>)}
                    <option value="Other">Other…</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
                </span>
                {nextAction === "Other" && <input value={otherAction} onChange={(event) => setOtherAction(event.target.value)} maxLength={300} placeholder="What happens next"
                  className="mt-2 w-full rounded-[10px] border border-gray-200 bg-white px-3.5 py-2 text-[14px] dark:border-slate-700 dark:bg-slate-900" />}
              </div>
              <div className="md:border-l md:border-gray-100 md:pl-5 dark:md:border-slate-800">
                <Heading Icon={Paperclip} title="Evidence / Attachment" hint="Optional" />
                <label className="mt-2.5 flex cursor-pointer flex-col items-center justify-center rounded-[12px] border-[1.5px] border-dashed border-[#BDB2F4] bg-[#F7F6FF] px-3 py-2.5 text-center hover:bg-[#F1EDFE] dark:border-violet-500/40 dark:bg-slate-900">
                  <CloudUpload className="h-[22px] w-[22px] text-[#5B3FD9] dark:text-violet-300" />
                  <b className="mt-1 max-w-full truncate text-[13.5px] text-[#5B3FD9] dark:text-violet-200">{file ? file.name : "Upload Screenshot / Call Log"}</b>
                  <span className="text-[12px] text-gray-500">PNG, JPG, PDF (Max 5MB)</span>
                  <input type="file" accept="image/png,image/jpeg,application/pdf" className="hidden" onChange={async (event) => {
                    const chosenFile = event.target.files?.[0];
                    event.target.value = "";
                    if (!chosenFile) return;
                    if (chosenFile.size > FILE_MAX) { setError("That file is over 5MB."); return; }
                    try { setFile({ name: chosenFile.name, dataUrl: await readAsDataUrl(chosenFile) }); setError(""); } catch (err) { setError((err as Error).message); }
                  }} />
                </label>
                {file && <button type="button" onClick={() => setFile(null)} className="!min-h-0 mt-1 text-[12px] font-semibold text-rose-600">Remove file</button>}
              </div>
            </div>

            {error && <p className="m-0 mt-3.5 rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">{error}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-[#ECEBF7] bg-[#F6F6FD] px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900 sm:px-7">
          <span className="flex min-w-[240px] flex-1 items-start gap-2.5 text-[12.5px] leading-[18px] text-gray-700 dark:text-slate-400">
            <Info className="mt-px h-[22px] w-[22px] shrink-0 text-[#2F5BEA]" />
            <span className="max-w-[500px]">This log will be time-stamped, linked to the waybill and your account, and used for follow-up compliance and accountability.</span>
          </span>
          <div className="flex w-full gap-3 sm:w-auto">
            <button type="button" onClick={onClose} className="!min-h-0 inline-flex h-10 flex-1 items-center justify-center rounded-[10px] border border-gray-300 bg-white px-5 text-[14px] font-semibold text-gray-900 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-[110px] sm:flex-none">Cancel</button>
            <button type="button" disabled={saving} onClick={save} className="!min-h-0 inline-flex h-10 flex-[2] items-center justify-center gap-2 rounded-[10px] bg-gradient-to-r from-[#6A45EC] to-[#5B3FD9] px-5 text-[14px] font-semibold text-white shadow-sm hover:from-[#5B3FD9] hover:to-[#4C32C4] disabled:opacity-50 sm:w-[212px] sm:flex-none">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}Save Follow-Up Log
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
