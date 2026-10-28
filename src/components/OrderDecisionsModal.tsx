import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, Clock, Truck, Undo2, User } from "lucide-react";
import { Modal, nf, type LateSendWeek } from "./WeeklyReportParts";
import type { MissingFeeDetail, OrderDecisionView } from "../pages/weekly-report-model";

// ── Charge or skip each flagged order (Bright, 28 Oct 2026) ─────────────────
// One window per rep with the week's "Sent out late" and "No delivery fee"
// orders. Each order shows the facts needed to judge it (for a late order:
// when it came in, when the clock started, when it left New, who moved it and
// how long it took in working time). Leadership types an amount and charges it,
// or skips it with a reason. The rep's report cannot be approved until every
// order has a decision (the server refuses too). Without onDecide the window
// is read-only (the owner's page).

export type DecisionKind = "missing_fee" | "late_send";

type LateOrder = LateSendWeek["orders"][number];
type FeeOrder = MissingFeeDetail["orders"][number];

const SKIP_REASONS: Record<DecisionKind, string[]> = {
  late_send: ["Moved out of New by someone else", "System or network problem", "Customer asked to be called later", "First time - warned instead"],
  missing_fee: ["Agent has not sent the fee yet", "Free delivery for this order", "Fee was paid by the company", "First time - warned instead"]
};

const lagos = (iso: string | null | undefined, withDay = true) => iso
  ? new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", ...(withDay ? { weekday: "short", day: "numeric", month: "short" } : {}), hour: "numeric", minute: "2-digit" })
  : "-";
const dayOnly = (dateKey: string) => new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" });
const span = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ""}`.trim() : `${minutes} min`;

/** How bad a late order is, from working minutes past the 15. */
function lateLevel(order: LateOrder) {
  const late = order.workingMinutesLate ?? order.minutesLate;
  if (!order.sentAt) return { label: "Still New", cls: "bg-rose-600 text-white" };
  if (late > 60) return { label: "Very late", cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200" };
  if (late > 15) return { label: "Late", cls: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-200" };
  return { label: "A little late", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" };
}

const pending = (orders: Array<{ decision?: OrderDecisionView | null }>) => orders.filter((order) => !order.decision).length;

/** Undecided orders on a rep's week (both kinds). Used to hold back Approve. */
export function undecidedCount(lateSend: LateSendWeek | null | undefined, missingFee: MissingFeeDetail | null | undefined) {
  return pending(lateSend?.orders ?? []) + pending(missingFee?.orders ?? []);
}

export function OrderDecisionsModal({ repName, weekLabel, sym, lateSend, missingFee, startOn, onClose, onDecide, onUndo, onRemoveOldFine }: {
  repName: string;
  weekLabel: string;
  sym: string;
  lateSend: LateSendWeek | null | undefined;
  missingFee: MissingFeeDetail | null | undefined;
  startOn?: DecisionKind;
  onClose: () => void;
  onDecide?: (kind: DecisionKind, orderId: string, decision: "charged" | "skipped", amount: number | undefined, reason: string) => Promise<void>;
  onUndo?: (decisionId: string) => Promise<void>;
  onRemoveOldFine?: (id: string) => Promise<void>;
}) {
  const late = lateSend?.orders ?? [];
  const fees = missingFee?.orders ?? [];
  const [tab, setTab] = useState<DecisionKind>(startOn ?? (late.length > 0 ? "late_send" : "missing_fee"));
  const all = [...late, ...fees];
  const left = pending(all);
  const charged = all.filter((order) => order.decision?.decision === "charged");
  const skipped = all.filter((order) => order.decision?.decision === "skipped").length;
  // A lump fine added before per-order decisions, for orders no longer listed.
  const oldFines = lateSend?.fines ?? [];

  const tabs: Array<{ key: DecisionKind; label: string; count: number; open: number }> = [
    { key: "late_send", label: "Sent out late", count: late.length, open: pending(late) },
    { key: "missing_fee", label: "No delivery fee", count: fees.length, open: pending(fees) }
  ];

  return (
    <Modal wide title={`${repName}: orders to decide`} subtitle={`${weekLabel} · Charge or skip each order before the report can be approved.`} onClose={onClose}>
      <div className="space-y-4 px-6 py-5">
        {/* Where things stand */}
        <div className="grid grid-cols-3 gap-2">
          <Tile tone={left > 0 ? "rose" : "emerald"} label="To decide" value={left > 0 ? String(left) : "None"} hint={left > 0 ? "Approve is held" : "Ready to approve"} />
          <Tile tone="gray" label="Charged" value={`${sym}${nf(charged.reduce((sum, order) => sum + (order.decision?.amount ?? 0), 0))}`} hint={`${charged.length} order${charged.length === 1 ? "" : "s"}`} />
          <Tile tone="gray" label="Skipped" value={String(skipped)} hint="Rep does not see these" />
        </div>

        <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-slate-800" role="tablist">
          {tabs.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)}
              className={`!min-h-0 flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-bold ${tab === item.key ? "bg-white text-gray-900 shadow-sm dark:bg-slate-900 dark:text-slate-50" : "text-gray-500 hover:text-gray-800 dark:text-slate-400"}`}>
              {item.key === "late_send" ? <Clock className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
              {item.label} ({item.count})
              {item.open > 0 && <span className="rounded-full bg-rose-600 px-1.5 text-[10.5px] font-black text-white">{item.open}</span>}
            </button>
          ))}
        </div>

        {tab === "late_send" && (
          <>
            {late.length > 0 && <LateSummary orders={late} />}
            {late.length === 0 && <Empty text="No orders were sent out late this week." />}
            {late.map((order) => (
              <OrderCard key={order.orderId} kind="late_send" orderId={order.orderId} sym={sym} decision={order.decision ?? null}
                onDecide={onDecide} onUndo={onUndo} title={<LateTitle order={order} sym={sym} />}>
                <LateFacts order={order} />
              </OrderCard>
            ))}
            {oldFines.length > 0 && (
              <div className="rounded-xl bg-gray-50 px-4 py-3 text-[12px] dark:bg-slate-800/60">
                <strong className="block text-gray-800 dark:text-slate-100">Fines added before order-by-order decisions</strong>
                {oldFines.map((fine) => (
                  <span key={fine.id} className="mt-1 flex items-center justify-between gap-2 text-gray-700 dark:text-slate-300">
                    <span>{sym}{nf(fine.amount)} by {fine.byName || "-"} · {fine.reason}</span>
                    {onRemoveOldFine && <button type="button" onClick={() => void onRemoveOldFine(fine.id)} className="!min-h-0 rounded px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-50">Remove</button>}
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "missing_fee" && (
          <>
            {fees.length === 0 && <Empty text="Every delivered order this week has a delivery fee." />}
            {fees.map((order) => (
              <OrderCard key={order.orderId} kind="missing_fee" orderId={order.orderId} sym={sym} decision={order.decision ?? null}
                onDecide={onDecide} onUndo={onUndo} title={<FeeTitle order={order} sym={sym} />}>
                <FeeFacts order={order} sym={sym} />
              </OrderCard>
            ))}
          </>
        )}

        <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-[12.5px] ${left > 0 ? "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200"}`}>
          <span className="flex items-center gap-2 font-semibold">
            {left > 0 ? <AlertTriangle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {left > 0 ? `${left} order${left === 1 ? "" : "s"} still need${left === 1 ? "s" : ""} a decision. The report cannot be approved until then.` : "Every order has a decision."}
          </span>
          <button type="button" onClick={onClose} className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">Close</button>
        </div>
      </div>
    </Modal>
  );
}

function Tile({ tone, label, value, hint }: { tone: "rose" | "emerald" | "gray"; label: string; value: string; hint: string }) {
  const cls = tone === "rose" ? "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-500/20"
    : tone === "emerald" ? "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/20"
      : "bg-gray-50 text-gray-800 ring-gray-100 dark:bg-slate-800/60 dark:text-slate-100 dark:ring-slate-700";
  return (
    <div className={`rounded-xl px-3 py-2.5 ring-1 ${cls}`}>
      <span className="block text-[10.5px] font-bold uppercase tracking-wide opacity-80">{label}</span>
      <strong className="block text-[19px] font-black leading-tight">{value}</strong>
      <span className="block text-[11px] opacity-80">{hint}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="m-0 rounded-xl bg-gray-50 px-4 py-6 text-center text-[13px] text-gray-500 dark:bg-slate-800/60 dark:text-slate-400">{text}</p>;
}

/** One line on the week: how many, the worst one, still sitting in New. */
function LateSummary({ orders }: { orders: LateOrder[] }) {
  const lates = orders.map((order) => order.workingMinutesLate ?? order.minutesLate);
  const worst = Math.max(...lates);
  const still = orders.filter((order) => !order.sentAt).length;
  const average = Math.round(lates.reduce((sum, value) => sum + value, 0) / lates.length);
  return (
    <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-300">
      <strong className="text-gray-900 dark:text-slate-100">{orders.length} late</strong> · worst {span(worst)} past the 15 minutes · average {span(average)}
      {still > 0 && <span className="font-semibold text-rose-600"> · {still} still New</span>}
      <span className="block text-[11.5px] text-gray-500">Times count working hours only: 10am-5:30pm (11am on Monday), no Sunday.</span>
    </p>
  );
}

function LateTitle({ order, sym }: { order: LateOrder; sym: string }) {
  const level = lateLevel(order);
  return (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <strong className="text-[14px] text-gray-900 dark:text-slate-50">#{order.orderId}</strong>
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-black uppercase tracking-wide ${level.cls}`}>{level.label}</span>
      </span>
      <span className="mt-0.5 block text-[12px] text-gray-600 dark:text-slate-300">
        {[order.customer, order.product ? `${order.product}${order.quantity ? ` × ${order.quantity}` : ""}` : null, order.state].filter(Boolean).join(" · ")}
        {order.amount ? <> · <strong>{sym}{nf(order.amount)}</strong></> : null}
      </span>
    </>
  );
}

/** Came in → clock started → sent out, plus how long it took against the 15 minutes. */
function LateFacts({ order }: { order: LateOrder }) {
  const taken = order.workingMinutesTaken ?? (15 + order.minutesLate);
  const lateBy = order.workingMinutesLate ?? order.minutesLate;
  const okPart = Math.max(4, Math.min(100, (15 / Math.max(taken, 15)) * 100));
  const steps: Array<{ label: string; value: string; note?: string; tone?: "bad" }> = [
    { label: "Customer placed it", value: lagos(order.placedAt ?? order.arrivedAt), note: !order.assignedAt && Date.parse(order.clockStart) === Date.parse(order.arrivedAt) ? "15-min clock started here" : undefined },
    ...(order.assignedAt ? [{ label: "Given to the rep", value: lagos(order.assignedAt) }] : []),
    // Only when it differs from when the order reached the rep (night / Sunday orders).
    ...(Date.parse(order.clockStart) !== Date.parse(order.arrivedAt) ? [{ label: "15-min clock started", value: lagos(order.clockStart), note: "came in after hours" }] : []),
    order.sentAt
      ? { label: "Sent out", value: lagos(order.sentAt), note: `as ${order.sentStatus ?? "-"}${order.sentByName ? ` by ${order.sentByName}` : ""}`, tone: "bad" as const }
      : { label: "Sent out", value: "Not yet", note: "still New", tone: "bad" as const }
  ];
  return (
    <div className="space-y-3">
      <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-[repeat(auto-fit,minmax(0,1fr))]">
        {steps.map((step, index) => (
          <li key={step.label} className="relative rounded-lg bg-gray-50 px-3 py-2 dark:bg-slate-800/60">
            <span className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-gray-500">
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black text-white ${step.tone === "bad" ? "bg-rose-500" : "bg-gray-400"}`}>{index + 1}</span>
              {step.label}
            </span>
            <strong className={`mt-0.5 block text-[12.5px] ${step.tone === "bad" ? "text-rose-700 dark:text-rose-300" : "text-gray-900 dark:text-slate-100"}`}>{step.value}</strong>
            {step.note && <span className="block text-[11px] text-gray-500">{step.note}</span>}
          </li>
        ))}
      </ol>
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]">
          <span className="text-gray-700 dark:text-slate-200">
            {order.sentAt ? "Took" : "Waiting"} <strong className="text-[15px] text-gray-900 dark:text-slate-50">{span(taken)}</strong> of working time · limit 15 min
          </span>
          <strong className="text-rose-600">{span(lateBy)} past the limit</strong>
        </div>
        <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-rose-100 dark:bg-rose-500/20" aria-hidden>
          <span className="h-full bg-emerald-500" style={{ width: `${okPart}%` }} />
          <span className="h-full flex-1 bg-rose-500" />
        </div>
      </div>
      {order.sentByRep === false && order.sentByName && (
        <p className="m-0 flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-[12px] text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
          <User className="h-3.5 w-3.5" /> {order.sentByName} moved this order out of New, not the rep.
        </p>
      )}
    </div>
  );
}

function FeeTitle({ order, sym }: { order: FeeOrder; sym: string }) {
  return (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <strong className="text-[14px] text-gray-900 dark:text-slate-50">#{order.orderId}</strong>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-black uppercase tracking-wide text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">No fee</span>
      </span>
      <span className="mt-0.5 block text-[12px] text-gray-600 dark:text-slate-300">
        {[order.customer, order.phone, order.product ? `${order.product}${order.quantity ? ` × ${order.quantity}` : ""}` : null].filter(Boolean).join(" · ")}
        {order.amount ? <> · <strong>{sym}{nf(order.amount)}</strong></> : null}
      </span>
    </>
  );
}

function FeeFacts({ order, sym }: { order: FeeOrder; sym: string }) {
  const facts: Array<{ label: string; value: string; note?: string }> = [
    { label: "Delivered", value: dayOnly(order.deliveredDate), note: order.deliveredBy ? `marked by ${order.deliveredBy}${order.deliveredAt ? `, ${lagos(order.deliveredAt, false)}` : ""}` : undefined },
    { label: "Where", value: [order.city, order.state].filter(Boolean).join(", ") || "-" },
    { label: "Delivery agent", value: order.agentName || "Not recorded" },
    {
      label: "Agent's usual fee here",
      value: order.usualFee ? `${sym}${nf(order.usualFee)}` : "Not known",
      note: order.usualFee ? `from their last ${order.usualFeeFrom} order${order.usualFeeFrom === 1 ? "" : "s"} in ${order.state || "this state"}` : "no fee recorded for this agent here"
    }
  ];
  return (
    <div className="space-y-2">
      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-slate-800/60">
            <dt className="text-[10.5px] font-bold uppercase tracking-wide text-gray-500">{fact.label}</dt>
            <dd className="m-0 mt-0.5 text-[12.5px] font-bold text-gray-900 dark:text-slate-100">{fact.value}</dd>
            {fact.note && <dd className="m-0 text-[11px] text-gray-500">{fact.note}</dd>}
          </div>
        ))}
      </dl>
      <p className="m-0 text-[11.5px] text-gray-500">With no fee, the order's profit shows higher than it really is until someone enters it.</p>
    </div>
  );
}

/** One order: its facts, then either its decision or the charge / skip controls. */
function OrderCard({ kind, orderId, sym, decision, title, children, onDecide, onUndo }: {
  kind: DecisionKind; orderId: string; sym: string; decision: OrderDecisionView | null;
  title: ReactNode; children: ReactNode;
  onDecide?: (kind: DecisionKind, orderId: string, decision: "charged" | "skipped", amount: number | undefined, reason: string) => Promise<void>;
  onUndo?: (decisionId: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"charge" | "skip">("charge");
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cleaned = amountText.replace(/[₦,\s]/g, "");
  const amount = /^\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
  const amountOk = Number.isFinite(amount) && amount > 0;
  const reasonOk = reason.trim().length >= 3;
  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    setError("");
    try { await action(); } catch (err: any) { setError(err?.message ?? "Could not save."); } finally { setSaving(false); }
  };
  const field = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  const border = decision ? (decision.decision === "charged" ? "border-rose-200 dark:border-rose-500/30" : "border-gray-200 dark:border-slate-700") : "border-amber-300 dark:border-amber-500/40";

  return (
    <article className={`rounded-2xl border bg-white p-4 dark:bg-slate-900 ${border}`}>
      <header className="mb-3">{title}</header>
      {children}

      <div className="mt-4 border-t border-gray-100 pt-3 dark:border-slate-800">
        {decision ? (
          <div className={`flex flex-wrap items-start justify-between gap-2 rounded-xl px-3 py-2.5 text-[12.5px] ${decision.decision === "charged" ? "bg-rose-50 text-rose-900 dark:bg-rose-500/10 dark:text-rose-100" : "bg-gray-50 text-gray-800 dark:bg-slate-800/60 dark:text-slate-200"}`}>
            <span>
              <strong>{decision.decision === "charged" ? `Charged ${sym}${nf(decision.amount)}` : "Skipped"}</strong>
              <span className="text-[11.5px] opacity-80"> · by {decision.byName || "-"}{decision.byRole ? ` (${decision.byRole})` : ""} · {lagos(decision.at)}</span>
              {decision.reason && <span className="block text-[12px]">{decision.decision === "charged" ? "Note" : "Reason"}: {decision.reason}</span>}
              {decision.decision === "charged" && !decision.earlier && <span className="block text-[11px] opacity-70">The rep sees this in their fines.</span>}
            </span>
            {onUndo && decision.id && !decision.earlier && (
              <button type="button" disabled={saving} onClick={() => run(() => onUndo(decision.id!))}
                className="!min-h-0 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-bold text-gray-600 hover:bg-white disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-900">
                <Undo2 className="h-3.5 w-3.5" /> {saving ? "Undoing…" : "Undo"}
              </button>
            )}
          </div>
        ) : !onDecide ? (
          <p className="m-0 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">Not decided yet.</p>
        ) : (
          <div className="space-y-2.5">
            <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5 text-[12px] font-bold dark:bg-slate-800" role="radiogroup" aria-label={`Decision for order ${orderId}`}>
              {(["charge", "skip"] as const).map((item) => (
                <button key={item} type="button" role="radio" aria-checked={mode === item} onClick={() => { setMode(item); setError(""); }}
                  className={`!min-h-0 flex-1 rounded-md px-3 py-1.5 ${mode === item ? (item === "charge" ? "bg-rose-600 text-white" : "bg-white text-gray-900 shadow-sm dark:bg-slate-900 dark:text-slate-50") : "text-gray-500"}`}>
                  {item === "charge" ? "Charge the rep" : "Skip, no charge"}
                </button>
              ))}
            </div>
            {mode === "charge" ? (
              <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                <label className="block">
                  <span className="sr-only">Amount ({sym})</span>
                  <span className="relative block">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-gray-400">{sym}</span>
                    <input className={`${field} pl-7`} inputMode="numeric" value={amountText} onChange={(event) => setAmountText(event.target.value)} placeholder="Amount" aria-label={`Amount to charge for order ${orderId}`} />
                  </span>
                </label>
                <input className={field} maxLength={400} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Note for the rep (optional)" aria-label="Note for the rep" />
                <button type="button" disabled={!amountOk || saving} onClick={() => run(() => onDecide(kind, orderId, "charged", amount, reason.trim()))}
                  className="!min-h-0 rounded-xl bg-rose-600 px-4 py-2.5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Saving…" : "Charge"}</button>
                {amountText.trim() && !amountOk && <span className="text-[11px] font-semibold text-rose-600 sm:col-span-3">Enter a whole amount above 0.</span>}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {SKIP_REASONS[kind].map((text) => (
                    <button key={text} type="button" onClick={() => setReason(text)}
                      className={`!min-h-0 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${reason === text ? "border-[#1F8FE0] bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200" : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300"}`}>{text}</button>
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input className={field} maxLength={600} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this order skipped? (required)" aria-label="Reason for skipping" />
                  <button type="button" disabled={!reasonOk || saving} onClick={() => run(() => onDecide(kind, orderId, "skipped", undefined, reason.trim()))}
                    className="!min-h-0 rounded-xl bg-gray-900 px-4 py-2.5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900">{saving ? "Saving…" : "Skip"}</button>
                </div>
                <span className="block text-[11px] text-gray-500">Only leadership sees skips and their reasons.</span>
              </div>
            )}
          </div>
        )}
        {error && <p className="m-0 mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p>}
      </div>
    </article>
  );
}
