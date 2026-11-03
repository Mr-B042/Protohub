import { useEffect, useMemo, useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { pageVisitsApi, type PageVisitRow } from "../lib/api";

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

export function PageVisitsPanel() {
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
  const rows = (data?.visits ?? []).filter((row: PageVisitRow) => {
    const user = users.get(row.userId);
    return (person === "all" || row.userId === person) && (role === "all" || user?.role === role) && (page === "all" || row.pageKey === page);
  });
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
      </div>
      {error && <p className="m-0 text-[13px] text-rose-700">Could not load page visits: {error}</p>}
      {notOpened.length > 0 && (
        <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
          <b>Not opened in this period:</b> {notOpened.map((user) => user.name).join(", ")}
        </p>
      )}
      <div className="overflow-x-auto">
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
      </div>
    </section>
  );
}
