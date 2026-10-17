import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Share2, Star, Trash2, X, ZoomIn } from "lucide-react";
import type { ProductMedia } from "../../lib/api";
import { fileNameFor, formatDuration, saveMediaFile, shareMediaFile, timeAgo } from "../../lib/media-upload";

// Full-screen gallery: swipe between photos and videos (native scroll-snap, so
// it feels like the phone's own gallery), double-tap a photo to zoom, Share
// hands the file to WhatsApp through the phone's share sheet.

export type GalleryItem = {
  key: string;
  kind: "image" | "video";
  url: string;
  thumbUrl: string | null;
  labelText: string;
  caption: string;
  byline: string;
  durationSeconds: number | null;
  media: ProductMedia | null; // null = a package picture from the product setup
};

export function galleryItemsFor(media: ProductMedia[], packageImages: string[]): GalleryItem[] {
  const approved = media
    .filter((item) => item.status === "approved" && item.url)
    .sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.displayOrder - b.displayOrder || b.createdAt.localeCompare(a.createdAt));
  const items: GalleryItem[] = approved.map((item) => ({
    key: item.id, kind: item.kind, url: item.url!, thumbUrl: item.thumbUrl, labelText: item.labelText, caption: item.caption,
    byline: `${item.uploadedByName || "Team"} · ${timeAgo(item.createdAt)}`, durationSeconds: item.durationSeconds, media: item
  }));
  const seen = new Set(items.map((item) => item.url));
  for (const url of packageImages) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({ key: `pkg-${url}`, kind: "image", url, thumbUrl: url, labelText: "Package photo", caption: "", byline: "From the product setup", durationSeconds: null, media: null });
  }
  return items;
}

export function MediaViewer({ productName, items, startIndex, onClose, canManage, onSetCover, onDelete, onToast }: {
  productName: string;
  items: GalleryItem[];
  startIndex: number;
  onClose: () => void;
  canManage: boolean;
  onSetCover: (media: ProductMedia) => void;
  onDelete: (media: ProductMedia) => void;
  onToast: (message: string) => void;
}) {
  const [index, setIndex] = useState(Math.min(Math.max(0, startIndex), Math.max(0, items.length - 1)));
  const [zoomed, setZoomed] = useState(false);
  const [busy, setBusy] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const lastTap = useRef(0);
  const current = items[index];

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const track = trackRef.current;
    if (track) track.scrollLeft = track.clientWidth * index;
    return () => { document.body.style.overflow = previous; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (zoomed) setZoomed(false); else onClose(); }
      if (event.key === "ArrowRight") go(index + 1);
      if (event.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Only the slide in view plays; leaving a video pauses it.
  useEffect(() => {
    trackRef.current?.querySelectorAll("video").forEach((video, videoIndex) => {
      if (Number(video.dataset.index) !== index) video.pause();
      void videoIndex;
    });
    setZoomed(false);
  }, [index]);

  const go = (next: number) => {
    const target = Math.min(Math.max(0, next), items.length - 1);
    const track = trackRef.current;
    if (track) track.scrollTo({ left: track.clientWidth * target, behavior: "smooth" });
    setIndex(target);
  };
  const onScroll = () => {
    const track = trackRef.current;
    if (!track || zoomed) return;
    const next = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (next !== index) setIndex(next);
  };
  const onTapImage = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) setZoomed((value) => !value);
    lastTap.current = now;
  };

  const fileName = current ? fileNameFor(productName, current.kind, current.media?.mime ?? "image/jpeg", index) : "file";
  const share = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const result = await shareMediaFile(current.url, fileName, `${productName}${current.caption ? ` - ${current.caption}` : ""}`);
      if (result === "saved") onToast("Saved to your phone. Send it from WhatsApp.");
    } catch (error: any) { onToast(error?.message ?? "Could not share this file."); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!current) return;
    setBusy(true);
    try { await saveMediaFile(current.url, fileName); onToast("Saved."); }
    catch (error: any) { onToast(error?.message ?? "Could not save this file."); }
    finally { setBusy(false); }
  };

  if (!current) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={`${productName} gallery`}>
      <header className="flex shrink-0 items-center gap-3 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" aria-label="Close gallery" onClick={onClose} className="!min-h-0 rounded-full bg-white/10 p-2.5 hover:bg-white/20"><X className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[15px] font-black">{productName}</p>
          <p className="m-0 text-xs font-semibold text-white/60">{index + 1} of {items.length}</p>
        </div>
        {current.kind === "image" && (
          <button type="button" aria-label={zoomed ? "Zoom out" : "Zoom in"} onClick={() => setZoomed((value) => !value)} className="!min-h-0 hidden rounded-full bg-white/10 p-2.5 hover:bg-white/20 sm:inline-flex"><ZoomIn className="h-5 w-5" /></button>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={trackRef} onScroll={onScroll}
          className={`flex h-full w-full snap-x snap-mandatory overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${zoomed ? "overflow-x-hidden" : "overflow-x-auto"}`}>
          {items.map((item, itemIndex) => (
            <div key={item.key} className="flex h-full w-full shrink-0 snap-center items-center justify-center">
              {item.kind === "video" ? (
                <video data-index={itemIndex} src={Math.abs(itemIndex - index) <= 1 ? item.url : undefined} poster={item.thumbUrl ?? undefined}
                  controls playsInline preload="metadata" className="max-h-full max-w-full" />
              ) : zoomed && itemIndex === index ? (
                <div className="h-full w-full overflow-auto overscroll-contain" onClick={onTapImage}>
                  <img src={item.url} alt={item.caption || productName} className="max-w-none" style={{ width: "250%" }} />
                </div>
              ) : (
                <img src={Math.abs(itemIndex - index) <= 2 ? item.url : item.thumbUrl ?? undefined} alt={item.caption || productName}
                  onClick={onTapImage} draggable={false} className="max-h-full max-w-full select-none object-contain" />
              )}
            </div>
          ))}
        </div>
        {index > 0 && (
          <button type="button" aria-label="Previous" onClick={() => go(index - 1)}
            className="!min-h-0 absolute left-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/15 p-3 backdrop-blur hover:bg-white/25 sm:inline-flex"><ChevronLeft className="h-6 w-6" /></button>
        )}
        {index < items.length - 1 && (
          <button type="button" aria-label="Next" onClick={() => go(index + 1)}
            className="!min-h-0 absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/15 p-3 backdrop-blur hover:bg-white/25 sm:inline-flex"><ChevronRight className="h-6 w-6" /></button>
        )}
      </div>

      <footer className="shrink-0 space-y-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-white/15 px-2.5 py-1 font-bold">{current.labelText}</span>
          {current.media?.isCover && <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-1 font-bold text-amber-200"><Star className="h-3 w-3" />Cover</span>}
          {current.kind === "video" && current.durationSeconds ? <span className="font-semibold text-white/60">{formatDuration(current.durationSeconds)}</span> : null}
          <span className="font-semibold text-white/50">{current.byline}</span>
        </div>
        {current.caption ? <p className="m-0 text-sm leading-snug text-white/85">{current.caption}</p> : null}
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={share}
            className="!min-h-0 inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-black text-white disabled:opacity-60">
            <Share2 className="h-4 w-4" />Share
          </button>
          <button type="button" disabled={busy} onClick={save} aria-label="Save to phone"
            className="!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-bold hover:bg-white/20 disabled:opacity-60">
            <Download className="h-4 w-4" /><span className="hidden sm:inline">Save</span>
          </button>
          {canManage && current.media && (
            <>
              {!current.media.isCover && (
                <button type="button" onClick={() => onSetCover(current.media!)} aria-label="Make cover picture"
                  className="!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-bold hover:bg-white/20">
                  <Star className="h-4 w-4" /><span className="hidden sm:inline">Make cover</span>
                </button>
              )}
              <button type="button" onClick={() => onDelete(current.media!)} aria-label="Delete"
                className="!min-h-0 inline-flex items-center justify-center rounded-xl bg-white/10 px-4 py-3 text-rose-300 hover:bg-rose-500/20"><Trash2 className="h-4 w-4" /></button>
            </>
          )}
        </div>
        {items.length > 1 && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {items.map((item, itemIndex) => (
              <button key={item.key} type="button" onClick={() => go(itemIndex)} aria-label={`Show ${itemIndex + 1}`}
                className={`!min-h-0 relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 ${itemIndex === index ? "border-white" : "border-transparent opacity-60"}`}>
                {item.thumbUrl ? <img src={item.thumbUrl} alt="" className="h-full w-full object-cover" /> : <span className="block h-full w-full bg-white/10" />}
                {item.kind === "video" && <span className="absolute inset-0 flex items-center justify-center bg-black/30"><span className="ml-0.5 h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-white" /></span>}
              </button>
            ))}
          </div>
        )}
      </footer>
    </div>,
    document.body
  );
}
