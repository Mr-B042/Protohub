import { createPortal } from "react-dom";
import { Copy, ExternalLink, Users, X } from "lucide-react";

// "Copy Order To WhatsApp Group" when the customer has another open order.
// It only INFORMS (Bright, 26 Nov 2026: "shouldn't copy both - rather inform
// them that another sales rep has the same contact"): it shows who else has
// this customer, then copies this order alone.

export type SameCustomerLine = { id: string; product: string; rep: string; status: string; amount: string; isThis: boolean };

export function SameCustomerCopyDialog({ customer, phone, lines, onCopy, onOpen, onClose }: {
  customer: string; phone: string; lines: SameCustomerLine[];
  onCopy: () => void; onOpen: (id: string) => void; onClose: () => void;
}) {
  const others = lines.filter((l) => !l.isThis);
  const thisLine = lines.find((l) => l.isThis);
  const otherReps = [...new Set(others.map((o) => o.rep))].filter((rep) => rep !== thisLine?.rep && rep !== "Unassigned");
  const title = otherReps.length > 0
    ? `${otherReps.join(" and ")} also ${otherReps.length === 1 ? "has" : "have"} this customer`
    : `${customer} has ${others.length === 1 ? "another order" : `${others.length} other orders`}`;
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="Same customer has another order" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#0f1822]" onClick={(e) => e.stopPropagation()}>
        <div className="relative bg-gradient-to-br from-amber-50 via-white to-white px-5 pb-4 pt-5 dark:from-amber-500/10 dark:via-[#0f1822] dark:to-[#0f1822]">
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 absolute right-3 top-3 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-sm shadow-amber-500/30"><Users className="h-5 w-5" /></span>
            <div className="min-w-0 pr-6">
              <h2 className="m-0 text-base font-black leading-6 text-slate-900 dark:text-white">{title}</h2>
              <p className="m-0 mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{customer} · {phone}</p>
            </div>
          </div>
        </div>

        <ul className="m-0 list-none space-y-2 px-5 pt-3">
          {others.map((line) => (
            <li key={line.id} className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/50 px-3 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
              <span className="rounded-lg bg-white px-2 py-1 text-[11px] font-black tabular-nums text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">#{line.id}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold text-slate-900 dark:text-slate-100">{line.product}</span>
                <span className="block truncate text-[11.5px] text-slate-600 dark:text-slate-300">{line.rep === "Unassigned" ? "Not assigned yet" : `With ${line.rep}`} · {line.status} · {line.amount}</span>
              </span>
              <button type="button" onClick={() => onOpen(line.id)} className="!min-h-0 inline-flex shrink-0 items-center gap-1 rounded-xl px-2 py-1.5 text-[11.5px] font-bold text-[#1F8FE0] hover:bg-sky-50 dark:hover:bg-sky-500/10">
                Open <ExternalLink className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>

        <p className="m-0 px-5 pt-3 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
          {otherReps.length > 0
            ? <>Talk to <b className="text-slate-900 dark:text-white">{otherReps.join(" and ")}</b> before you send, so the customer is not called or delivered to twice.</>
            : <>Check the other order before you send, so the customer is not delivered to twice.</>}
        </p>

        <div className="flex flex-col gap-2 px-5 pb-5 pt-4">
          <button type="button" onClick={onCopy} className="!min-h-0 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 py-3 text-sm font-black text-white shadow-sm shadow-emerald-500/25 hover:opacity-95">
            <Copy className="h-4 w-4" /> Copy this order (#{thisLine?.id})
          </button>
          <button type="button" onClick={onClose} className="!min-h-0 inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            Not now
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
