import { useState } from "react";
import { TrendingDown } from "lucide-react";
import { MIN_RATE_SAMPLE, growthPct, worstProducts, type ProductRow, type WorstMode } from "./product-trend-model";
import { Delta, ProductThumb, Segmented, nf, pct1 } from "./parts";

// Worst Performing Products (Bright, 21 Oct 2026): the bottom of the
// leaderboard, under Top Performing Products, with why each product is there
// and what to check.

export function WorstProducts({ rows, overallRate, canSeeProfit, money, imageOf, onView }: {
  rows: ProductRow[]; overallRate: number; canSeeProfit: boolean; money: (v: number) => string; imageOf: (id: string) => string | null; onView: (id: string) => void;
}) {
  const [mode, setMode] = useState<WorstMode>("rate");
  const list = worstProducts(rows, mode, overallRate);
  const th = "!border-b !border-gray-200 bg-rose-50/60 !px-2.5 !py-2.5 text-left !text-[11.5px] !font-semibold !text-gray-600 dark:!border-slate-800 dark:bg-rose-500/10 dark:!text-slate-300";
  const td = "!border-b !border-gray-100 !px-2.5 !py-3 align-top text-[12.5px] dark:!border-slate-800";
  const empty = mode === "drop" ? `No product with ${MIN_RATE_SAMPLE}+ orders before had fewer orders this period.`
    : mode === "net" ? "No product is losing money or below the average profit." : `No product with ${MIN_RATE_SAMPLE}+ orders is below the overall delivery rate.`;
  return (
    <section className="rounded-2xl border border-rose-200 bg-white shadow-sm dark:border-rose-500/30">
      <div className="flex flex-col gap-3 px-4 pt-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-[18px] font-black text-gray-900 dark:text-slate-50">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-500/15"><TrendingDown className="h-4 w-4" /></span>
            Worst Performing Products
            <span title={`Only products with ${MIN_RATE_SAMPLE}+ orders are ranked, so one bad order never puts a product here.`} className="cursor-help text-[12px] font-normal text-gray-400">ⓘ</span>
          </h2>
          <p className="m-0 mt-0.5 text-[12.5px] text-gray-500 dark:text-slate-400">The products pulling results down, why, and what to check first.</p>
        </div>
        <div className="w-full lg:w-[560px]">
          <Segmented fill value={mode} onChange={setMode} options={[
            { value: "rate", label: "Lowest Delivery Rate" },
            ...(canSeeProfit ? [{ value: "net" as WorstMode, label: "Lowest Net Profit" }] : []),
            { value: "drop", label: "Biggest Drop in Orders" }
          ]} />
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full !min-w-[860px] border-separate border-spacing-0">
          <thead><tr>
            <th className={th}>#</th><th className={th}>Product</th><th className={th}>Total Orders</th><th className={th}>Delivered</th><th className={th}>Delivery Rate</th>
            {canSeeProfit && <th className={th}>Net Profit (Delivered)</th>}<th className={th}>Why it is here</th><th className={th}>What to check</th><th className={th} />
          </tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={9} className={`${td} py-8 text-center text-gray-500`}>{empty}</td></tr>}
            {list.map(({ row, why, check }, i) => (
              <tr key={row.product.id} className="hover:bg-rose-50/30 [&>td]:[color:inherit]">
                <td className={`${td} font-bold text-rose-600`}>{i + 1}</td>
                <td className={`${td} min-w-[190px]`}>
                  <span className="flex items-center gap-2.5"><ProductThumb src={imageOf(row.product.id)} name={row.product.name} size={36} />
                    <span className="max-w-[170px] font-semibold">{row.product.name}</span></span>
                </td>
                <td className={td}><div className="font-bold">{nf(row.now.orders)}</div><Delta value={growthPct(row.now.orders, row.before.orders)} /></td>
                <td className={td}><div className="font-bold">{nf(row.now.delivered)}</div></td>
                <td className={td}><div className={`font-bold ${row.now.rate < overallRate ? "text-rose-600" : ""}`}>{pct1(row.now.rate)}</div><Delta value={row.before.orders > 0 && row.now.orders > 0 ? row.now.rate - row.before.rate : null} points /></td>
                {canSeeProfit && <td className={td}><div className={`font-bold ${row.now.net < 0 ? "text-rose-600" : ""}`}>{money(row.now.net)}</div></td>}
                <td className={`${td} max-w-[260px] text-gray-700 dark:text-slate-300`}>{why}</td>
                <td className={`${td} max-w-[260px] text-gray-700 dark:text-slate-300`}>{check}</td>
                <td className={td}><button type="button" onClick={() => onView(row.product.id)} className="!min-h-0 rounded-lg border border-blue-200 px-3 py-1.5 text-[12px] font-semibold text-[#1F8FE0] hover:bg-blue-50">View</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
