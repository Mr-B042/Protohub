import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Coins, Mail, MailOpen, MousePointerClick, Pencil, ShoppingCart, UserMinus, X } from "lucide-react";
import { emailMarketingApi, type EmReport } from "../../lib/api";
import { ErrorNote, GOAL_TYPES, Loading, Pill, STATUS_LOOK, Thumb, btn, count, lagosDate, naira, pct, rate } from "./em-ui";

/**
 * A campaign's results (the chart button on the Campaigns page). No design
 * was sent for this panel; it uses the same cards and words as the page.
 */
export default function CampaignReport({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (id: string) => void }) {
  const [data, setData] = useState<EmReport | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    emailMarketingApi.report(id).then((result) => { if (live) setData(result); }).catch((err) => { if (live) setError((err as Error).message || "Could not load the results."); });
    return () => { live = false; };
  }, [id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const c = data?.campaign;
  const s = c?.stats;
  const tiles = s ? [
    { icon: Mail, label: "Sent", value: count(s.sent), sub: s.queued ? `${count(s.queued)} waiting` : s.failed ? `${count(s.failed)} failed` : "" },
    { icon: MailOpen, label: "Opened", value: pct(rate(s.opened, s.sent)), sub: `${count(s.opened)} people` },
    { icon: MousePointerClick, label: "Clicked", value: pct(rate(s.clicked, s.sent)), sub: `${count(s.clicked)} people` },
    { icon: ShoppingCart, label: "Orders", value: count(s.orders), sub: `${count(s.deliveredOrders)} delivered` },
    { icon: Coins, label: "Revenue", value: naira(s.revenue), sub: "Delivered orders only" },
    { icon: UserMinus, label: "Unsubscribed", value: count(s.unsubscribed), sub: "" }
  ] : [];

  return createPortal(
    <div className="fixed inset-0 z-[85] flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside className="flex h-full w-full max-w-[640px] flex-col bg-white shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4 dark:border-slate-800">
          {c && <Thumb src={c.thumbnailUrl} goal={c.goal} size={52} />}
          <div className="min-w-0 flex-1">
            <h2 className="m-0 truncate text-[19px] font-extrabold text-gray-900 dark:text-slate-50">{c?.name ?? "Campaign results"}</h2>
            {c && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-gray-600 dark:text-slate-400">
                <Pill tone={(GOAL_TYPES[c.goal] ?? GOAL_TYPES.retention).tone}>{(GOAL_TYPES[c.goal] ?? GOAL_TYPES.retention).label}</Pill>
                <Pill tone={(STATUS_LOOK[c.status] ?? STATUS_LOOK.draft).tone}>{(STATUS_LOOK[c.status] ?? STATUS_LOOK.draft).label}</Pill>
                <span>To {c.audienceLabel ?? "—"}</span>
                {c.stats.lastSentAt && <span>· Last sent {lagosDate(c.stats.lastSentAt, true)}</span>}
              </div>
            )}
          </div>
          {c && ["draft", "scheduled", "paused", "active"].includes(c.status) && <button type="button" onClick={() => onEdit(c.id)} className={btn.outline}><Pencil className="h-3.5 w-3.5" />Edit</button>}
          <button type="button" aria-label="Close" onClick={onClose} className={btn.icon}><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 min-h-0 space-y-4 overflow-y-auto px-5 py-4">
          <ErrorNote message={error} />
          {!data && !error && <Loading />}
          {c && s && (
            <>
              <p className="m-0 rounded-xl bg-[#F7F4FF] px-3 py-2 text-[12.5px] text-gray-700 dark:bg-slate-800 dark:text-slate-300">
                Subject: <strong>{c.subject || "—"}</strong>{c.subjectB && c.options?.abTest ? <> · B: <strong>{c.subjectB}</strong></> : null}
              </p>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {tiles.map(({ icon: Icon, label, value, sub }) => (
                  <div key={label} className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                    <div className="flex items-center gap-1.5 text-[12.5px] text-gray-600 dark:text-slate-400"><Icon className="h-4 w-4 text-[#5B3FD9]" />{label}</div>
                    <div className="mt-1 text-[20px] font-extrabold text-gray-900 dark:text-slate-50">{value}</div>
                    {sub && <div className="text-[11.5px] text-gray-500">{sub}</div>}
                  </div>
                ))}
              </div>

              {c.options?.abTest && (s.a.sent > 0 || s.b.sent > 0) && (
                <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                  <p className="m-0 mb-2 text-[14px] font-bold text-gray-900 dark:text-slate-50">A/B test: which subject did better</p>
                  {(["a", "b"] as const).map((key) => {
                    const half = s[key];
                    const open = rate(half.opened, half.sent);
                    const other = rate(s[key === "a" ? "b" : "a"].opened, s[key === "a" ? "b" : "a"].sent);
                    return (
                      <div key={key} className="flex items-center gap-2 py-1 text-[13px]">
                        <span className="w-6 font-bold uppercase">{key}</span>
                        <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-slate-300">{key === "a" ? c.subject : c.subjectB}</span>
                        <span className="tabular-nums">{count(half.sent)} sent</span>
                        <span className="w-16 text-right font-bold tabular-nums">{pct(open)}</span>
                        {open !== null && other !== null && open > other && <Pill tone="green">Better</Pill>}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="rounded-xl border border-gray-200 dark:border-slate-700">
                <p className="m-0 border-b border-gray-100 px-3 py-2 text-[14px] font-bold text-gray-900 dark:border-slate-800 dark:text-slate-50">Clicks by link</p>
                {data!.links.length ? data!.links.map((link, index) => (
                  <div key={index} className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-[13px] last:border-0 dark:border-slate-800">
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-gray-800 dark:text-slate-200">{link.label}</span><span className="block truncate text-[11.5px] text-gray-500">{link.url}</span></span>
                    <span className="font-bold tabular-nums">{count(link.clicks)}</span>
                  </div>
                )) : <p className="m-0 px-3 py-3 text-[13px] text-gray-500">Links show here once the campaign sends.</p>}
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-slate-700">
                <p className="m-0 border-b border-gray-100 px-3 py-2 text-[14px] font-bold text-gray-900 dark:border-slate-800 dark:text-slate-50">Orders from this email</p>
                {data!.orders.length ? data!.orders.map((order) => (
                  <div key={order.id} className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-[13px] last:border-0 dark:border-slate-800">
                    <span className="w-20 font-bold text-[#5B3FD9]">#{order.id}</span>
                    <span className="min-w-0 flex-1 truncate">{order.customer}</span>
                    <Pill tone={order.status === "Delivered" ? "green" : order.status === "Cancelled" || order.status === "Failed" ? "red" : "slate"}>{order.status}</Pill>
                    <span className="w-24 text-right font-bold tabular-nums">{naira(order.amount)}</span>
                  </div>
                )) : <p className="m-0 px-3 py-3 text-[13px] text-gray-500">No order has come from this email yet. An order counts when it is placed from the email's link, or by the same phone or email within 7 days of a click.</p>}
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-slate-700">
                <p className="m-0 border-b border-gray-100 px-3 py-2 text-[14px] font-bold text-gray-900 dark:border-slate-800 dark:text-slate-50">People ({count(data!.sends.length)}{data!.sends.length >= 300 ? "+, newest 300" : ""})</p>
                <div className="max-h-[320px] overflow-y-auto">
                  {data!.sends.length ? data!.sends.map((send, index) => (
                    <div key={`${send.email}-${send.kind}-${send.runNo}-${index}`} className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-[12.5px] last:border-0 dark:border-slate-800">
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-gray-800 dark:text-slate-200">{send.name || send.email}</span><span className="block truncate text-[11.5px] text-gray-500">{send.email}{send.kind === "resend" ? " · resent" : ""}</span></span>
                      {send.status === "sent"
                        ? <>{send.clickedAt ? <Pill tone="purple">Clicked</Pill> : send.openedAt ? <Pill tone="blue">Opened</Pill> : <Pill tone="slate">Sent</Pill>}{send.orderId && <Pill tone="green">Ordered</Pill>}{send.unsubscribedAt && <Pill tone="red">Unsubscribed</Pill>}</>
                        : send.status === "queued" ? <Pill tone="amber">Waiting</Pill> : send.status === "skipped" ? <Pill tone="slate" className="max-w-[160px] truncate">{send.error ?? "Skipped"}</Pill> : <Pill tone="red" className="max-w-[180px] truncate">{send.error ?? "Failed"}</Pill>}
                    </div>
                  )) : <p className="m-0 px-3 py-3 text-[13px] text-gray-500">Nobody has been sent this email yet.</p>}
                </div>
              </div>
              <p className="m-0 text-[11.5px] leading-snug text-gray-500">Opens are counted when the email's pictures load; some email apps load them by themselves, others block them, so opens are a guide. Clicks and orders are exact.</p>
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}
