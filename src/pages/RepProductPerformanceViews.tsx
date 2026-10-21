import { useCallback, useState } from "react";
import { MoreVertical } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "../lib/money-privacy";
import { Avatar, ProductThumb, useClickAway } from "./product-trend/parts";
import { aovOf, rateOf, rateTone, type Stat } from "./RepProductPerformancePage";

// The three lower views of Product Performance (Sales Rep), each laid out as
// Bright's design for it (21 Oct 2026). The page works the figures out; these
// only lay them out.

const th = "px-1.5 py-2 text-[10.5px] font-medium leading-tight text-gray-500 dark:text-slate-400";
const td = "px-1.5 py-2.5 text-center text-[12px] text-gray-800 dark:text-slate-200";
// No base text colour: it would beat the green / amber / red.
const tdTone = "px-1.5 py-2.5 text-center text-[12px] font-bold";
const shell = "overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const pct = (value: number | null) => (value === null ? "-" : `${Math.round(value)}%`);
const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
const profitTone = (value: number) => (value < 0 ? "text-rose-600" : value > 0 ? "text-emerald-600" : "text-gray-500 dark:text-slate-400");
const signedMoney = (value: number) => (value < 0 ? `-${money(Math.abs(value))}` : money(value));

// ── Product Comparison: reps down the side, products across ────────────────

export function ComparisonTable({ columns, repIds, nameOfRep, statOf, target, allKeys, onOpenCell }: {
  columns: Array<{ key: string; name: string; keys: string[]; image: string | null; isOthers?: boolean }>;
  repIds: string[]; nameOfRep: (id: string) => string; statOf: (keys: string[], repId?: string) => Stat; target: number; allKeys: string[];
  onOpenCell: (productKey: string, repId: string) => void;
}) {
  const cells = (stat: Stat, open?: () => void, bold = false) => {
    const rate = rateOf(stat), aov = aovOf(stat);
    const click = open && stat.placed > 0 ? { onClick: open, title: "Show the orders", className: "cursor-pointer hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10" } : { className: "" };
    return (
      <>
        <td {...click} className={`${td} border-l border-gray-100 dark:border-slate-800 ${bold ? "font-bold" : ""} ${click.className}`}
          tabIndex={click.className ? 0 : undefined} role={click.className ? "button" : undefined}
          onKeyDown={open && stat.placed > 0 ? (event) => { if (event.key === "Enter") open(); } : undefined}>{stat.placed}</td>
        <td {...click} className={`${td} ${bold ? "font-bold" : ""} ${click.className}`}>{stat.delivered}</td>
        <td {...click} className={`${tdTone} ${rateTone(rate, stat.placed, target)} ${click.className}`}>{pct(rate)}</td>
        <td {...click} className={`${td} whitespace-nowrap ${bold ? "font-bold" : ""} ${click.className}`}>{aov === null ? "-" : money(aov)}</td>
      </>
    );
  };
  const totalCells = (stat: Stat, bold = false) => (
    <>
      <td className={`${td} border-l border-gray-200 bg-slate-50 font-bold dark:border-slate-700 dark:bg-slate-800/50`}>{stat.placed}</td>
      <td className={`${td} bg-slate-50 font-bold dark:bg-slate-800/50`}>{stat.delivered}</td>
      <td className={`${tdTone} bg-slate-50 dark:bg-slate-800/50 ${rateTone(rateOf(stat), stat.placed, target)}`}>{pct(rateOf(stat))}</td>
      <td className={`${td} whitespace-nowrap bg-slate-50 dark:bg-slate-800/50 ${bold ? "font-black" : "font-bold"}`}>{money(stat.revenue)}</td>
    </>
  );
  return (
    <div className={shell}>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-max border-collapse">
          <thead className="sticky top-0 z-20 bg-white dark:bg-slate-900">
            <tr className="border-b border-gray-100 dark:border-slate-800">
              <th rowSpan={2} className="sticky left-0 z-30 min-w-[130px] bg-white px-3 text-left text-[12px] font-medium text-gray-600 dark:bg-slate-900 dark:text-slate-300">Sales Rep</th>
              {columns.map((column) => (
                <th key={column.key} colSpan={4} className="border-l border-gray-100 px-2 py-2.5 dark:border-slate-800">
                  <span className="inline-flex items-center gap-2 text-left text-[12.5px] font-bold text-gray-900 dark:text-slate-100">
                    {column.isOthers ? <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-[11px] text-gray-500 dark:bg-slate-800">+</span> : <ProductThumb src={column.image} name={column.name} size={32} />}
                    <span className="max-w-[140px] leading-tight">{column.name}</span>
                  </span>
                </th>
              ))}
              <th colSpan={4} className="border-l border-gray-200 bg-slate-50 px-2 py-2.5 text-[13px] font-bold text-gray-900 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-100">Total (All Products)</th>
            </tr>
            <tr className="border-b border-gray-200 dark:border-slate-700">
              {columns.map((column) => (
                <FragmentCells key={column.key}><th className={`${th} border-l border-gray-100 dark:border-slate-800`}>Placed</th><th className={th}>Delivered</th><th className={th}>DR %</th><th className={th}>AOV</th></FragmentCells>
              ))}
              <th className={`${th} border-l border-gray-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50`}>Placed</th><th className={`${th} bg-slate-50 dark:bg-slate-800/50`}>Delivered</th><th className={`${th} bg-slate-50 dark:bg-slate-800/50`}>DR %</th><th className={`${th} bg-slate-50 dark:bg-slate-800/50`}>Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {columns.length === 0 && <tr><td colSpan={5 + repIds.length} className="px-4 py-10 text-center text-[13px] text-gray-500">No product matches your search.</td></tr>}
            {repIds.map((id) => (
              <tr key={id} className="hover:bg-gray-50/70 dark:hover:bg-slate-800/40">
                <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-2 text-left dark:bg-slate-900">
                  <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-gray-900 dark:text-slate-100"><Avatar name={nameOfRep(id)} size={28} />{nameOfRep(id)}</span>
                </th>
                {columns.map((column) => <FragmentCells key={column.key}>{cells(statOf(column.keys, id), column.isOthers ? undefined : () => onOpenCell(column.key, id))}</FragmentCells>)}
                {totalCells(statOf(allKeys, id))}
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 dark:border-slate-700">
              <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-3 text-left text-[13px] font-bold text-gray-900 dark:bg-slate-900 dark:text-slate-100">Team Total</th>
              {columns.map((column) => <FragmentCells key={column.key}>{cells(statOf(column.keys), undefined, true)}</FragmentCells>)}
              {totalCells(statOf(allKeys), true)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentCells({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ── Best & Worst Products ───────────────────────────────────────────────────

export type BestWorstPick = { key: string; name: string; image: string | null; delivered: number; placed: number; rate: number | null; net: number; revenue: number };
export type BestWorstRow = { id: string; name: string; best: BestWorstPick | null; worst: BestWorstPick | null; lowVolume: boolean };

export function BestWorstTable({ rows, team, target, canSeeProfit }: { rows: BestWorstRow[]; team: BestWorstRow; target: number; canSeeProfit: boolean }) {
  const pickCells = (pick: BestWorstPick | null, bold = false) => pick ? (
    <>
      <td className="border-l border-gray-100 px-2 py-2.5 dark:border-slate-800">
        <span className="flex items-center gap-2"><ProductThumb src={pick.image} name={pick.name} size={28} /><span className={`max-w-[110px] text-[12px] leading-tight text-gray-900 dark:text-slate-100 ${bold ? "font-bold" : "font-medium"}`}>{pick.name}</span></span>
      </td>
      <td className={`${td} ${bold ? "font-bold" : ""}`} title={`${pick.delivered} of ${pick.placed} placed`}>{pick.delivered}</td>
      <td className={`${tdTone} ${rateTone(pick.rate, pick.placed, target)}`}>{pct(pick.rate)}</td>
      <td className={`${tdTone} whitespace-nowrap ${canSeeProfit ? profitTone(pick.net) : "text-gray-400"}`}>{canSeeProfit ? signedMoney(pick.net) : "—"}</td>
      <td className={`${td} whitespace-nowrap ${bold ? "font-bold" : ""}`}>{money(pick.revenue)}</td>
    </>
  ) : <td colSpan={5} className="border-l border-gray-100 px-2 py-3 text-center text-[12px] text-gray-400 dark:border-slate-800">No orders</td>;
  const gapCells = (row: BestWorstRow) => {
    const same = row.best && row.worst && row.best.key === row.worst.key;
    const rateGap = row.best && row.worst && !same && row.best.rate !== null && row.worst.rate !== null ? row.best.rate - row.worst.rate : null;
    const netGap = row.best && row.worst && !same ? row.best.net - row.worst.net : null;
    return (
      <>
        <td className={`${tdTone} border-l border-gray-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 ${rateGap === null ? "text-gray-400" : "text-rose-600"}`}>{rateGap === null ? "-" : `${Math.round(rateGap)}%`}</td>
        <td className={`${tdTone} whitespace-nowrap bg-slate-50 dark:bg-slate-800/50 ${canSeeProfit && netGap !== null ? profitTone(netGap) : "text-gray-400"}`}>{canSeeProfit && netGap !== null ? signedMoney(netGap) : "—"}</td>
      </>
    );
  };
  const groupHead = "border-l border-gray-100 px-2 py-2.5 text-[12px] font-bold text-gray-900 dark:border-slate-800 dark:text-slate-100";
  return (
    <div className={shell}>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-max border-collapse">
          <thead className="sticky top-0 z-20 bg-white dark:bg-slate-900">
            <tr className="border-b border-gray-100 dark:border-slate-800">
              <th rowSpan={2} className="sticky left-0 z-30 min-w-[130px] bg-white px-3 text-left text-[12px] font-medium text-gray-600 dark:bg-slate-900 dark:text-slate-300">Sales Rep</th>
              <th colSpan={5} className={groupHead}>Best Performing Product</th>
              <th colSpan={5} className={groupHead}>Worst Performing Product</th>
              <th colSpan={2} className="border-l border-gray-200 bg-slate-50 px-2 py-2.5 text-[13px] font-bold text-gray-900 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-100">Performance Gap</th>
            </tr>
            <tr className="border-b border-gray-200 dark:border-slate-700">
              {[0, 1].map((side) => (
                <FragmentCells key={side}><th className={`${th} border-l border-gray-100 text-left dark:border-slate-800`}>Product</th><th className={th}>Delivered</th><th className={th}>Delivery Rate</th><th className={th}>Net Profit</th><th className={th}>Revenue</th></FragmentCells>
              ))}
              <th className={`${th} border-l border-gray-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50`}>Delivery Rate</th><th className={`${th} bg-slate-50 dark:bg-slate-800/50`}>Net Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50/70 dark:hover:bg-slate-800/40">
                <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-2 text-left dark:bg-slate-900">
                  <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-gray-900 dark:text-slate-100"><Avatar name={row.name} size={26} />{row.name}</span>
                  {row.lowVolume && <span className="mt-0.5 block text-[10.5px] font-normal text-amber-600" title="Fewer than 2 products with 3 or more orders: picked from all products">Few orders</span>}
                </th>
                {pickCells(row.best)}
                {pickCells(row.worst)}
                {gapCells(row)}
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/30">
              <th scope="row" className="sticky left-0 z-10 bg-slate-50 px-3 py-3 text-left text-[13px] font-bold text-gray-900 dark:bg-slate-800 dark:text-slate-100">Team Total</th>
              {pickCells(team.best, true)}
              {pickCells(team.worst, true)}
              {gapCells(team)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BestWorstChart({ rows }: { rows: BestWorstRow[] }) {
  const data = rows.map((row) => ({ rep: row.name, best: row.best?.rate === null || !row.best ? 0 : Math.round(row.best.rate), worst: row.worst?.rate === null || !row.worst ? 0 : Math.round(row.worst.rate) }));
  return (
    <ChartShell title="Best vs worst product delivery rate, by rep">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
        <XAxis dataKey="rep" tick={{ fontSize: 11 }} interval={0} />
        <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
        <Tooltip formatter={(value: number) => `${value}%`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="best" name="Best product" fill="#22c55e" radius={[4, 4, 0, 0]} />
        <Bar dataKey="worst" name="Worst product" fill="#ef4444" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartShell>
  );
}

// ── Product Conversion Funnel ───────────────────────────────────────────────

export type FunnelRow = {
  key: string; name: string; isOthers?: boolean;
  placed: number; confirmed: number; pending: number; cancelled: number; dispatched: number; delivered: number; failed: number;
  revenue: number; net: number;
};

export function FunnelTable({ rows, total, target, canSeeProfit, imageOf, onViewOrders, onOnlyProduct }: {
  rows: FunnelRow[]; total: FunnelRow; target: number; canSeeProfit: boolean; imageOf: (key: string) => string | null;
  onViewOrders: (productKey: string) => void; onOnlyProduct: (productKey: string) => void;
}) {
  const line = (row: FunnelRow, isTotal = false) => {
    const confirmRate = share(row.confirmed, row.placed), deliveryRate = share(row.delivered, row.placed);
    const cancelRate = share(row.cancelled, row.placed), failRate = share(row.failed, row.placed);
    const bold = isTotal ? "font-bold" : "";
    return (
      <>
        <td className={`${td} border-l border-gray-100 dark:border-slate-800 ${bold}`}>{row.placed}</td>
        <td className={`${td} ${bold}`}>{row.confirmed}</td>
        <td className={`${td} ${bold}`}>{row.pending}</td>
        <td className={`${tdTone} ${row.cancelled > 0 ? "text-rose-600" : "text-gray-800 dark:text-slate-200"}`}>{row.cancelled}</td>
        <td className={`${td} ${bold}`}>{row.dispatched}</td>
        <td className={`${td} font-bold`}>{row.delivered}</td>
        <td className={`${tdTone} border-l border-gray-100 dark:border-slate-800 ${confirmRate === null ? "text-gray-400" : confirmRate >= 75 ? "text-emerald-600" : "text-amber-600"}`}>{pct(confirmRate)}</td>
        <td className={`${tdTone} ${rateTone(deliveryRate, row.placed, target)}`}>{pct(deliveryRate)}</td>
        <td className={`${tdTone} ${cancelRate !== null && cancelRate >= 10 ? "text-rose-600" : "text-gray-800 dark:text-slate-200"} font-medium`}>{pct(cancelRate)}</td>
        <td className={`${tdTone} ${failRate !== null && failRate >= 5 ? "text-rose-600" : "text-gray-800 dark:text-slate-200"} font-medium`}>{pct(failRate)}</td>
        <td className={`${td} whitespace-nowrap border-l border-gray-100 dark:border-slate-800 ${bold}`}>{row.delivered > 0 ? money(row.revenue / row.delivered) : "-"}</td>
        <td className={`${td} whitespace-nowrap ${bold}`}>{money(row.revenue)}</td>
        <td className={`${tdTone} whitespace-nowrap ${canSeeProfit ? profitTone(row.net) : "text-gray-400"}`} title={canSeeProfit ? undefined : "Shown to the Owner and Admins"}>{canSeeProfit ? signedMoney(row.net) : "—"}</td>
      </>
    );
  };
  const groupHead = "border-l border-gray-100 px-2 py-2.5 text-[12px] font-bold text-gray-900 dark:border-slate-800 dark:text-slate-100";
  return (
    <div className={shell}>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-max border-collapse">
          <thead className="sticky top-0 z-20 bg-white dark:bg-slate-900">
            <tr className="border-b border-gray-100 dark:border-slate-800">
              <th rowSpan={2} className="sticky left-0 z-30 min-w-[130px] bg-white px-3 text-left text-[12px] font-medium text-gray-600 dark:bg-slate-900 dark:text-slate-300">Product</th>
              <th colSpan={6} className={groupHead}>Order Funnel</th>
              <th colSpan={4} className={groupHead}>Conversion Rates</th>
              <th colSpan={3} className={groupHead}>Value Metrics</th>
              <th rowSpan={2} className="border-l border-gray-100 px-3 text-[12px] font-bold text-gray-900 dark:border-slate-800 dark:text-slate-100">Actions</th>
            </tr>
            <tr className="border-b border-gray-200 dark:border-slate-700">
              {["Placed", "Confirmed", "Pending", "Cancelled", "Dispatched", "Delivered"].map((label, index) => <th key={label} className={`${th} ${index === 0 ? "border-l border-gray-100 dark:border-slate-800" : ""}`}>{label}</th>)}
              {["Confirmation Rate", "Delivery Rate", "Cancellation Rate", "Failure Rate"].map((label, index) => <th key={label} className={`${th} max-w-[90px] whitespace-normal ${index === 0 ? "border-l border-gray-100 dark:border-slate-800" : ""}`}>{label}</th>)}
              {["Delivered AOV", "Delivered Revenue", "Net Profit"].map((label, index) => <th key={label} className={`${th} ${index === 0 ? "border-l border-gray-100 dark:border-slate-800" : ""}`}>{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {rows.length === 0 && <tr><td colSpan={15} className="px-4 py-10 text-center text-[13px] text-gray-500">No product matches your search.</td></tr>}
            {rows.map((row) => (
              <tr key={row.key} className="hover:bg-gray-50/70 dark:hover:bg-slate-800/40">
                <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-2 text-left dark:bg-slate-900">
                  <span className="flex items-center gap-2.5">
                    {row.isOthers ? <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gray-100 text-[12px] text-gray-500 dark:bg-slate-800">+</span> : <ProductThumb src={imageOf(row.key)} name={row.name} size={30} />}
                    <span className="max-w-[110px] text-[12px] font-semibold leading-tight text-gray-900 dark:text-slate-100">{row.name}</span>
                  </span>
                </th>
                {line(row)}
                <td className="border-l border-gray-100 px-3 py-2 text-center dark:border-slate-800">
                  {row.isOthers ? null : <RowMenu name={row.name} onViewOrders={() => onViewOrders(row.key)} onOnlyProduct={() => onOnlyProduct(row.key)} />}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 dark:border-slate-700">
              <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-3 text-left text-[13px] font-bold text-gray-900 dark:bg-slate-900 dark:text-slate-100">Total</th>
              {line(total, true)}
              <td className="border-l border-gray-100 dark:border-slate-800" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowMenu({ name, onViewOrders, onOnlyProduct }: { name: string; onViewOrders: () => void; onOnlyProduct: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickAway<HTMLDivElement>(open, close);
  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={open}
        className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300"><MoreVertical className="h-4 w-4" /></button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-gray-200 bg-white p-1.5 text-left text-[13px] shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <button type="button" role="menuitem" onClick={() => { onViewOrders(); setOpen(false); }} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left font-semibold text-gray-800 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800">View the orders</button>
          <button type="button" role="menuitem" onClick={() => { onOnlyProduct(); setOpen(false); }} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left font-semibold text-gray-800 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800">Compare reps on this product</button>
        </div>
      )}
    </div>
  );
}

export function FunnelChart({ rows }: { rows: FunnelRow[] }) {
  const data = rows.map((row) => ({ product: row.name.length > 18 ? `${row.name.slice(0, 17)}…` : row.name, Placed: row.placed, Confirmed: row.confirmed, Dispatched: row.dispatched, Delivered: row.delivered }));
  return (
    <ChartShell title="Order funnel by product">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
        <XAxis dataKey="product" tick={{ fontSize: 11 }} interval={0} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Placed" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Confirmed" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Dispatched" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Delivered" fill="#22c55e" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartShell>
  );
}

function ChartShell({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-100">{title}</h3>
      <div className="mt-3 h-[360px]"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
    </div>
  );
}
