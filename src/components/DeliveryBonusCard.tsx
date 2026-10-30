import { CheckCircle2, CircleDashed, Trophy, XCircle } from "lucide-react";
import { DELIVERY_BONUS_MAIN, DELIVERY_BONUS_TOP, type DeliveryBonus } from "../pages/weekly-report-model";

/**
 * The weekly delivery bonus (Bright, 30 Oct 2026): ₦400 / ₦300 per delivered
 * order on top of the per-order bonus. One card, two moods:
 * - "progress": the rep's own week while it is running - every requirement
 *   with a bar and exactly what is still missing.
 * - "result": a sent week - achieved (amount and how) or not reached (why).
 */

const nf = (value: number) => Math.round(value).toLocaleString("en-NG");

export function DeliveryBonusCard({ bonus, mode, sym, orders, delivered }: {
  bonus: DeliveryBonus;
  mode: "progress" | "result";
  sym: string;
  orders: number;
  delivered: number;
}) {
  const money = (value: number) => `${sym}${nf(value)}`;
  const achieved = bonus.amount > 0;
  // What is still missing for the ₦300 rule, in plain numbers.
  const needs: string[] = [];
  if (orders < DELIVERY_BONUS_MAIN.minOrders) needs.push(`${DELIVERY_BONUS_MAIN.minOrders - orders} more order${DELIVERY_BONUS_MAIN.minOrders - orders === 1 ? "" : "s"} this week`);
  const forRate = Math.max(0, Math.ceil((DELIVERY_BONUS_MAIN.minRate / 100) * Math.max(orders, DELIVERY_BONUS_MAIN.minOrders)) - delivered);
  if (forRate > 0) needs.push(`${forRate} more deliver${forRate === 1 ? "y" : "ies"} to reach ${DELIVERY_BONUS_MAIN.minRate}%`);
  for (const row of bonus.products.filter((item) => item.checked && !item.ok)) {
    const more = Math.max(0, Math.ceil((DELIVERY_BONUS_MAIN.productMinRate / 100) * row.orders) - row.delivered);
    needs.push(`${row.name}: ${more} more deliver${more === 1 ? "y" : "ies"} to reach ${DELIVERY_BONUS_MAIN.productMinRate}%`);
  }
  const tone = achieved
    ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10"
    : mode === "progress" ? "border-blue-200 bg-blue-50/60 dark:border-blue-500/30 dark:bg-blue-500/10" : "border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/60";
  const title = mode === "progress"
    ? achieved ? "Weekly delivery bonus: on track" : "Weekly delivery bonus: in progress"
    : achieved ? "Weekly delivery bonus: achieved" : "Weekly delivery bonus: not reached";

  return (
    <section className={`rounded-2xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${achieved ? "bg-emerald-600 text-white" : "bg-white text-gray-500 ring-1 ring-gray-200 dark:bg-slate-900 dark:ring-slate-700"}`}><Trophy className="h-5 w-5" /></span>
          <div>
            <p className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-50">{title}</p>
            <p className="m-0 text-[11.5px] text-gray-600 dark:text-slate-300">Extra on top of the per-order bonus. {money(DELIVERY_BONUS_MAIN.perOrder)} per delivered order at {DELIVERY_BONUS_MAIN.minOrders}+ orders and {DELIVERY_BONUS_MAIN.minRate}%+; {money(DELIVERY_BONUS_TOP.perOrder)} for one product with {DELIVERY_BONUS_TOP.minOrders}+ orders at {DELIVERY_BONUS_TOP.minRate}%+.</p>
          </div>
        </div>
        <div className="text-right">
          <p className={`m-0 text-[26px] font-black leading-none ${achieved ? "text-emerald-800 dark:text-emerald-200" : "text-gray-400"}`}>{money(bonus.amount)}</p>
          <p className="m-0 mt-1 text-[11px] text-gray-600 dark:text-slate-300">{mode === "progress" ? "if the week ended now" : achieved ? "added to this week's pay" : "nothing this week"}</p>
        </div>
      </div>

      {achieved ? (
        <div className="mt-3 space-y-1 rounded-xl bg-white px-3 py-2 text-[12.5px] dark:bg-slate-900">
          {bonus.topProduct ? <p className="m-0 flex justify-between gap-2"><span>{money(DELIVERY_BONUS_TOP.perOrder)} × {bonus.topProduct.delivered} delivered {bonus.topProduct.name} ({bonus.topProduct.orders} orders, {Math.round(bonus.topProduct.rate)}%)</span><b>{money(bonus.topProduct.amount)}</b></p> : null}
          {bonus.mainOrders > 0 ? <p className="m-0 flex justify-between gap-2"><span>{money(DELIVERY_BONUS_MAIN.perOrder)} × {bonus.mainOrders} delivered order{bonus.mainOrders === 1 ? "" : "s"}{bonus.topProduct ? " (other products)" : ""}</span><b>{money(bonus.mainAmount)}</b></p> : null}
          {bonus.topProduct && !bonus.mainMet ? <p className="m-0 text-[11.5px] text-amber-700">The other products did not meet the {money(DELIVERY_BONUS_MAIN.perOrder)} rule, so only {bonus.topProduct.name} is paid.</p> : null}
        </div>
      ) : null}

      <ul className="m-0 mt-3 grid list-none gap-2 p-0 sm:grid-cols-2">
        {bonus.checks.map((check) => (
          <li key={check.label} className="rounded-xl bg-white px-3 py-2 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-slate-100">
                {check.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : mode === "progress" ? <CircleDashed className="h-4 w-4 text-blue-500" /> : <XCircle className="h-4 w-4 text-rose-500" />}
                {check.label}
              </span>
              <span className="text-gray-500">need {check.target}</span>
            </div>
            <p className={`m-0 mt-0.5 text-[13px] font-black ${check.ok ? "text-emerald-700" : "text-gray-900 dark:text-slate-100"}`}>{check.current}</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
              <div className={`h-full rounded-full ${check.ok ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${Math.round(check.progress * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>

      {bonus.products.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-xl bg-white dark:bg-slate-900">
          <table className="w-full !min-w-[420px] text-[12px]">
            <thead className="text-[10.5px] uppercase text-gray-500 [&_th]:bg-transparent [&_th]:[color:inherit]"><tr>{["Product", "Orders", "Delivered", "Rate", "Check"].map((h) => <th key={h} className="px-3 py-1.5 text-left font-bold">{h}</th>)}</tr></thead>
            <tbody>
              {bonus.products.map((row) => (
                <tr key={row.name} className="border-t border-gray-100 dark:border-slate-800">
                  <td className="px-3 py-1.5 font-semibold">{row.name}</td>
                  <td className="px-3 py-1.5">{row.orders}</td>
                  <td className="px-3 py-1.5">{row.delivered}</td>
                  <td className="px-3 py-1.5 font-bold">{Math.round(row.rate)}%</td>
                  <td className="px-3 py-1.5">
                    {row.top ? <span className="font-bold text-emerald-700">{money(DELIVERY_BONUS_TOP.perOrder)} product</span>
                      : row.checked ? row.ok ? <span className="font-bold text-emerald-700">✓ {DELIVERY_BONUS_MAIN.productMinRate}%+</span> : <span className="font-bold text-rose-700">✗ under {DELIVERY_BONUS_MAIN.productMinRate}%</span>
                      : <span className="text-gray-400">under {DELIVERY_BONUS_MAIN.productMinOrders} orders: not checked</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!achieved && needs.length > 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-[12px] dark:border-slate-600">
          <p className="m-0 font-bold text-gray-900 dark:text-slate-50">{mode === "progress" ? "Still needed for " : "Was missing for "}{money(DELIVERY_BONUS_MAIN.perOrder)} per order:</p>
          <ul className="m-0 mt-1 list-disc space-y-0.5 pl-5 text-gray-700 dark:text-slate-300">{needs.map((need) => <li key={need}>{need}</li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}
