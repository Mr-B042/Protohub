import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Calculator, Check, ChevronDown, Clock, ExternalLink, FileText, Lock, Shield, ShoppingCart, X } from "lucide-react";
import type { CartLogMiss } from "../lib/api";

type ReviewBody = { repId: string; missDate: string; status: "approved" | "waived"; note: string };
type Props = {
  misses: CartLogMiss[]; todayKey: string; personal: boolean; canReview?: boolean; saving?: boolean;
  onReview?: (body: ReviewBody) => void; onViewCart?: (cartId: string) => void; onViewPolicy?: () => void;
};

export default function CartLogOwedBanner({
  misses, todayKey, personal, canReview = false, saving = false, onReview, onViewCart, onViewPolicy
}: Props) {
  const rows = useMemo(() => (misses ?? []).filter((row) => row.missDate < todayKey && row.status !== "waived")
    .sort((a, b) => b.missDate.localeCompare(a.missDate)), [misses, todayKey]);
  const [open, setOpen] = useState<string>("");
  const [individualDay, setIndividualDay] = useState<string>("");
  if (!rows.length) return null;
  const money = (value: number) => `₦${Math.max(0, Math.round(value)).toLocaleString("en-NG")}`;
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const pending = rows.filter((row) => row.status === "pending");
  const dayCount = new Set(rows.map((row) => row.missDate)).size;
  const review = (row: CartLogMiss, status: "approved" | "waived") =>
    onReview?.({ repId: row.repId, missDate: row.missDate, status, note: "Reviewed from Already owed by the team." });

  return <div className="mt-3 overflow-hidden rounded-2xl border-2 border-rose-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-rose-50 to-white px-4 py-4">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-600 text-white"><AlertTriangle /></span>
        <div><p className="m-0 text-[11px] font-black uppercase tracking-widest text-rose-700">{personal ? "Already owed — closed days" : "Already owed by the team"}</p>
          <p className="m-0 text-2xl font-black text-rose-900">{money(total)} <span className="text-sm">across {dayCount} closed day{dayCount === 1 ? "" : "s"}</span></p></div>
      </div>
      <b className="text-xs text-rose-800">{canReview ? "These days are finished. Approve or waive each one below." : "These days are finished and await the Owner's decision."}</b>
    </div>
    <div className="grid gap-2 p-3 sm:grid-cols-3">
      <Info icon={<FileText />} title="Policy" text="₦500 per cart not logged before day close." />
      <Info icon={<Shield />} title="Why we charge" text="To enforce daily follow-up discipline and accurate tracking." />
      <Info icon={<Lock />} title="Fairness" text="Nothing is deducted unless the Owner approves it." />
    </div>
    <ul className="m-0 list-none divide-y divide-rose-100 p-0">{rows.map((row) => {
      const key = `${row.repId}-${row.missDate}`; const expanded = open === key;
      const date = new Date(`${row.missDate}T12:00:00Z`);
      const dateLabel = date.toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "short" });
      return <li key={key} className={expanded ? "bg-rose-50/20" : ""}>
        <button type="button" onClick={() => setOpen(expanded ? "" : key)} className="grid w-full gap-2 px-4 py-3 text-left md:grid-cols-[1.1fr_1.2fr_auto] md:items-center">
          <span><b>{dateLabel}</b><span className="block text-[11px] text-slate-500">{!personal && <b>{row.repName} · </b>}{row.cartsMissed} of {row.cartsDue} carts had no required follow-up logged</span></span>
          <span className="text-[11px] text-slate-600"><b className="mr-2 text-rose-700">Reason</b>Required follow-up activity was not logged before the day closed.</span>
          <span className="flex items-center justify-end gap-2"><i className={`rounded-full px-2 py-1 text-[10px] font-black uppercase not-italic ${row.status === "approved" ? "bg-rose-600 text-white" : "bg-amber-100 text-amber-800"}`}>{row.status === "approved" ? "Charged" : "Pending review"}</i><b className="text-rose-700">{money(row.amount)}</b><ChevronDown className={`h-4 w-4 ${expanded ? "rotate-180" : ""}`} /></span>
        </button>
        {expanded && <div className="mx-3 mb-3 rounded-xl border border-rose-100 bg-white">
          <div className="grid gap-2 border-b border-rose-100 p-3 text-xs sm:grid-cols-4">
            <Metric icon={<ShoppingCart />} title={`${row.cartsMissed} affected carts`} text={`Out of ${row.cartsDue} assigned carts`} />
            <Metric icon={<Clock />} title="Day closed at" text={`11:59 PM, ${dateLabel}`} />
            <Metric icon={<Calculator />} title="Charge per violation" text="₦500 per cart" />
            <Metric icon={<AlertTriangle />} title="Potential charge" text={`${row.cartsMissed} violations × ₦500 = ${money(row.amount)}`} />
          </div>
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[11px]">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="p-2">#</th>{individualDay === key && <th className="p-2">Review</th>}<th className="p-2">Cart / Customer</th><th className="p-2">Assigned Time</th><th className="p-2">What happened</th><th className="p-2">Policy violated</th><th className="p-2">Charge</th><th className="p-2" /></tr></thead>
            <tbody>{(row.affectedCarts ?? []).map((cart, index) => <tr key={cart.id} className="border-t border-slate-100">
              <td className="p-2">{index + 1}</td>{individualDay === key && <td className="p-2"><input type="checkbox" defaultChecked aria-label={`Review ${cart.customer}`} /></td>}
              <td className="p-2"><b>#{cart.id.slice(0, 8)} · {cart.customer}</b><span className="block text-slate-400">{cart.phone}</span></td>
              <td className="p-2">{cart.assignedAt ? new Date(cart.assignedAt).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" }) : "—"}</td>
              <td className="p-2 text-rose-700">● {cart.reason}</td><td className="p-2">No follow-up activity logged</td><td className="p-2 font-black text-rose-700">₦500</td>
              <td className="p-2"><button type="button" onClick={() => onViewCart?.(cart.id)} className="rounded-lg border bg-white px-3 py-1.5 font-bold">View cart <ExternalLink className="ml-1 inline h-3 w-3" /></button></td>
            </tr>)}</tbody>
          </table></div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-rose-50/40 p-3">
            <div><b className="text-xs">Total pending charge for this day</b><span className="block text-[11px] text-slate-500">{row.cartsMissed} violations × ₦500</span><strong className="text-xl text-rose-700">{money(row.amount)}</strong></div>
            {canReview && row.status === "pending" && <div className="flex flex-wrap gap-2">
              <button disabled={saving} onClick={() => review(row, "waived")} className="rounded-lg border bg-white px-3 py-2 text-xs font-bold"><X className="mr-1 inline h-3 w-3" />Waive all ({money(row.amount)})</button>
              <button disabled={saving} onClick={() => setIndividualDay(individualDay === key ? "" : key)} className="rounded-lg border bg-white px-3 py-2 text-xs font-bold"><FileText className="mr-1 inline h-3 w-3" />Review individually</button>
              <button disabled={saving} onClick={() => review(row, "approved")} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white"><Check className="mr-1 inline h-3 w-3" />Approve charge ({money(row.amount)})</button>
            </div>}
          </div>
        </div>}
      </li>;
    })}</ul>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-rose-50/60 px-4 py-3 text-xs text-rose-900">
      <span><Lock className="mr-2 inline h-4 w-4" />Nothing here is deducted from anyone's pay unless the Owner approves it.</span>
      <button type="button" onClick={onViewPolicy} className="font-black text-rose-700 underline underline-offset-4">View policy & rules →</button>
      {canReview && pending.length > 0 && <span className="sr-only">{pending.length} pending decisions</span>}
    </div>
  </div>;
}

function Info({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-rose-100 p-3 text-xs"><span className="text-rose-600 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><span><b>{title}</b><span className="block text-slate-500">{text}</span></span></div>;
}
function Metric({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="flex items-start gap-2"><span className="text-rose-600 [&>svg]:h-4 [&>svg]:w-4">{icon}</span><span><b>{title}</b><span className="block text-slate-500">{text}</span></span></div>;
}
