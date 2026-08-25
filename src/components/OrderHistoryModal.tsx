import { useMemo, useState } from "react";
import { Phone, MessageCircle, CalendarDays, StickyNote, Info, X } from "lucide-react";

export type HistoryAttempt = {
  id: string;
  repId?: string;
  attemptedAt: string;
  channel: string;
  outcomeCode: string;
  outcomeNote?: string;
  customerReached?: boolean;
};

export type HistoryNote = { text?: string; at?: string; author?: string };

type Props = {
  order: {
    id: string; customer: string; phone?: string; state?: string;
    productName?: string; packageName?: string; quantity?: number;
    amount?: number; createdAt?: string; source?: string; statusLabel: string;
  };
  attempts: HistoryAttempt[];
  notes: HistoryNote[];
  loading?: boolean;
  /** repId → { name, role }. Anything unknown is named rather than left blank. */
  lookupRep: (repId?: string) => { name: string; role: string };
  formatMoney: (value: number) => string;
  onClose: () => void;
};

const CHANNEL_STYLE: Record<string, { icon: typeof Phone; tone: string; ring: string }> = {
  call: { icon: Phone, tone: "text-emerald-600", ring: "bg-emerald-50" },
  whatsapp: { icon: MessageCircle, tone: "text-emerald-600", ring: "bg-emerald-50" },
  sms: { icon: MessageCircle, tone: "text-sky-600", ring: "bg-sky-50" },
  manual: { icon: StickyNote, tone: "text-amber-600", ring: "bg-amber-50" },
  placed: { icon: CalendarDays, tone: "text-rose-600", ring: "bg-rose-50" }
};

const OUTCOME_PILL = (label: string) => {
  const value = label.toLowerCase();
  if (value.includes("whatsapp")) return "bg-emerald-100 text-emerald-800";
  if (value.includes("note")) return "bg-amber-100 text-amber-800";
  if (value.includes("placed")) return "bg-rose-100 text-rose-800";
  return "bg-emerald-100 text-emerald-800";
};

const stamp = (iso: string) => new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export default function OrderHistoryModal({
  order, attempts, notes, loading, lookupRep, formatMoney, onClose
}: Props) {
  const [tab, setTab] = useState<"history" | "notes" | "info">("history");

  // ⚠️ The order being PLACED is part of its history and was previously
  // invisible here - a timeline that starts at the first chase implies the
  // order appeared from nowhere, and "placed via Facebook ad" is often the
  // most useful line on the whole screen for a recovery pitch.
  const timeline = useMemo(() => {
    const rows = attempts.map((attempt) => ({
      key: attempt.id,
      at: attempt.attemptedAt,
      channel: attempt.channel || "call",
      actor: lookupRep(attempt.repId),
      outcome: attempt.outcomeCode || (attempt.customerReached ? "Reached" : "Called"),
      note: attempt.outcomeNote ?? ""
    }));
    if (order.createdAt) {
      rows.push({
        key: `placed-${order.id}`,
        at: order.createdAt,
        channel: "placed",
        actor: { name: "Order placed", role: order.source ? `via ${order.source}` : "Order created" },
        outcome: "Placed Order",
        note: order.source ? `Order placed via ${order.source}` : "Order created"
      });
    }
    return rows.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
  }, [attempts, order, lookupRep]);

  const tabs = [
    { key: "history" as const, label: "Follow-up History", count: timeline.length },
    { key: "notes" as const, label: "Notes", count: notes.length },
    { key: "info" as const, label: "Order Info", count: null }
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label="Order history" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-6 py-5">
          <h3 className="m-0 text-xl font-black tracking-tight text-slate-900">Order History</h3>
          <button type="button" onClick={onClose}
            className="!min-h-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 border-y border-slate-200/80 bg-slate-50/60 px-6 py-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-base font-black text-rose-700">
              {(order.customer || "?").slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-slate-900">{order.customer}</span>
              <span className="block text-xs font-medium text-slate-500">{order.phone}</span>
              <span className="block text-xs font-medium text-slate-400">{order.state || "No state"}</span>
            </span>
          </div>
          <div>
            <p className="m-0 text-[11px] font-bold text-slate-400">Order ID</p>
            <p className="m-0 mt-1 text-sm font-black text-slate-900">{order.id}</p>
          </div>
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-bold text-slate-400">Product</p>
            <p className="m-0 mt-1 truncate text-sm font-black text-slate-900">{order.productName || "—"}</p>
            <p className="m-0 text-xs font-semibold text-slate-500">
              {[order.packageName, order.quantity ? `${order.quantity} pcs` : null].filter(Boolean).join(" ")}
              {order.amount ? ` • ${formatMoney(order.amount)}` : ""}
            </p>
          </div>
          <div>
            <span className="inline-flex rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-700">
              {order.statusLabel}
            </span>
            {order.createdAt && (
              <p className="m-0 mt-1.5 text-xs font-semibold text-slate-500">
                Placed {stamp(order.createdAt)}, {clock(order.createdAt)}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-1 border-b border-slate-200/80 px-6">
          {tabs.map((item) => (
            <button key={item.key} type="button" onClick={() => setTab(item.key)}
              className={`!min-h-0 inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-bold transition-colors ${
                tab === item.key
                  ? "border-[#1F8FE0] text-[#1F8FE0]"
                  : "border-transparent text-slate-500 hover:text-slate-900"}`}>
              {item.label}
              {item.count !== null && (
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-black tabular-nums ${
                  tab === item.key ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-500"}`}>{item.count}</span>
              )}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <p className="m-0 py-8 text-center text-sm font-semibold text-slate-400">Loading history…</p>
          ) : tab === "history" ? (
            timeline.length === 0 ? (
              <p className="m-0 py-8 text-center text-sm font-semibold text-slate-400">Nothing logged on this order yet.</p>
            ) : (
              <ul className="m-0 list-none space-y-0 p-0">
                {timeline.map((row, index) => {
                  const style = CHANNEL_STYLE[row.channel] ?? CHANNEL_STYLE.call;
                  const Icon = style.icon;
                  return (
                    <li key={row.key} className="relative flex gap-3 pb-5 last:pb-0">
                      {/* The rail stops at the last entry rather than trailing
                          into empty space below it. */}
                      {index < timeline.length - 1 && (
                        <span className="absolute left-4 top-9 h-full w-px bg-slate-200" aria-hidden />
                      )}
                      <span className={`relative z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${style.ring}`}>
                        <Icon className={`h-4 w-4 ${style.tone}`} />
                      </span>
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
                        <div className="min-w-0">
                          <p className="m-0 text-sm font-bold text-slate-900">{stamp(row.at)}</p>
                          <p className="m-0 text-xs font-medium text-slate-500">{clock(row.at)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="m-0 flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-900">
                            {row.actor.name}
                            {index === 0 && (
                              <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-800">Latest</span>
                            )}
                          </p>
                          <p className="m-0 text-xs font-medium text-slate-500">{row.actor.role}</p>
                        </div>
                        <div className="min-w-0">
                          <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-black ${OUTCOME_PILL(row.outcome)}`}>
                            {row.outcome}
                          </span>
                          {row.note && <p className="m-0 mt-1.5 text-xs font-medium leading-relaxed text-slate-600">{row.note}</p>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : tab === "notes" ? (
            notes.length === 0 ? (
              <p className="m-0 py-8 text-center text-sm font-semibold text-slate-400">No notes on this order.</p>
            ) : (
              <ul className="m-0 list-none space-y-3 p-0">
                {notes.map((note, index) => (
                  <li key={index} className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
                    <p className="m-0 text-sm font-medium leading-relaxed text-slate-700">{note.text}</p>
                    <p className="m-0 mt-1.5 text-[11px] font-bold text-slate-400">
                      {[note.author, note.at ? `${stamp(note.at)}, ${clock(note.at)}` : null].filter(Boolean).join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <dl className="m-0 grid gap-3 sm:grid-cols-2">
              {[
                ["Order ID", order.id],
                ["Customer", order.customer],
                ["Phone", order.phone || "—"],
                ["State", order.state || "—"],
                ["Product", order.productName || "—"],
                ["Package", order.packageName || "—"],
                ["Quantity", order.quantity ? `${order.quantity} pcs` : "—"],
                ["Value", order.amount ? formatMoney(order.amount) : "—"],
                ["Status", order.statusLabel],
                ["Source", order.source || "—"],
                ["Placed", order.createdAt ? `${stamp(order.createdAt)}, ${clock(order.createdAt)}` : "—"]
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2.5">
                  <dt className="m-0 text-[11px] font-bold text-slate-400">{label}</dt>
                  <dd className="m-0 mt-0.5 text-sm font-black text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 px-6 py-4">
          <p className="m-0 flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Info className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            All times are in WAT (Africa/Lagos).
          </p>
          <button type="button" onClick={onClose}
            className="!min-h-0 rounded-xl border border-slate-200/80 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
