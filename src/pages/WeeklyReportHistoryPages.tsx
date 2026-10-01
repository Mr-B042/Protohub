import { History, ScrollText } from "lucide-react";
import { AuditTable, CompanyStatusPill, Panel, RepStatusPill, WeekPicker, longDate, nf, pctText, shortDateTime } from "../components/WeeklyReportParts";
import type { WeeklyCompanyReport, WeeklyRepReport, WeeklyReportAuditEntry } from "../lib/api";
import { currencySymbol } from "../lib/money-privacy";

/**
 * The history views under Weekly Reports: a rep's own past weeks, the company
 * weeks for the manager/owner, and the owner's audit log. Each row opens that
 * week on the main page.
 */

function PageTitle({ icon: Icon, title, subtitle }: { icon: typeof History; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300"><Icon className="h-7 w-7" /></span>
      <div>
        <h1 className="m-0 text-2xl font-black tracking-tight text-gray-900 dark:text-slate-50">{title}</h1>
        <p className="m-0 mt-1 text-[13px] text-gray-500 dark:text-slate-400">{subtitle}</p>
      </div>
    </div>
  );
}

const addDays = (key: string, days: number) => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export function MyReportsHistoryPage({ rows, loading, error, onOpenWeek }: {
  rows: Array<WeeklyRepReport & { openReturns: number }>;
  loading: boolean;
  error: string;
  onOpenWeek: (weekStart: string) => void;
}) {
  const sym = currencySymbol();
  return (
    <div className="space-y-5">
      <PageTitle icon={History} title="My Reports History" subtitle="Every weekly report you have submitted, and where it is now." />
      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold text-rose-700">{error}</p>}
      <Panel>
        <div className="overflow-x-auto p-3">
          <table className="w-full !min-w-[820px] text-left text-[12px]">
            <thead className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]">
              <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
                {["Week", "Orders", "Delivered", "Delivery Rate", `Final Bonus (${sym})`, "Status", "Submitted", ""].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const totals = row.snapshot?.totals;
                return (
                  <tr key={row.id} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200">
                    <td className="whitespace-nowrap px-3 py-3 font-semibold">{longDate(row.weekStart)} – {longDate(addDays(row.weekStart, 6))}</td>
                    <td className="px-3 py-3">{totals ? nf(totals.orders) : "-"}</td>
                    <td className="px-3 py-3">{totals ? nf(totals.delivered) : "-"}</td>
                    <td className="px-3 py-3">{totals ? pctText(totals.deliveryRate) : "-"}</td>
                    <td className="px-3 py-3 font-bold">{totals ? nf(totals.finalBonus) : "-"}</td>
                    <td className="px-3 py-3">
                      <RepStatusPill status={row.status} />
                      {row.openReturns > 0 && <span className="ml-1.5 text-[11px] font-bold text-rose-600">{row.openReturns} to answer</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-500">{row.submittedAt ? shortDateTime(row.submittedAt) : "-"}</td>
                    <td className="px-3 py-3 text-right">
                      <button type="button" onClick={() => onOpenWeek(row.weekStart)} className="!min-h-0 rounded-lg bg-blue-50 px-3 py-1.5 text-[12px] font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-200">Open</button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-500">{loading ? "Loading…" : "You have not submitted a weekly report yet."}</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

const countOf = (counts: Record<string, number>, key: string) => {
  // Replies are camel-cased by the api client, so "manager_approved" arrives
  // as "managerApproved". Read both.
  const camel = key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
  return (counts[key] ?? 0) + (camel !== key ? counts[camel] ?? 0 : 0);
};

export function CompanyReportHistoryPage({ rows, loading, error, onOpenWeek, onBack }: {
  onBack?: () => void;
  rows: Array<{ weekStart: string; weekEnd: string; company: WeeklyCompanyReport | null; repStatusCounts: Record<string, number> }>;
  loading: boolean;
  error: string;
  onOpenWeek: (weekStart: string) => void;
}) {
  const sym = currencySymbol();
  return (
    <div className="space-y-5">
      {onBack && (
        <button type="button" onClick={onBack} className="!min-h-0 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1F8FE0] hover:underline">← Weekly Report Review</button>
      )}
      <PageTitle icon={History} title="Report History" subtitle="Every week's report, from the reps' submissions to the owner's lock." />
      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold text-rose-700">{error}</p>}
      <Panel>
        <div className="overflow-x-auto p-3">
          <table className="w-full !min-w-[900px] text-left text-[12px]">
            <thead className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]">
              <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
                {["Week", "Rep reports", "Orders", "Delivered", `Total Bonus (${sym})`, "Status", "Submitted to owner", "Locked", ""].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const totals = row.company?.companySnapshot?.totals;
                const counts = row.repStatusCounts ?? {};
                const approved = countOf(counts, "manager_approved") + countOf(counts, "locked") + countOf(counts, "owner_approved");
                const all = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0) - countOf(counts, "draft");
                return (
                  <tr key={row.weekStart} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200">
                    <td className="whitespace-nowrap px-3 py-3 font-semibold">{longDate(row.weekStart)} – {longDate(row.weekEnd)}</td>
                    <td className="px-3 py-3">
                      {approved} approved of {all} submitted
                      {countOf(counts, "returned") > 0 && <span className="ml-1.5 font-bold text-rose-600">· {countOf(counts, "returned")} returned</span>}
                    </td>
                    <td className="px-3 py-3">{totals ? nf(totals.orders) : "-"}</td>
                    <td className="px-3 py-3">{totals ? nf(totals.delivered) : "-"}</td>
                    <td className="px-3 py-3 font-bold">{totals ? nf(totals.totalBonus) : "-"}</td>
                    <td className="px-3 py-3"><CompanyStatusPill status={row.company?.status ?? "open"} /></td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-500">{row.company?.submittedAt ? shortDateTime(row.company.submittedAt) : "-"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-500">{row.company?.lockedAt ? shortDateTime(row.company.lockedAt) : "-"}</td>
                    <td className="px-3 py-3 text-right">
                      <button type="button" onClick={() => onOpenWeek(row.weekStart)} className="!min-h-0 rounded-lg bg-blue-50 px-3 py-1.5 text-[12px] font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-200">Open</button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-10 text-center text-gray-500">{loading ? "Loading…" : "No weekly reports yet."}</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export function WeeklyAuditLogPage({ weekStart, weekEnd, onShiftWeek, onPickWeek, canGoNext, entries, loading, error, repName }: {
  weekStart: string;
  weekEnd: string;
  onShiftWeek: (weeks: number) => void;
  onPickWeek: (dateKey: string) => void;
  canGoNext: boolean;
  entries: WeeklyReportAuditEntry[];
  loading: boolean;
  error: string;
  repName: (repId: string | null) => string;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <PageTitle icon={ScrollText} title="Audit Logs" subtitle="Every submission, return, correction, approval and lock for the week. Nothing here can be changed or deleted." />
        <WeekPicker weekStart={weekStart} weekEnd={weekEnd} onShift={onShiftWeek} canGoNext={canGoNext} onPick={onPickWeek} />
      </div>
      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold text-rose-700">{error}</p>}
      <Panel className="p-2">
        {loading && entries.length === 0 ? <p className="m-0 px-5 py-8 text-center text-[13px] text-gray-500">Loading…</p> : <AuditTable entries={entries} repName={repName} />}
      </Panel>
    </div>
  );
}
