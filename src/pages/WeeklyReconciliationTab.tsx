import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, Calculator,
  CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, ClipboardList,
  Clock, FileText, History, Info, Landmark, Search, Shield, ShieldCheck, Upload,
  UserMinus, Users, Wallet, X
} from "lucide-react";
import type {
  ReconciliationHistoryWeek, ReconciliationStatusKey, VerificationAccountEntry,
  WeeklyReconciliationView
} from "../lib/api";
import { AccountMark } from "./BankAccountsTab";

// Weekly Reconciliation: does the cash we think we have actually exist?
//
// ⚠️ Direction is fixed everywhere on this tab: variance = ACTUAL − EXPECTED.
// Negative means money is missing. The backend computes it once and this file
// never recomputes it, so the headline and the per-account breakdown cannot
// drift apart.

const naira = (value: number) => `₦${Math.round(Number(value) || 0).toLocaleString("en-NG")}`;
/** Variance reads with an explicit sign - "−₦120,000" is the whole point. */
const signedNaira = (value: number) => {
  const rounded = Math.round(Number(value) || 0);
  if (rounded === 0) return "₦0";
  return `${rounded < 0 ? "−" : "+"}₦${Math.abs(rounded).toLocaleString("en-NG")}`;
};
const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { month: "short", day: "numeric" });
const longDay = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", month: "short", day: "numeric" });
const fullDay = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const stamp = (iso: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" })
      + " · " + date.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
};
const addDays = (key: string, days: number) => {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const sundayOf = (key: string) => {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
};
const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

const STATUS_STYLE: Record<ReconciliationStatusKey, { label: string; chip: string; icon: typeof Info }> = {
  not_verified: { label: "Not Verified", chip: "bg-gray-100 text-gray-600 border-gray-200", icon: Circle },
  balanced: { label: "Balanced", chip: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  needs_investigation: { label: "Needs Investigation", chip: "bg-amber-50 text-amber-700 border-amber-200", icon: AlertTriangle },
  investigating: { label: "Investigating", chip: "bg-blue-50 text-blue-700 border-blue-200", icon: Search },
  resolved: { label: "Resolved", chip: "bg-violet-50 text-violet-700 border-violet-200", icon: ShieldCheck }
};

const REASONS: Array<{ key: string; label: string; hint: string; icon: typeof Info; tone: string }> = [
  { key: "missing_transaction", label: "Missing Transaction", hint: "A cash transaction was not recorded in the system.", icon: FileText, tone: "text-violet-600 bg-violet-50" },
  { key: "incorrect_transaction", label: "Incorrect Transaction", hint: "Transaction recorded with wrong amount, date or account.", icon: ClipboardList, tone: "text-amber-600 bg-amber-50" },
  { key: "timing_difference", label: "Timing Difference", hint: "Transaction recorded in a different week.", icon: Clock, tone: "text-blue-600 bg-blue-50" },
  { key: "bank_charges", label: "Bank Charges / Fees", hint: "Bank fees or charges not recorded.", icon: Landmark, tone: "text-emerald-600 bg-emerald-50" },
  { key: "owner_withdrawal", label: "Owner Withdrawal", hint: "Cash withdrawn by owner not recorded.", icon: UserMinus, tone: "text-rose-600 bg-rose-50" },
  { key: "cash_shortage", label: "Cash Shortage", hint: "Physical cash is missing.", icon: AlertTriangle, tone: "text-rose-600 bg-rose-50" },
  { key: "agent_remittance", label: "Agent Remittance Issue", hint: "Agent COD recorded incorrectly or late.", icon: Users, tone: "text-blue-600 bg-blue-50" },
  { key: "transfer_misclassified", label: "Transfer Misclassified", hint: "Internal transfer recorded as cash out.", icon: ArrowLeftRight, tone: "text-violet-600 bg-violet-50" },
  { key: "other", label: "Other", hint: "Any other reason not listed above.", icon: Info, tone: "text-gray-500 bg-gray-100" }
];

const EVENT_LABEL: Record<string, string> = {
  started: "Investigation started",
  evidence_uploaded: "Evidence uploaded",
  partial_explained: "Partial amount explained",
  reason_set: "Reason selected",
  submitted: "Investigation submitted",
  resolved: "Variance resolved",
  reopened: "Investigation reopened",
  note: "Note added"
};

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

function StatusChip({ status }: { status: ReconciliationStatusKey }) {
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${style.chip}`}>
      <Icon className="h-3.5 w-3.5" /> {style.label}
    </span>
  );
}

function SectionCard({ title, hint, children, className }: {
  title: string; hint?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-4">
        <h3 className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-700">{title}</h3>
        {hint}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export type WeeklyReconciliationTabProps = {
  view: WeeklyReconciliationView | null;
  loading: boolean;
  error: string;
  weekStart: string;
  onWeekChange: (weekStart: string) => void;
  saving: boolean;
  onSaveVerification: (body: {
    weekStart: string; status: "draft" | "verified"; notes: string; accounts: VerificationAccountEntry[];
  }) => Promise<void>;
  onSaveInvestigation: (body: {
    weekStart: string; status: "in_progress" | "submitted" | "resolved";
    reason: string | null; amountExplained: number; description: string;
    occurredOn: string | null; category: string; evidenceName: string; evidenceUrl: string;
  }) => Promise<void>;
  history: ReconciliationHistoryWeek[];
  onLoadHistory: () => void;
};

export default function WeeklyReconciliationTab(props: WeeklyReconciliationTabProps) {
  const { view, loading, error, weekStart } = props;
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [investigateOpen, setInvestigateOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const verification = view?.verification ?? null;
  // ⚠️ The variance is measured against the FROZEN pair captured when the week
  // was verified, not against today's live figures. A backdated expense must
  // not silently rewrite a variance that has already been investigated.
  const variance = verification ? verification.actualClosing - verification.expectedClosing : 0;
  const investigation = view?.investigation ?? null;
  const status: ReconciliationStatusKey = useMemo(() => {
    if (!verification || verification.status === "draft") return "not_verified";
    if (Math.abs(variance) <= 0.5) return "balanced";
    if (investigation?.status === "resolved") return "resolved";
    if (investigation) return "investigating";
    return "needs_investigation";
  }, [verification, variance, investigation]);

  const explained = Math.min(Math.abs(investigation?.amountExplained ?? 0), Math.abs(variance));
  const unexplained = Math.max(Math.abs(variance) - explained, 0);
  const isThisWeek = sundayOf(todayKey()) === weekStart;

  const cards = [
    {
      label: `Opening Cash (${longDay(weekStart)})`, value: view?.openingCash ?? 0,
      hint: "From previous closing cash", icon: Landmark, tone: "bg-blue-50 text-blue-600",
      badge: view?.openingVerified ? "Counted" : "Derived",
      badgeTone: view?.openingVerified ? "text-emerald-600" : "text-amber-600"
    },
    {
      // ⚠️ "Recorded", not "Verified", until the week's closing cash has
      // actually been counted. Calling an unchecked figure verified is the
      // exact confusion this tab exists to remove.
      label: `Cash In (${verification ? "Verified" : "Recorded"})`, value: view?.cashIn ?? 0,
      hint: "From agent remittances & other sources", icon: ArrowDownLeft,
      tone: "bg-emerald-50 text-emerald-600", badge: "", badgeTone: ""
    },
    {
      label: `Cash Out (${verification ? "Verified" : "Recorded"})`, value: view?.cashOut ?? 0,
      hint: "For ads, expenses, purchases, etc.", icon: ArrowUpRight,
      tone: "bg-rose-50 text-rose-600", badge: "", badgeTone: ""
    },
    {
      label: "Expected Closing Cash", value: view?.expectedClosing ?? 0,
      hint: "Opening + Cash In – Cash Out", icon: Calculator,
      tone: "bg-blue-50 text-blue-600", badge: "", badgeTone: ""
    }
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-2xl font-black text-gray-900">
            Weekly Reconciliation
            <span title="Cash Flow reports what was recorded. This compares that against what is really in the accounts - the gap between the two is the point of this tab."
              className="cursor-help text-gray-300 hover:text-gray-500"><Info className="h-4 w-4" /></span>
          </h2>
          <p className="m-0 mt-1 text-sm text-gray-500">Compare your expected closing cash with actual verified cash balances.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { props.onLoadHistory(); setHistoryOpen(true); }}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">
            <History className="h-4 w-4" /> Reconciliation History
          </button>
          <button type="button" onClick={() => setVerifyOpen(true)} disabled={loading || !view}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-[#1F8FE0] px-3.5 py-2.5 text-sm font-bold text-white hover:bg-[#1a7cc4] disabled:opacity-50">
            <ShieldCheck className="h-4 w-4" /> Verify Closing Cash
          </button>
        </div>
      </div>

      {error && (
        <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>
      )}

      {/* Week navigator */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Previous week" onClick={() => props.onWeekChange(addDays(weekStart, -7))}
            className="!min-h-0 rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="inline-flex items-center gap-2 rounded-lg px-2 py-1">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <CalendarDays className="h-4 w-4" />
            </span>
            <span className="text-[13px] font-black text-gray-900">
              {view ? `${dayLabel(view.weekStart)} – ${fullDay(view.weekEnd)}` : "—"}
            </span>
            {isThisWeek && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-black text-blue-700">This Week</span>
            )}
          </span>
          <button type="button" aria-label="Next week" disabled={isThisWeek}
            onClick={() => props.onWeekChange(addDays(weekStart, 7))}
            className="!min-h-0 rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <span className="inline-flex items-center gap-2">
          <span className="text-[12px] font-bold text-gray-500">Status:</span>
          <StatusChip status={status} />
        </span>
      </div>

      {/* Headline figures */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.tone}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="m-0 truncate text-[11px] font-black uppercase tracking-wide text-gray-500">{card.label}</p>
                  <p className="m-0 mt-1 flex flex-wrap items-center gap-1.5 text-xl font-black text-gray-900">
                    {naira(card.value)}
                    {card.badge && (
                      <span className={`inline-flex items-center gap-0.5 text-[11px] font-black ${card.badgeTone}`}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> {card.badge}
                      </span>
                    )}
                  </p>
                  <p className="m-0 mt-0.5 text-[11px] font-semibold text-gray-400">{card.hint}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Expected side */}
        <SectionCard title="Cash Reconciliation">
          <dl className="m-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <dt className="m-0 text-[13px] font-semibold text-gray-600">Opening Cash ({longDay(weekStart)})</dt>
              <dd className="m-0 text-[13px] font-black text-gray-900">{naira(view?.openingCash ?? 0)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="m-0 text-[13px] font-semibold text-gray-600">
                <span className="mr-1.5 font-black text-gray-400">+</span>{verification ? "Verified" : "Recorded"} Cash In
              </dt>
              <dd className="m-0 text-[13px] font-black text-emerald-600">{naira(view?.cashIn ?? 0)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="m-0 text-[13px] font-semibold text-gray-600">
                <span className="mr-1.5 font-black text-gray-400">−</span>{verification ? "Verified" : "Recorded"} Cash Out
              </dt>
              <dd className="m-0 text-[13px] font-black text-rose-600">{naira(view?.cashOut ?? 0)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
              <dt className="m-0 text-[13px] font-black text-gray-900">Expected Closing Cash ({view ? longDay(view.weekEnd) : "—"})</dt>
              <dd className="m-0 text-base font-black text-[#1F8FE0]">{naira(view?.expectedClosing ?? 0)}</dd>
            </div>
          </dl>
          <p className="m-0 mt-4 flex gap-2 rounded-xl bg-blue-50 px-3 py-3 text-[12px] font-semibold text-blue-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            This is the cash balance you should have at the end of the week if all cash in and out transactions were recorded correctly.
          </p>
        </SectionCard>

        {/* Actual side */}
        <SectionCard title={`Actual Closing Cash (${view ? longDay(view.weekEnd) : "—"})`}>
          {!verification ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center">
              <Wallet className="mx-auto h-8 w-8 text-gray-300" />
              <p className="m-0 mt-2 text-[13px] font-bold text-gray-700">No count recorded for this week</p>
              <p className="m-0 mt-1 text-[12px] font-medium text-gray-500">
                Enter what is really in each account to find out whether the books are right.
              </p>
              <button type="button" onClick={() => setVerifyOpen(true)}
                className="!min-h-0 mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#1F8FE0] px-3.5 py-2 text-[13px] font-bold text-white hover:bg-[#1a7cc4]">
                <ShieldCheck className="h-4 w-4" /> Verify Closing Cash
              </button>
            </div>
          ) : (
            <>
              <ul className="m-0 list-none space-y-0 p-0">
                {verification.accounts.map((row) => {
                  const account = view?.accounts.find((entry) => entry.id === row.bankAccountId);
                  const matched = Math.abs(row.actualBalance - row.systemBalance) <= 0.5;
                  return (
                    <li key={`${row.bankAccountId ?? row.accountLabel}`}
                      className="flex items-center justify-between gap-3 border-b border-gray-50 py-2.5 last:border-0">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <AccountMark account={{
                          accountType: account?.accountType ?? "cash",
                          bankName: account?.bankName ?? "",
                          name: row.accountLabel
                        }} />
                        <span className="truncate text-[13px] font-bold text-gray-900">{row.accountLabel}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-black ${matched ? "text-emerald-600" : "text-amber-600"}`}>
                          {matched ? <><CheckCircle2 className="h-3.5 w-3.5" /> Verified</> : <><AlertTriangle className="h-3.5 w-3.5" /> Mismatch</>}
                        </span>
                        <span className="text-[13px] font-black text-gray-900">{naira(row.actualBalance)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                <span className="text-[13px] font-black text-gray-900">Actual Closing Cash (Total)</span>
                <span className="text-base font-black text-gray-900">{naira(verification.actualClosing)}</span>
              </div>
              <p className="m-0 mt-2 text-[11px] font-semibold text-gray-400">
                Counted by {verification.verifiedByName || "—"} · {stamp(verification.verifiedAt)}
              </p>
            </>
          )}
        </SectionCard>

        {/* Variance */}
        <section className={`rounded-2xl border ${Math.abs(variance) <= 0.5 ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40"}`}>
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-4">
            <h3 className="m-0 flex items-center gap-1.5 text-[12px] font-black uppercase tracking-wide text-gray-700">
              Cash Variance
              <span title="Actual minus expected. Negative means money is missing; positive means money arrived that was never recorded."
                className="cursor-help text-gray-300 hover:text-gray-500"><Info className="h-3.5 w-3.5" /></span>
            </h3>
          </div>
          <div className="px-5 py-4">
            {!verification ? (
              <p className="m-0 text-[13px] font-semibold text-gray-500">
                Verify the week's closing cash to see whether anything is missing.
              </p>
            ) : (
              <>
                <p className={`m-0 text-3xl font-black ${Math.abs(variance) <= 0.5 ? "text-emerald-600" : "text-rose-600"}`}>
                  {signedNaira(variance)}
                </p>
                <p className="m-0 mt-0.5 text-[12px] font-semibold text-gray-500">Actual – Expected</p>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-gray-200/70 pt-3">
                  <span className="text-[11px] font-black uppercase tracking-wide text-gray-500">Status</span>
                  <StatusChip status={status} />
                </div>

                <div className="mt-4">
                  <p className="m-0 text-[11px] font-black uppercase tracking-wide text-gray-500">Variance Breakdown</p>
                  <dl className="m-0 mt-2 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="m-0 text-[12px] font-semibold text-gray-600">Unexplained Difference</dt>
                      <dd className="m-0 text-[12px] font-black text-rose-600">
                        {unexplained === 0 ? "₦0" : signedNaira(variance < 0 ? -unexplained : unexplained)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="m-0 text-[12px] font-semibold text-gray-600">Investigated</dt>
                      <dd className="m-0 text-[12px] font-black text-gray-900">{investigation ? "Yes" : "₦0"}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="m-0 text-[12px] font-semibold text-gray-600">Explained</dt>
                      <dd className="m-0 text-[12px] font-black text-emerald-600">{naira(explained)}</dd>
                    </div>
                  </dl>
                </div>

                {Math.abs(variance) > 0.5 && (
                  <div className="mt-4 border-t border-gray-200/70 pt-3">
                    <p className="m-0 text-[11px] font-black uppercase tracking-wide text-gray-500">Action required:</p>
                    <p className="m-0 mt-1 text-[12px] font-semibold text-gray-600">
                      {status === "resolved"
                        ? "Resolved. The money is still missing, but it is now accounted for."
                        : "Review and resolve the variance before closing the week."}
                    </p>
                    <button type="button" onClick={() => setInvestigateOpen(true)}
                      className="!min-h-0 mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-300 bg-white px-3.5 py-2.5 text-[13px] font-bold text-rose-600 hover:bg-rose-50">
                      <Search className="h-4 w-4" /> {investigation ? "Continue Investigation" : "Investigate Variance"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      {/* Week activity */}
      <SectionCard title="Cash Flow Summary For The Week">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {[
            { label: "Total Orders", value: String(view?.activity.ordersPlaced ?? 0), hint: "Placed this week", icon: ClipboardList, tone: "bg-blue-50 text-blue-600" },
            { label: "Delivered Orders", value: String(view?.activity.ordersDelivered ?? 0), hint: `DR: ${(view?.activity.deliveryRatePct ?? 0).toFixed(2)}%`, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600" },
            { label: "Agent Remittances", value: naira(view?.activity.agentRemittances ?? 0), hint: `${(view?.activity.remittanceCoveragePct ?? 0).toFixed(2)}% of delivered value`, icon: Users, tone: "bg-violet-50 text-violet-600" },
            { label: "Ad Spend", value: naira(view?.activity.adSpend ?? 0), hint: `${(view?.activity.adSpendPct ?? 0).toFixed(2)}% of cash out`, icon: ArrowUpRight, tone: "bg-rose-50 text-rose-600" },
            { label: "Stock Purchases", value: naira(view?.activity.stockPurchases ?? 0), hint: `${(view?.activity.stockPurchasesPct ?? 0).toFixed(2)}% of cash out`, icon: Banknote, tone: "bg-amber-50 text-amber-600" },
            { label: "Other Expenses", value: naira(view?.activity.otherExpenses ?? 0), hint: `${(view?.activity.otherExpensesPct ?? 0).toFixed(2)}% of cash out`, icon: CalendarDays, tone: "bg-gray-100 text-gray-600" }
          ].map((tile) => {
            const Icon = tile.icon;
            return (
              <div key={tile.label} className="rounded-xl border border-gray-200 px-3 py-3">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tile.tone}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <p className="m-0 mt-2 text-[11px] font-bold text-gray-500">{tile.label}</p>
                <p className="m-0 mt-0.5 text-base font-black text-gray-900">{tile.value}</p>
                <p className="m-0 text-[11px] font-semibold text-gray-400">{tile.hint}</p>
              </div>
            );
          })}
        </div>
        {(view?.activity.stockPurchases ?? 0) === 0 && (
          <p className="m-0 mt-3 flex gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] font-semibold text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            No stock purchases were recorded this week. Buying inventory has never been logged as an expense, so this reads
            ₦0 rather than the real outflow — a variance here may simply be stock that was paid for and never entered.
          </p>
        )}
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Recent Cash Flow Highlights">
          <ul className="m-0 list-none space-y-0 p-0">
            {[
              { key: "in", label: "Highest Cash In", row: view?.highlights.topCashIn, icon: ArrowDownLeft, tone: "bg-emerald-50 text-emerald-600", amountTone: "text-emerald-600" },
              { key: "out", label: "Highest Cash Out", row: view?.highlights.topCashOut, icon: ArrowUpRight, tone: "bg-rose-50 text-rose-600", amountTone: "text-rose-600" },
              { key: "tx", label: "Largest Transfer", row: view?.highlights.topTransfer, icon: ArrowLeftRight, tone: "bg-blue-50 text-blue-600", amountTone: "text-gray-900" }
            ].map((entry) => {
              const Icon = entry.icon;
              return (
                <li key={entry.key} className="flex items-center justify-between gap-3 border-b border-gray-50 py-3 last:border-0">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${entry.tone}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-bold text-gray-900">{entry.label}</span>
                      <span className="block truncate text-[12px] font-medium text-gray-500">
                        {entry.row ? `${entry.row.label} on ${stamp(entry.row.at).split(" · ")[0]}` : "Nothing recorded this week"}
                      </span>
                    </span>
                  </span>
                  <span className={`shrink-0 text-[13px] font-black ${entry.amountTone}`}>
                    {entry.row ? naira(entry.row.amount) : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </SectionCard>

        <SectionCard title="What Affects This Reconciliation?">
          <ul className="m-0 list-none space-y-3 p-0">
            {[
              { icon: CheckCircle2, tone: "text-emerald-600", title: "Cash In", body: "Agent remittances, refunds, reimbursements, other inflows" },
              { icon: AlertTriangle, tone: "text-rose-600", title: "Cash Out", body: "Ads, stock purchases, logistics, payroll, bills, other expenses" },
              { icon: ArrowLeftRight, tone: "text-blue-600", title: "Internal Transfers", body: "Moving money between your own accounts (no cash flow impact)" },
              { icon: Circle, tone: "text-amber-600", title: "Items Outside Bank", body: "COD with agents, inventory, receivables & prepaid expenses" }
            ].map((entry) => {
              const Icon = entry.icon;
              return (
                <li key={entry.title} className="flex gap-2.5">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${entry.tone}`} />
                  <span>
                    <span className="block text-[13px] font-bold text-gray-900">{entry.title}</span>
                    <span className="block text-[12px] font-medium text-gray-500">{entry.body}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      </div>

      {verifyOpen && view && (
        <VerifyClosingCashModal
          view={view} saving={props.saving}
          onClose={() => setVerifyOpen(false)}
          onSave={async (body) => { await props.onSaveVerification(body); setVerifyOpen(false); }}
          onInvestigate={async (body) => {
            await props.onSaveVerification(body);
            setVerifyOpen(false);
            setInvestigateOpen(true);
          }}
        />
      )}

      {investigateOpen && view && verification && (
        <VarianceInvestigationModal
          view={view} variance={variance} saving={props.saving}
          onClose={() => setInvestigateOpen(false)}
          onSave={async (body) => { await props.onSaveInvestigation(body); setInvestigateOpen(false); }}
        />
      )}

      {historyOpen && (
        <ReconciliationHistoryModal
          weeks={props.history}
          onPick={(week) => { props.onWeekChange(week); setHistoryOpen(false); }}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

// ── Verify Closing Cash ───────────────────────────────────

type CountRow = {
  key: string;
  bankAccountId: string | null;
  accountLabel: string;
  accountType: "bank" | "cash";
  bankName: string;
  accountNumberLast4: string;
  systemBalance: number;
  actual: string;
};

function VerifyClosingCashModal({ view, saving, onClose, onSave, onInvestigate }: {
  view: WeeklyReconciliationView;
  saving: boolean;
  onClose: () => void;
  onSave: (body: { weekStart: string; status: "draft" | "verified"; notes: string; accounts: VerificationAccountEntry[] }) => Promise<void>;
  onInvestigate: (body: { weekStart: string; status: "draft" | "verified"; notes: string; accounts: VerificationAccountEntry[] }) => Promise<void>;
}) {
  const [rows, setRows] = useState<CountRow[]>(() => {
    const existing = new Map((view.verification?.accounts ?? []).map((row) => [row.bankAccountId ?? row.accountLabel, row]));
    const fromAccounts: CountRow[] = view.accounts.map((account) => ({
      key: account.id,
      bankAccountId: account.id,
      accountLabel: account.name,
      accountType: account.accountType,
      bankName: account.bankName,
      accountNumberLast4: account.accountNumberLast4,
      systemBalance: account.systemBalance,
      // Pre-filling with the system figure would invite a blind confirm, so a
      // never-counted account starts EMPTY and must be typed.
      actual: existing.has(account.id) ? String(existing.get(account.id)!.actualBalance) : ""
    }));
    const extras: CountRow[] = (view.verification?.accounts ?? [])
      .filter((row) => !row.bankAccountId)
      .map((row, index) => ({
        key: `extra-${index}`,
        bankAccountId: null,
        accountLabel: row.accountLabel,
        accountType: "cash",
        bankName: "",
        accountNumberLast4: "",
        systemBalance: row.systemBalance,
        actual: String(row.actualBalance)
      }));
    return [...fromAccounts, ...extras];
  });
  const [notes, setNotes] = useState(view.verification?.notes ?? "");
  const [error, setError] = useState("");

  const parsed = rows.map((row) => {
    const actual = Number(String(row.actual).replace(/,/g, ""));
    const hasValue = String(row.actual).trim() !== "" && Number.isFinite(actual);
    return { row, actual: hasValue ? actual : 0, hasValue, difference: (hasValue ? actual : 0) - row.systemBalance };
  });
  const counted = parsed.filter((entry) => entry.hasValue);
  const totalSystem = rows.reduce((sum, row) => sum + row.systemBalance, 0);
  const totalActual = counted.reduce((sum, entry) => sum + entry.actual, 0);
  const variance = totalActual - totalSystem;
  const matched = counted.filter((entry) => Math.abs(entry.difference) <= 0.5).length;
  const allCounted = counted.length === rows.length && rows.length > 0;

  const payload = (status: "draft" | "verified") => ({
    weekStart: view.weekStart,
    status,
    notes,
    accounts: parsed.map((entry) => ({
      bankAccountId: entry.row.bankAccountId,
      accountLabel: entry.row.accountLabel,
      systemBalance: entry.row.systemBalance,
      actualBalance: entry.actual
    }))
  });

  const submit = async (status: "draft" | "verified", then: "close" | "investigate") => {
    setError("");
    if (rows.length === 0) { setError("Add at least one account to count."); return; }
    if (status === "verified" && !allCounted) {
      setError("Enter the actual balance for every account before verifying.");
      return;
    }
    try {
      if (then === "investigate") await onInvestigate(payload(status));
      else await onSave(payload(status));
    } catch (saveError: any) {
      setError(saveError?.message ?? "Could not save the count.");
    }
  };

  return (
    <Modal
      title="Verify Closing Cash"
      subtitle="Enter the actual balances in all business accounts and cash in hand as at the end of the week."
      icon={ShieldCheck} width="max-w-6xl" onClose={onClose}
      footer={
        <>
          {error && <p className="m-0 mr-auto text-[12px] font-bold text-rose-600">{error}</p>}
          <button type="button" onClick={onClose}
            className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={() => void submit("draft", "close")}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-[#1F8FE0] bg-white px-4 py-2.5 text-sm font-bold text-[#1F8FE0] hover:bg-blue-50 disabled:opacity-50">
            <FileText className="h-4 w-4" /> Save & Continue Later
          </button>
          {Math.abs(variance) > 0.5 && allCounted ? (
            <button type="button" disabled={saving} onClick={() => void submit("verified", "investigate")}
              className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">
              <Search className="h-4 w-4" /> Start Variance Investigation
            </button>
          ) : (
            <button type="button" disabled={saving || !allCounted} onClick={() => void submit("verified", "close")}
              className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
              <Check className="h-4 w-4" /> Confirm Closing Cash
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-stretch gap-3 rounded-2xl bg-gray-50 p-4">
        <span className="flex flex-1 items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-blue-600">
            <CalendarDays className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[14px] font-black text-gray-900">Week Ending: {fullDay(view.weekEnd)}</span>
            <span className="block text-[12px] font-semibold text-gray-500">Compare system balances with actual verified balances.</span>
          </span>
        </span>
        <p className="m-0 flex max-w-md flex-1 gap-2 rounded-xl bg-blue-50 px-3 py-3 text-[12px] font-semibold text-blue-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="block font-black">Why verify closing cash?</span>
            This ensures your books match reality and helps identify missing or unrecorded transactions before closing the week.
          </span>
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-gray-200">
          <h4 className="m-0 border-b border-gray-100 px-4 py-3 text-[12px] font-black uppercase tracking-wide text-gray-700">
            Verify Account Balances
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] font-black uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5">Account</th>
                  <th className="px-4 py-2.5 text-right">System Balance (₦)</th>
                  <th className="px-4 py-2.5 text-right">Actual Balance (₦)</th>
                  <th className="px-4 py-2.5 text-right">Difference (₦)</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((entry, index) => (
                  <tr key={entry.row.key} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2.5">
                        <AccountMark account={{ accountType: entry.row.accountType, bankName: entry.row.bankName, name: entry.row.accountLabel }} />
                        <span className="min-w-0">
                          {entry.row.bankAccountId ? (
                            <span className="block truncate text-[13px] font-bold text-gray-900">{entry.row.accountLabel}</span>
                          ) : (
                            <input value={entry.row.accountLabel} placeholder="Account or wallet name"
                              onChange={(event) => setRows((prev) => prev.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, accountLabel: event.target.value } : row))}
                              className="block w-40 rounded-lg border border-gray-200 px-2 py-1 text-[13px] font-bold text-gray-900" />
                          )}
                          <span className="block text-[11px] font-semibold text-gray-400">
                            {entry.row.accountNumberLast4
                              ? `${entry.row.bankName || "Account"} ****${entry.row.accountNumberLast4}`
                              : entry.row.accountType === "cash" ? "Physical cash" : entry.row.bankName || "Account"}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[13px] font-bold text-gray-700">{naira(entry.row.systemBalance)}</td>
                    <td className="px-4 py-3 text-right">
                      <input inputMode="decimal" value={entry.row.actual} placeholder="0"
                        onChange={(event) => setRows((prev) => prev.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, actual: event.target.value } : row))}
                        className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-right text-[13px] font-bold text-gray-900" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {entry.hasValue ? (
                        <span className="inline-flex items-center gap-2">
                          <span className={`text-[13px] font-black ${Math.abs(entry.difference) <= 0.5 ? "text-emerald-600" : "text-rose-600"}`}>
                            {signedNaira(entry.difference)}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${Math.abs(entry.difference) <= 0.5 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                            {Math.abs(entry.difference) <= 0.5 ? "Matched" : "Mismatch"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[12px] font-semibold text-gray-400">Not counted</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button"
            onClick={() => setRows((prev) => [...prev, {
              key: `extra-${Date.now()}`, bankAccountId: null, accountLabel: "",
              accountType: "cash", bankName: "", accountNumberLast4: "", systemBalance: 0, actual: ""
            }])}
            className="!min-h-0 m-3 inline-flex w-[calc(100%-1.5rem)] items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-2.5 text-[13px] font-bold text-[#1F8FE0] hover:bg-blue-50">
            + Add Additional Account / Wallet
          </button>
          <div className="px-4 pb-4">
            <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
              Notes (Optional)
              <textarea value={notes} maxLength={250} rows={3}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Add any notes about the closing cash verification..."
                className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-medium text-gray-900" />
            </label>
            <p className="m-0 mt-1 text-right text-[11px] font-semibold text-gray-400">{notes.length} / 250</p>
          </div>
        </div>

        <aside className="rounded-2xl border border-gray-200">
          <h4 className="m-0 border-b border-gray-100 px-4 py-3 text-[12px] font-black uppercase tracking-wide text-gray-700">
            Closing Cash Summary
          </h4>
          <div className="space-y-3 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-semibold text-gray-600">Total System Balance</span>
              <span className="text-[13px] font-black text-gray-900">{naira(totalSystem)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-semibold text-gray-600">Total Actual Balance</span>
              <span className="text-[13px] font-black text-[#1F8FE0]">{naira(totalActual)}</span>
            </div>
            <div className="border-t border-gray-100 pt-3">
              <span className="block text-[12px] font-semibold text-gray-600">Cash Variance (Actual – System)</span>
              <span className={`mt-1 block text-2xl font-black ${Math.abs(variance) <= 0.5 ? "text-emerald-600" : "text-rose-600"}`}>
                {signedNaira(variance)}
              </span>
              <span className="mt-1.5 inline-block">
                <StatusChip status={!allCounted ? "not_verified" : Math.abs(variance) <= 0.5 ? "balanced" : "needs_investigation"} />
              </span>
            </div>
            <dl className="m-0 space-y-2 border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between gap-3">
                <dt className="m-0 text-[12px] font-semibold text-gray-600">Matched Accounts</dt>
                <dd className="m-0 text-[12px] font-black text-gray-900">{matched}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="m-0 text-[12px] font-semibold text-gray-600">Mismatched Accounts</dt>
                <dd className="m-0 text-[12px] font-black text-gray-900">{counted.length - matched}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="m-0 text-[12px] font-semibold text-gray-600">Total Accounts</dt>
                <dd className="m-0 text-[12px] font-black text-gray-900">{rows.length}</dd>
              </div>
            </dl>
            <p className="m-0 flex gap-2 rounded-xl bg-blue-50 px-3 py-3 text-[12px] font-semibold text-blue-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              A variance means some cash is missing, unrecorded, or classified incorrectly. Please investigate before closing the week.
            </p>
          </div>
        </aside>
      </div>

      {Math.abs(variance) > 0.5 && allCounted && (
        <p className="m-0 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] font-bold text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Do not close the week until the variance is fully explained or adjusted.
        </p>
      )}
    </Modal>
  );
}

// ── Variance Investigation ────────────────────────────────

function VarianceInvestigationModal({ view, variance, saving, onClose, onSave }: {
  view: WeeklyReconciliationView;
  variance: number;
  saving: boolean;
  onClose: () => void;
  onSave: (body: {
    weekStart: string; status: "in_progress" | "submitted" | "resolved";
    reason: string | null; amountExplained: number; description: string;
    occurredOn: string | null; category: string; evidenceName: string; evidenceUrl: string;
  }) => Promise<void>;
}) {
  const existing = view.investigation;
  const [reason, setReason] = useState<string>(existing?.reason ?? "");
  const [amountExplained, setAmountExplained] = useState(
    existing?.amountExplained ? String(existing.amountExplained) : "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [occurredOn, setOccurredOn] = useState(existing?.occurredOn ?? "");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [evidenceName, setEvidenceName] = useState(existing?.evidenceName ?? "");
  const [error, setError] = useState("");

  const total = Math.abs(variance);
  const explainedRaw = Number(String(amountExplained).replace(/,/g, ""));
  const explained = Math.min(Math.max(Number.isFinite(explainedRaw) ? explainedRaw : 0, 0), total);
  const unexplained = Math.max(total - explained, 0);
  const pct = total <= 0.5 ? 100 : Math.round((explained / total) * 100);

  const submit = async (status: "in_progress" | "submitted" | "resolved") => {
    setError("");
    if (status !== "in_progress" && !description.trim()) {
      setError("Add an explanation before submitting.");
      return;
    }
    try {
      await onSave({
        weekStart: view.weekStart, status,
        reason: reason || null, amountExplained: explained, description,
        occurredOn: occurredOn || null, category, evidenceName, evidenceUrl: ""
      });
    } catch (saveError: any) {
      setError(saveError?.message ?? "Could not save the investigation.");
    }
  };

  return (
    <Modal
      title="Variance Investigation"
      subtitle={`Investigate and explain the cash variance for the week ending ${fullDay(view.weekEnd)}.`}
      icon={Search} width="max-w-6xl" onClose={onClose}
      footer={
        <>
          {error && <p className="m-0 mr-auto text-[12px] font-bold text-rose-600">{error}</p>}
          <button type="button" onClick={onClose}
            className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={() => void submit("in_progress")}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <FileText className="h-4 w-4" /> Save Draft
          </button>
          <button type="button" disabled={saving} onClick={() => void submit(unexplained <= 0.5 ? "resolved" : "submitted")}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
            <CheckCircle2 className="h-4 w-4" /> {unexplained <= 0.5 ? "Resolve Variance" : "Submit Investigation"}
          </button>
        </>
      }
    >
      <div className="grid gap-3 rounded-2xl bg-gray-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <span className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-blue-600">
            <CalendarDays className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[11px] font-black uppercase tracking-wide text-gray-500">Week Period</span>
            <span className="block text-[13px] font-black text-gray-900">{dayLabel(view.weekStart)} – {fullDay(view.weekEnd)}</span>
          </span>
        </span>
        <span>
          <span className="block text-[11px] font-black uppercase tracking-wide text-gray-500">Expected Closing Cash</span>
          <span className="block text-[15px] font-black text-gray-900">{naira(view.verification?.expectedClosing ?? 0)}</span>
        </span>
        <span>
          <span className="block text-[11px] font-black uppercase tracking-wide text-gray-500">Actual Closing Cash</span>
          <span className="block text-[15px] font-black text-gray-900">{naira(view.verification?.actualClosing ?? 0)}</span>
        </span>
        <span>
          <span className="block text-[11px] font-black uppercase tracking-wide text-gray-500">Cash Variance</span>
          <span className="block text-[15px] font-black text-rose-600">
            {signedNaira(variance)}
            <span className="ml-1.5 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-700">
              {unexplained <= 0.5 ? "Explained" : "Unexplained"}
            </span>
          </span>
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 px-4 py-4">
            <h4 className="m-0 flex items-center gap-2 text-[12px] font-black uppercase tracking-wide text-gray-700">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-[10px] text-violet-700">1</span>
              Variance Details
            </h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <span>
                <span className="block text-[11px] font-bold text-gray-500">Variance Amount</span>
                <span className="block text-2xl font-black text-rose-600">{signedNaira(variance)}</span>
                <span className="block text-[11px] font-semibold text-gray-400">
                  {variance < 0 ? "Actual is less than expected" : "Actual is more than expected"}
                </span>
              </span>
              <span>
                <span className="block text-[11px] font-bold text-gray-500">Investigation Status</span>
                <span className="mt-1 inline-block">
                  <StatusChip status={unexplained <= 0.5 ? "resolved" : "investigating"} />
                </span>
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 px-4 py-4">
            <h4 className="m-0 flex items-center gap-2 text-[12px] font-black uppercase tracking-wide text-gray-700">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-[10px] text-violet-700">2</span>
              Select Possible Reason
            </h4>
            <p className="m-0 mt-1 text-[12px] font-semibold text-gray-500">Choose the primary reason for this variance.</p>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {REASONS.map((entry) => {
                const Icon = entry.icon;
                const active = reason === entry.key;
                return (
                  <button key={entry.key} type="button" onClick={() => setReason(entry.key)}
                    className={`!min-h-0 rounded-xl border px-3 py-3 text-left transition-colors ${active ? "border-violet-400 bg-violet-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
                    <span className="flex items-start gap-2">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${entry.tone}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span>
                        <span className="block text-[12px] font-black text-gray-900">{entry.label}</span>
                        <span className="block text-[11px] font-medium text-gray-500">{entry.hint}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 px-4 py-4">
            <h4 className="m-0 flex items-center gap-2 text-[12px] font-black uppercase tracking-wide text-gray-700">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-[10px] text-violet-700">3</span>
              Investigation Details
            </h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="m-0 block text-[11px] font-bold text-gray-500">
                Amount Explained (₦)
                <input inputMode="decimal" value={amountExplained} placeholder="0"
                  onChange={(event) => setAmountExplained(event.target.value)}
                  className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-bold text-gray-900" />
              </label>
              <span>
                <span className="block text-[11px] font-bold text-gray-500">Unexplained Amount (₦)</span>
                <span className="mt-1 block text-xl font-black text-rose-600">{naira(unexplained)}</span>
              </span>
            </div>
            <label className="m-0 mt-3 block text-[11px] font-bold text-gray-500">
              Description / Explanation *
              <textarea value={description} maxLength={500} rows={4}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What happened to the money?"
                className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-medium text-gray-900" />
            </label>
            <p className="m-0 text-right text-[11px] font-semibold text-gray-400">{description.length} / 500</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="m-0 block text-[11px] font-bold text-gray-500">
                Date of Occurrence
                <input type="date" value={occurredOn} min={view.weekStart} max={view.weekEnd}
                  onChange={(event) => setOccurredOn(event.target.value)}
                  className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-bold text-gray-900" />
              </label>
              <label className="m-0 block text-[11px] font-bold text-gray-500">
                Category (Optional)
                <select value={category} onChange={(event) => setCategory(event.target.value)}
                  className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-bold text-gray-900">
                  <option value="">Select category</option>
                  <option value="Ad Spend">Ad Spend</option>
                  <option value="Stock Purchase">Stock Purchase</option>
                  <option value="Delivery">Delivery</option>
                  <option value="Salary">Salary</option>
                  <option value="Bank Charges">Bank Charges</option>
                  <option value="Other">Other</option>
                </select>
              </label>
            </div>
            <div className="mt-3">
              <span className="block text-[11px] font-bold text-gray-500">Evidence / Supporting Document (Optional)</span>
              {/* Name only for now: there is no document store wired up yet, and
                  a fake upload control that silently discards the file would be
                  worse than asking for the reference. */}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                  <Upload className="h-4 w-4" />
                </span>
                <input value={evidenceName} onChange={(event) => setEvidenceName(event.target.value)}
                  placeholder="Reference the receipt or statement, e.g. Meta Ads Receipt – Aug 22"
                  className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-medium text-gray-900" />
              </div>
              <p className="m-0 mt-1 text-[11px] font-semibold text-gray-400">
                File storage is not wired up yet — record where the document lives so it can be found.
              </p>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-gray-200 px-4 py-4">
            <h4 className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-700">Variance Summary</h4>
            <dl className="m-0 mt-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <dt className="m-0 text-[12px] font-semibold text-gray-600">Expected Closing Cash</dt>
                <dd className="m-0 text-[12px] font-black text-gray-900">{naira(view.verification?.expectedClosing ?? 0)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="m-0 text-[12px] font-semibold text-gray-600">Actual Closing Cash</dt>
                <dd className="m-0 text-[12px] font-black text-gray-900">{naira(view.verification?.actualClosing ?? 0)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-2">
                <dt className="m-0 text-[12px] font-semibold text-gray-600">Cash Variance</dt>
                <dd className="m-0 text-base font-black text-rose-600">{signedNaira(variance)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="m-0 text-[12px] font-semibold text-gray-600">Explained Amount</dt>
                <dd className="m-0 text-[12px] font-black text-emerald-600">+{naira(explained)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="m-0 text-[12px] font-semibold text-gray-600">Unexplained Amount</dt>
                <dd className="m-0 text-[12px] font-black text-rose-600">{naira(unexplained)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-gray-200 px-4 py-4">
            <h4 className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-700">Investigation Progress</h4>
            <div className="mt-3 flex items-center gap-2">
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </span>
              <span className="text-[12px] font-black text-gray-700">{pct}%</span>
            </div>
            <dl className="m-0 mt-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <dt className="m-0 inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-600">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Explained
                </dt>
                <dd className="m-0 text-[12px] font-black text-gray-900">{naira(explained)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="m-0 inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-600">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> Unexplained
                </dt>
                <dd className="m-0 text-[12px] font-black text-rose-600">{naira(unexplained)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="m-0 inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-600">
                  <span className="h-2 w-2 rounded-full bg-gray-300" /> Total Variance
                </dt>
                <dd className="m-0 text-[12px] font-black text-gray-900">{naira(total)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-gray-200 px-4 py-4">
            <h4 className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-700">Investigation History</h4>
            {(existing?.events ?? []).length === 0 ? (
              <p className="m-0 mt-2 text-[12px] font-semibold text-gray-500">Nothing recorded yet.</p>
            ) : (
              <ol className="m-0 mt-3 list-none space-y-3 p-0">
                {(existing?.events ?? []).map((event) => (
                  <li key={event.id} className="flex gap-2.5">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-violet-500" />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold text-gray-400">{stamp(event.createdAt)}</span>
                      <span className="block text-[12px] font-bold text-gray-900">
                        {EVENT_LABEL[event.kind] ?? event.kind}
                        {event.amount !== null && ` · ${naira(event.amount)}`}
                      </span>
                      {event.detail && <span className="block truncate text-[11px] font-medium text-gray-500">{event.detail}</span>}
                      {event.actorName && <span className="block text-[11px] font-medium text-gray-400">by {event.actorName}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
    </Modal>
  );
}

// ── Reconciliation history ────────────────────────────────

function ReconciliationHistoryModal({ weeks, onPick, onClose }: {
  weeks: ReconciliationHistoryWeek[];
  onPick: (weekStart: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Reconciliation History" subtitle="Every week that has been counted, newest first."
      icon={History} width="max-w-3xl" onClose={onClose}
      footer={
        <button type="button" onClick={onClose}
          className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">
          Close
        </button>
      }
    >
      {weeks.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-[13px] font-semibold text-gray-500">
          No week has been reconciled yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] font-black uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2.5">Week</th>
                <th className="px-3 py-2.5 text-right">Expected</th>
                <th className="px-3 py-2.5 text-right">Actual</th>
                <th className="px-3 py-2.5 text-right">Variance</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Counted by</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week.id} className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50"
                  onClick={() => onPick(week.weekStart)}>
                  <td className="px-3 py-3 text-[13px] font-bold text-gray-900">
                    {dayLabel(week.weekStart)} – {dayLabel(week.weekEnd)}
                  </td>
                  <td className="px-3 py-3 text-right text-[13px] font-semibold text-gray-700">{naira(week.expectedClosing)}</td>
                  <td className="px-3 py-3 text-right text-[13px] font-semibold text-gray-700">{naira(week.actualClosing)}</td>
                  <td className={`px-3 py-3 text-right text-[13px] font-black ${Math.abs(week.variance) <= 0.5 ? "text-emerald-600" : "text-rose-600"}`}>
                    {signedNaira(week.variance)}
                  </td>
                  <td className="px-3 py-3"><StatusChip status={week.status} /></td>
                  <td className="px-3 py-3 text-[12px] font-semibold text-gray-500">{week.verifiedByName || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
