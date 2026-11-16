import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight, Calendar, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Download, FileText, FileUp, Hourglass, Layers, Plus, Search, Settings2, Target, Trash2, User, Users, X, XCircle
} from "lucide-react";
import { expenseIntelApi, type EiApprovalRule, type EiRequest } from "../../lib/api";
import type { TabProps } from "./context";
import { labelOf, sum } from "./model";
import { CategoryPill } from "./rows";
import { C, Card, Donut, Empty, Field, Kpi, Modal, Pill, SERIES, btn, delta, downloadCsv, input, select, td, th } from "./ui";

const lagosDay = (iso: string) => new Date(new Date(iso).getTime() + 3600_000).toISOString().slice(0, 10);
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos" });
const ago = (iso: string) => { const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const RANK: Record<string, number> = { Manager: 1, Admin: 2, Owner: 3 };

export function approverFor(amount: number, rules: EiApprovalRule[]) {
  const sorted = [...rules].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  for (const r of sorted) if (r.upTo === null || amount <= r.upTo) return r.role;
  return "Owner";
}
const mayDecide = (role: string, amount: number, rules: EiApprovalRule[]) => (RANK[role] ?? 0) >= RANK[approverFor(amount, rules)];
const STATUS_PILL = { pending: <Pill tone="amber">Pending</Pill>, approved: <Pill tone="green">Approved</Pill>, rejected: <Pill tone="red">Rejected</Pill> } as const;

export default function ApprovalsTab(p: TabProps & { picker: ReactNode; focus: Record<string, string> }) {
  const { ctx, state, period } = p;
  const me = state.me;
  const rules = state.settings.approvalRules;
  const [selected, setSelected] = useState<string | null>(p.focus.request ?? null);
  const [f, setF] = useState({ search: "", category: "", status: "", department: "" });
  const [page, setPage] = useState(1);
  const [requestOpen, setRequestOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => { if (p.focus.request) setSelected(p.focus.request); }, [p.focus.request]);

  const inMonth = (r: EiRequest, from: string, to: string) => { const d = lagosDay(r.createdAt); return d >= from && d <= to; };
  const now = state.requests.filter((r) => inMonth(r, period.from, period.to));
  const before = state.requests.filter((r) => inMonth(r, period.cFrom, period.cTo));
  const count = (rows: EiRequest[], s?: EiRequest["status"]) => rows.filter((r) => !s || r.status === s).length;
  const approvedValue = (rows: EiRequest[]) => sum(rows.filter((r) => r.status === "approved"), (r) => r.amount);
  const pendingAll = state.requests.filter((r) => r.status === "pending");
  const mine = pendingAll.filter((r) => me.approver && r.requestedBy !== me.id && mayDecide(me.role, r.amount, rules));
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of now.filter((x) => x.status !== "rejected")) m.set(r.category, (m.get(r.category) ?? 0) + r.amount);
    const total = sum([...m.values()], (v) => v);
    return { total, rows: [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c, v], i) => ({ name: labelOf(c), value: v, share: total ? (v / total) * 100 : 0, color: SERIES[i % SERIES.length] })) };
  }, [now]);

  const filtered = useMemo(() => {
    const s = f.search.trim().toLowerCase();
    // The list shows every request (newest first); the month only drives the cards.
    return state.requests.filter((r) => (!f.category || r.category === f.category) && (!f.status || r.status === f.status) && (!f.department || r.department === f.department)
      && (!s || `${r.code} ${r.purpose} ${r.category} ${r.requestedByName} ${ctx.products.find((x) => x.id === r.productId)?.name ?? ""}`.toLowerCase().includes(s)));
  }, [state.requests, f, ctx.products]);
  const PER = 8;
  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const at = Math.min(page, pages);
  const shown = filtered.slice((at - 1) * PER, at * PER);
  const current = state.requests.find((r) => r.id === selected) ?? shown[0] ?? null;
  const productName = (id: string | null) => (id ? ctx.products.find((x) => x.id === id)?.name ?? "" : "");

  const exportCsv = (rows: EiRequest[]) => downloadCsv(`expense-requests.csv`, [
    ["Request ID", "Category", "Product", "Amount", "Purpose", "Requested by", "Department", "Payment source", "Expense date", "Requested at", "Status", "Decided by", "Decided at", "Note"],
    ...rows.map((r) => [r.code, labelOf(r.category), productName(r.productId), r.amount, r.purpose, r.requestedByName, r.department, r.paymentSource, r.expenseDate, r.createdAt, r.status, r.decidedByName ?? "", r.decidedAt ?? "", r.decisionNote ?? ""])
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-[22px] font-black text-gray-900 dark:text-slate-50">Approvals</h2>
          <p className="m-0 text-[13px] text-gray-500 dark:text-slate-400">{me.approver ? "Review, approve and track expense requests. Owner, Admin and Manager record expenses with no request." : "Send an expense request; it counts once Owner, Admin or Manager approves it."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {me.role === "Owner" && <button type="button" className={btn.outline} onClick={() => setSettingsOpen(true)}><Settings2 className="h-4 w-4" />Workflow Settings</button>}
          <button type="button" className={btn.outline} onClick={() => exportCsv(filtered)}><Download className="h-4 w-4" />Export</button>
          <button type="button" className={btn.primary} onClick={() => setRequestOpen(true)}><Plus className="h-4 w-4" />New Request</button>
        </div>
      </div>
      {p.picker}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi icon={ClipboardList} tone={C.blue} label="Total Requests" value={String(count(now))} d={delta(count(now), count(before), { label: period.cLabel, beforeText: String(count(before)) })} />
        <Kpi icon={Hourglass} tone={C.orange} label="Pending Approval" value={String(count(now, "pending"))} sub={`${pendingAll.length} waiting in all`} />
        <Kpi icon={CheckCircle2} tone={C.green} label="Approved" value={String(count(now, "approved"))} d={delta(count(now, "approved"), count(before, "approved"), { label: period.cLabel, beforeText: String(count(before, "approved")) })} />
        <Kpi icon={XCircle} tone={C.red} label="Rejected" value={String(count(now, "rejected"))} d={delta(count(now, "rejected"), count(before, "rejected"), { lowerIsBetter: true, label: period.cLabel, beforeText: String(count(before, "rejected")) })} />
        <Kpi icon={Layers} tone={C.purple} label="Total Approved Value" value={ctx.money(approvedValue(now))} d={delta(approvedValue(now), approvedValue(before), { label: period.cLabel, beforeText: ctx.money(approvedValue(before)) })} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2 min-[1700px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        <Card title="Approval Workflow">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {[
              { l: "Requested", n: count(now), I: ClipboardList, c: C.blue }, { l: "Under Review", n: count(now, "pending"), I: Users, c: C.purple },
              { l: "Approved", n: count(now, "approved"), I: Check, c: C.green }, { l: "Rejected", n: count(now, "rejected"), I: X, c: C.red }
            ].map((s, i) => (
              <span key={s.l} className="flex items-center gap-2">
                {i > 0 && <ArrowRight className="hidden h-4 w-4 text-gray-400 sm:block" />}
                <span className="flex w-[92px] flex-col items-center rounded-xl border border-gray-100 py-3 dark:border-slate-800">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: `${s.c}1A`, color: s.c }}><s.I className="h-5 w-5" /></span>
                  <span className="mt-1 text-[12px] font-semibold text-gray-600 dark:text-slate-300">{s.l}</span>
                  <b className="text-[20px] font-black text-gray-900 dark:text-slate-50">{s.n}</b>
                </span>
              </span>
            ))}
          </div>
          <p className="m-0 mt-3 text-[12px] text-gray-500">Who decides: {rules.slice().sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity)).map((r, i, arr) => `${r.upTo === null ? `above ${ctx.money(arr[i - 1]?.upTo ?? 0)}` : `up to ${ctx.money(r.upTo)}`}: ${r.role}${r.role === "Owner" ? "" : " or above"}`).join(" · ")}</p>
        </Card>

        <Card title="Requests by Category">
          {byCat.total === 0 ? <Empty>No requests this month.</Empty> : (
            <div className="flex flex-col items-stretch gap-3 min-[1700px]:flex-row min-[1700px]:items-center">
              <Donut data={byCat.rows} center={ctx.money(byCat.total)} sub="Requested" size={160} />
              <ul className="m-0 w-full list-none space-y-1 p-0">{byCat.rows.map((r) => <li key={r.name} className="flex items-center justify-between gap-2 text-[12.5px]"><span className="inline-flex items-center gap-1.5 text-gray-800 dark:text-slate-200"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.name}</span><b className="text-gray-900 dark:text-slate-100">{r.share.toFixed(1)}%</b></li>)}</ul>
            </div>
          )}
        </Card>

        <Card title={me.approver ? `Pending My Approval (${mine.length})` : `My Pending Requests (${pendingAll.length})`} action={<button type="button" className={btn.link} onClick={() => { setF({ ...f, status: "pending" }); setPage(1); }}>View All</button>}>
          {(me.approver ? mine : pendingAll).length === 0 ? <Empty>Nothing waiting.</Empty> : (
            <ul className="m-0 list-none space-y-1 p-0">
              {(me.approver ? mine : pendingAll).slice(0, 5).map((r) => (
                <li key={r.id}><button type="button" onClick={() => setSelected(r.id)} className="!min-h-0 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800">
                  <CategoryPill category={r.category} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-gray-800 dark:text-slate-200">{productName(r.productId) || r.purpose}</span>
                  <b className="shrink-0 text-[13px] text-gray-900 dark:text-slate-50">{ctx.money(r.amount)}</b>
                  <span className="shrink-0 text-[11px] text-gray-500">{ago(r.createdAt)}</span><ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                </button></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="All Approval Requests" action={
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className={`${input} !pl-9 w-[240px]`} placeholder="Search by request ID, purpose, product or requester…" value={f.search} onChange={(e) => { setF({ ...f, search: e.target.value }); setPage(1); }} /></label>
            <select className={select} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">All Categories</option>{[...new Set(state.requests.map((r) => r.category))].map((c) => <option key={c} value={c}>{labelOf(c)}</option>)}</select>
            <select className={select} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All Status</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
            <select className={select} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="">All Departments</option>{state.departmentsList.map((d) => <option key={d}>{d}</option>)}</select>
            {picked.size > 0 && <button type="button" className={btn.outline} onClick={() => exportCsv(filtered.filter((r) => picked.has(r.id)))}><Download className="h-4 w-4" />Export {picked.size}</button>}
          </div>
        }>
          {shown.length === 0 ? <Empty>{state.requests.length ? "No requests match." : "No expense requests yet. An Accountant's expenses arrive here for approval."}</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full !min-w-[860px]">
                <thead><tr className="border-b border-gray-100 dark:border-slate-800">
                  <th className={`${th} w-8`}><input type="checkbox" aria-label="Select page" checked={shown.every((r) => picked.has(r.id))} onChange={(e) => { const n = new Set(picked); shown.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id))); setPicked(n); }} /></th>
                  {["Request ID", "Category", "Product / Reference", "Amount", "Requested By", "Department", "Request Date", "Status"].map((h) => <th key={h} className={`${th} ${h === "Amount" ? "!text-right" : ""}`}>{h}</th>)}
                </tr></thead>
                <tbody>{shown.map((r) => (
                  <tr key={r.id} onClick={() => setSelected(r.id)} className={`cursor-pointer border-b border-gray-50 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800/50 ${current?.id === r.id ? "bg-blue-50/50 dark:bg-blue-500/10" : ""}`}>
                    <td className={td} onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.code}`} checked={picked.has(r.id)} onChange={() => { const n = new Set(picked); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); setPicked(n); }} /></td>
                    <td className={`${td} whitespace-nowrap font-semibold`}>{r.code}</td>
                    <td className={td}><CategoryPill category={r.category} /></td>
                    <td className={`${td} max-w-[200px] truncate`} title={r.purpose}>{productName(r.productId) || r.purpose}</td>
                    <td className={`${td} text-right font-bold`}>{ctx.money(r.amount)}</td>
                    <td className={td}><span className="inline-flex items-center gap-1.5"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 text-[10px] font-black text-violet-700">{initials(r.requestedByName)}</span>{r.requestedByName}</span></td>
                    <td className={td}>{r.department}</td>
                    <td className={`${td} whitespace-nowrap`}>{when(r.createdAt)}</td>
                    <td className={td}>{STATUS_PILL[r.status]}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-gray-600">
            <span>Showing {filtered.length ? (at - 1) * PER + 1 : 0} – {Math.min(at * PER, filtered.length)} of {filtered.length} requests</span>
            <span className="flex items-center gap-1">
              <button type="button" disabled={at <= 1} onClick={() => setPage(at - 1)} className={`${btn.outline} !h-9`}><ChevronLeft className="h-4 w-4" />Prev</button>
              <b className="px-2">{at} / {pages}</b>
              <button type="button" disabled={at >= pages} onClick={() => setPage(at + 1)} className={`${btn.outline} !h-9`}>Next<ChevronRight className="h-4 w-4" /></button>
            </span>
          </div>
        </Card>

        {current ? <RequestDetails p={p} r={current} productName={productName(current.productId)} canDecide={me.approver && current.status === "pending" && current.requestedBy !== me.id && mayDecide(me.role, current.amount, rules)} needs={approverFor(current.amount, rules)} /> : <Card title="Request Details"><Empty>Pick a request.</Empty></Card>}
      </div>

      {requestOpen && <RequestForm p={p} onClose={() => setRequestOpen(false)} />}
      {settingsOpen && <WorkflowSettings p={p} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function RequestDetails({ p, r, productName, canDecide, needs }: { p: TabProps; r: EiRequest; productName: string; canDecide: boolean; needs: string }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !note.trim()) { p.ctx.toast("Write why it is rejected first."); return; }
    setBusy(true);
    try { await expenseIntelApi.decide(r.id, decision, note.trim() || undefined); p.ctx.toast(decision === "approved" ? `${r.code} approved: it is now an expense.` : `${r.code} rejected.`); setNote(""); p.reload(); p.ctx.refresh(); }
    catch (e: any) { p.ctx.toast(e?.message ?? "Could not save."); } finally { setBusy(false); }
  };
  const receipt = async () => { try { const { url } = await expenseIntelApi.requestReceipt(r.id); window.open(url, "_blank", "noopener"); } catch (e: any) { p.ctx.toast(e?.message ?? "No receipt."); } };
  const row = (I: typeof User, l: string, v: ReactNode) => (
    <li className="flex items-start gap-2.5 border-b border-gray-100 py-2 text-[13px] last:border-0 dark:border-slate-800"><I className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" /><span className="w-28 shrink-0 text-gray-500">{l}</span><span className="min-w-0 flex-1 break-words font-semibold text-gray-900 dark:text-slate-100">{v}</span></li>
  );
  return (
    <Card title="Request Details" action={STATUS_PILL[r.status]}>
      <b className="block text-[16px] text-gray-900 dark:text-slate-50">{r.code}</b>
      <span className="block text-[12.5px] text-gray-500">{labelOf(r.category)}{productName ? ` – ${productName}` : ""}</span>
      <b className="mt-1 block text-[26px] font-black text-gray-900 dark:text-slate-50">{p.ctx.money(r.amount)}</b>
      <ul className="m-0 mt-2 list-none p-0">
        {row(User, "Requested by", `${r.requestedByName} (${r.requestedByRole})`)}
        {row(Calendar, "Request date", when(r.createdAt))}
        {row(Calendar, "Expense date", r.expenseDate)}
        {row(Layers, "Department", r.department)}
        {row(Target, "Purpose", r.purpose)}
        {row(FileText, "Payment source", r.paymentSource)}
        {row(FileText, "Supporting document", r.hasReceipt ? <button type="button" className={btn.link} onClick={() => void receipt()}>View receipt<Download className="h-3.5 w-3.5" /></button> : <span className="font-normal text-gray-500">None attached</span>)}
        {r.status !== "pending" && row(CheckCircle2, r.status === "approved" ? "Approved by" : "Rejected by", `${r.decidedByName ?? "—"}${r.decidedAt ? `, ${when(r.decidedAt)}` : ""}`)}
        {r.decisionNote && row(FileText, "Note", r.decisionNote)}
        {r.status === "pending" && !canDecide && row(Users, "Needs", `${needs}${needs === "Owner" ? "" : " or above"} to decide`)}
      </ul>
      {canDecide && (
        <>
          <textarea className={`${input} mt-3 !h-16 py-2`} placeholder="Note (needed to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => void decide("rejected")} className="!min-h-0 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-rose-50 font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-50"><X className="h-4 w-4" />Reject</button>
            <button type="button" disabled={busy} onClick={() => void decide("approved")} className="!min-h-0 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-50 font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"><Check className="h-4 w-4" />Approve</button>
          </div>
        </>
      )}
      {r.status === "pending" && r.requestedBy === p.state.me.id && (
        <button type="button" disabled={busy} className={`${btn.outline} mt-3 w-full justify-center !text-rose-600`} onClick={() => { if (window.confirm(`Withdraw ${r.code}?`)) { setBusy(true); void expenseIntelApi.withdraw(r.id).then(() => { p.ctx.toast("Request withdrawn."); p.reload(); }).catch((e: any) => p.ctx.toast(e?.message ?? "Could not withdraw.")).finally(() => setBusy(false)); } }}><Trash2 className="h-4 w-4" />Withdraw request</button>
      )}
    </Card>
  );
}

const CATEGORIES = ["Ad Spend", "Waybill", "Delivery", "Clearing & Shipping", "Airtime & Data", "Bonuses & Incentives", "Salary", "Stock Loss", "Other"];
const DEFAULT_DEPT: Record<string, string> = { "Ad Spend": "Marketing & Growth", Waybill: "Operations & Fulfillment", Delivery: "Operations & Fulfillment", "Clearing & Shipping": "Inventory & Procurement", "Airtime & Data": "Administration", "Bonuses & Incentives": "Sales & Customer Support", Salary: "Sales & Customer Support", "Stock Loss": "Inventory & Procurement", Other: "Others" };

export function RequestForm({ p, onClose }: { p: TabProps; onClose: () => void }) {
  const { ctx, state } = p;
  const [d, setD] = useState({ category: "Other", productId: "", amount: "", purpose: "", department: "Others", paymentSource: "Company", expenseDate: ctx.today });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = Number(d.amount.replace(/[₦,\s]/g, ""));
  const send = async () => {
    if (!(amount > 0)) { ctx.toast("Type an amount above 0."); return; }
    if (d.purpose.trim().length < 3) { ctx.toast("Say what the money is for."); return; }
    setBusy(true);
    try {
      let receiptPath: string | null = null;
      if (file) {
        if (file.size > 10 * 1024 * 1024) throw new Error("The receipt is over 10 MB.");
        const dataUrl = await new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fail(r.error); r.readAsDataURL(file); });
        receiptPath = (await expenseIntelApi.uploadReceipt(dataUrl)).path;
      }
      const r = await expenseIntelApi.createRequest({ ...d, productId: d.productId || null, amount, purpose: d.purpose.trim(), receiptPath });
      ctx.toast(`${r.code} sent for approval.`); p.reload(); onClose();
    } catch (e: any) { ctx.toast(e?.message ?? "Could not send."); } finally { setBusy(false); }
  };
  return (
    <Modal title="New Expense Request" sub={`Needs ${approverFor(amount || 0, state.settings.approvalRules)}${approverFor(amount || 0, state.settings.approvalRules) === "Owner" ? "" : " or above"} to approve this amount. It counts as an expense only once approved.`} onClose={onClose}
      footer={<><button type="button" className={btn.outline} onClick={onClose}>Cancel</button><button type="button" disabled={busy} className={btn.primary} onClick={() => void send()}>{busy ? "Sending…" : "Send for approval"}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category"><select className={input} value={d.category} onChange={(e) => setD({ ...d, category: e.target.value, department: DEFAULT_DEPT[e.target.value] ?? d.department })}>{CATEGORIES.map((c) => <option key={c} value={c}>{labelOf(c)}</option>)}</select></Field>
        <Field label="Amount"><input inputMode="numeric" className={input} value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} placeholder="0" /></Field>
        <Field label="Product (if it is for one)"><select className={input} value={d.productId} onChange={(e) => setD({ ...d, productId: e.target.value })}><option value="">Not for one product</option>{ctx.products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Department"><select className={input} value={d.department} onChange={(e) => setD({ ...d, department: e.target.value })}>{state.departmentsList.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Payment source"><select className={input} value={d.paymentSource} onChange={(e) => setD({ ...d, paymentSource: e.target.value })}>{state.paymentSources.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Expense date"><input type="date" className={input} value={d.expenseDate} onChange={(e) => setD({ ...d, expenseDate: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Field label="Purpose"><textarea className={`${input} !h-20 py-2`} value={d.purpose} onChange={(e) => setD({ ...d, purpose: e.target.value })} placeholder="e.g. Facebook ads top-up (3 ad sets)" /></Field></div>
        <div className="sm:col-span-2">
          <label className={`${btn.outline} cursor-pointer`}><FileUp className="h-4 w-4" />{file ? file.name : "Attach receipt or quote (optional)"}
            <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      </div>
    </Modal>
  );
}

function WorkflowSettings({ p, onClose }: { p: TabProps; onClose: () => void }) {
  const sorted = [...p.state.settings.approvalRules].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  const [manager, setManager] = useState(String(sorted.find((r) => r.role === "Manager")?.upTo ?? 25000));
  const [admin, setAdmin] = useState(String(sorted.find((r) => r.role === "Admin")?.upTo ?? 100000));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const m = Number(manager.replace(/[,₦\s]/g, "")), a = Number(admin.replace(/[,₦\s]/g, ""));
    if (!(m > 0) || !(a > m)) { p.ctx.toast("Admin's limit must be above Manager's."); return; }
    setBusy(true);
    try { await expenseIntelApi.saveSettings({ approvalRules: [{ upTo: m, role: "Manager" }, { upTo: a, role: "Admin" }, { upTo: null, role: "Owner" }] }); p.ctx.toast("Approval limits saved."); p.reload(); onClose(); }
    catch (e: any) { p.ctx.toast(e?.message ?? "Could not save."); } finally { setBusy(false); }
  };
  return (
    <Modal title="Workflow Settings" sub="Who may approve an Accountant's expense request, by amount. A higher role can always approve." onClose={onClose}
      footer={<><button type="button" className={btn.outline} onClick={onClose}>Cancel</button><button type="button" disabled={busy} className={btn.primary} onClick={() => void save()}>Save</button></>}>
      <div className="space-y-3">
        <Field label="Manager may approve up to"><input inputMode="numeric" className={input} value={manager} onChange={(e) => setManager(e.target.value)} /></Field>
        <Field label="Admin may approve up to"><input inputMode="numeric" className={input} value={admin} onChange={(e) => setAdmin(e.target.value)} /></Field>
        <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-300">Above that: Owner only. Owner, Admin and Manager record their own expenses with no request.</p>
      </div>
    </Modal>
  );
}
