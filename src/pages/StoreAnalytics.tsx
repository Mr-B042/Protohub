import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, Eye, ExternalLink, Package, ShoppingCart, Store, Users } from "lucide-react";
import { storeActivityApi, type StoreActivitySummary } from "../lib/api";

/**
 * Our Store › Analytics (Owner only; Bright, 9 Nov 2026): who used the store
 * inside Protohub, by role and by person, how long, what they did, and who
 * hasn't opened it. Inside-store actions need STORE_SNIPPET on the store.
 */

/** Paste into the store (theme footer / custom scripts): tells Protohub what happens inside when the store is opened from Our Store. */
export const STORE_SNIPPET = `<script>
/* Protohub: Our Store activity. Only runs when the store is opened inside Protohub. */
(function () {
  if (window.parent === window) return;
  function send(event, extra) {
    try { window.parent.postMessage(Object.assign({ type: "protohub-store", event: event, url: location.href, title: document.title }, extra || {}), "*"); } catch (e) {}
  }
  var path = location.pathname.toLowerCase();
  if (/\\/products?\\//.test(path)) send("product");
  else if (/order|complete|success|thank/.test(path) && /checkout|order/.test(path)) send("order");
  else if (/checkout/.test(path)) send("checkout");
  else send("page");
  var q = new URLSearchParams(location.search).get("query") || new URLSearchParams(location.search).get("q");
  if (q) send("search", { detail: { query: q.slice(0, 100) } });
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("button, a, input[type=submit]") : null;
    if (!el) return;
    var label = ((el.innerText || el.value || el.getAttribute("aria-label") || "") + "").trim().toLowerCase();
    if (/add to cart|buy now/.test(label)) send("cart", { detail: { button: label.slice(0, 60) } });
    else if (/place order|confirm order/.test(label)) send("checkout", { detail: { button: label.slice(0, 60) } });
  }, true);
})();
</script>`;

const PERIODS = [7, 30, 90] as const;
const naira = (n: number) => n.toLocaleString("en-NG");
const duration = (seconds: number) => {
  if (!seconds) return "0m";
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const WHAT: Record<string, string> = {
  open: "Opened Our Store", page: "Viewed a store page", product: "Viewed a product", search: "Searched", cart: "Added to cart", checkout: "Went to checkout",
  order: "Placed an order", full_store: "Switched the store to full screen", home: "Went back to the store home"
};

export default function StoreAnalytics() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [data, setData] = useState<StoreActivitySummary | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState("");
  useEffect(() => {
    setData(null); setError("");
    storeActivityApi.summary(days).then(setData).catch((err) => setError((err as Error).message || "Could not load store activity."));
  }, [days]);
  const roles = useMemo(() => [...new Set((data?.people ?? []).map((row) => row.role).concat((data?.notOpened ?? []).map((row) => row.role)))].filter(Boolean).sort(), [data]);
  const maxDay = Math.max(1, ...(data?.daily ?? []).map((row) => row.visits));
  const k = data?.kpis;
  const copy = async () => { try { await navigator.clipboard.writeText(STORE_SNIPPET); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* copy blocked */ } };

  const tile = (Icon: typeof Users, label: string, value: string, note?: string) => (
    <div className="rounded-2xl border border-amber-200/70 bg-white p-4 shadow-sm dark:border-amber-500/20 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-gray-600 dark:text-slate-400"><span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Icon className="h-4 w-4" /></span>{label}</div>
      <div className="mt-2 text-[24px] font-extrabold text-gray-900 dark:text-slate-50">{value}</div>
      {note && <div className="text-[12px] text-gray-500">{note}</div>}
    </div>
  );
  const card = "rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900";
  const th = "px-3 py-2 text-left text-[11.5px] font-bold uppercase tracking-wide text-gray-500";
  const td = "px-3 py-2 text-[13px] text-gray-800 dark:text-slate-200";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="m-0 text-[22px] font-extrabold text-gray-900 dark:text-slate-50">Store Activity</h2>
          <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">What each person and role did in Our Store inside Protohub. Only you (Owner) can see this.</p>
        </div>
        <div className="flex rounded-xl border border-gray-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
          {PERIODS.map((n) => <button key={n} type="button" onClick={() => setDays(n)} className={`!min-h-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${days === n ? "bg-amber-400 text-amber-950" : "text-gray-600"}`}>{n} days</button>)}
        </div>
      </div>
      {error && <p className="m-0 rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</p>}
      {!data && !error && <p className="m-0 text-[13px] text-gray-500">Loading…</p>}
      {data && k && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            {tile(Users, "People who used it", `${k.people} / ${k.staff}`, "of active staff")}
            {tile(Store, "Visits", naira(k.visits))}
            {tile(Clock, "Time in store", duration(k.seconds))}
            {tile(Eye, "Store pages", naira(k.pages))}
            {tile(Package, "Products viewed", data.storeConnected ? naira(k.products) : "—", data.storeConnected ? undefined : "needs the store snippet")}
            {tile(ShoppingCart, "Added to cart", data.storeConnected ? naira(k.carts) : "—", data.storeConnected ? `${k.orders} orders placed` : "needs the store snippet")}
            {tile(ExternalLink, "Used full screen", naira(k.fullStore), "store filling the app window")}
          </div>

          {!data.storeConnected && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
              <div className="text-[14px] font-bold text-amber-900 dark:text-amber-200">See what people do inside the store (pages, products, searches, add to cart, orders)</div>
              <p className="m-0 mt-1 text-[13px] text-amber-900/90 dark:text-amber-200/90">Protohub already records who opens the store, for how long and how many pages they go through. For the rest, the store has to tell Protohub: paste this snippet into your store's custom scripts (theme footer), or send it to your web developer. It only runs when the store is opened inside Protohub, and sends nothing anywhere else.</p>
              <div className="mt-3 flex items-start gap-2">
                <pre className="m-0 max-h-40 flex-1 overflow-auto rounded-xl bg-white p-3 text-[11px] leading-snug text-gray-800 dark:bg-slate-950 dark:text-slate-200">{STORE_SNIPPET}</pre>
                <button type="button" onClick={() => void copy()} className="!min-h-0 inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-[13px] font-bold text-amber-950">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy"}</button>
              </div>
            </div>
          )}

          <div className={card}>
            <h3 className="m-0 mb-3 text-[16px] font-bold text-gray-900 dark:text-slate-50">Visits per day</h3>
            <div className="flex h-36 items-end gap-1">
              {data.daily.map((row) => (
                <div key={row.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${row.day}: ${row.visits} visits, ${row.people} people`}>
                  <div className="rounded-t bg-gradient-to-t from-amber-500 to-yellow-300" style={{ height: `${(row.visits / maxDay) * 100}%`, minHeight: row.visits ? 4 : 0 }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-gray-500"><span>{data.daily[0]?.day}</span><span>{data.today}</span></div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className={card}>
              <h3 className="m-0 mb-2 text-[16px] font-bold text-gray-900 dark:text-slate-50">By role</h3>
              <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={th}>Role</th><th className={th}>People</th><th className={th}>Visits</th><th className={th}>Time</th><th className={th}>Pages</th><th className={th}>Cart</th><th className={th}>Orders</th></tr></thead>
                <tbody>{data.roles.map((row) => <tr key={row.role} className="border-t border-gray-100 dark:border-slate-800"><td className={`${td} font-semibold`}>{row.role}</td><td className={td}>{row.people}</td><td className={td}>{row.visits}</td><td className={td}>{duration(row.seconds)}</td><td className={td}>{row.pages}</td><td className={td}>{data.storeConnected ? row.carts : "—"}</td><td className={td}>{data.storeConnected ? row.orders : "—"}</td></tr>)}
                  {!data.roles.length && <tr><td className={td} colSpan={7}>Nobody has opened Our Store in this period yet.</td></tr>}</tbody></table></div>
            </div>
            <div className={card}>
              <h3 className="m-0 mb-2 text-[16px] font-bold text-gray-900 dark:text-slate-50">Most viewed in the store</h3>
              {data.topPages.length ? (
                <ol className="m-0 space-y-1.5 pl-5 text-[13px]">{data.topPages.map((row) => <li key={row.url}><span className="font-semibold">{row.title}</span>{row.kind === "product" && <span className="ml-1 rounded bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800">product</span>} <span className="text-gray-500">· {row.views} views</span></li>)}</ol>
              ) : <p className="m-0 text-[13px] text-gray-500">{data.storeConnected ? "No store pages viewed in this period." : "Shows once the store snippet is added."}</p>}
            </div>
          </div>

          <PeopleSection data={data} roles={roles} role={role} setRole={setRole} />
          <ActivitySection data={data} role={role} />
        </>
      )}
    </div>
  );
}

// ── Paging and grouping (Bright, 9 Nov 2026: "add pagination to avoid endless scrolling and add grouping for scalable") ──

const PAGE = 10;
const pages = (n: number) => Math.max(1, Math.ceil(n / PAGE));

/** Previous / page x of y / next; hidden when everything fits on one page. */
function Pager({ page, total, onPage, noun }: { page: number; total: number; onPage: (page: number) => void; noun: string }) {
  const last = pages(total);
  if (total <= PAGE) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-gray-600 dark:text-slate-400">
      <span>Showing {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total} {noun}</span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page" className="!min-h-0 rounded-lg border border-gray-200 p-1.5 disabled:opacity-40 dark:border-slate-700"><ChevronLeft className="h-4 w-4" /></button>
        <span className="px-2 font-semibold">Page {page + 1} of {last}</span>
        <button type="button" disabled={page >= last - 1} onClick={() => onPage(page + 1)} aria-label="Next page" className="!min-h-0 rounded-lg border border-gray-200 p-1.5 disabled:opacity-40 dark:border-slate-700"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

const cardCls = "rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900";
const thCls = "px-3 py-2 text-left text-[11.5px] font-bold uppercase tracking-wide text-gray-500";
const tdCls = "px-3 py-2 text-[13px] text-gray-800 dark:text-slate-200";
type Person = StoreActivitySummary["people"][number];

/** People grouped by role (each role folds open, 10 a page), or one paged list; who hasn't opened it, by role. */
function PeopleSection({ data, roles, role, setRole }: { data: StoreActivitySummary; roles: string[]; role: string; setRole: (role: string) => void }) {
  const [grouped, setGrouped] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [pageOf, setPageOf] = useState<Record<string, number>>({});
  const people = data.people.filter((row) => !role || row.role === role);
  const notOpened = data.notOpened.filter((row) => !role || row.role === role);
  const groups = [...new Set(people.map((row) => row.role || "—"))].map((name) => {
    const list = people.filter((row) => (row.role || "—") === name);
    return { name, list, visits: list.reduce((n, row) => n + row.visits, 0), seconds: list.reduce((n, row) => n + row.seconds, 0), carts: list.reduce((n, row) => n + row.carts, 0), orders: list.reduce((n, row) => n + row.orders, 0) };
  }).sort((a, b) => b.visits - a.visits);
  const quietGroups = [...new Set(notOpened.map((row) => row.role || "—"))].map((name) => ({ name, list: notOpened.filter((row) => (row.role || "—") === name) })).sort((a, b) => b.list.length - a.list.length);
  const head = <thead><tr><th className={thCls}>Person</th><th className={thCls}>Role</th><th className={thCls}>Visits</th><th className={thCls}>Days</th><th className={thCls}>Time</th><th className={thCls}>Pages</th><th className={thCls}>Products</th><th className={thCls}>Searches</th><th className={thCls}>Cart</th><th className={thCls}>Orders</th><th className={thCls}>Full screen</th><th className={thCls}>Last seen</th></tr></thead>;
  const rowOf = (row: Person) => (
    <tr key={row.userId} className="border-t border-gray-100 dark:border-slate-800"><td className={`${tdCls} font-semibold`}>{row.name}</td><td className={tdCls}>{row.role}</td><td className={tdCls}>{row.visits}</td><td className={tdCls}>{row.activeDays}</td><td className={tdCls}>{duration(row.seconds)}</td><td className={tdCls}>{row.pages}</td><td className={tdCls}>{data.storeConnected ? row.products : "—"}</td><td className={tdCls}>{data.storeConnected ? row.searches : "—"}</td><td className={tdCls}>{data.storeConnected ? row.carts : "—"}</td><td className={tdCls}>{data.storeConnected ? row.orders : "—"}</td><td className={tdCls}>{row.fullStore}</td><td className={tdCls}>{when(row.lastAt)}</td></tr>
  );
  const page = (key: string) => pageOf[key] ?? 0;
  const setPage = (key: string, n: number) => setPageOf((prev) => ({ ...prev, [key]: n }));
  return (
    <div className={cardCls}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="m-0 mr-auto text-[16px] font-bold text-gray-900 dark:text-slate-50">By person</h3>
        <div className="flex rounded-xl border border-gray-200 p-0.5 dark:border-slate-700">
          <button type="button" aria-pressed={grouped} onClick={() => setGrouped(true)} className={`!min-h-0 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${grouped ? "bg-amber-400 text-amber-950" : "text-gray-600"}`}>Group by role</button>
          <button type="button" aria-pressed={!grouped} onClick={() => setGrouped(false)} className={`!min-h-0 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${!grouped ? "bg-amber-400 text-amber-950" : "text-gray-600"}`}>One list</button>
        </div>
        <select value={role} onChange={(event) => { setRole(event.target.value); setPageOf({}); }} aria-label="Role" className="!min-h-0 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[13px] dark:border-slate-700 dark:bg-slate-900">
          <option value="">All roles</option>{roles.map((row) => <option key={row} value={row}>{row}</option>)}
        </select>
      </div>
      {!people.length && <p className="m-0 text-[13px] text-gray-500">Nobody has opened Our Store in this period yet.</p>}
      {people.length > 0 && !grouped && (
        <>
          <div className="overflow-x-auto"><table className="w-full">{head}<tbody>{people.slice(page("all") * PAGE, (page("all") + 1) * PAGE).map(rowOf)}</tbody></table></div>
          <Pager page={page("all")} total={people.length} onPage={(n) => setPage("all", n)} noun="people" />
        </>
      )}
      {people.length > 0 && grouped && (
        <div className="space-y-2">
          {groups.map((group) => {
            const isOpen = open[group.name] ?? groups.length <= 3;
            return (
              <div key={group.name} className="overflow-hidden rounded-xl border border-gray-100 dark:border-slate-800">
                <button type="button" onClick={() => setOpen((prev) => ({ ...prev, [group.name]: !isOpen }))} aria-expanded={isOpen}
                  className="!min-h-0 flex w-full flex-wrap items-center gap-x-4 gap-y-1 bg-amber-50/60 px-3 py-2.5 text-left text-[13px] dark:bg-amber-500/5">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-amber-700" /> : <ChevronRight className="h-4 w-4 text-amber-700" />}
                  <span className="mr-auto font-bold text-gray-900 dark:text-slate-50">{group.name} <span className="font-semibold text-gray-500">· {group.list.length} {group.list.length === 1 ? "person" : "people"}</span></span>
                  <span className="text-gray-600 dark:text-slate-400">{group.visits} visits</span><span className="text-gray-600 dark:text-slate-400">{duration(group.seconds)}</span>
                  {data.storeConnected && <span className="text-gray-600 dark:text-slate-400">{group.carts} cart · {group.orders} orders</span>}
                </button>
                {isOpen && (
                  <div className="px-1 pb-2">
                    <div className="overflow-x-auto"><table className="w-full">{head}<tbody>{group.list.slice(page(group.name) * PAGE, (page(group.name) + 1) * PAGE).map(rowOf)}</tbody></table></div>
                    <div className="px-2"><Pager page={page(group.name)} total={group.list.length} onPage={(n) => setPage(group.name, n)} noun="people" /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {notOpened.length > 0 && (
        <div className="mt-3 rounded-xl bg-gray-50 p-3 dark:bg-slate-800/60">
          <div className="text-[12.5px] font-bold text-gray-700 dark:text-slate-300">Not opened in this period ({notOpened.length})</div>
          <div className="mt-2 space-y-1.5">
            {quietGroups.map((group) => {
              const key = `quiet:${group.name}`;
              const isOpen = open[key] ?? false;
              return (
                <div key={group.name}>
                  <button type="button" onClick={() => setOpen((prev) => ({ ...prev, [key]: !isOpen }))} aria-expanded={isOpen} className="!min-h-0 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{group.name} <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-bold dark:bg-slate-700">{group.list.length}</span>
                  </button>
                  {isOpen && (
                    <>
                      <div className="mt-1 flex flex-wrap gap-1.5 pl-5">{group.list.slice(page(key) * 24, (page(key) + 1) * 24).map((row) => <span key={row.userId} className="rounded-lg bg-white px-2 py-1 text-[12px] text-gray-700 shadow-sm dark:bg-slate-900 dark:text-slate-300">{row.name}</span>)}</div>
                      {group.list.length > 24 && (
                        <div className="mt-1 flex items-center gap-2 pl-5 text-[12px] text-gray-500">
                          <button type="button" disabled={page(key) === 0} onClick={() => setPage(key, page(key) - 1)} className="!min-h-0 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                          {page(key) + 1} / {Math.ceil(group.list.length / 24)}
                          <button type="button" disabled={(page(key) + 1) * 24 >= group.list.length} onClick={() => setPage(key, page(key) + 1)} className="!min-h-0 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

type Activity = StoreActivitySummary["recent"][number];
const lagosDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const dayLabel = (day: string, today: string) => {
  if (day === today) return "Today";
  const y = new Date(`${today}T12:00:00Z`); y.setUTCDate(y.getUTCDate() - 1);
  if (day === y.toISOString().slice(0, 10)) return "Yesterday";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
};
const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit" });
const actionText = (row: Activity) => `${WHAT[row.event] ?? row.event}${row.event === "search" && row.detail?.query ? `: "${String(row.detail.query)}"` : ""}${row.title && row.event !== "open" ? `: ${row.title}` : ""}`;

/** The feed as visits: one line per visit (who, when, what it added up to), under day headings; open a visit to see each step. 10 visits a page. */
function ActivitySection({ data, role }: { data: StoreActivitySummary; role: string }) {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const visits = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const row of data.recent) {
      if (role && row.role !== role) continue;
      map.set(row.sessionId, [...(map.get(row.sessionId) ?? []), row]);
    }
    return [...map.entries()].map(([id, list]) => {
      const steps = [...list].sort((a, b) => a.at.localeCompare(b.at));
      const count = (kind: string) => steps.filter((row) => row.event === kind).length;
      return { id, steps, first: steps[0], last: steps[steps.length - 1], pages: count("page") + count("product"), products: count("product"), searches: count("search"), carts: count("cart"), orders: count("order") };
    }).sort((a, b) => b.last.at.localeCompare(a.last.at));
  }, [data.recent, role]);
  const shown = visits.slice(page * PAGE, (page + 1) * PAGE);
  let lastDay = "";
  return (
    <div className={cardCls}>
      <h3 className="m-0 mb-2 text-[16px] font-bold text-gray-900 dark:text-slate-50">Latest activity <span className="text-[13px] font-semibold text-gray-500">· by visit</span></h3>
      {!visits.length && <p className="m-0 text-[13px] text-gray-500">Nothing yet in this period.</p>}
      <div className="space-y-1.5">
        {shown.map((visit) => {
          const day = lagosDay(visit.first.at);
          const heading = day !== lastDay ? dayLabel(day, data.today) : null;
          lastDay = day;
          const isOpen = open[visit.id] ?? false;
          const summary = [
            `${visit.pages} page${visit.pages === 1 ? "" : "s"}`,
            ...(visit.products ? [`${visit.products} product${visit.products === 1 ? "" : "s"}`] : []),
            ...(visit.searches ? [`${visit.searches} search${visit.searches === 1 ? "" : "es"}`] : []),
            ...(visit.carts ? [`${visit.carts} added to cart`] : []),
            ...(visit.orders ? [`${visit.orders} order${visit.orders === 1 ? "" : "s"}`] : [])
          ].join(" · ");
          return (
            <div key={visit.id}>
              {heading && <div className="pb-1 pt-2 text-[11.5px] font-extrabold uppercase tracking-wide text-amber-700 dark:text-amber-300">{heading}</div>}
              <div className="overflow-hidden rounded-xl border border-gray-100 dark:border-slate-800">
                <button type="button" onClick={() => setOpen((prev) => ({ ...prev, [visit.id]: !isOpen }))} aria-expanded={isOpen}
                  className="!min-h-0 flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left text-[13px] hover:bg-amber-50/50 dark:hover:bg-amber-500/5">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-amber-700" /> : <ChevronRight className="h-4 w-4 text-amber-700" />}
                  <span className="w-[110px] shrink-0 text-gray-500">{timeOnly(visit.first.at)}{visit.last.at !== visit.first.at ? `–${timeOnly(visit.last.at)}` : ""}</span>
                  <span className="font-semibold text-gray-900 dark:text-slate-50">{visit.first.name}</span><span className="text-gray-500">({visit.first.role})</span>
                  <span className="ml-auto text-gray-700 dark:text-slate-300">{summary}</span>
                  {visit.orders > 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">ordered</span>}
                </button>
                {isOpen && (
                  <ul className="m-0 list-none space-y-1 border-t border-gray-100 bg-gray-50/60 px-4 py-2 dark:border-slate-800 dark:bg-slate-800/40">
                    {visit.steps.map((row, i) => (
                      <li key={`${row.at}-${i}`} className="flex gap-3 text-[12.5px]"><span className="w-[64px] shrink-0 text-gray-500">{timeOnly(row.at)}</span><span className="text-gray-800 dark:text-slate-200">{actionText(row)}</span></li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Pager page={page} total={visits.length} onPage={(n) => { setPage(n); setOpen({}); }} noun="visits" />
    </div>
  );
}
