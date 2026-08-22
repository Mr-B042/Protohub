import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Banknote, Boxes, CalendarDays, Check, CheckCircle2, ChevronLeft,
  ChevronRight, Circle, ClipboardList, Cpu, Info, Landmark, Lock, RotateCcw,
  ShieldCheck, TrendingUp, UserCheck, Users, Wallet
} from "lucide-react";
import type { CloseCheckRow, PeriodCloseView } from "../lib/api";

// Weekly close: is this week actually finished?
//
// ⚠️ Two kinds of check and the difference is the point. AUTO checks are facts
// read from live data and cannot be ticked by hand. MANUAL checks are claims -
// someone asserts them and their name is recorded. Both are labelled so a
// reader can tell which greens are earned and which are asserted.

const naira = (value: number) => `₦${Math.round(Number(value) || 0).toLocaleString("en-NG")}`;
const signedNaira = (value: number) => {
  const rounded = Math.round(Number(value) || 0);
  if (rounded === 0) return "₦0";
  return `${rounded < 0 ? "−" : "+"}₦${Math.abs(rounded).toLocaleString("en-NG")}`;
};
const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { month: "short", day: "numeric" });
const fullDay = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
const stamp = (iso: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—"
    : date.toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
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

const GROUP_ORDER = [
  "trading", "cash_in", "cash_out", "bank_cash", "agents_cod", "inventory",
  "receivables", "payables", "reserves", "reports", "variance", "admin"
] as const;

const GROUP_LABEL: Record<string, string> = {
  trading: "Trading", cash_in: "Cash In", cash_out: "Cash Out", bank_cash: "Bank & Cash",
  agents_cod: "Agents & COD", inventory: "Inventory", receivables: "Receivables",
  payables: "Payables & Commitments", reserves: "Reserves", reports: "Reports & Analysis",
  variance: "Variance & Reconciliation", admin: "Admin & Control"
};

const GROUP_ICON: Record<string, typeof Info> = {
  trading: TrendingUp, cash_in: Banknote, cash_out: Wallet, bank_cash: Landmark,
  agents_cod: Users, inventory: Boxes, receivables: ClipboardList, payables: ClipboardList,
  reserves: Lock, reports: TrendingUp, variance: ShieldCheck, admin: UserCheck
};

export type PeriodCloseTabProps = {
  view: PeriodCloseView | null;
  loading: boolean;
  error: string;
  weekStart: string;
  onWeekChange: (weekStart: string) => void;
  saving: boolean;
  approvers: Array<{ id: string; name: string; role: string }>;
  onToggleCheck: (checkKey: string, done: boolean) => Promise<void>;
  onSave: (body: { closingNotes: string; approvedByUserId: string | null; status: "draft" | "closed" }) => Promise<void>;
  onReopen: () => Promise<void>;
};

export default function PeriodCloseTab(props: PeriodCloseTabProps) {
  const { view, loading, error, weekStart } = props;
  const [notes, setNotes] = useState("");
  const [approver, setApprover] = useState("");
  const isThisWeek = sundayOf(todayKey()) === weekStart;

  useEffect(() => {
    setNotes(view?.closingNotes ?? "");
  }, [view?.weekStart, view?.closingNotes]);

  const grouped = useMemo(() => {
    const checks = view?.progress.checks ?? [];
    return GROUP_ORDER
      .map((group) => ({ group, rows: checks.filter((row) => row.group === group) }))
      .filter((entry) => entry.rows.length > 0);
  }, [view]);

  const closed = view?.status === "closed";
  const progress = view?.progress;

  const strip = [
    { label: "Week to Close", value: view ? `${dayLabel(view.weekStart)} – ${fullDay(view.weekEnd)}` : "—", tone: "text-gray-900", icon: CalendarDays },
    { label: "Net Profit (Accrual)", value: naira(view?.profit.netProfit ?? 0), tone: (view?.profit.netProfit ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600", icon: TrendingUp },
    { label: "Expected Closing Cash", value: naira(view?.expectedClosingCash ?? 0), tone: "text-gray-900", icon: Wallet },
    { label: "Actual Closing Cash", value: view?.actualClosingCash ? naira(view.actualClosingCash) : "Not counted", tone: view?.actualClosingCash ? "text-gray-900" : "text-amber-600", icon: Landmark },
    { label: "Cash Variance", value: view?.actualClosingCash ? signedNaira(view.cashVariance) : "—", tone: view?.varianceSettled ? "text-emerald-600" : "text-rose-600", icon: ShieldCheck }
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-2xl font-black text-gray-900">
            Weekly Close / Period Lock
            <span title="Green ticks marked AUTO are worked out from your data and cannot be set by hand. Ticks marked MANUAL are someone's claim, recorded with their name."
              className="cursor-help text-gray-300 hover:text-gray-500"><Info className="h-4 w-4" /></span>
          </h2>
          <p className="m-0 mt-1 text-sm text-gray-500">Review all financial data, complete required checks, and close the week.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2 py-1.5">
            <button type="button" aria-label="Previous week" onClick={() => props.onWeekChange(addDays(weekStart, -7))}
              className="!min-h-0 rounded-lg bg-transparent p-1.5 text-gray-500 hover:bg-gray-50">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="inline-flex items-center gap-1.5 px-1">
              <CalendarDays className="h-4 w-4 text-blue-600" />
              <span className="text-[13px] font-black text-gray-900">
                {view ? `${dayLabel(view.weekStart)} – ${fullDay(view.weekEnd)}` : "—"}
              </span>
              {isThisWeek && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-black text-blue-700">This Week</span>}
            </span>
            <button type="button" aria-label="Next week" disabled={isThisWeek}
              onClick={() => props.onWeekChange(addDays(weekStart, 7))}
              className="!min-h-0 rounded-lg bg-transparent p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </span>
          {closed && (
            <button type="button" onClick={() => void props.onReopen()} disabled={props.saving}
              className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3.5 py-2.5 text-sm font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-50">
              <RotateCcw className="h-4 w-4" /> Reopen Week
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>
      )}

      {closed && (
        <p className="m-0 flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[13px] font-bold text-emerald-800">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          This week is closed and locked by {view?.closedByName || "—"} on {stamp(view?.closedAt ?? null)}
          {view?.approvedByName ? `, approved by ${view.approvedByName}` : ""}. Reopen it to make changes.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {strip.map((tile) => {
          const Icon = tile.icon;
          return (
            <div key={tile.label} className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-gray-500">
                <Icon className="h-3.5 w-3.5" /> {tile.label}
              </span>
              <p className={`m-0 mt-1 text-lg font-black ${tile.tone}`}>{tile.value}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-700">Weekly Close Checklist</h3>
              <span className="text-[12px] font-black text-gray-700">
                {progress?.completed ?? 0} / {progress?.total ?? 0} Completed
              </span>
            </div>
            <span className="mt-2 block h-2 overflow-hidden rounded-full bg-gray-100">
              <span className={`block h-full rounded-full ${progress?.canClose ? "bg-emerald-500" : "bg-[#1F8FE0]"}`}
                style={{ width: `${progress?.progressPct ?? 0}%` }} />
            </span>
            <p className="m-0 mt-2 text-[11px] font-semibold text-gray-400">
              <span className="inline-flex items-center gap-1"><Cpu className="h-3 w-3" /> {progress?.computedDone ?? 0}/{progress?.computedTotal ?? 0} worked out from your data</span>
              {" · "}
              <span className="inline-flex items-center gap-1"><UserCheck className="h-3 w-3" /> {progress?.manualDone ?? 0}/{progress?.manualTotal ?? 0} ticked by hand</span>
            </p>
          </div>

          {loading && !view ? (
            <p className="m-0 px-5 py-10 text-center text-[13px] font-semibold text-gray-500">Loading the week…</p>
          ) : (
            <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
              {grouped.map((entry) => {
                const Icon = GROUP_ICON[entry.group] ?? Info;
                const done = entry.rows.filter((row) => row.done).length;
                return (
                  <div key={entry.group} className="rounded-xl border border-gray-200 px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-gray-600">
                        <Icon className="h-3.5 w-3.5 text-violet-500" /> {GROUP_LABEL[entry.group]}
                      </span>
                      <span className={`text-[11px] font-black ${done === entry.rows.length ? "text-emerald-600" : "text-gray-400"}`}>
                        {done}/{entry.rows.length}
                      </span>
                    </div>
                    <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                      {entry.rows.map((row) => (
                        <CheckRow key={row.key} row={row} disabled={closed || props.saving}
                          onToggle={(next) => void props.onToggleCheck(row.key, next)} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          {progress && !progress.canClose && (
            <div className="border-t border-gray-100 px-5 py-4">
              <p className="m-0 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-[12px] font-bold text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="block">This week cannot be closed yet — {progress.blocking.length} required check
                    {progress.blocking.length === 1 ? " is" : "s are"} still outstanding:</span>
                  <span className="mt-1 block font-semibold">
                    {progress.blocking.map((row) => row.label).join(" · ")}
                  </span>
                </span>
              </p>
            </div>
          )}
          {progress?.canClose && !closed && (
            <div className="border-t border-gray-100 px-5 py-4">
              <p className="m-0 flex gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-[12px] font-bold text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                Every required check has passed. You can close the week — after closing, changes need the week reopened.
              </p>
            </div>
          )}

          <div className="grid gap-4 border-t border-gray-100 px-5 py-4 md:grid-cols-2">
            <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
              Closing Notes *
              <textarea value={notes} maxLength={500} rows={4} disabled={closed}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="How did the week go? Anything to flag before the books are locked?"
                className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-medium text-gray-900 disabled:bg-gray-50" />
              <span className="mt-1 block text-right text-[11px] font-semibold text-gray-400">{notes.length} / 500</span>
            </label>
            <div className="space-y-3">
              <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
                Manager Approval
                <select value={approver} disabled={closed}
                  onChange={(event) => setApprover(event.target.value)}
                  className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-bold text-gray-900 disabled:bg-gray-50">
                  <option value="">No second approver</option>
                  {props.approvers.map((person) => (
                    <option key={person.id} value={person.id}>{person.name} · {person.role}</option>
                  ))}
                </select>
              </label>
              <div className="rounded-xl bg-gray-50 px-3 py-3">
                <p className="m-0 text-[11px] font-black uppercase tracking-wide text-gray-500">Closing Effects</p>
                <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
                  {[
                    "The week is locked and the checklist stops accepting changes.",
                    "The figures above are frozen, so a backdated entry cannot restate it.",
                    "Next week's opening cash is still counted by you — closing does not set it.",
                    "Reopening is possible and is recorded."
                  ].map((line) => (
                    <li key={line} className="flex gap-1.5 text-[11px] font-medium text-gray-600">
                      <Circle className="mt-1 h-2 w-2 shrink-0 fill-gray-400 text-gray-400" /> {line}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2.5 border-t border-gray-100 px-5 py-4">
            <button type="button" disabled={props.saving || closed}
              onClick={() => void props.onSave({ closingNotes: notes, approvedByUserId: approver || null, status: "draft" })}
              className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Save as Draft
            </button>
            <button type="button"
              disabled={props.saving || closed || !progress?.canClose || !notes.trim()}
              onClick={() => void props.onSave({ closingNotes: notes, approvedByUserId: approver || null, status: "closed" })}
              className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
              <Lock className="h-4 w-4" /> Close Week &amp; Lock Records
            </button>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-gray-200 bg-white">
            <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
              Weekly Financial Summary
            </h3>
            <dl className="m-0 space-y-2 px-5 py-4">
              {[
                { label: "Total Revenue", value: view?.profit.totalRevenue ?? 0, tone: "text-gray-900" },
                { label: "Total Cost of Goods Sold", value: view?.profit.totalCogs ?? 0, tone: "text-gray-900" },
                { label: "Gross Profit", value: view?.profit.grossProfit ?? 0, tone: "text-gray-900", strong: true },
                { label: "Operating Expenses", value: view?.profit.operatingExpenses ?? 0, tone: "text-gray-900" }
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-2">
                  <dt className={`m-0 text-[12px] ${row.strong ? "font-black text-gray-900" : "font-semibold text-gray-600"}`}>{row.label}</dt>
                  <dd className={`m-0 text-[12px] font-black ${row.tone}`}>{naira(row.value)}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                <dt className="m-0 text-[12px] font-black text-gray-900">Net Profit</dt>
                <dd className={`m-0 text-base font-black ${(view?.profit.netProfit ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {naira(view?.profit.netProfit ?? 0)}
                </dd>
              </div>
              <div className="text-right text-[11px] font-semibold text-gray-400">
                {(view?.profit.netMarginPct ?? 0).toFixed(2)}% of revenue
              </div>
            </dl>
            <p className="m-0 flex gap-2 border-t border-gray-100 px-5 py-3 text-[11px] font-semibold text-gray-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Accrual basis — recognised when delivered, not when the cash arrives. It will not match the cash figures,
              and that gap is why both are shown.
            </p>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white">
            <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
              Cash Position Summary
            </h3>
            <dl className="m-0 space-y-2 px-5 py-4">
              {[
                { label: "Total Liquid Cash (Bank + Cash)", value: view?.cashPosition.totalLiquidCash ?? 0 },
                { label: "COD with Agents", value: view?.cashPosition.codWithAgents ?? 0 },
                { label: "Inventory at Cost", value: view?.cashPosition.inventoryAtCost ?? 0 },
                { label: "Restricted / Reserved Cash", value: view?.cashPosition.reservedCash ?? 0 }
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-2">
                  <dt className="m-0 text-[12px] font-semibold text-gray-600">{row.label}</dt>
                  <dd className="m-0 text-[12px] font-black text-gray-900">{naira(row.value)}</dd>
                </div>
              ))}
              <div className={`mt-1 rounded-xl px-3 py-2.5 ${(view?.cashPosition.freeOperatingCash ?? 0) >= 0 ? "bg-emerald-50" : "bg-rose-50"}`}>
                <div className="flex items-center justify-between gap-2">
                  <dt className={`m-0 text-[12px] font-black ${(view?.cashPosition.freeOperatingCash ?? 0) >= 0 ? "text-emerald-800" : "text-rose-800"}`}>
                    Free Operating Cash
                  </dt>
                  <dd className={`m-0 text-[13px] font-black ${(view?.cashPosition.freeOperatingCash ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {signedNaira(view?.cashPosition.freeOperatingCash ?? 0)}
                  </dd>
                </div>
                <p className="m-0 mt-0.5 text-[11px] font-semibold text-gray-500">
                  Liquid cash less reserves. Stock and agent-held cash are excluded — neither can pay a bill this week.
                </p>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
            <h3 className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-700">Period Status</h3>
            <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${
              closed ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : progress?.canClose ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"}`}>
              {closed ? <><Lock className="h-3.5 w-3.5" /> Closed &amp; Locked</>
                : progress?.canClose ? <><CheckCircle2 className="h-3.5 w-3.5" /> Ready to Close</>
                  : <><AlertTriangle className="h-3.5 w-3.5" /> Checks Outstanding</>}
            </span>
            <p className="m-0 mt-2 text-[12px] font-semibold text-gray-500">
              {closed ? `Locked by ${view?.closedByName || "—"} on ${stamp(view?.closedAt ?? null)}.`
                : progress?.canClose ? "All required checks have passed. Add closing notes and lock the week."
                  : `${progress?.blocking.length ?? 0} required check${(progress?.blocking.length ?? 0) === 1 ? "" : "s"} still outstanding.`}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function CheckRow({ row, disabled, onToggle }: {
  row: CloseCheckRow; disabled: boolean; onToggle: (done: boolean) => void;
}) {
  const auto = row.kind === "computed";
  return (
    <li className="flex items-start justify-between gap-2">
      <span className="flex min-w-0 items-start gap-1.5">
        {auto ? (
          // ⚠️ No control at all: a computed check is a fact read from the
          // data. Offering a tick-box would imply it could be overridden.
          row.done
            ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            : row.required
              ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
              : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300" />
        ) : (
          <input type="checkbox" checked={row.done} disabled={disabled}
            onChange={(event) => onToggle(event.target.checked)}
            aria-label={row.label} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        <span className="min-w-0">
          <span className={`block text-[12px] font-bold ${row.done ? "text-gray-900" : row.required ? "text-rose-700" : "text-gray-600"}`}>
            {row.label}
            {row.required && !row.done && <span className="ml-1 text-[10px] font-black text-rose-500">REQUIRED</span>}
          </span>
          {row.evidence && (
            <span className="block truncate text-[11px] font-medium text-gray-400" title={row.evidence}>{row.evidence}</span>
          )}
        </span>
      </span>
      <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-black ${auto ? "bg-violet-50 text-violet-600" : "bg-gray-100 text-gray-500"}`}>
        {auto ? "AUTO" : "MANUAL"}
      </span>
    </li>
  );
}
