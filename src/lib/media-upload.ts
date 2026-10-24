// Browser side of the Products & Stock gallery (Bright, 17 Oct 2026). Most of
// the team uses phones on mobile data, so photos are shrunk BEFORE sending,
// files go straight to storage with a progress bar, and sharing hands the file
// itself to WhatsApp. The server still checks and redraws everything: nothing
// here is a safety measure, only a data and comfort one.

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const ACCEPT_ATTR = [...PHOTO_TYPES, ...VIDEO_TYPES].join(",");
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

const SEND_AS_IS_BYTES = 2.5 * 1024 * 1024;
const MAX_EDGE = 2560;

export type PickedKind = "image" | "video";
export function kindOfFile(file: File): PickedKind | null {
  const type = (file.type || "").toLowerCase();
  if (PHOTO_TYPES.includes(type) || type === "image/jpg") return "image";
  if (VIDEO_TYPES.includes(type)) return "video";
  // Some Android galleries send no type: judge by the name, the server checks the bytes.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "m4v"].includes(ext)) return "video";
  return null;
}
export function mimeOf(file: File, kind: PickedKind) {
  const type = (file.type || "").toLowerCase();
  if (type === "image/jpg") return "image/jpeg";
  if (type) return type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "image") return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : "video/mp4";
}

/** Why a picked file cannot be sent, in plain words, or null when it can. */
export function fileProblem(file: File): string | null {
  const kind = kindOfFile(file);
  if (!kind) return "Only photos (JPG, PNG, WEBP) and videos (MP4, MOV, WEBM) can be added.";
  if (kind === "video" && file.size > VIDEO_MAX_BYTES) return "Videos must be 100 MB or smaller. Trim it on your phone and try again.";
  return null;
}

/** A big phone photo shrunk to at most 2560px as a JPEG; small ones sent as they are. */
export async function shrinkPhoto(file: File): Promise<Blob> {
  if (file.size <= SEND_AS_IS_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** A cover picture and the length of a video, read on the phone. */
export function videoCover(file: Blob): Promise<{ posterDataUrl?: string; durationSeconds?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (result: { posterDataUrl?: string; durationSeconds?: number }) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(result);
    };
    const timer = window.setTimeout(() => finish({ posterDataUrl: best?.dataUrl, durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined }), 8000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    // ⚠️ Not just the frame at 1 second (24 Oct 2026): clips that fade in from
    // black got a black thumbnail. Try a few points and keep the first frame
    // that is not dark, or the brightest one if all are.
    let tries: number[] = [];
    let best: { dataUrl: string; light: number } | null = null;
    const lengthOf = () => (Number.isFinite(video.duration) ? video.duration : undefined);
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      tries = [Math.min(1, duration / 3 || 0.1), duration * 0.25, duration * 0.5, duration * 0.75].filter((t, i) => i === 0 || t > 1.2);
      video.currentTime = tries.shift() ?? 0.1;
    };
    video.onseeked = () => {
      try {
        const edge = 640;
        const scale = Math.min(1, edge / Math.max(video.videoWidth || edge, video.videoHeight || edge));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((video.videoWidth || edge) * scale));
        canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let total = 0;
        const step = 4 * 37;
        for (let i = 0; i < sample.length; i += step) total += sample[i] + sample[i + 1] + sample[i + 2];
        const light = total / (sample.length / step) / 3;
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        if (!best || light > best.light) best = { dataUrl, light };
        const next = tries.shift();
        if (light < 25 && next !== undefined) { video.currentTime = next; return; }
        window.clearTimeout(timer);
        finish({ posterDataUrl: best.dataUrl, durationSeconds: lengthOf() });
      } catch {
        window.clearTimeout(timer);
        finish({ posterDataUrl: best?.dataUrl, durationSeconds: lengthOf() });
      }
    };
    video.onerror = () => { window.clearTimeout(timer); finish({}); };
    video.src = url;
  });
}

/** Straight to storage with progress, so a slow phone connection shows movement. */
export function uploadWithProgress(signedUrl: string, body: Blob, contentType: string, onProgress: (fraction: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.status === 413 ? "The file is too big." : "The upload did not finish. Check your connection and try again.")));
    xhr.onerror = () => reject(new Error("The upload did not finish. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(body);
  });
}

// ── Sharing and saving gallery files (fixed 24 Oct 2026) ─────────────────────
// "Share (WhatsApp)" did nothing in three places:
//   - Protohub Android app: a WebView has no navigator.share and ignores
//     download links. It now uses the app's own Share + Filesystem plugins
//     (in the app since 1.1), downloading the file straight to the phone.
//   - Phone browsers: share() is only allowed straight after a tap, but the
//     whole file was downloaded first (seconds for a video), so the phone
//     refused. Files are now fetched AHEAD (prefetchMediaFile, when the menu
//     or viewer opens) and share() runs inside the tap. If the file is not
//     ready yet, the person is told to tap again once it is.
//   - Computers: it said "Saved to your phone". It now says what happened.
// No text goes with the file: WhatsApp on iPhone drops the picture when text
// comes with it (learned on the order receipt).

export type MediaShareResult = "shared" | "saved" | "cancelled" | "retry" | "opened";

const readyFiles = new Map<string, File>();
const loadingFiles = new Map<string, Promise<File>>();

/** Start fetching a file so a later tap can share it at once. Safe to call often. */
export function prefetchMediaFile(url: string, fileName: string): Promise<File> {
  const ready = readyFiles.get(url);
  if (ready) return Promise.resolve(ready);
  const loading = loadingFiles.get(url);
  if (loading) return loading;
  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error("Could not load the file. Check your connection.");
      return response.blob();
    })
    .then((blob) => {
      const file = new File([blob], fileName, { type: blob.type || "application/octet-stream" });
      readyFiles.set(url, file);
      // Keep the cache small: a few photos or one or two videos.
      if (readyFiles.size > 6) readyFiles.delete(readyFiles.keys().next().value as string);
      return file;
    })
    .finally(() => loadingFiles.delete(url));
  loadingFiles.set(url, promise);
  promise.catch(() => undefined);
  return promise;
}

async function capacitorPlugins() {
  const { Capacitor } = await import("@capacitor/core");
  return {
    native: Capacitor.isNativePlatform(),
    share: Capacitor.isPluginAvailable("Share"),
    files: Capacitor.isPluginAvailable("Filesystem")
  };
}

const isNativeApp = () => Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
const cancelled = (error: unknown) => {
  const e = error as { name?: string; message?: string } | null;
  return e?.name === "AbortError" || /cancel/i.test(String(e?.message ?? ""));
};

/** Open a link in the phone's browser (the app hands other websites out). */
function openOutside(url: string) {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.href = url;
}

type FilesystemModule = typeof import("@capacitor/filesystem");

/**
 * Make the folder a download goes into. The Android plugin's downloadFile
 * ignores `recursive`, so on a phone where the folder does not exist yet the
 * download fails with "open failed: ENOENT".
 */
async function ensureFolder(fs: FilesystemModule, path: string, directory: FilesystemModule["Directory"][keyof FilesystemModule["Directory"]]) {
  try {
    await fs.Filesystem.mkdir({ path, directory, recursive: true });
  } catch (error) {
    // Already there is fine; anything else surfaces at the download itself.
    if (!/exist/i.test(String((error as { message?: string } | null)?.message ?? ""))) console.warn("mkdir", path, error);
  }
}

/** In the Android app: download the file to the phone, then hand it to the share sheet. */
async function shareFromApp(url: string, fileName: string): Promise<MediaShareResult> {
  const plugins = await capacitorPlugins();
  if (!plugins.share || !plugins.files) { openOutside(url); return "opened"; }
  const [{ Share }, fs] = await Promise.all([import("@capacitor/share"), import("@capacitor/filesystem")]);
  const { Filesystem, Directory } = fs;
  const path = `share/${fileName}`;
  await ensureFolder(fs, "share", Directory.Cache);
  await Filesystem.downloadFile({ url, path, directory: Directory.Cache, recursive: true });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  try {
    await Share.share({ files: [uri], dialogTitle: "Send on WhatsApp" });
    return "shared";
  } catch (error) {
    if (cancelled(error)) return "cancelled";
    throw error;
  }
}

/**
 * Hand the file itself to WhatsApp (or any app) through the share sheet;
 * where there is none (most computers) the file is downloaded instead.
 * ⚠️ Call straight from the tap: on the web, nothing may be awaited before share().
 */
export async function shareMediaFile(url: string, fileName: string): Promise<MediaShareResult> {
  if (isNativeApp()) return shareFromApp(url, fileName);
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  const ready = readyFiles.get(url);
  if (ready) {
    // Synchronous up to here, so the tap still counts.
    if (typeof nav.share === "function" && nav.canShare?.({ files: [ready] })) {
      try { await nav.share({ files: [ready] }); return "shared"; }
      catch (error) {
        if (cancelled(error)) return "cancelled";
        // Refused for another reason: fall through and download it.
      }
    }
    saveBlob(ready, fileName);
    return "saved";
  }
  // Not fetched yet: fetch now. The tap has expired by the time it arrives,
  // so where a share sheet exists the person taps once more.
  const file = await prefetchMediaFile(url, fileName);
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) return "retry";
  saveBlob(file, fileName);
  return "saved";
}

/** Download the file: into Documents › Protohub in the app, the normal download elsewhere. */
export async function saveMediaFile(url: string, fileName: string): Promise<"saved" | "saved-in-app" | "opened"> {
  if (isNativeApp()) {
    const plugins = await capacitorPlugins();
    if (!plugins.files) { openOutside(url); return "opened"; }
    const fs = await import("@capacitor/filesystem");
    const { Filesystem, Directory } = fs;
    await ensureFolder(fs, "Protohub", Directory.Documents);
    await Filesystem.downloadFile({ url, path: `Protohub/${fileName}`, directory: Directory.Documents, recursive: true });
    return "saved-in-app";
  }
  const file = readyFiles.get(url) ?? await prefetchMediaFile(url, fileName);
  saveBlob(file, fileName);
  return "saved";
}

/** What to tell the person after a share or save. Empty = say nothing. */
export function mediaResultMessage(result: MediaShareResult | "saved-in-app"): string {
  const onComputer = typeof window !== "undefined" && !window.matchMedia?.("(pointer: coarse)").matches;
  switch (result) {
    case "saved": return onComputer ? "Downloaded to this computer. Drag it into WhatsApp to send it." : "Saved to your phone. Send it from WhatsApp.";
    case "saved-in-app": return "Saved in Documents › Protohub on this phone.";
    case "retry": return "The file is ready. Tap Share again.";
    case "opened": return "The file opened in your browser. Update the Protohub app to share straight from here.";
    default: return "";
  }
}

function saveBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 4000);
}

export const fileNameFor = (productName: string, kind: PickedKind, mime: string, index: number) => {
  const base = productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "product";
  const ext = kind === "image" ? (mime.includes("webp") ? "webp" : "jpg") : mime.includes("quicktime") ? "mov" : mime.includes("webm") ? "webm" : "mp4";
  return `${base}-${index + 1}.${ext}`;
};

export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function formatDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
