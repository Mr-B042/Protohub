import { useEffect, useState } from "react";
import { metaCapiSettingsApi, type MetaCapiEventRow } from "../lib/api";

/**
 * Meta Conversions API record (Bright, 1 Oct 2026): whether Meta actually got
 * an order's Purchase and Delivered events. Owner only (the settings route is).
 */
const STATUS: Record<MetaCapiEventRow["status"], { label: string; tone: string }> = {
  sent: { label: "Sent to Meta", tone: "bg-emerald-50 text-emerald-700" },
  dry_run: { label: "Test only (not sent)", tone: "bg-sky-50 text-sky-700" },
  rejected: { label: "Meta refused it", tone: "bg-rose-50 text-rose-700" },
  failed: { label: "Could not reach Meta", tone: "bg-amber-50 text-amber-800" },
  duplicate: { label: "Repeat blocked", tone: "bg-gray-100 text-gray-600" },
  missing_config: { label: "Pixel or token missing", tone: "bg-amber-50 text-amber-800" }
};
const when = (iso: string) => new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function MetaOrderEventsCard({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<MetaCapiEventRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    metaCapiSettingsApi.events(orderId).then((data) => { if (!cancelled) setRows(data); }).catch(() => { if (!cancelled) setRows(null); });
    return () => { cancelled = true; };
  }, [orderId]);
  if (rows === null) return null;
  return (
    <section className="mt-4 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[13px] dark:border-slate-700 dark:bg-white/[0.03]">
      <p className="m-0 text-[11px] font-black uppercase tracking-[0.14em] text-gray-500">Meta Conversions API</p>
      {rows.length === 0 ? (
        <p className="m-0 mt-1 text-gray-500">Protohub sent nothing to Meta for this order (the landing page's own Pixel handles it, or tracking is off).</p>
      ) : (
        <ul className="m-0 mt-1.5 list-none space-y-1.5 p-0">
          {rows.map((row) => (
            <li key={row.eventName} className="flex flex-wrap items-center gap-2">
              <strong className="text-gray-900 dark:text-slate-100">{row.eventName === "Delivered" ? `Delivered sale (${row.metaEventName})` : "Purchase"}</strong>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS[row.status].tone}`}>{STATUS[row.status].label}</span>
              {row.testMode ? <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700">Test event</span> : null}
              <span className="text-[12px] text-gray-500">{when(row.sentAt)}{row.attempts > 1 ? ` · ${row.attempts} tries` : ""}</span>
              {row.message && row.status !== "sent" ? <span className="basis-full text-[12px] text-rose-700">{row.message}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MetaCapiSummary() {
  const [data, setData] = useState<Awaited<ReturnType<typeof metaCapiSettingsApi.eventsSummary>> | null>(null);
  useEffect(() => { metaCapiSettingsApi.eventsSummary().then(setData).catch(() => undefined); }, []);
  if (!data) return null;
  const events = ["Purchase", "Delivered"] as const;
  const total = (name: string) => Object.values(data.counts[name] ?? {}).reduce((sum, value) => sum + value, 0);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
      <p className="m-0 text-sm font-black text-gray-900">What Meta received — last 7 days</p>
      <p className="m-0 mt-0.5 text-xs text-gray-500">Only events Protohub sends itself. The landing page's own Pixel is not counted here.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {events.map((name) => (
          <div key={name} className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5">
            <p className="m-0 text-xs font-black text-gray-700">{name === "Purchase" ? "Purchase (order created)" : "Delivered sale"} · {total(name)}</p>
            {total(name) === 0 ? <p className="m-0 mt-1 text-xs text-gray-400">None.</p> : (
              <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-xs">
                {Object.entries(data.counts[name] ?? {}).map(([status, count]) => (
                  <li key={status} className="flex justify-between"><span className="text-gray-600">{STATUS[status as MetaCapiEventRow["status"]]?.label ?? status}</span><strong>{count}</strong></li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {data.topProblems.length > 0 ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <strong className="block">Most common problems</strong>
          {data.topProblems.map((problem) => <span key={problem.message} className="block">{problem.count}× {problem.message}</span>)}
        </div>
      ) : null}
    </div>
  );
}
