import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, Filter, Image as ImageIcon, Images, LayoutGrid, List,
  Maximize2, MoreHorizontal, Plus, Search, Share2, Star, Tag, Trash2, Video, X, XCircle
} from "lucide-react";
import type { ProductMedia, ProductMediaUsage } from "../../lib/api";
import { fileNameFor, formatBytes, formatDuration, mediaResultMessage, prefetchMediaFile, saveMediaFile, shareMediaFile } from "../../lib/media-upload";
import { Avatar, MenuItem, PopoverMenu, Sheet, StatusPill, cardShell } from "./shared";
import { ThumbnailPicker } from "./ThumbnailPicker";

// Media Library (Bright's design, 17 Oct 2026): products down the left, every
// file in the middle, the chosen file's details on the right. On a phone the
// product list becomes a picker and the details open as a bottom sheet.

const USAGE_OPTIONS: Array<{ value: ProductMediaUsage; text: string }> = [
  { value: "product_page", text: "Product page" },
  { value: "sales_workspace", text: "Sales rep workspace" },
  { value: "whatsapp", text: "WhatsApp sharing" },
  { value: "ads", text: "Ads creative" }
];

export type LibraryProduct = { id: string; name: string; sku: string; thumbUrl: string | null };

export function MediaLibrary({ media, products, canApprove, currentUserId, canSend, onUpload, onOpenViewer, onApprove, onReject, onDelete, onBulk, onUpdate, onSetCover, onToast, onThumbnail }: {
  /** Replace a video's thumbnail (chosen frame or uploaded picture). */
  onThumbnail?: (item: ProductMedia, imageDataUrl: string) => Promise<void>;
  media: ProductMedia[];
  products: LibraryProduct[];
  canApprove: boolean;
  currentUserId: string;
  canSend: boolean;
  onUpload: () => void;
  onOpenViewer: (item: ProductMedia) => void;
  onApprove: (item: ProductMedia) => Promise<void>;
  onReject: (item: ProductMedia) => void;
  onDelete: (item: ProductMedia) => void;
  onBulk: (ids: string[], action: "approve" | "delete" | "tag", extra?: { tag?: string }) => Promise<void>;
  onUpdate: (item: ProductMedia, patch: { tags?: string[]; usage?: ProductMediaUsage[] }) => Promise<void>;
  onSetCover: (item: ProductMedia) => void;
  onToast: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [kind, setKind] = useState<"" | "image" | "video">("");
  const [status, setStatus] = useState<"" | ProductMedia["status"]>("");
  const [sort, setSort] = useState<"newest" | "oldest" | "largest" | "name">("newest");
  const [label, setLabel] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [pageSize, setPageSize] = useState(24);
  const [visible, setVisible] = useState(24);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const filtersButton = useRef<HTMLButtonElement | null>(null);

  const library = useMemo(() => media.filter((item) => item.status !== "uploading" && (canApprove || item.status === "approved" || item.uploadedBy === currentUserId)), [media, canApprove, currentUserId]);
  const nameOf = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const needle = search.trim().toLowerCase();
  const shown = useMemo(() => library
    .filter((item) => (!productId || item.productId === productId) && (!kind || item.kind === kind) && (!status || item.status === status) && (!label || item.label === label))
    .filter((item) => !needle || `${item.name} ${nameOf.get(item.productId)?.name ?? ""} ${item.tags.join(" ")} ${item.labelText} ${item.caption}`.toLowerCase().includes(needle))
    .sort((a, b) => sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : sort === "largest" ? b.sizeBytes - a.sizeBytes : sort === "name" ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt)),
  [library, productId, kind, status, label, needle, sort, nameOf]);
  useEffect(() => { setVisible(pageSize); }, [pageSize, productId, kind, status, label, needle]);
  const active = shown.find((item) => item.id === activeId) ?? shown[0] ?? null;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const stats = {
    total: library.length, newThisWeek: library.filter((item) => item.createdAt >= weekAgo).length,
    images: library.filter((item) => item.kind === "image").length, videos: library.filter((item) => item.kind === "video").length,
    pending: library.filter((item) => item.status === "pending").length, rejected: library.filter((item) => item.status === "rejected" || item.status === "changes_requested").length
  };
  const perProduct = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of library) counts.set(item.productId, (counts.get(item.productId) ?? 0) + 1);
    return counts;
  }, [library]);
  const productList = products.filter((product) => !productSearch.trim() || product.name.toLowerCase().includes(productSearch.trim().toLowerCase()))
    .sort((a, b) => (perProduct.get(b.id) ?? 0) - (perProduct.get(a.id) ?? 0) || a.name.localeCompare(b.name));

  const pick = (item: ProductMedia) => { setActiveId(item.id); if (window.matchMedia("(max-width: 1279px)").matches) setSheetOpen(true); };
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allShownSelected = shown.slice(0, visible).length > 0 && shown.slice(0, visible).every((item) => selected.has(item.id));
  const runBulk = async (action: "approve" | "delete" | "tag") => {
    const ids = Array.from(selected);
    if (action === "delete" && !window.confirm(`Delete ${ids.length} file${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    let tag: string | undefined;
    if (action === "tag") { tag = window.prompt("Tag to add (e.g. Lifestyle, Demo, Main Image)")?.trim(); if (!tag) return; }
    await onBulk(ids, action, { tag });
    setSelected(new Set());
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative block min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search media by filename, product, tag..."
            className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-[14px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <Picker value={productId} onChange={setProductId} label="Product"><option value="">All Products</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</Picker>
          <Picker value={kind} onChange={(value) => setKind(value as "" | "image" | "video")} label="Media type"><option value="">All Media Types</option><option value="image">Images</option><option value="video">Videos</option></Picker>
          {canApprove && (
            <Picker value={status} onChange={(value) => setStatus(value as "" | ProductMedia["status"])} label="Status">
              <option value="">All Statuses</option><option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option><option value="changes_requested">Changes requested</option>
            </Picker>
          )}
          <Picker value={sort} onChange={(value) => setSort(value as typeof sort)} label="Sort"><option value="newest">Newest First</option><option value="oldest">Oldest First</option><option value="largest">Largest First</option><option value="name">Name A-Z</option></Picker>
          <button ref={filtersButton} type="button" onClick={() => setFiltersOpen((value) => !value)}
            className={`!min-h-0 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-bold ${label ? "border-[#1F8FE0] bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15" : "border-gray-200 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"}`}>
            <Filter className="h-4 w-4" />Filters
          </button>
        </div>
      </div>
      <PopoverMenu anchor={filtersButton.current} open={filtersOpen} onClose={() => setFiltersOpen(false)} width={220}>
        <p className="m-0 px-3.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">What it shows</p>
        {[["", "Everything"], ["product_in_use", "Product in use"], ["customer_review", "Customer review"], ["unboxing", "Unboxing"], ["size", "Size / measurements"], ["packaging", "Packaging"], ["other", "Other"]].map(([value, text]) => (
          <MenuItem key={value} icon={label === value ? <CheckCircle2 /> : <span className="block h-4 w-4" />} onClick={() => { setLabel(value); setFiltersOpen(false); }}>{text}</MenuItem>
        ))}
      </PopoverMenu>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <MiniStat icon={<ImageIcon className="h-5 w-5" />} tone="bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15" value={stats.total} label="Total Media Files" hint={stats.newThisWeek ? `+${stats.newThisWeek} this week` : undefined} />
        <MiniStat icon={<Images className="h-5 w-5" />} tone="bg-blue-50 text-blue-500 dark:bg-blue-500/15" value={stats.images} label="Product Images" />
        <MiniStat icon={<Video className="h-5 w-5" />} tone="bg-violet-50 text-violet-600 dark:bg-violet-500/15" value={stats.videos} label="Product Videos" />
        <MiniStat icon={<Clock3 className="h-5 w-5" />} tone="bg-amber-50 text-amber-500 dark:bg-amber-500/15" value={stats.pending} label="Pending Approval" onClick={() => setStatus("pending")} />
        <MiniStat icon={<XCircle className="h-5 w-5" />} tone="bg-rose-50 text-rose-500 dark:bg-rose-500/15" value={stats.rejected} label="Rejected" onClick={() => setStatus("rejected")} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_17.5rem]">
        <aside className={`${cardShell} hidden p-3 lg:block`}>
          <div className="flex items-center justify-between px-1"><h2 className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-100">Products</h2></div>
          <label className="relative mt-2 block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search products..."
              className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-2 text-[12.5px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
          </label>
          <div className="mt-2 max-h-[38rem] space-y-0.5 overflow-y-auto">
            <ProductRowButton active={!productId} onClick={() => setProductId("")} icon={<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-[#1F8FE0] dark:bg-blue-500/20"><Images className="h-4 w-4" /></span>} name="All Products" count={library.length} />
            {productList.map((product) => (
              <ProductRowButton key={product.id} active={productId === product.id} onClick={() => setProductId(product.id)}
                icon={<span className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-slate-800">{product.thumbUrl ? <img src={product.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}</span>}
                name={product.name} count={perProduct.get(product.id) ?? 0} />
            ))}
          </div>
        </aside>

        <section className={`${cardShell} min-w-0 p-3 sm:p-4`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 mr-auto text-[17px] font-black text-gray-900 dark:text-slate-100">{productId ? nameOf.get(productId)?.name : "All Media"} <span className="text-gray-400">({shown.length})</span></h2>
            <div className="inline-flex overflow-hidden rounded-xl border border-gray-200 dark:border-slate-600">
              {([["grid", <LayoutGrid key="g" className="h-4 w-4" />], ["list", <List key="l" className="h-4 w-4" />]] as const).map(([key, icon]) => (
                <button key={key} type="button" aria-label={`${key} view`} aria-pressed={view === key} onClick={() => setView(key)}
                  className={`!min-h-0 px-3 py-2 ${view === key ? "bg-[#1F8FE0] text-white" : "bg-white text-gray-500 dark:bg-slate-950"}`}>{icon}</button>
              ))}
            </div>
            <Picker value={String(pageSize)} onChange={(value) => setPageSize(Number(value))} label="Per page" small><option value="24">Show 24</option><option value="48">Show 48</option><option value="96">Show 96</option></Picker>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-gray-600 dark:text-slate-300">
              <input type="checkbox" checked={allShownSelected} onChange={(event) => setSelected(event.target.checked ? new Set(shown.slice(0, visible).map((item) => item.id)) : new Set())} className="h-4 w-4 accent-[#1F8FE0]" />Select All
            </label>
            {selected.size > 0 && canApprove && (
              <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                <span className="font-bold text-gray-500">{selected.size} selected</span>
                <button type="button" onClick={() => runBulk("approve")} className="!min-h-0 rounded-lg bg-emerald-50 px-2.5 py-1 font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Approve</button>
                <button type="button" onClick={() => runBulk("tag")} className="!min-h-0 rounded-lg bg-blue-50 px-2.5 py-1 font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">Add tag</button>
                <button type="button" onClick={() => runBulk("delete")} className="!min-h-0 rounded-lg bg-rose-50 px-2.5 py-1 font-bold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">Delete</button>
              </div>
            )}
          </div>

          {shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Images className="h-10 w-10 text-gray-300" />
              <p className="m-0 text-sm font-black text-gray-700 dark:text-slate-200">{library.length === 0 ? "The gallery is empty" : "Nothing matches"}</p>
              <p className="m-0 max-w-sm text-[13px] text-gray-500">{library.length === 0 ? "Add the first photos and videos so the team can show customers the real product." : "Try another product, type or search."}</p>
              {canSend && library.length === 0 && <button type="button" onClick={onUpload} className="!min-h-0 mt-2 inline-flex items-center gap-1.5 rounded-xl bg-[#1F8FE0] px-4 py-2.5 text-sm font-black text-white"><Plus className="h-4 w-4" />Upload media</button>}
            </div>
          ) : view === "grid" ? (
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-4">
              {shown.slice(0, visible).map((item) => (
                <MediaTile key={item.id} item={item} active={active?.id === item.id} selected={selected.has(item.id)} onPick={() => pick(item)} onToggle={() => toggle(item.id)}
                  menu={<TileMenu item={item} canApprove={canApprove} mine={item.uploadedBy === currentUserId} onOpen={() => onOpenViewer(item)} onApprove={() => onApprove(item)} onReject={() => onReject(item)} onDelete={() => onDelete(item)} onCover={() => onSetCover(item)} />} />
              ))}
            </div>
          ) : (
            <div className="mt-3 divide-y divide-gray-100 dark:divide-slate-800">
              {shown.slice(0, visible).map((item) => (
                <div key={item.id} className={`flex items-center gap-3 px-1 py-2.5 ${active?.id === item.id ? "bg-blue-50/60 dark:bg-blue-500/10" : ""}`}>
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={`Select ${item.name}`} className="h-4 w-4 shrink-0 accent-[#1F8FE0]" />
                  <button type="button" onClick={() => pick(item)} className="!min-h-0 relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-slate-800">{item.thumbUrl ? <img src={item.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}</button>
                  <button type="button" onClick={() => pick(item)} className="!min-h-0 min-w-0 flex-1 text-left">
                    <span className="block truncate text-[13px] font-bold text-gray-900 dark:text-slate-100">{item.name}</span>
                    <span className="block truncate text-[11.5px] text-gray-500">{nameOf.get(item.productId)?.name} · {formatBytes(item.sizeBytes)}{item.kind === "video" && item.durationSeconds ? ` · ${formatDuration(item.durationSeconds)}` : ""}</span>
                  </button>
                  <TypePill kind={item.kind} /><StatusPill status={item.status} />
                </div>
              ))}
            </div>
          )}
          {shown.length > visible && (
            <button type="button" onClick={() => setVisible((value) => value + pageSize)} className="!min-h-0 mt-4 w-full rounded-xl border border-gray-200 py-2.5 text-[13px] font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200">
              Show {Math.min(pageSize, shown.length - visible)} more ({shown.length - visible} left)
            </button>
          )}
        </section>

        <aside className="hidden xl:block">
          {active ? (
            <MediaDetails item={active} list={shown.filter((entry) => entry.productId === active.productId)} product={nameOf.get(active.productId) ?? null} canApprove={canApprove}
              mine={active.uploadedBy === currentUserId} onSelect={(item) => setActiveId(item.id)} onOpenViewer={onOpenViewer} onApprove={onApprove} onReject={onReject}
              onDelete={onDelete} onUpdate={onUpdate} onSetCover={onSetCover} onToast={onToast} onThumbnail={onThumbnail} />
          ) : <div className={`${cardShell} p-6 text-center text-[13px] text-gray-400`}>Pick a file to see its details.</div>}
        </aside>
      </div>

      {sheetOpen && active && (
        <Sheet title={active.name} subtitle={nameOf.get(active.productId)?.name} onClose={() => setSheetOpen(false)}>
          <MediaDetails embedded item={active} list={shown.filter((entry) => entry.productId === active.productId)} product={nameOf.get(active.productId) ?? null} canApprove={canApprove}
            mine={active.uploadedBy === currentUserId} onSelect={(item) => setActiveId(item.id)} onOpenViewer={onOpenViewer} onApprove={onApprove} onReject={onReject}
            onDelete={(item) => { setSheetOpen(false); onDelete(item); }} onUpdate={onUpdate} onSetCover={onSetCover} onToast={onToast} onThumbnail={onThumbnail} />
        </Sheet>
      )}
    </div>
  );
}

function Picker({ value, onChange, label, children, small }: { value: string; onChange: (value: string) => void; label: string; children: ReactNode; small?: boolean }) {
  return (
    <span className="relative block shrink-0">
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}
        className={`${small ? "h-9" : "h-11"} appearance-none rounded-xl border border-gray-200 bg-white pl-3.5 pr-9 text-[13px] font-semibold text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200`}>{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    </span>
  );
}

export function MiniStat({ icon, tone, value, label, hint, onClick, chart, sub }: { icon: ReactNode; tone: string; value: ReactNode; label: string; hint?: string; sub?: string; onClick?: () => void; chart?: ReactNode }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={`${cardShell} !min-h-0 flex items-center gap-3 p-3.5 text-left`}>
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-[20px] font-black leading-none tabular-nums text-gray-900 dark:text-slate-100">{value}</strong>
        <span className="mt-1 block text-[12.5px] font-semibold leading-tight text-gray-600 dark:text-slate-300">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] font-semibold leading-tight text-emerald-600 dark:text-emerald-400">↑ {hint}</span> : null}
        {sub ? <span className="mt-0.5 block text-[11px] leading-tight text-gray-400">{sub}</span> : null}
      </span>
      {chart ? <span className="hidden shrink-0 sm:block">{chart}</span> : null}
    </Tag>
  );
}

function ProductRowButton({ active, onClick, icon, name, count }: { active: boolean; onClick: () => void; icon: ReactNode; name: string; count: number }) {
  return (
    <button type="button" onClick={onClick} className={`!min-h-0 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left ${active ? "bg-blue-50 text-[#1F8FE0] ring-1 ring-blue-100 dark:bg-blue-500/15 dark:ring-blue-500/30" : "text-gray-800 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-900"}`}>
      {icon}<span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{name}</span>
      <span className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-bold text-gray-500 dark:bg-slate-800 dark:text-slate-400">{count}</span>
    </button>
  );
}

const TypePill = ({ kind }: { kind: "image" | "video" }) => (
  <span className={`inline-flex shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${kind === "video" ? "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300" : "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300"}`}>{kind === "video" ? "Video" : "Image"}</span>
);

function MediaTile({ item, active, selected, onPick, onToggle, menu }: { item: ProductMedia; active: boolean; selected: boolean; onPick: () => void; onToggle: () => void; menu: ReactNode }) {
  return (
    <div className={`group overflow-hidden rounded-xl border bg-white dark:bg-slate-950 ${active ? "border-[#1F8FE0] ring-2 ring-blue-100 dark:ring-blue-500/30" : "border-gray-200 dark:border-slate-700"}`}>
      <div className="relative aspect-[4/3] bg-gray-100 dark:bg-slate-900">
        <button type="button" onClick={onPick} className="!min-h-0 block h-full w-full" aria-label={`Details for ${item.name}`}>
          {item.thumbUrl ? <img src={item.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-gray-300">{item.kind === "video" ? <Video className="h-7 w-7" /> : <ImageIcon className="h-7 w-7" />}</span>}
          {item.kind === "video" && (
            <>
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-black/40"><span className="ml-0.5 h-0 w-0 border-y-[7px] border-l-[11px] border-y-transparent border-l-white" /></span></span>
              {item.durationSeconds ? <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10.5px] font-bold text-white">{formatDuration(item.durationSeconds)}</span> : null}
            </>
          )}
        </button>
        <label className="absolute left-1.5 top-1.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-white/95 shadow-sm dark:bg-slate-900/90">
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${item.name}`} className="h-3.5 w-3.5 accent-[#1F8FE0]" />
        </label>
        <div className="absolute right-1.5 top-1.5">{menu}</div>
        {item.isCover && <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-amber-400 px-1.5 py-0.5 text-[10px] font-black text-amber-950"><Star className="h-2.5 w-2.5" />Cover</span>}
      </div>
      <div className="space-y-1.5 px-2 pb-2 pt-1.5">
        <p className="m-0 truncate text-[12.5px] font-semibold text-gray-800 dark:text-slate-100">{item.name}</p>
        <div className="flex flex-wrap gap-1"><TypePill kind={item.kind} /><StatusPill status={item.status} /></div>
      </div>
    </div>
  );
}

function TileMenu({ item, canApprove, mine, onOpen, onApprove, onReject, onDelete, onCover }: { item: ProductMedia; canApprove: boolean; mine: boolean; onOpen: () => void; onApprove: () => void; onReject: () => void; onDelete: () => void; onCover: () => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={button} type="button" aria-label="More" onClick={() => setOpen((value) => !value)} className="!min-h-0 flex h-6 w-6 items-center justify-center rounded-md bg-white/95 text-gray-700 shadow-sm dark:bg-slate-900/90 dark:text-slate-200"><MoreHorizontal className="h-3.5 w-3.5" /></button>
      <PopoverMenu anchor={button.current} open={open} onClose={() => setOpen(false)} width={190}>
        <MenuItem icon={<Maximize2 />} disabled={!item.url} onClick={() => { setOpen(false); onOpen(); }}>Open full screen</MenuItem>
        {canApprove && item.status === "approved" && !item.isCover && <MenuItem icon={<Star />} onClick={() => { setOpen(false); onCover(); }}>Make cover</MenuItem>}
        {canApprove && item.status === "pending" && <MenuItem icon={<CheckCircle2 />} tone="success" onClick={() => { setOpen(false); onApprove(); }}>Approve</MenuItem>}
        {canApprove && item.status === "pending" && <MenuItem icon={<XCircle />} tone="danger" onClick={() => { setOpen(false); onReject(); }}>Reject</MenuItem>}
        {(canApprove || (mine && item.status !== "approved")) && <MenuItem icon={<Trash2 />} tone="danger" onClick={() => { setOpen(false); onDelete(); }}>Delete</MenuItem>}
      </PopoverMenu>
    </>
  );
}

function MediaDetails({ item, list, product, canApprove, mine, embedded, onSelect, onOpenViewer, onApprove, onReject, onDelete, onUpdate, onSetCover, onToast, onThumbnail }: {
  onThumbnail?: (item: ProductMedia, imageDataUrl: string) => Promise<void>;
  item: ProductMedia; list: ProductMedia[]; product: LibraryProduct | null; canApprove: boolean; mine: boolean; embedded?: boolean;
  onSelect: (item: ProductMedia) => void; onOpenViewer: (item: ProductMedia) => void; onApprove: (item: ProductMedia) => Promise<void>; onReject: (item: ProductMedia) => void;
  onDelete: (item: ProductMedia) => void; onUpdate: (item: ProductMedia, patch: { tags?: string[]; usage?: ProductMediaUsage[] }) => Promise<void>;
  onSetCover: (item: ProductMedia) => void; onToast: (message: string) => void;
}) {
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [pickingThumb, setPickingThumb] = useState(false);
  const actionsButton = useRef<HTMLButtonElement | null>(null);
  const index = Math.max(0, list.findIndex((entry) => entry.id === item.id));
  const canEditTags = canApprove || (mine && item.status === "pending");
  const fileName = fileNameFor(product?.name ?? "product", item.kind, item.mime, index);
  const addTag = async () => {
    const tag = (tagDraft ?? "").trim();
    setTagDraft(null);
    if (!tag || item.tags.includes(tag)) return;
    await onUpdate(item, { tags: [...item.tags, tag] });
  };
  const share = async () => {
    if (!item.url) return;
    try { const message = mediaResultMessage(await shareMediaFile(item.url, fileName)); if (message) onToast(message); }
    catch (error: any) { onToast(error?.message ?? "Could not share."); }
  };
  const download = async () => {
    if (!item.url) return;
    try { const message = mediaResultMessage(await saveMediaFile(item.url, fileName)); if (message && message !== mediaResultMessage("saved")) onToast(message); }
    catch (error: any) { onToast(error?.message ?? "Could not download."); }
  };
  return (
    <div className={embedded ? "space-y-4" : `${cardShell} space-y-4 p-3.5`}>
      <div className="relative aspect-square overflow-hidden rounded-xl bg-gray-100 dark:bg-slate-900">
        <button type="button" onClick={() => onOpenViewer(item)} disabled={!item.url} className="!min-h-0 block h-full w-full" aria-label="Open full screen">
          {item.kind === "video" && item.url ? <video src={item.url} poster={item.thumbUrl ?? undefined} controls playsInline preload="metadata" className="h-full w-full bg-black object-contain" onClick={(event) => event.stopPropagation()} />
            : item.thumbUrl || item.url ? <img src={item.url ?? item.thumbUrl ?? undefined} alt="" className="h-full w-full object-cover" /> : null}
        </button>
        {list.length > 1 && (
          <>
            <span className="absolute right-2 top-2 rounded-lg bg-black/60 px-2 py-0.5 text-[11.5px] font-bold text-white">{index + 1} / {list.length}</span>
            <button type="button" aria-label="Previous" onClick={() => onSelect(list[(index - 1 + list.length) % list.length])} className="!min-h-0 absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" aria-label="Next" onClick={() => onSelect(list[(index + 1) % list.length])} className="!min-h-0 absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow"><ChevronRight className="h-4 w-4" /></button>
          </>
        )}
      </div>
      <div className="flex items-start justify-between gap-2">
        <p className="m-0 min-w-0 break-words text-[15px] font-black text-gray-900 dark:text-slate-100">{item.name}</p>
        <StatusPill status={item.status} />
      </div>
      <dl className="m-0 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-2.5 text-[12.5px]">
        <dt className="text-gray-500">Product</dt>
        <dd className="m-0 flex min-w-0 items-center gap-2">
          {product?.thumbUrl ? <img src={product.thumbUrl} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" /> : null}
          <span className="min-w-0"><span className="block truncate font-semibold text-gray-900 dark:text-slate-100">{product?.name ?? "—"}</span><span className="block text-[11px] text-gray-400">SKU: {product?.sku ?? "—"}</span></span>
        </dd>
        <dt className="text-gray-500">Media type</dt><dd className="m-0 font-semibold text-gray-800 dark:text-slate-200">{item.kind === "video" ? "Video" : "Image"}</dd>
        <dt className="text-gray-500">File size</dt><dd className="m-0 font-semibold text-gray-800 dark:text-slate-200">{formatBytes(item.sizeBytes)}</dd>
        {item.width && item.height ? <><dt className="text-gray-500">Dimensions</dt><dd className="m-0 font-semibold text-gray-800 dark:text-slate-200">{item.width} × {item.height}</dd></> : null}
        {item.kind === "video" && item.durationSeconds ? <><dt className="text-gray-500">Duration</dt><dd className="m-0 font-semibold text-gray-800 dark:text-slate-200">{formatDuration(item.durationSeconds)}</dd></> : null}
        <dt className="text-gray-500">Uploaded by</dt>
        <dd className="m-0 flex items-center gap-2"><Avatar name={item.uploadedByName || "?"} size="h-6 w-6 text-[9px]" />
          <span><span className="block font-semibold text-gray-900 dark:text-slate-100">{item.uploadedByName || "Team"}</span><span className="block text-[11px] text-gray-400">{new Date(item.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</span></span>
        </dd>
      </dl>
      {item.status !== "approved" && item.rejectReason ? <p className="m-0 rounded-lg bg-rose-50 px-2.5 py-2 text-[12px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">Reason: {item.rejectReason}</p> : null}
      <div>
        <p className="m-0 mb-1.5 text-[12.5px] text-gray-500">Tags</p>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-md bg-gray-100 px-2 py-1 text-[11.5px] font-bold text-gray-600 dark:bg-slate-800 dark:text-slate-300">{item.labelText}</span>
          {item.tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[11.5px] font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
              {tag}{canEditTags && <button type="button" aria-label={`Remove ${tag}`} onClick={() => onUpdate(item, { tags: item.tags.filter((entry) => entry !== tag) })} className="!min-h-0"><X className="h-3 w-3" /></button>}
            </span>
          ))}
          {canEditTags && (tagDraft === null
            ? <button type="button" onClick={() => setTagDraft("")} className="!min-h-0 inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11.5px] font-bold text-gray-600 dark:border-slate-600 dark:text-slate-300"><Plus className="h-3 w-3" />Add tag</button>
            : <input autoFocus value={tagDraft} onChange={(event) => setTagDraft(event.target.value.slice(0, 24))} onBlur={addTag} onKeyDown={(event) => { if (event.key === "Enter") void addTag(); if (event.key === "Escape") setTagDraft(null); }}
                placeholder="Tag" className="h-7 w-24 rounded-md border border-gray-200 px-2 text-[12px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />)}
        </div>
      </div>
      <div>
        <p className="m-0 mb-1.5 text-[12.5px] text-gray-500">Usage</p>
        <div className="space-y-1.5">
          {USAGE_OPTIONS.map((option) => {
            const on = item.usage.includes(option.value);
            return (
              <label key={option.value} className={`flex items-center gap-2 text-[12.5px] ${canApprove ? "cursor-pointer" : ""} ${on ? "text-gray-800 dark:text-slate-200" : "text-gray-400"}`}>
                <input type="checkbox" checked={on} disabled={!canApprove} onChange={() => onUpdate(item, { usage: on ? item.usage.filter((value) => value !== option.value) : [...item.usage, option.value] })} className="h-3.5 w-3.5 accent-[#1F8FE0]" />{option.text}
              </label>
            );
          })}
        </div>
      </div>
      {canApprove && item.status === "pending" && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onReject(item)} className="!min-h-0 rounded-xl border border-rose-200 py-2.5 text-[13px] font-black text-rose-600 dark:border-rose-500/40">Reject</button>
          <button type="button" onClick={() => onApprove(item)} className="!min-h-0 rounded-xl bg-emerald-600 py-2.5 text-[13px] font-black text-white">Approve</button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={download} disabled={!item.url} className="!min-h-0 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-[13px] font-bold text-gray-800 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100"><Download className="h-4 w-4" />Download</button>
        <button ref={actionsButton} type="button" onClick={() => {
          // Fetch the file now, so "Share" can open the share sheet inside the tap.
          if (!actionsOpen && item.url) void prefetchMediaFile(item.url, fileName).catch(() => undefined);
          setActionsOpen((value) => !value);
        }} className="!min-h-0 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-[13px] font-bold text-gray-800 dark:border-slate-600 dark:text-slate-100">Actions <ChevronDown className="h-4 w-4" /></button>
      </div>
      <PopoverMenu anchor={actionsButton.current} open={actionsOpen} onClose={() => setActionsOpen(false)} width={200}>
        <MenuItem icon={<Share2 />} disabled={!item.url} onClick={() => { setActionsOpen(false); void share(); }}>Share (WhatsApp)</MenuItem>
        <MenuItem icon={<Maximize2 />} disabled={!item.url} onClick={() => { setActionsOpen(false); onOpenViewer(item); }}>Open full screen</MenuItem>
        {canApprove && item.status === "approved" && !item.isCover && <MenuItem icon={<Star />} onClick={() => { setActionsOpen(false); onSetCover(item); }}>Make cover</MenuItem>}
        {canEditTags && item.kind === "video" && onThumbnail && <MenuItem icon={<ImageIcon />} onClick={() => { setActionsOpen(false); setPickingThumb(true); }}>Change thumbnail</MenuItem>}
        {canEditTags && <MenuItem icon={<Tag />} onClick={() => { setActionsOpen(false); setTagDraft(""); }}>Add tag</MenuItem>}
        {(canApprove || (mine && item.status !== "approved")) && <MenuItem icon={<Trash2 />} tone="danger" onClick={() => { setActionsOpen(false); onDelete(item); }}>Delete</MenuItem>}
      </PopoverMenu>
      {pickingThumb && onThumbnail && <ThumbnailPicker item={item} onClose={() => setPickingThumb(false)} onSave={(dataUrl) => onThumbnail(item, dataUrl)} />}
    </div>
  );
}
