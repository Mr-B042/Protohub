import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { deliver, leadershipRecipients } from "../lib/weekly-report-notifications.js";

// Report a Bug / Send Feedback (Bright, 9 Oct 2026).
//
// Anyone signed in can send a report. Only the Owner reads them and sets a
// status; a reporter who ticked "Send me updates" gets a bell entry and a
// phone push each time the status changes. Screenshots go to the private
// "bug-report-files" bucket and are opened through short-lived links.
//
// ⚠️ A failed alert never fails the report: the row is the record.

const router = Router();
router.use(requireAuth);

const BUCKET = "bug-report-files";
const MIME: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"
};
const MAX_FILE = 10 * 1024 * 1024;
const KIND_LABEL: Record<string, string> = { issue: "Bug / technical issue", feature: "Feature suggestion", ux: "UI/UX feedback", other: "Other" };
const STATUS_LABEL: Record<string, string> = { new: "Received", looking: "Being looked into", fixed: "Fixed", wont_fix: "Won't be changed" };
const LINK = "/dashboard/admin/report-a-bug";

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const sendError = (res: any, error: any, fallback: string) => {
  const status = Number(error?.status) || 500;
  res.status(status).json({ error: status === 500 ? (error?.message ?? fallback) : error.message });
};

const mapRow = (row: any) => ({
  id: row.id,
  reporterId: row.reporter_id,
  reporterName: row.reporter_name,
  reporterRole: row.reporter_role,
  kind: row.kind,
  title: row.title,
  description: row.description,
  module: row.module,
  page: row.page,
  steps: row.steps ?? [],
  attachments: (Array.isArray(row.attachments) ? row.attachments : []).map((file: any) => ({ path: file.path, name: file.name, mime: file.mime, size: file.size })),
  wantsUpdates: row.wants_updates,
  status: row.status,
  ownerNote: row.owner_note,
  statusChangedAt: row.status_changed_at,
  createdAt: row.created_at
});

const CreateSchema = z.object({
  kind: z.enum(["issue", "feature", "ux", "other"]),
  title: z.string().trim().min(1, "Give a short title.").max(100),
  description: z.string().trim().min(1, "Describe the issue.").max(1000),
  module: z.string().trim().min(1, "Choose where this happened.").max(80),
  page: z.string().trim().max(80).optional(),
  steps: z.array(z.string().trim().max(200)).max(10).default([]),
  wantsUpdates: z.boolean().default(true),
  files: z.array(z.object({ name: z.string().trim().max(160).default("screenshot"), dataUrl: z.string().min(20) })).max(6).default([])
});

router.post("/", async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const body = parsed.data;
  try {
    const orgId = req.user!.orgId;
    // Read every file before saving anything, so a bad file never leaves half a report.
    const files = body.files.map((file) => {
      const match = file.dataUrl.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
      const mime = match?.[1].toLowerCase() ?? "";
      const ext = MIME[mime];
      if (!match || !ext) throw httpError(400, `"${file.name}" is not a PNG, JPG, GIF or screen recording.`);
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length > MAX_FILE) throw httpError(413, `"${file.name}" is over 10MB.`);
      return { name: file.name, mime, ext, buffer };
    });
    const id = randomUUID();
    const attachments: any[] = [];
    for (const file of files) {
      const path = `${orgId}/${id}/${randomUUID()}.${file.ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file.buffer, { contentType: file.mime, upsert: false });
      if (error) throw error;
      attachments.push({ path, name: file.name, mime: file.mime, size: file.buffer.length });
    }
    const { data, error } = await supabase.from("bug_reports").insert({
      id, org_id: orgId, branch_id: req.user!.branchId ?? null,
      reporter_id: req.user!.id, reporter_name: req.user!.name ?? "", reporter_role: req.user!.role ?? "",
      kind: body.kind, title: body.title, description: body.description, module: body.module, page: body.page || null,
      steps: body.steps.filter(Boolean), attachments, wants_updates: body.wantsUpdates
    }).select("*").single();
    if (error) {
      if (attachments.length) await supabase.storage.from(BUCKET).remove(attachments.map((file) => file.path));
      throw error;
    }
    try {
      const owners = req.user!.branchId ? await leadershipRecipients(orgId, req.user!.branchId, ["Owner"]) : [];
      await deliver(orgId, req.user!.branchId ?? "", owners, {
        title: `New report: ${body.title}`.slice(0, 120),
        message: `${req.user!.name ?? "Someone"} sent a ${KIND_LABEL[body.kind].toLowerCase()} about ${body.module}${body.page ? ` (${body.page})` : ""}.`,
        kind: "bug_report", tag: `bug-report-${id}`, link: LINK
      });
    } catch (alertError: any) { console.warn("[bug-reports] alert failed:", alertError?.message); }
    res.status(201).json(mapRow(data));
  } catch (error: any) {
    sendError(res, error, "Could not send the report.");
  }
});

/** The reporter's own reports, newest first. */
router.get("/mine", async (req, res) => {
  try {
    const { data, error } = await supabase.from("bug_reports").select("*")
      .eq("org_id", req.user!.orgId).eq("reporter_id", req.user!.id).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    res.json((data ?? []).map(mapRow));
  } catch (error: any) { sendError(res, error, "Could not load your reports."); }
});

/** Every report, for the Owner. */
router.get("/", requireRole("Owner"), async (req, res) => {
  try {
    const { data, error } = await supabase.from("bug_reports").select("*")
      .eq("org_id", req.user!.orgId).order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    res.json((data ?? []).map(mapRow));
  } catch (error: any) { sendError(res, error, "Could not load reports."); }
});

const UpdateSchema = z.object({
  status: z.enum(["new", "looking", "fixed", "wont_fix"]).optional(),
  ownerNote: z.string().trim().max(1000).nullable().optional()
});

router.patch("/:id", requireRole("Owner"), async (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const orgId = req.user!.orgId;
    const { data: row, error: readError } = await supabase.from("bug_reports").select("*").eq("org_id", orgId).eq("id", String(req.params.id)).maybeSingle();
    if (readError) throw readError;
    if (!row) throw httpError(404, "Report not found.");
    const statusChanged = parsed.data.status !== undefined && parsed.data.status !== row.status;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;
    if (parsed.data.ownerNote !== undefined) patch.owner_note = parsed.data.ownerNote || null;
    if (statusChanged) patch.status_changed_at = new Date().toISOString();
    const { data, error } = await supabase.from("bug_reports").update(patch).eq("org_id", orgId).eq("id", row.id).select("*").single();
    if (error) throw error;
    if (statusChanged && row.wants_updates && row.reporter_id && row.reporter_id !== req.user!.id) {
      try {
        const note = (parsed.data.ownerNote ?? row.owner_note ?? "").trim();
        await deliver(orgId, row.branch_id ?? req.user!.branchId ?? "", [{ id: row.reporter_id, role: row.reporter_role }], {
          title: `Your report: ${STATUS_LABEL[String(parsed.data.status)]}`,
          message: `"${row.title}"${note ? ` - ${note}` : ""}`.slice(0, 240),
          kind: "bug_report", tag: `bug-report-${row.id}`, link: LINK,
          type: parsed.data.status === "fixed" ? "success" : "info"
        });
      } catch (alertError: any) { console.warn("[bug-reports] update alert failed:", alertError?.message); }
    }
    res.json(mapRow(data));
  } catch (error: any) { sendError(res, error, "Could not update the report."); }
});

/** A short-lived link to one screenshot: the Owner, or the person who sent it. */
router.get("/:id/file", async (req, res) => {
  const parsed = z.object({ path: z.string().min(5).max(300) }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Which file?" }); return; }
  try {
    const { data: row, error } = await supabase.from("bug_reports").select("reporter_id, attachments")
      .eq("org_id", req.user!.orgId).eq("id", String(req.params.id)).maybeSingle();
    if (error) throw error;
    if (!row) throw httpError(404, "Report not found.");
    if (req.user!.role !== "Owner" && row.reporter_id !== req.user!.id) throw httpError(403, "Only the Owner or the sender can open this file.");
    if (!(row.attachments ?? []).some((file: any) => file.path === parsed.data.path)) throw httpError(404, "File not found.");
    const { data, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(parsed.data.path, 300);
    if (signError) throw signError;
    res.json({ url: data.signedUrl });
  } catch (error: any) { sendError(res, error, "Could not open the file."); }
});

export default router;
