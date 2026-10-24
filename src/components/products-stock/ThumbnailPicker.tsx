import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus } from "lucide-react";
import type { ProductMedia } from "../../lib/api";
import { Sheet } from "./shared";

// Change a video's thumbnail (Bright, 24 Oct 2026). The one made at upload is a
// frame about 1 second in, which is black when the clip fades in. Here the
// person plays or drags through the video and keeps the frame on screen, or
// uploads a picture instead. The server redraws whatever is sent.

const MAX_EDGE = 1280;

/** Draw a video frame or picture onto a canvas no bigger than MAX_EDGE, as a JPEG. */
function toJpeg(source: CanvasImageSource, width: number, height: number) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width || MAX_EDGE, height || MAX_EDGE));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Rough check for an all-dark picture, so a black frame is not saved by mistake. */
function looksBlack(dataUrl: string) {
  return new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 32; canvas.height = 32;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, 32, 32);
      const pixels = ctx.getImageData(0, 0, 32, 32).data;
      let total = 0;
      for (let i = 0; i < pixels.length; i += 4) total += pixels[i] + pixels[i + 1] + pixels[i + 2];
      resolve(total / (pixels.length / 4) / 3 < 12);
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

export function ThumbnailPicker({ item, onClose, onSave }: {
  item: ProductMedia;
  onClose: () => void;
  onSave: (imageDataUrl: string) => Promise<void>;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (chosen) void looksBlack(chosen).then(setDark); else setDark(false); }, [chosen]);

  const seek = (seconds: number) => {
    const el = video.current;
    if (!el) return;
    el.pause();
    el.currentTime = seconds;
    setTime(seconds);
  };

  const useFrame = () => {
    const el = video.current;
    if (!el || !el.videoWidth) { setError("The video has not loaded yet. Play it for a second, then try again."); return; }
    setError("");
    try {
      el.pause();
      setChosen(toJpeg(el, el.videoWidth, el.videoHeight));
    } catch {
      // The storage did not allow reading the frame (cross-site rules).
      setError("This frame could not be captured. Upload a picture instead.");
    }
  };

  const pickPicture = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("That is not a picture. Pick a JPG, PNG or WebP photo."); return; }
    setError("");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { setChosen(toJpeg(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(url); };
    img.onerror = () => { setError("That picture could not be opened. Try another one."); URL.revokeObjectURL(url); };
    img.src = url;
  };

  const save = async () => {
    if (!chosen) return;
    setSaving(true);
    setError("");
    try { await onSave(chosen); onClose(); }
    catch (err: any) { setError(err?.message ?? "Could not save the thumbnail."); }
    finally { setSaving(false); }
  };

  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

  return (
    <Sheet title="Change thumbnail" subtitle="Pick a frame from the video, or upload a picture" onClose={onClose}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2.5 text-[13px] font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200">Cancel</button>
          <button type="button" disabled={!chosen || saving} onClick={save}
            className="!min-h-0 rounded-xl bg-[#1F8FE0] px-4 py-2.5 text-[13px] font-black text-white disabled:opacity-40">{saving ? "Saving…" : "Save thumbnail"}</button>
        </div>
      )}>
      <div className="space-y-4">
        {item.url ? (
          <div className="space-y-2">
            <div className="overflow-hidden rounded-xl bg-black">
              <video ref={video} src={item.url} crossOrigin="anonymous" playsInline controls preload="auto"
                className="mx-auto block max-h-[42dvh] w-full object-contain"
                onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} />
            </div>
            {duration > 0 && (
              <label className="block">
                <span className="mb-1 flex justify-between text-[11.5px] font-semibold text-gray-500"><span>Drag to the frame you want</span><span>{clock(time)} / {clock(duration)}</span></span>
                <input type="range" min={0} max={duration} step={0.1} value={time} onChange={(event) => seek(Number(event.target.value))} className="w-full accent-[#1F8FE0]" />
              </label>
            )}
            <button type="button" onClick={useFrame}
              className="!min-h-0 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 py-2.5 text-[13px] font-black text-white dark:bg-slate-100 dark:text-slate-900"><Camera className="h-4 w-4" />Use this frame</button>
          </div>
        ) : <p className="m-0 text-[12.5px] text-gray-500">The video is not available right now. You can still upload a picture.</p>}

        <label className="!min-h-0 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 py-2.5 text-[13px] font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200">
          <ImagePlus className="h-4 w-4" />Upload a picture instead
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { pickPicture(event.target.files?.[0]); event.target.value = ""; }} />
        </label>

        {chosen && (
          <div>
            <p className="m-0 mb-1.5 text-[12px] font-bold text-gray-700 dark:text-slate-300">New thumbnail</p>
            <img src={chosen} alt="New thumbnail" className="max-h-40 rounded-xl border border-gray-200 object-contain dark:border-slate-700" />
            {dark && <p className="m-0 mt-1.5 text-[12px] font-semibold text-amber-700">This frame is almost black. Pick a later one, or upload a picture.</p>}
          </div>
        )}
        {error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p>}
      </div>
    </Sheet>
  );
}
