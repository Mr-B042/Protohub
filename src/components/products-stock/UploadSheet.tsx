import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, ImagePlus, Link2, Loader2, ShieldCheck, Trash2, Video, XCircle } from "lucide-react";
import { productMediaApi, type ProductMedia, type ProductMediaLabel } from "../../lib/api";
import {
  ACCEPT_ATTR, PHOTO_MAX_BYTES, fileProblem, formatBytes, kindOfFile, mimeOf, shrinkPhoto, uploadWithProgress, videoCover
} from "../../lib/media-upload";
import { MEDIA_LABEL_OPTIONS, Sheet } from "./shared";

type Picked = {
  id: string;
  // A file from the phone, or a pasted picture link the server fetches.
  file: File | null;
  url: string | null;
  name: string;
  preview: string | null;
  kind: "image" | "video" | null;
  problem: string | null;
  state: "ready" | "sending" | "done" | "failed";
  progress: number;
  message: string;
};

let pickedSeq = 0;
const MAX_FILES = 20;
const MAX_LINKS = 60;

/** Every http(s) link in pasted text: one per line, or run together. */
export function linksIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  return Array.from(new Set(found.map((link) => link.replace(/[),.;]+$/, ""))));
}

type Limits = { maxImageMb: number; maxVideoMb: number; imageTypes: string[]; videoTypes: string[] } | null;
const TYPE_KEY: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

/** Settings can narrow the types and sizes; say so before anything is sent. */
function limitProblem(file: File, limits: Limits): string | null {
  if (!limits) return null;
  const kind = kindOfFile(file);
  if (!kind) return null;
  const key = TYPE_KEY[mimeOf(file, kind)];
  const allowed = kind === "image" ? limits.imageTypes : limits.videoTypes;
  if (key && !allowed.includes(key)) return `${key.toUpperCase()} files are switched off in Settings.`;
  if (kind === "video" && file.size > limits.maxVideoMb * 1024 * 1024) return `Videos must be ${limits.maxVideoMb} MB or smaller.`;
  return null;
}

export function UploadSheet({ products, initialProductId, initialMode, canApprove, limits = null, onClose, onUploaded, onToast }: {
  products: Array<{ id: string; name: string }>;
  initialProductId?: string;
  initialMode?: "files" | "photo" | "video";
  canApprove: boolean;
  limits?: Limits;
  onClose: () => void;
  onUploaded: (media: ProductMedia[]) => void;
  onToast: (message: string) => void;
}) {
  const [productId, setProductId] = useState(initialProductId ?? "");
  const [label, setLabel] = useState<ProductMediaLabel>("product_in_use");
  const [caption, setCaption] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [sending, setSending] = useState(false);
  const filesInput = useRef<HTMLInputElement | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const videoInput = useRef<HTMLInputElement | null>(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const abort = useRef<AbortController | null>(null);

  // Opening from "Take a photo" / "Record a video" goes straight to the camera.
  useEffect(() => {
    const target = initialMode === "photo" ? photoInput : initialMode === "video" ? videoInput : null;
    if (target?.current) target.current.click();
  }, [initialMode]);
  useEffect(() => () => { picked.forEach((item) => item.preview && item.file && URL.revokeObjectURL(item.preview)); abort.current?.abort(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = Array.from(list).slice(0, 20).map((file): Picked => {
      const kind = kindOfFile(file);
      return {
        id: `p${++pickedSeq}`, file, url: null, name: file.name, kind, problem: fileProblem(file) ?? limitProblem(file, limits),
        preview: kind ? URL.createObjectURL(file) : null, state: "ready", progress: 0, message: ""
      };
    });
    setPicked((current) => [...current, ...next].slice(0, MAX_FILES + MAX_LINKS));
  };
  const addLinks = () => {
    const known = new Set(picked.map((item) => item.url).filter(Boolean));
    const links = linksIn(linkText).filter((link) => !known.has(link)).slice(0, MAX_LINKS);
    if (links.length === 0) { onToast("No picture links found. Paste links that start with https://"); return; }
    const next = links.map((link): Picked => ({
      id: `p${++pickedSeq}`, file: null, url: link, name: decodeURIComponent(link.split("?")[0].split("/").filter(Boolean).pop() ?? link),
      kind: "image", problem: null, preview: link, state: "ready", progress: 0, message: "Link"
    }));
    setPicked((current) => [...current, ...next].slice(0, MAX_FILES + MAX_LINKS));
    setLinkText("");
    setLinksOpen(false);
    onToast(`${next.length} link${next.length === 1 ? "" : "s"} added.`);
  };
  const removePicked = (id: string) => setPicked((current) => {
    const item = current.find((entry) => entry.id === id);
    if (item?.preview && item.file) URL.revokeObjectURL(item.preview);
    return current.filter((entry) => entry.id !== id);
  });
  const patchPicked = (id: string, patch: Partial<Picked>) => setPicked((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));

  const sendable = picked.filter((item) => !item.problem && item.state !== "done");
  const product = products.find((entry) => entry.id === productId);
  const allDone = picked.length > 0 && picked.every((item) => item.state === "done" || item.problem);

  const send = async () => {
    if (!productId) { onToast("Choose the product first."); return; }
    if (sendable.length === 0) return;
    setSending(true);
    abort.current = new AbortController();
    const finished: ProductMedia[] = [];
    // Files sent together are one submission in the Approval Queue.
    const batchId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined;
    const maxPhotoBytes = (limits?.maxImageMb ?? 10) * 1024 * 1024;
    const lastLinkId = [...sendable].reverse().find((item) => item.url)?.id;
    // One at a time: steadier on a phone connection than several at once.
    for (const item of sendable) {
      if (abort.current.signal.aborted) break;
      patchPicked(item.id, { state: "sending", progress: 0, message: "Preparing..." });
      try {
        if (item.url) {
          // The server fetches the link and runs the same checks as an upload.
          patchPicked(item.id, { progress: 0.5, message: "Fetching and checking..." });
          const done = await productMediaApi.importUrl({ productId, url: item.url, label, caption, batchId, notifyNow: item.id === lastLinkId });
          finished.push(done.media);
          patchPicked(item.id, { state: "done", progress: 1, message: done.media.status === "approved" ? "In the gallery" : "Waiting for approval" });
          continue;
        }
        if (!item.file) throw new Error("Nothing to send.");
        const kind = item.kind!;
        const body = kind === "image" ? await shrinkPhoto(item.file) : item.file;
        if (kind === "image" && body.size > Math.min(PHOTO_MAX_BYTES, maxPhotoBytes)) throw new Error(`Photos must be ${limits?.maxImageMb ?? 10} MB or smaller.`);
        const mime = kind === "image" && body !== item.file ? "image/jpeg" : mimeOf(item.file, kind);
        const cover = kind === "video" ? await videoCover(item.file) : {};
        const started = await productMediaApi.startUpload({ productId, mime, size: body.size, name: item.name, label, caption, batchId });
        patchPicked(item.id, { message: "Sending..." });
        await uploadWithProgress(started.signedUrl, body, mime, (fraction) => patchPicked(item.id, { progress: fraction }), abort.current.signal);
        patchPicked(item.id, { progress: 1, message: "Checking the file..." });
        const done = await productMediaApi.complete(started.id, cover);
        finished.push(done.media);
        patchPicked(item.id, { state: "done", message: done.media.status === "approved" ? "In the gallery" : "Waiting for approval" });
      } catch (error: any) {
        patchPicked(item.id, { state: "failed", message: error?.message ?? "Could not send this file." });
        if (abort.current.signal.aborted) break;
      }
    }
    setSending(false);
    if (finished.length) {
      onUploaded(finished);
      onToast(canApprove
        ? `${finished.length} file${finished.length === 1 ? "" : "s"} added to ${product?.name ?? "the gallery"}.`
        : `${finished.length} file${finished.length === 1 ? "" : "s"} sent for approval.`);
    }
  };

  const counts = useMemo(() => ({
    photos: picked.filter((item) => item.kind === "image" && !item.problem).length,
    videos: picked.filter((item) => item.kind === "video" && !item.problem).length
  }), [picked]);

  return (
    <Sheet title="Upload media" subtitle={canApprove ? "Added straight to the product gallery." : "An Owner, Admin or Manager checks each file before others can see it."}
      onClose={() => { if (!sending) onClose(); }}
      footer={
        <div className="flex items-center gap-2">
          {allDone ? (
            <button type="button" onClick={onClose} className="!min-h-0 flex-1 rounded-xl bg-[#1F8FE0] px-4 py-3 text-sm font-black text-white">Done</button>
          ) : (
            <>
              <button type="button" onClick={() => (sending ? abort.current?.abort() : onClose())}
                className="!min-h-0 rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200">{sending ? "Stop" : "Cancel"}</button>
              <button type="button" disabled={sending || sendable.length === 0 || !productId} onClick={send}
                className="!min-h-0 inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#1F8FE0] px-4 py-3 text-sm font-black text-white disabled:opacity-50">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {sendable.length === 0 ? "Choose files to upload" : `${canApprove ? "Upload" : "Send"} ${sendable.length} file${sendable.length === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      }>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-black text-gray-700 dark:text-slate-200">Product</span>
          <select value={productId} onChange={(event) => setProductId(event.target.value)} disabled={sending}
            className="h-12 w-full rounded-xl border border-gray-200 bg-white px-3 text-[15px] font-semibold text-gray-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">
            <option value="">Choose a product</option>
            {products.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { key: "files", label: "Gallery", icon: <ImagePlus className="h-6 w-6" />, ref: filesInput },
            { key: "photo", label: "Take photo", icon: <Camera className="h-6 w-6" />, ref: photoInput },
            { key: "video", label: "Record video", icon: <Video className="h-6 w-6" />, ref: videoInput }
          ].map((option) => (
            <button key={option.key} type="button" disabled={sending} onClick={() => option.ref.current?.click()}
              className="!min-h-0 flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/60 px-2 py-4 text-[13px] font-black text-[#1F8FE0] active:scale-[0.98] disabled:opacity-50 dark:border-blue-500/30 dark:bg-blue-500/10">
              {option.icon}{option.label}
            </button>
          ))}
          <button type="button" disabled={sending} onClick={() => setLinksOpen((open) => !open)} aria-expanded={linksOpen}
            className={`!min-h-0 flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-2 py-4 text-[13px] font-black active:scale-[0.98] disabled:opacity-50 ${linksOpen ? "border-[#1F8FE0] bg-blue-100 text-[#1F8FE0] dark:bg-blue-500/20" : "border-blue-200 bg-blue-50/60 text-[#1F8FE0] dark:border-blue-500/30 dark:bg-blue-500/10"}`}>
            <Link2 className="h-6 w-6" />Links
          </button>
        </div>
        {linksOpen && (
          <div className="space-y-2 rounded-2xl border border-blue-100 bg-blue-50/40 p-3 dark:border-blue-500/20 dark:bg-blue-500/5">
            <span className="block text-xs font-black text-gray-700 dark:text-slate-200">Paste picture links</span>
            <textarea value={linkText} onChange={(event) => setLinkText(event.target.value)} rows={5} autoFocus
              placeholder={"https://.../photo-1.jpg\nhttps://.../photo-2.jpg"}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-[12.5px] text-gray-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] text-gray-500 dark:text-slate-400">{linksIn(linkText).length} link{linksIn(linkText).length === 1 ? "" : "s"} found · photos only, up to {MAX_LINKS}</span>
              <button type="button" onClick={addLinks} disabled={linksIn(linkText).length === 0}
                className="!min-h-0 rounded-xl bg-[#1F8FE0] px-4 py-2 text-[13px] font-black text-white disabled:opacity-50">Add links</button>
            </div>
          </div>
        )}
        <input ref={filesInput} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
        <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
        <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm" capture="environment" hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />

        {picked.length > 0 && (
          <div className="space-y-2">
            <p className="m-0 text-xs font-bold text-gray-500 dark:text-slate-400">
              {counts.photos} photo{counts.photos === 1 ? "" : "s"} · {counts.videos} video{counts.videos === 1 ? "" : "s"}
            </p>
            {picked.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-2 dark:border-slate-800 dark:bg-slate-950">
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-200 dark:bg-slate-800">
                  {item.preview && item.kind === "image" ? <img src={item.preview} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : null}
                  {item.url && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] font-black text-white">LINK</span>}
                  {item.preview && item.kind === "video" ? <video src={item.preview} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : null}
                  {item.kind === "video" && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] font-black text-white">VIDEO</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-gray-800 dark:text-slate-100">{item.name}</span>
                  <span className={`block text-[11px] font-semibold ${item.problem || item.state === "failed" ? "text-rose-600" : item.state === "done" ? "text-emerald-600" : "text-gray-500 dark:text-slate-400"}`}>
                    {item.problem ?? (item.message || (item.file ? formatBytes(item.file.size) : ""))}
                  </span>
                  {item.state === "sending" && (
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-800">
                      <span className="block h-full rounded-full bg-[#1F8FE0] transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                    </span>
                  )}
                </span>
                {item.state === "done" ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                  : item.state === "failed" || item.problem ? <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
                  : item.state === "sending" ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#1F8FE0]" /> : null}
                {(item.state === "ready" || item.state === "failed" || item.problem) && !sending && (
                  <button type="button" aria-label="Remove" onClick={() => removePicked(item.id)} className="!min-h-0 rounded-lg p-2 text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-800"><Trash2 className="h-4 w-4" /></button>
                )}
              </div>
            ))}
          </div>
        )}

        <div>
          <span className="mb-1.5 block text-xs font-black text-gray-700 dark:text-slate-200">What does it show?</span>
          <div className="flex flex-wrap gap-1.5">
            {MEDIA_LABEL_OPTIONS.map((option) => (
              <button key={option.value} type="button" disabled={sending} onClick={() => setLabel(option.value)}
                className={`!min-h-0 rounded-full border px-3 py-2 text-[13px] font-bold transition-colors ${label === option.value ? "border-[#1F8FE0] bg-[#1F8FE0] text-white" : "border-gray-200 bg-white text-gray-600 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-300"}`}>
                {option.text}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-black text-gray-700 dark:text-slate-200">Note <span className="font-semibold text-gray-400">(optional)</span></span>
          <textarea value={caption} onChange={(event) => setCaption(event.target.value.slice(0, 300))} rows={2} disabled={sending}
            placeholder="e.g. Shows how it fits in a small bathroom corner"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[15px] text-gray-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
        </label>

        <p className="m-0 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-semibold leading-relaxed text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          Photos: {(limits?.imageTypes ?? ["jpg", "png", "webp"]).map((key) => key.toUpperCase()).join(", ")} up to {limits?.maxImageMb ?? 10} MB. Videos: {(limits?.videoTypes ?? ["mp4", "mov", "webm"]).map((key) => key.toUpperCase()).join(", ")} up to {limits?.maxVideoMb ?? 100} MB. Every file is checked and photos are cleaned before anyone can see them.
        </p>
      </div>
    </Sheet>
  );
}
