import type { ReactNode } from "react";
import { Globe, Images, Plus } from "lucide-react";
import type { ProductView } from "./ProductCard";
import { stockLine } from "./ProductCard";
import { Sheet, categoryTone } from "./shared";

// "View Details": everything the old "View guide" pop-up had (packages, stock
// by state, selling points, short script) plus the gallery and landing page.

export function ProductDetailsSheet({ view, packages, stockByState, pairs, sellingState, canSend, onClose, onOpenViewer, onUpload, onOpenLanding, primary, secondary }: {
  view: ProductView;
  packages: Array<{ id: string; name: string; quantity: number; priceText: string }>;
  stockByState: Array<{ state: string; quantity: number }>;
  pairs: string[];
  sellingState: string;
  canSend: boolean;
  onClose: () => void;
  onOpenViewer: (index: number) => void;
  onUpload: () => void;
  onOpenLanding: (() => void) | null;
  primary: { label: ReactNode; onClick: () => void };
  secondary?: { label: ReactNode; onClick: () => void } | null;
}) {
  const line = stockLine(view);
  return (
    <Sheet wide title={view.name} subtitle={<span className="inline-flex flex-wrap items-center gap-2">SKU: {view.sku || "—"}{view.category && <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${categoryTone(view.category.color)}`}>{view.category.name}</span>}</span>}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap gap-2">
          {onOpenLanding && (
            <button type="button" onClick={onOpenLanding} className="!min-h-0 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200">
              <Globe className="h-4 w-4" />Landing page
            </button>
          )}
          {secondary && (
            <button type="button" onClick={secondary.onClick} className="!min-h-0 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200">{secondary.label}</button>
          )}
          <button type="button" onClick={primary.onClick} className="!min-h-0 inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#1F8FE0] px-4 py-3 text-sm font-black text-white">{primary.label}</button>
        </div>
      }>
      <div className="space-y-5">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="m-0 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-gray-400"><Images className="h-3.5 w-3.5" />Photos &amp; videos <span className="text-gray-300">{view.items.length}</span></h3>
            {canSend && <button type="button" onClick={onUpload} className="!min-h-0 inline-flex items-center gap-1 text-[13px] font-bold text-[#1F8FE0]"><Plus className="h-4 w-4" />Add</button>}
          </div>
          {view.items.length === 0 ? (
            <button type="button" onClick={canSend ? onUpload : undefined} className="!min-h-0 w-full rounded-xl border-2 border-dashed border-gray-200 py-8 text-[13px] font-semibold text-gray-400 dark:border-slate-700">
              {canSend ? "No photos yet. Tap to add the first ones." : "No photos yet."}
            </button>
          ) : (
            <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {view.items.map((item, index) => (
                <button key={item.key} type="button" onClick={() => onOpenViewer(index)} aria-label={`Open ${item.kind} ${index + 1}`}
                  className="!min-h-0 relative h-28 w-28 shrink-0 snap-start overflow-hidden rounded-xl bg-gray-100 dark:bg-slate-800">
                  {item.thumbUrl ? <img src={item.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                  {item.kind === "video" && <span className="absolute inset-0 flex items-center justify-center bg-black/25"><span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-black/40"><span className="ml-0.5 h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-white" /></span></span>}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] font-bold text-white">{item.labelText}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-gray-50 p-4 dark:bg-slate-950">
          <div>
            <p className={`m-0 inline-flex items-center gap-1.5 text-[14px] font-black ${line.tone}`}>{line.icon}{line.text}</p>
            <p className="m-0 mt-1 text-[12.5px] text-gray-500 dark:text-slate-400">{view.description || "No description has been added yet."}</p>
          </div>
          {view.priceText && <strong className="text-2xl font-black text-gray-900 dark:text-slate-100">{view.priceText}</strong>}
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-xl bg-gray-50 p-4 dark:bg-slate-950">
            <h3 className="m-0 text-xs font-black uppercase tracking-wide text-gray-400">Packages &amp; prices</h3>
            <div className="mt-2 space-y-2">
              {packages.length === 0 && <p className="m-0 text-xs text-gray-500">No active packages configured.</p>}
              {packages.map((pkg) => (
                <div key={pkg.id} className="flex justify-between gap-3 text-sm">
                  <span className="font-bold text-gray-700 dark:text-slate-200">{pkg.name} · {pkg.quantity} pcs</span>
                  {pkg.priceText && <strong className="shrink-0 text-[#1F8FE0]">{pkg.priceText}</strong>}
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl bg-gray-50 p-4 dark:bg-slate-950">
            <h3 className="m-0 text-xs font-black uppercase tracking-wide text-gray-400">Stock by state</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {stockByState.length === 0 && <p className="m-0 text-xs text-gray-500">No state stock right now.</p>}
              {stockByState.map((row) => (
                <span key={row.state} className={`rounded-full px-2.5 py-1 text-xs font-black ${row.quantity > 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-gray-100 text-gray-400 dark:bg-slate-800"}`}>{row.state} {row.quantity}</span>
              ))}
            </div>
            {pairs.length > 0 && (
              <>
                <h3 className="m-0 mt-4 text-xs font-black uppercase tracking-wide text-gray-400">Pairs well with</h3>
                <p className="m-0 mt-1.5 text-[13px] font-semibold text-gray-700 dark:text-slate-200">{pairs.join(", ")}</p>
              </>
            )}
          </section>
          <section className="rounded-xl bg-blue-50 p-4 dark:bg-blue-500/10">
            <h3 className="m-0 text-xs font-black uppercase tracking-wide text-blue-600">Selling points</h3>
            <ul className="m-0 mt-2 list-none space-y-1 p-0 text-sm font-semibold text-gray-700 dark:text-slate-200">
              <li>• Confirm the customer&apos;s main need first.</li>
              <li>• Quote the active package that best fits their budget.</li>
              <li>• Confirm {sellingState} availability before promising delivery.</li>
              {view.items.length > 0 && <li>• Send a photo or video from the gallery on WhatsApp.</li>}
            </ul>
          </section>
          <section className="rounded-xl bg-violet-50 p-4 dark:bg-violet-500/10">
            <h3 className="m-0 text-xs font-black uppercase tracking-wide text-violet-600">Short sales script</h3>
            <p className="m-0 mt-2 text-sm font-semibold leading-relaxed text-gray-700 dark:text-slate-200">
              “Based on what you need, {view.name} is a good fit. We currently have stock serving {sellingState}. Would you like the best-value package, and may I also show you an item customers commonly buy with it?”
            </p>
          </section>
        </div>
      </div>
    </Sheet>
  );
}
