import { useEffect, useMemo, useState } from "react";
import { Check, Clock, Copy, Eye, ExternalLink, Package, Search, ShoppingCart, Store, Users } from "lucide-react";
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

          <div className={card}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="m-0 mr-auto text-[16px] font-bold text-gray-900 dark:text-slate-50">By person</h3>
              <select value={role} onChange={(event) => setRole(event.target.value)} aria-label="Role" className="!min-h-0 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[13px] dark:border-slate-700 dark:bg-slate-900">
                <option value="">All roles</option>{roles.map((row) => <option key={row} value={row}>{row}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={th}>Person</th><th className={th}>Role</th><th className={th}>Visits</th><th className={th}>Days</th><th className={th}>Time</th><th className={th}>Pages</th><th className={th}>Products</th><th className={th}>Searches</th><th className={th}>Cart</th><th className={th}>Orders</th><th className={th}>Full screen</th><th className={th}>Last seen</th></tr></thead>
              <tbody>{data.people.filter((row) => !role || row.role === role).map((row) => (
                <tr key={row.userId} className="border-t border-gray-100 dark:border-slate-800"><td className={`${td} font-semibold`}>{row.name}</td><td className={td}>{row.role}</td><td className={td}>{row.visits}</td><td className={td}>{row.activeDays}</td><td className={td}>{duration(row.seconds)}</td><td className={td}>{row.pages}</td><td className={td}>{data.storeConnected ? row.products : "—"}</td><td className={td}>{data.storeConnected ? row.searches : "—"}</td><td className={td}>{data.storeConnected ? row.carts : "—"}</td><td className={td}>{data.storeConnected ? row.orders : "—"}</td><td className={td}>{row.fullStore}</td><td className={td}>{when(row.lastAt)}</td></tr>
              ))}</tbody></table></div>
            {data.notOpened.filter((row) => !role || row.role === role).length > 0 && (
              <div className="mt-3 rounded-xl bg-gray-50 p-3 dark:bg-slate-800/60">
                <div className="text-[12.5px] font-bold text-gray-700 dark:text-slate-300">Not opened in this period ({data.notOpened.filter((row) => !role || row.role === role).length})</div>
                <div className="mt-1 text-[12.5px] text-gray-600 dark:text-slate-400">{data.notOpened.filter((row) => !role || row.role === role).map((row) => `${row.name} (${row.role})`).join(" · ")}</div>
              </div>
            )}
          </div>

          <div className={card}>
            <h3 className="m-0 mb-2 text-[16px] font-bold text-gray-900 dark:text-slate-50">Latest activity</h3>
            {data.recent.length ? (
              <ul className="m-0 max-h-[420px] list-none space-y-1.5 overflow-y-auto p-0">{data.recent.filter((row) => !role || row.role === role).map((row, i) => (
                <li key={`${row.at}-${i}`} className="flex flex-wrap items-baseline gap-x-2 border-b border-gray-50 pb-1.5 text-[13px] dark:border-slate-800">
                  <span className="w-[120px] shrink-0 text-gray-500">{when(row.at)}</span>
                  <span className="font-semibold text-gray-900 dark:text-slate-50">{row.name}</span><span className="text-gray-500">({row.role})</span>
                  <span className="text-gray-800 dark:text-slate-200">{WHAT[row.event] ?? row.event}{row.event === "search" && row.detail?.query ? `: "${String(row.detail.query)}"` : ""}{row.title && row.event !== "open" ? `: ${row.title}` : ""}</span>
                  {row.event === "search" && <Search className="h-3.5 w-3.5 text-amber-600" />}
                </li>
              ))}</ul>
            ) : <p className="m-0 text-[13px] text-gray-500">Nothing yet in this period.</p>}
          </div>
        </>
      )}
    </div>
  );
}
