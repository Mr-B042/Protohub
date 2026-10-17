import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import sharp from "sharp";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { deliver } from "../lib/weekly-report-notifications.js";
import {
  ACCEPTED_TYPES, IMAGE_TYPE_KEYS, MAX_PENDING_PER_PERSON, MEDIA_APPROVER_ROLES, MEDIA_LABELS, MEDIA_USAGE, SNIFF_BYTES, TYPE_KEYS,
  UPLOADS_PER_HOUR, VIDEO_TYPE_KEYS, canApproveMedia, canSendMedia, cleanFileName, extensionOf, kindOf, sniffMediaType, type RealMediaType
} from "../lib/media-safety.js";

// ── Products & Stock: media gallery, approvals, categories, settings ────────
// (Bright's designs, 17 Oct 2026.) Photos and videos for every product. Owner /
// Admin / Manager add straight to the gallery; everyone else sends for
// approval (unless a branch switches approval off). The rules that keep
// harmful files out live in lib/media-safety.ts; files move through:
//
//   1. POST /uploads          signed link to the PRIVATE holding bucket
//   2. browser uploads        straight to storage, never through this server
//   3. POST /:id/complete     real type read from the bytes; photos redrawn
//                             as clean WebP copies; videos checked and kept
//   4. approve                copied (inside storage) to the PUBLIC bucket
//
// ⚠️ Nothing in holding is public, and nothing is shown to anyone but its
// sender and the approvers until step 4.

const router = Router();
router.use(requireAuth);

const HOLD = "product-media-holding";
const PUBLIC = "product-media";
const PREVIEW_SECONDS = 60 * 60;
const LINK = "#/dashboard/sales-rep/products";
const IMAGE_MAX_EDGE = 1600;
const THUMB_EDGE = 640;
const REVIEWED = ["rejected", "changes_requested"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
function sendError(res: Response, error: any, fallback: string) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.warn("[product-media]", error?.message ?? error);
  res.status(status).json({ error: status >= 500 ? fallback : error.message });
}
const orgOf = (req: Request) => req.user!.orgId;
const branchOf = (req: Request) => req.user!.branchId ?? null;
const roleOf = (req: Request) => String(req.user!.role ?? "");
const requireApprover = (req: Request, what = "do this") => {
  if (!canApproveMedia(roleOf(req))) throw fail(403, `Only an Owner, Admin or Manager can ${what}.`);
};

// ── Settings (one row per branch) ─────────────────────────
export type CatalogSettings = {
  repUploadsEnabled: boolean; requireApproval: boolean; maxImageMb: number; maxVideoMb: number;
  allowedImageTypes: string[]; allowedVideoTypes: string[];
  showSku: boolean; showStockToReps: boolean; showLowStockWarning: boolean; hideUnavailableFromReps: boolean;
  defaultView: "grid" | "list"; priceFormat: "full" | "short"; unitsWord: "units" | "pcs" | "pieces"; preferredCurrency: string;
  notifyApprovers: boolean; notifySenders: boolean;
  defaultMainImageUrl: string | null; defaultVideoThumbUrl: string | null; defaultLifestyleImageUrl: string | null;
  updatedAt: string | null;
};
const DEFAULT_SETTINGS: CatalogSettings = {
  repUploadsEnabled: true, requireApproval: true, maxImageMb: 10, maxVideoMb: 100,
  allowedImageTypes: [...IMAGE_TYPE_KEYS], allowedVideoTypes: [...VIDEO_TYPE_KEYS],
  showSku: true, showStockToReps: true, showLowStockWarning: true, hideUnavailableFromReps: false,
  defaultView: "grid", priceFormat: "full", unitsWord: "units", preferredCurrency: "NGN",
  notifyApprovers: true, notifySenders: true,
  defaultMainImageUrl: null, defaultVideoThumbUrl: null, defaultLifestyleImageUrl: null, updatedAt: null
};
const mapSettings = (row: any): CatalogSettings => row ? {
  repUploadsEnabled: row.rep_uploads_enabled !== false, requireApproval: row.require_approval !== false,
  maxImageMb: Number(row.max_image_mb ?? 10), maxVideoMb: Number(row.max_video_mb ?? 100),
  allowedImageTypes: Array.isArray(row.allowed_image_types) ? row.allowed_image_types : [...IMAGE_TYPE_KEYS],
  allowedVideoTypes: Array.isArray(row.allowed_video_types) ? row.allowed_video_types : [...VIDEO_TYPE_KEYS],
  showSku: row.show_sku !== false, showStockToReps: row.show_stock_to_reps !== false,
  showLowStockWarning: row.show_low_stock_warning !== false, hideUnavailableFromReps: row.hide_unavailable_from_reps === true,
  defaultView: row.default_view === "list" ? "list" : "grid", priceFormat: row.price_format === "short" ? "short" : "full",
  unitsWord: ["pcs", "pieces"].includes(row.units_word) ? row.units_word : "units", preferredCurrency: row.preferred_currency ?? "NGN",
  notifyApprovers: row.notify_approvers !== false, notifySenders: row.notify_senders !== false,
  defaultMainImageUrl: row.default_main_image_url ?? null, defaultVideoThumbUrl: row.default_video_thumb_url ?? null,
  defaultLifestyleImageUrl: row.default_lifestyle_image_url ?? null, updatedAt: row.updated_at ?? null
} : { ...DEFAULT_SETTINGS };

async function readSettings(orgId: string, branchId: string | null): Promise<CatalogSettings> {
  if (!branchId) return { ...DEFAULT_SETTINGS };
  const { data } = await supabase.from("product_catalog_settings").select("*").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
  return mapSettings(data);
}

// ── Activity log (Settings > Audit Log, Security) ─────────
async function logEvent(orgId: string, branchId: string | null, actor: Request | null, event: { action: string; mediaId?: string | null; productId?: string | null; detail?: string }) {
  const { error } = await supabase.from("product_media_events").insert({
    org_id: orgId, branch_id: branchId ?? actor?.user?.branchId ?? null, media_id: event.mediaId ?? null, product_id: event.productId ?? null,
    action: event.action, detail: (event.detail ?? "").slice(0, 400),
    actor_id: actor?.user?.id ?? null, actor_name: actor?.user?.name ?? "Protohub"
  });
  if (error) console.warn("[product-media] event insert failed:", error.message);
}

async function approverRecipients(orgId: string) {
  const { data } = await supabase.from("users").select("id, role")
    .eq("org_id", orgId).eq("active", true).eq("is_demo", false).in("role", MEDIA_APPROVER_ROLES);
  return (data ?? []).map((user: any) => ({ id: String(user.id), role: String(user.role) }));
}
async function notify(orgId: string, branchId: string | null, recipients: Array<{ id: string; role: string }>, title: string, message: string, tag: string) {
  try {
    if (!branchId || recipients.length === 0) return;
    await deliver(orgId, branchId, recipients, { title: title.slice(0, 120), message: message.slice(0, 240), kind: "product_media", tag, link: LINK });
  } catch (error: any) { console.warn("[product-media] alert failed:", error?.message); }
}

async function removeFiles(bucket: string, paths: Array<string | null | undefined>) {
  const list = paths.filter(Boolean) as string[];
  if (list.length === 0) return;
  const { error } = await supabase.storage.from(bucket).remove(list);
  if (error) console.warn("[product-media] remove failed:", bucket, error.message);
}

const LABEL_TEXT: Record<string, string> = {
  product_in_use: "Product in use", customer_review: "Customer review", unboxing: "Unboxing",
  size: "Size / measurements", packaging: "Packaging", other: "Other"
};

function mapRow(row: any, previews: Map<string, string>) {
  const approved = row.status === "approved";
  return {
    id: row.id, productId: row.product_id, kind: row.kind, status: row.status,
    label: row.label, labelText: LABEL_TEXT[row.label] ?? "Other", caption: row.caption ?? "",
    tags: Array.isArray(row.tags) ? row.tags : [], usage: Array.isArray(row.usage) ? row.usage : [],
    batchId: row.batch_id ?? null, scan: row.scan ?? {},
    name: row.original_name ?? "", mime: row.mime ?? "", sizeBytes: Number(row.size_bytes ?? 0),
    width: row.width ?? null, height: row.height ?? null, durationSeconds: row.duration_seconds === null || row.duration_seconds === undefined ? null : Number(row.duration_seconds),
    url: approved ? row.url : previews.get(row.holding_path) ?? null,
    thumbUrl: approved ? row.thumb_url : previews.get(row.holding_thumb_path) ?? null,
    isCover: row.is_cover === true, displayOrder: Number(row.display_order ?? 0),
    uploadedBy: row.uploaded_by, uploadedByName: row.uploaded_by_name ?? "", uploadedByRole: row.uploaded_by_role ?? "",
    reviewedBy: row.reviewed_by ?? null, reviewedByName: row.reviewed_by_name ?? null, reviewedAt: row.reviewed_at ?? null, rejectReason: row.reject_reason ?? null,
    createdAt: row.created_at
  };
}

/** Short-lived links so the sender and approvers can see a file still in holding. */
async function holdingPreviews(rows: any[]) {
  const paths = rows.filter((row) => row.status === "pending").flatMap((row) => [row.holding_path, row.holding_thumb_path]).filter(Boolean);
  const previews = new Map<string, string>();
  if (paths.length === 0) return previews;
  const { data } = await supabase.storage.from(HOLD).createSignedUrls(paths, PREVIEW_SECONDS);
  for (const item of data ?? []) if (item.path && item.signedUrl) previews.set(item.path, item.signedUrl);
  return previews;
}

const cleanTags = (tags: unknown) => Array.from(new Set((Array.isArray(tags) ? tags : [])
  .map((tag) => String(tag ?? "").replace(/[<>"'`]/g, "").replace(/\s+/g, " ").trim().slice(0, 24)).filter(Boolean))).slice(0, 8);

// ── GET /api/product-media ────────────────────────────────
// Approved media for everyone; pending and reviewed for their sender, and
// for approvers (reviewed ones only from the last 30 days).
router.get("/", async (req, res) => {
  try {
    const orgId = orgOf(req);
    const approver = canApproveMedia(roleOf(req));
    const approved = await supabase.from("product_media").select("*").eq("org_id", orgId).eq("status", "approved")
      .order("display_order").order("created_at", { ascending: false }).limit(5000);
    if (approved.error) throw approved.error;
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    let review = supabase.from("product_media").select("*").eq("org_id", orgId).in("status", ["pending", ...REVIEWED])
      .order("created_at", { ascending: false }).limit(800);
    review = approver ? review.or(`status.eq.pending,created_at.gte.${since}`) : review.eq("uploaded_by", req.user!.id);
    const reviewRows = await review;
    if (reviewRows.error) throw reviewRows.error;
    // Approved-by-approver counts for "Approved today" also come from here.
    const rows = [...(approved.data ?? []), ...(reviewRows.data ?? [])];
    const previews = await holdingPreviews(rows);
    const settings = await readSettings(orgId, branchOf(req));
    res.json({
      media: rows.map((row) => mapRow(row, previews)),
      canApprove: approver,
      canSend: canSendMedia(roleOf(req)) && (approver || settings.repUploadsEnabled),
      repUploadsEnabled: settings.repUploadsEnabled,
      settings
    });
  } catch (error) { sendError(res, error, "Could not load the media gallery."); }
});

// ── POST /api/product-media/uploads ───────────────────────
const UploadSchema = z.object({
  productId: z.string().uuid(),
  mime: z.string().max(60),
  size: z.number().int().positive(),
  name: z.string().max(400).optional(),
  label: z.enum(MEDIA_LABELS).default("other"),
  caption: z.string().max(300).optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  batchId: z.string().uuid().optional()
});
router.post("/uploads", async (req, res) => {
  try {
    const parsed = UploadSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const body = parsed.data;
    const orgId = orgOf(req);
    const role = roleOf(req);
    const approver = canApproveMedia(role);
    const settings = await readSettings(orgId, branchOf(req));
    if (!canSendMedia(role)) throw fail(403, "Your role cannot add photos or videos.");
    if (!approver && !settings.repUploadsEnabled) throw fail(403, "Sending media is switched off for now. Ask an Owner, Admin or Manager.");
    const mime = body.mime.toLowerCase();
    const kind = ACCEPTED_TYPES[mime];
    if (!kind) throw fail(415, "Only photos (JPG, PNG, WEBP) and videos (MP4, MOV, WEBM) can be added.");
    const allowed = kind === "image" ? settings.allowedImageTypes : settings.allowedVideoTypes;
    if (!allowed.includes(TYPE_KEYS[mime])) throw fail(415, `${TYPE_KEYS[mime].toUpperCase()} files are switched off in Settings. Allowed: ${allowed.map((key) => key.toUpperCase()).join(", ") || "none"}.`);
    const maxBytes = (kind === "image" ? settings.maxImageMb : settings.maxVideoMb) * 1024 * 1024;
    if (body.size > maxBytes) throw fail(413, kind === "image" ? `Photos must be ${settings.maxImageMb} MB or smaller.` : `Videos must be ${settings.maxVideoMb} MB or smaller.`);

    const { data: product, error: productError } = await supabase.from("products").select("id, branch_id").eq("org_id", orgId).eq("id", body.productId).maybeSingle();
    if (productError) throw productError;
    if (!product) throw fail(404, "That product was not found.");

    // Links handed out but never finished: clear this person's old ones.
    const stale = await supabase.from("product_media").select("id, holding_path").eq("uploaded_by", req.user!.id).eq("status", "uploading")
      .lt("created_at", new Date(Date.now() - 86400000).toISOString()).limit(100);
    if (stale.data?.length) {
      await removeFiles(HOLD, stale.data.map((row: any) => row.holding_path));
      await supabase.from("product_media").delete().in("id", stale.data.map((row: any) => row.id));
    }
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    const [{ count: lastHour }, { count: waiting }] = await Promise.all([
      supabase.from("product_media").select("id", { count: "exact", head: true }).eq("uploaded_by", req.user!.id).gte("created_at", hourAgo),
      supabase.from("product_media").select("id", { count: "exact", head: true }).eq("uploaded_by", req.user!.id).eq("status", "pending")
    ]);
    if ((lastHour ?? 0) >= UPLOADS_PER_HOUR) throw fail(429, `You can add up to ${UPLOADS_PER_HOUR} files an hour. Try again a little later.`);
    if (!approver && (waiting ?? 0) >= MAX_PENDING_PER_PERSON) throw fail(429, `You already have ${MAX_PENDING_PER_PERSON} files waiting for approval. Wait for those to be reviewed first.`);

    const id = randomUUID();
    const holdingPath = `${orgId}/${id}/original`;
    const { error: insertError } = await supabase.from("product_media").insert({
      id, org_id: orgId, branch_id: product.branch_id ?? branchOf(req), product_id: product.id, kind, status: "uploading",
      label: body.label, caption: (body.caption ?? "").trim().slice(0, 300), tags: cleanTags(body.tags), batch_id: body.batchId ?? null,
      original_name: cleanFileName(body.name), mime, size_bytes: body.size, holding_path: holdingPath,
      uploaded_by: req.user!.id, uploaded_by_name: req.user!.name ?? "", uploaded_by_role: role
    });
    if (insertError) throw insertError;
    const { data: signed, error: signError } = await supabase.storage.from(HOLD).createSignedUploadUrl(holdingPath);
    if (signError) throw signError;
    res.status(201).json({ id, signedUrl: signed.signedUrl });
  } catch (error) { sendError(res, error, "Could not start the upload."); }
});

// ── Checking a file ───────────────────────────────────────
async function readHoldingStart(path: string): Promise<{ head: Uint8Array; total: number }> {
  const { data: signed, error } = await supabase.storage.from(HOLD).createSignedUrl(path, 120);
  if (error || !signed?.signedUrl) throw fail(422, "The file did not arrive. Try sending it again.");
  // ⚠️ Size first, then only bytes that exist: asking storage for a range past
  // the end of a small file makes it hang instead of answering short.
  const sized = await fetch(signed.signedUrl, { method: "HEAD", signal: AbortSignal.timeout(15000) });
  const total = Number(sized.headers.get("content-length") ?? 0);
  if (!sized.ok || !Number.isFinite(total) || total <= 0) throw fail(422, "The file did not arrive. Try sending it again.");
  const response = await fetch(signed.signedUrl, { headers: { Range: `bytes=0-${Math.min(total, SNIFF_BYTES) - 1}` }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw fail(422, "The file did not arrive. Try sending it again.");
  return { head: new Uint8Array(await response.arrayBuffer()), total };
}

/** Plain-words record of what the check found, shown in the Approval Queue. */
function scanRecord(realType: RealMediaType, total: number, maxBytes: number, cleaned: boolean) {
  const label = `${TYPE_KEYS[realType].toUpperCase()}`;
  return {
    passed: true,
    fileType: `Valid (${label})`,
    fileSize: `Within limit (${total >= 1048576 ? `${(total / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(total / 1024))} KB`} / ${Math.round(maxBytes / 1048576)} MB)`,
    contentCheck: cleaned ? "Clean copy made" : "Real video file",
    suspiciousCode: "None found",
    checkedAt: new Date().toISOString()
  };
}

async function putHolding(path: string, body: Buffer, contentType: string) {
  const { error } = await supabase.storage.from(HOLD).upload(path, body, { contentType, upsert: true });
  if (error) throw error;
}

/** A redrawn photo: rotated upright, shrunk, saved fresh, nothing else kept. */
async function cleanImage(input: Buffer, edge: number, quality: number) {
  const { data, info } = await sharp(input, { limitInputPixels: 60_000_000, failOn: "error" })
    .rotate()
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function approveRow(row: any, reviewer: Request | null) {
  const ext = row.kind === "image" ? "webp" : extensionOf(row.mime as RealMediaType) ?? "mp4";
  const publicPath = `${row.org_id}/${row.product_id}/${row.id}.${ext}`;
  const publicThumb = row.holding_thumb_path ? `${row.org_id}/${row.product_id}/${row.id}-thumb.webp` : null;
  const copy = async (from: string, to: string) => {
    const { error } = await supabase.storage.from(HOLD).copy(from, to, { destinationBucket: PUBLIC });
    if (error) throw error;
  };
  await copy(row.holding_path, publicPath);
  if (publicThumb) await copy(row.holding_thumb_path, publicThumb);
  const url = supabase.storage.from(PUBLIC).getPublicUrl(publicPath).data.publicUrl;
  const thumbUrl = publicThumb ? supabase.storage.from(PUBLIC).getPublicUrl(publicThumb).data.publicUrl : row.kind === "image" ? url : null;
  const { count } = await supabase.from("product_media").select("id", { count: "exact", head: true }).eq("product_id", row.product_id).eq("status", "approved");
  const { data: updated, error } = await supabase.from("product_media").update({
    status: "approved", public_path: publicPath, public_thumb_path: publicThumb, url, thumb_url: thumbUrl,
    holding_path: null, holding_thumb_path: null, display_order: count ?? 0,
    reviewed_by: reviewer ? reviewer.user!.id : row.uploaded_by,
    reviewed_by_name: reviewer ? reviewer.user!.name ?? "" : row.uploaded_by_name,
    reviewed_at: new Date().toISOString()
  }).eq("id", row.id).select("*").single();
  if (error) throw error;
  await removeFiles(HOLD, [row.holding_path, row.holding_thumb_path]);
  return updated;
}

const CompleteSchema = z.object({
  posterDataUrl: z.string().max(4_000_000).optional(),
  durationSeconds: z.number().min(0).max(36000).optional()
});

router.post("/:id/complete", async (req, res) => {
  const orgId = orgOf(req);
  if (!UUID.test(String(req.params.id))) { res.status(404).json({ error: "That upload was not found." }); return; }
  const { data: row } = await supabase.from("product_media").select("*").eq("org_id", orgId).eq("id", req.params.id).maybeSingle();
  if (!row || row.uploaded_by !== req.user!.id || row.status !== "uploading") { res.status(404).json({ error: "That upload was not found." }); return; }
  const discard = async (reason: string) => {
    await removeFiles(HOLD, [row.holding_path, `${orgId}/${row.id}/main.webp`, `${orgId}/${row.id}/thumb.webp`]);
    await supabase.from("product_media").delete().eq("id", row.id);
    await logEvent(orgId, row.branch_id, req, { action: "refused", productId: row.product_id, detail: `${row.original_name}: ${reason}` });
  };
  try {
    const parsed = CompleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw fail(400, "The file details were not valid. Try sending it again.");
    const settings = await readSettings(orgId, row.branch_id ?? branchOf(req));
    const { head, total } = await readHoldingStart(row.holding_path);
    const realType = sniffMediaType(head);
    if (!realType) throw fail(422, "This file is not a real photo or video, so it was refused and deleted.");
    const kind = kindOf(realType);
    if (kind !== row.kind) throw fail(422, "The file inside does not match what was sent, so it was refused and deleted.");
    const maxBytes = (kind === "image" ? settings.maxImageMb : settings.maxVideoMb) * 1024 * 1024;
    if (total > maxBytes) throw fail(413, kind === "image" ? `Photos must be ${settings.maxImageMb} MB or smaller.` : `Videos must be ${settings.maxVideoMb} MB or smaller.`);

    const patch: Record<string, unknown> = { mime: realType, size_bytes: total, scan: scanRecord(realType, total, maxBytes, kind === "image") };
    if (kind === "image") {
      const { data: blob, error } = await supabase.storage.from(HOLD).download(row.holding_path);
      if (error || !blob) throw fail(422, "The file did not arrive. Try sending it again.");
      const original = Buffer.from(await blob.arrayBuffer());
      const main = await cleanImage(original, IMAGE_MAX_EDGE, 82).catch(() => { throw fail(422, "This photo could not be opened, so it was refused and deleted."); });
      const thumb = await cleanImage(main.data, THUMB_EDGE, 72);
      const mainPath = `${orgId}/${row.id}/main.webp`;
      const thumbPath = `${orgId}/${row.id}/thumb.webp`;
      await putHolding(mainPath, main.data, "image/webp");
      await putHolding(thumbPath, thumb.data, "image/webp");
      await removeFiles(HOLD, [row.holding_path]);
      Object.assign(patch, { holding_path: mainPath, holding_thumb_path: thumbPath, width: main.width, height: main.height, size_bytes: main.data.length, mime: "image/webp" });
    } else {
      // The video is kept as sent: re-encoding 100 MB clips needs far more
      // memory than the server has. It is only ever served as a video.
      const poster = parsed.data.posterDataUrl?.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (poster) {
        const thumb = await cleanImage(Buffer.from(poster[2], "base64"), THUMB_EDGE, 72).catch(() => null);
        if (thumb) {
          const thumbPath = `${orgId}/${row.id}/thumb.webp`;
          await putHolding(thumbPath, thumb.data, "image/webp");
          Object.assign(patch, { holding_thumb_path: thumbPath, width: thumb.width, height: thumb.height });
        }
      }
      if (parsed.data.durationSeconds !== undefined) patch.duration_seconds = Math.round(parsed.data.durationSeconds * 10) / 10;
    }

    const goesStraightIn = canApproveMedia(roleOf(req)) || !settings.requireApproval;
    const { data: checked, error: updateError } = await supabase.from("product_media").update({ ...patch, status: "pending" }).eq("id", row.id).select("*").single();
    if (updateError) throw updateError;
    await logEvent(orgId, checked.branch_id, req, { action: "uploaded", mediaId: row.id, productId: row.product_id, detail: row.original_name });
    if (goesStraightIn) {
      const done = await approveRow(checked, req);
      res.json({ media: mapRow(done, new Map()) });
      return;
    }
    if (settings.notifyApprovers) {
      const { data: product } = await supabase.from("products").select("name").eq("id", row.product_id).maybeSingle();
      await notify(orgId, checked.branch_id ?? branchOf(req), (await approverRecipients(orgId)).filter((user) => user.id !== req.user!.id),
        `New ${kind === "image" ? "photo" : "video"} to approve`, `${req.user!.name ?? "A team member"} sent a ${kind === "image" ? "photo" : "video"} for ${product?.name ?? "a product"}.`, `media-${row.batch_id ?? row.id}`);
    }
    res.json({ media: mapRow(checked, await holdingPreviews([checked])) });
  } catch (error: any) {
    await discard(error?.message ?? "could not be checked");
    sendError(res, error, "Could not check the file. It was deleted; try sending it again.");
  }
});

async function loadRow(req: Request, id = String(req.params.id)) {
  if (!UUID.test(id)) throw fail(404, "That file was not found.");
  const { data: row, error } = await supabase.from("product_media").select("*").eq("org_id", orgOf(req)).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!row) throw fail(404, "That file was not found.");
  return row;
}

async function tellSender(req: Request, row: any, title: string, message: string) {
  if (!row.uploaded_by || row.uploaded_by === req.user!.id) return;
  const settings = await readSettings(orgOf(req), row.branch_id);
  if (!settings.notifySenders) return;
  await notify(orgOf(req), row.branch_id, [{ id: row.uploaded_by, role: row.uploaded_by_role }], title, message, `media-${row.id}`);
}

async function approveOne(req: Request, row: any) {
  if (row.status !== "pending") throw fail(409, "This file is no longer waiting for approval.");
  const done = await approveRow(row, req);
  await logEvent(orgOf(req), row.branch_id, req, { action: "approved", mediaId: row.id, productId: row.product_id, detail: row.original_name });
  await tellSender(req, row, `Your ${row.kind === "image" ? "photo" : "video"} was approved`, `${row.original_name || "Your file"} is now in the product gallery.`);
  return done;
}

async function declineOne(req: Request, row: any, reason: string, status: "rejected" | "changes_requested") {
  if (row.status !== "pending") throw fail(409, "This file is no longer waiting for approval.");
  await removeFiles(HOLD, [row.holding_path, row.holding_thumb_path]);
  const { data: done, error } = await supabase.from("product_media").update({
    status, reject_reason: reason, holding_path: null, holding_thumb_path: null,
    reviewed_by: req.user!.id, reviewed_by_name: req.user!.name ?? "", reviewed_at: new Date().toISOString()
  }).eq("id", row.id).select("*").single();
  if (error) throw error;
  await logEvent(orgOf(req), row.branch_id, req, { action: status, mediaId: row.id, productId: row.product_id, detail: `${row.original_name}: ${reason}` });
  await tellSender(req, row, status === "rejected" ? `Your ${row.kind === "image" ? "photo" : "video"} was not approved` : `Changes asked for your ${row.kind === "image" ? "photo" : "video"}`,
    `${row.original_name || "Your file"}: ${reason}`);
  return done;
}

async function deleteOne(req: Request, row: any) {
  await removeFiles(HOLD, [row.holding_path, row.holding_thumb_path]);
  await removeFiles(PUBLIC, [row.public_path, row.public_thumb_path]);
  const { error } = await supabase.from("product_media").delete().eq("id", row.id);
  if (error) throw error;
  await logEvent(orgOf(req), row.branch_id, req, { action: "deleted", mediaId: row.id, productId: row.product_id, detail: row.original_name });
}

router.post("/:id/approve", async (req, res) => {
  try {
    requireApprover(req, "approve media");
    res.json({ media: mapRow(await approveOne(req, await loadRow(req)), new Map()) });
  } catch (error) { sendError(res, error, "Could not approve the file."); }
});

router.post("/:id/reject", async (req, res) => {
  try {
    requireApprover(req, "reject media");
    const reason = String(req.body?.reason ?? "").trim().slice(0, 300);
    if (!reason) throw fail(400, "Say why, so the sender knows what to fix.");
    res.json({ media: mapRow(await declineOne(req, await loadRow(req), reason, "rejected"), new Map()) });
  } catch (error) { sendError(res, error, "Could not reject the file."); }
});

router.post("/:id/request-changes", async (req, res) => {
  try {
    requireApprover(req, "ask for changes");
    const note = String(req.body?.note ?? "").trim().slice(0, 300);
    if (!note) throw fail(400, "Say what to change.");
    res.json({ media: mapRow(await declineOne(req, await loadRow(req), note, "changes_requested"), new Map()) });
  } catch (error) { sendError(res, error, "Could not send the request."); }
});

// Check a waiting file again (the Approval Queue's "Rescan").
router.post("/:id/rescan", async (req, res) => {
  try {
    requireApprover(req, "check files");
    const row = await loadRow(req);
    if (row.status !== "pending" || !row.holding_path) throw fail(409, "Only files waiting for approval can be checked again.");
    const settings = await readSettings(orgOf(req), row.branch_id);
    const { head, total } = await readHoldingStart(row.holding_path);
    const realType = sniffMediaType(head);
    const maxBytes = (row.kind === "image" ? settings.maxImageMb : settings.maxVideoMb) * 1024 * 1024;
    if (!realType || kindOf(realType) !== row.kind || total > maxBytes) {
      const done = await declineOne(req, row, "Failed the safety check", "rejected");
      res.status(422).json({ error: "The file failed the check and was removed.", media: mapRow(done, new Map()) });
      return;
    }
    const { data: done, error } = await supabase.from("product_media").update({ scan: scanRecord(realType, total, maxBytes, row.kind === "image") }).eq("id", row.id).select("*").single();
    if (error) throw error;
    res.json({ media: mapRow(done, await holdingPreviews([done])) });
  } catch (error) { sendError(res, error, "Could not check the file."); }
});

// Several at once: approve, reject or delete (Approval Queue / Media Library ticks).
const BulkSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100), action: z.enum(["approve", "reject", "delete", "tag"]), reason: z.string().max(300).optional(), tag: z.string().max(24).optional() });
router.post("/bulk", async (req, res) => {
  try {
    requireApprover(req, "change several files at once");
    const parsed = BulkSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const { ids, action } = parsed.data;
    const reason = (parsed.data.reason ?? "").trim();
    if (action === "reject" && !reason) throw fail(400, "Say why, so the senders know what to fix.");
    const tag = cleanTags([parsed.data.tag])[0];
    if (action === "tag" && !tag) throw fail(400, "Type a tag.");
    const done: any[] = [];
    const skipped: string[] = [];
    for (const id of ids) {
      try {
        const row = await loadRow(req, id);
        if (action === "approve") done.push(mapRow(await approveOne(req, row), new Map()));
        else if (action === "reject") done.push(mapRow(await declineOne(req, row, reason, "rejected"), new Map()));
        else if (action === "delete") { await deleteOne(req, row); done.push({ id, deleted: true }); }
        else {
          const { data: next } = await supabase.from("product_media").update({ tags: cleanTags([...(row.tags ?? []), tag]) }).eq("id", row.id).select("*").single();
          done.push(mapRow(next, await holdingPreviews([next])));
        }
      } catch { skipped.push(id); }
    }
    res.json({ done, skipped });
  } catch (error) { sendError(res, error, "Could not change the files."); }
});

// ── PATCH /api/product-media/:id ──────────────────────────
const PatchSchema = z.object({
  label: z.enum(MEDIA_LABELS).optional(),
  caption: z.string().max(300).optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  usage: z.array(z.enum(MEDIA_USAGE)).max(4).optional(),
  isCover: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(100000).optional()
});
router.patch("/:id", async (req, res) => {
  try {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const row = await loadRow(req);
    const approver = canApproveMedia(roleOf(req));
    const ownWaiting = row.uploaded_by === req.user!.id && row.status === "pending";
    if (!approver && !ownWaiting) throw fail(403, "Only an Owner, Admin or Manager can change gallery files.");
    if (!approver && (parsed.data.isCover !== undefined || parsed.data.displayOrder !== undefined || parsed.data.usage !== undefined)) throw fail(403, "Only an Owner, Admin or Manager can change that.");
    const patch: Record<string, unknown> = {};
    if (parsed.data.label) patch.label = parsed.data.label;
    if (parsed.data.caption !== undefined) patch.caption = parsed.data.caption.trim();
    if (parsed.data.tags !== undefined) patch.tags = cleanTags(parsed.data.tags);
    if (parsed.data.usage !== undefined) patch.usage = parsed.data.usage;
    if (parsed.data.displayOrder !== undefined) patch.display_order = parsed.data.displayOrder;
    if (parsed.data.isCover !== undefined) {
      if (parsed.data.isCover && row.status !== "approved") throw fail(409, "Only an approved file can be the cover.");
      if (parsed.data.isCover) await supabase.from("product_media").update({ is_cover: false }).eq("product_id", row.product_id).eq("is_cover", true);
      patch.is_cover = parsed.data.isCover;
    }
    const { data: done, error } = await supabase.from("product_media").update(patch).eq("id", row.id).select("*").single();
    if (error) throw error;
    if (approver) await logEvent(orgOf(req), row.branch_id, req, { action: "updated", mediaId: row.id, productId: row.product_id, detail: `${row.original_name}: ${Object.keys(patch).join(", ")}` });
    res.json({ media: mapRow(done, await holdingPreviews([done])) });
  } catch (error) { sendError(res, error, "Could not save the change."); }
});

// ── DELETE /api/product-media/:id ─────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const row = await loadRow(req);
    const approver = canApproveMedia(roleOf(req));
    const ownNotLive = row.uploaded_by === req.user!.id && row.status !== "approved";
    if (!approver && !ownNotLive) throw fail(403, "Only an Owner, Admin or Manager can delete gallery files.");
    await deleteOne(req, row);
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not delete the file."); }
});

// ── Settings ──────────────────────────────────────────────
router.get("/settings", async (req, res) => {
  try { res.json(await readSettings(orgOf(req), branchOf(req))); }
  catch (error) { sendError(res, error, "Could not load settings."); }
});
const SettingsSchema = z.object({
  repUploadsEnabled: z.boolean(), requireApproval: z.boolean(),
  maxImageMb: z.number().int().min(1).max(10), maxVideoMb: z.number().int().min(5).max(100),
  allowedImageTypes: z.array(z.enum(IMAGE_TYPE_KEYS as [string, ...string[]])).max(3),
  allowedVideoTypes: z.array(z.enum(VIDEO_TYPE_KEYS as [string, ...string[]])).max(3),
  showSku: z.boolean(), showStockToReps: z.boolean(), showLowStockWarning: z.boolean(), hideUnavailableFromReps: z.boolean(),
  defaultView: z.enum(["grid", "list"]), priceFormat: z.enum(["full", "short"]), unitsWord: z.enum(["units", "pcs", "pieces"]),
  preferredCurrency: z.string().trim().min(3).max(3),
  notifyApprovers: z.boolean(), notifySenders: z.boolean()
}).partial();
router.put("/settings", async (req, res) => {
  try {
    requireApprover(req, "change these settings");
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const branchId = branchOf(req);
    if (!branchId) throw fail(400, "Choose a branch first.");
    const next = { ...(await readSettings(orgOf(req), branchId)), ...parsed.data };
    const { error } = await supabase.from("product_catalog_settings").upsert({
      branch_id: branchId, org_id: orgOf(req),
      rep_uploads_enabled: next.repUploadsEnabled, require_approval: next.requireApproval,
      max_image_mb: next.maxImageMb, max_video_mb: next.maxVideoMb,
      allowed_image_types: next.allowedImageTypes, allowed_video_types: next.allowedVideoTypes,
      show_sku: next.showSku, show_stock_to_reps: next.showStockToReps, show_low_stock_warning: next.showLowStockWarning,
      hide_unavailable_from_reps: next.hideUnavailableFromReps, default_view: next.defaultView, price_format: next.priceFormat,
      units_word: next.unitsWord, preferred_currency: next.preferredCurrency.toUpperCase(),
      notify_approvers: next.notifyApprovers, notify_senders: next.notifySenders,
      default_main_image_url: next.defaultMainImageUrl, default_video_thumb_url: next.defaultVideoThumbUrl, default_lifestyle_image_url: next.defaultLifestyleImageUrl,
      updated_by: req.user!.id, updated_at: new Date().toISOString()
    }, { onConflict: "branch_id" });
    if (error) throw error;
    await logEvent(orgOf(req), branchId, req, { action: "settings_changed", detail: Object.keys(parsed.data).join(", ") });
    res.json(await readSettings(orgOf(req), branchId));
  } catch (error) { sendError(res, error, "Could not save settings."); }
});

// Default pictures for products without media (Settings > Default Product Images).
const DEFAULT_SLOTS: Record<string, string> = { main: "default_main_image_url", video: "default_video_thumb_url", lifestyle: "default_lifestyle_image_url" };
router.post("/settings/default-image", async (req, res) => {
  try {
    requireApprover(req, "change default pictures");
    const branchId = branchOf(req);
    if (!branchId) throw fail(400, "Choose a branch first.");
    const slot = String(req.body?.slot ?? "");
    const column = DEFAULT_SLOTS[slot];
    if (!column) throw fail(400, "Unknown picture slot.");
    let url: string | null = null;
    if (req.body?.dataUrl) {
      const match = String(req.body.dataUrl).match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) throw fail(415, "Use a JPG, PNG or WEBP picture.");
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length > 10 * 1024 * 1024) throw fail(413, "Pictures must be 10 MB or smaller.");
      if (!sniffMediaType(new Uint8Array(buffer.subarray(0, 64)))?.startsWith("image/")) throw fail(422, "This is not a real picture.");
      const clean = await cleanImage(buffer, 1200, 82).catch(() => { throw fail(422, "This picture could not be opened."); });
      const path = `${orgOf(req)}/defaults/${branchId}-${slot}-${Date.now()}.webp`;
      const { error } = await supabase.storage.from(PUBLIC).upload(path, clean.data, { contentType: "image/webp", upsert: true });
      if (error) throw error;
      url = supabase.storage.from(PUBLIC).getPublicUrl(path).data.publicUrl;
    }
    const current = await readSettings(orgOf(req), branchId);
    const { error } = await supabase.from("product_catalog_settings").upsert({
      branch_id: branchId, org_id: orgOf(req),
      rep_uploads_enabled: current.repUploadsEnabled, require_approval: current.requireApproval,
      [column]: url, updated_by: req.user!.id, updated_at: new Date().toISOString()
    }, { onConflict: "branch_id" });
    if (error) throw error;
    res.json(await readSettings(orgOf(req), branchId));
  } catch (error) { sendError(res, error, "Could not save the picture."); }
});

// ── Activity log ──────────────────────────────────────────
router.get("/events", async (req, res) => {
  try {
    requireApprover(req, "see the activity log");
    let query = supabase.from("product_media_events").select("*").eq("org_id", orgOf(req)).order("created_at", { ascending: false }).limit(200);
    if (req.query.action) query = query.eq("action", String(req.query.action));
    const { data, error } = await query;
    if (error) throw error;
    res.json({ events: (data ?? []).map((row: any) => ({ id: row.id, action: row.action, detail: row.detail, actorName: row.actor_name, productId: row.product_id, mediaId: row.media_id, createdAt: row.created_at })) });
  } catch (error) { sendError(res, error, "Could not load the activity log."); }
});

// ── Stock movements (Stock Overview > Recent Stock Movements) ───
router.get("/stock-movements", async (req, res) => {
  try {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    let query = supabase.from("stock_movements").select("id, product_id, product_name, type, qty, by_name, note, created_at, from_location, to_location")
      .eq("org_id", orgOf(req)).order("created_at", { ascending: false }).limit(Math.min(200, Number(req.query.limit ?? 50) || 50));
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("created_at", `${from}T00:00:00+01:00`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("created_at", `${to}T23:59:59+01:00`);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ movements: (data ?? []).map((row: any) => ({ id: row.id, productId: row.product_id, productName: row.product_name, type: row.type, qty: Number(row.qty ?? 0), byName: row.by_name ?? "", note: row.note ?? "", from: row.from_location ?? null, to: row.to_location ?? null, createdAt: row.created_at })) });
  } catch (error) { sendError(res, error, "Could not load stock movements."); }
});

// ── Categories ────────────────────────────────────────────
// Order checked for colour-blind separation (dataviz validator, light + dark).
const CATEGORY_COLORS = ["blue", "amber", "violet", "emerald", "rose", "cyan", "orange", "slate"] as const;
const CATEGORY_ICONS = ["grid", "bath", "brush", "kitchen", "shirt", "heart", "home", "gift", "box", "sparkles", "wrench", "baby"] as const;
const CategorySchema = z.object({
  name: z.string().trim().min(1).max(40), color: z.enum(CATEGORY_COLORS).optional(), icon: z.enum(CATEGORY_ICONS).optional(),
  description: z.string().trim().max(200).optional(), active: z.boolean().optional()
});
const mapCategory = (row: any) => ({ id: row.id, name: row.name, color: row.color, icon: row.icon ?? "grid", description: row.description ?? "", active: row.active !== false, displayOrder: row.display_order, createdAt: row.created_at });
const duplicateName = (error: any) => error?.code === "23505";

router.get("/categories", async (req, res) => {
  try {
    const { data, error } = await supabase.from("product_categories").select("*").eq("org_id", orgOf(req)).order("display_order").order("name");
    if (error) throw error;
    res.json({ categories: (data ?? []).map(mapCategory) });
  } catch (error) { sendError(res, error, "Could not load categories."); }
});
router.post("/categories", async (req, res) => {
  try {
    requireApprover(req, "manage categories");
    const parsed = CategorySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const branchId = branchOf(req);
    if (!branchId) throw fail(400, "Choose a branch first.");
    const { count } = await supabase.from("product_categories").select("id", { count: "exact", head: true }).eq("org_id", orgOf(req));
    const { data, error } = await supabase.from("product_categories").insert({
      org_id: orgOf(req), branch_id: branchId, name: parsed.data.name, description: parsed.data.description ?? "",
      icon: parsed.data.icon ?? "grid", active: parsed.data.active ?? true,
      color: parsed.data.color ?? CATEGORY_COLORS[(count ?? 0) % CATEGORY_COLORS.length], display_order: count ?? 0
    }).select("*").single();
    if (duplicateName(error)) throw fail(409, "A category with that name already exists.");
    if (error) throw error;
    await logEvent(orgOf(req), branchId, req, { action: "category_added", detail: parsed.data.name });
    res.status(201).json({ category: mapCategory(data) });
  } catch (error) { sendError(res, error, "Could not add the category."); }
});
router.patch("/categories/:id", async (req, res) => {
  try {
    requireApprover(req, "manage categories");
    if (!UUID.test(String(req.params.id))) throw fail(404, "That category was not found.");
    const parsed = CategorySchema.partial().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const { data, error } = await supabase.from("product_categories").update(parsed.data).eq("org_id", orgOf(req)).eq("id", req.params.id).select("*").maybeSingle();
    if (duplicateName(error)) throw fail(409, "A category with that name already exists.");
    if (error) throw error;
    if (!data) throw fail(404, "That category was not found.");
    res.json({ category: mapCategory(data) });
  } catch (error) { sendError(res, error, "Could not save the category."); }
});
router.delete("/categories/:id", async (req, res) => {
  try {
    requireApprover(req, "manage categories");
    if (!UUID.test(String(req.params.id))) throw fail(404, "That category was not found.");
    // Products keep working: their category is simply cleared (on delete set null).
    const { data } = await supabase.from("product_categories").select("name").eq("org_id", orgOf(req)).eq("id", req.params.id).maybeSingle();
    const { error } = await supabase.from("product_categories").delete().eq("org_id", orgOf(req)).eq("id", req.params.id);
    if (error) throw error;
    await logEvent(orgOf(req), branchOf(req), req, { action: "category_deleted", detail: data?.name ?? "" });
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not delete the category."); }
});
const AssignSchema = z.object({ productIds: z.array(z.string().uuid()).min(1).max(500), categoryId: z.string().uuid().nullable() });
router.post("/categories/assign", async (req, res) => {
  try {
    requireApprover(req, "set categories");
    const parsed = AssignSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    if (parsed.data.categoryId) {
      const { data: category } = await supabase.from("product_categories").select("id").eq("org_id", orgOf(req)).eq("id", parsed.data.categoryId).maybeSingle();
      if (!category) throw fail(404, "That category was not found.");
    }
    const { data, error } = await supabase.from("products").update({ category_id: parsed.data.categoryId })
      .eq("org_id", orgOf(req)).in("id", parsed.data.productIds).select("id");
    if (error) throw error;
    res.json({ updated: (data ?? []).length });
  } catch (error) { sendError(res, error, "Could not set the category."); }
});

// ── Total Units trend ─────────────────────────────────────
// No stock history existed before 17 Oct 2026, so the cards keep their own:
// the total shown is saved once per day when a manager opens the page.
router.get("/stock-trend", async (req, res) => {
  try {
    const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await supabase.from("product_stock_daily").select("day, total_units").eq("org_id", orgOf(req)).gte("day", since).order("day");
    if (error) throw error;
    res.json({ days: (data ?? []).map((row: any) => ({ day: row.day, totalUnits: Number(row.total_units ?? 0) })) });
  } catch (error) { sendError(res, error, "Could not load the stock trend."); }
});
router.post("/stock-trend", async (req, res) => {
  try {
    if (!canApproveMedia(roleOf(req))) { res.json({ ok: false }); return; }
    const branchId = branchOf(req);
    const totalUnits = Number(req.body?.totalUnits);
    if (!branchId || !Number.isFinite(totalUnits) || totalUnits < 0) throw fail(400, "Send the total units.");
    const day = new Date(Date.now() + 3600000).toISOString().slice(0, 10); // Lagos day (UTC+1)
    const { error } = await supabase.from("product_stock_daily").upsert({
      org_id: orgOf(req), branch_id: branchId, day, total_units: Math.round(totalUnits), updated_at: new Date().toISOString()
    }, { onConflict: "branch_id,day" });
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) { sendError(res, error, "Could not save the stock total."); }
});

export default router;
