import { ArrowDown, ArrowRight, CalendarClock, CheckCircle2, History, Package, Search, Truck } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Modal, longDate, nf } from "./WeeklyReportParts";
import { PAY_BY_REPORT_DAY_FROM, bonusComponentsFull, bonusInitialFinal, bonusWeekFor, reportDueDate, type WeeklyReportSnapshot } from "../pages/weekly-report-model";

/**
 * How a rep's weekly bonus adds up (Bright, 29 Oct 2026: "they said this
 * carry-over bonus is not adding up"). It does: the money from orders placed
 * in earlier weeks but delivered this week is INSIDE Base / Upsell /
 * Cross-sell, not on top. This window shows every step: which deliveries are
 * paid this week, how much each group brings, and how the full bonus becomes
 * the final pay.
 */

type Order = WeeklyReportSnapshot["orders"][number];
type Parts = { base: number; upsell: number; cross: number; total: number };

const partsOf = (orders: Order[]): Parts => {
  const sum = (pick: (order: Order) => number) => Math.round(orders.reduce((total, order) => total + pick(order), 0));
  const upsell = sum((order) => order.upsellBonus ?? 0);
  const cross = sum((order) => order.crossSellBonus ?? 0);
  const total = sum((order) => order.bonus);
  return { base: sum((order) => order.baseBonus ?? order.bonus - (order.upsellBonus ?? 0) - (order.crossSellBonus ?? 0)), upsell, cross, total };
};

const whenText = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
const pcs = (qty: number) => `${qty} ${qty === 1 ? "pc" : "pcs"}`;

const dayText = (key: string | null | undefined) => {
  if (!key) return "-";
  const date = new Date(`${key.slice(0, 10)}T12:00:00Z`);
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};

/** An order as it is today, for "which week is this order's bonus in?" (any week, any rep). */
export type FoundOrder = { id: string; customer: string; product: string; status: string; placedKey: string; deliveredKey: string | null; repName: string | null };

export function BonusBreakdownModal({ snap, repName, sym, onClose, lookupOrder, detailSource }: {
  snap: WeeklyReportSnapshot;
  repName: string;
  sym: string;
  onClose: () => void;
  lookupOrder?: (id: string) => FoundOrder | null;
  /** Today's figures, for the upgrade pieces and add-on items a report sent
   *  before they were saved does not carry. Amounts always come from snap. */
  detailSource?: WeeklyReportSnapshot | null;
}) {
  const money = (value: number) => `${value < 0 ? "-" : ""}${sym}${nf(Math.abs(value))}`;
  const t = snap.totals;
  const delivered = (order: Order) => order.status === "Delivered";

  const placed = snap.orders.filter((order) => order.placedThisWeek);
  const placedDelivered = placed.filter(delivered);
  // Which week pays an order: bonusWeekFor (by the report day from 25 Oct).
  const paysHere = (order: Order) => bonusWeekFor(order.date, order.deliveredDate) === snap.weekStart;
  const paidNow = placedDelivered.filter(paysHere);
  const paidNextWeek = placedDelivered.filter((order) => !paysHere(order));
  const carried = snap.orders.filter((order) => !order.placedThisWeek && delivered(order) && paysHere(order) && !order.lateRecorded);
  // The last day this week's own orders are paid here: Saturday, or the
  // report day (Tuesday after) from the week of 25 Oct.
  const cutoff = snap.weekStart >= PAY_BY_REPORT_DAY_FROM ? reportDueDate(snap.weekStart) : snap.weekEnd;
  const cutoffText = snap.weekStart >= PAY_BY_REPORT_DAY_FROM ? `${dayText(cutoff)} (report day)` : dayText(cutoff);
  // Delivered in an earlier week but marked delivered after that week's
  // report was sent, so no report paid it: paid now (29 Oct 2026).
  const late = snap.orders.filter((order) => delivered(order) && !!order.lateRecorded && !paysHere(order));
  const paidCount = paidNow.length + carried.length + late.length;

  const thisWeek = partsOf(paidNow);
  const earlier = partsOf(carried);
  const lateParts = partsOf(late);
  const paid = { base: Math.round(t.baseBonus), upsell: Math.round(t.upsellBonus), cross: Math.round(t.crossSellBonus), total: Math.round(t.baseBonus + t.upsellBonus + t.crossSellBonus) };
  const ordersSum = thisWeek.total + earlier.total + lateParts.total;
  const gap = paid.total - ordersSum;

  const full = bonusComponentsFull(snap);
  const fullTotal = Math.round(full.base + full.upsell + full.crossSell);
  const info = bonusInitialFinal(snap);
  const cutItems = info.items.filter((item) => item.label.includes("paid at half"));
  const otherTaken = info.items.filter((item) => !item.label.includes("paid at half"));
  const adjustments = Math.max(0, Math.round(t.adjustments ?? 0));
  const added = Math.max(0, Math.round(t.payoutChange ?? 0));
  const change = snap.payoutChangeDetail;
  const changeNote = change ? `${change.changedByName ? `By ${change.changedByName}` : "By the manager"}${change.reason ? `: "${change.reason}"` : ""}` : undefined;

  const weekLabel = `${longDate(snap.weekStart)} to ${longDate(snap.weekEnd)}`;

  return (
    <Modal title={`How ${repName}'s bonus adds up`} subtitle={`Week of ${weekLabel}. Every figure below comes from the report.`} onClose={onClose} wide>
      <div className="space-y-5 px-6 py-5 text-[13px] text-gray-800 dark:text-slate-200">

        <OrderFinder snap={snap} repName={repName} money={money} lookupOrder={lookupOrder} />

        {/* 1. Which deliveries are paid this week */}
        <section>
          <SectionTitle n={1} title="Which deliveries are paid this week" />
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
            <Box tone="gray" icon={<Package className="h-4 w-4" />} label="Orders placed this week" value={nf(t.orders)}
              note={`${nf(placedDelivered.length)} of them delivered so far = ${Math.round(t.deliveryRate)}% delivery rate. These ${nf(placedDelivered.length)} are split on the right.`} />
            <span className="hidden items-center text-gray-400 sm:flex"><ArrowRight className="h-5 w-5" /></span>
            <div className="grid gap-2">
              <Box tone="green" icon={<Truck className="h-4 w-4" />} label={`Delivered by ${cutoffText}: bonus paid now`} value={`${nf(paidNow.length)} delivered`} />
              {paidNextWeek.length > 0 ? (
                <Box tone="amber" icon={<CalendarClock className="h-4 w-4" />} label={`Delivered after ${cutoffText}: bonus paid in the week it was delivered`} value={`${nf(paidNextWeek.length)} delivered`}
                  note="They count in this week's delivery rate, but their bonus is paid in the week they were delivered." />
              ) : null}
            </div>
          </div>
          {late.length > 0 ? (
            <div className="mt-2">
              <Box tone="amber" icon={<CalendarClock className="h-4 w-4" />} label="Recorded late: delivered in an earlier week, marked delivered after that week's report was sent: bonus paid now" value={`${nf(late.length)} delivered`}
                note="No earlier report paid them, so this report does. Their dates are listed in the table below." />
            </div>
          ) : null}
          <div className="mt-2">
            <Box tone="blue" icon={<History className="h-4 w-4" />} label="Carried over: placed in an earlier week, delivered this week: bonus paid now" value={`${nf(carried.length)} delivered`}
              note="They are not in this week's orders or delivery rate (they belong to the week they were placed), but their bonus is paid now." />
          </div>
          <p className="m-0 mt-2 rounded-xl bg-gray-900 px-3 py-2.5 text-[13.5px] font-bold text-white dark:bg-slate-700">
            Bonus paid this week on {nf(paidCount)} delivered orders = {nf(paidNow.length)} from this week + {nf(carried.length)} carried over{late.length > 0 ? ` + ${nf(late.length)} recorded late` : ""}
          </p>
          {/* Bright, 29 Oct 2026: "44 delivered, now 48?" Say how one becomes the other. */}
          <div className="mt-2 rounded-xl border border-gray-200 px-3 py-2.5 text-[12.5px] dark:border-slate-700">
            <p className="m-0 font-bold text-gray-900 dark:text-slate-50">Why {nf(paidCount)} and not {nf(placedDelivered.length)}?</p>
            <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-gray-700 dark:text-slate-300">
              <li><b>{nf(placedDelivered.length)}</b> delivered from this week's orders (the delivery-rate figure)</li>
              {paidNextWeek.length > 0 ? <li><b>− {nf(paidNextWeek.length)}</b> of them delivered after {cutoffText}: their bonus is paid in the week they were delivered</li> : null}
              <li><b>= {nf(paidNow.length)}</b> delivered from this week's orders, bonus paid now</li>
              <li><b>+ {nf(carried.length)}</b> delivered this week from earlier weeks' orders (carried over)</li>
              {late.length > 0 ? <li><b>+ {nf(late.length)}</b> delivered in an earlier week but recorded too late for that week's report</li> : null}
              <li className="font-bold text-gray-900 dark:text-slate-50">= {nf(paidCount)} delivered orders paid this week</li>
            </ul>
          </div>
        </section>

        {/* 2. Where the money comes from */}
        <section>
          <SectionTitle n={2} title="Where the money comes from" sub="Amounts actually paid, after any delivery-rate cut." />
          <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
            <table className="w-full !min-w-[520px] text-[12.5px]">
              <thead className="bg-gray-50 text-[11px] uppercase text-gray-500 dark:bg-slate-800/60 [&_th]:bg-transparent [&_th]:[color:inherit]">
                <tr>{["", "Delivered orders", "Base", "Upsell", "Cross-sell", "Total"].map((h) => <th key={h} className={`px-3 py-2 font-bold ${h && h !== "Delivered orders" ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
              </thead>
              <tbody>
                <PartsRow label={`Placed this week, delivered by ${cutoffText}`} tone="text-emerald-700" count={paidNow.length} parts={thisWeek} money={money} />
                <PartsRow label="+ Placed earlier, delivered this week (carried over)" tone="text-blue-700" count={carried.length} parts={earlier} money={money} />
                {late.length > 0 ? <PartsRow label="+ Delivered earlier, recorded late" tone="text-amber-700" count={late.length} parts={lateParts} money={money} /> : null}
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-black dark:border-slate-600 dark:bg-slate-800/60">
                  <td className="px-3 py-2">= Bonus earned on delivered orders</td>
                  <td className="px-3 py-2">{nf(paidCount)}</td>
                  <td className="px-3 py-2 text-right">{money(paid.base)}</td>
                  <td className="px-3 py-2 text-right">{money(paid.upsell)}</td>
                  <td className="px-3 py-2 text-right">{money(paid.cross)}</td>
                  <td className="px-3 py-2 text-right">{money(paid.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {Math.abs(gap) < 1 ? (
            <p className="m-0 mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />
              It adds up: {money(thisWeek.total)} + {money(earlier.total)}{late.length > 0 ? ` + ${money(lateParts.total)}` : ""} = {money(paid.total)}. The carried-over money is already inside Base, Upsell and Cross-sell, not extra.
            </p>
          ) : (
            <p className="m-0 mt-1.5 text-[12px] font-semibold text-amber-700">
              The orders add up to {money(ordersSum)}; the report pays {money(paid.total)} ({gap > 0 ? "+" : ""}{money(gap)}). The difference is a bonus set by hand on an order or a weekly rule not tied to one order.
            </p>
          )}
        </section>

        <UpsellCrossList snap={snap} detailSource={detailSource ?? null} money={money} paidOrders={[...paidNow, ...carried, ...late]} carriedIds={new Set(carried.map((order) => order.id))} lateIds={new Set(late.map((order) => order.id))} />

        {/* 3. From the full bonus to the final pay */}
        <section>
          <SectionTitle n={4} title="From the full bonus to the final pay" />
          <ol className="m-0 mt-2 list-none space-y-0 p-0">
            <Step label="Full bonus by the rules (before the delivery-rate cut)" value={money(fullTotal)}
              note={`Base ${money(Math.round(full.base))} + Upsell ${money(Math.round(full.upsell))} + Cross-sell ${money(Math.round(full.crossSell))}. These are the columns on the reps table.`} />
            {cutItems.map((item) => <Step key={item.label} minus label={item.label} value={`-${money(item.amount)}`} />)}
            <Step total label="Bonus earned (section 2)" value={money(paid.total)} />
            {adjustments > 0 ? <Step plus label="Corrections paid this week (answered bonus queries)" value={`+${money(adjustments)}`} /> : null}
            {added > 0 ? <Step plus label="Added by the manager" value={`+${money(added)}`} note={changeNote} /> : null}
            {otherTaken.map((item) => <Step key={item.label} minus label={item.label} value={`-${money(item.amount)}`} note={item.label === "Taken off by the manager" ? changeNote : undefined} />)}
            <Step total last label="Final pay" value={money(Math.round(t.finalBonus))} />
          </ol>
        </section>

        {/* 4. This week's paid orders, one by one (Bright, 29 Oct 2026: "add all
            orders id, full breakdown"), then the carried-over ones. */}
        {paidNow.length > 0 ? (
          <section>
            <SectionTitle n={5} title={`The ${nf(paidNow.length)} order${paidNow.length === 1 ? "" : "s"} placed this week and delivered by ${cutoffText}`} sub="Every order in the green row of section 2." />
            <OrderTable orders={paidNow} money={money} totalLabel={`Total: ${nf(paidNow.length)} delivered orders`} />
          </section>
        ) : null}
        {carried.length > 0 ? (
          <section>
            <SectionTitle n={paidNow.length > 0 ? 6 : 5} title={`The ${nf(carried.length)} carried-over order${carried.length === 1 ? "" : "s"}`} sub="Placed in an earlier week, delivered this week. Every order in the blue row of section 2." />
            <OrderTable orders={carried} money={money} totalLabel={`Total: ${nf(carried.length)} carried over`} />
          </section>
        ) : null}
        {late.length > 0 ? (
          <section>
            <SectionTitle n={5 + (paidNow.length > 0 ? 1 : 0) + (carried.length > 0 ? 1 : 0)} title={`Recorded late: ${nf(late.length)} order${late.length === 1 ? "" : "s"}`} sub="Delivered in an earlier week, but marked delivered after that week's report was sent." />
            <div className="mt-2 overflow-x-auto rounded-xl border border-amber-200 dark:border-amber-500/30">
              <table className="w-full !min-w-[560px] text-[12.5px]">
                <thead className="bg-amber-50 text-[11px] uppercase text-amber-800 dark:bg-amber-500/10 [&_th]:bg-transparent [&_th]:[color:inherit]">
                  <tr>{["Order", "Placed", "Delivery date", "Marked delivered", "Bonus"].map((h) => <th key={h} className={`px-3 py-2 font-bold ${h === "Bonus" ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {late.map((order) => (
                    <tr key={order.id} className="border-t border-amber-100 dark:border-amber-500/20">
                      <td className="px-3 py-1.5"><b>#{order.id}</b><span className="block text-[11px] text-gray-500">{order.customer} · {order.product}</span></td>
                      <td className="whitespace-nowrap px-3 py-1.5">{dayText(order.date)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{dayText(order.deliveredDate)}<span className="block text-[11px] text-gray-500">week of {dayText(order.lateRecorded!.deliveredWeek)}</span></td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-amber-800">{order.lateRecorded!.recordedAt ? whenText(order.lateRecorded!.recordedAt) : "-"}<span className="block text-[11px] font-normal text-gray-500">after that week's report was sent</span></td>
                      <td className="px-3 py-1.5 text-right font-bold">{money(Math.round(order.bonus))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
        {paidNextWeek.length > 0 ? (
          <section>
            <SectionTitle n={5 + (paidNow.length > 0 ? 1 : 0) + (carried.length > 0 ? 1 : 0) + (late.length > 0 ? 1 : 0)} title={`Not paid in this report: ${nf(paidNextWeek.length)} order${paidNextWeek.length === 1 ? "" : "s"}`} sub={`Placed this week but delivered after ${cutoffText}, so this report pays them ₦0. Each is paid in the report of the week it was delivered (shown on the right), as carried over. Nothing is lost.`} />
            <ul className="m-0 mt-2 list-none space-y-1 p-0 text-[12.5px]">
              {paidNextWeek.map((order) => (
                <li key={order.id} className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-500/10">
                  <span className="block"><b>#{order.id}</b> · {order.customer} · {order.product}</span>
                  <span className="mt-0.5 flex flex-wrap justify-between gap-x-3 text-gray-600 dark:text-slate-300">
                    <span>placed {dayText(order.date)} · delivered {dayText(order.deliveredDate)}</span>
                    {(() => {
                      const payWeek = bonusWeekFor(order.date, order.deliveredDate);
                      return payWeek ? <b className="text-amber-800 dark:text-amber-200">→ paid in the report for {weekRange(payWeek)} (due {dayText(reportDueDate(payWeek))})</b> : null;
                    })()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

function SectionTitle({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1F6FEB] text-[12px] font-black text-white">{n}</span>
      <div><p className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-50">{title}</p>{sub ? <p className="m-0 text-[11.5px] text-gray-500">{sub}</p> : null}</div>
    </div>
  );
}

function Box({ tone, icon, label, value, note }: { tone: "gray" | "green" | "amber" | "blue"; icon: ReactNode; label: string; value: string; note?: string }) {
  const tones = {
    gray: "border-gray-200 bg-gray-50 text-gray-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
    amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
    blue: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200"
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tones}`}>
      <p className="m-0 flex items-center gap-1.5 text-[12px] font-bold">{icon}{label}</p>
      <p className="m-0 mt-0.5 text-[22px] font-black leading-tight">{value}</p>
      {note ? <p className="m-0 mt-0.5 text-[11.5px] opacity-80">{note}</p> : null}
    </div>
  );
}

function PartsRow({ label, tone, count, parts, money }: { label: string; tone: string; count: number; parts: Parts; money: (value: number) => string }) {
  return (
    <tr className="border-t border-gray-100 dark:border-slate-800">
      <td className={`px-3 py-2 font-bold ${tone}`}>{label}</td>
      <td className="px-3 py-2">{nf(count)}</td>
      <td className="px-3 py-2 text-right">{money(parts.base)}</td>
      <td className="px-3 py-2 text-right">{money(parts.upsell)}</td>
      <td className="px-3 py-2 text-right">{money(parts.cross)}</td>
      <td className="px-3 py-2 text-right font-bold">{money(parts.total)}</td>
    </tr>
  );
}

function Step({ label, value, note, minus, plus, total, last }: { label: string; value: string; note?: string; minus?: boolean; plus?: boolean; total?: boolean; last?: boolean }) {
  return (
    <li>
      <div className={`flex items-start justify-between gap-3 rounded-xl px-3 py-2 ${total ? "bg-gray-900 text-white dark:bg-slate-700" : "bg-gray-50 dark:bg-slate-800/60"}`}>
        <span className={total ? "font-bold" : minus ? "text-rose-700 dark:text-rose-300" : plus ? "text-emerald-700 dark:text-emerald-300" : ""}>
          {label}{note ? <span className={`block text-[11.5px] ${total ? "text-white/70" : "text-gray-500 dark:text-slate-400"}`}>{note}</span> : null}
        </span>
        <span className={`shrink-0 font-black ${minus ? "text-rose-700 dark:text-rose-300" : plus ? "text-emerald-700 dark:text-emerald-300" : ""}`}>{value}</span>
      </div>
      {!last ? <span className="flex justify-center py-0.5 text-gray-300"><ArrowDown className="h-3.5 w-3.5" /></span> : null}
    </li>
  );
}

function OrderTable({ orders, money, totalLabel }: { orders: Order[]; money: (value: number) => string; totalLabel: string }) {
  const sum = partsOf(orders);
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
      <table className="w-full !min-w-[560px] text-[12.5px]">
        <thead className="bg-gray-50 text-[11px] uppercase text-gray-500 dark:bg-slate-800/60 [&_th]:bg-transparent [&_th]:[color:inherit]">
          <tr>{["Order", "Customer · product", "Placed · delivered", "Base", "Upsell", "Cross-sell", "Bonus"].map((h, i) => <th key={h} className={`px-2.5 py-2 font-bold ${i >= 3 ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const parts = partsOf([order]);
            return (
              <tr key={order.id} className="border-t border-gray-100 dark:border-slate-800">
                <td className="px-3 py-1.5 font-bold">#{order.id}</td>
                <td className="max-w-[200px] px-2.5 py-1.5"><span className="block truncate">{order.customer}</span><span className="block truncate text-[11px] text-gray-500">{order.product}</span>
                  {order.upsellDetail ? <span className="block text-[11px] font-semibold text-blue-700">Upgrade {pcs(order.upsellDetail.fromQty)} → {pcs(order.upsellDetail.toQty)}</span> : null}
                  {(order.crossSellItems ?? []).map((item, i) => <span key={i} className="block truncate text-[11px] font-semibold text-rose-700">+ {item.name}{item.pack ? ` (${item.pack})` : ""} · {pcs(item.qty)}</span>)}</td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-[11.5px]"><span className="block">{dayText(order.date)}</span><span className="block text-emerald-700">{dayText(order.deliveredDate)}</span></td>
                <td className="px-3 py-1.5 text-right">{money(parts.base)}</td>
                <td className="px-3 py-1.5 text-right">{money(parts.upsell)}</td>
                <td className="px-3 py-1.5 text-right">{money(parts.cross)}</td>
                <td className="px-3 py-1.5 text-right font-bold">{money(parts.total)}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-gray-300 font-black dark:border-slate-600">
            <td className="px-3 py-1.5" colSpan={3}>{totalLabel}</td>
            <td className="px-3 py-1.5 text-right">{money(sum.base)}</td>
            <td className="px-3 py-1.5 text-right">{money(sum.upsell)}</td>
            <td className="px-3 py-1.5 text-right">{money(sum.cross)}</td>
            <td className="px-3 py-1.5 text-right">{money(sum.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── "Which week is this order's bonus in?" (Bright, 29 Oct 2026) ────────────
// A bonus is paid in the week the order is DELIVERED (weeks run Sunday to
// Saturday), whatever week it was placed in. Type an order number to see it.
const sundayOf = (key: string) => {
  const date = new Date(`${key.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
};
const weekRange = (sunday: string) => {
  const end = new Date(`${sunday}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(new Date(`${sunday}T12:00:00Z`))} – ${fmt(end)}`;
};

function OrderFinder({ snap, repName, money, lookupOrder }: { snap: WeeklyReportSnapshot; repName: string; money: (value: number) => string; lookupOrder?: (id: string) => FoundOrder | null }) {
  const [query, setQuery] = useState("");
  // Several at once (Bright, 29 Oct 2026): numbers separated by spaces, commas or new lines.
  const ids = Array.from(new Set(query.split(/[\s,;]+/).map((part) => part.trim().replace(/^#/, "")).filter(Boolean))).slice(0, 30);
  return (
    <section className="rounded-2xl border border-[#1F6FEB]/30 bg-blue-50/40 p-3 dark:border-blue-500/30 dark:bg-blue-500/10">
      <p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-50">Find orders: which week is each bonus in?</p>
      <p className="m-0 text-[11.5px] text-gray-600 dark:text-slate-300">A bonus is paid in the week the order is <b>delivered</b> (Sunday to Saturday). From the week of 25 Oct, an order delivered by its week's report day (the Tuesday after) is paid in its own week. Type one or more order numbers.</p>
      <label className="mt-2 flex min-h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
        <Search className="h-4 w-4 shrink-0 text-gray-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. 5578, 5303, 5022" className="w-full border-0 bg-transparent py-2 text-[13px] outline-none dark:text-slate-100" />
      </label>
      {ids.length > 1 ? <p className="m-0 mt-1.5 text-[11.5px] font-semibold text-gray-600 dark:text-slate-300">{ids.length} orders</p> : null}
      <div className="mt-2 space-y-2">
        {ids.map((id) => <OrderAnswer key={id} id={id} snap={snap} repName={repName} money={money} lookupOrder={lookupOrder} />)}
      </div>
    </section>
  );
}

function OrderAnswer({ id, snap, repName, money, lookupOrder }: { id: string; snap: WeeklyReportSnapshot; repName: string; money: (value: number) => string; lookupOrder?: (id: string) => FoundOrder | null }) {
  const inReport = snap.orders.find((order) => order.id === id) ?? null;
  const found: FoundOrder | null = lookupOrder?.(id)
    ?? (inReport ? { id, customer: inReport.customer, product: inReport.product, status: inReport.status, placedKey: inReport.date, deliveredKey: inReport.deliveredDate ?? null, repName } : null);
  if (!found) return <p className="m-0 rounded-xl bg-white px-3 py-2 text-[12.5px] text-gray-600 dark:bg-slate-900 dark:text-slate-300">No order #{id} found.</p>;
  const thisWeek = snap.weekStart;
  const lines: Array<{ label: string; value: string; tone?: string }> = [];
  let verdict: { text: string; tone: string };
  const placedWeek = sundayOf(found.placedKey);
  lines.push({ label: "Placed", value: `${dayText(found.placedKey)} (week of ${weekRange(placedWeek)})` });
  if (found.repName && found.repName !== repName) lines.push({ label: "Sales rep", value: found.repName, tone: "text-amber-700" });
  if (found.status === "Delivered" && found.deliveredKey) {
    const paidWeek = bonusWeekFor(found.placedKey, found.deliveredKey) ?? sundayOf(found.deliveredKey);
    lines.push({ label: "Delivered", value: `${dayText(found.deliveredKey)} (week of ${weekRange(paidWeek)})` });
    if (inReport?.lateRecorded?.recordedAt) lines.push({ label: "Marked delivered", value: whenText(inReport.lateRecorded.recordedAt), tone: "text-amber-700" });
    const paidHere = (paidWeek === thisWeek || !!inReport?.lateRecorded) && inReport && (!found.repName || found.repName === repName);
    verdict = paidHere
      ? { text: `Bonus paid in THIS report: ${money(Math.round(inReport!.bonus))}${inReport!.lateRecorded ? " (recorded late: marked delivered after its own week's report was sent)" : placedWeek !== thisWeek ? " (carried over: placed in an earlier week)" : ""}.`, tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" }
      : paidWeek > thisWeek
        ? { text: `Bonus paid in the week of ${weekRange(paidWeek)}: that week's report (due ${dayText(reportDueDate(paidWeek))}). Not in this one, because it was delivered after ${snap.weekStart >= PAY_BY_REPORT_DAY_FROM ? `${dayText(reportDueDate(snap.weekStart))} (report day)` : dayText(snap.weekEnd)}.`, tone: "bg-amber-50 text-amber-900 ring-amber-200" }
        : { text: `Bonus paid in the week of ${weekRange(paidWeek)}: that week's report, not this one.`, tone: "bg-blue-50 text-blue-800 ring-blue-200" };
  } else if (["Failed", "Cancelled", "Returned"].includes(found.status)) {
    verdict = { text: `No bonus: the order is ${found.status}.`, tone: "bg-rose-50 text-rose-800 ring-rose-200" };
  } else {
    lines.push({ label: "Status now", value: found.status });
    verdict = { text: "Not delivered yet, so no bonus yet. When it is delivered, its bonus goes into the report of the week it is delivered in.", tone: "bg-gray-50 text-gray-700 ring-gray-200" };
  }
  return (
    <div className="rounded-xl bg-white p-3 dark:bg-slate-900">
      <p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-50">#{found.id} · {found.customer}<span className="block text-[11.5px] font-normal text-gray-500">{found.product}</span></p>
      <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
        {lines.map((line) => <Fragment key={line.label}><dt className="text-gray-500">{line.label}</dt><dd className={`m-0 font-semibold ${line.tone ?? "text-gray-900 dark:text-slate-100"}`}>{line.value}</dd></Fragment>)}
      </dl>
      <p className={`m-0 mt-2 rounded-lg px-3 py-2 text-[12.5px] font-bold ring-1 ${verdict.tone}`}>{verdict.text}</p>
    </div>
  );
}

// ── Every upsell and cross-sell, order by order (Bright, 29 Oct 2026) ───────
// The Upsell and Cross-sell columns of section 2, opened up: each order that
// earned either, the upgrade in pieces, each add-on and what it paid. The
// totals equal those columns.
function UpsellCrossList({ snap, detailSource, money, paidOrders, carriedIds, lateIds }: {
  snap: WeeklyReportSnapshot; detailSource: WeeklyReportSnapshot | null; money: (value: number) => string;
  paidOrders: Order[]; carriedIds: Set<string>; lateIds: Set<string>;
}) {
  const liveById = new Map((detailSource?.orders ?? []).map((order) => [order.id, order]));
  const rows = paidOrders.filter((order) => (order.upsellBonus ?? 0) !== 0 || (order.crossSellBonus ?? 0) !== 0);
  const upsellTotal = Math.round(rows.reduce((sum, order) => sum + (order.upsellBonus ?? 0), 0));
  const crossTotal = Math.round(rows.reduce((sum, order) => sum + (order.crossSellBonus ?? 0), 0));
  const t = snap.totals;
  const matches = Math.abs(upsellTotal - Math.round(t.upsellBonus)) < 1 && Math.abs(crossTotal - Math.round(t.crossSellBonus)) < 1;
  return (
    <section>
      <SectionTitle n={3} title="Upsell and cross-sell, order by order" sub="Every order behind the Upsell and Cross-sell columns above. Amounts actually paid." />
      {rows.length === 0 ? (
        <p className="m-0 mt-2 rounded-xl bg-gray-50 px-3 py-2.5 text-[12.5px] text-gray-600 dark:bg-slate-800/60 dark:text-slate-300">No upsell or cross-sell paid this week.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
          <table className="w-full !min-w-[600px] text-[12.5px]">
            <thead className="bg-gray-50 text-[11px] uppercase text-gray-500 dark:bg-slate-800/60 [&_th]:bg-transparent [&_th]:[color:inherit]">
              <tr>{["Order", "Upsell", "Cross-sell", "Paid"].map((h, i) => <th key={h} className={`px-3 py-2 font-bold ${i === 3 ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((order) => {
                const up = order.upsellDetail ?? liveById.get(order.id)?.upsellDetail ?? null;
                const items = order.crossSellItems ?? liveById.get(order.id)?.crossSellItems ?? [];
                const upsell = Math.round(order.upsellBonus ?? 0);
                const cross = Math.round(order.crossSellBonus ?? 0);
                const group = lateIds.has(order.id) ? "recorded late" : carriedIds.has(order.id) ? "carried over" : null;
                return (
                  <tr key={order.id} className="border-t border-gray-100 align-top dark:border-slate-800">
                    <td className="max-w-[190px] px-3 py-2">
                      <b>#{order.id}</b>{group ? <span className="ml-1 rounded bg-blue-50 px-1 text-[10px] font-bold text-blue-700">{group}</span> : null}
                      <span className="block truncate text-[11px] text-gray-500">{order.customer}</span>
                      <span className="block truncate text-[11px] text-gray-500">{order.product}</span>
                    </td>
                    <td className="px-3 py-2">
                      {upsell !== 0 || up ? (
                        <>
                          {up ? <span className="block font-semibold text-blue-700">{pcs(up.fromQty)} → {pcs(up.toQty)}</span> : <span className="block text-gray-500">Upgrade</span>}
                          <span className="block font-bold">{money(upsell)}</span>
                          {up?.ruleAmount && upsell > 0 && upsell < up.ruleAmount ? <span className="block text-[11px] font-semibold text-amber-700">half of {money(up.ruleAmount)} (delivery rate)</span> : null}
                          {up?.ruleAmount && upsell === up.ruleAmount ? <span className="block text-[11px] text-gray-500">full rule amount</span> : null}
                        </>
                      ) : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-3 py-2">
                      {cross !== 0 || items.length ? (
                        <>
                          {items.map((item, i) => (
                            <span key={i} className="block text-[12px]">
                              <b className="text-rose-700">{item.name}</b>{item.pack ? ` (${item.pack})` : ""} · {pcs(item.qty)} · {money(item.value)}
                              <span className="block text-[11px] text-gray-500">{item.addedBy === "customer" ? "Chosen by the customer" : item.addedBy === "auto" ? "Included automatically" : "Added by the rep"}{item.bonus !== null ? ` → ${money(item.bonus)}` : " → weekly rule"}</span>
                            </span>
                          ))}
                          <span className="block font-bold">{money(cross)}</span>
                          {items.length === 0 ? <span className="block text-[11px] text-gray-500">Item details not saved with this report</span> : null}
                        </>
                      ) : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-black">{money(upsell + cross)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-black dark:border-slate-600 dark:bg-slate-800/60">
                <td className="px-3 py-2">Total: {nf(rows.length)} order{rows.length === 1 ? "" : "s"}</td>
                <td className="px-3 py-2">{money(upsellTotal)}</td>
                <td className="px-3 py-2">{money(crossTotal)}</td>
                <td className="px-3 py-2 text-right">{money(upsellTotal + crossTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 ? (
        matches
          ? <p className="m-0 mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Same as section 2: Upsell {money(upsellTotal)}, Cross-sell {money(crossTotal)}.</p>
          : <p className="m-0 mt-1.5 text-[12px] font-semibold text-amber-700">The orders add up to Upsell {money(upsellTotal)} and Cross-sell {money(crossTotal)}; the report says {money(Math.round(t.upsellBonus))} and {money(Math.round(t.crossSellBonus))}. The difference is a weekly rule not tied to one order.</p>
      ) : null}
    </section>
  );
}
