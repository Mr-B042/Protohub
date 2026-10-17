import { useRef, useState } from "react";
import { Camera, Check, CheckCircle2, ChevronDown, Eye, Image as ImageIcon, MoreVertical, Plus, ShieldCheck, Trash2, Video, XCircle } from "lucide-react";
import type { ProductMedia } from "../../lib/api";
import { timeAgo } from "../../lib/media-upload";
import { Avatar, MenuItem, PopoverMenu, Sheet, StatusPill, cardShell } from "./shared";

export type UploadMode = "files" | "photo" | "video";

export const REJECT_REASONS = [
  "Blurry or too dark",
  "Wrong product",
  "Has a watermark or another brand",
  "Does not show the product clearly",
  "Duplicate of a file already in the gallery"
];

export const CHANGE_REQUESTS = [
  "Re-take it in better light",
  "Show the whole product in the frame",
  "Remove the watermark or other brand",
  "Keep the video shorter (under 60 seconds)",
  "Cover the customer's phone number or name"
];

/** Why a file is rejected, or what to change: one tap on a common reason, or typed. */
export function RejectSheet({ media, count = 1, mode = "reject", onClose, onReject }: { media: ProductMedia; count?: number; mode?: "reject" | "changes"; onClose: () => void; onReject: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try { await onReject(reason.trim()); onClose(); } catch { /* the page already showed why */ } finally { setBusy(false); }
  };
  const options = mode === "reject" ? REJECT_REASONS : CHANGE_REQUESTS;
  const what = count > 1 ? `${count} files` : media.name;
  return (
    <Sheet title={mode === "reject" ? (count > 1 ? `Reject ${count} files` : "Reject this file") : "Request changes"}
      subtitle={`${what} · from ${media.uploadedByName || "a team member"}. They will see your ${mode === "reject" ? "reason" : "note"} and can send a new one.`} onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200">Cancel</button>
          <button type="button" disabled={!reason.trim() || busy} onClick={submit}
            className={`!min-h-0 flex-1 rounded-xl px-4 py-3 text-sm font-black text-white disabled:opacity-50 ${mode === "reject" ? "bg-rose-600" : "bg-amber-500"}`}>
            {mode === "reject" ? "Reject and delete" : "Send request"}
          </button>
        </div>
      }>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {options.map((text) => (
            <button key={text} type="button" onClick={() => setReason(text)}
              className={`!min-h-0 rounded-full border px-3 py-2 text-[13px] font-bold ${reason === text ? "border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200" : "border-gray-200 bg-white text-gray-600 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-300"}`}>{text}</button>
          ))}
        </div>
        <textarea value={reason} onChange={(event) => setReason(event.target.value.slice(0, 300))} rows={3} placeholder={mode === "reject" ? "Or say why" : "Or say what to change"}
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[15px] text-gray-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
      </div>
    </Sheet>
  );
}

export function MediaGuideSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Media usage guide" subtitle="What makes a photo or video worth sharing with a customer." onClose={onClose}>
      <div className="space-y-4 text-[14px] leading-relaxed text-gray-700 dark:text-slate-200">
        {[
          ["Use clear, high quality images and videos", "Good light, in focus, the whole product in frame. Daylight near a window beats a dark room."],
          ["Show real product usage (lifestyle)", "A rack full of bottles in a real bathroom sells better than an empty rack on the floor."],
          ["Avoid watermarks and unnecessary text", "No other brands' logos, phone numbers or prices on the picture: prices change, the picture stays."],
          ["Make sure the product is well lit and visible", "Customers zoom in. If you cannot see the detail, neither can they."],
          ["Keep videos short", "15 to 60 seconds is best. Show it being set up or used; customers watch it on mobile data."],
          ["Customer reviews need permission", "Only share a customer's face, voice or chat with their OK. Cover phone numbers and names."]
        ].map(([title, body]) => (
          <div key={title} className="flex gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#1F8FE0]" />
            <div><p className="m-0 font-black text-gray-900 dark:text-slate-100">{title}</p><p className="m-0 mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">{body}</p></div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

export function MediaRail({ recent, canApprove, canSend, repUploadsEnabled, productName, onUpload, onViewAll, onOpenMedia, onApprove, onReject, onDelete, onOpenGuide, currentUserId }: {
  recent: ProductMedia[];
  canApprove: boolean;
  canSend: boolean;
  repUploadsEnabled: boolean;
  productName: (productId: string) => string;
  onUpload: (mode: UploadMode) => void;
  onViewAll: () => void;
  onOpenMedia: (media: ProductMedia) => void;
  onApprove: (media: ProductMedia) => void;
  onReject: (media: ProductMedia) => void;
  onDelete: (media: ProductMedia) => void;
  onOpenGuide: () => void;
  currentUserId: string;
}) {
  const [uploadMenu, setUploadMenu] = useState(false);
  const chevron = useRef<HTMLButtonElement | null>(null);
  return (
    <aside className="space-y-4">
      <section className="rounded-2xl border border-violet-200 bg-gradient-to-b from-violet-50/70 to-white p-4 shadow-sm dark:border-violet-500/30 dark:from-violet-500/10 dark:to-[#0c1722]">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300"><ImageIcon className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h2 className="m-0 text-[15px] font-black text-violet-700 dark:text-violet-300">Product Media Gallery</h2>
            <p className="m-0 mt-0.5 text-[12.5px] leading-snug text-gray-600 dark:text-slate-400">High quality images and videos for all products.</p>
            <button type="button" onClick={onOpenGuide} className="!min-h-0 mt-0.5 text-[12.5px] font-bold text-[#1F8FE0] hover:underline">Learn more</button>
          </div>
        </div>
        {canSend ? (
          <div className="mt-4 flex overflow-hidden rounded-xl bg-[#1F8FE0] text-white shadow-sm">
            <button type="button" onClick={() => onUpload("files")} className="!min-h-0 inline-flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-black hover:bg-blue-600">
              <Plus className="h-4 w-4" />{canApprove ? "Upload Media" : "Send Media for Approval"}
            </button>
            <button ref={chevron} type="button" aria-label="More ways to upload" onClick={() => setUploadMenu((open) => !open)} className="!min-h-0 border-l border-white/25 px-3.5 hover:bg-blue-600"><ChevronDown className="h-4 w-4" /></button>
          </div>
        ) : (
          <p className="m-0 mt-4 rounded-xl bg-gray-100 px-3 py-2.5 text-[12.5px] font-semibold text-gray-600 dark:bg-slate-800 dark:text-slate-300">
            {repUploadsEnabled ? "Your role can view the gallery but not add to it." : "Sending media is switched off for now. Ask an Owner, Admin or Manager."}
          </p>
        )}
        <PopoverMenu anchor={chevron.current} open={uploadMenu} onClose={() => setUploadMenu(false)} width={210}>
          <MenuItem icon={<ImageIcon />} onClick={() => { setUploadMenu(false); onUpload("files"); }}>Choose from gallery</MenuItem>
          <MenuItem icon={<Camera />} onClick={() => { setUploadMenu(false); onUpload("photo"); }}>Take a photo</MenuItem>
          <MenuItem icon={<Video />} onClick={() => { setUploadMenu(false); onUpload("video"); }}>Record a video</MenuItem>
        </PopoverMenu>

        <div className="mt-4 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-500/20 dark:bg-blue-500/10">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-[#1F8FE0]" />
          <div>
            <p className="m-0 text-[13px] font-black text-[#1F8FE0]">Secure &amp; Safe Upload</p>
            <p className="m-0 mt-0.5 text-[12px] leading-snug text-gray-600 dark:text-slate-400">Only images and videos are allowed. Files are checked for harmful content and photos are cleaned before anyone can see them.</p>
          </div>
        </div>
        <div className="mt-3 text-[12.5px] text-gray-600 dark:text-slate-400">
          <p className="m-0 font-bold text-gray-700 dark:text-slate-300">Supported formats:</p>
          <p className="m-0 mt-1.5 flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />Images: JPG, PNG, WEBP (Max 10MB each)</p>
          <p className="m-0 mt-1 flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />Videos: MP4, MOV, WEBM (Max 100MB each)</p>
          <p className="m-0 mt-1 pl-[1.375rem]">All files are automatically checked before upload.</p>
        </div>
      </section>

      <section className={`${cardShell} p-4`}>
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-100">{canApprove ? "Recent Media Submissions" : "My Media Submissions"}</h2>
          <button type="button" onClick={onViewAll} className="!min-h-0 text-[12.5px] font-bold text-[#1F8FE0] hover:underline">View all</button>
        </div>
        {recent.length === 0 ? (
          <p className="m-0 py-6 text-center text-[13px] font-semibold text-gray-400">{canApprove ? "Nothing sent yet." : "You have not sent any files yet."}</p>
        ) : (
          <div className="mt-2 divide-y divide-gray-100 dark:divide-slate-800">
            {recent.map((media) => <SubmissionRow key={media.id} media={media} canApprove={canApprove} mine={media.uploadedBy === currentUserId}
              productName={productName(media.productId)} onOpen={onOpenMedia} onApprove={onApprove} onReject={onReject} onDelete={onDelete} />)}
          </div>
        )}
      </section>

      <section className={`${cardShell} p-4`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 flex items-center gap-2 text-[15px] font-black text-gray-900 dark:text-slate-100">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15"><ImageIcon className="h-4 w-4" /></span>Media Usage Guide
          </h2>
          <button type="button" onClick={onOpenGuide} className="!min-h-0 text-[12.5px] font-bold text-[#1F8FE0] hover:underline">View guide</button>
        </div>
        <ul className="m-0 mt-3 list-none space-y-2.5 p-0 text-[12.5px] text-gray-600 dark:text-slate-400">
          {["Use clear, high quality images and videos", "Show real product usage (lifestyle)", "Avoid watermarks and unnecessary text", "Make sure product is well lit and visible"].map((text) => (
            <li key={text} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 fill-[#1F8FE0] text-white dark:text-[#0c1722]" />{text}</li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function SubmissionRow({ media, canApprove, mine, productName, onOpen, onApprove, onReject, onDelete }: {
  media: ProductMedia; canApprove: boolean; mine: boolean; productName: string;
  onOpen: (media: ProductMedia) => void; onApprove: (media: ProductMedia) => void; onReject: (media: ProductMedia) => void; onDelete: (media: ProductMedia) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const canDelete = canApprove || (mine && media.status !== "approved");
  return (
    <div className="flex items-center gap-3 py-2.5">
      <button type="button" onClick={() => onOpen(media)} aria-label={`View ${media.name}`} disabled={!media.thumbUrl && !media.url}
        className="!min-h-0 relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-slate-800">
        {media.thumbUrl ? <img src={media.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          : <span className="flex h-full w-full items-center justify-center text-gray-300">{media.kind === "video" ? <Video className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}</span>}
        {media.kind === "video" && media.thumbUrl && <span className="absolute inset-0 flex items-center justify-center bg-black/25"><span className="ml-0.5 h-0 w-0 border-y-[4px] border-l-[7px] border-y-transparent border-l-white" /></span>}
      </button>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[13px] font-bold text-gray-900 dark:text-slate-100">{media.name}</p>
        <p className="m-0 mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-gray-500 dark:text-slate-400">
          <Avatar name={media.uploadedByName || "?"} /><span className="truncate">{media.uploadedByName || "Team"}</span>
          <span className="shrink-0 text-gray-400">· {timeAgo(media.createdAt)}</span>
        </p>
        <p className="m-0 truncate text-[11px] text-gray-400 dark:text-slate-500">{productName}</p>
      </div>
      <StatusPill status={media.status} />
      <button ref={button} type="button" aria-label="More" onClick={() => setOpen((value) => !value)} className="!min-h-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><MoreVertical className="h-4 w-4" /></button>
      <PopoverMenu anchor={button.current} open={open} onClose={() => setOpen(false)}>
        <MenuItem icon={<Eye />} disabled={!media.url} onClick={() => { setOpen(false); onOpen(media); }}>View</MenuItem>
        {canApprove && media.status === "pending" && <MenuItem icon={<CheckCircle2 />} tone="success" onClick={() => { setOpen(false); onApprove(media); }}>Approve</MenuItem>}
        {canApprove && media.status === "pending" && <MenuItem icon={<XCircle />} tone="danger" onClick={() => { setOpen(false); onReject(media); }}>Reject</MenuItem>}
        {media.status === "rejected" && media.rejectReason && <p className="m-0 px-3.5 py-2 text-[12px] text-gray-500 dark:text-slate-400">Reason: {media.rejectReason}</p>}
        {canDelete && <MenuItem icon={<Trash2 />} tone="danger" onClick={() => { setOpen(false); onDelete(media); }}>Delete</MenuItem>}
      </PopoverMenu>
    </div>
  );
}
