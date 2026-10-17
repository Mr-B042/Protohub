import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, Eye, Filter, Inbox, Loader2, MessageSquare, MoreVertical,
  RefreshCw, Search, ShieldCheck, Trash2, Users, XCircle
} from "lucide-react";
import type { ProductMedia } from "../../lib/api";
import { formatBytes, formatDuration, timeAgo } from "../../lib/media-upload";
import { MiniStat } from "./MediaLibrary";
import { Avatar, MenuItem, PopoverMenu, Sheet, StatusPill, cardShell } from "./shared";

// Approval Queue (Bright's design, 17 Oct 2026). Files sent together are one
// row (a "submission"); Approve / Reject on the row act on the whole
// submission, the preview panel on one file at a time.

type Submission = { key: string; files: ProductMedia[]; first: ProductMedia };

export type QueueProduct = { id: string; name: string; sku: string; thumbUrl: string | null };

const isToday = (iso: string | null, daysAgo = 0) => {
  if (!iso) return false;
  const day = new Date(); day.setDate(day.getDate() - daysAgo);
  return new Date(iso).toDateString() === day.toDateString();
};
const typeLabel = (item: ProductMedia) => {
  const ext = item.kind === "image" ? (item.mime.includes("png") ? "PNG" : item.mime.includes("webp") ? "WEBP" : "JPG") : item.mime.includes("quicktime") ? "MOV" : item.mime.includes("webm") ? "WEBM" : "MP4";
  return item.kind === "video" ? `Video (${ext})` : `Image (${ext})`;
};

export function ApprovalQueue({ media, products, canApprove, currentUserId, onApprove, onApproveMany, onReject, onRequestChanges, onDelete, onRescan, onOpen }: {
  media: ProductMedia[];
  products: QueueProduct[];
  canApprove: boolean;
  currentUserId: string;
  onApprove: (item: ProductMedia) => Promise<void>;
  onApproveMany: (items: ProductMedia[]) => Promise<void>;
  onReject: (items: ProductMedia[]) => void;
  onRequestChanges: (item: ProductMedia) => void;
  onDelete: (item: ProductMedia) => void;
  onRescan: (item: ProductMedia) => Promise<void>;
  onOpen: (item: ProductMedia) => void;
}) {
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [kind, setKind] = useState<"" | "image" | "video">("");
  const [uploader, setUploader] = useState("");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [view, setView] = useState<"pending" | "reviewed">("pending");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [previewId, setPreviewId] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const filtersButton = useRef<HTMLButtonElement | null>(null);

  const productOf = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  // Waiting and reviewed files; approved ones only when someone else approved
  // them (an approver's own uploads go straight in and never queued).
  const mineOnly = useMemo(() => media.filter((item) => item.status === "approved" ? item.reviewedBy !== item.uploadedBy : item.status !== "uploading")
    .filter((item) => canApprove || item.uploadedBy === currentUserId), [media, canApprove, currentUserId]);

  const pendingFiles = mineOnly.filter((item) => item.status === "pending");
  const stats = {
    pending: pendingFiles.length,
    approvedToday: mineOnly.filter((item) => item.status === "approved" && isToday(item.reviewedAt)).length,
    approvedYesterday: mineOnly.filter((item) => item.status === "approved" && isToday(item.reviewedAt, 1)).length,
    rejectedToday: mineOnly.filter((item) => (item.status === "rejected" || item.status === "changes_requested") && isToday(item.reviewedAt)).length,
    submissions: new Set(pendingFiles.map((item) => item.batchId ?? item.id)).size,
    senders: new Set(pendingFiles.map((item) => item.uploadedBy)).size
  };
  const change = stats.approvedYesterday > 0 ? Math.round(((stats.approvedToday - stats.approvedYesterday) / stats.approvedYesterday) * 100) : null;

  const uploaders = Array.from(new Map(mineOnly.map((item) => [item.uploadedBy ?? "", item.uploadedByName || "Team"])).entries());
  const needle = search.trim().toLowerCase();
  const submissions = useMemo<Submission[]>(() => {
    const rows = mineOnly
      .filter((item) => view === "pending" ? item.status === "pending" : item.status !== "pending")
      .filter((item) => (!productId || item.productId === productId) && (!kind || item.kind === kind) && (!uploader || item.uploadedBy === uploader))
      .filter((item) => !needle || `${item.name} ${productOf.get(item.productId)?.name ?? ""} ${item.uploadedByName} ${item.caption} ${item.tags.join(" ")}`.toLowerCase().includes(needle));
    const groups = new Map<string, ProductMedia[]>();
    for (const item of rows) {
      const key = `${item.batchId ?? item.id}|${item.productId}|${view === "pending" ? "p" : item.status}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return Array.from(groups.entries()).map(([key, files]) => {
      const sorted = files.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { key, files: sorted, first: sorted[0] };
    }).sort((a, b) => order === "oldest" ? a.first.createdAt.localeCompare(b.first.createdAt) : b.first.createdAt.localeCompare(a.first.createdAt)).slice(0, 80);
  }, [mineOnly, view, productId, kind, uploader, needle, order, productOf]);

  const flat = submissions.flatMap((row) => row.files);
  const selected = submissions.find((row) => row.key === selectedKey) ?? submissions[0] ?? null;
  const preview = flat.find((item) => item.id === previewId) ?? selected?.first ?? null;
  const previewIndex = preview ? flat.findIndex((item) => item.id === preview.id) : -1;

  const choose = (row: Submission, file?: ProductMedia) => {
    setSelectedKey(row.key);
    setPreviewId((file ?? row.first).id);
    if (window.matchMedia("(max-width: 1279px)").matches) setSheetOpen(true);
  };
  const approveRow = async (row: Submission) => {
    setBusy(row.key);
    try { await onApproveMany(row.files.filter((item) => item.status === "pending")); } finally { setBusy(""); }
  };
  const tickedRows = submissions.filter((row) => ticked.has(row.key));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat icon={<Clock3 className="h-5 w-5" />} tone="bg-amber-50 text-amber-500 dark:bg-amber-500/15" value={stats.pending} label="Pending Approval" sub={canApprove ? "Needs your review" : "Waiting for review"} onClick={() => setView("pending")} />
        <MiniStat icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15" value={stats.approvedToday} label="Approved Today"
          hint={change !== null && change > 0 ? `+${change}% from yesterday` : undefined} sub={change !== null && change <= 0 ? `${change}% from yesterday` : change === null ? "Nothing approved yesterday" : undefined} onClick={() => setView("reviewed")} />
        <MiniStat icon={<XCircle className="h-5 w-5" />} tone="bg-rose-50 text-rose-500 dark:bg-rose-500/15" value={stats.rejectedToday} label="Rejected Today" sub="with feedback" onClick={() => setView("reviewed")} />
        <MiniStat icon={<Users className="h-5 w-5" />} tone="bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15" value={stats.submissions} label="Pending Submissions" sub={`From ${stats.senders} ${stats.senders === 1 ? "person" : "people"}`} />
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative block min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search media, product, or uploader..."
            className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-[14px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <QueuePicker value={productId} onChange={setProductId} label="Product"><option value="">All Products</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</QueuePicker>
          <QueuePicker value={kind} onChange={(value) => setKind(value as "" | "image" | "video")} label="Media type"><option value="">All Media Types</option><option value="image">Images</option><option value="video">Videos</option></QueuePicker>
          {canApprove && <QueuePicker value={uploader} onChange={setUploader} label="Uploader"><option value="">All Uploaders</option>{uploaders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</QueuePicker>}
          <QueuePicker value={order} onChange={(value) => setOrder(value as "newest" | "oldest")} label="Order"><option value="newest">Newest First</option><option value="oldest">Oldest First</option></QueuePicker>
          <button ref={filtersButton} type="button" onClick={() => setFiltersOpen((value) => !value)}
            className={`!min-h-0 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-bold ${view === "reviewed" ? "border-[#1F8FE0] bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15" : "border-gray-200 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"}`}>
            <Filter className="h-4 w-4" />Filters
          </button>
        </div>
      </div>
      <PopoverMenu anchor={filtersButton.current} open={filtersOpen} onClose={() => setFiltersOpen(false)} width={220}>
        <p className="m-0 px-3.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">Show</p>
        <MenuItem icon={view === "pending" ? <Check /> : <span className="block h-4 w-4" />} onClick={() => { setView("pending"); setFiltersOpen(false); }}>Waiting for approval</MenuItem>
        <MenuItem icon={view === "reviewed" ? <Check /> : <span className="block h-4 w-4" />} onClick={() => { setView("reviewed"); setFiltersOpen(false); }}>Already reviewed (30 days)</MenuItem>
      </PopoverMenu>

      {canApprove && tickedRows.length > 0 && view === "pending" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-[13px] font-bold text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
          {tickedRows.length} selected
          <button type="button" onClick={async () => { await onApproveMany(tickedRows.flatMap((row) => row.files)); setTicked(new Set()); }} className="!min-h-0 rounded-lg bg-emerald-600 px-3 py-1 text-[12px] font-black text-white">Approve all</button>
          <button type="button" onClick={() => { onReject(tickedRows.flatMap((row) => row.files)); setTicked(new Set()); }} className="!min-h-0 rounded-lg bg-white px-3 py-1 text-[12px] font-black text-rose-600 dark:bg-slate-900">Reject all</button>
          <button type="button" onClick={() => setTicked(new Set())} className="!min-h-0 ml-auto text-[12px]">Clear</button>
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_19.5rem]">
        <div className="space-y-3">
          {submissions.length === 0 && (
            <div className={`${cardShell} flex flex-col items-center gap-2 px-6 py-12 text-center`}>
              <Inbox className="h-10 w-10 text-gray-300" />
              <p className="m-0 text-sm font-black text-gray-700 dark:text-slate-200">{view === "pending" ? (canApprove ? "All caught up" : "Nothing waiting") : "Nothing reviewed yet"}</p>
              <p className="m-0 max-w-sm text-[13px] text-gray-500">{view === "pending" ? (canApprove ? "New photos and videos from the team appear here. You also get a notification." : "Files you send appear here until an Owner, Admin or Manager reviews them.") : "Reviewed files from the last 30 days show here."}</p>
            </div>
          )}
          {submissions.map((row) => {
            const product = productOf.get(row.first.productId);
            const isSelected = selected?.key === row.key;
            const pendingInRow = row.files.filter((item) => item.status === "pending");
            return (
              <article key={row.key} className={`rounded-2xl border bg-white p-3 shadow-sm sm:p-4 dark:bg-[#0c1722] ${isSelected ? "border-[#1F8FE0] bg-blue-50/30 ring-1 ring-blue-200 dark:ring-blue-500/30" : "border-gray-200/80 dark:border-slate-700"}`}>
                <div className="flex flex-col gap-3 lg:flex-row">
                  <div className="flex items-start gap-3 lg:w-[30%] lg:shrink-0">
                    {canApprove && view === "pending" && (
                      <input type="checkbox" checked={ticked.has(row.key)} onChange={() => setTicked((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}
                        aria-label="Select submission" className="mt-1 h-4 w-4 shrink-0 accent-[#1F8FE0]" />
                    )}
                    <div className="flex shrink-0 flex-col items-center gap-1 text-center">
                      <Avatar name={row.first.uploadedByName || "?"} size="h-10 w-10 text-[13px]" />
                      <span className="max-w-[5rem] truncate text-[12px] font-bold text-gray-800 dark:text-slate-100">{row.first.uploadedByName || "Team"}</span>
                      <span className="text-[10.5px] text-gray-400">{timeAgo(row.first.createdAt)}</span>
                    </div>
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-slate-800">{product?.thumbUrl ? <img src={product.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}</span>
                      <span className="min-w-0"><span className="block text-[13.5px] font-black leading-tight text-gray-900 dark:text-slate-100">{product?.name ?? "Product"}</span><span className="block text-[11.5px] text-gray-400">SKU: {product?.sku ?? "—"}</span></span>
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="grid grid-cols-4 gap-1.5 sm:max-w-[22rem]">
                      {row.files.slice(0, row.files.length > 4 ? 3 : 4).map((item) => (
                        <button key={item.id} type="button" onClick={() => choose(row, item)} aria-label={`Preview ${item.name}`}
                          className={`!min-h-0 relative aspect-[4/3] overflow-hidden rounded-lg bg-gray-100 dark:bg-slate-800 ${preview?.id === item.id ? "ring-2 ring-[#1F8FE0]" : ""}`}>
                          {item.thumbUrl ? <img src={item.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                          {item.kind === "video" && <span className="absolute inset-0 flex items-center justify-center bg-black/20"><span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-black/40"><span className="ml-0.5 h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-white" /></span></span>}
                          {item.kind === "video" && item.durationSeconds ? <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] font-bold text-white">{formatDuration(item.durationSeconds)}</span> : null}
                        </button>
                      ))}
                      {row.files.length > 4 && (
                        <button type="button" onClick={() => choose(row, row.files[3])} className="!min-h-0 relative aspect-[4/3] overflow-hidden rounded-lg bg-slate-800">
                          {row.files[3].thumbUrl ? <img src={row.files[3].thumbUrl} alt="" className="h-full w-full object-cover opacity-50" /> : null}
                          <span className="absolute inset-0 flex items-center justify-center text-base font-black text-white">+{row.files.length - 3}</span>
                        </button>
                      )}
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-[13px] font-bold text-gray-900 dark:text-slate-100">{row.first.name}{row.files.length > 1 ? <span className="font-semibold text-gray-400"> +{row.files.length - 1} more</span> : null}</p>
                        <p className="m-0 text-[11.5px] text-gray-500">{typeLabel(row.first).replace(/^(Video|Image) \((\w+)\)$/, "$2")} • {formatBytes(row.first.sizeBytes)}{row.first.kind === "video" && row.first.durationSeconds ? ` • ${formatDuration(row.first.durationSeconds)}` : row.first.width ? ` • ${row.first.width} × ${row.first.height}` : ""}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <span className={`rounded-md px-2 py-0.5 text-[10.5px] font-bold ${row.first.kind === "video" ? "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300" : "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300"}`}>{row.first.kind === "video" ? "Video" : "Image"}</span>
                          <span className="rounded-md bg-pink-50 px-2 py-0.5 text-[10.5px] font-bold text-pink-600 dark:bg-pink-500/15 dark:text-pink-300">{row.first.labelText}</span>
                          {row.first.tags.slice(0, 2).map((tag) => <span key={tag} className="rounded-md bg-blue-50 px-2 py-0.5 text-[10.5px] font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">{tag}</span>)}
                        </div>
                      </div>
                      <div className="min-w-0 text-[12px]">
                        {view === "reviewed" ? (
                          <><p className="m-0 font-bold text-gray-700 dark:text-slate-200"><StatusPill status={row.first.status} /></p>
                            {row.first.rejectReason ? <p className="m-0 mt-1 text-gray-500">{row.first.status === "changes_requested" ? "Asked to change" : "Reason"}: {row.first.rejectReason}</p> : null}
                            {row.first.reviewedByName ? <p className="m-0 mt-0.5 text-[11px] text-gray-400">by {row.first.reviewedByName} · {timeAgo(row.first.reviewedAt ?? row.first.createdAt)}</p> : null}</>
                        ) : (
                          <><p className="m-0 font-bold text-gray-700 dark:text-slate-200">Note from uploader:</p>
                            <p className="m-0 mt-0.5 line-clamp-3 text-gray-500 dark:text-slate-400">{row.first.caption || "No note."}</p></>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2 lg:w-[9.5rem] lg:flex-col">
                    {canApprove && view === "pending" ? (
                      <>
                        <button type="button" disabled={busy === row.key} onClick={() => approveRow(row)}
                          className="!min-h-0 inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#1F8FE0] px-3 py-2 text-[13px] font-bold text-white disabled:opacity-60 lg:flex-none">
                          {busy === row.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve{pendingInRow.length > 1 ? ` ${pendingInRow.length}` : ""}
                        </button>
                        <button type="button" onClick={() => onReject(pendingInRow)} className="!min-h-0 inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-[13px] font-bold text-rose-600 hover:bg-rose-50 lg:flex-none dark:border-rose-500/40 dark:hover:bg-rose-500/10"><XCircle className="h-4 w-4" />Reject</button>
                      </>
                    ) : null}
                    <button type="button" onClick={() => choose(row)} className="!min-h-0 inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700 hover:bg-gray-50 lg:flex-none dark:border-slate-600 dark:text-slate-200"><Eye className="h-4 w-4" />Preview</button>
                    <RowMenu row={row} canApprove={canApprove} mine={row.first.uploadedBy === currentUserId} onRequestChanges={() => onRequestChanges(row.first)} onDelete={() => row.files.forEach((item) => onDelete(item))} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="hidden xl:block">
          {preview ? (
            <PreviewPanel item={preview} product={productOf.get(preview.productId) ?? null} index={previewIndex} total={flat.length}
              onStep={(step) => { const next = flat[(previewIndex + step + flat.length) % flat.length]; if (next) { setPreviewId(next.id); const row = submissions.find((entry) => entry.files.some((file) => file.id === next.id)); if (row) setSelectedKey(row.key); } }}
              canApprove={canApprove} onApprove={onApprove} onReject={(item) => onReject([item])} onRequestChanges={onRequestChanges} onRescan={onRescan} onOpen={onOpen} />
          ) : <div className={`${cardShell} p-6 text-center text-[13px] text-gray-400`}>Pick a submission to preview it.</div>}
        </aside>
      </div>

      {sheetOpen && preview && (
        <Sheet title="Media Preview" subtitle={productOf.get(preview.productId)?.name} onClose={() => setSheetOpen(false)}>
          <PreviewPanel embedded item={preview} product={productOf.get(preview.productId) ?? null} index={previewIndex} total={flat.length}
            onStep={(step) => { const next = flat[(previewIndex + step + flat.length) % flat.length]; if (next) setPreviewId(next.id); }}
            canApprove={canApprove} onApprove={async (item) => { await onApprove(item); }} onReject={(item) => { setSheetOpen(false); onReject([item]); }}
            onRequestChanges={(item) => { setSheetOpen(false); onRequestChanges(item); }} onRescan={onRescan} onOpen={onOpen} />
        </Sheet>
      )}
    </div>
  );
}

function QueuePicker({ value, onChange, label, children }: { value: string; onChange: (value: string) => void; label: string; children: ReactNode }) {
  return (
    <span className="relative block shrink-0">
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}
        className="h-11 appearance-none rounded-xl border border-gray-200 bg-white pl-3.5 pr-9 text-[13px] font-semibold text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200">{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    </span>
  );
}

function RowMenu({ row, canApprove, mine, onRequestChanges, onDelete }: { row: Submission; canApprove: boolean; mine: boolean; onRequestChanges: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const pending = row.first.status === "pending";
  if (!canApprove && !(mine && row.first.status !== "approved")) return null;
  return (
    <>
      <button ref={button} type="button" aria-label="More" onClick={() => setOpen((value) => !value)}
        className="!min-h-0 inline-flex items-center justify-center rounded-xl border border-gray-200 px-2.5 py-2 text-gray-500 hover:bg-gray-50 lg:self-end lg:border-0 lg:p-1.5 dark:border-slate-600 dark:hover:bg-slate-800"><MoreVertical className="h-4 w-4" /></button>
      <PopoverMenu anchor={button.current} open={open} onClose={() => setOpen(false)} width={200}>
        {canApprove && pending && <MenuItem icon={<MessageSquare />} onClick={() => { setOpen(false); onRequestChanges(); }}>Request changes</MenuItem>}
        {(canApprove || mine) && <MenuItem icon={<Trash2 />} tone="danger" onClick={() => { setOpen(false); onDelete(); }}>{mine && !canApprove ? "Withdraw" : "Delete"}</MenuItem>}
      </PopoverMenu>
    </>
  );
}

function PreviewPanel({ item, product, index, total, onStep, canApprove, onApprove, onReject, onRequestChanges, onRescan, onOpen, embedded }: {
  item: ProductMedia; product: QueueProduct | null; index: number; total: number; onStep: (step: number) => void; canApprove: boolean;
  onApprove: (item: ProductMedia) => Promise<void>; onReject: (item: ProductMedia) => void; onRequestChanges: (item: ProductMedia) => void;
  onRescan: (item: ProductMedia) => Promise<void>; onOpen: (item: ProductMedia) => void; embedded?: boolean;
}) {
  const [busy, setBusy] = useState<"" | "approve" | "scan">("");
  const scan = item.scan ?? {};
  const pending = item.status === "pending";
  return (
    <div className="space-y-3">
      <section className={embedded ? "space-y-3" : `${cardShell} space-y-3 p-3.5`}>
        <div className="flex items-center justify-between gap-2">
          {!embedded && <h2 className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-100">Media Preview</h2>}
          {total > 1 && (
            <div className="ml-auto flex items-center gap-1.5 text-[12px] font-semibold text-gray-500">
              {index + 1} of {total}
              <button type="button" aria-label="Previous" onClick={() => onStep(-1)} className="!min-h-0 rounded-lg border border-gray-200 p-1.5 dark:border-slate-600"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" aria-label="Next" onClick={() => onStep(1)} className="!min-h-0 rounded-lg border border-gray-200 p-1.5 dark:border-slate-600"><ChevronRight className="h-4 w-4" /></button>
            </div>
          )}
        </div>
        <div className="aspect-video overflow-hidden rounded-xl bg-black">
          {item.kind === "video" && item.url ? <video key={item.id} src={item.url} poster={item.thumbUrl ?? undefined} controls playsInline preload="metadata" className="h-full w-full object-contain" />
            : item.url || item.thumbUrl ? <button type="button" onClick={() => onOpen(item)} className="!min-h-0 h-full w-full"><img src={item.url ?? item.thumbUrl ?? undefined} alt="" className="h-full w-full object-contain" /></button>
            : <span className="flex h-full items-center justify-center text-[12px] text-white/60">File removed after review</span>}
        </div>
        <div className="flex items-start justify-between gap-2">
          <p className="m-0 min-w-0 break-words text-[14px] font-black text-gray-900 dark:text-slate-100">{item.name}</p>
          {pending ? <span className="shrink-0 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Pending Approval</span> : <StatusPill status={item.status} />}
        </div>
        <dl className="m-0 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 gap-y-2 text-[12.5px]">
          <dt className="text-gray-500">Uploaded by</dt>
          <dd className="m-0 flex items-center gap-2"><Avatar name={item.uploadedByName || "?"} size="h-7 w-7 text-[10px]" /><span><span className="block font-semibold text-gray-900 dark:text-slate-100">{item.uploadedByName || "Team"}</span><span className="block text-[11px] text-gray-400">{new Date(item.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</span></span></dd>
          <dt className="text-gray-500">Product</dt>
          <dd className="m-0 flex min-w-0 items-center gap-2">{product?.thumbUrl ? <img src={product.thumbUrl} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" /> : null}<span className="min-w-0"><span className="block truncate font-semibold text-gray-900 dark:text-slate-100">{product?.name ?? "—"}</span><span className="block text-[11px] text-gray-400">SKU: {product?.sku ?? "—"}</span></span></dd>
          <dt className="text-gray-500">Media type</dt><dd className="m-0 text-gray-800 dark:text-slate-200">{typeLabel(item)}</dd>
          <dt className="text-gray-500">File size</dt><dd className="m-0 text-gray-800 dark:text-slate-200">{formatBytes(item.sizeBytes)}</dd>
          {item.width ? <><dt className="text-gray-500">Dimensions</dt><dd className="m-0 text-gray-800 dark:text-slate-200">{item.width} × {item.height}</dd></> : null}
          {item.kind === "video" && item.durationSeconds ? <><dt className="text-gray-500">Duration</dt><dd className="m-0 text-gray-800 dark:text-slate-200">{formatDuration(item.durationSeconds)}</dd></> : null}
          <dt className="text-gray-500">Tags</dt>
          <dd className="m-0 flex flex-wrap gap-1"><span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">{item.labelText}</span>{item.tags.map((tag) => <span key={tag} className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">{tag}</span>)}</dd>
        </dl>
        <div className="rounded-xl border border-gray-100 p-3 dark:border-slate-800">
          <p className="m-0 text-[12px] font-bold text-gray-700 dark:text-slate-200">Note from uploader</p>
          <p className="m-0 mt-1 text-[12.5px] text-gray-600 dark:text-slate-400">{item.caption || "No note."}</p>
        </div>
      </section>

      <section className={embedded ? "space-y-3 rounded-xl border border-gray-100 p-3 dark:border-slate-800" : `${cardShell} space-y-3 p-3.5`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${scan.passed ? "bg-emerald-500 text-white" : "bg-gray-200 text-gray-500"}`}><ShieldCheck className="h-5 w-5" /></span>
            <div>
              <p className="m-0 text-[13px] font-black text-gray-900 dark:text-slate-100">Safety Check</p>
              {scan.passed ? <span className="mt-0.5 inline-block rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Passed</span> : <span className="mt-0.5 inline-block text-[11px] text-gray-400">No record</span>}
              {scan.passed && <p className="m-0 mt-0.5 text-[11px] text-gray-500">Real {item.kind === "video" ? "video" : "photo"}; nothing harmful found.</p>}
            </div>
          </div>
          {canApprove && pending && (
            <button type="button" disabled={busy === "scan"} onClick={async () => { setBusy("scan"); try { await onRescan(item); } finally { setBusy(""); } }}
              className="!min-h-0 inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] font-bold text-gray-700 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200">
              {busy === "scan" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Check again
            </button>
          )}
        </div>
        {scan.passed && (
          <ul className="m-0 list-none space-y-1.5 p-0 text-[12px]">
            {([["File type", scan.fileType], ["File size", scan.fileSize], ["Content check", scan.contentCheck], ["Suspicious code", scan.suspiciousCode]] as const).map(([label, value]) => (
              <li key={label} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-2">
                <span className="flex items-center gap-1.5 text-gray-600 dark:text-slate-300"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />{label}</span>
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">{value ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
        {canApprove && pending && (
          <>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
              <button type="button" disabled={busy === "approve"} onClick={async () => { setBusy("approve"); try { await onApprove(item); } finally { setBusy(""); } }}
                className="!min-h-0 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#1F8FE0] py-2.5 text-[13px] font-black text-white disabled:opacity-60">
                {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Approve &amp; Publish
              </button>
              <button type="button" onClick={() => onReject(item)} className="!min-h-0 rounded-xl border border-rose-200 py-2.5 text-[13px] font-bold text-rose-600 dark:border-rose-500/40">Reject</button>
            </div>
            <button type="button" onClick={() => onRequestChanges(item)} className="!min-h-0 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-[13px] font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200"><MessageSquare className="h-4 w-4" />Request Changes</button>
          </>
        )}
      </section>
    </div>
  );
}
