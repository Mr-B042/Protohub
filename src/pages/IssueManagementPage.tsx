import { useEffect, useMemo, useState } from "react";
import { BarChart3, Search, ShieldAlert } from "lucide-react";
import { bugReportsApi, type BugReport, type IssuePriority } from "../lib/api";
import { DONE, IMPACT_LABEL, IMPACT_TONE, KIND_LABEL, ago, isOpenStatus } from "../lib/issue-labels";
import IssueTicket, { PriorityBadge, StatusBadge } from "../components/IssueTicket";

/**
 * Issue Management (Bright, 9 Oct 2026): the technical team's bug centre -
 * Owner and Admins only. Counts at the top, filters, every ticket, and the
 * ticket page (overview, attachments, steps, technical data, activity,
 * internal notes). Analytics shows where Protohub needs engineering attention.
 */

type Filter = "All Issues" | "Bugs" | "Features" | "UI/UX" | "Critical" | "Unassigned" | "My Issues";
const FILTERS: Filter[] = ["All Issues", "Bugs", "Features", "UI/UX", "Critical", "Unassigned", "My Issues"];
const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const card = "rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900";
const isCritical = (row: BugReport) => row.impact === "critical" || row.priority === "P0";
const duration = (hours: number | null) => hours === null ? "—" : hours < 1 ? `${Math.round(hours * 60)} min` : hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} days`;
const hoursBetween = (from: string, to: string) => (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export default function IssueManagementPage({ currentUserId, openId, onOpenChange, showToast }: {
  currentUserId: string | null;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  showToast: (message: string) => void;
}) {
  const [rows, setRows] = useState<BugReport[] | null>(null);
  const [team, setTeam] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [view, setView] = useState<"issues" | "analytics">("issues");
  const [filter, setFilter] = useState<Filter>("All Issues");
  const [showDone, setShowDone] = useState(false);
  const [search, setSearch] = useState("");

  const load = () => bugReportsApi.all().then(setRows).catch((err: any) => { setRows([]); showToast(err?.message ?? "Could not load tickets."); });
  useEffect(() => {
    void load();
    bugReportsApi.teamMembers().then(setTeam).catch(() => setTeam([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const all = rows ?? [];
  const weekAgo = Date.now() - 7 * 86_400_000;
  const metrics = {
    open: all.filter((row) => isOpenStatus(row.status)).length,
    critical: all.filter((row) => isOpenStatus(row.status) && isCritical(row)).length,
    inProgress: all.filter((row) => ["in_progress", "in_development", "testing"].includes(row.status)).length,
    awaiting: all.filter((row) => row.status === "needs_info").length,
    resolvedWeek: all.filter((row) => row.resolvedAt && new Date(row.resolvedAt).getTime() >= weekAgo).length
  };

  const shown = useMemo(() => {
    const text = search.trim().toLowerCase();
    return all.filter((row) => {
      if (!showDone && DONE.includes(row.status)) return false;
      if (filter === "Bugs" && row.kind !== "issue") return false;
      if (filter === "Features" && row.kind !== "feature") return false;
      if (filter === "UI/UX" && row.kind !== "ux") return false;
      if (filter === "Critical" && !isCritical(row)) return false;
      if (filter === "Unassigned" && row.assigneeId) return false;
      if (filter === "My Issues" && row.assigneeId !== currentUserId) return false;
      if (text && !`${row.code} ${row.title} ${row.reporterName} ${row.module} ${row.description}`.toLowerCase().includes(text)) return false;
      return true;
    }).sort((a, b) => (PRIORITY_ORDER[a.priority ?? "P9"] ?? 9) - (PRIORITY_ORDER[b.priority ?? "P9"] ?? 9) || b.createdAt.localeCompare(a.createdAt));
  }, [all, filter, showDone, search, currentUserId]);

  if (openId) {
    return (
      <div className="mx-auto w-full max-w-[1280px] pb-8">
        <IssueTicket id={openId} mode="team" team={team} showToast={showToast} onBack={() => { onOpenChange(null); void load(); }}
          onChanged={(report) => setRows((current) => current ? current.map((row) => (row.id === report.id ? report : row)) : current)} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] pb-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600"><ShieldAlert className="h-7 w-7" /></span>
          <div>
            <h1 className="m-0 text-[24px] font-bold text-gray-900 dark:text-slate-50">Issue Management</h1>
            <p className="m-0 mt-0.5 text-[14px] text-gray-500">Every bug, idea and UI/UX report - triage, assign, reply and track to the end. Owner and Admins only.</p>
          </div>
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-slate-800">
          <button type="button" onClick={() => setView("issues")} className={`!min-h-0 rounded-md px-4 py-1.5 text-[13px] font-semibold ${view === "issues" ? "bg-white text-gray-900 shadow-sm dark:bg-slate-900 dark:text-slate-100" : "text-gray-500"}`}>Issues</button>
          <button type="button" onClick={() => setView("analytics")} className={`!min-h-0 rounded-md px-4 py-1.5 text-[13px] font-semibold ${view === "analytics" ? "bg-white text-gray-900 shadow-sm dark:bg-slate-900 dark:text-slate-100" : "text-gray-500"}`}><BarChart3 className="mr-1 inline h-4 w-4" />Analytics</button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {([["Open", metrics.open, "text-gray-900"], ["Critical", metrics.critical, "text-rose-600"], ["In Progress", metrics.inProgress, "text-amber-600"], ["Awaiting Reporter", metrics.awaiting, "text-orange-600"], ["Resolved This Week", metrics.resolvedWeek, "text-emerald-600"]] as const).map(([text, value, tone]) => (
          <div key={text} className={`${card} p-4`}><p className="m-0 text-[12px] font-semibold text-gray-500">{text}</p><p className={`m-0 mt-1 text-[28px] font-black ${tone} dark:text-slate-50`}>{rows === null ? "…" : value}</p></div>
        ))}
      </div>

      {view === "analytics" ? <Analytics rows={all} /> : (
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-slate-800">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((item) => (
                <button key={item} type="button" onClick={() => setFilter(item)} className={`!min-h-0 rounded-full border px-3 py-1 text-[12.5px] font-semibold ${filter === item ? "border-[#1F8FE0] bg-blue-50 text-[#1F8FE0]" : "border-gray-200 text-gray-600 dark:border-slate-700 dark:text-slate-300"}`}>{item}</button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[12.5px] text-gray-600"><input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} /> Show closed</label>
              <label className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tickets" className="w-56 rounded-lg border border-gray-200 py-2 pl-8 pr-3 text-[13px] outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900" />
              </label>
            </div>
          </div>
          {rows === null ? <p className="m-0 p-10 text-center text-[13px] text-gray-500">Loading…</p> : shown.length === 0 ? <p className="m-0 p-10 text-center text-[13px] text-gray-500">No tickets match.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-[13px]">
                <thead className="text-[11px] font-semibold uppercase tracking-wide text-gray-500"><tr>
                  {["ID", "Issue", "Reporter", "Department", "Impact", "Priority", "Module", "Assigned", "Status", "Updated"].map((head) => <th key={head} className="px-4 py-3">{head}</th>)}
                </tr></thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.id} onClick={() => onOpenChange(row.id)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono font-bold text-[#1F8FE0]">{row.code}</td>
                      <td className="max-w-[300px] px-4 py-3"><span className="block truncate font-semibold text-gray-900 dark:text-slate-100">{row.title}</span><span className="text-[11.5px] text-gray-500">{KIND_LABEL[row.kind]}{row.affectedCount > 1 ? ` · ${row.affectedCount} people` : ""}{row.reopenedCount ? ` · reopened ${row.reopenedCount}×` : ""}</span></td>
                      <td className="px-4 py-3 text-gray-700 dark:text-slate-200">{row.reporterName}</td>
                      <td className="px-4 py-3 text-gray-600">{row.department ?? row.reporterRole}</td>
                      <td className={`px-4 py-3 font-semibold ${row.impact ? IMPACT_TONE[row.impact] : "text-gray-400"}`}>{row.impact ? IMPACT_LABEL[row.impact] : "—"}</td>
                      <td className="px-4 py-3"><PriorityBadge priority={row.priority as IssuePriority | null} /></td>
                      <td className="px-4 py-3 text-gray-600">{row.module}</td>
                      <td className="px-4 py-3 text-gray-600">{row.assigneeName ?? <span className="text-gray-400">Unassigned</span>}</td>
                      <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                      <td className="px-4 py-3 text-gray-500">{ago(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** Where Protohub needs engineering attention (part 25 of Bright's spec). */
function Analytics({ rows }: { rows: BugReport[] }) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const thisMonth = rows.filter((row) => new Date(row.createdAt).getTime() >= monthStart);
  const bugs = rows.filter((row) => row.kind === "issue");
  const responded = rows.filter((row) => row.firstResponseAt).map((row) => hoursBetween(row.createdAt, row.firstResponseAt!));
  const resolved = rows.filter((row) => row.resolvedAt).map((row) => hoursBetween(row.createdAt, row.resolvedAt!));
  const everResolved = rows.filter((row) => row.resolvedAt || row.closedAt || row.reopenedCount > 0);
  const reopenedRate = everResolved.length ? Math.round((everResolved.filter((row) => row.reopenedCount > 0).length / everResolved.length) * 100) : null;
  const countBy = (pick: (row: BugReport) => string) => {
    const map = new Map<string, number>();
    rows.forEach((row) => map.set(pick(row) || "Other", (map.get(pick(row) || "Other") ?? 0) + 1));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  };
  const modules = countBy((row) => row.module);
  const departments = countBy((row) => row.department ?? row.reporterRole);
  const types = countBy((row) => KIND_LABEL[row.kind]);
  const tiles: Array<[string, string | number]> = [
    ["Issues reported this month", thisMonth.length],
    ["Open bugs", bugs.filter((row) => isOpenStatus(row.status)).length],
    ["Critical bugs (open)", bugs.filter((row) => isOpenStatus(row.status) && isCritical(row)).length],
    ["Average first response", duration(average(responded))],
    ["Average resolution time", duration(average(resolved))],
    ["Reopened rate", reopenedRate === null ? "—" : `${reopenedRate}%`],
    ["Feature requests", rows.filter((row) => row.kind === "feature").length],
    ["UI/UX complaints", rows.filter((row) => row.kind === "ux").length]
  ];
  const Bars = ({ title, data }: { title: string; data: Array<[string, number]> }) => {
    const max = Math.max(1, ...data.map(([, value]) => value));
    return (
      <section className={`${card} p-5`}>
        <h2 className="m-0 mb-3 text-[15px] font-bold text-gray-900 dark:text-slate-100">{title}</h2>
        {data.length === 0 ? <p className="m-0 text-[13px] text-gray-500">No reports yet.</p> : (
          <div className="space-y-2">{data.slice(0, 10).map(([name, value]) => (
            <div key={name}><div className="flex justify-between text-[12.5px]"><span className="text-gray-700 dark:text-slate-200">{name}</span><b className="text-gray-900 dark:text-slate-100">{value} report{value === 1 ? "" : "s"}</b></div>
              <div className="mt-1 h-2 rounded-full bg-gray-100 dark:bg-slate-800"><div className="h-2 rounded-full bg-[#1F8FE0]" style={{ width: `${(value / max) * 100}%` }} /></div></div>
          ))}</div>
        )}
      </section>
    );
  };
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([text, value]) => <div key={text} className={`${card} p-4`}><p className="m-0 text-[12px] font-semibold text-gray-500">{text}</p><p className="m-0 mt-1 text-[24px] font-black text-gray-900 dark:text-slate-50">{value}</p></div>)}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Bars title="Most Problematic Areas" data={modules} />
        <Bars title="Reports by department" data={departments} />
        <Bars title="Reports by type" data={types} />
      </div>
    </div>
  );
}
