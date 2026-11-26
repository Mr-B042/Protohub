import { createPortal } from "react-dom";
import { Copy, Users, X } from "lucide-react";

// "Copy Order To WhatsApp Group" when the customer has another open order
// (Bright, 26 Nov 2026: "if they want to copy to the WhatsApp group it should
// give them a pop-up"). One message with both orders lets the delivery group
// send them together: one trip, one call, one delivery fee.

export type SameCustomerLine = { id: string; product: string; rep: string; status: string; amount: string; isThis: boolean };

export function SameCustomerCopyDialog({ customer, phone, lines, onCopyAll, onCopyOne, onClose }: {
  customer: string; phone: string; lines: SameCustomerLine[];
  onCopyAll: () => void; onCopyOne: () => void; onClose: () => void;
}) {
  const others = lines.filter((l) => !l.isThis);
  const thisRep = lines.find((l) => l.isThis)?.rep;
  const otherReps = [...new Set(others.map((o) => o.rep))].filter((rep) => rep !== thisRep);
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="Same customer has another order" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#0f1822]" onClick={(e) => e.stopPropagation()}>
        <div className="relative bg-gradient-to-br from-amber-50 via-white to-white px-5 pb-4 pt-5 dark:from-amber-500/10 dark:via-[#0f1822] dark:to-[#0f1822]">
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 absolute right-3 top-3 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-sm shadow-amber-500/30"><Users className="h-5 w-5" /></span>
            <div className="min-w-0 pr-6">
              <h2 className="m-0 text-base font-black leading-6 text-slate-900 dark:text-white">{customer} has {others.length === 1 ? "another order" : `${others.length} other orders`}</h2>
              <p className="m-0 mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{phone} · send them together so the customer gets one delivery.</p>
            </div>
          </div>
        </div>

        <ul className="m-0 list-none space-y-2 px-5 py-3">
          {lines.map((line) => (
            <li key={line.id} className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 ${line.isThis ? "border-sky-200 bg-sky-50/70 dark:border-sky-500/30 dark:bg-sky-500/10" : "border-slate-200 dark:border-slate-700"}`}>
              <span className={`rounded-lg px-2 py-1 text-[11px] font-black tabular-nums ${line.isThis ? "bg-[#1F8FE0] text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>#{line.id}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold text-slate-900 dark:text-slate-100">{line.product}</span>
                <span className="block truncate text-[11.5px] text-slate-500 dark:text-slate-400">{line.rep} · {line.status}{line.isThis ? " · this order" : ""}</span>
              </span>
              <span className="shrink-0 text-[13px] font-black tabular-nums text-slate-900 dark:text-slate-100">{line.amount}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 px-5 pb-5 pt-1">
          <button type="button" onClick={onCopyAll} className="!min-h-0 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 py-3 text-sm font-black text-white shadow-sm shadow-emerald-500/25 hover:opacity-95">
            <Copy className="h-4 w-4" /> Copy {lines.length === 2 ? "both" : `all ${lines.length}`} in one message
          </button>
          <button type="button" onClick={onCopyOne} className="!min-h-0 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            Copy this order only (#{lines.find((l) => l.isThis)?.id})
          </button>
          {otherReps.length > 0 && <p className="m-0 text-center text-[11.5px] text-slate-400">Tell {otherReps.join(" and ")} you are sending it together.</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
