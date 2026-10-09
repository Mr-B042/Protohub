import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Plus, Users } from "lucide-react";
import { bugReportsApi, type BugReport } from "../lib/api";
import { AWAITING, KIND_LABEL, ago, isOpenStatus } from "../lib/issue-labels";
import IssueTicket, { PriorityBadge, StatusBadge } from "../components/IssueTicket";

/**
 * Help & Support -> My Reports (Issue Management, Bright, 9 Oct 2026): every
 * ticket the person sent, and the ones they said "I'm experiencing this too"
 * on, with where each one stands. Opening one shows its progress, replies and,
 * once resolved, "Is it fixed?".
 */
export default function MyReportsPage({ openId, onOpenChange, onNewReport, showToast }: {
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  onNewReport: () => void;
  showToast: (message: string) => void;
}) {
  const [rows, setRows] = useState<BugReport[] | null>(null);
  const [filter, setFilter] = useState<"open" | "confirm" | "all">("all");
  const load = () => bugReportsApi.mine().then(setRows).catch((err: any) => { setRows([]); showToast(err?.message ?? "Could not load your reports."); });
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    open: (rows ?? []).filter((row) => isOpenStatus(row.status)).length,
    confirm: (rows ?? []).filter((row) => AWAITING.includes(row.status) && !row.following).length
  }), [rows]);
  const shown = (rows ?? []).filter((row) => filter === "all" || (filter === "open" ? isOpenStatus(row.status) : AWAITING.includes(row.status)));

  if (openId) {
    return (
      <div className="mx-auto w-full max-w-[1100px] pb-8">
        <IssueTicket id={openId} mode="reporter" showToast={showToast} onBack={() => { onOpenChange(null); void load(); }}
          onChanged={(report) => setRows((current) => current ? current.map((row) => (row.id === report.id ? { ...row, ...report } : row)) : current)} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] pb-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-[#1F8FE0]"><ClipboardList className="h-7 w-7" /></span>
          <div>
            <h1 className="m-0 text-[24px] font-bold text-gray-900 dark:text-slate-50">My Reports</h1>
            <p className="m-0 mt-0.5 text-[14px] text-gray-500">Everything you've reported, and where each one stands.</p>
          </div>
        </div>
        <button type="button" onClick={onNewReport} className="!min-h-0 inline-flex items-center gap-2 rounded-lg bg-[#1F8FE0] px-4 py-2.5 text-[13px] font-semibold text-white"><Plus className="h-4 w-4" /> Report an Issue</button>
      </div>

      {counts.confirm > 0 && (
        <p className="m-0 mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900">
          <b>{counts.confirm}</b> of your reports {counts.confirm === 1 ? "has" : "have"} been fixed. Open {counts.confirm === 1 ? "it" : "them"} and confirm whether it's really working.
        </p>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap gap-1 border-b border-gray-100 px-4 pt-3 dark:border-slate-800">
          {([["all", `All (${rows?.length ?? 0})`], ["open", `Open (${counts.open})`], ["confirm", `Waiting for you (${counts.confirm})`]] as const).map(([key, text]) => (
            <button key={key} type="button" onClick={() => setFilter(key)} className={`!min-h-0 -mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${filter === key ? "border-[#1F8FE0] text-[#1F8FE0]" : "border-transparent text-gray-500"}`}>{text}</button>
          ))}
        </div>
        {rows === null ? <p className="m-0 p-10 text-center text-[13px] text-gray-500">Loading…</p>
          : shown.length === 0 ? (
            <div className="p-10 text-center">
              <p className="m-0 text-[14px] font-semibold text-gray-800 dark:text-slate-100">{rows.length === 0 ? "You haven't reported anything yet." : "Nothing here."}</p>
              {rows.length === 0 && <p className="m-0 mt-1 text-[13px] text-gray-500">When something isn't working, use Report an Issue and it will appear here with a ticket number.</p>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="text-[11px] font-semibold uppercase tracking-wide text-gray-500"><tr>
                  <th className="px-4 py-3">ID</th><th className="px-4 py-3">Issue</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Updated</th>
                </tr></thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.id} onClick={() => onOpenChange(row.id)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono font-bold text-[#1F8FE0]">{row.code}</td>
                      <td className="max-w-[340px] px-4 py-3"><span className="block truncate font-semibold text-gray-900 dark:text-slate-100">{row.title}</span>{row.following && <span className="text-[11.5px] text-gray-500"><Users className="mb-0.5 mr-1 inline h-3 w-3" />You're experiencing this too</span>}</td>
                      <td className="px-4 py-3 text-gray-600">{KIND_LABEL[row.kind]}</td>
                      <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                      <td className="px-4 py-3"><PriorityBadge priority={row.priority} /></td>
                      <td className="px-4 py-3 text-gray-500">{ago(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}
