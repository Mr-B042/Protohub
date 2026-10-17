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
    const timer = window.setTimeout(() => finish({ durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined }), 8000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = Math.min(1, duration / 3 || 0.1);
    };
    video.onseeked = () => {
      try {
        const edge = 640;
        const scale = Math.min(1, edge / Math.max(video.videoWidth || edge, video.videoHeight || edge));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((video.videoWidth || edge) * scale));
        canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
        canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
        window.clearTimeout(timer);
        finish({ posterDataUrl: canvas.toDataURL("image/jpeg", 0.8), durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined });
      } catch {
        window.clearTimeout(timer);
        finish({ durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined });
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

/**
 * Hand the file itself to WhatsApp (or any app) through the phone's share
 * sheet; where that is not possible, save it to the phone instead.
 */
export async function shareMediaFile(url: string, fileName: string, text: string): Promise<"shared" | "saved" | "cancelled"> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load the file. Check your connection.");
  const blob = await response.blob();
  const file = new File([blob], fileName, { type: blob.type || "application/octet-stream" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return "shared";
    } catch (error: any) {
      if (error?.name === "AbortError") return "cancelled";
    }
  }
  saveBlob(blob, fileName);
  return "saved";
}

export async function saveMediaFile(url: string, fileName: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load the file. Check your connection.");
  saveBlob(await response.blob(), fileName);
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
