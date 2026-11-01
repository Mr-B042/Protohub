import { useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Clock3, Eye, Flame, Globe, Images, MoreHorizontal, Package, PackageCheck, Tag, Upload, XCircle } from "lucide-react";
import type { GalleryItem } from "./MediaViewer";
import { MenuItem, PopoverMenu, categoryTone } from "./shared";

export type ProductView = {
  /** Product Launch stage, set for the Owner only (a badge must not tell reps about a Silent Test). */
  launchStage?: "live" | "silent" | "soft";
  id: string;
  name: string;
  sku: string;
  description: string;
  active: boolean;
  stock: number;
  stockState: "ok" | "low" | "out";
  priceText: string;
  category: { name: string; color: string } | null;
  items: GalleryItem[];
  pendingCount: number;
  landingPageCount: number;
  // From Settings: the word for a unit, whether reps see numbers, the picture
  // shown when a product has no photos yet.
  unitsWord: string;
  // Orders in the last 30 days (real orders, not the stale units_sold).
  orders30d: number;
  showStockNumbers: boolean;
  fallbackImage: string | null;
};

export type CardActions = {
  canSelect: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpenViewer: (index: number) => void;
  onViewDetails: () => void;
  primary: { label: ReactNode; onClick: () => void; tone?: "blue" | "amber" };
  menu: Array<{ key: string; label: string; icon: ReactNode; onClick: () => void; tone?: "default" | "danger" }>;
};

export const stockLine = (view: ProductView) => {
  const amount = (word: string) => view.showStockNumbers ? `${view.stock.toLocaleString()} ${view.unitsWord}${word}` : word.trim() || "In stock";
  return view.stockState === "out" ? { text: "Out of stock", tone: "text-rose-600 dark:text-rose-400", icon: <XCircle className="h-4 w-4" /> }
    : view.stockState === "low" ? { text: view.showStockNumbers ? amount(" · low stock") : "Low stock", tone: "text-amber-600 dark:text-amber-400", icon: <CircleAlert className="h-4 w-4" /> }
    : { text: view.showStockNumbers ? amount(" in stock") : "In stock", tone: "text-emerald-600 dark:text-emerald-400", icon: <CheckCircle2 className="h-4 w-4" /> };
};

function PlayBadge({ big }: { big?: boolean }) {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
      <span className={`flex items-center justify-center rounded-full border-2 border-white bg-black/40 ${big ? "h-12 w-12" : "h-7 w-7"}`}>
        <span className={`ml-0.5 h-0 w-0 border-y-transparent border-l-white ${big ? "border-y-[8px] border-l-[13px]" : "border-y-[5px] border-l-[8px]"}`} />
      </span>
    </span>
  );
}

export function ProductCard({ view, actions }: { view: ProductView; actions: CardActions }) {
  const [slide, setSlide] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const items = view.items;
  const line = stockLine(view);

  const goTo = (next: number) => {
    const target = (next + items.length) % Math.max(1, items.length);
    track.current?.scrollTo({ left: (track.current?.clientWidth ?? 0) * target, behavior: "smooth" });
    setSlide(target);
  };
  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const next = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (next !== slide) setSlide(next);
  };
  // Design: four thumbnails, then a "+N" tile for the rest.
  const strip = items.slice(0, items.length > 5 ? 4 : 5);
  const more = items.length > 5 ? items.length - 4 : 0;

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm ring-1 ring-slate-900/[0.02] transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-[#0c1722] dark:ring-0">
      <div className="relative m-2.5 mb-0 aspect-[4/3] overflow-hidden rounded-xl bg-gray-100 dark:bg-slate-900">
        {items.length > 0 ? (
          <div ref={track} onScroll={onScroll} className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {items.map((item, index) => (
              <button key={item.key} type="button" onClick={() => actions.onOpenViewer(index)} aria-label={`Open ${view.name} ${item.kind === "video" ? "video" : "photo"} ${index + 1}`}
                className="!min-h-0 relative h-full w-full shrink-0 snap-center">
                {item.thumbUrl || item.kind === "image"
                  ? <img src={item.thumbUrl ?? item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  : <span className="block h-full w-full bg-slate-800" />}
                {item.kind === "video" && <PlayBadge big />}
              </button>
            ))}
          </div>
        ) : view.fallbackImage ? (
          <img src={view.fallbackImage} alt="" loading="lazy" className="h-full w-full object-cover opacity-90" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-gray-300 dark:text-slate-600">
            <Package className="h-10 w-10" />
            <span className="text-[11px] font-bold text-gray-400 dark:text-slate-500">No photos yet</span>
          </div>
        )}

        <span className="pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold shadow-sm dark:bg-slate-900/90">
          <span className={`h-2 w-2 rounded-full ${view.active ? "bg-emerald-500" : "bg-gray-400"}`} />
          <span className={view.active ? "text-emerald-700 dark:text-emerald-300" : "text-gray-500"}>{view.active ? "Active" : "Inactive"}</span>
          {view.launchStage && view.launchStage !== "live" && (
            <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-black uppercase ${view.launchStage === "silent" ? "bg-violet-100 text-violet-800" : "bg-teal-100 text-teal-800"}`}>
              {view.launchStage === "silent" ? "Silent Test" : "Soft Launch"}
            </span>
          )}
        </span>
        <div className="absolute right-2.5 top-2.5 flex items-center gap-1.5">
          {view.pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-1 text-[10px] font-black text-amber-950 shadow-sm"><Clock3 className="h-3 w-3" />{view.pendingCount}</span>
          )}
          <button ref={menuButton} type="button" aria-label={`More for ${view.name}`} onClick={() => setMenuOpen((open) => !open)}
            className="!min-h-0 flex h-8 w-8 items-center justify-center rounded-lg bg-white/95 text-gray-700 shadow-sm hover:bg-white dark:bg-slate-900/90 dark:text-slate-200">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {actions.canSelect && (
            <label className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-white/95 shadow-sm dark:bg-slate-900/90">
              <input type="checkbox" checked={actions.selected} onChange={actions.onToggleSelect} aria-label={`Select ${view.name}`} className="h-4 w-4 rounded border-gray-300 accent-[#1F8FE0]" />
            </label>
          )}
        </div>

        {items.length > 1 && (
          <>
            <button type="button" aria-label="Previous picture" onClick={() => goTo(slide - 1)}
              className="!min-h-0 absolute left-2.5 top-[42%] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-gray-700 shadow-md hover:bg-white dark:bg-slate-900/90 dark:text-slate-200"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" aria-label="Next picture" onClick={() => goTo(slide + 1)}
              className="!min-h-0 absolute right-2.5 top-[42%] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-gray-700 shadow-md hover:bg-white dark:bg-slate-900/90 dark:text-slate-200"><ChevronRight className="h-4 w-4" /></button>
            <div className="absolute inset-x-2 bottom-2 grid grid-cols-5 gap-1.5">
              {strip.map((item, index) => (
                <button key={item.key} type="button" onClick={() => goTo(index)} aria-label={`Show picture ${index + 1}`}
                  className={`!min-h-0 relative aspect-square overflow-hidden rounded-md border-2 bg-slate-800 ${slide === index ? "border-white" : "border-white/40"}`}>
                  {item.thumbUrl ? <img src={item.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                  {item.kind === "video" && <PlayBadge />}
                </button>
              ))}
              {more > 0 && (
                <button type="button" onClick={() => actions.onOpenViewer(4)} aria-label={`See all ${items.length}`}
                  className="!min-h-0 relative aspect-square overflow-hidden rounded-md border-2 border-white/40 bg-slate-800">
                  {items[4]?.thumbUrl ? <img src={items[4].thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover opacity-60" /> : null}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-black text-white">+{more}</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-1 flex-col px-3.5 pb-3.5 pt-3">
        <h3 className="m-0 text-[15px] font-black leading-tight text-gray-900 dark:text-slate-100">{view.name}</h3>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
          {view.sku && <span className="text-[12px] font-medium text-gray-400 dark:text-slate-500">SKU: {view.sku}</span>}
          {view.category && <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${categoryTone(view.category.color)}`}>{view.category.name}</span>}
        </div>
        <p className="m-0 mt-1.5 line-clamp-1 text-[12.5px] text-gray-500 dark:text-slate-400">{view.description || "No description yet."}</p>
        {view.orders30d > 0 && (
          <p className="m-0 mt-1.5 inline-flex items-center gap-1 text-[12px] font-bold text-orange-600 dark:text-orange-400">
            <Flame className="h-3.5 w-3.5" />{view.orders30d.toLocaleString()} order{view.orders30d === 1 ? "" : "s"} · last 30 days
          </p>
        )}
        <div className="mt-3 flex items-end justify-between gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[13px] font-bold ${line.tone}`}>{line.icon}{line.text}</span>
          <strong className="shrink-0 text-[19px] font-black leading-none tracking-tight text-gray-900 dark:text-slate-100">{view.priceText}</strong>
        </div>
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <button type="button" onClick={actions.onViewDetails}
            className="!min-h-0 whitespace-nowrap rounded-xl border border-gray-200 bg-white px-2.5 py-2.5 text-[13px] font-bold text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">
            View Details
          </button>
          <button type="button" onClick={actions.primary.onClick}
            className={`!min-h-0 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2.5 text-[13px] font-bold text-white hover:opacity-90 ${actions.primary.tone === "amber" ? "bg-amber-500" : "bg-[#1F8FE0]"}`}>
            {actions.primary.label}
          </button>
        </div>
      </div>

      <PopoverMenu anchor={menuButton.current} open={menuOpen} onClose={() => setMenuOpen(false)}>
        {actions.menu.map((item) => (
          <MenuItem key={item.key} icon={item.icon} tone={item.tone} onClick={() => { setMenuOpen(false); item.onClick(); }}>{item.label}</MenuItem>
        ))}
      </PopoverMenu>
    </article>
  );
}

export function ProductRow({ view, actions }: { view: ProductView; actions: CardActions }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const line = stockLine(view);
  const cover = view.items[0];
  return (
    <div className="flex items-center gap-3 border-b border-gray-100 px-2 py-3 last:border-b-0 dark:border-slate-800">
      {actions.canSelect && <input type="checkbox" checked={actions.selected} onChange={actions.onToggleSelect} aria-label={`Select ${view.name}`} className="h-4 w-4 shrink-0 rounded accent-[#1F8FE0]" />}
      <button type="button" onClick={() => (cover ? actions.onOpenViewer(0) : actions.onViewDetails())} aria-label={`Open ${view.name} gallery`}
        className="!min-h-0 relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gray-100 dark:bg-slate-900">
        {cover?.thumbUrl || view.fallbackImage ? <img src={cover?.thumbUrl ?? view.fallbackImage ?? undefined} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Package className="m-auto h-6 w-6 text-gray-300" />}
        {view.items.length > 1 && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[9px] font-black text-white">{view.items.length}</span>}
      </button>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[14px] font-black text-gray-900 dark:text-slate-100">{view.name}</p>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
          {view.sku && <span className="text-gray-400">SKU: {view.sku}</span>}
          {view.category && <span className={`rounded px-1.5 py-0.5 font-bold ${categoryTone(view.category.color)}`}>{view.category.name}</span>}
          <span className={`inline-flex items-center gap-1 font-bold ${line.tone}`}>{line.text}</span>
        </div>
      </div>
      <strong className="hidden shrink-0 text-[15px] font-black text-gray-900 sm:block dark:text-slate-100">{view.priceText}</strong>
      <button type="button" onClick={actions.onViewDetails} className="!min-h-0 hidden shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-700 md:inline-flex dark:border-slate-600 dark:text-slate-200">View Details</button>
      <button ref={menuButton} type="button" aria-label={`More for ${view.name}`} onClick={() => setMenuOpen((open) => !open)}
        className="!min-h-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><MoreHorizontal className="h-4 w-4" /></button>
      <PopoverMenu anchor={menuButton.current} open={menuOpen} onClose={() => setMenuOpen(false)}>
        <MenuItem icon={<Eye />} onClick={() => { setMenuOpen(false); actions.onViewDetails(); }}>View details</MenuItem>
        {actions.menu.map((item) => (
          <MenuItem key={item.key} icon={item.icon} tone={item.tone} onClick={() => { setMenuOpen(false); item.onClick(); }}>{item.label}</MenuItem>
        ))}
      </PopoverMenu>
    </div>
  );
}

export const menuIcons = { gallery: <Images />, upload: <Upload />, landing: <Globe />, stock: <PackageCheck />, category: <Tag /> };
