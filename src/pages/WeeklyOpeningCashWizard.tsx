import { useMemo, useState } from "react";
import {
  ArrowRight, BadgeCheck, CalendarDays, CheckCircle2, Info, Lock, Plus, Sparkles, X
} from "lucide-react";
// ⚠️ Shared formatters, NOT a local `naira()`. A private one silently
// ignores the topbar "hide money" toggle - which is exactly how these
// pages kept showing real figures with privacy mode on.
import { naira } from "../lib/money-privacy";

// The gate on a new accounting week.
//
// Protohub accounts weekly, so every week has to START from a figure someone
// counted rather than one carried along by whatever happened to be recorded.
// Blocking is the point: an opening balance guessed at the end of the week is
// worthless, and last week's closing cash is only checkable if this week's
// opening was actually verified against the accounts.

export type WeeklyOpeningAccount = {
  id: string; name: string; bankName: string;
  accountType: "bank" | "cash"; accountNumberLast4: string; isPrimary: boolean;
};

export type WeeklyOpeningView = {
  weekStart: string;
  weekEnd: string;
  needsOpening: boolean;
  existing: {
    id: string; amount: number; effectiveAt: string; reason: string; setByName: string;
    sources: Array<{ bankAccountId: string | null; accountLabel: string; amount: number }>;
  } | null;
  accounts: WeeklyOpeningAccount[];
  previousWeek: { from: string; to: string; closingCash: number };
  suggestedWeekStart: string;
};

type SourceDraft = { key: string; bankAccountId: string | null; accountLabel: string; amount: string };

const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
const weekdayLabel = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short" });

const BRAND: Array<{ match: RegExp; label: string; bg: string }> = [
  { match: /opay/i, label: "O", bg: "bg-[#1DCF9F]" },
  { match: /moniepoint/i, label: "M", bg: "bg-[#0357EE]" },
  { match: /palmpay/i, label: "P", bg: "bg-[#7B2FF7]" },
  { match: /kuda/i, label: "K", bg: "bg-[#40196D]" },
  { match: /gt ?bank|guaranty/i, label: "GT", bg: "bg-[#DD4B24]" },
  { match: /access/i, label: "A", bg: "bg-[#E8600F]" },
  { match: /zenith/i, label: "Z", bg: "bg-[#E4032E]" }
];

function SourceMark({ label, isCash }: { label: string; isCash: boolean }) {
  if (isCash) {
    return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-[13px] font-black text-amber-700">₦</span>;
  }
  const brand = BRAND.find((entry) => entry.match.test(label));
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-black text-white ${brand?.bg ?? "bg-blue-500"}`}>
      {brand?.label ?? label.trim().charAt(0).toUpperCase() ?? "B"}
    </span>
  );
}

export type WeeklyOpeningCashWizardProps = {
  view: WeeklyOpeningView;
  saving: boolean;
  /** Blocking weeks cannot be dismissed - the page behind is not usable yet. */
  blocking: boolean;
  onClose: () => void;
  /** Browse Cash Flow without opening the week. Nothing is recorded. */
  onPreview?: () => void;
  onSave: (body: { weekStart: string; reason: string; sources: Array<{ bankAccountId: string | null; accountLabel: string; amount: number }> }) => Promise<void>;
};

export default function WeeklyOpeningCashWizard({ view, saving, blocking, onClose, onPreview, onSave }: WeeklyOpeningCashWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [weekStart, setWeekStart] = useState(view.weekStart);
  // The accounting week officially starts on Sunday - the same anchor payroll,
  // bonuses and the scorecard use. Any date picked snaps to its Sunday, so a
  // cash week can never drift out of step with those.
  const snapToSunday = (key: string) => {
    const date = new Date(`${key}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return key;
    date.setUTCDate(date.getUTCDate() - date.getUTCDay());
    return date.toISOString().slice(0, 10);
  };
  const [reason, setReason] = useState(view.existing?.reason ?? "");
  const [sources, setSources] = useState<SourceDraft[]>(() => {
    if (view.existing && view.existing.sources.length > 0) {
      return view.existing.sources.map((source, index) => ({
        key: `saved-${index}`,
        bankAccountId: source.bankAccountId,
        accountLabel: source.accountLabel,
        amount: String(Math.round(source.amount))
      }));
    }
    return view.accounts.map((account) => ({
      key: account.id,
      bankAccountId: account.id,
      accountLabel: `${account.name}${account.bankName ? ` · ${account.bankName}` : ""}`,
      amount: ""
    }));
  });

  const total = useMemo(
    () => sources.reduce((sum, source) => sum + (Number(String(source.amount).replace(/[^\d.-]/g, "")) || 0), 0),
    [sources]
  );
  const change = total - view.previousWeek.closingCash;
  const anyFilled = sources.some((source) => String(source.amount).trim() !== "");
  const canConfirm = sources.length > 0 && anyFilled;

  const patch = (key: string, next: Partial<SourceDraft>) =>
    setSources((current) => current.map((source) => source.key === key ? { ...source, ...next } : source));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60" />
      <div className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-7 py-6">
          <div className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <CalendarDays className="h-5 w-5" />
            </span>
            <div>
              <h3 className="m-0 text-xl font-black text-gray-900">
                {view.existing ? "Update Opening Cash for This Week" : "Set Opening Cash for This Week"}
              </h3>
              <p className="m-0 mt-0.5 text-[13px] font-medium text-gray-500">
                Set the actual liquid cash available at the start of the week. This will be used as the opening balance for cash flow.
              </p>
            </div>
          </div>
          {!blocking && (
            <button type="button" onClick={onClose} aria-label="Close"
              className="!min-h-0 rounded-lg bg-transparent p-1 text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
          )}
        </div>

        {/* Steps */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-gray-100 px-7 py-4">
          {([
            { n: 1 as const, title: "Select Date", hint: "Choose the first day of the week" },
            { n: 2 as const, title: "Add Cash Sources", hint: "Add from your bank & cash accounts" },
            { n: 3 as const, title: "Review & Confirm", hint: "Confirm opening cash amount" }
          ]).map((entry, index) => (
            <div key={entry.n} className="flex flex-1 items-center gap-3">
              <button type="button" onClick={() => setStep(entry.n)}
                className={`!min-h-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-black ${
                  step === entry.n ? "bg-[#1F8FE0] text-white" : step > entry.n ? "bg-blue-100 text-[#1F8FE0]" : "bg-gray-100 text-gray-400"}`}>
                {entry.n}
              </button>
              <div className="min-w-0">
                <p className={`m-0 text-[13px] font-black ${step >= entry.n ? "text-[#1F8FE0]" : "text-gray-400"}`}>{entry.title}</p>
                <p className="m-0 text-[11px] font-medium text-gray-400">{entry.hint}</p>
              </div>
              {index < 2 && <span className="hidden h-px flex-1 bg-gray-200 lg:block" />}
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 gap-5 px-7 py-6 lg:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              {step === 1 && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">
                      Week start date
                      <input type="date" value={weekStart}
                        onChange={(event) => setWeekStart(snapToSunday(event.target.value))}
                        className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-black text-gray-900" />
                      <span className="mt-1 block text-[11px] font-medium normal-case tracking-normal text-gray-400">
                        Sunday · the official first day of your accounting week. Any date you pick snaps to its Sunday.
                      </span>
                    </label>
                    <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3.5 py-3">
                      <p className="m-0 flex items-center gap-1.5 text-[13px] font-black text-blue-900">
                        <Info className="h-4 w-4" /> Why opening cash matters
                      </p>
                      <p className="m-0 mt-1 text-[11px] font-medium leading-4 text-blue-900">
                        Opening cash is the actual money you have in bank accounts and cash in hand before any transactions for the week.
                      </p>
                    </div>
                  </div>
                  <p className="m-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12px] font-bold leading-4 text-emerald-900">
                    Weeks run Sunday to Saturday, the same as payroll, bonuses and the weekly scorecard — so every weekly figure in Protohub lines up.
                  </p>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="m-0 text-sm font-black text-gray-900">Add available cash sources</h4>
                      <p className="m-0 mt-0.5 text-[12px] font-medium text-gray-500">
                        Add the amounts available in your bank accounts and cash in hand as at the start of the week.
                      </p>
                    </div>
                    <button type="button"
                      onClick={() => setSources((current) => [...current, {
                        key: `manual-${Date.now()}`, bankAccountId: null, accountLabel: "", amount: ""
                      }])}
                      className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-[#1F8FE0] bg-white px-3 py-2 text-[12px] font-black text-[#1F8FE0] hover:bg-blue-50">
                      <Plus className="h-3.5 w-3.5" /> Add Cash Source
                    </button>
                  </div>

                  {sources.length === 0 ? (
                    <p className="m-0 rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-[13px] text-gray-400">
                      No cash sources yet. Add your accounts to continue.
                    </p>
                  ) : (
                    <ul className="m-0 list-none space-y-2 p-0">
                      {sources.map((source) => {
                        const account = view.accounts.find((entry) => entry.id === source.bankAccountId);
                        const isCash = account?.accountType === "cash";
                        return (
                          <li key={source.key} className="flex items-center gap-3 rounded-xl border border-gray-200 px-3.5 py-3">
                            <SourceMark label={source.accountLabel || "Bank"} isCash={Boolean(isCash)} />
                            <div className="min-w-0 flex-1">
                              {account ? (
                                <>
                                  <p className="m-0 truncate text-[13px] font-black text-gray-900">{account.name}</p>
                                  <p className="m-0 text-[11px] font-semibold text-gray-400">
                                    {account.accountType === "cash" ? "Physical cash available"
                                      : `${account.bankName}${account.accountNumberLast4 ? ` ****${account.accountNumberLast4}` : ""}`}
                                  </p>
                                </>
                              ) : (
                                <input value={source.accountLabel} placeholder="Name this cash source"
                                  onChange={(event) => patch(source.key, { accountLabel: event.target.value })}
                                  className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] font-bold text-gray-900" />
                              )}
                            </div>
                            <span className="relative flex w-[170px] shrink-0 items-center">
                              <span className="pointer-events-none absolute left-3 text-[13px] font-black text-gray-400">₦</span>
                              <input value={source.amount} inputMode="numeric" placeholder="0"
                                onChange={(event) => patch(source.key, { amount: event.target.value })}
                                className="w-full rounded-xl border border-gray-200 py-2.5 pl-7 pr-3 text-sm font-black text-gray-900" />
                            </span>
                            <button type="button" aria-label="Remove source"
                              onClick={() => setSources((current) => current.filter((entry) => entry.key !== source.key))}
                              className="!min-h-0 shrink-0 rounded-lg bg-transparent p-1 text-gray-300 hover:text-rose-600">
                              <X className="h-4 w-4" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <div className="flex gap-2 rounded-xl border border-dashed border-violet-200 bg-violet-50/60 px-3.5 py-3">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                    <p className="m-0 text-[12px] font-medium leading-5 text-violet-900">
                      <strong className="font-black">Only liquid cash counts.</strong> Do not include inventory, receivables, or money still with agents — none of that is cash you can spend this week.
                    </p>
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <h4 className="m-0 text-sm font-black text-gray-900">Confirm this week's opening cash</h4>
                  <ul className="m-0 list-none space-y-1.5 p-0">
                    {sources.map((source) => (
                      <li key={source.key} className="flex items-center justify-between gap-3 border-b border-gray-50 pb-1.5 text-[13px]">
                        <span className="truncate text-gray-600">{source.accountLabel || "Unnamed source"}</span>
                        <span className="shrink-0 font-black text-gray-900">
                          {naira(Number(String(source.amount).replace(/[^\d.-]/g, "")) || 0)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <label className="block text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">
                    Notes
                    <textarea value={reason} rows={3} onChange={(event) => setReason(event.target.value.slice(0, 250))}
                      placeholder="Counted against Opay and Moniepoint statements on Sunday morning."
                      className="mt-1.5 w-full resize-y rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-900" />
                    <span className="mt-1 block text-right text-[11px] font-semibold text-gray-400">{reason.length} / 250</span>
                  </label>
                  {Math.abs(change) > 0 && view.previousWeek.closingCash !== 0 && (
                    <p className="m-0 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[12px] font-medium leading-4 text-gray-600">
                      Last week closed at <strong className="font-black">{naira(view.previousWeek.closingCash)}</strong>.
                      {" "}A gap between that and what you counted means either a miscount or cash that never got recorded — worth knowing before you confirm.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Summary rail */}
            <aside className="space-y-4">
              <section className="rounded-2xl border border-gray-200 bg-gray-50/60 px-4 py-4">
                <h4 className="m-0 text-sm font-black text-gray-900">Opening Cash Summary</h4>
                <p className="m-0 mt-0.5 text-[11px] font-semibold text-gray-400">
                  Week of {dayLabel(weekStart)} – {dayLabel(view.weekEnd)}
                </p>
                <p className="m-0 mt-3 text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">Total opening cash</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  {/* ⚠️ Never render ₦0 at this size: the naira sign against a
                      zero reads as the word "NO" and looks like an answer to a
                      question nobody asked. Nothing entered yet says so. */}
                  {total > 0 ? (
                    <span className="text-3xl font-black text-emerald-600">{naira(total)}</span>
                  ) : (
                    <span className="text-xl font-black text-gray-400">Nothing entered yet</span>
                  )}
                  {canConfirm && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                      <BadgeCheck className="h-3 w-3" /> Ready
                    </span>
                  )}
                </div>
                <ul className="m-0 mt-3 list-none space-y-1.5 border-t border-gray-200 p-0 pt-3">
                  {sources.map((source) => (
                    <li key={source.key} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="truncate text-gray-500">{source.accountLabel || "Unnamed"}</span>
                      <span className="shrink-0 font-black text-gray-800">
                        {(Number(String(source.amount).replace(/[^\d.-]/g, "")) || 0) > 0
                          ? naira(Number(String(source.amount).replace(/[^\d.-]/g, "")) || 0)
                          : <span className="font-semibold text-gray-400">—</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <dl className="m-0 mt-3 space-y-1.5 border-t border-gray-200 pt-3 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-gray-500">Source count</dt>
                    <dd className="m-0 font-black text-gray-800">{sources.length}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="truncate text-gray-500">Last closing ({dayLabel(view.previousWeek.from)})</dt>
                    <dd className="m-0 shrink-0 font-black text-gray-800">{naira(view.previousWeek.closingCash)}</dd>
                  </div>
                </dl>
                {view.previousWeek.closingCash !== 0 && (
                  <p className={`m-0 mt-2 rounded-lg px-2.5 py-1.5 text-[11px] font-black ${change >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                    Change from last week {change >= 0 ? "+" : "−"}{naira(Math.abs(change))} {change >= 0 ? "↑" : "↓"}
                  </p>
                )}
              </section>

              <section className="rounded-2xl border border-violet-100 bg-violet-50/50 px-4 py-4">
                <p className="m-0 flex items-center gap-1.5 text-[13px] font-black text-violet-900">
                  <Sparkles className="h-4 w-4" /> What happens next?
                </p>
                <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                  {[
                    "This amount becomes your opening cash for the week",
                    "All cash flow calculations use it as the starting point",
                    "Closing cash for the week is measured from here",
                    "Every change is logged against your name"
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-1.5 text-[11px] font-medium leading-4 text-violet-900">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" /> {line}
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-7 py-4">
          <p className="m-0 text-[11px] font-medium text-gray-400">
            {blocking
              ? "This week has not been opened yet. Cash Flow stays locked until it is."
              : "You can update this at any time; each change is recorded."}
          </p>
          <div className="flex gap-2.5">
            {step > 1 && (
              <button type="button" onClick={() => setStep((current) => (current - 1) as 1 | 2 | 3)}
                className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13px] font-black text-gray-700 hover:bg-gray-50">
                Back
              </button>
            )}
            {!blocking && step === 1 && (
              <button type="button" onClick={onClose}
                className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13px] font-black text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
            )}
            {/* ⚠️ An escape for LOOKING, not for working. It records nothing,
                does not open the week, and is not remembered - the wizard is
                back on the next visit. The page behind it runs on a derived
                opening balance and says so on every screen. */}
            {blocking && step === 1 && onPreview && (
              <button type="button" onClick={onPreview}
                className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13px] font-black text-gray-600 hover:bg-gray-50">
                Skip for now — just looking
              </button>
            )}
            {step < 3 ? (
              <button type="button" onClick={() => setStep((current) => (current + 1) as 1 | 2 | 3)}
                disabled={step === 2 && !canConfirm}
                className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-[#1F8FE0] px-5 py-2.5 text-[13px] font-black text-white hover:bg-[#1a7ec4] disabled:opacity-50">
                {step === 1 ? "Add Cash Sources" : "Review & Confirm Opening Cash"} <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button type="button" disabled={saving || !canConfirm}
                onClick={() => void onSave({
                  weekStart,
                  reason: reason.trim(),
                  sources: sources.map((source) => ({
                    bankAccountId: source.bankAccountId,
                    accountLabel: source.accountLabel.trim() || "Unnamed source",
                    amount: Number(String(source.amount).replace(/[^\d.-]/g, "")) || 0
                  }))
                })}
                className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-[#1F8FE0] px-5 py-2.5 text-[13px] font-black text-white hover:bg-[#1a7ec4] disabled:opacity-50">
                {saving ? "Saving…" : `Confirm ${naira(total)} Opening Cash`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
