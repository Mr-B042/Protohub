import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { productMediaApi, type CatalogSettings, type ProductCategory, type ProductMedia, type ProductMediaLabel } from "../../lib/api";

// Shared pieces of the Products & Stock redesign (Bright's design, 17 Oct 2026).

/** The product fields these screens read; App.tsx's own Product type fits it. */
export type CatalogProduct = {
  id: string; name: string; sku: string; description: string; active: boolean; createdAt: string; unitsSold: number;
  categoryId?: string | null; catalogType?: string;
  crossSellProductIds?: string[]; freeGiftProductIds?: string[];
  packages: Array<{ id: string; name: string; quantity: number; price: number; currency: string; active: boolean; displayOrder: number; imageUrl?: string; imageUrls?: string[]; featuredComboCard?: boolean;
    packageComponents?: Array<{ productId: string; quantity: number; isFreeGift?: boolean }> }>;
};

export const MEDIA_LABEL_OPTIONS: Array<{ value: ProductMediaLabel; text: string }> = [
  { value: "product_in_use", text: "Product in use" },
  { value: "customer_review", text: "Customer review" },
  { value: "unboxing", text: "Unboxing" },
  { value: "size", text: "Size / measurements" },
  { value: "packaging", text: "Packaging" },
  { value: "other", text: "Other" }
];

const CATEGORY_TONES: Record<string, string> = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  cyan: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  orange: "bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300"
};
export const categoryTone = (color: string | undefined) => CATEGORY_TONES[color ?? "blue"] ?? CATEGORY_TONES.blue;
/** Chart colours per category colour; order validated for colour-blind separation. */
export const CATEGORY_HEX: Record<string, string> = {
  blue: "#3b82f6", amber: "#d97706", violet: "#a855f7", emerald: "#16a34a", rose: "#ec4899", cyan: "#0891b2", orange: "#ea580c", slate: "#64748b"
};
export const OTHERS_HEX = "#94a3b8";
export const CATEGORY_DOTS: Record<string, string> = {
  blue: "bg-blue-500", emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500",
  violet: "bg-violet-500", cyan: "bg-cyan-500", orange: "bg-orange-500", slate: "bg-slate-400"
};

export function StatusPill({ status }: { status: ProductMedia["status"] }) {
  const tone = status === "approved" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
    : status === "rejected" ? "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
    : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  const text = status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending";
  return <span className={`inline-flex shrink-0 items-center rounded-lg px-2.5 py-1 text-[11px] font-bold ${tone}`}>{text}</span>;
}

const AVATAR_TONES = ["bg-amber-100 text-amber-700", "bg-sky-100 text-sky-700", "bg-violet-100 text-violet-700", "bg-emerald-100 text-emerald-700", "bg-rose-100 text-rose-700"];
export function Avatar({ name, size = "h-4 w-4 text-[8px]" }: { name: string; size?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
  const tone = AVATAR_TONES[Array.from(name).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_TONES.length];
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-black ${size} ${tone}`}>{initials}</span>;
}

/** Everything the page loads once: media, categories, what this person may do. */
export function useProductsStockData() {
  const [media, setMedia] = useState<ProductMedia[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [canSend, setCanSend] = useState(false);
  const [repUploadsEnabled, setRepUploadsEnabled] = useState(true);
  const [settings, setSettings] = useState<CatalogSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [list, cats] = await Promise.all([productMediaApi.list(), productMediaApi.categories()]);
      setMedia(Array.isArray(list?.media) ? list.media : []);
      setCanApprove(Boolean(list?.canApprove));
      setCanSend(Boolean(list?.canSend));
      setRepUploadsEnabled(list?.repUploadsEnabled !== false);
      if (list?.settings) setSettings(list.settings);
      setCategories(Array.isArray(cats?.categories) ? cats.categories : []);
      setError("");
    } catch (err: any) {
      setError(err?.message ?? "Could not load the media gallery.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { media, setMedia, categories, setCategories, canApprove, canSend, repUploadsEnabled, setRepUploadsEnabled, settings, setSettings, loading, error, refresh };
}

/**
 * A menu drawn on top of the page. ⚠️ Cards clip their corners
 * (overflow-hidden), which would cut an in-card menu off, so it is portalled.
 */
export function PopoverMenu({ anchor, open, onClose, children, align = "right", width = 220 }: {
  anchor: HTMLElement | null; open: boolean; onClose: () => void; children: ReactNode; align?: "left" | "right"; width?: number;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const left = align === "right" ? rect.right - width : rect.left;
      const height = menuRef.current?.offsetHeight ?? 0;
      const below = rect.bottom + 6;
      const top = below + height > window.innerHeight - 8 && rect.top - height - 6 > 8 ? rect.top - height - 6 : below;
      setPos({ top, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, anchor, align, width]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("touchstart", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, anchor, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={menuRef} role="menu" style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
      className="fixed z-[95] overflow-hidden rounded-xl border border-gray-200 bg-white py-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      {children}
    </div>,
    document.body
  );
}

export function MenuItem({ icon, children, onClick, tone = "default", disabled }: { icon?: ReactNode; children: ReactNode; onClick: () => void; tone?: "default" | "danger" | "success"; disabled?: boolean }) {
  const color = tone === "danger" ? "text-rose-600 dark:text-rose-400" : tone === "success" ? "text-emerald-700 dark:text-emerald-400" : "text-gray-700 dark:text-slate-200";
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick}
      className={`!min-h-0 flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-semibold hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-800 ${color}`}>
      {icon ? <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}{children}
    </button>
  );
}

/**
 * A panel that rises from the bottom on phones (thumb reach, 80% of use) and
 * sits centred on a computer. Body scrolls; header and footer stay put.
 */
export function Sheet({ title, subtitle, onClose, children, footer, wide }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-6" onClick={onClose}>
      <section role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl dark:bg-slate-900 ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}>
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-gray-200 sm:hidden dark:bg-slate-700" />
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">{title}</h2>
            {subtitle ? <p className="m-0 mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">{subtitle}</p> : null}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 -mr-1 rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer ? <footer className="shrink-0 border-t border-gray-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-slate-800">{footer}</footer> : null}
      </section>
    </div>,
    document.body
  );
}

export const cardShell = "rounded-2xl border border-gray-200/80 bg-white shadow-sm ring-1 ring-slate-900/[0.02] dark:border-slate-700 dark:bg-[#0c1722] dark:ring-0";
