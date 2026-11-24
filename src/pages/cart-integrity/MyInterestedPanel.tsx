import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, MessageCircle, Phone, PhoneCall, ShoppingBag, Sparkles, Timer } from "lucide-react";
import { cartsApi, type InterestedFollowRow, type InterestedClosedRow } from "../../lib/api";

// ── "My Interested customers" (Bright, 24 Nov 2026) ─────────────────────────
// Every customer a rep logged Interested who has not become an order, with a
// live countdown to when the ₦50-a-day follow-up charge starts. Past ones
// (fixed list, migration 367) are free until the end of this week; new ones
// for their day and the next working day. Supervisors see every rep, plus the
// past ones closed since - flagged when closed in a batch.

const FINE = 50;
const money = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" });
const ago = (iso: string) => { const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };
const left = (ms: number) => {
  if (ms <= 0) return "0m";
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "").replace(/^0/, "234")}`;

export function MyInterestedPanel({ isRep, onLog, onConvert, refreshKey = 0 }: {
  isRep: boolean;
  onLog: (row: InterestedFollowRow) => void;
  onConvert: (row: InterestedFollowRow) => void;
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<InterestedFollowRow[] | null>(null);
  const [closed, setClosed] = useState<InterestedClosedRow[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [rep, setRep] = useState("all");
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    cartsApi.myInterested().then((r) => { if (!cancelled) { setRows(r.rows); setClosed(r.closed ?? []); setError(""); } })
      .catch((e: any) => { if (!cancelled) setError(e?.message ?? "Could not load your Interested customers."); });
    return () => { cancelled = true; };
  }, [refreshKey]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const reps = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.repName, (m.get(r.repName) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const shown = (rows ?? []).filter((r) => rep === "all" || r.repName === rep);
  const shownClosed = closed.filter((r) => rep === "all" || r.repName === rep);
  if (rows === null && !error) return (
    <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading your Interested customers…</div>
  );
  if (error) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-800">{error}</div>;
  if (!rows || (rows.length === 0 && closed.length === 0)) return null;

  const toLog = shown.filter((r) => !r.loggedToday && r.state !== "rescheduled");
  const charging = shown.filter((r) => r.state === "charging" && !r.loggedToday);
  const value = shown.reduce((s, r) => s + r.amount, 0);
  const nextStart = shown.filter((r) => r.state === "grace").map((r) => Date.parse(r.fineStartsAt)).sort((a, b) => a - b)[0];

  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm dark:border-emerald-500/30 dark:bg-slate-900">
      {/* Header */}
      <div className="relative bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 px-4 py-4 text-white">
        <Sparkles className="absolute right-4 top-3 h-16 w-16 opacity-15" />
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/20 shadow-inner"><ShoppingBag className="h-6 w-6" /></span>
          <div className="min-w-0">
            <h2 className="m-0 text-[19px] font-black tracking-tight !text-white">{isRep ? "My Interested customers" : "Interested customers"}</h2>
            <p className="m-0 text-[12.5px] !text-white/90">They said yes but have not ordered. Follow each one like an order until it is delivered or they say no.</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            ["To call today", toLog.length, ""],
            ["Customers", shown.length, money(value)],
            ["Charging now", charging.length, charging.length ? `${money(charging.length * FINE)} if not logged today` : "₦50 each, a day"],
            ["Free time left", nextStart ? left(nextStart - now) : "—", nextStart ? `₦50 a day from ${dayLabel(new Date(nextStart).toISOString())}` : "No free time left"]
          ] as Array<[string, string | number, string]>).map(([label, big, small]) => (
            <div key={label} className="rounded-xl bg-white/15 px-3 py-2 backdrop-blur-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</div>
              <div className="text-[22px] font-black leading-tight tabular-nums">{big}</div>
              {small && <div className="truncate text-[11px] opacity-85">{small}</div>}
            </div>
          ))}
        </div>
      </div>

      {!isRep && reps.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-gray-100 px-4 py-2.5 dark:border-slate-800">
          <Chip on={rep === "all"} onClick={() => setRep("all")}>All reps · {rows.length}</Chip>
          {reps.map(([name, n]) => <Chip key={name} on={rep === name} onClick={() => setRep(name)}>{name} · {n}</Chip>)}
        </div>
      )}

      {/* Cards */}
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((r) => <Card key={r.cartId} row={r} now={now} isRep={isRep} onLog={onLog} onConvert={onConvert} />)}
        {shown.length === 0 && <p className="m-0 text-[13px] text-gray-500">Nobody here right now.</p>}
      </div>

      {!isRep && shownClosed.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-3 dark:border-slate-800">
          <button type="button" onClick={() => setShowClosed((v) => !v)} className="!min-h-0 inline-flex items-center gap-2 text-[13px] font-bold text-gray-800 dark:text-slate-100">
            <AlertTriangle className={`h-4 w-4 ${shownClosed.some((c) => c.batch >= 5) ? "text-rose-600" : "text-amber-500"}`} />
            Closed since they came back ({shownClosed.length}){shownClosed.some((c) => c.batch >= 5) && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] text-rose-700">closed in a rush</span>}
          </button>
          {showClosed && (
            <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
              {shownClosed.map((c) => (
                <li key={c.cartId} className={`rounded-lg border px-3 py-2 text-[12.5px] ${c.batch >= 5 ? "border-rose-200 bg-rose-50/60" : "border-gray-200"}`}>
                  <div className="flex flex-wrap items-center gap-x-2">
                    <b className="text-gray-900 dark:text-slate-100">{c.customer || "No name"}</b>
                    {c.phone && <a href={`tel:${c.phone}`} className="text-[#1F8FE0]">{c.phone}</a>}
                    <span className="text-gray-600">{c.repName} · {c.closedOutcome}{c.closedReason ? ` (${c.closedReason})` : ""} · {dayLabel(c.closedAt)} {new Date(c.closedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}</span>
                    {c.batch >= 5 && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700">{c.batch} closed within 30 min</span>}
                    {c.closedWithoutTap && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">no call tap</span>}
                  </div>
                  {c.closedNote && <div className="italic text-gray-600">“{c.closedNote}”</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`!min-h-0 rounded-full px-3 py-1 text-[12px] font-semibold ring-1 ${on ? "bg-emerald-600 text-white ring-emerald-600" : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"}`}>{children}</button>;
}

function Card({ row, now, isRep, onLog, onConvert }: { row: InterestedFollowRow; now: number; isRep: boolean; onLog: (r: InterestedFollowRow) => void; onConvert: (r: InterestedFollowRow) => void }) {
  const startMs = Date.parse(row.fineStartsAt);
  const freeLeft = startMs - now;
  const tone = row.state === "rescheduled" ? "sky" : row.loggedToday ? "emerald" : row.state === "charging" ? "rose" : "amber";
  const ring: Record<string, string> = { sky: "ring-sky-200", emerald: "ring-emerald-200", rose: "ring-rose-300", amber: "ring-amber-200" };
  const badge: Record<string, string> = { sky: "bg-sky-100 text-sky-800", emerald: "bg-emerald-100 text-emerald-800", rose: "bg-rose-600 text-white", amber: "bg-amber-100 text-amber-900" };
  // Free-time bar: full at the first Interested, empty when ₦50 a day starts.
  const total = Math.max(1, startMs - Date.parse(row.firstInterestedAt));
  const pct = Math.max(0, Math.min(100, (freeLeft / total) * 100));
  return (
    <div className={`flex flex-col rounded-2xl bg-white p-3.5 shadow-sm ring-1 ${ring[tone]} dark:bg-slate-900`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-black text-gray-900 dark:text-slate-50">{row.customer || "No name"}</div>
          <div className="truncate text-[12px] text-gray-500">{row.product || "Product"} · <b className="text-gray-800 dark:text-slate-200">{money(row.amount)}</b>{!isRep && ` · ${row.repName}`}</div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${badge[tone]}`}>
          {row.state === "rescheduled" ? <><CalendarClock className="h-3.5 w-3.5" />Call {row.callbackDay ? dayLabel(`${row.callbackDay}T12:00:00Z`) : ""}</>
            : row.loggedToday ? <><CheckCircle2 className="h-3.5 w-3.5" />Logged today</>
              : row.state === "charging" ? <>₦{FINE} today if not logged</>
                : <><Timer className="h-3.5 w-3.5" />{left(freeLeft)} free</>}
        </span>
      </div>

      {row.state === "grace" && (
        <div className="mt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-amber-100"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${pct}%` }} /></div>
          <div className="mt-1 text-[11px] text-gray-500">₦{FINE} a day from {dayLabel(row.fineStartsAt)} if not logged that day</div>
        </div>
      )}

      <div className="mt-2.5 space-y-1 text-[12px] text-gray-600 dark:text-slate-400">
        <div>Said Interested <b className="text-gray-800 dark:text-slate-200">{dayLabel(row.firstInterestedAt)}</b> ({ago(row.firstInterestedAt)}){row.kind === "past" && <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10.5px] font-bold text-violet-700">back on your list</span>}</div>
        {row.lastLogAt && <div className="truncate">Last: <b className="text-gray-800 dark:text-slate-200">{row.lastOutcome}</b> {ago(row.lastLogAt)}{row.lastNote ? ` · “${row.lastNote}”` : ""}</div>}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {row.phone ? (
          <a href={`tel:${row.phone}`} onClick={() => void cartsApi.tapContact(row.cartId, "call").catch(() => undefined)}
            className="!min-h-0 col-span-1 inline-flex items-center justify-center gap-1 rounded-xl bg-[#1F8FE0] py-2 text-[12px] font-bold text-white hover:bg-[#1a7dc4]"><Phone className="h-4 w-4" />Call</a>
        ) : <span className="col-span-1" />}
        {(row.whatsapp || row.phone) ? (
          <a href={waLink(row.whatsapp || row.phone || "")} target="_blank" rel="noreferrer" onClick={() => void cartsApi.tapContact(row.cartId, "whatsapp").catch(() => undefined)}
            className="!min-h-0 col-span-1 inline-flex items-center justify-center rounded-xl bg-emerald-600 py-2 text-white hover:bg-emerald-700" title="WhatsApp"><MessageCircle className="h-4 w-4" /></a>
        ) : <span className="col-span-1" />}
        <button type="button" onClick={() => onLog(row)} className="!min-h-0 col-span-1 inline-flex items-center justify-center gap-1 rounded-xl border border-gray-200 py-2 text-[12px] font-bold text-gray-800 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-100"><PhoneCall className="h-4 w-4" />Log</button>
        <button type="button" onClick={() => onConvert(row)} className="!min-h-0 col-span-1 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 py-2 text-[12px] font-black text-white shadow-sm hover:opacity-95">Order</button>
      </div>
    </div>
  );
}
