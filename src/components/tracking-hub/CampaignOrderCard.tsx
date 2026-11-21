import { useState, type ReactNode } from "react";
import { BadgeCheck, ChevronDown, Clock, Gift, Headphones, Megaphone, MapPin, Package, Phone, PlusCircle, Send, Sparkles, StickyNote, Truck, Wallet } from "lucide-react";
import type { CdDayOrder } from "../../lib/api";
import { money } from "../../lib/money-privacy";
import { responseResult, sentOutTimeText } from "../../lib/late-send-clock";

// One order inside Campaign Decisions › Daily performance (Bright, 21 Nov
// 2026: "well detailed breakdown ... sales rep ... beautiful ... all info
// needed"). Who bought what, the rep and how fast they confirmed (same
// working-minutes rule as the Orders page), the delivery agent, the status
// timeline, notes, the order's own money and the ad that brought it.

const FAILED = ["Failed", "Cancelled", "Rejected", "Returned"];
const statusTone = (status: string) => status === "Delivered" ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300"
  : FAILED.includes(status) ? "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300"
  : status === "New" ? "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300"
  : "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300";
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const time = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
const daysBetween = (fromIso: string, toDay: string) => Math.max(0, Math.round((Date.parse(`${toDay}T12:00:00Z`) - Date.parse(fromIso)) / 86_400_000));

function Block({ icon, title, children, tone = "text-gray-500" }: { icon: ReactNode; title: string; children: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
      <p className={`m-0 mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide ${tone}`}>{icon}{title}</p>
      {children}
    </div>
  );
}
function Line({ label, value, strong, tone }: { label: string; value: ReactNode; strong?: boolean; tone?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-[12.5px] ${strong ? "mt-1 border-t border-dashed border-gray-200 pt-1.5 font-extrabold dark:border-slate-700" : ""}`}>
      <span className="text-gray-600 dark:text-slate-400">{label}</span><span className={`tabular-nums ${tone ?? "text-gray-900 dark:text-slate-100"}`}>{value}</span>
    </div>
  );
}

export default function CampaignOrderCard({ order, adCostShare, today, index }: { order: CdDayOrder; adCostShare: number | null; today: string; index: number }) {
  const [more, setMore] = useState(false);
  const delivered = order.status === "Delivered";
  const failed = FAILED.includes(order.status);
  const response = responseResult({ placedAt: order.createdAt, assignedAt: order.assignedAt, revealedAt: order.revealedAt, sentOutAt: order.sentOutAt });
  const afterAds = adCostShare === null ? null : order.money.contributionBeforeAds - adCostShare;
  const extrasTotal = [...order.crossSells, ...order.extras].reduce((s, l) => s + l.amount, 0);

  return (
    <article style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className="cd-card-in overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-900">
      {/* Customer strip */}
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-gradient-to-r from-indigo-50/70 to-transparent px-4 py-3 dark:border-slate-800 dark:from-indigo-500/10">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[13px] font-black text-white">{initials(order.customer)}</span>
        <div className="min-w-0 flex-1">
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-[14.5px] font-extrabold text-gray-900 dark:text-slate-50">{order.customer || "Customer"}<span className="text-[11.5px] font-semibold text-gray-400">#{order.id}</span></p>
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-gray-600 dark:text-slate-400">
            {order.phone ? <a href={`tel:${order.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-indigo-700 hover:underline dark:text-indigo-300"><Phone className="h-3 w-3" />{order.phone}</a> : null}
            <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{[order.city, order.state].filter(Boolean).join(", ") || "—"}</span>
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />Placed {time(order.createdAt)}</span>
            {order.source ? <span>via {order.source}</span> : null}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-bold ring-1 ${statusTone(order.status)}`}>{delivered ? <BadgeCheck className="h-3.5 w-3.5" /> : null}{order.status}</span>
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        {/* What they bought */}
        <Block icon={<Package className="h-3.5 w-3.5" />} title="What they bought" tone="text-violet-600">
          <p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-100">{order.product}</p>
          <p className="m-0 text-[12px] text-gray-600 dark:text-slate-400">{order.packageName ?? "—"}{order.quantity > 1 ? ` · ×${order.quantity}` : ""}</p>
          {order.upsell ? <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><Sparkles className="h-3 w-3" />Upgraded {order.upsell.from} → {order.upsell.to}</span> : null}
          {[...order.crossSells.map((l) => ({ ...l, kind: "Cross-sell" })), ...order.extras.map((l) => ({ ...l, kind: "Extra" }))].map((l, i) => (
            <p key={i} className="m-0 mt-1 flex items-start gap-1 text-[11.5px] text-gray-700 dark:text-slate-300"><PlusCircle className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" /><span>{l.kind}: <b>{l.name}</b> ×{l.quantity} · {money(l.amount)}{l.by ? <span className="text-gray-400"> · added by {l.by}</span> : null}</span></p>
          ))}
          {order.freeGifts.map((l, i) => <p key={`g${i}`} className="m-0 mt-1 flex items-center gap-1 text-[11.5px] text-gray-700 dark:text-slate-300"><Gift className="h-3 w-3 text-pink-500" />Free gift: {l.name}</p>)}
          <p className="m-0 mt-2 text-[16px] font-black text-gray-900 dark:text-slate-50">{money(order.amount)}{order.originalAmount !== null && order.originalAmount !== order.amount ? <span className="ml-1.5 text-[11px] font-semibold text-gray-400">form price {money(order.originalAmount)}</span> : null}</p>
          {extrasTotal ? <p className="m-0 text-[11px] text-emerald-700 dark:text-emerald-300">{money(extrasTotal)} of it from add-ons</p> : null}
        </Block>

        {/* Sales rep */}
        <Block icon={<Headphones className="h-3.5 w-3.5" />} title="Sales rep" tone="text-sky-600">
          {order.rep ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[11px] font-black text-white">{initials(order.rep.name)}</span>
              <div className="min-w-0"><p className="m-0 truncate text-[13px] font-bold text-gray-900 dark:text-slate-100">{order.rep.name}</p><p className="m-0 text-[11px] text-gray-500">{order.rep.role || "Sales Rep"}</p></div>
            </div>
          ) : <p className="m-0 text-[12.5px] text-gray-500">Not assigned to a rep</p>}
          <div className="mt-2 space-y-1">
            {order.sentOutAt ? (
              <p className={`m-0 inline-flex flex-wrap items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold ${response?.state === "late" ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"}`}>
                <BadgeCheck className="h-3.5 w-3.5" />{["Postponed", "Failed", "Cancelled"].includes(order.sentOutStatus ?? "") ? "Responded" : "Confirmed"} {sentOutTimeText(Date.parse(order.sentOutAt), Date.now())}
                {response ? <span>· in {Math.max(1, Math.round(response.workingMs / 60_000))} working min{response.state === "late" ? " (late)" : ""}</span> : null}
              </p>
            ) : order.status === "New" ? <p className="m-0 text-[11.5px] font-semibold text-amber-700">Still New: not confirmed yet</p> : null}
            {order.groupSentAt ? <p className="m-0 flex items-center gap-1 text-[11.5px] text-gray-600 dark:text-slate-400"><Send className="h-3 w-3" />Sent to group {sentOutTimeText(Date.parse(order.groupSentAt), Date.now())}</p> : null}
          </div>
        </Block>

        {/* Delivery */}
        <Block icon={<Truck className="h-3.5 w-3.5" />} title="Delivery" tone="text-amber-600">
          {order.agent ? (
            <>
              <p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-100">{order.agent.name}</p>
              <p className="m-0 text-[11.5px] text-gray-500">{[order.agent.zone, order.agent.phone].filter(Boolean).join(" · ") || "—"}</p>
            </>
          ) : <p className="m-0 text-[12.5px] text-gray-500">No delivery agent yet</p>}
          {order.address ? <p className="m-0 mt-1.5 line-clamp-2 text-[11.5px] text-gray-600 dark:text-slate-400" title={order.address}>{order.address}</p> : null}
          <p className={`m-0 mt-2 text-[12px] font-semibold ${delivered ? "text-emerald-700" : failed ? "text-rose-600" : "text-amber-700"}`}>
            {delivered ? `Delivered ${order.deliveredDay ? new Date(`${order.deliveredDay}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}${order.deliveredDay ? ` · ${daysBetween(order.createdAt, order.deliveredDay)} day${daysBetween(order.createdAt, order.deliveredDay) === 1 ? "" : "s"} after the order` : ""}`
              : failed ? `${order.status}${order.money.failedFee ? ` · ${money(order.money.failedFee)} wasted on delivery` : ""}`
              : `Waiting ${daysBetween(order.createdAt, today)} day${daysBetween(order.createdAt, today) === 1 ? "" : "s"} so far`}
          </p>
        </Block>

        {/* Money */}
        <Block icon={<Wallet className="h-3.5 w-3.5" />} title="This order's money" tone="text-emerald-600">
          {delivered ? (
            <>
              <Line label="Sale" value={money(order.amount)} />
              <Line label="Product cost" value={`− ${money(order.money.productCost)}`} />
              <Line label="Delivery fee" value={`− ${money(order.money.deliveryFee)}`} />
              <Line label="Rep bonus" value={order.money.repBonus === null ? "not read" : `− ${money(order.money.repBonus)}`} />
              {order.money.failedFee ? <Line label="Failed-delivery fee" value={`− ${money(order.money.failedFee)}`} /> : null}
              <Line label="Before ads" value={money(order.money.contributionBeforeAds)} strong tone={order.money.contributionBeforeAds >= 0 ? "text-emerald-600" : "text-rose-600"} />
            </>
          ) : (
            <p className="m-0 text-[12px] text-gray-600 dark:text-slate-400">{failed ? `Brought no money${order.money.failedFee ? ` and cost ${money(order.money.failedFee)} in a failed delivery` : ""}.` : "Not a sale yet: counted only once delivered."}</p>
          )}
          {adCostShare !== null ? <Line label="Ad cost (share of the day)" value={`− ${money(adCostShare)}`} /> : null}
          {afterAds !== null ? <Line label={delivered ? "After ads" : "So far"} value={money(afterAds)} strong tone={afterAds >= 0 ? "text-emerald-600" : "text-rose-600"} /> : null}
        </Block>
      </div>

      {/* Ad · timeline · notes */}
      <footer className="border-t border-gray-100 px-4 py-2.5 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-gray-600 dark:text-slate-400">
          {order.ad ? <span className="inline-flex min-w-0 items-center gap-1"><Megaphone className="h-3.5 w-3.5 text-indigo-500" />From ad <b className="truncate text-gray-800 dark:text-slate-200">{order.ad.adName || order.ad.id}</b>{order.ad.adsetName ? <span className="truncate">· {order.ad.adsetName}</span> : null}</span> : <span className="inline-flex items-center gap-1"><Megaphone className="h-3.5 w-3.5" />Ad not known (campaign only)</span>}
          {(order.timeline.length || order.notes.length) ? (
            <button type="button" onClick={() => setMore(!more)} className="!min-h-0 ml-auto inline-flex items-center gap-1 font-semibold text-indigo-700 dark:text-indigo-300">
              {more ? "Hide" : "Show"} history{order.timeline.length ? ` (${order.timeline.length} step${order.timeline.length === 1 ? "" : "s"})` : ""}{order.notes.length ? ` · ${order.notes.length} note${order.notes.length === 1 ? "" : "s"}` : ""}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${more ? "rotate-180" : ""}`} />
            </button>
          ) : null}
        </div>
        {more ? (
          <div className="cd-card-in mt-3 grid gap-4 pb-1 md:grid-cols-2">
            <ol className="relative m-0 list-none space-y-2.5 border-l-2 border-indigo-100 pl-4 dark:border-indigo-500/20">
              <li className="relative text-[12px]"><span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-sky-500 ring-2 ring-white dark:ring-slate-900" /><b>Placed</b> <span className="text-gray-500">{time(order.createdAt)}</span></li>
              {order.timeline.map((step, i) => (
                <li key={i} className="relative text-[12px]">
                  <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${step.to === "Delivered" ? "bg-emerald-500" : FAILED.includes(step.to ?? "") ? "bg-rose-500" : "bg-indigo-400"}`} />
                  <b>{step.from ? `${step.from} → ` : ""}{step.to ?? "Updated"}</b> <span className="text-gray-500">{time(step.at)}{step.by ? ` · ${step.by}` : ""}</span>
                  {step.note ? <span className="block text-gray-500">{step.note}</span> : null}
                </li>
              ))}
            </ol>
            <div className="space-y-1.5">
              {order.notes.length ? order.notes.map((n, i) => (
                <p key={i} className="m-0 flex gap-1.5 rounded-lg bg-amber-50/70 px-2.5 py-1.5 text-[12px] text-gray-700 dark:bg-amber-500/10 dark:text-slate-300"><StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /><span>{n.text}{n.by || n.at ? <span className="block text-[11px] text-gray-400">{[n.by, n.at ? time(n.at) : null].filter(Boolean).join(" · ")}</span> : null}</span></p>
              )) : <p className="m-0 text-[12px] text-gray-400">No notes on this order.</p>}
            </div>
          </div>
        ) : null}
      </footer>
    </article>
  );
}
