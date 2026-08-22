import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarDays, Check,
  CheckCircle2, ClipboardList, Download, FileText, Info, Landmark, Lightbulb, Plus,
  RotateCcw, Search, Trash2, X
} from "lucide-react";
import type {
  AccountReconciliationRow, AccountReconciliationsView, ReconAdjustment,
  ReconBookItem, ReconciliationWorkspace
} from "../lib/api";
import { AccountMark } from "./BankAccountsTab";

// Reconciling ONE account against its bank statement.
//
// ⚠️ difference = STATEMENT − BOOKS, the same convention as Weekly
// Reconciliation. Negative means the bank holds less than we recorded. The
// supplied design computed this the other way on one screen; carrying both
// would put two opposite meanings on the same minus sign.

const naira = (value: number) => `₦${Math.round(Number(value) || 0).toLocaleString("en-NG")}`;
const signedNaira = (value: number) => {
  const rounded = Math.round(Number(value) || 0);
  if (rounded === 0) return "₦0";
  return `${rounded < 0 ? "−" : "+"}₦${Math.abs(rounded).toLocaleString("en-NG")}`;
};
const dateLabel = (key: string | null) =>
  key ? new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" }) : "—";
const stamp = (iso: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—"
    : date.toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
};
const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

const BAND_COLOR = { matched: "#10B981", small: "#F59E0B", large: "#EF4444" } as const;
const BAND_LABEL = {
  matched: "Matched", small: "Small Variance (≤ ₦50k)", large: "Large Variance (> ₦50k)"
} as const;

const ADJUSTMENT_KINDS = [
  { key: "bank_charge", label: "Bank charge / fee" },
  { key: "interest", label: "Interest credited" },
  { key: "vat", label: "VAT on charges" },
  { key: "transfer", label: "Transfer not recorded" },
  { key: "other", label: "Other" }
] as const;

const FILTERS = ["All Reconciliations", "Reconciled", "In Progress", "Unreconciled"] as const;
type ReconFilter = (typeof FILTERS)[number];

function Modal({ title, subtitle, icon: Icon, width, onClose, children, footer }: {
  title: string; subtitle: string; icon: typeof Info; width: string;
  onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose}
        className="!min-h-0 absolute inset-0 cursor-default bg-slate-900/40 p-0" />
      <div className={`relative flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <h3 className="m-0 text-lg font-black text-gray-900">{title}</h3>
              <p className="m-0 mt-0.5 text-[13px] font-medium text-gray-500">{subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="!min-h-0 rounded-lg bg-transparent p-1 text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">{children}</div>
        <div className="flex flex-wrap justify-end gap-2.5 border-t border-gray-100 px-6 py-4">{footer}</div>
      </div>
    </div>
  );
}

export type AccountReconciliationTabProps = {
  view: AccountReconciliationsView | null;
  loading: boolean;
  error: string;
  saving: boolean;
  workspace: ReconciliationWorkspace | null;
  workspaceLoading: boolean;
  onOpenWorkspace: (accountId: string, statementDate: string) => void;
  onCloseWorkspace: () => void;
  onSave: (body: {
    bankAccountId: string; statementDate: string; statementBalance: number;
    status: "in_progress" | "reconciled"; notes: string;
    matches: Array<{ sourceType: "expense" | "remittance" | "transfer"; sourceId: string }>;
  }) => Promise<void>;
  onAddAdjustment: (id: string, body: {
    occurredOn: string | null; description: string; amount: number;
    direction: "in" | "out"; kind: "bank_charge" | "interest" | "vat" | "transfer" | "other";
  }) => Promise<void>;
  onRemoveAdjustment: (id: string, adjustmentId: string) => Promise<void>;
  onReopen: (id: string) => Promise<void>;
  onExport: () => void;
};

export default function AccountReconciliationTab(props: AccountReconciliationTabProps) {
  const { view, loading, error } = props;
  const [filter, setFilter] = useState<ReconFilter>("All Reconciliations");
  const [starting, setStarting] = useState(false);

  const rows = useMemo(() => {
    const all = view?.reconciliations ?? [];
    if (filter === "Reconciled") return all.filter((row) => row.status === "reconciled");
    if (filter === "In Progress") return all.filter((row) => row.status === "in_progress" && row.settled);
    if (filter === "Unreconciled") return all.filter((row) => row.status === "in_progress" && !row.settled);
    return all;
  }, [view, filter]);

  const summary = view?.summary;
  const bandSlices = summary
    ? (["matched", "small", "large"] as const)
      .map((key) => ({ key, label: BAND_LABEL[key], ...summary.bands[key] }))
      .filter((slice) => slice.amount > 0)
    : [];

  const cards = [
    { label: "Total Reconciliations", value: String(summary?.total ?? 0), hint: "Across all accounts", icon: ClipboardList, tone: "bg-blue-50 text-blue-600" },
    { label: "Reconciled", value: String(summary?.reconciled ?? 0), hint: `${(summary?.reconciledPct ?? 0).toFixed(2)}%`, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600" },
    { label: "In Progress", value: String(summary?.inProgress ?? 0), hint: `${(summary?.inProgressPct ?? 0).toFixed(2)}%`, icon: Search, tone: "bg-amber-50 text-amber-600" },
    { label: "Unreconciled", value: String(summary?.unreconciled ?? 0), hint: `${(summary?.unreconciledPct ?? 0).toFixed(2)}%`, icon: AlertTriangle, tone: "bg-rose-50 text-rose-600" },
    { label: "Total Variance", value: naira(summary?.totalVariance ?? 0), hint: `Across ${summary?.varianceCount ?? 0} reconciliation${(summary?.varianceCount ?? 0) === 1 ? "" : "s"}`, icon: Landmark, tone: "bg-violet-50 text-violet-600" }
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-2xl font-black text-gray-900">
            Account Reconciliation
            <span title="Does each account agree with its bank statement? A week can balance overall while one account is out by exactly what another is out the other way."
              className="cursor-help text-gray-300 hover:text-gray-500"><Info className="h-4 w-4" /></span>
          </h2>
          <p className="m-0 mt-1 text-sm text-gray-500">Reconcile your bank and cash accounts to ensure accuracy and detect discrepancies.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={props.onExport}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">
            <Download className="h-4 w-4" /> Download Report
          </button>
          <button type="button" onClick={() => setStarting(true)} disabled={(view?.accounts.length ?? 0) === 0}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
            <Plus className="h-4 w-4" /> Start New Reconciliation
          </button>
        </div>
      </div>

      {error && (
        <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.tone}`}>
                <Icon className="h-5 w-5" />
              </span>
              <p className="m-0 mt-2.5 text-[11px] font-black uppercase tracking-wide text-gray-500">{card.label}</p>
              <p className="m-0 mt-0.5 text-xl font-black text-gray-900">{card.value}</p>
              <p className="m-0 mt-0.5 text-[11px] font-semibold text-gray-400">{card.hint}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
            <div className="inline-flex flex-wrap items-center rounded-xl bg-gray-100 p-1">
              {FILTERS.map((entry) => (
                <button key={entry} type="button" onClick={() => setFilter(entry)}
                  className={`!min-h-0 rounded-lg px-3 py-1.5 text-[12px] font-black transition-colors ${filter === entry ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}>
                  {entry}
                </button>
              ))}
            </div>
          </div>

          {loading && !view ? (
            <p className="m-0 px-4 py-10 text-center text-[13px] font-semibold text-gray-500">Loading reconciliations…</p>
          ) : rows.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Landmark className="mx-auto h-8 w-8 text-gray-300" />
              <p className="m-0 mt-2 text-[13px] font-bold text-gray-700">
                {filter === "All Reconciliations" ? "No account has been reconciled yet" : `Nothing ${filter.toLowerCase()}`}
              </p>
              <p className="m-0 mt-1 text-[12px] font-medium text-gray-500">
                Compare an account against its statement to find money that never made it into the books.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[11px] font-black uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2.5">Statement Date</th>
                    <th className="px-4 py-2.5">Account</th>
                    <th className="px-4 py-2.5 text-right">Per Statement (₦)</th>
                    <th className="px-4 py-2.5 text-right">Per Books (₦)</th>
                    <th className="px-4 py-2.5 text-right">Difference (₦)</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Reconciled By</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-3 text-[13px] font-bold text-gray-900">{dateLabel(row.statementDate)}</td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2.5">
                          <AccountMark account={{ accountType: row.accountType, bankName: row.bankName, name: row.accountName }} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold text-gray-900">{row.accountName}</span>
                            <span className="block text-[11px] font-semibold text-gray-400">
                              {row.accountNumberLast4 ? `****${row.accountNumberLast4}` : row.bankName || "Account"}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-[13px] font-semibold text-gray-700">{naira(row.statementBalance)}</td>
                      <td className="px-4 py-3 text-right text-[13px] font-semibold text-gray-700">{naira(row.bookBalance)}</td>
                      <td className={`px-4 py-3 text-right text-[13px] font-black ${row.settled ? "text-emerald-600" : "text-rose-600"}`}>
                        {signedNaira(row.remainingDifference)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-black ${
                          row.status === "reconciled" ? "bg-emerald-50 text-emerald-700"
                            : row.settled ? "bg-blue-50 text-blue-700" : "bg-rose-50 text-rose-700"}`}>
                          {row.status === "reconciled" ? "Reconciled" : row.settled ? "In Progress" : "Not Reconciled"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px] font-semibold text-gray-500">
                        {row.reconciledByName || "—"}
                        {row.reconciledAt && <span className="block text-[11px] text-gray-400">{stamp(row.reconciledAt)}</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex gap-1.5">
                          <button type="button"
                            onClick={() => props.onOpenWorkspace(row.bankAccountId, row.statementDate)}
                            className="!min-h-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] font-bold text-gray-700 hover:bg-gray-50">
                            Open
                          </button>
                          {row.status === "reconciled" && (
                            <button type="button" onClick={() => void props.onReopen(row.id)}
                              className="!min-h-0 inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[12px] font-bold text-amber-700 hover:bg-amber-50">
                              <RotateCcw className="h-3 w-3" /> Reopen
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-gray-200 bg-white">
            <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
              Variance Summary
            </h3>
            <div className="px-5 py-4">
              {bandSlices.length === 0 ? (
                <p className="m-0 inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> Every reconciliation balances.
                </p>
              ) : (
                <>
                  <div className="relative h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={bandSlices} dataKey="amount" nameKey="label"
                          innerRadius={48} outerRadius={68} paddingAngle={2} stroke="none">
                          {bandSlices.map((slice) => <Cell key={slice.key} fill={BAND_COLOR[slice.key]} />)}
                        </Pie>
                        <Tooltip formatter={(value: number) => naira(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-base font-black text-gray-900">{naira(summary?.totalVariance ?? 0)}</span>
                      <span className="text-[11px] font-semibold text-gray-400">Outstanding</span>
                    </span>
                  </div>
                  <ul className="m-0 mt-3 list-none space-y-2 p-0">
                    {bandSlices.map((slice) => (
                      <li key={slice.key} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: BAND_COLOR[slice.key] }} />
                          <span className="truncate text-[12px] font-semibold text-gray-600">{slice.label}</span>
                        </span>
                        <span className="shrink-0 text-[12px] font-black text-gray-900">
                          {naira(slice.amount)} <span className="font-semibold text-gray-400">({slice.sharePct.toFixed(2)}%)</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white">
            <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
              Top Variances
            </h3>
            <ul className="m-0 list-none space-y-2.5 p-0 px-5 py-4">
              {(view?.reconciliations ?? [])
                .filter((row) => !row.settled)
                .sort((left, right) => Math.abs(right.remainingDifference) - Math.abs(left.remainingDifference))
                .slice(0, 5)
                .map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-bold text-gray-900">{row.accountName}</span>
                      <span className="block text-[11px] font-semibold text-gray-400">{dateLabel(row.statementDate)}</span>
                    </span>
                    <span className="shrink-0 text-[12px] font-black text-rose-600">{signedNaira(row.remainingDifference)}</span>
                  </li>
                ))}
              {(view?.reconciliations ?? []).filter((row) => !row.settled).length === 0 && (
                <li className="text-[12px] font-semibold text-gray-500">Nothing outstanding.</li>
              )}
            </ul>
          </section>
        </aside>
      </div>

      <p className="m-0 flex gap-2 rounded-xl bg-gray-50 px-3.5 py-3 text-[12px] font-semibold text-gray-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Difference is <strong className="font-black">bank statement minus books</strong> — negative means the bank holds
        less than we recorded. An account cannot be marked reconciled while anything is still unexplained.
      </p>

      {starting && view && (
        <StartModal accounts={view.accounts}
          onClose={() => setStarting(false)}
          onStart={(accountId, statementDate) => {
            setStarting(false);
            props.onOpenWorkspace(accountId, statementDate);
          }} />
      )}

      {(props.workspace || props.workspaceLoading) && (
        <WorkspaceModal
          workspace={props.workspace} loading={props.workspaceLoading} saving={props.saving}
          onClose={props.onCloseWorkspace}
          onSave={props.onSave}
          onAddAdjustment={props.onAddAdjustment}
          onRemoveAdjustment={props.onRemoveAdjustment}
        />
      )}
    </div>
  );
}

function StartModal({ accounts, onClose, onStart }: {
  accounts: AccountReconciliationsView["accounts"];
  onClose: () => void;
  onStart: (accountId: string, statementDate: string) => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [statementDate, setStatementDate] = useState(todayKey());

  return (
    <Modal title="Start New Reconciliation" subtitle="Pick the account and the statement date you are working from."
      icon={Plus} width="max-w-md" onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}
            className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" disabled={!accountId} onClick={() => onStart(accountId, statementDate)}
            className="!min-h-0 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
            Open Reconciliation
          </button>
        </>
      }
    >
      <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
        Select Account
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)}
          className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-bold text-gray-900">
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}{account.accountNumberLast4 ? ` ····${account.accountNumberLast4}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
        Statement Date
        <input type="date" value={statementDate} max={todayKey()}
          onChange={(event) => setStatementDate(event.target.value)}
          className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-bold text-gray-900" />
      </label>
    </Modal>
  );
}

function WorkspaceModal({ workspace, loading, saving, onClose, onSave, onAddAdjustment, onRemoveAdjustment }: {
  workspace: ReconciliationWorkspace | null;
  loading: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: AccountReconciliationTabProps["onSave"];
  onAddAdjustment: AccountReconciliationTabProps["onAddAdjustment"];
  onRemoveAdjustment: AccountReconciliationTabProps["onRemoveAdjustment"];
}) {
  const [statementBalance, setStatementBalance] = useState("");
  const [notes, setNotes] = useState("");
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [pane, setPane] = useState<"unmatched" | "all" | "adjustments">("unmatched");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ description: "", amount: "", direction: "out" as "in" | "out", kind: "bank_charge" as ReconAdjustment["kind"], occurredOn: "" });

  useEffect(() => {
    if (!workspace) return;
    setStatementBalance(workspace.existing ? String(workspace.existing.statementBalance) : "");
    setNotes(workspace.existing?.notes ?? "");
    setMatched(new Set(workspace.matches.map((row) => `${row.sourceType}::${row.sourceId}`)));
  }, [workspace]);

  if (loading || !workspace) {
    return (
      <Modal title="Account Reconciliation" subtitle="Loading the account's movements…"
        icon={Landmark} width="max-w-5xl" onClose={onClose} footer={null}>
        <p className="m-0 py-10 text-center text-[13px] font-semibold text-gray-500">Loading…</p>
      </Modal>
    );
  }

  const parsedStatement = Number(String(statementBalance).replace(/,/g, ""));
  const hasStatement = String(statementBalance).trim() !== "" && Number.isFinite(parsedStatement);
  const adjustmentDelta = workspace.adjustments.reduce(
    (sum, row) => sum + (row.direction === "in" ? row.amount : -row.amount), 0);
  const adjustedBooks = workspace.bookBalance + adjustmentDelta;
  const rawDiff = hasStatement ? parsedStatement - workspace.bookBalance : 0;
  const remaining = hasStatement ? parsedStatement - adjustedBooks : 0;
  const settled = Math.abs(remaining) <= 0.5;
  const alreadyReconciled = workspace.existing?.status === "reconciled";

  const key = (item: ReconBookItem) => `${item.sourceType}::${item.sourceId}`;
  const unmatchedRows = workspace.items.filter((item) => !matched.has(key(item)));
  const inBooksNotBank = unmatchedRows.filter((item) => item.direction === "out");
  const inBooksIn = unmatchedRows.filter((item) => item.direction === "in");

  const toggle = (item: ReconBookItem) => {
    setMatched((prev) => {
      const next = new Set(prev);
      const id = key(item);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = async (status: "in_progress" | "reconciled") => {
    setError("");
    if (!hasStatement) { setError("Enter the balance shown on the statement."); return; }
    if (status === "reconciled" && !settled) {
      setError(`${naira(Math.abs(remaining))} is still unexplained. Add an adjustment for it, or save and continue later.`);
      return;
    }
    try {
      await onSave({
        bankAccountId: workspace.account.id,
        statementDate: workspace.statementDate,
        statementBalance: parsedStatement,
        status, notes,
        matches: [...matched].map((entry) => {
          const [sourceType, sourceId] = entry.split("::");
          return { sourceType: sourceType as "expense" | "remittance" | "transfer", sourceId };
        })
      });
    } catch (saveError: any) {
      setError(saveError?.message ?? "Could not save that reconciliation.");
    }
  };

  const addAdjustment = async () => {
    setError("");
    if (!workspace.existing?.id) { setError("Save the reconciliation once before adding adjustments."); return; }
    const amount = Number(String(draft.amount).replace(/,/g, ""));
    if (!draft.description.trim()) { setError("Say what the adjustment is for."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setError("An adjustment has to be more than ₦0."); return; }
    try {
      await onAddAdjustment(workspace.existing.id, {
        occurredOn: draft.occurredOn || null,
        description: draft.description.trim(),
        amount, direction: draft.direction, kind: draft.kind
      });
      setDraft({ description: "", amount: "", direction: "out", kind: "bank_charge", occurredOn: "" });
    } catch (addError: any) {
      setError(addError?.message ?? "Could not add that adjustment.");
    }
  };

  return (
    <Modal
      title="Account Reconciliation"
      subtitle="Compare your books with the bank statement to ensure accuracy."
      icon={Landmark} width="max-w-6xl" onClose={onClose}
      footer={
        <>
          {error && <p className="m-0 mr-auto text-[12px] font-bold text-rose-600">{error}</p>}
          <button type="button" onClick={onClose}
            className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" disabled={saving || alreadyReconciled} onClick={() => void submit("in_progress")}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-[#1F8FE0] bg-white px-4 py-2.5 text-sm font-bold text-[#1F8FE0] hover:bg-blue-50 disabled:opacity-50">
            <FileText className="h-4 w-4" /> Save &amp; Continue Later
          </button>
          <button type="button" disabled={saving || alreadyReconciled || !settled || !hasStatement}
            onClick={() => void submit("reconciled")}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            <Check className="h-4 w-4" /> Mark as Reconciled
          </button>
        </>
      }
    >
      <div className="grid gap-3 rounded-2xl bg-gray-50 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
        <span className="flex items-center gap-2.5">
          <AccountMark account={{ accountType: workspace.account.accountType, bankName: workspace.account.bankName, name: workspace.account.name }} />
          <span className="min-w-0">
            <span className="block text-[11px] font-black uppercase tracking-wide text-gray-500">Account</span>
            <span className="block truncate text-[13px] font-black text-gray-900">{workspace.account.name}</span>
            <span className="block text-[11px] font-semibold text-gray-400">
              {workspace.account.accountNumberLast4 ? `****${workspace.account.accountNumberLast4}` : workspace.account.bankName}
            </span>
          </span>
        </span>
        <span className="grid grid-cols-3 gap-2">
          <span>
            <span className="block text-[11px] font-black uppercase tracking-wide text-gray-500">Per Books</span>
            <span className="block text-[15px] font-black text-gray-900">{naira(workspace.bookBalance)}</span>
          </span>
          <span>
            <span className="block text-[11px] font-black uppercase tracking-wide text-gray-500">Per Statement</span>
            <input inputMode="decimal" value={statementBalance} disabled={alreadyReconciled}
              onChange={(event) => setStatementBalance(event.target.value)} placeholder="Type it in"
              className="mt-0.5 block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] font-black text-gray-900 disabled:bg-gray-100" />
          </span>
          <span>
            <span className="block text-[11px] font-black uppercase tracking-wide text-gray-500">Bank − Books</span>
            <span className={`block text-[15px] font-black ${!hasStatement ? "text-gray-400" : Math.abs(rawDiff) <= 0.5 ? "text-emerald-600" : "text-rose-600"}`}>
              {hasStatement ? signedNaira(rawDiff) : "—"}
            </span>
          </span>
        </span>
        <span>
          <span className="block text-[11px] font-black uppercase tracking-wide text-gray-500">Last Reconciled</span>
          <span className="block text-[13px] font-black text-gray-900">
            {workspace.lastReconciled ? dateLabel(workspace.lastReconciled.statementDate) : "Never"}
          </span>
          <span className="block text-[11px] font-semibold text-gray-400">
            {workspace.lastReconciled?.byName ? `by ${workspace.lastReconciled.byName}` : `Showing movements from ${dateLabel(workspace.periodFrom)}`}
          </span>
        </span>
      </div>

      {alreadyReconciled && (
        <p className="m-0 flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[12px] font-bold text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          This statement date is already reconciled. Reopen it from the list to make changes.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-2xl border border-gray-200">
          <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-4 py-3">
            {([
              ["unmatched", `Unmatched Transactions (${unmatchedRows.length})`],
              ["all", "All Transactions"],
              ["adjustments", `Adjustments (${workspace.adjustments.length})`]
            ] as const).map(([key2, label]) => (
              <button key={key2} type="button" onClick={() => setPane(key2)}
                className={`!min-h-0 rounded-lg px-3 py-1.5 text-[12px] font-black transition-colors ${pane === key2 ? "bg-violet-50 text-violet-700" : "bg-transparent text-gray-500 hover:text-gray-900"}`}>
                {label}
              </button>
            ))}
          </div>

          {pane === "adjustments" ? (
            <div className="px-4 py-4">
              <ul className="m-0 list-none space-y-2 p-0">
                {workspace.adjustments.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-gray-900">{row.description}</span>
                      <span className="block text-[11px] font-semibold text-gray-400">
                        {ADJUSTMENT_KINDS.find((kind) => kind.key === row.kind)?.label ?? row.kind}
                        {row.occurredOn && ` · ${dateLabel(row.occurredOn)}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`text-[13px] font-black ${row.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>
                        {row.direction === "in" ? "+" : "−"}{naira(row.amount)}
                      </span>
                      {!alreadyReconciled && workspace.existing && (
                        <button type="button" aria-label="Remove adjustment"
                          onClick={() => void onRemoveAdjustment(workspace.existing!.id, row.id)}
                          className="!min-h-0 rounded-lg bg-transparent p-1 text-gray-400 hover:text-rose-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
                {workspace.adjustments.length === 0 && (
                  <li className="rounded-xl border border-dashed border-gray-300 px-3 py-6 text-center text-[12px] font-semibold text-gray-500">
                    No adjustments yet. Add one for anything on the statement that is not in the books — bank charges, VAT, interest.
                  </li>
                )}
              </ul>

              {!alreadyReconciled && (
                <div className="mt-3 rounded-xl border border-dashed border-gray-300 px-3 py-3">
                  <p className="m-0 mb-2 text-[11px] font-black uppercase tracking-wide text-gray-500">Create Adjustment Entry</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input value={draft.description} placeholder="Bank charges — SMS alerts"
                      onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
                      className="rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] font-medium text-gray-900" />
                    <input inputMode="decimal" value={draft.amount} placeholder="Amount"
                      onChange={(event) => setDraft((prev) => ({ ...prev, amount: event.target.value }))}
                      className="rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] font-bold text-gray-900" />
                    <select value={draft.kind}
                      onChange={(event) => setDraft((prev) => ({ ...prev, kind: event.target.value as ReconAdjustment["kind"] }))}
                      className="rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] font-bold text-gray-900">
                      {ADJUSTMENT_KINDS.map((kind) => <option key={kind.key} value={kind.key}>{kind.label}</option>)}
                    </select>
                    <select value={draft.direction}
                      onChange={(event) => setDraft((prev) => ({ ...prev, direction: event.target.value as "in" | "out" }))}
                      className="rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] font-bold text-gray-900">
                      <option value="out">Money left the account</option>
                      <option value="in">Money came into the account</option>
                    </select>
                  </div>
                  <button type="button" disabled={saving || !workspace.existing} onClick={() => void addAdjustment()}
                    className="!min-h-0 mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#1F8FE0] px-3 py-2 text-[13px] font-bold text-white hover:bg-[#1a7cc4] disabled:opacity-50">
                    <Plus className="h-3.5 w-3.5" /> Add Adjustment
                  </button>
                  {!workspace.existing && (
                    <p className="m-0 mt-1.5 text-[11px] font-semibold text-amber-600">
                      Save the reconciliation once first — an adjustment has to attach to something.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-0 md:grid-cols-2">
              {[
                { title: `Money Out, Not Ticked (${inBooksNotBank.length})`, rows: pane === "all" ? workspace.items.filter((row) => row.direction === "out") : inBooksNotBank, icon: ArrowUpRight, tone: "text-rose-600" },
                { title: `Money In, Not Ticked (${inBooksIn.length})`, rows: pane === "all" ? workspace.items.filter((row) => row.direction === "in") : inBooksIn, icon: ArrowDownLeft, tone: "text-emerald-600" }
              ].map((column, index) => {
                const Icon = column.icon;
                return (
                  <div key={column.title} className={index === 0 ? "border-b border-gray-100 md:border-b-0 md:border-r" : ""}>
                    <h4 className={`m-0 flex items-center gap-1.5 border-b border-gray-100 px-4 py-3 text-[12px] font-black uppercase tracking-wide ${column.tone}`}>
                      <Icon className="h-3.5 w-3.5" /> {column.title}
                    </h4>
                    <ul className="m-0 list-none space-y-0 p-0">
                      {column.rows.map((row) => {
                        const id = key(row);
                        const isMatched = matched.has(id);
                        return (
                          <li key={id} className="flex items-center justify-between gap-2 border-b border-gray-50 px-4 py-2.5 last:border-0">
                            <label className="m-0 flex min-w-0 items-center gap-2">
                              <input type="checkbox" checked={isMatched} disabled={alreadyReconciled}
                                onChange={() => toggle(row)} className="h-4 w-4 shrink-0" />
                              <span className="min-w-0">
                                <span className={`block truncate text-[13px] font-bold ${isMatched ? "text-gray-400 line-through" : "text-gray-900"}`}>
                                  {row.description}
                                </span>
                                <span className="block text-[11px] font-semibold text-gray-400">
                                  {dateLabel(row.occurredOn)} · {row.sourceType}
                                </span>
                              </span>
                            </label>
                            <span className={`shrink-0 text-[13px] font-black ${isMatched ? "text-gray-400" : "text-gray-900"}`}>
                              {naira(row.amount)}
                            </span>
                          </li>
                        );
                      })}
                      {column.rows.length === 0 && (
                        <li className="px-4 py-6 text-center text-[12px] font-semibold text-gray-400">
                          {pane === "all" ? "Nothing in this direction." : "All ticked off."}
                        </li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-gray-200 px-4 py-4">
            <h4 className="m-0 flex items-center gap-1.5 text-[12px] font-black uppercase tracking-wide text-gray-700">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" /> Reconciliation Tips
            </h4>
            <ul className="m-0 mt-2.5 list-none space-y-2 p-0">
              {[
                "Compare each transaction in your books with the statement.",
                "Tick them off one by one.",
                "Create an adjustment for bank charges, interest, or items not in your books.",
                "The remaining difference must be ₦0 before the account can be reconciled."
              ].map((tip) => (
                <li key={tip} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <span className="text-[12px] font-medium text-gray-600">{tip}</span>
                </li>
              ))}
            </ul>
            <label className="m-0 mt-3 block text-[11px] font-black uppercase tracking-wide text-gray-500">
              Notes (Optional)
              <textarea value={notes} maxLength={250} rows={3} disabled={alreadyReconciled}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Add any notes about this reconciliation..."
                className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-medium text-gray-900 disabled:bg-gray-50" />
            </label>
          </div>

          <div className="rounded-2xl border border-gray-200 px-4 py-4">
            <h4 className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-700">Reconciliation Result</h4>
            <dl className="m-0 mt-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <dt className="m-0 text-[12px] font-semibold text-gray-600">Balance per books</dt>
                <dd className="m-0 text-[12px] font-black text-gray-900">{naira(workspace.bookBalance)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="m-0 text-[12px] font-semibold text-gray-600">Adjustments</dt>
                <dd className={`m-0 text-[12px] font-black ${adjustmentDelta === 0 ? "text-gray-900" : adjustmentDelta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {signedNaira(adjustmentDelta)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                <dt className="m-0 text-[12px] font-semibold text-gray-600">Adjusted books</dt>
                <dd className="m-0 text-[12px] font-black text-gray-900">{naira(adjustedBooks)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="m-0 text-[12px] font-semibold text-gray-600">Balance per statement</dt>
                <dd className="m-0 text-[12px] font-black text-gray-900">{hasStatement ? naira(parsedStatement) : "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                <dt className="m-0 text-[12px] font-black text-gray-900">Remaining difference</dt>
                <dd className={`m-0 text-base font-black ${!hasStatement ? "text-gray-400" : settled ? "text-emerald-600" : "text-rose-600"}`}>
                  {hasStatement ? signedNaira(remaining) : "—"}
                </dd>
              </div>
            </dl>
            {hasStatement && !settled && (
              <p className="m-0 mt-2.5 flex gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[12px] font-bold text-rose-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Explain this with an adjustment before marking the account reconciled.
              </p>
            )}
            {hasStatement && settled && (
              <p className="m-0 mt-2.5 flex gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[12px] font-bold text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> This account agrees with the statement.
              </p>
            )}
          </div>
        </aside>
      </div>
    </Modal>
  );
}
