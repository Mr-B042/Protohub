import { useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, Building2, CheckCircle2,
  Info, Landmark, Plus, Search, Wallet, X
} from "lucide-react";
import type { BankAccountRow, BankAccountsView, BankTransferRow } from "../lib/api";
import type { CashFlowTransaction } from "./CashFlowPage";

// Bank accounts inside Cash Flow, not beside it: "how much cash do we have" and
// "where is it" are the same question asked twice.
//
// ⚠️ A transfer between our OWN accounts is never cash flow - nothing entered
// or left the business - so transfers move balances here while being excluded
// from the cash in/out totals on the Overview tab.

const naira = (value: number) => `₦${Math.round(Number(value) || 0).toLocaleString("en-NG")}`;
const stamp = (iso: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-NG", { year: "numeric", month: "short", day: "numeric" });
};
const clock = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
};

type SubTab = "Account Activity" | "Pending Transactions" | "Account Summary";

export type BankAccountsTabProps = {
  view: BankAccountsView | null;
  /** The period's ledger, reused so activity and cash flow cannot disagree. */
  transactions: CashFlowTransaction[];
  loading: boolean;
  canManage: boolean;
  saving: boolean;
  onAddAccount: (body: {
    name: string; accountType: "bank" | "cash"; bankName: string;
    accountNumberLast4: string; isPrimary: boolean; openingBalance: number; openingBalanceDate: string | null;
  }) => Promise<void>;
  onTransfer: (body: { fromAccountId: string; toAccountId: string; amount: number; note: string; markCleared: boolean }) => Promise<void>;
  onClearTransfer: (id: string) => Promise<void>;
  onRefresh: () => void;
};

export default function BankAccountsTab(props: BankAccountsTabProps) {
  const { view, transactions, canManage } = props;
  const [subTab, setSubTab] = useState<SubTab>("Account Activity");
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const accounts = view?.accounts.filter((account) => account.active) ?? [];
  const pending = (view?.transfers ?? []).filter((row) => !row.clearedAt);

  const activity = useMemo(() => {
    const query = search.trim().toLowerCase();
    return transactions.filter((row) => {
      if (!query) return true;
      return row.description.toLowerCase().includes(query)
        || row.category.toLowerCase().includes(query)
        || row.source.toLowerCase().includes(query);
    });
  }, [transactions, search]);

  const summaryCards = [
    { label: "Total Liquid Cash (all accounts)", value: view?.totals.totalLiquid ?? 0, hint: `Across ${accounts.length} account${accounts.length === 1 ? "" : "s"}`, tone: "text-gray-900" },
    { label: "Total Bank Balances", value: view?.totals.totalBank ?? 0, hint: `${accounts.filter((a) => a.accountType === "bank").length} bank accounts`, tone: "text-blue-600" },
    { label: "Cash in Hand", value: view?.totals.cashInHand ?? 0, hint: `${accounts.filter((a) => a.accountType === "cash").length} cash account`, tone: "text-violet-600" },
    { label: "Pending to Clear", value: view?.totals.pendingToClear ?? 0, hint: "Transfers in flight", tone: "text-amber-600" }
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-xl font-black text-gray-900">
            Bank Accounts
            <span title="Balances are opening balance plus every transaction assigned to that account. Transfers between your own accounts move balances but are not cash flow." className="cursor-help text-gray-300 hover:text-gray-500">
              <Info className="h-4 w-4" />
            </span>
          </h2>
          <p className="m-0 mt-0.5 text-sm text-gray-500">Manage business bank accounts and track liquid balances.</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setTransferOpen(true)} disabled={accounts.length < 2}
              className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              title={accounts.length < 2 ? "Add a second account before transferring" : "Move money between your own accounts"}>
              <ArrowLeftRight className="h-4 w-4" /> Transfer Money
            </button>
            <button type="button" onClick={() => setAddOpen(true)}
              className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-[#1F8FE0] px-3.5 py-2.5 text-sm font-bold text-white hover:bg-[#1a7ec4]">
              <Plus className="h-4 w-4" /> Add Bank Account
            </button>
          </div>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card, index) => (
          <div key={card.label} className={index > 0 ? "xl:border-l xl:border-gray-100 xl:pl-5" : ""}>
            <p className="m-0 text-[10px] font-black uppercase tracking-[0.12em] text-gray-400">{card.label}</p>
            <p className={`m-0 mt-1 text-2xl font-black ${card.tone}`}>{props.loading && !view ? "—" : naira(card.value)}</p>
            <p className="m-0 mt-0.5 text-[11px] font-semibold text-gray-400">{card.hint}</p>
          </div>
        ))}
      </div>

      {/* Unassigned cash is the difference between the ledger and the account
          balances. Reporting it stops the two quietly disagreeing. */}
      {(view?.unassigned ?? 0) !== 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="m-0 text-[13px] font-bold text-amber-900">
            {naira(view?.unassigned ?? 0)} of recorded cash is not assigned to any account.
          </p>
          <p className="m-0 mt-0.5 text-[11px] font-medium leading-4 text-amber-800">
            Everything logged before accounts existed has no account against it. It still counts in Cash Flow — it just cannot be attributed to a balance. Assign it when you are ready, or leave it as it is.
          </p>
        </div>
      )}

      {/* Account cards */}
      {accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-12 text-center">
          <Landmark className="mx-auto h-8 w-8 text-gray-300" />
          <h3 className="m-0 mt-3 text-sm font-black text-gray-800">No accounts yet</h3>
          <p className="m-0 mt-1 text-xs font-medium text-gray-400">
            Add the accounts your agents remit into so balances can be tracked separately.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {accounts.map((account) => (
            <article key={account.id}
              className={`rounded-2xl border px-4 py-4 ${account.accountType === "cash" ? "border-amber-200 bg-amber-50/40" : "border-gray-200 bg-white"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${account.accountType === "cash" ? "bg-amber-100 text-amber-600" : "bg-blue-50 text-blue-600"}`}>
                  {account.accountType === "cash" ? <Wallet className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                </span>
                {account.isPrimary && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">Primary</span>
                )}
              </div>
              <p className="m-0 mt-2 truncate text-sm font-black text-gray-900" title={account.name}>{account.name}</p>
              <p className="m-0 text-[11px] font-semibold text-gray-400">
                {account.accountType === "cash"
                  ? "Physical cash"
                  : `${account.bankName || "Bank"}${account.accountNumberLast4 ? ` ****${account.accountNumberLast4}` : ""}`}
              </p>
              <p className="m-0 mt-3 text-[10px] font-black uppercase tracking-wide text-gray-400">Current balance</p>
              <p className="m-0 text-xl font-black text-gray-900">{naira(account.currentBalance)}</p>
              <dl className="mt-2.5 space-y-1.5 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-gray-500">Available</dt>
                  <dd className="m-0 font-bold text-gray-800">{naira(account.availableBalance)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-gray-500">Opening</dt>
                  <dd className="m-0 font-bold text-gray-800">{naira(account.openingBalance)}</dd>
                </div>
                {account.openingBalanceDate && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-gray-500">Effective</dt>
                    <dd className="m-0 font-bold text-gray-800">{stamp(`${account.openingBalanceDate}T00:00:00Z`)}</dd>
                  </div>
                )}
                {account.pendingIn > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-amber-700">Pending in</dt>
                    <dd className="m-0 font-bold text-amber-700">{naira(account.pendingIn)}</dd>
                  </div>
                )}
              </dl>
            </article>
          ))}
        </div>
      )}

      {/* Sub-tabs */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex gap-4 overflow-x-auto border-b border-gray-100 px-5">
          {(["Account Activity", "Pending Transactions", "Account Summary"] as SubTab[]).map((tab) => (
            <button key={tab} type="button" onClick={() => setSubTab(tab)}
              className={`!min-h-0 inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 bg-transparent px-0 pb-3 pt-3.5 text-[13px] font-bold ${subTab === tab ? "border-[#1F8FE0] text-[#1F8FE0]" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
              {tab}
              {tab === "Pending Transactions" && pending.length > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">{pending.length}</span>
              )}
            </button>
          ))}
        </div>

        {subTab === "Account Activity" && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions..."
                  className="w-full rounded-xl border border-gray-200 py-2 pl-8 pr-3 text-[13px] font-medium text-gray-900" />
              </div>
              <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}
                className="rounded-xl border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700">
                <option value="all">All Accounts</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/80">
                  <tr className="text-[10px] font-black uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Date &amp; Time</th>
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Description / Party</th>
                    <th className="px-4 py-3 text-right">Cash In (₦)</th>
                    <th className="px-4 py-3 text-right">Cash Out (₦)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activity.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">No activity in this period.</td></tr>
                  ) : activity.slice(0, 25).map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50/60">
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="text-[13px] font-medium text-gray-700">{stamp(row.at)}</span>
                        <span className="ml-2 text-[11px] font-semibold text-gray-400">{clock(row.at)}</span>
                      </td>
                      {/* No account attribution exists on historical rows, and
                          inventing one would fabricate a bank history. */}
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">Unassigned</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold ${row.direction === "in" ? "text-emerald-700" : "text-rose-700"}`}>
                          {row.direction === "in" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                          {row.direction === "in" ? "Cash In" : "Cash Out"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-gray-600">{row.category}</td>
                      <td className="max-w-[260px] truncate px-4 py-3 text-[13px] text-gray-700" title={row.description}>{row.description}</td>
                      <td className="px-4 py-3 text-right text-[13px] font-black text-emerald-700">{row.cashIn > 0 ? Math.round(row.cashIn).toLocaleString("en-NG") : "–"}</td>
                      <td className="px-4 py-3 text-right text-[13px] font-black text-rose-700">{row.cashOut > 0 ? Math.round(row.cashOut).toLocaleString("en-NG") : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0 border-t border-gray-100 px-5 py-3 text-[11px] font-medium text-gray-400">
              Showing up to 25 of {activity.length} transactions for the selected period. The full ledger with running balance is on the Overview tab.
            </p>
          </>
        )}

        {subTab === "Pending Transactions" && (
          <div className="px-5 py-4">
            {pending.length === 0 ? (
              <div className="py-10 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-400" />
                <p className="m-0 mt-2 text-sm font-bold text-gray-700">Nothing in flight</p>
                <p className="m-0 mt-1 text-[12px] font-medium text-gray-400">Every transfer between your accounts has been confirmed received.</p>
              </div>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {pending.map((transfer) => (
                  <PendingTransferRow key={transfer.id} transfer={transfer} accounts={accounts}
                    canManage={canManage} saving={props.saving} onClear={props.onClearTransfer} />
                ))}
              </ul>
            )}
          </div>
        )}

        {subTab === "Account Summary" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/80">
                <tr className="text-[10px] font-black uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Opening</th>
                  <th className="px-4 py-3 text-right">Current</th>
                  <th className="px-4 py-3 text-right">Available</th>
                  <th className="px-4 py-3 text-right">In Flight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accounts.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">No accounts yet.</td></tr>
                ) : accounts.map((account) => (
                  <tr key={account.id}>
                    <td className="px-4 py-3 font-bold text-gray-900">{account.name}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-600">{account.accountType === "cash" ? "Cash in hand" : account.bankName || "Bank"}</td>
                    <td className="px-4 py-3 text-right text-[13px] font-medium text-gray-600">{naira(account.openingBalance)}</td>
                    <td className="px-4 py-3 text-right text-[13px] font-black text-gray-900">{naira(account.currentBalance)}</td>
                    <td className="px-4 py-3 text-right text-[13px] font-bold text-gray-700">{naira(account.availableBalance)}</td>
                    <td className="px-4 py-3 text-right text-[13px] font-bold text-amber-700">{account.pendingIn > 0 ? naira(account.pendingIn) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {addOpen && <AddAccountModal saving={props.saving} onClose={() => setAddOpen(false)}
        onSave={async (body) => { await props.onAddAccount(body); setAddOpen(false); }} />}
      {transferOpen && <TransferModal accounts={accounts} saving={props.saving} onClose={() => setTransferOpen(false)}
        onSave={async (body) => { await props.onTransfer(body); setTransferOpen(false); }} />}
    </div>
  );
}

function PendingTransferRow({ transfer, accounts, canManage, saving, onClear }: {
  transfer: BankTransferRow; accounts: BankAccountRow[]; canManage: boolean; saving: boolean;
  onClear: (id: string) => Promise<void>;
}) {
  const nameOf = (id: string) => accounts.find((account) => account.id === id)?.name ?? "Unknown account";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
      <div className="min-w-0">
        <p className="m-0 text-[13px] font-black text-gray-900">
          {naira(transfer.amount)} · {nameOf(transfer.fromAccountId)} → {nameOf(transfer.toAccountId)}
        </p>
        <p className="m-0 mt-0.5 text-[11px] font-medium text-gray-500">
          Sent {stamp(transfer.transferredAt)} {clock(transfer.transferredAt)}
          {transfer.note ? ` · ${transfer.note}` : ""}
        </p>
      </div>
      {canManage && (
        <button type="button" disabled={saving} onClick={() => void onClear(transfer.id)}
          className="!min-h-0 shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-black text-white hover:bg-emerald-700 disabled:opacity-50">
          Mark received
        </button>
      )}
    </li>
  );
}

function ModalShell({ title, subtitle, onClose, children, footer }: {
  title: string; subtitle: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose}
        className="!min-h-0 absolute inset-0 cursor-default bg-slate-900/40 p-0" />
      <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-5">
          <div>
            <h3 className="m-0 text-lg font-black text-gray-900">{title}</h3>
            <p className="m-0 mt-0.5 text-[13px] font-medium text-gray-500">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="!min-h-0 rounded-lg bg-transparent p-1 text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">{children}</div>
        <div className="flex justify-end gap-2.5 border-t border-gray-100 px-6 py-4">{footer}</div>
      </div>
    </div>
  );
}

const fieldClass = "mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900";
const labelClass = "block text-[10px] font-black uppercase tracking-[0.14em] text-gray-500";

function AddAccountModal({ saving, onClose, onSave }: {
  saving: boolean; onClose: () => void;
  onSave: (body: { name: string; accountType: "bank" | "cash"; bankName: string; accountNumberLast4: string; isPrimary: boolean; openingBalance: number; openingBalanceDate: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<"bank" | "cash">("bank");
  const [bankName, setBankName] = useState("");
  const [last4, setLast4] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [openingBalance, setOpeningBalance] = useState("0");
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));

  const amount = Number(String(openingBalance).replace(/[^\d.-]/g, ""));
  const invalid = !name.trim() || !Number.isFinite(amount) || !/^[0-9]{0,4}$/.test(last4);

  return (
    <ModalShell title="Add Bank Account" subtitle="Add an account your cash actually moves through." onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose}
            className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13px] font-black text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="button" disabled={saving || invalid}
            onClick={() => void onSave({
              name: name.trim(), accountType, bankName: bankName.trim(),
              accountNumberLast4: last4, isPrimary, openingBalance: amount,
              openingBalanceDate: openingDate || null
            })}
            className="!min-h-0 rounded-xl bg-[#1F8FE0] px-4 py-2.5 text-[13px] font-black text-white hover:bg-[#1a7ec4] disabled:opacity-50">
            {saving ? "Saving…" : "Add Account"}
          </button>
        </>
      )}>
      <label className={labelClass}>Account name
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Opay" className={fieldClass} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>Type
          <select value={accountType} onChange={(event) => setAccountType(event.target.value as "bank" | "cash")} className={fieldClass}>
            <option value="bank">Bank account</option>
            <option value="cash">Cash in hand</option>
          </select>
        </label>
        <label className={labelClass}>Bank
          <input value={bankName} onChange={(event) => setBankName(event.target.value)} disabled={accountType === "cash"}
            placeholder="Opay" className={`${fieldClass} disabled:bg-gray-50 disabled:text-gray-400`} />
        </label>
      </div>
      <label className={labelClass}>Last 4 digits
        <input value={last4} onChange={(event) => setLast4(event.target.value.replace(/\D/g, "").slice(0, 4))}
          disabled={accountType === "cash"} placeholder="5678"
          className={`${fieldClass} disabled:bg-gray-50 disabled:text-gray-400`} />
        <span className="mt-1 block text-[11px] font-medium normal-case tracking-normal text-gray-400">
          Only the last four are stored — a full account number has no business on a dashboard.
        </span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>Opening balance (₦)
          <input value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} inputMode="numeric" className={fieldClass} />
        </label>
        <label className={labelClass}>Effective date
          <input type="date" value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} className={fieldClass} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-[13px] font-bold text-gray-700">
        <input type="checkbox" checked={isPrimary} onChange={(event) => setIsPrimary(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-[#1F8FE0]" />
        Make this the primary account
      </label>
    </ModalShell>
  );
}

function TransferModal({ accounts, saving, onClose, onSave }: {
  accounts: BankAccountRow[]; saving: boolean; onClose: () => void;
  onSave: (body: { fromAccountId: string; toAccountId: string; amount: number; note: string; markCleared: boolean }) => Promise<void>;
}) {
  const [from, setFrom] = useState(accounts[0]?.id ?? "");
  const [to, setTo] = useState(accounts[1]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [markCleared, setMarkCleared] = useState(false);

  const value = Number(String(amount).replace(/[^\d.-]/g, ""));
  const sender = accounts.find((account) => account.id === from);
  const overdrawn = sender ? value > sender.availableBalance : false;
  const invalid = !from || !to || from === to || !Number.isFinite(value) || value <= 0;

  return (
    <ModalShell title="Transfer Money" subtitle="Move money between your own accounts." onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose}
            className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13px] font-black text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="button" disabled={saving || invalid}
            onClick={() => void onSave({ fromAccountId: from, toAccountId: to, amount: value, note: note.trim(), markCleared })}
            className="!min-h-0 rounded-xl bg-[#1F8FE0] px-4 py-2.5 text-[13px] font-black text-white hover:bg-[#1a7ec4] disabled:opacity-50">
            {saving ? "Saving…" : "Record Transfer"}
          </button>
        </>
      )}>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>From
          <select value={from} onChange={(event) => setFrom(event.target.value)} className={fieldClass}>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        <label className={labelClass}>To
          <select value={to} onChange={(event) => setTo(event.target.value)} className={fieldClass}>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
      </div>
      {from === to && <p className="m-0 text-[12px] font-bold text-rose-600">Choose two different accounts.</p>}
      <label className={labelClass}>Amount (₦)
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" className={fieldClass} />
        {overdrawn && (
          <span className="mt-1 block text-[11px] font-bold normal-case tracking-normal text-amber-700">
            More than {sender?.name} has available ({naira(sender?.availableBalance ?? 0)}). Recorded anyway — the balance will go negative.
          </span>
        )}
      </label>
      <label className={labelClass}>Note
        <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 250))} placeholder="Moving float to Moniepoint" className={fieldClass} />
      </label>
      <label className="flex items-start gap-2 text-[13px] font-bold text-gray-700">
        <input type="checkbox" checked={markCleared} onChange={(event) => setMarkCleared(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#1F8FE0]" />
        <span>
          Already received
          <span className="mt-0.5 block text-[11px] font-medium text-gray-400">
            Leave unticked while the money is still in flight — it stays out of the receiving account's available balance until confirmed.
          </span>
        </span>
      </label>
      <div className="flex gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-3.5 py-3">
        <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
        <p className="m-0 text-[12px] font-medium leading-5 text-blue-900">
          Transfers between your own accounts are not cash flow — nothing enters or leaves the business, so this moves balances without changing Cash In or Cash Out.
        </p>
      </div>
    </ModalShell>
  );
}
