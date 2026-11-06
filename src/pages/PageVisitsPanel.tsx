import { useEffect, useMemo, useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { pageVisitsApi, type PageVisitDayRow, type PageVisitRow } from "../lib/api";

/**
 * Page visits (Bright, 3 Nov 2026: "tell me if this role users is opening
 * this page"). Owner only, on User Management. Who opened which page, how
 * often and when last. Counted from the day this was switched on; "View as"
 * and role previews are never counted.
 */
type Data = Awaited<ReturnType<typeof pageVisitsApi.list>>;

const when = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const yesterday = new Date(today.getTime() - 86_400_000).toDateString() === date.toDateString();
  const time = date.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
  return sameDay ? `Today ${time}` : yesterday ? `Yesterday ${time}` : `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" })}, ${time}`;
};

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
// "2026-11-05" -> "Yesterday, 5 Nov" / "Wed 4 Nov" (days are Lagos days).
const dayName = (day: string, today: string) => {
  const date = new Date(`${day}T12:00:00Z`);
  const short = date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === today) return `Today, ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
  if (day === yesterday.toISOString().slice(0, 10)) return `Yesterday, ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
  return short;
};

export function PageVisitsPanel() {
  const [view, setView] = useState<"totals" | "days">("totals");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [person, setPerson] = useState("all");
  const [role, setRole] = useState("all");
  const [page, setPage] = useState("all");

  useEffect(() => {
    let live = true;
    setLoading(true);
    pageVisitsApi.list(days)
      .then((result) => { if (live) { setData(result); setError(""); } })
      .catch((err: Error) => { if (live) setError(err.message || "Could not load page visits."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [days]);

  const users = useMemo(() => new Map((data?.users ?? []).map((user) => [user.id, user])), [data]);
  const roles = useMemo(() => [...new Set((data?.users ?? []).map((user) => user.role))].sort(), [data]);
  const pages = useMemo(() => [...new Map((data?.visits ?? []).map((row) => [row.pageKey, row.pageLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [data]);
  const keep = (row: { userId: string; pageKey: string }) => {
    const user = users.get(row.userId);
    return (person === "all" || row.userId === person) && (role === "all" || user?.role === role) && (page === "all" || row.pageKey === page);
  };
  const rows = (data?.visits ?? []).filter((row: PageVisitRow) => keep(row));
  const dayRows = (data?.daily ?? []).filter((row: PageVisitDayRow) => keep(row));
  // With a page picked: people of the chosen role who have NOT opened it.
  const notOpened = page === "all" ? [] : (data?.users ?? []).filter((user) =>
    (role === "all" || user.role === role) && (person === "all" || user.id === person) && !(data?.visits ?? []).some((row) => row.pageKey === page && row.userId === user.id));
  const select = "h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-[13px] dark:border-slate-700 dark:bg-slate-900";

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800" aria-label="Page visits">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-[16px] font-bold text-gray-900 dark:text-slate-50"><Eye className="h-4 w-4 text-[#1F8FE0]" /> Page visits</h2>
          <p className="m-0 mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">Which pages each person opens. Recording started on 3 Nov 2026, so nothing before that shows. Your "View as" is never counted as them.</p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Person" className={select} value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="all">Everyone</option>
          {(data?.users ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
        <select aria-label="Role" className={select} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="all">All roles</option>
          {roles.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select aria-label="Page" className={select} value={page} onChange={(e) => setPage(e.target.value)}>
          <option value="all">All pages</option>
          {pages.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select aria-label="Period" className={select} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>Today</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>
        <div role="group" aria-label="Show" className="inline-flex h-9 rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
          {([["totals", "Totals"], ["days", "By day"]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}
              className={`!min-h-0 rounded-md px-3 text-[13px] font-bold ${view === value ? "bg-white text-gray-900 shadow-sm dark:bg-slate-900 dark:text-slate-50" : "text-gray-500 dark:text-slate-400"}`}>{label}</button>
          ))}
        </div>
      </div>
      {error && <p className="m-0 text-[13px] text-rose-700">Could not load page visits: {error}</p>}
      {notOpened.length > 0 && (
        <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
          <b>Not opened in this period:</b> {notOpened.map((user) => user.name).join(", ")}
        </p>
      )}
      {view === "days" && (
        <div className="overflow-x-auto">
          <table className="!min-w-0 w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">
                {["Day", "Person", "Role", "Page", "Times opened", "First opened", "Last opened"].map((label) => <th key={label} className="whitespace-nowrap border-b border-gray-200 px-2 py-2 font-bold dark:border-slate-800">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {dayRows.length === 0 && <tr><td colSpan={7} className="px-2 py-4 text-gray-400">{loading ? "Loading…" : "No visits recorded for this choice yet."}</td></tr>}
              {dayRows.slice(0, 500).map((row, index) => {
                const user = users.get(row.userId);
                const newDay = index === 0 || dayRows[index - 1].day !== row.day;
                return (
                  <tr key={`${row.userId}|${row.pageKey}|${row.day}`} className={`border-b border-gray-100 dark:border-slate-800 ${newDay && index > 0 ? "border-t-2 border-t-gray-200 dark:border-t-slate-700" : ""}`}>
                    <td className="whitespace-nowrap px-2 py-2 font-semibold text-gray-700 dark:text-slate-200">{newDay ? dayName(row.day, data?.today ?? row.day) : ""}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-semibold">{user?.name ?? "Former user"}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-gray-500 dark:text-slate-400">{user?.role ?? "—"}</td>
                    <td className="px-2 py-2">{row.pageLabel}</td>
                    <td className="px-2 py-2 tabular-nums">{row.visits}</td>
                    <td className="whitespace-nowrap px-2 py-2">{timeOf(row.firstAt)}</td>
                    <td className="whitespace-nowrap px-2 py-2">{timeOf(row.lastAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {view === "totals" && <div className="overflow-x-auto">
        <table className="!min-w-0 w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">
              {["Person", "Role", "Page", "Times opened", "Days opened", "Today", "Last opened"].map((label) => <th key={label} className="whitespace-nowrap border-b border-gray-200 px-2 py-2 font-bold dark:border-slate-800">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="px-2 py-4 text-gray-400">{loading ? "Loading…" : "No visits recorded for this choice yet."}</td></tr>}
            {rows.slice(0, 300).map((row) => {
              const user = users.get(row.userId);
              return (
                <tr key={`${row.userId}|${row.pageKey}`} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="whitespace-nowrap px-2 py-2 font-semibold">{user?.name ?? "Former user"}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-gray-500 dark:text-slate-400">{user?.role ?? "—"}</td>
                  <td className="px-2 py-2">{row.pageLabel}</td>
                  <td className="px-2 py-2 tabular-nums">{row.visits}</td>
                  <td className="px-2 py-2 tabular-nums">{row.days}</td>
                  <td className="px-2 py-2 tabular-nums">{row.today || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-2">{when(row.lastAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}
    </section>
  );
}
