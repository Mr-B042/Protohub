import { useEffect, useMemo, useState } from "react";
import { publicReviewsApi, type PublicReviewPage as PageData } from "../lib/api";
import { ACCEPT_ATTR, fileProblem, kindOfFile, mimeOf, shrinkPhoto, uploadWithProgress, videoCover } from "../lib/media-upload";

/**
 * A customer's personal review link (Reviews & UGC, Bright's design 56,
 * 8 Nov 2026). No login: the link opens one delivered order. Stars, a few
 * words, photos or a video, and two ticks (real experience: needed; share it:
 * optional, never pre-ticked). Everything waits for the team's approval.
 */

type Picked = { key: string; file: File; kind: "image" | "video"; preview: string; progress: number; error: string };

export default function PublicReviewPage() {
  const token = useMemo(() => decodeURIComponent((window.location.hash.split("/")[2] ?? "").split("?")[0]), []);
  const [page, setPage] = useState<PageData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [genuine, setGenuine] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = "Leave a review";
    publicReviewsApi.page(token).then(setPage).catch((err) => setLoadError((err as Error).message));
  }, [token]);
  useEffect(() => () => files.forEach((file) => URL.revokeObjectURL(file.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (list: FileList | null) => {
    setError("");
    const next = [...files];
    for (const file of Array.from(list ?? [])) {
      if (next.length >= (page?.maxFiles ?? 6)) { setError(`You can add up to ${page?.maxFiles ?? 6} photos or videos.`); break; }
      const problem = fileProblem(file);
      const kind = kindOfFile(file);
      if (problem || !kind) { setError(problem ?? "That file can't be added."); continue; }
      next.push({ key: `${file.name}-${file.size}-${Math.random()}`, file, kind, preview: URL.createObjectURL(file), progress: 0, error: "" });
    }
    setFiles(next);
  };
  const setOne = (key: string, patch: Partial<Picked>) => setFiles((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const send = async () => {
    setError("");
    if (!rating) { setError("Tap the stars to rate your order."); return; }
    if (!genuine) { setError("Please tick that this is your real experience."); return; }
    if (!files.length && text.trim().length < 5) { setError("Write a few words, or add a photo or video."); return; }
    setBusy(true);
    try {
      const { reviewId } = await publicReviewsApi.start(token, { rating, text: text.trim(), genuine: true, marketing });
      for (const item of files) {
        const body = item.kind === "image" ? await shrinkPhoto(item.file) : item.file;
        const mime = item.kind === "image" && body !== item.file ? "image/jpeg" : mimeOf(item.file, item.kind);
        const { id, signedUrl } = await publicReviewsApi.file(token, { reviewId, mime, size: body.size, name: item.file.name });
        await uploadWithProgress(signedUrl, body, mime, (fraction) => setOne(item.key, { progress: fraction }));
        const extra = item.kind === "video" ? await videoCover(item.file) : {};
        await publicReviewsApi.fileDone(token, id, extra);
        setOne(item.key, { progress: 1 });
      }
      await publicReviewsApi.submit(token, reviewId);
      setDone(true);
    } catch (err) {
      setError((err as Error).message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gradient-to-b from-[#F6F3FF] to-[#E6DEFF] px-4 py-6 font-sans text-[#14112B]">
      <div className="mx-auto max-w-[480px]">
        {page?.brand && <div className="mb-4 text-center text-[16px] font-extrabold">🛍️ {page.brand}</div>}
        <div className="rounded-3xl bg-white p-5 shadow-[0_10px_40px_rgba(91,63,217,0.12)]">{children}</div>
      </div>
    </div>
  );

  if (loadError) return shell(<p className="m-0 text-center text-[15px]">{loadError}</p>);
  if (!page) return shell(<p className="m-0 text-center text-[15px] text-gray-500">Loading…</p>);
  if (done || page.alreadySent) {
    return shell(
      <div className="py-6 text-center">
        <div className="text-[54px] leading-none">💜</div>
        <h1 className="m-0 mt-3 text-[24px] font-black">Thank you{page.firstName ? `, ${page.firstName}` : ""}!</h1>
        <p className="m-0 mt-2 text-[15px] text-[#3A3556]">{done ? "We got your review. It helps other customers choose." : "We already have your review for this order. Thank you!"}</p>
      </div>
    );
  }
  if (!page.delivered) return shell(<p className="m-0 text-center text-[15px]">You can review this order once it has been delivered. Thank you for your patience!</p>);

  return shell(
    <div className="space-y-5">
      <div className="text-center">
        {page.productImage && <img src={page.productImage} alt="" className="mx-auto mb-3 h-36 w-36 rounded-2xl object-cover" />}
        <h1 className="m-0 text-[24px] font-black leading-tight">How was your order{page.firstName ? `, ${page.firstName}` : ""}? 😊</h1>
        {page.productName && <p className="m-0 mt-1 text-[15px] text-[#3A3556]">{page.productName}</p>}
      </div>

      <div className="flex justify-center gap-1.5" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setRating(n)}
            className={`!min-h-0 text-[40px] leading-none transition-transform active:scale-90 ${n <= rating ? "" : "opacity-25 grayscale"}`}>⭐</button>
        ))}
      </div>

      <label className="block text-[15px] font-bold">Tell us about it
        <textarea rows={4} value={text} maxLength={2000} onChange={(event) => setText(event.target.value)} placeholder="What do you like about it? How are you using it?"
          className="mt-1.5 w-full rounded-2xl border border-[#E1DAFB] px-4 py-3 text-[15px] font-normal outline-none focus:border-[#7C5CFF]" />
      </label>

      <div>
        <div className="text-[15px] font-bold">Add photos or a video <span className="font-normal text-gray-500">(optional)</span></div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {files.map((item) => (
            <div key={item.key} className="relative aspect-square overflow-hidden rounded-xl bg-gray-100">
              {item.kind === "image" ? <img src={item.preview} alt="" className="h-full w-full object-cover" /> : <video src={item.preview} muted playsInline className="h-full w-full object-cover" />}
              {busy && item.progress < 1 && <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/20"><div className="h-full bg-[#7C5CFF]" style={{ width: `${Math.round(item.progress * 100)}%` }} /></div>}
              {!busy && <button type="button" aria-label="Remove" onClick={() => setFiles((list) => list.filter((one) => one.key !== item.key))} className="!min-h-0 absolute right-1 top-1 rounded-full bg-black/60 px-2 text-[14px] text-white">×</button>}
            </div>
          ))}
          {files.length < page.maxFiles && !busy && (
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#C9BEF5] text-[#5B3FD9]">
              <span className="text-[28px] leading-none">＋</span><span className="mt-1 text-[12px] font-semibold">Photo / video</span>
              <input type="file" accept={ACCEPT_ATTR} multiple className="hidden" onChange={(event) => { add(event.target.files); event.target.value = ""; }} />
            </label>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-2xl bg-[#F7F5FF] p-4">
        <label className="flex items-start gap-3 text-[14px]"><input type="checkbox" checked={genuine} onChange={(event) => setGenuine(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#5B3FD9]" /><span>This is my real experience with this order. <span className="text-rose-500">*</span></span></label>
        <label className="flex items-start gap-3 text-[14px]"><input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#5B3FD9]" /><span>{page.brand || "The shop"} may share my review, photos or video to show other customers. <span className="text-gray-500">(optional)</span></span></label>
      </div>

      {error && <p className="m-0 rounded-xl bg-rose-50 px-3 py-2 text-[14px] text-rose-700">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void send()} className="!min-h-0 w-full rounded-2xl bg-[#5B3FD9] py-4 text-[17px] font-bold text-white shadow-md disabled:opacity-60">
        {busy ? "Sending…" : "Send My Review"}
      </button>
      <p className="m-0 text-center text-[12px] text-gray-500">Your phone number is never shown with your review.</p>
    </div>
  );
}
