import { ArrowDown, ArrowRight, CalendarClock, CheckCircle2, History, Package, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { Modal, longDate, nf } from "./WeeklyReportParts";
import { bonusComponentsFull, bonusInitialFinal, type WeeklyReportSnapshot } from "../pages/weekly-report-model";

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

const dayText = (key: string | null | undefined) => {
  if (!key) return "-";
  const date = new Date(`${key.slice(0, 10)}T12:00:00Z`);
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};

export function BonusBreakdownModal({ snap, repName, sym, onClose }: {
  snap: WeeklyReportSnapshot;
  repName: string;
  sym: string;
  onClose: () => void;
}) {
  const money = (value: number) => `${value < 0 ? "-" : ""}${sym}${nf(Math.abs(value))}`;
  const t = snap.totals;
  const inWeek = (key: string | null | undefined) => !!key && key.slice(0, 10) >= snap.weekStart && key.slice(0, 10) <= snap.weekEnd;
  const delivered = (order: Order) => order.status === "Delivered";

  const placed = snap.orders.filter((order) => order.placedThisWeek);
  const placedDelivered = placed.filter(delivered);
  const paidNow = placedDelivered.filter((order) => inWeek(order.deliveredDate));
  const paidNextWeek = placedDelivered.filter((order) => !inWeek(order.deliveredDate));
  const carried = snap.orders.filter((order) => !order.placedThisWeek && delivered(order) && inWeek(order.deliveredDate));

  const thisWeek = partsOf(paidNow);
  const earlier = partsOf(carried);
  const paid = { base: Math.round(t.baseBonus), upsell: Math.round(t.upsellBonus), cross: Math.round(t.crossSellBonus), total: Math.round(t.baseBonus + t.upsellBonus + t.crossSellBonus) };
  const ordersSum = thisWeek.total + earlier.total;
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

        {/* 1. Which deliveries are paid this week */}
        <section>
          <SectionTitle n={1} title="Which deliveries are paid this week" />
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
            <Box tone="gray" icon={<Package className="h-4 w-4" />} label="Orders placed this week" value={nf(t.orders)}
              note={`${nf(placedDelivered.length)} of them delivered so far = ${Math.round(t.deliveryRate)}% delivery rate. These ${nf(placedDelivered.length)} are split on the right.`} />
            <span className="hidden items-center text-gray-400 sm:flex"><ArrowRight className="h-5 w-5" /></span>
            <div className="grid gap-2">
              <Box tone="green" icon={<Truck className="h-4 w-4" />} label={`Delivered by ${dayText(snap.weekEnd)}: bonus paid now`} value={`${nf(paidNow.length)} delivered`} />
              {paidNextWeek.length > 0 ? (
                <Box tone="amber" icon={<CalendarClock className="h-4 w-4" />} label="Delivered after the week ended: bonus paid next week" value={`${nf(paidNextWeek.length)} delivered`}
                  note="They count in this week's delivery rate, but their bonus is paid in the week they were delivered." />
              ) : null}
            </div>
          </div>
          <div className="mt-2">
            <Box tone="blue" icon={<History className="h-4 w-4" />} label="Carried over: placed in an earlier week, delivered this week: bonus paid now" value={`${nf(carried.length)} delivered`}
              note="They are not in this week's orders or delivery rate (they belong to the week they were placed), but their bonus is paid now." />
          </div>
          <p className="m-0 mt-2 rounded-xl bg-gray-900 px-3 py-2.5 text-[13.5px] font-bold text-white dark:bg-slate-700">
            Bonus paid this week on {nf(paidNow.length + carried.length)} delivered orders = {nf(paidNow.length)} from this week + {nf(carried.length)} carried over
          </p>
          {/* Bright, 29 Oct 2026: "44 delivered, now 48?" Say how one becomes the other. */}
          <div className="mt-2 rounded-xl border border-gray-200 px-3 py-2.5 text-[12.5px] dark:border-slate-700">
            <p className="m-0 font-bold text-gray-900 dark:text-slate-50">Why {nf(paidNow.length + carried.length)} and not {nf(placedDelivered.length)}?</p>
            <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-gray-700 dark:text-slate-300">
              <li><b>{nf(placedDelivered.length)}</b> delivered from this week's orders (the delivery-rate figure)</li>
              {paidNextWeek.length > 0 ? <li><b>− {nf(paidNextWeek.length)}</b> of them delivered after {dayText(snap.weekEnd)}: their bonus is paid next week</li> : null}
              <li><b>= {nf(paidNow.length)}</b> delivered from this week's orders, bonus paid now</li>
              <li><b>+ {nf(carried.length)}</b> delivered this week from earlier weeks' orders (carried over)</li>
              <li className="font-bold text-gray-900 dark:text-slate-50">= {nf(paidNow.length + carried.length)} delivered orders paid this week</li>
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
                <PartsRow label={`Placed this week, delivered by ${dayText(snap.weekEnd)}`} tone="text-emerald-700" count={paidNow.length} parts={thisWeek} money={money} />
                <PartsRow label="+ Placed earlier, delivered this week (carried over)" tone="text-blue-700" count={carried.length} parts={earlier} money={money} />
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-black dark:border-slate-600 dark:bg-slate-800/60">
                  <td className="px-3 py-2">= Bonus earned on delivered orders</td>
                  <td className="px-3 py-2">{nf(paidNow.length + carried.length)}</td>
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
              It adds up: {money(thisWeek.total)} + {money(earlier.total)} = {money(paid.total)}. The carried-over money is already inside Base, Upsell and Cross-sell, not extra.
            </p>
          ) : (
            <p className="m-0 mt-1.5 text-[12px] font-semibold text-amber-700">
              The orders add up to {money(ordersSum)}; the report pays {money(paid.total)} ({gap > 0 ? "+" : ""}{money(gap)}). The difference is a bonus set by hand on an order or a weekly rule not tied to one order.
            </p>
          )}
        </section>

        {/* 3. From the full bonus to the final pay */}
        <section>
          <SectionTitle n={3} title="From the full bonus to the final pay" />
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

        {/* 4. The carried-over orders, one by one */}
        {carried.length > 0 ? (
          <section>
            <SectionTitle n={4} title={`The ${nf(carried.length)} carried-over order${carried.length === 1 ? "" : "s"}`} sub="Placed in an earlier week, delivered this week." />
            <OrderTable orders={carried} money={money} />
          </section>
        ) : null}
        {paidNextWeek.length > 0 ? (
          <section>
            <SectionTitle n={carried.length > 0 ? 5 : 4} title={`Paid next week: ${nf(paidNextWeek.length)} order${paidNextWeek.length === 1 ? "" : "s"}`} sub="Placed this week, delivered after it ended. They will show as carried over next week." />
            <ul className="m-0 mt-2 list-none space-y-1 p-0 text-[12.5px]">
              {paidNextWeek.map((order) => (
                <li key={order.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-amber-50 px-3 py-1.5 dark:bg-amber-500/10">
                  <span><b>#{order.id}</b> · {order.customer} · {order.product}</span>
                  <span className="text-gray-600 dark:text-slate-300">placed {dayText(order.date)} · delivered {dayText(order.deliveredDate)}</span>
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

function OrderTable({ orders, money }: { orders: Order[]; money: (value: number) => string }) {
  const sum = partsOf(orders);
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
      <table className="w-full !min-w-[600px] text-[12.5px]">
        <thead className="bg-gray-50 text-[11px] uppercase text-gray-500 dark:bg-slate-800/60 [&_th]:bg-transparent [&_th]:[color:inherit]">
          <tr>{["Order", "Customer · product", "Placed", "Delivered", "Base", "Upsell", "Cross-sell", "Bonus"].map((h, i) => <th key={h} className={`px-3 py-2 font-bold ${i >= 4 ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const parts = partsOf([order]);
            return (
              <tr key={order.id} className="border-t border-gray-100 dark:border-slate-800">
                <td className="px-3 py-1.5 font-bold">#{order.id}</td>
                <td className="max-w-[220px] px-3 py-1.5"><span className="block truncate">{order.customer}</span><span className="block truncate text-[11px] text-gray-500">{order.product}</span></td>
                <td className="whitespace-nowrap px-3 py-1.5">{dayText(order.date)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{dayText(order.deliveredDate)}</td>
                <td className="px-3 py-1.5 text-right">{money(parts.base)}</td>
                <td className="px-3 py-1.5 text-right">{money(parts.upsell)}</td>
                <td className="px-3 py-1.5 text-right">{money(parts.cross)}</td>
                <td className="px-3 py-1.5 text-right font-bold">{money(parts.total)}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-gray-300 font-black dark:border-slate-600">
            <td className="px-3 py-1.5" colSpan={4}>Total carried over</td>
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
