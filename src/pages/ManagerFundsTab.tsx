import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, FileText, Lock,
  MoreVertical, Paperclip, Plus, Receipt, Search, Wallet
} from "lucide-react";
import { Bar, CartesianGrid, Cell, ComposedChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Modal, Panel, dateTimeText, longDate, nf, shortDay } from "../components/WeeklyReportParts";
import { managerFundsApi, type ManagerFundLogInput, type ManagerFundOrderCheck, type ManagerFundTxn, type ManagerFundWeek, type FundKindKey } from "../lib/api";
import { currencySymbol } from "../lib/money-privacy";

/**
 * Manager Funds & Expenses (Bright, 1 Oct 2026). His design called it
 * "Allocated Expenses"; his notes asked for the fuller picture:
 *
 *   Opening + Received - Spent - Remitted = Expected;  Actual - Expected = Variance
 *
 * The manager logs money as it moves; Protohub does the maths. A remittance
 * to the company is NEVER an expense, and customer money is not profit.
 * Every figure here comes from the server (routes/manager-funds.ts).
 */

const IN_KINDS: Array<{ key: FundKindKey; label: string; hint: string }> = [
  { key: "customer_payment", label: "Customer Payment", hint: "A customer paid you for an order. Marks the order paid." },
  { key: "owner_funding", label: "Owner Funding", hint: "Money the owner sent you to run the week." },
  { key: "company_transfer_in", label: "Other Company Funds", hint: "Money from another company account." },
  { key: "other_in", label: "Other Money In", hint: "Anything else, e.g. a supplier refund. Explanation and proof required." }
];

const PAYMENT_METHODS = [["transfer", "Transfer"], ["cash", "Cash"], ["pos", "POS"], ["other", "Other"]] as const;
const CATEGORY_COLORS = ["#3b82f6", "#10b981", "#f97316", "#a855f7", "#64748b", "#ef4444", "#eab308", "#14b8a6", "#ec4899", "#94a3b8", "#0ea5e9"];

const nowLocalInput = () => {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  return now.toISOString().slice(0, 16);
};
/** "2026-09-29T10:00" (Lagos, from the input) -> ISO with +01:00. */
const lagosInputToIso = (value: string) => `${value}:00+01:00`;

const readFile = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error("Could not read the file."));
  reader.readAsDataURL(file);
});

function StatusPill({ txn, locked }: { txn: ManagerFundTxn; locked: boolean }) {
  if (txn.status === "voided") return <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500 line-through">Removed</span>;
  if (txn.status === "returned") return <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">Returned</span>;
  if (txn.missingProof) return <span title={txn.missingProof} className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Needs proof</span>;
  if (locked) return <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700"><Lock className="h-3 w-3" />Locked</span>;
  return <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Complete</span>;
}

function MethodPill({ method }: { method: string | null }) {
  if (!method) return <span className="text-gray-400">-</span>;
  const tone = method === "cash" ? "bg-emerald-50 text-emerald-700" : method === "transfer" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600";
  return <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold capitalize ${tone}`}>{method === "pos" ? "POS" : method}</span>;
}

/**
 * The money already on the orders (Bright, 3 Oct 2026), so nothing is counted
 * twice. A rider fee: how much of it is the orders' own delivery fee (already a
 * cost) and how much is new. Income for an order: amount − delivery fee −
 * already received = what is left, with a button to use it.
 */
function OrderMoneyCheck({ kind, category, amount, orderText, excludeTxnId, sym, nf, onUseAmount }: {
  kind: string; category: string; amount: string; orderText: string; excludeTxnId?: string; sym: string;
  nf: (value: number) => string; onUseAmount: (value: number) => void;
}) {
  const ids = useMemo(() => Array.from(new Set(orderText.split(/[\s,]+/).map((id) => id.replace(/^#/, "").trim()).filter(Boolean))).slice(0, 20), [orderText]);
  const rider = kind === "expense" && category === "logistics";
  const income = kind === "customer_payment";
  const value = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const [check, setCheck] = useState<ManagerFundOrderCheck | null>(null);
  const [error, setError] = useState("");
  const key = `${ids.join(",")}|${rider ? value : ""}`;
  useEffect(() => {
    if ((!rider && !income) || ids.length === 0) { setCheck(null); setError(""); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      managerFundsApi.orderCheck(ids, rider ? { amount: value, category: "logistics", excludeTxnId } : {})
        .then((result) => { if (!cancelled) { setCheck(result); setError(""); } })
        .catch((err: any) => { if (!cancelled) { setCheck(null); setError(err?.message ?? "Couldn't check those orders."); } });
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rider, income, excludeTxnId]);

  if (!rider && !income) return null;
  if (rider && ids.length === 0) {
    return <p className="m-0 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-800">Add the order numbers this fee was for. If a fee is already on the order, it won't be counted twice.</p>;
  }
  if (ids.length === 0) return null;
  if (error) return <p className="m-0 rounded-xl bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p>;
  if (!check) return <p className="m-0 text-[11px] text-gray-500">Checking the order{ids.length === 1 ? "" : "s"}…</p>;
  if (income) {
    const order = check.orders[0];
    if (!order) return null;
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-[12px] text-gray-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-slate-200">
        <p className="m-0 font-bold text-gray-900 dark:text-slate-50">#{order.id} · {order.customer} · {order.status}</p>
        <p className="m-0 mt-1">Order {sym}{nf(order.amount)} − delivery fee {sym}{nf(order.deliveryFee)} = <strong>{sym}{nf(order.expected)}</strong> expected</p>
        <p className="m-0">Already received {sym}{nf(order.received)} · <strong>{sym}{nf(order.left)} left</strong></p>
        {order.left > 0 && Math.abs(order.left - value) >= 0.01 ? (
          <button type="button" onClick={() => onUseAmount(order.left)} className="!min-h-[36px] mt-2 rounded-lg bg-emerald-600 px-3 text-[12px] font-bold text-white">Use {sym}{nf(order.left)}</button>
        ) : null}
        {order.left <= 0 ? <p className="m-0 mt-1 font-semibold text-amber-700">Nothing is left to receive on this order. Logging more is a double payment.</p> : null}
      </div>
    );
  }
  const fees = check.orders.reduce((sum, order) => sum + order.deliveryFee, 0);
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2.5 text-[12px] text-gray-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-slate-200">
      <ul className="m-0 list-none space-y-0.5 p-0">
        {check.orders.map((order) => <li key={order.id} className="flex justify-between gap-2"><span className="truncate">#{order.id} · {order.customer}</span><span className="shrink-0">delivery fee {sym}{nf(order.deliveryFee)}</span></li>)}
      </ul>
      {check.split ? (
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-blue-100 pt-2 dark:border-blue-500/20">
          <div><span className="block text-[11px] text-gray-500">Already on the orders</span><strong className="text-[14px]">{sym}{nf(check.split.counted)}</strong><span className="block text-[10.5px] text-gray-500">paid from your wallet, not a new cost</span></div>
          <div><span className="block text-[11px] text-gray-500">New cost booked</span><strong className="text-[14px]">{sym}{nf(check.split.newCost)}</strong><span className="block text-[10.5px] text-gray-500">{check.split.newCost > 0 ? "above the orders' fees" : "nothing extra"}</span></div>
        </div>
      ) : null}
      {fees === 0 ? <p className="m-0 mt-1 text-[11px] text-gray-500">These orders have no delivery fee yet, so the whole amount is a new cost.</p> : null}
    </div>
  );
}

function FundCard({ icon: Icon, tone, label, value, sub }: { icon: typeof Wallet; tone: string; label: string; value: string; sub: string }) {
  const tones: Record<string, [string, string]> = {
    green: ["border-emerald-100 bg-emerald-50/40", "bg-emerald-100 text-emerald-600"],
    blue: ["border-blue-100 bg-blue-50/40", "bg-blue-100 text-blue-600"],
    purple: ["border-violet-100 bg-violet-50/40", "bg-violet-100 text-violet-600"],
    orange: ["border-orange-100 bg-orange-50/40", "bg-orange-100 text-orange-500"]
  };
  const [card, tile] = tones[tone];
  return (
    <div className={`flex min-w-0 items-center gap-3 rounded-2xl border px-4 py-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${card}`}>
      <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tile}`}><Icon className="h-6 w-6" /></span>
      <div className="min-w-0">
        <p className="m-0 text-[13px] font-semibold text-gray-700 dark:text-slate-300">{label}</p>
        <p className="m-0 mt-0.5 text-[22px] font-black tracking-tight text-gray-900 dark:text-slate-50">{value}</p>
        <p className="m-0 text-[11px] text-gray-500 dark:text-slate-400">{sub}</p>
      </div>
    </div>
  );
}

type Draft = {
  kind: FundKindKey;
  category: string;
  amount: string;
  occurredAt: string;
  description: string;
  paidTo: string;
  paymentMethod: string;
  reference: string;
  orderId: string;
  relatedOrders: string;
  counterpartyAccountId: string;
  file: File | null;
};

const emptyDraft = (kind: FundKindKey): Draft => ({
  kind, category: kind === "expense" ? "logistics" : "", amount: "", occurredAt: nowLocalInput(), description: "", paidTo: "",
  paymentMethod: "transfer", reference: "", orderId: "", relatedOrders: "", counterpartyAccountId: "", file: null
});

export default function ManagerFundsTab({
  data, loading, error, mode, canWrite, onSelectManager, onLog, onUpload, onEdit, onVoid, onOpenEvidence,
  onSaveWeek, onRequestAdjustment, onDecideAdjustment, onReturnTransaction, onSaveSettings, footer
}: {
  data: ManagerFundWeek | null;
  loading: boolean;
  error: string;
  mode: "manager" | "owner";
  canWrite: boolean;
  onSelectManager?: (managerId: string) => void;
  onLog: (body: ManagerFundLogInput) => Promise<{ id: string }>;
  onUpload: (transactionId: string, file: File) => Promise<void>;
  onEdit: (transactionId: string, body: Partial<ManagerFundLogInput>) => Promise<void>;
  onVoid: (transactionId: string, reason: string) => Promise<void>;
  onOpenEvidence: (transactionId: string, path: string) => Promise<void>;
  onSaveWeek: (body: { actualClosing?: number | null; varianceExplanation?: string | null; notes?: string | null }) => Promise<void>;
  onRequestAdjustment: (body: { transactionId: string; requestedAmount: number; reason: string }) => Promise<void>;
  onDecideAdjustment?: (id: string, approve: boolean, note?: string) => Promise<void>;
  onReturnTransaction?: (txn: ManagerFundTxn, comment: string) => Promise<void>;
  onSaveSettings?: (body: { expenseProofMin: number; remittanceProofRequired: boolean; ownerFundingReferenceRequired: boolean; otherInProofRequired: boolean }) => Promise<void>;
  /** Manager Notes + Save as Draft + Submit to Owner (owned by the parent page). */
  footer?: ReactNode;
}) {
  const sym = currencySymbol();
  const totals = data?.totals;
  const week = data?.week;
  const locked = !!week?.locked;
  const txns = data?.transactions ?? [];
  const accounts = data?.companyAccounts ?? [];
  const categories = data?.categories ?? [];
  const accountName = (id: string | null) => accounts.find((account) => account.id === id)?.name ?? "Company account";

  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<ManagerFundTxn | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<ManagerFundTxn | null>(null);
  const [adjusting, setAdjusting] = useState<ManagerFundTxn | null>(null);
  const [returning, setReturning] = useState<ManagerFundTxn | null>(null);
  const [textInput, setTextInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [actualDraft, setActualDraft] = useState<string | null>(null);
  const [explanationDraft, setExplanationDraft] = useState<string | null>(null);
  const [inSearch, setInSearch] = useState("");
  const [inSource, setInSource] = useState("");
  const [inMethod, setInMethod] = useState("");
  const [exSearch, setExSearch] = useState("");
  const [exCategory, setExCategory] = useState("");
  const [exMethod, setExMethod] = useState("");
  const [inPage, setInPage] = useState(0);
  const [exPage, setExPage] = useState(0);
  const [donutMode, setDonutMode] = useState<"amount" | "count">("amount");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Removed entries stay on record but are hidden by default, so a list never
  // shows money that is not counted.
  const [showRemoved, setShowRemoved] = useState(false);
  const PAGE = 5;

  const moneyIn = txns.filter((txn) => ["customer_payment", "owner_funding", "company_transfer_in", "other_in"].includes(txn.kind));
  const expenses = txns.filter((txn) => txn.kind === "expense");
  const remittances = txns.filter((txn) => txn.kind === "remittance_out");
  const removedCount = txns.filter((txn) => txn.status === "voided").length;
  const filteredIn = moneyIn.filter((txn) => {
    if (!showRemoved && txn.status === "voided") return false;
    const q = inSearch.trim().toLowerCase();
    if (q && !`${txn.reference ?? ""} ${txn.description ?? ""} ${txn.orderIds.join(" ")}`.toLowerCase().includes(q)) return false;
    if (inSource && txn.kind !== inSource) return false;
    if (inMethod && txn.paymentMethod !== inMethod) return false;
    return true;
  });
  const filteredEx = expenses.filter((txn) => {
    if (!showRemoved && txn.status === "voided") return false;
    const q = exSearch.trim().toLowerCase();
    if (q && !`${txn.description ?? ""} ${txn.paidTo ?? ""} ${txn.reference ?? ""}`.toLowerCase().includes(q)) return false;
    if (exCategory && txn.category !== exCategory) return false;
    if (exMethod && txn.paymentMethod !== exMethod) return false;
    return true;
  });

  const liveExpenses = expenses.filter((txn) => txn.status !== "voided");
  const categorySummary = useMemo(() => {
    const map = new Map<string, { key: string; label: string; amount: number; count: number }>();
    for (const txn of liveExpenses) {
      const key = txn.category ?? "other";
      const row = map.get(key) ?? { key, label: txn.categoryLabel ?? key, amount: 0, count: 0 };
      row.amount += txn.amount;
      row.count += 1;
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [liveExpenses]);

  const startLog = (kind: FundKindKey) => { setFormError(""); setEditing(null); setDraft(emptyDraft(kind)); };
  const startEdit = (txn: ManagerFundTxn) => {
    setFormError("");
    setEditing(txn);
    setDraft({
      kind: txn.kind, category: txn.category ?? "", amount: String(txn.amount),
      occurredAt: new Date(new Date(txn.occurredAt).getTime() + 60 * 60 * 1000).toISOString().slice(0, 16),
      description: txn.description ?? "", paidTo: txn.paidTo ?? "", paymentMethod: txn.paymentMethod ?? "transfer",
      reference: txn.reference ?? "", orderId: txn.orderIds[0] ?? "", relatedOrders: txn.kind === "expense" ? txn.orderIds.join(", ") : "",
      counterpartyAccountId: txn.counterpartyAccountId ?? "", file: null
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    const amount = Number(draft.amount.replace(/[^0-9.]/g, ""));
    if (!(amount > 0)) { setFormError("Enter the amount."); return; }
    setSaving(true);
    setFormError("");
    try {
      const body: ManagerFundLogInput = {
        kind: draft.kind,
        amount,
        occurredAt: lagosInputToIso(draft.occurredAt),
        description: draft.description.trim() || undefined,
        paidTo: draft.paidTo.trim() || undefined,
        paymentMethod: draft.paymentMethod as ManagerFundLogInput["paymentMethod"],
        reference: draft.reference.trim() || undefined,
        ...(draft.kind === "expense" ? {
          category: draft.category,
          relatedOrderIds: draft.relatedOrders.split(/[\s,]+/).map((id) => id.replace(/^#/, "").trim()).filter(Boolean)
        } : {}),
        ...(draft.kind === "customer_payment" ? { orderId: draft.orderId.replace(/^#/, "").trim() } : {}),
        ...(["owner_funding", "company_transfer_in", "remittance_out"].includes(draft.kind) ? { counterpartyAccountId: draft.counterpartyAccountId } : {})
      };
      let id = editing?.id ?? "";
      if (editing) {
        const { kind: _kind, orderId: _orderId, ...rest } = body;
        await onEdit(editing.id, rest);
      } else {
        id = (await onLog(body)).id;
      }
      if (draft.file) await onUpload(id, draft.file);
      setDraft(null);
      setEditing(null);
    } catch (err: any) {
      setFormError(err?.message ?? "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  const th = "px-1.5 py-2 text-[10px] font-bold uppercase tracking-wide";
  const td = "px-1.5 py-2 align-top";

  const rowActions = (txn: ManagerFundTxn) => {
    const items: Array<{ label: string; run: () => void }> = [];
    txn.evidence.forEach((item, index) => items.push({ label: `Open proof${txn.evidence.length > 1 ? ` ${index + 1}` : ""}`, run: () => void onOpenEvidence(txn.id, item.path) }));
    if (mode === "manager" && canWrite && txn.status !== "voided") {
      if (txn.kind !== "customer_payment") items.push({ label: "Edit", run: () => startEdit(txn) });
      items.push({ label: "Add proof", run: () => { setEditing(txn); setDraft({ ...emptyDraft(txn.kind), file: null }); setFormError(""); } });
      items.push({ label: "Remove", run: () => { setTextInput(""); setVoiding(txn); } });
    }
    if (mode === "manager" && locked && txn.status !== "voided" && txn.kind !== "customer_payment") {
      items.push({ label: "Request adjustment", run: () => { setTextInput(""); setAmountInput(String(txn.amount)); setAdjusting(txn); } });
    }
    if (mode === "owner" && onReturnTransaction && data?.companyStatus === "submitted_to_owner" && txn.status !== "voided") {
      items.push({ label: "Return this to the manager", run: () => { setTextInput(txn.missingProof ? `${txn.missingProof} for this ${sym}${nf(txn.amount)} entry.` : ""); setReturning(txn); } });
    }
    return items;
  };

  const actionCell = (txn: ManagerFundTxn) => {
    const items = rowActions(txn);
    if (items.length === 0) return <td className={td} />;
    return (
      <td className={`${td} relative text-right`}>
        <button type="button" aria-label="Actions" onClick={() => setMenuFor(menuFor === txn.id ? null : txn.id)} className="!min-h-0 rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><MoreVertical className="h-4 w-4" /></button>
        {menuFor === txn.id && (
          <div className="absolute right-2 top-9 z-30 w-48 rounded-xl border border-gray-200 bg-white py-1 text-left shadow-lg dark:border-slate-700 dark:bg-slate-900" onMouseLeave={() => setMenuFor(null)}>
            {items.map((item) => (
              <button key={item.label} type="button" onClick={() => { setMenuFor(null); item.run(); }} className="!min-h-0 block w-full px-4 py-2 text-left text-[13px] text-gray-800 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800">{item.label}</button>
            ))}
          </div>
        )}
      </td>
    );
  };

  const pager = (count: number, page: number, setPage: (page: number) => void) => (
    <div className="flex items-center gap-3 text-[11px] text-gray-500">
      <span>Rows per page: {PAGE}</span>
      <span>{count === 0 ? "0" : `${page * PAGE + 1}-${Math.min(count, (page + 1) * PAGE)}`} of {count}</span>
      <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="!min-h-0 rounded p-1 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
      <button type="button" disabled={(page + 1) * PAGE >= count} onClick={() => setPage(page + 1)} className="!min-h-0 rounded p-1 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
    </div>
  );

  if (!data && loading) return <p className="m-0 rounded-2xl bg-white px-5 py-10 text-center text-[13px] text-gray-500 dark:bg-slate-900">Loading the week's money…</p>;
  if (data && !data.manager) {
    return (
      <div className="m-0 rounded-2xl bg-white px-5 py-8 text-center text-[13px] text-gray-600 dark:bg-slate-900 dark:text-slate-300">
        <p className="m-0 font-bold text-gray-900 dark:text-slate-100">No manager in this branch to hold the wallet.</p>
        <p className="m-0 mt-1">The wallet belongs to the branch's Manager, or its Admin when there is no Manager. Add one in User Management, then they log money from Weekly Reports → Funds &amp; Expenses with Log Income, Log Expense or Log Remittance.</p>
      </div>
    );
  }

  const variance = totals?.variance ?? null;
  const actualValue = actualDraft ?? (week?.actualClosing !== null && week?.actualClosing !== undefined ? String(week.actualClosing) : "");
  const explanationValue = explanationDraft ?? week?.varianceExplanation ?? "";

  return (
    <div className="space-y-5">
      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold text-rose-700">{error}</p>}

      {(mode === "owner" && (data?.managers?.length ?? 0) > 1) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-gray-600">Wallet:</span>
          {data!.managers.map((manager) => (
            <button key={manager.id} type="button" onClick={() => onSelectManager?.(manager.id)}
              className={`!min-h-0 rounded-lg px-3 py-1.5 text-[12px] font-bold ${manager.id === data!.manager?.id ? "bg-[#1F6FEB] text-white" : "bg-white text-gray-700 ring-1 ring-gray-200"}`}>{manager.name}</button>
          ))}
        </div>
      )}

      {/* ── Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <FundCard icon={ArrowDownLeft} tone="green" label="Funds Received (Cash + Transfer)" value={`${sym}${nf(totals?.received ?? 0)}`} sub={`From ${totals?.counts.in ?? 0} transaction${totals?.counts.in === 1 ? "" : "s"}`} />
        <FundCard icon={Receipt} tone="blue" label="Total Expenses" value={`${sym}${nf(totals?.spent ?? 0)}`} sub={`From ${totals?.counts.expense ?? 0} transaction${totals?.counts.expense === 1 ? "" : "s"}`} />
        <FundCard icon={ArrowUpRight} tone="purple" label="Remitted to Company" value={`${sym}${nf(totals?.remitted ?? 0)}`} sub="Not an expense: still company money" />
        <FundCard icon={ClipboardList} tone="orange" label="Pending Items" value={String(totals?.pending ?? 0)} sub={(totals?.pending ?? 0) === 0 ? "Nothing waiting" : "Need an explanation or a correction"} />
      </div>

      {/* ── Reconciliation ─────────────────────────────────────── */}
      <Panel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 flex items-center gap-2 text-[15px] font-bold text-gray-900 dark:text-slate-50"><Wallet className="h-5 w-5 text-[#1F8FE0]" /> {data?.manager?.name}'s Wallet — Week Reconciliation</h2>
          <span className="text-[12px] text-gray-500">{week?.openingSource === "carried" ? "Opening carried from last week's counted balance" : "First week: opening starts at 0"}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
          {([
            ["Opening", totals?.opening ?? 0, ""],
            ["+ Received", totals?.received ?? 0, "text-emerald-700"],
            ["− Spent", totals?.spent ?? 0, "text-rose-600"],
            ["− Remitted", totals?.remitted ?? 0, "text-violet-700"],
            ["= Expected Balance", totals?.expected ?? 0, "font-black"]
          ] as const).map(([label, value, tone]) => (
            <div key={label} className="rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-slate-800">
              <p className="m-0 text-[11px] text-gray-500">{label}</p>
              <p className={`m-0 mt-0.5 text-[16px] font-bold text-gray-900 dark:text-slate-100 ${tone}`}>{sym}{nf(value)}</p>
            </div>
          ))}
          <label className="rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2 dark:border-blue-500/30 dark:bg-blue-500/10">
            <span className="block text-[11px] font-semibold text-blue-800 dark:text-blue-200">Actual balance held</span>
            {mode === "manager" && canWrite ? (
              <input inputMode="decimal" value={actualValue} onChange={(event) => setActualDraft(event.target.value)}
                onBlur={() => {
                  if (actualDraft === null) return;
                  const value = actualDraft.trim() === "" ? null : Number(actualDraft.replace(/[^0-9.]/g, ""));
                  void onSaveWeek({ actualClosing: value }).finally(() => setActualDraft(null));
                }}
                placeholder="Count it" className="mt-0.5 w-full border-0 bg-transparent p-0 text-[16px] font-bold text-gray-900 outline-none dark:text-slate-100" />
            ) : (
              <span className="block text-[16px] font-bold text-gray-900 dark:text-slate-100">{totals?.actual === null || totals?.actual === undefined ? "Not counted" : `${sym}${nf(totals.actual)}`}</span>
            )}
          </label>
          <div className={`rounded-xl px-3 py-2.5 ${variance === null ? "bg-gray-50 dark:bg-slate-800" : Math.abs(variance) < 0.01 ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-rose-50 dark:bg-rose-500/10"}`}>
            <p className="m-0 text-[11px] text-gray-500">Variance (actual − expected)</p>
            <p className={`m-0 mt-0.5 flex items-center gap-1 text-[16px] font-black ${variance === null ? "text-gray-400" : Math.abs(variance) < 0.01 ? "text-emerald-700" : "text-rose-600"}`}>
              {variance === null ? "—" : Math.abs(variance) < 0.01 ? <><CheckCircle2 className="h-4 w-4" />{sym}0</> : <><AlertTriangle className="h-4 w-4" />{variance < 0 ? "−" : "+"}{sym}{nf(Math.abs(variance))}</>}
            </p>
          </div>
        </div>
        {variance !== null && Math.abs(variance) >= 0.01 && (
          <div className="mt-3">
            {mode === "manager" && canWrite ? (
              <textarea rows={2} value={explanationValue} onChange={(event) => setExplanationDraft(event.target.value)}
                onBlur={() => { if (explanationDraft !== null) void onSaveWeek({ varianceExplanation: explanationDraft.trim() || null }).finally(() => setExplanationDraft(null)); }}
                placeholder="Explain the difference (required before you can submit)" className={`${field} resize-none`} />
            ) : (
              <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">Explanation: {week?.varianceExplanation || <em>none given yet</em>}</p>
            )}
          </div>
        )}
        {(totals?.otherIn ?? 0) > 0 && (
          <p className="m-0 mt-3 text-[12px] font-semibold text-amber-700">Includes {sym}{nf(totals!.otherIn)} of "Other Money In" — not sales income, and not shown in Cash Flow.</p>
        )}
        {mode === "manager" && data?.readiness && data.readiness.length > 0 && (
          <ul className="m-0 mt-3 list-none space-y-1 p-0">
            {data.readiness.map((item) => <li key={item} className="flex items-center gap-1.5 text-[12px] font-semibold text-rose-600"><AlertTriangle className="h-3.5 w-3.5" />{item}</li>)}
          </ul>
        )}
        {!data?.editable && data?.editableReason && <p className="m-0 mt-3 flex items-center gap-1.5 text-[12px] text-gray-500"><Lock className="h-3.5 w-3.5" />{data.editableReason}</p>}
      </Panel>

      {/* ── Income + Expenses ──────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel>
          <div className="flex items-start justify-between gap-3 px-5 pt-4">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white"><Banknote className="h-5 w-5" /></span>
              <div><h2 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Income Received</h2><p className="m-0 text-[12px] text-gray-500">All cash and transfers received by the manager for the week.</p></div>
            </div>
            {mode === "manager" && canWrite && <button type="button" onClick={() => startLog("customer_payment")} className="!min-h-0 inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-emerald-700"><Plus className="h-4 w-4" /> Log Income</button>}
          </div>
          <div className="flex flex-wrap gap-2 px-5 pt-3">
            <label className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-xl border border-gray-200 px-3 dark:border-slate-700"><Search className="h-4 w-4 text-gray-400" /><input value={inSearch} onChange={(event) => { setInSearch(event.target.value); setInPage(0); }} placeholder="Search reference, order or note..." className="w-full border-0 bg-transparent text-[12px] outline-none dark:text-slate-100" /></label>
            <select value={inSource} onChange={(event) => { setInSource(event.target.value); setInPage(0); }} style={{ width: "auto" }} className="!h-9 !w-auto rounded-xl border border-gray-200 bg-white px-2 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><option value="">All Sources</option>{IN_KINDS.map((kind) => <option key={kind.key} value={kind.key}>{kind.label}</option>)}</select>
            <select value={inMethod} onChange={(event) => { setInMethod(event.target.value); setInPage(0); }} style={{ width: "auto" }} className="!h-9 !w-auto rounded-xl border border-gray-200 bg-white px-2 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><option value="">All Types</option>{PAYMENT_METHODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          </div>
          <div className="overflow-x-auto px-3 pb-2 pt-3">
            <table className="w-full !min-w-0 text-left text-[11px]">
              <thead className="text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]"><tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
                {["#", "Date & Time", "Source", "Reference", `Amount (${sym})`, "Payment Type", "Purpose / Note", "Added By", "Status", ""].map((h) => <th key={h} className={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filteredIn.slice(inPage * PAGE, inPage * PAGE + PAGE).map((txn, index) => (
                  <tr key={txn.id} className={`border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit] ${txn.status === "voided" ? "opacity-50" : ""}`}>
                    <td className={td}>{inPage * PAGE + index + 1}</td>
                    <td className={td}>{dateTimeText(txn.occurredAt).replace(/ \d{4},/, "")}</td>
                    <td className={td}>{txn.kindLabel}</td>
                    <td className={`${td} font-semibold`}>{txn.orderIds[0] ? `#${txn.orderIds[0]}` : txn.reference || "-"}</td>
                    <td className={`${td} font-semibold`}>{nf(txn.amount)}</td>
                    <td className={td}><MethodPill method={txn.paymentMethod} /></td>
                    <td className={`${td} max-w-[160px]`}>{txn.kind === "owner_funding" || txn.kind === "company_transfer_in" ? `From ${accountName(txn.counterpartyAccountId)}${txn.description ? ` · ${txn.description}` : ""}` : txn.description || "-"}{txn.evidence.length > 0 && <Paperclip className="ml-1 inline h-3 w-3 text-gray-400" />}</td>
                    <td className={td}>{txn.createdByName ?? "-"}</td>
                    <td className={td}><StatusPill txn={txn} locked={locked} /></td>
                    {actionCell(txn)}
                  </tr>
                ))}
                {filteredIn.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-500">No money received logged this week.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 dark:border-slate-800">
            <span className="text-[13px] font-bold text-gray-900 dark:text-slate-100">Total Income <span className="ml-6">{sym}{nf(totals?.received ?? 0)}</span></span>
            {pager(filteredIn.length, inPage, setInPage)}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-start justify-between gap-3 px-5 pt-4">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500 text-white"><FileText className="h-5 w-5" /></span>
              <div><h2 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Expenses</h2><p className="m-0 text-[12px] text-gray-500">All expenses paid this week (ads, logistics, airtime, office, etc).</p></div>
            </div>
            {mode === "manager" && canWrite && <button type="button" onClick={() => startLog("expense")} className="!min-h-0 inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-rose-500 px-4 py-2 text-[13px] font-bold text-white hover:bg-rose-600"><Plus className="h-4 w-4" /> Log Expense</button>}
          </div>
          <div className="flex flex-wrap gap-2 px-5 pt-3">
            <label className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-xl border border-gray-200 px-3 dark:border-slate-700"><Search className="h-4 w-4 text-gray-400" /><input value={exSearch} onChange={(event) => { setExSearch(event.target.value); setExPage(0); }} placeholder="Search expense, purpose or reference..." className="w-full border-0 bg-transparent text-[12px] outline-none dark:text-slate-100" /></label>
            <select value={exCategory} onChange={(event) => { setExCategory(event.target.value); setExPage(0); }} style={{ width: "auto" }} className="!h-9 !w-auto rounded-xl border border-gray-200 bg-white px-2 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><option value="">All Categories</option>{categories.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}</select>
            <select value={exMethod} onChange={(event) => { setExMethod(event.target.value); setExPage(0); }} style={{ width: "auto" }} className="!h-9 !w-auto rounded-xl border border-gray-200 bg-white px-2 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><option value="">All Payment Types</option>{PAYMENT_METHODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          </div>
          <div className="overflow-x-auto px-3 pb-2 pt-3">
            <table className="w-full !min-w-0 text-left text-[11px]">
              <thead className="text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]"><tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
                {["#", "Date & Time", "Category", "Description", `Amount (${sym})`, "Payment Type", "Added By", "Status", ""].map((h) => <th key={h} className={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filteredEx.slice(exPage * PAGE, exPage * PAGE + PAGE).map((txn, index) => (
                  <tr key={txn.id} className={`border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit] ${txn.status === "voided" ? "opacity-50" : ""}`}>
                    <td className={td}>{exPage * PAGE + index + 1}</td>
                    <td className={td}>{dateTimeText(txn.occurredAt).replace(/ \d{4},/, "")}</td>
                    <td className={td}>{txn.categoryLabel}</td>
                    <td className={`${td} max-w-[180px]`}>{txn.description || "-"}{txn.paidTo ? ` (${txn.paidTo})` : ""}{txn.orderIds.length > 0 && <span className="block text-[11px] text-gray-500">Orders {txn.orderIds.map((id) => `#${id}`).join(", ")}</span>}{(txn.countedOnOrders ?? 0) > 0 && <span className="block text-[11px] font-semibold text-blue-700">{sym}{nf(txn.countedOnOrders ?? 0)} already on the orders · {sym}{nf(Math.max(0, txn.amount - (txn.countedOnOrders ?? 0)))} new cost</span>}{txn.evidence.length > 0 && <Paperclip className="ml-1 inline h-3 w-3 text-gray-400" />}</td>
                    <td className={`${td} font-semibold`}>{nf(txn.amount)}</td>
                    <td className={td}><MethodPill method={txn.paymentMethod} /></td>
                    <td className={td}>{txn.createdByName ?? "-"}</td>
                    <td className={td}><StatusPill txn={txn} locked={locked} /></td>
                    {actionCell(txn)}
                  </tr>
                ))}
                {filteredEx.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">No expenses logged this week.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 dark:border-slate-800">
            <span className="text-[13px] font-bold text-gray-900 dark:text-slate-100">Total Expenses <span className="ml-6">{sym}{nf(totals?.spent ?? 0)}</span></span>
            {pager(filteredEx.length, exPage, setExPage)}
          </div>
        </Panel>
      </div>

      {removedCount > 0 && (
        <div className="-mt-2 text-right">
          <button type="button" onClick={() => setShowRemoved(!showRemoved)} className="!min-h-0 text-[12px] font-semibold text-gray-500 hover:text-gray-800 hover:underline">
            {showRemoved ? "Hide removed entries" : `Show removed entries (${removedCount})`}
          </button>
        </div>
      )}

      {/* ── Remitted to Company (Bright's notes: never an expense) ── */}
      <Panel>
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white"><ArrowUpRight className="h-5 w-5" /></span>
            <div><h2 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Remitted to Company</h2><p className="m-0 text-[12px] text-gray-500">Money sent back to a company account. Not an expense: it leaves her wallet but stays company money.</p></div>
          </div>
          {mode === "manager" && canWrite && <button type="button" onClick={() => startLog("remittance_out")} className="!min-h-0 inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-violet-700"><Plus className="h-4 w-4" /> Log Remittance</button>}
        </div>
        <div className="overflow-x-auto px-3 pb-3 pt-3">
          <table className="w-full !min-w-[640px] text-left text-[12px]">
            <thead className="text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]"><tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
              {["#", "Date & Time", "To Account", "Reference", `Amount (${sym})`, "Payment Type", "Added By", "Status", ""].map((h) => <th key={h} className={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {remittances.filter((txn) => showRemoved || txn.status !== "voided").map((txn, index) => (
                <tr key={txn.id} className={`border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit] ${txn.status === "voided" ? "opacity-50" : ""}`}>
                  <td className={td}>{index + 1}</td>
                  <td className={td}>{dateTimeText(txn.occurredAt).replace(/ \d{4},/, "")}</td>
                  <td className={td}>{accountName(txn.counterpartyAccountId)}</td>
                  <td className={`${td} font-semibold`}>{txn.reference || "-"}{txn.evidence.length > 0 && <Paperclip className="ml-1 inline h-3 w-3 text-gray-400" />}</td>
                  <td className={`${td} font-semibold`}>{nf(txn.amount)}</td>
                  <td className={td}><MethodPill method={txn.paymentMethod} /></td>
                  <td className={td}>{txn.createdByName ?? "-"}</td>
                  <td className={td}><StatusPill txn={txn} locked={locked} /></td>
                  {actionCell(txn)}
                </tr>
              ))}
              {remittances.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">Nothing remitted this week.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── Trend · Breakdown · Summary ────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
        <Panel>
          <div className="px-5 pt-4"><h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">Income vs Expenses Trend</h2><p className="m-0 text-[12px] text-gray-500">Daily money in and expenses for the week.</p></div>
          <div className="flex gap-4 px-5 pt-3 text-[12px] text-gray-600"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Income</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />Expenses</span></div>
          <div className="h-[220px] px-3 pb-4 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={(data?.daily ?? []).map((day) => ({ label: shortDay(day.date), income: day.moneyIn, expenses: day.expenses }))} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={(value) => `${sym}${value >= 1000 ? `${Math.round(value / 1000)}k` : value}`} />
                <Tooltip formatter={(value: any) => `${sym}${nf(Number(value))}`} />
                <Bar dataKey="income" name="Income" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Bar dataKey="expenses" name="Expenses" fill="#f43f5e" radius={[3, 3, 0, 0]} maxBarSize={22} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel>
          <div className="flex items-start justify-between px-5 pt-4">
            <div><h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">Expense Breakdown</h2><p className="m-0 text-[12px] text-gray-500">Total expenses by category.</p></div>
            <select value={donutMode} onChange={(event) => setDonutMode(event.target.value as "amount" | "count")} style={{ width: "auto" }} className="!h-9 !w-auto rounded-lg border border-gray-200 bg-white px-2 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><option value="amount">Amount</option><option value="count">Count</option></select>
          </div>
          <div className="flex flex-col items-center gap-3 px-5 pb-4 pt-2 sm:flex-row">
            <div className="relative h-[160px] w-[160px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={categorySummary.length ? categorySummary.map((row) => ({ name: row.label, value: donutMode === "amount" ? row.amount : row.count })) : [{ name: "None", value: 1 }]} dataKey="value" innerRadius={48} outerRadius={74} stroke="none">
                  {(categorySummary.length ? categorySummary : [{ key: "none" }]).map((_, index) => <Cell key={index} fill={categorySummary.length ? CATEGORY_COLORS[index % CATEGORY_COLORS.length] : "#e5e7eb"} />)}
                </Pie></PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-[17px] font-black text-gray-900 dark:text-slate-50">{sym}{nf(totals?.spent ?? 0)}</span><span className="text-[10px] text-gray-500">Total Expenses</span></div>
            </div>
            <ul className="m-0 w-full list-none space-y-1.5 p-0 text-[12px]">
              {categorySummary.map((row, index) => (
                <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-gray-700 dark:text-slate-300"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }} /><span className="truncate">{row.label}</span></span>
                  <span className="text-gray-500">{totals?.spent ? Math.round((row.amount / totals.spent) * 100) : 0}%</span>
                  <span className="w-20 text-right font-semibold text-gray-900 dark:text-slate-100">{sym}{nf(row.amount)}</span>
                </li>
              ))}
              {categorySummary.length === 0 && <li className="text-gray-500">No expenses yet.</li>}
            </ul>
          </div>
        </Panel>
        <Panel>
          <div className="px-5 pt-4"><h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">Weekly Expense Summary</h2></div>
          <div className="px-5 pb-4 pt-3">
            {categorySummary.map((row) => (
              <div key={row.key} className="flex justify-between border-b border-gray-100 py-1.5 text-[12px] text-gray-800 dark:border-slate-800 dark:text-slate-200"><span>{row.label} ({row.count})</span><span className="font-semibold">{sym}{nf(row.amount)}</span></div>
            ))}
            <div className="mt-2 flex justify-between rounded-lg bg-rose-50 px-3 py-2.5 text-[13px] font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-200"><span>Total Expenses</span><span className="text-[16px]">{sym}{nf(totals?.spent ?? 0)}</span></div>
          </div>
        </Panel>
      </div>

      {/* ── Adjustment requests ─────────────────────────────────── */}
      {(data?.adjustments?.length ?? 0) > 0 && (
        <Panel className="p-5">
          <h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">Adjustment Requests</h2>
          <p className="m-0 mt-0.5 text-[12px] text-gray-500">Changes to entries in a locked week. The owner decides; both amounts are kept.</p>
          <ul className="m-0 mt-3 list-none space-y-2 p-0">
            {data!.adjustments!.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 p-3 text-[12px] dark:border-slate-800">
                <span className="text-gray-800 dark:text-slate-200">{sym}{nf(item.originalAmount)} → <strong>{sym}{nf(item.requestedAmount)}</strong> · "{item.reason}" <span className="text-gray-500">· {dateTimeText(item.createdAt)}</span>{item.decisionNote ? <span className="block text-gray-500">Owner: "{item.decisionNote}"</span> : null}</span>
                {item.status === "pending" && mode === "owner" && onDecideAdjustment ? (
                  <span className="flex gap-2">
                    <button type="button" onClick={() => void onDecideAdjustment(item.id, false)} className="!min-h-0 rounded-lg border border-rose-200 px-3 py-1.5 font-bold text-rose-700">Reject</button>
                    <button type="button" onClick={() => void onDecideAdjustment(item.id, true)} className="!min-h-0 rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white">Approve</button>
                  </span>
                ) : (
                  <span className={`rounded-md px-2 py-0.5 font-bold ${item.status === "pending" ? "bg-amber-50 text-amber-700" : item.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{item.status === "pending" ? "Waiting for owner" : item.status === "approved" ? "Approved" : "Rejected"}</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {mode === "owner" && onSaveSettings && data?.settings && (
        <div className="text-right">
          <button type="button" onClick={() => setSettingsOpen(true)} className="!min-h-0 text-[12px] font-semibold text-[#1F8FE0] hover:underline">Proof rules: {data.settings.expenseProofMin > 0 || data.settings.remittanceProofRequired || data.settings.otherInProofRequired || data.settings.ownerFundingReferenceRequired ? "some receipts required" : "receipts optional"} · change</button>
        </div>
      )}

      {footer}

      {/* ── Log / edit form ───────────────────────────────────── */}
      {draft && (
        <Modal
          title={editing && !draft.amount ? "Add proof" : editing ? `Edit ${editing.kindLabel}` : draft.kind === "expense" ? "Log Expense" : draft.kind === "remittance_out" ? "Log Remittance to Company" : "Log Income"}
          subtitle={editing && !draft.amount ? "Upload a photo or PDF of the receipt or transfer." : "Protohub does the maths. Log it as soon as the money moves."}
          onClose={() => { setDraft(null); setEditing(null); }}
        >
          <div className="space-y-3 px-6 py-5">
            {!(editing && !draft.amount) && (
              <>
                {!editing && draft.kind !== "expense" && draft.kind !== "remittance_out" && (
                  <div className="grid grid-cols-2 gap-2">
                    {IN_KINDS.map((kind) => (
                      <button key={kind.key} type="button" onClick={() => setDraft({ ...draft, kind: kind.key })} title={kind.hint}
                        className={`!min-h-0 rounded-xl border px-3 py-2 text-left text-[12px] font-bold ${draft.kind === kind.key ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-gray-200 text-gray-600 dark:border-slate-700 dark:text-slate-300"}`}>
                        {kind.label}
                      </button>
                    ))}
                    <p className="col-span-2 m-0 text-[11px] text-gray-500">{IN_KINDS.find((kind) => kind.key === draft.kind)?.hint}</p>
                  </div>
                )}
                {draft.kind === "expense" && (
                  <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Category</span>
                    <select className={field} value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
                      {categories.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}
                    </select>
                  </label>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Amount ({sym})</span>
                    <input className={field} inputMode="decimal" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="e.g. 6500" /></label>
                  <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Date & time</span>
                    <input className={field} type="datetime-local" value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} /></label>
                </div>
                {draft.kind === "customer_payment" && (
                  <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Order number</span>
                    <input className={field} value={draft.orderId} disabled={!!editing} onChange={(event) => setDraft({ ...draft, orderId: event.target.value })} placeholder="e.g. 4358" />
                    <span className="mt-1 block text-[11px] text-gray-500">The order is marked paid. A part or extra payment must be recorded by an Admin or the Owner.</span></label>
                )}
                {draft.kind === "customer_payment" && !editing && (
                  <OrderMoneyCheck kind={draft.kind} category="" amount={draft.amount} orderText={draft.orderId} sym={sym} nf={nf}
                    onUseAmount={(value) => setDraft({ ...draft, amount: String(value) })} />
                )}
                {["owner_funding", "company_transfer_in", "remittance_out"].includes(draft.kind) && (
                  <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">{draft.kind === "remittance_out" ? "Sent to account" : "From account"}</span>
                    <select className={field} value={draft.counterpartyAccountId} onChange={(event) => setDraft({ ...draft, counterpartyAccountId: event.target.value })}>
                      <option value="">Choose the company account</option>
                      {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                    </select></label>
                )}
                <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">{draft.kind === "expense" ? "Description" : draft.kind === "other_in" ? "Explanation (required)" : "Purpose / note"}</span>
                  <input className={field} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder={draft.kind === "expense" ? "e.g. Rider delivery payment" : draft.kind === "other_in" ? "e.g. Refund from packaging supplier for damaged boxes" : "e.g. Weekly operating expenses"} /></label>
                {draft.kind === "expense" && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Paid to</span>
                      <input className={field} value={draft.paidTo} onChange={(event) => setDraft({ ...draft, paidTo: event.target.value })} placeholder="e.g. DashGo Logistics" /></label>
                    <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Related order(s)</span>
                      <input className={field} value={draft.relatedOrders} onChange={(event) => setDraft({ ...draft, relatedOrders: event.target.value })} placeholder="e.g. 4358, 4362" /></label>
                  </div>
                )}
                {draft.kind === "expense" && (
                  <OrderMoneyCheck kind={draft.kind} category={draft.category} amount={draft.amount} orderText={draft.relatedOrders} excludeTxnId={editing?.id} sym={sym} nf={nf}
                    onUseAmount={() => undefined} />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Payment method</span>
                    <select className={field} value={draft.paymentMethod} onChange={(event) => setDraft({ ...draft, paymentMethod: event.target.value })}>
                      {PAYMENT_METHODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select></label>
                  <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Reference</span>
                    <input className={field} value={draft.reference} onChange={(event) => setDraft({ ...draft, reference: event.target.value })} placeholder="e.g. TRF-20260916" /></label>
                </div>
              </>
            )}
            <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Receipt / proof (photo or PDF, up to 10MB)</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => setDraft({ ...draft, file: event.target.files?.[0] ?? null })} className="block w-full text-[12px]" />
              {data?.settings && !(editing && !draft.amount) && (
                <span className="mt-1 block text-[11px] text-gray-500">
                  {(() => {
                    const rules = data.settings;
                    const required = draft.kind === "expense" ? rules.expenseProofMin > 0 && Number(draft.amount.replace(/[^0-9.]/g, "")) >= rules.expenseProofMin
                      : draft.kind === "remittance_out" ? rules.remittanceProofRequired
                      : draft.kind === "other_in" ? rules.otherInProofRequired
                      : draft.kind === "owner_funding" ? rules.ownerFundingReferenceRequired : false;
                    return required
                      ? "Required for this entry. You can add it later, but the week can't go to the owner without it."
                      : "Optional — attach it if you have it.";
                  })()}
                </span>
              )}</label>
            {formError && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{formError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => { setDraft(null); setEditing(null); }} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-700 dark:border-slate-700 dark:text-slate-200">Cancel</button>
              <button type="button" disabled={saving} onClick={async () => {
                if (editing && !draft.amount) {
                  if (!draft.file) { setFormError("Choose a file."); return; }
                  setSaving(true);
                  try { await onUpload(editing.id, draft.file); setDraft(null); setEditing(null); } catch (err: any) { setFormError(err?.message ?? "Could not upload."); } finally { setSaving(false); }
                  return;
                }
                await saveDraft();
              }} className="!min-h-0 rounded-xl bg-[#1F6FEB] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">{saving ? "Saving…" : editing ? "Save" : "Log it"}</button>
            </div>
          </div>
        </Modal>
      )}

      {voiding && (
        <Modal title={`Remove this ${voiding.kindLabel.toLowerCase()}?`} subtitle={`${sym}${nf(voiding.amount)}. It stays in the audit trail, marked removed.${voiding.kind === "customer_payment" ? " The payment is taken off the order too." : ""}`} onClose={() => setVoiding(null)}>
          <div className="space-y-3 px-6 py-5">
            <input className={field} value={textInput} onChange={(event) => setTextInput(event.target.value)} placeholder="Why? e.g. Entered twice" />
            {formError && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{formError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setVoiding(null)} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold dark:border-slate-700 dark:text-slate-200">Cancel</button>
              <button type="button" disabled={textInput.trim().length < 3 || saving} onClick={async () => {
                setSaving(true); setFormError("");
                try { await onVoid(voiding.id, textInput.trim()); setVoiding(null); } catch (err: any) { setFormError(err?.message ?? "Could not remove."); } finally { setSaving(false); }
              }} className="!min-h-0 rounded-xl bg-rose-600 px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40">Remove</button>
            </div>
          </div>
        </Modal>
      )}

      {adjusting && (
        <Modal title="Request an adjustment" subtitle={`This week is locked. The owner decides; both amounts are kept. Currently ${sym}${nf(adjusting.amount)}.`} onClose={() => setAdjusting(null)}>
          <div className="space-y-3 px-6 py-5">
            <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Correct amount ({sym})</span>
              <input className={field} inputMode="decimal" value={amountInput} onChange={(event) => setAmountInput(event.target.value)} /></label>
            <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Reason</span>
              <textarea className={`${field} resize-none`} rows={3} value={textInput} onChange={(event) => setTextInput(event.target.value)} placeholder="e.g. Wrong rider amount entered; receipt shows 7,500" /></label>
            {formError && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{formError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAdjusting(null)} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold dark:border-slate-700 dark:text-slate-200">Cancel</button>
              <button type="button" disabled={textInput.trim().length < 5 || saving} onClick={async () => {
                setSaving(true); setFormError("");
                try { await onRequestAdjustment({ transactionId: adjusting.id, requestedAmount: Number(amountInput.replace(/[^0-9.]/g, "")), reason: textInput.trim() }); setAdjusting(null); }
                catch (err: any) { setFormError(err?.message ?? "Could not send."); } finally { setSaving(false); }
              }} className="!min-h-0 rounded-xl bg-[#1F6FEB] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40">Send to owner</button>
            </div>
          </div>
        </Modal>
      )}

      {returning && onReturnTransaction && (
        <Modal title="Return to manager" subtitle={`${returning.kindLabel} · ${sym}${nf(returning.amount)} · ${longDate(returning.weekStart)} week. The whole week goes back marked "Correction Required".`} onClose={() => setReturning(null)}>
          <div className="space-y-3 px-6 py-5">
            <textarea className={`${field} resize-none`} rows={3} value={textInput} onChange={(event) => setTextInput(event.target.value)} placeholder="e.g. Upload proof for the 15,000 logistics payment" />
            {formError && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{formError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReturning(null)} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold dark:border-slate-700 dark:text-slate-200">Cancel</button>
              <button type="button" disabled={textInput.trim().length < 3 || saving} onClick={async () => {
                setSaving(true); setFormError("");
                try { await onReturnTransaction(returning, textInput.trim()); setReturning(null); } catch (err: any) { setFormError(err?.message ?? "Could not return."); } finally { setSaving(false); }
              }} className="!min-h-0 rounded-xl bg-rose-600 px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40">Return to Manager</button>
            </div>
          </div>
        </Modal>
      )}

      {settingsOpen && onSaveSettings && data?.settings && (
        <SettingsModal settings={data.settings} sym={sym} onClose={() => setSettingsOpen(false)} onSave={async (body) => { await onSaveSettings(body); setSettingsOpen(false); }} />
      )}
    </div>
  );
}

function SettingsModal({ settings, sym, onClose, onSave }: {
  settings: NonNullable<ManagerFundWeek["settings"]>;
  sym: string;
  onClose: () => void;
  onSave: (body: NonNullable<ManagerFundWeek["settings"]>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [min, setMin] = useState(String(settings.expenseProofMin));
  const [saving, setSaving] = useState(false);
  const toggle = (key: "remittanceProofRequired" | "ownerFundingReferenceRequired" | "otherInProofRequired", label: string) => (
    <label className="flex items-center gap-2 text-[13px] text-gray-800 dark:text-slate-200">
      <input type="checkbox" checked={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} />{label}
    </label>
  );
  return (
    <Modal title="Proof rules" subtitle="What the manager must attach before the week can come to you." onClose={onClose}>
      <div className="space-y-3 px-6 py-5">
        <label className="block"><span className="mb-1 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Receipt required for expenses from ({sym}) — 0 = never required</span>
          <input inputMode="decimal" value={min} onChange={(event) => setMin(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /></label>
        {toggle("remittanceProofRequired", "Every remittance needs transfer proof")}
        {toggle("ownerFundingReferenceRequired", "Owner funding needs a reference or proof")}
        {toggle("otherInProofRequired", "Other money in needs proof")}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold dark:border-slate-700 dark:text-slate-200">Cancel</button>
          <button type="button" disabled={saving} onClick={async () => { setSaving(true); try { await onSave({ ...draft, expenseProofMin: Number(min.replace(/[^0-9.]/g, "")) || 0 }); } finally { setSaving(false); } }} className="!min-h-0 rounded-xl bg-[#1F6FEB] px-4 py-2 text-[13px] font-bold text-white">Save</button>
        </div>
      </div>
    </Modal>
  );
}
