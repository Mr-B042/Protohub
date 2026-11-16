import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck, CheckCircle2, CircleDashed, ClipboardList, ExternalLink, FileUp, Megaphone, Package, Pencil, ReceiptText, ShieldCheck, Trash2, Truck, Users, Wallet, Zap
} from "lucide-react";
import { expenseIntelApi } from "../../lib/api";
import type { EiCtx } from "./context";
import { STATUS_LABEL, labelOf, orderIdOf, paymentSourceOf, type EExpense } from "./model";
import { Drawer, Field, Pill, btn, input, type Icon } from "./ui";

/** Pills, dates and the details drawer shared by Overview and All Expenses. */

const CATEGORY_STYLE: Record<string, { tone: "purple" | "green" | "blue" | "amber" | "red" | "orange" | "grey"; icon: Icon }> = {
  Waybill: { tone: "purple", icon: Truck }, Delivery: { tone: "green", icon: Truck }, "Failed Delivery": { tone: "red", icon: Truck },
  "Ad Spend": { tone: "blue", icon: Megaphone }, "Bonuses & Incentives": { tone: "purple", icon: Users }, Salary: { tone: "purple", icon: Users },
  "Clearing & Shipping": { tone: "amber", icon: Package }, "Stock Loss": { tone: "orange", icon: Package }, "Airtime & Data": { tone: "grey", icon: Zap }
};
export function CategoryPill({ category }: { category: string }) {
  const s = CATEGORY_STYLE[category] ?? { tone: "red" as const, icon: ClipboardList };
  return <Pill tone={s.tone} icon={s.icon}>{labelOf(category)}</Pill>;
}
const SOURCE_TONE: Record<string, "amber" | "blue" | "grey" | "purple" | "green"> = { "Manager Wallet": "amber", Agent: "blue", Company: "grey", Supplier: "purple", Payroll: "green" };
export function SourcePill({ source }: { source: string }) { return <Pill tone={SOURCE_TONE[source] ?? "grey"}>{source}</Pill>; }
export function StatusPill({ status }: { status: EExpense["checkStatus"] | "pending" }) {
  if (status === "pending") return <Pill tone="amber" icon={CircleDashed}>Pending</Pill>;
  if (status === "auto") return <Pill tone="blue" icon={BadgeCheck}>{STATUS_LABEL.auto}</Pill>;
  if (status === "verified") return <Pill tone="green" icon={CheckCircle2}>{STATUS_LABEL.verified}</Pill>;
  return <Pill tone="orange" icon={CircleDashed}>{STATUS_LABEL.unchecked}</Pill>;
}

export function dateTime(e: EExpense) {
  const d = new Date(`${e.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  if (!e.createdAt) return d;
  const c = new Date(e.createdAt);
  // Time only when it was recorded on the expense's own day (Lagos).
  const lagosDay = new Date(c.getTime() + 3600_000).toISOString().slice(0, 10);
  return lagosDay === e.date ? `${d}, ${c.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos" })}` : d;
}

/** Who paid / which agent, and the state, for filters and the drawer. */
export function useRowFacts(ctx: EiCtx) {
  return useMemo(() => {
    const orderById = new Map(ctx.orders.map((o) => [o.id, o]));
    return (e: EExpense) => {
      const order = orderIdOf(e.id) ? orderById.get(orderIdOf(e.id)!) ?? null : null;
      return {
        source: paymentSourceOf(e), order,
        person: order?.agentName || e.recordedByName || e.paidBy || "",
        state: order?.state || ""
      };
    };
  }, [ctx.orders]);
}

const canEdit = (e: EExpense) => e.checkStatus !== "auto" && !e.id.startsWith("MGRF-") && !e.partIds;

export function ExpenseDrawer({ ctx, row, onClose, onChanged }: { ctx: EiCtx; row: EExpense; onClose: () => void; onChanged: () => void }) {
  const facts = useRowFacts(ctx)(row);
  const approver = ["Owner", "Admin", "Manager"].includes(ctx.role);
  const full = ["Owner", "Admin"].includes(ctx.role);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ date: row.date, category: row.category, amount: String(row.amount), description: row.description, productId: row.productId ?? "" });
  const [receipt, setReceipt] = useState<string | null>(null);
  useEffect(() => { setDraft({ date: row.date, category: row.category, amount: String(row.amount), description: row.description, productId: row.productId ?? "" }); setEditing(false); }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); ctx.toast(done); onChanged(); } catch (e: any) { ctx.toast(e?.message ?? "Could not save."); } finally { setBusy(false); }
  };
  const openReceipt = async () => {
    try { const { url } = await expenseIntelApi.receiptLink(row.receiptUrl!); window.open(url, "_blank", "noopener"); } catch (e: any) { ctx.toast(e?.message ?? "No receipt."); }
  };
  const upload = async (file: File) => {
    const dataUrl = await new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fail(r.error); r.readAsDataURL(file); });
    await act(async () => { const { path } = await expenseIntelApi.uploadReceipt(dataUrl); await expenseIntelApi.attachReceipt(row.id, path); setReceipt(path); }, "Receipt added.");
  };
  const timeline = [
    row.createdAt ? { at: row.createdAt, text: `Recorded${row.recordedByName ? ` by ${row.recordedByName}` : ""}` } : null,
    row.requestId ? { at: row.checkedAt ?? row.createdAt ?? "", text: `Approved from a request${row.checkedByName ? ` by ${row.checkedByName}` : ""}` } : null,
    row.checkStatus === "verified" && row.checkedAt && !row.requestId ? { at: row.checkedAt, text: `Checked by ${row.checkedByName ?? "staff"}` } : null,
    row.checkStatus === "auto" ? { at: row.createdAt ?? "", text: "Booked by Protohub from its source (order, ad account or payroll)" } : null
  ].filter(Boolean) as Array<{ at: string; text: string }>;

  return (
    <Drawer title="Expense Details" onClose={onClose} footer={
      <>
        {approver && row.checkStatus === "unchecked" && <button type="button" disabled={busy} className={btn.primary} onClick={() => act(() => expenseIntelApi.checkExpenses(row.partIds ?? [row.id]), "Marked as verified.")}><ShieldCheck className="h-4 w-4" />Mark verified</button>}
        {full && canEdit(row) && !editing && <button type="button" className={btn.outline} onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit Expense</button>}
        {full && canEdit(row) && <button type="button" disabled={busy} className={`${btn.outline} !text-rose-600`} onClick={() => { if (window.confirm(`Delete ${row.id} (${ctx.money(row.amount)})? This can't be undone.`)) void act(() => expenseIntelApi.deleteExpense(row.id).then(onClose), "Expense deleted."); }}><Trash2 className="h-4 w-4" />Delete</button>}
      </>
    }>
      <p className="m-0 break-all text-[12px] font-semibold text-gray-500">{row.id}</p>
      <p className="m-0 mt-1 text-[26px] font-black text-gray-900 dark:text-slate-50">{ctx.money(row.amount)}</p>
      <div className="mt-1"><StatusPill status={row.checkStatus} /></div>

      {editing ? (
        <div className="mt-4 space-y-3">
          <Field label="Date"><input type="date" className={input} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
          <Field label="Category"><input className={input} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></Field>
          <Field label="Amount"><input inputMode="decimal" className={input} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></Field>
          <Field label="Product"><select className={input} value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value })}><option value="">No product</option>{ctx.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Description"><textarea className={`${input} !h-20 py-2`} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          <div className="flex gap-2">
            <button type="button" disabled={busy} className={btn.primary} onClick={() => {
              const amount = Number(draft.amount.replace(/[₦,\s]/g, ""));
              if (!(amount >= 0) || !draft.category.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) { ctx.toast("Check the date, category and amount."); return; }
              void act(() => expenseIntelApi.saveExpense({ id: row.id, date: draft.date, category: draft.category.trim(), amount, description: draft.description, paidBy: row.paidBy, productId: draft.productId || undefined }).then(() => setEditing(false)), "Expense saved.");
            }}>Save</button>
            <button type="button" className={btn.outline} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <dl className="mt-4 grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-gray-500">Category</dt><dd className="m-0"><CategoryPill category={row.category} /></dd>
          <dt className="text-gray-500">Product</dt><dd className="m-0 font-semibold text-gray-900 dark:text-slate-100">{row.productName || "—"}</dd>
          <dt className="text-gray-500">Expense date</dt><dd className="m-0 text-gray-900 dark:text-slate-100">{dateTime(row)}</dd>
          {row.createdAt && <><dt className="text-gray-500">Recorded</dt><dd className="m-0 text-gray-900 dark:text-slate-100">{new Date(row.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}</dd></>}
          <dt className="text-gray-500">Payment source</dt><dd className="m-0"><SourcePill source={facts.source} /></dd>
          {facts.person && <><dt className="text-gray-500">{facts.order ? "Agent" : "Paid / recorded by"}</dt><dd className="m-0 text-gray-900 dark:text-slate-100">{facts.person}</dd></>}
          {facts.state && <><dt className="text-gray-500">State</dt><dd className="m-0 text-gray-900 dark:text-slate-100">{facts.state}</dd></>}
          <dt className="text-gray-500">Description</dt><dd className="m-0 whitespace-pre-wrap text-gray-900 dark:text-slate-100">{row.description || "—"}</dd>
        </dl>
      )}

      {row.partIds && (
        <section className="mt-5">
          <h4 className="m-0 mb-1.5 text-[12px] font-extrabold uppercase tracking-wide text-gray-500">Payment breakdown</h4>
          <p className="m-0 text-[13px] text-gray-800 dark:text-slate-200">{row.partIds.length} records for this product's waybills in the same week, shown as one line.</p>
          <p className="m-0 mt-1 flex items-center justify-between text-[13px]"><span className="flex items-center gap-1.5 text-gray-600"><Wallet className="h-4 w-4" />Manager Wallet ({row.walletCount ?? 0})</span><b className="text-gray-900 dark:text-slate-100">{ctx.money(row.walletPaid ?? 0)}</b></p>
          <p className="m-0 mt-1 flex items-center justify-between text-[13px]"><span className="text-gray-600">Other payment sources</span><b className="text-gray-900 dark:text-slate-100">{ctx.money(row.amount - (row.walletPaid ?? 0))}</b></p>
        </section>
      )}

      <section className="mt-5">
        <h4 className="m-0 mb-1.5 text-[12px] font-extrabold uppercase tracking-wide text-gray-500">Linked records</h4>
        <ul className="m-0 list-none space-y-1 p-0 text-[13px]">
          {facts.order && <li><button type="button" className={btn.link} onClick={() => ctx.onOpenOrder(facts.order!.id)}>Order {facts.order.id} · {facts.order.status}<ExternalLink className="h-3.5 w-3.5" /></button></li>}
          {row.waybillId && <li className="text-gray-800 dark:text-slate-200">Waybill {row.waybillId}</li>}
          {row.id.startsWith("MGRF-") && <li className="text-gray-800 dark:text-slate-200">Paid from the manager's wallet (Finance › Wallets)</li>}
          {row.requestId && <li className="text-gray-800 dark:text-slate-200">From an approved expense request</li>}
          {!facts.order && !row.waybillId && !row.id.startsWith("MGRF-") && !row.requestId && <li className="text-gray-500">None</li>}
        </ul>
      </section>

      <section className="mt-5">
        <h4 className="m-0 mb-1.5 text-[12px] font-extrabold uppercase tracking-wide text-gray-500">Supporting documents</h4>
        {row.receiptUrl || receipt ? (
          <button type="button" className={btn.link} onClick={() => void (receipt ? expenseIntelApi.receiptLink(receipt).then(({ url }) => window.open(url, "_blank", "noopener")) : openReceipt())}><ReceiptText className="h-4 w-4" />View receipt</button>
        ) : <p className="m-0 text-[13px] text-gray-500">No receipt yet.</p>}
        {approver && (
          <label className={`${btn.outline} mt-2 cursor-pointer`}><FileUp className="h-4 w-4" />{row.receiptUrl || receipt ? "Replace receipt" : "Add receipt"}
            <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          </label>
        )}
      </section>

      <section className="mt-5">
        <h4 className="m-0 mb-1.5 text-[12px] font-extrabold uppercase tracking-wide text-gray-500">Activity timeline</h4>
        {timeline.length ? (
          <ol className="m-0 list-none space-y-2 border-l-2 border-gray-100 p-0 pl-3 dark:border-slate-800">
            {timeline.map((t, i) => <li key={i} className="text-[13px] text-gray-800 dark:text-slate-200">{t.text}{t.at && <span className="block text-[11.5px] text-gray-500">{new Date(t.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}</span>}</li>)}
          </ol>
        ) : <p className="m-0 text-[13px] text-gray-500">Recorded before Protohub kept who and when.</p>}
      </section>
    </Drawer>
  );
}
