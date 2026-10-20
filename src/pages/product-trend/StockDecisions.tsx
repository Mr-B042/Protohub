import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, History, Loader2, Send, Truck, XCircle } from "lucide-react";
import { stockAllocationsApi, type StockAllocationDecision, type StockAllocationLine, type StockAllocationWaybill } from "../../lib/api";
import { isDelivered, stateLabel, waybillUnitsByState, type TrendOrder } from "./product-trend-model";
import { Panel, Pill, SidePanel, nf } from "./parts";
import { td, th } from "./DetailPanels";
import type { TabCtx } from "./tab-context";

// Stock allocation decisions (Bright's brief, 21 Oct 2026): send → Owner
// approves → transfers by the normal waybill form → follow what happened.
// The server (routes/stock-allocations.ts) re-checks warehouse stock on send
// and on approval and keeps the append-only record.

type Sent = Map<string, { units: number; waybills: string[]; received: number }>;
const STATUS: Record<StockAllocationDecision["status"], { label: string; tone: "amber" | "blue" | "red" | "gray" | "green" }> = {
  proposed: { label: "Waiting for Owner", tone: "amber" }, approved: { label: "Approved", tone: "blue" }, rejected: { label: "Not approved", tone: "red" },
  cancelled: { label: "Cancelled", tone: "gray" }, completed: { label: "Done", tone: "green" }
};
const ACTION_LABEL: Record<string, string> = {
  proposed: "Sent for approval", proposed_and_approved: "Sent and approved by the Owner", approved: "Approved", rejected: "Not approved", cancelled: "Cancelled", completed: "Marked done"
};
const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const unitsOf = (lines: StockAllocationLine[]) => lines.reduce((s, l) => s + (Number(l.units) || 0), 0);

// ── The buttons under Allocation Summary ────────────────────────────────────

export function DecisionActions({ ctx, productName, decision, proposal, allocated, manualLines, sentByState, onTransfer, onChanged }: {
  ctx: TabCtx; productName: string; decision: StockAllocationDecision | null;
  proposal: Parameters<typeof stockAllocationsApi.propose>[0] | null; allocated: number; manualLines?: StockAllocationLine[];
  sentByState: Sent; onTransfer: (line: StockAllocationLine) => void; onChanged: () => void;
}) {
  const [mode, setMode] = useState<null | "send" | "reject" | "cancel">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isOwner = ctx.role === "Owner";
  const run = async (job: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await job(); setMode(null); setNote(""); onChanged(); }
    catch (err: any) { setError(err?.message ?? "That did not work. Try again."); }
    finally { setBusy(false); }
  };
  const btn = "!min-h-0 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold disabled:opacity-40";
  const noteBox = (placeholder: string, required: boolean, confirm: string, onConfirm: () => void) => (
    <div className="space-y-2 rounded-xl border border-gray-200 p-2.5 dark:border-slate-700">
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={placeholder} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[12.5px] dark:border-slate-700 dark:bg-slate-900" />
      <div className="flex gap-2">
        <button type="button" disabled={busy || (required && !note.trim())} onClick={onConfirm} className={`${btn} bg-[#1F8FE0] text-white`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{confirm}</button>
        <button type="button" onClick={() => { setMode(null); setNote(""); }} className={`${btn} border border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-200`}>Back</button>
      </div>
    </div>
  );
  const errorLine = error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">{error}</p>;

  // Nothing open: send (Manager / Admin) or approve straight away (Owner).
  if (!decision) {
    if (mode === "send") return <>{noteBox(isOwner ? "Why this plan (optional)" : "Why this plan, for the Owner (optional)", false, isOwner ? "Approve plan" : "Send for approval",
      () => proposal && run(() => stockAllocationsApi.propose({ ...proposal, reason: note.trim() || undefined, approveNow: isOwner })))}{errorLine}</>;
    return (
      <>
        <button type="button" disabled={!proposal || allocated <= 0} onClick={() => setMode("send")} className={`${btn} bg-[#1F8FE0] text-white shadow-sm hover:bg-[#1a7dc4]`}>
          {isOwner ? <><CheckCircle2 className="h-4 w-4" /> Approve &amp; Create Transfer</> : <><Send className="h-4 w-4" /> Send for Owner Approval</>}
        </button>
        <p className="m-0 text-center text-[11px] text-gray-500">{allocated <= 0 ? "Nothing to send: no warehouse units are recommended." : isOwner
          ? `Approves ${nf(allocated)} units of ${productName}. Transfers are then made one state at a time with the waybill form.`
          : `The Owner approves it first. Nothing moves until a waybill is confirmed.`}</p>
        {errorLine}
      </>
    );
  }

  const lines = decision.final_lines;
  const header = (
    <div className={`rounded-xl px-3 py-2 text-[12px] ${decision.status === "proposed" ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100" : "bg-blue-50 text-blue-900 dark:bg-blue-500/10 dark:text-blue-100"}`}>
      <div className="flex items-center gap-1.5 font-bold">{decision.status === "proposed" ? <Clock3 className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        {decision.status === "proposed" ? "Waiting for the Owner's approval" : `Approved by ${decision.decided_by_name ?? "the Owner"}`}</div>
      <div className="mt-0.5">{nf(unitsOf(lines))} units to {lines.length} state{lines.length === 1 ? "" : "s"} · sent by {decision.proposed_by_name ?? "—"} {when(decision.proposed_at)}</div>
      {decision.reason && <div className="mt-0.5 italic">“{decision.reason}”</div>}
    </div>
  );
  const canCancel = isOwner || ctx.role === "Admin" || decision.proposed_by === ctx.userId;

  if (decision.status === "proposed") {
    return (
      <>
        {header}
        {mode === "reject" ? noteBox("Why not (required)", true, "Not approved", () => run(() => stockAllocationsApi.reject(decision.id, note.trim())))
          : mode === "cancel" ? noteBox("Why cancel (optional)", false, "Cancel plan", () => run(() => stockAllocationsApi.cancel(decision.id, note.trim() || undefined)))
            : isOwner ? (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={busy} onClick={() => run(() => stockAllocationsApi.approve(decision.id, manualLines ? { lines: manualLines, note: "Units changed by the Owner" } : {}))} className={`${btn} bg-emerald-600 text-white`}>
                  <CheckCircle2 className="h-4 w-4" /> {manualLines ? "Approve changed plan" : "Approve"}</button>
                <button type="button" onClick={() => setMode("reject")} className={`${btn} border border-rose-200 text-rose-700`}><XCircle className="h-4 w-4" /> Reject</button>
              </div>
            ) : <p className="m-0 text-center text-[11px] text-gray-500">The Owner has been told.</p>}
        {!mode && canCancel && <button type="button" onClick={() => setMode("cancel")} className="!min-h-0 block w-full text-center text-[11.5px] font-semibold text-gray-500">Cancel this plan</button>}
        {isOwner && !mode && <p className="m-0 text-center text-[11px] text-gray-500">To change units before approving, use Adjust Allocation Manually.</p>}
        {errorLine}
      </>
    );
  }

  // Approved: one transfer per state, then mark done.
  return (
    <>
      {header}
      <ul className="m-0 list-none space-y-1.5 p-0">
        {lines.map((line) => {
          const sent = sentByState.get(line.state);
          const left = Math.max(0, line.units - (sent?.units ?? 0));
          return (
            <li key={line.state} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] dark:border-slate-700">
              <span><strong>{stateLabel(line.state)}</strong> · {nf(line.units)} units
                <span className="block text-[11px] text-gray-500">{sent ? `${nf(sent.units)} sent · ${nf(sent.received)} received` : "No waybill yet"}</span></span>
              {left > 0 && ctx.canCreateTransfer && ctx.onCreateTransfer
                ? <button type="button" onClick={() => onTransfer({ ...line, units: left })} className="!min-h-0 inline-flex items-center gap-1 rounded-md bg-[#1F8FE0] px-2.5 py-1 text-[11.5px] font-semibold text-white"><Truck className="h-3.5 w-3.5" /> Create transfer</button>
                : left === 0 ? <Pill tone="green">Sent</Pill> : <span className="text-[11px] text-gray-500">Waiting for transfer</span>}
            </li>
          );
        })}
      </ul>
      {!ctx.canCreateTransfer && <p className="m-0 text-center text-[11px] text-gray-500">Transfers are made by the Owner, Admins or the inventory team.</p>}
      {mode === "cancel" ? noteBox("Why cancel (optional)", false, "Cancel plan", () => run(() => stockAllocationsApi.cancel(decision.id, note.trim() || undefined)))
        : (
          <div className="flex gap-2">
            {(isOwner || ctx.role === "Admin") && <button type="button" disabled={busy} onClick={() => run(() => stockAllocationsApi.complete(decision.id, { transferredUnits: [...sentByState.values()].reduce((s, v) => s + v.units, 0) }))}
              className={`${btn} border border-emerald-300 text-emerald-700`}><CheckCircle2 className="h-4 w-4" /> Mark done</button>}
            {canCancel && <button type="button" onClick={() => setMode("cancel")} className={`${btn} border border-gray-200 text-gray-600 dark:border-slate-700`}>Cancel</button>}
          </div>
        )}
      {errorLine}
    </>
  );
}

// ── Decision history and outcomes ───────────────────────────────────────────

export function DecisionHistory({ ctx, decisions, waybills, onChanged }: { ctx: TabCtx; decisions: StockAllocationDecision[]; waybills: StockAllocationWaybill[]; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const productName = (id: string) => ctx.products.find((p) => p.id === id)?.name ?? "Product";
  const viewing = decisions.find((d) => d.id === open) ?? null;
  return (
    <Panel title={<span className="flex items-center gap-2"><History className="h-4 w-4 text-gray-500" />Allocation Decisions</span>}
      info="Every plan that was sent: what the system recommended, what was approved, who did what, and what happened after.">
      <div className="overflow-x-auto">
        <table className="w-full !min-w-[860px] border-separate border-spacing-0">
          <thead><tr>{["Sent", "Product", "States", "Recommended", "Approved", "Sent by", "Decided by", "Status", "Transferred", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>
            {decisions.length === 0 && <tr><td colSpan={10} className={`${td} py-6 text-center text-gray-400`}>No plans sent yet. Plans sent from this tab appear here with their results.</td></tr>}
            {decisions.map((d) => {
              const sent = d.decided_at ? waybillUnitsByState(waybills, d.product_id, d.decided_at, ctx.hubs) : new Map();
              const transferred = [...sent.entries()].filter(([state]) => d.final_lines.some((l) => l.state === state)).reduce((s, [, v]) => s + v.units, 0);
              const status = STATUS[d.status];
              return (
                <tr key={d.id} className="hover:bg-gray-50/70 [&>td]:[color:inherit]">
                  <td className={td}>{when(d.proposed_at)}</td>
                  <td className={`${td} font-semibold`}>{productName(d.product_id)}</td>
                  <td className={`${td} max-w-[180px] truncate`}>{d.final_lines.map((l) => stateLabel(l.state)).join(", ")}</td>
                  <td className={td}>{nf(unitsOf(d.recommended))}</td>
                  <td className={td}>{d.status === "proposed" ? "—" : nf(unitsOf(d.final_lines))}</td>
                  <td className={td}>{d.proposed_by_name ?? "—"}</td>
                  <td className={td}>{d.decided_by_name ?? "—"}</td>
                  <td className={td}><Pill tone={status.tone}>{status.label}</Pill></td>
                  <td className={td}>{d.decided_at && d.status !== "rejected" ? nf(transferred) : "—"}</td>
                  <td className={td}><button type="button" onClick={() => setOpen(d.id)} className="!min-h-0 rounded-md border border-blue-200 px-2.5 py-1 text-[11.5px] font-semibold text-[#1F8FE0]">View</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {viewing && <DecisionPanel ctx={ctx} decision={viewing} waybills={waybills} productName={productName(viewing.product_id)} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </Panel>
  );
}

function DecisionPanel({ ctx, decision, waybills, productName, onClose }: {
  ctx: TabCtx; decision: StockAllocationDecision; waybills: StockAllocationWaybill[]; productName: string; onClose: () => void; onChanged: () => void;
}) {
  const [orders, setOrders] = useState<TrendOrder[] | null>(null);
  const [error, setError] = useState("");
  const since = decision.decided_at ? decision.decided_at.slice(0, 10) : null;
  const followed = Boolean(since) && (decision.status === "approved" || decision.status === "completed");
  useEffect(() => {
    if (!followed || !since) return;
    let cancelled = false;
    ctx.loadOrders(since, ctx.today).then((rows) => { if (!cancelled) setOrders(rows.filter((o) => o.productId === decision.product_id)); })
      .catch((err: any) => { if (!cancelled) setError(err?.message ?? "Could not load the orders since approval."); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followed, since, decision.product_id, ctx.loadOrders, ctx.today]);
  const sent = decision.decided_at ? waybillUnitsByState(waybills, decision.product_id, decision.decided_at, ctx.hubs) : new Map();
  const daysSince = since ? Math.max(1, Math.round((new Date(`${ctx.today}T12:00:00Z`).getTime() - new Date(`${since}T12:00:00Z`).getTime()) / 86_400_000) + 1) : 0;
  const outcome = useMemo(() => {
    if (!orders) return null;
    return decision.final_lines.map((line) => {
      const here = orders.filter((o) => o.state === line.state);
      const delivered = here.filter(isDelivered);
      const stockNow = ctx.hubs.filter((h) => h.state === line.state).reduce((s, h) => s + h.stocks.filter((x) => x.productId === decision.product_id).reduce((t, x) => t + Math.max(0, x.quantity), 0), 0);
      const revenue = delivered.reduce((s, o) => s + o.amount, 0);
      const contribution = delivered.reduce((s, o) => s + o.amount - o.cogs - o.logisticsCost, 0);
      return { line, orders: here.length, delivered: delivered.length, units: delivered.reduce((s, o) => s + o.units, 0), rate: here.length > 0 ? (delivered.length / here.length) * 100 : 0, revenue, contribution, stockNow };
    });
  }, [orders, decision, ctx.hubs]);
  const expected = Number(decision.expected?.withDelivered ?? 0);
  const horizon = Number(decision.expected?.horizonDays ?? decision.horizon_days ?? 30);
  const expectedSoFar = expected * Math.min(1, daysSince / Math.max(1, horizon));
  const deliveredUnits = (outcome ?? []).reduce((s, o) => s + o.units, 0);
  const stat = (label: string, value: string, sub?: string) => <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-900"><div className="text-[11px] text-gray-500">{label}</div><div className="mt-0.5 text-[15px] font-bold">{value}</div>{sub && <div className="text-[10.5px] text-gray-500">{sub}</div>}</div>;

  return (
    <SidePanel title={`${productName} · stock plan`} subtitle={<><Pill tone={STATUS[decision.status].tone}>{STATUS[decision.status].label}</Pill> <span className="ml-1">sent {when(decision.proposed_at)} by {decision.proposed_by_name ?? "—"}</span></>} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat("Recommended", `${nf(unitsOf(decision.recommended))} units`)}
        {stat("Approved", decision.status === "proposed" ? "—" : `${nf(unitsOf(decision.final_lines))} units`)}
        {stat("Warehouse then", `${nf(decision.warehouse_available)} units`)}
        {stat("Forecast", `${decision.horizon_days} days`, decision.confidence ? `${decision.confidence} confidence` : undefined)}
      </div>
      {(decision.reason || decision.decision_note) && (
        <div className="mt-3 space-y-1 text-[12.5px]">
          {decision.reason && <p className="m-0"><strong>Why sent:</strong> {decision.reason}</p>}
          {decision.decision_note && <p className="m-0"><strong>Owner's note:</strong> {decision.decision_note}</p>}
        </div>
      )}

      <h3 className="m-0 mb-2 mt-4 text-[13px] font-bold">By state</h3>
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
        <table className="w-full !min-w-0 border-separate border-spacing-0">
          <thead><tr>{["State", "Recommended", "Approved", "Sent by waybill", "Received"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>
            {decision.final_lines.map((line) => {
              const rec = decision.recommended.find((r) => r.state === line.state)?.units ?? 0;
              const s = sent.get(line.state);
              return <tr key={line.state} className="[&>td]:[color:inherit]"><td className={`${td} font-semibold`}>{stateLabel(line.state)}</td><td className={td}>{nf(rec)}</td>
                <td className={td}>{decision.status === "proposed" ? "—" : nf(line.units)}</td><td className={td}>{s ? nf(s.units) : "—"}</td><td className={td}>{s ? nf(s.received) : "—"}</td></tr>;
            })}
          </tbody>
        </table>
      </div>

      {followed && (
        <>
          <h3 className="m-0 mb-1 mt-4 text-[13px] font-bold">What happened since approval ({daysSince} day{daysSince === 1 ? "" : "s"})</h3>
          {error && <p className="m-0 text-[12px] text-rose-600">{error}</p>}
          {!orders && !error && <p className="m-0 flex items-center gap-1 text-[12px] text-gray-500"><Loader2 className="h-3 w-3 animate-spin" /> Loading orders…</p>}
          {outcome && (
            <>
              <p className="m-0 mb-2 text-[12px] text-gray-600">
                {nf(deliveredUnits)} units delivered in these states so far{expected > 0 ? ` against about ${nf(Math.round(expectedSoFar))} expected by now (${nf(expected)} over ${horizon} days)` : ""}.
                {expected > 0 && <strong className={deliveredUnits >= expectedSoFar * 0.9 ? " text-emerald-700" : " text-amber-700"}> {deliveredUnits >= expectedSoFar * 0.9 ? "On track." : "Behind the forecast."}</strong>}
              </p>
              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
                <table className="w-full !min-w-0 border-separate border-spacing-0">
                  <thead><tr>{["State", "Orders", "Delivered", "Units delivered", "Rate", ...(ctx.canSeeProfit ? ["Revenue", "Contribution"] : []), "Stock left"].map((h) => <th key={h} className={th} title={h === "Contribution" ? "Delivered revenue − product cost − delivery fees (before running costs)." : undefined}>{h}</th>)}</tr></thead>
                  <tbody>{outcome.map((o) => (
                    <tr key={o.line.state} className="[&>td]:[color:inherit]"><td className={`${td} font-semibold`}>{stateLabel(o.line.state)}</td><td className={td}>{nf(o.orders)}</td><td className={td}>{nf(o.delivered)}</td>
                      <td className={td}>{nf(o.units)}</td><td className={td}>{o.orders > 0 ? `${o.rate.toFixed(1)}%` : "—"}</td>
                      {ctx.canSeeProfit && <><td className={td}>{ctx.money(o.revenue)}</td><td className={td}>{ctx.money(o.contribution)}</td></>}
                      <td className={td}>{nf(o.stockNow)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <h3 className="m-0 mb-2 mt-4 text-[13px] font-bold">Record</h3>
      <ol className="m-0 list-none space-y-1.5 border-l-2 border-gray-200 p-0 pl-3 dark:border-slate-700">
        {decision.events.map((e) => (
          <li key={e.id} className="text-[12px]"><strong>{ACTION_LABEL[e.action] ?? e.action}</strong> · {e.actor_name ?? "—"}{e.actor_role ? ` (${e.actor_role})` : ""} · {when(e.created_at)}
            {typeof e.detail?.note === "string" && e.detail.note && <span className="block text-gray-600">“{e.detail.note as string}”</span>}
            {e.detail?.changedByOwner === true && <span className="block text-gray-600">Units changed by the Owner before approving.</span>}</li>
        ))}
      </ol>
    </SidePanel>
  );
}
