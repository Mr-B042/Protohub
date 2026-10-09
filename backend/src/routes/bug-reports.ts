import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { deliver } from "../lib/weekly-report-notifications.js";
import type { UserRole } from "../types/index.js";
import {
  AWAITING_CONFIRMATION, DONE_STATUSES, STATUS_LABEL, autoPriority, departmentFor, isOpen, redact, similarity,
  statusesFor, ticketCode, ticketNumberFrom, type Affected, type Impact, type IssueKind, type IssueStatus, type Priority
} from "../lib/issue-rules.js";

// Issue & Feedback Management (Bright, 9 Oct 2026; grew out of the Report a
// Bug page, #752).
//
//   Anyone signed in: send a report (it becomes a ticket, BUG-1048), see their
//   own and the ones they said "I'm experiencing this too" on (My Reports),
//   reply, and confirm whether a resolved ticket is really fixed.
//   The technical team (Owner + Admin, Bright's choice): Issue Management -
//   every ticket, status, priority, assignee, duplicates, replies to the
//   reporter and internal notes the reporter never sees.
//
// ⚠️ Files go STRAIGHT to storage through signed upload links (5 x 25MB): a
// screen recording must never pass through this server (Railway memory).
// ⚠️ A failed alert never fails the action: the ticket is the record.

const router = Router();
router.use(requireAuth);

const TEAM: readonly UserRole[] = ["Owner", "Admin"];
const BUCKET = "bug-report-files";
const MIME: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"
};
const MAX_FILE = 25 * 1024 * 1024;
const MAX_FILES = 5;
const KIND_LABEL: Record<IssueKind, string> = { issue: "bug", feature: "feature suggestion", ux: "UI/UX feedback", other: "report" };
const LINK_REPORTER = "/dashboard/admin/my-reports";
const LINK_TEAM = "/dashboard/admin/issue-management";

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const sendError = (res: any, error: any, fallback: string) => {
  const status = Number(error?.status) || 500;
  res.status(status).json({ error: status === 500 ? (error?.message ?? fallback) : error.message });
};
const isTeam = (req: Request) => TEAM.includes(req.user!.role as UserRole);
const actorName = (req: Request) => req.user!.name ?? "Someone";

async function teamRecipients(orgId: string) {
  const { data, error } = await supabase.from("users").select("id, role").eq("org_id", orgId).eq("active", true).eq("is_demo", false).in("role", TEAM as UserRole[]);
  if (error) throw error;
  return (data ?? []).map((user: any) => ({ id: String(user.id), role: String(user.role) }));
}
async function followerIds(reportId: string) {
  const { data } = await supabase.from("bug_report_followers").select("user_id").eq("report_id", reportId);
  return (data ?? []).map((row: any) => String(row.user_id));
}
/** Bell + push, never failing the action. */
async function alert(orgId: string, branchId: string | null, recipients: Array<{ id: string; role: string }>, message: { title: string; message: string; tag: string; link: string; warning?: boolean }) {
  try {
    if (!branchId || recipients.length === 0) return;
    await deliver(orgId, branchId, recipients, { title: message.title.slice(0, 120), message: message.message.slice(0, 240), kind: "bug_report", tag: message.tag, link: message.link, type: message.warning ? "warning" : "info" });
  } catch (error: any) { console.warn("[issues] alert failed:", error?.message); }
}
async function addEvent(orgId: string, reportId: string, req: Request | null, event: { kind: string; internal?: boolean; body?: string | null; meta?: Record<string, unknown> }) {
  const { error } = await supabase.from("bug_report_events").insert({
    org_id: orgId, report_id: reportId, actor_id: req?.user?.id ?? null, actor_name: req ? actorName(req) : "Protohub",
    kind: event.kind, internal: event.internal === true, body: event.body ?? null, meta: event.meta ?? {}
  });
  if (error) console.warn("[issues] event insert failed:", error.message);
}

const mapRow = (row: any, opts: { team: boolean }) => ({
  id: row.id,
  ticketNo: Number(row.ticket_no),
  code: ticketCode(row.kind, Number(row.ticket_no)),
  reporterId: row.reporter_id, reporterName: row.reporter_name, reporterRole: row.reporter_role, department: row.department,
  kind: row.kind, title: row.title, description: row.description, details: row.details ?? {},
  module: row.module, page: row.page, steps: row.steps ?? [],
  attachments: (Array.isArray(row.attachments) ? row.attachments : []).map((file: any) => ({ path: file.path, name: file.name, mime: file.mime, size: file.size })),
  impact: row.impact, affected: row.affected, affectedRefKind: row.affected_ref_kind, affectedRef: row.affected_ref, frequency: row.frequency,
  environment: row.environment ?? {},
  errorContext: opts.team ? (row.error_context ?? {}) : undefined,
  wantsUpdates: row.wants_updates, mayContact: row.may_contact,
  status: row.status, statusLabel: STATUS_LABEL[row.status as IssueStatus] ?? row.status,
  priority: row.priority, priorityOverridden: row.priority_overridden,
  assigneeId: row.assignee_id, assigneeName: row.assignee_name,
  duplicateOf: row.duplicate_of, affectedCount: Number(row.affected_count ?? 1),
  firstResponseAt: row.first_response_at, resolvedAt: row.resolved_at, closedAt: row.closed_at, reopenedCount: Number(row.reopened_count ?? 0),
  statusChangedAt: row.status_changed_at, createdAt: row.created_at, updatedAt: row.updated_at
});

async function loadReport(req: Request, id: string) {
  const { data, error } = await supabase.from("bug_reports").select("*").eq("org_id", req.user!.orgId).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "Ticket not found.");
  return data as any;
}
/** The reporter, a follower, or the team. */
async function assertCanSee(req: Request, row: any) {
  if (isTeam(req) || row.reporter_id === req.user!.id) return;
  const { data } = await supabase.from("bug_report_followers").select("user_id").eq("report_id", row.id).eq("user_id", req.user!.id).maybeSingle();
  if (!data) throw httpError(403, "This ticket belongs to someone else.");
}

// ── Create ──
const SharedDetails = z.object({
  tried: z.string().trim().max(1000).optional(), actual: z.string().trim().max(1000).optional(),
  expected: z.string().trim().max(1000).optional(), errorMessage: z.string().trim().max(500).optional(),
  problem: z.string().trim().max(1000).optional(), solution: z.string().trim().max(1000).optional(),
  users: z.array(z.string().trim().max(40)).max(10).optional(), usefulness: z.string().trim().max(40).optional(),
  benefits: z.array(z.string().trim().max(60)).max(10).optional(), benefitOther: z.string().trim().max(200).optional(),
  uxProblems: z.array(z.string().trim().max(60)).max(12).optional(), uxOther: z.string().trim().max(200).optional(),
  goal: z.string().trim().max(1000).optional(), improvement: z.string().trim().max(1000).optional(),
  more: z.string().trim().max(1000).optional()
}).default({});
const CreateSchema = z.object({
  kind: z.enum(["issue", "feature", "ux", "other"]),
  title: z.string().trim().min(10, "Make the title at least 10 characters - say the page and what went wrong.").max(100),
  details: SharedDetails,
  module: z.string().trim().min(1, "Choose where this happened.").max(80),
  page: z.string().trim().max(80).optional(),
  steps: z.array(z.string().trim().max(300)).max(15).default([]),
  impact: z.enum(["low", "medium", "high", "critical"]).optional(),
  affected: z.enum(["only_me", "one_customer", "several_users", "department", "everyone", "not_sure"]).optional(),
  affectedRefKind: z.enum(["order", "customer", "product", "delivery", "sales_rep"]).optional(),
  affectedRef: z.string().trim().max(80).optional(),
  frequency: z.enum(["first_time", "sometimes", "every_time", "started_today", "several_days", "not_sure"]).optional(),
  environment: z.record(z.string(), z.unknown()).default({}),
  errorContext: z.record(z.string(), z.unknown()).default({}),
  wantsUpdates: z.boolean().default(true),
  mayContact: z.boolean().default(true),
  files: z.array(z.object({ name: z.string().trim().max(160).default("screenshot"), mime: z.string().trim().max(60), size: z.number().int().positive() })).max(MAX_FILES).default([])
});

/** One readable summary of the type's own answers, for search and the list. */
function summaryText(kind: IssueKind, details: z.infer<typeof SharedDetails>) {
  const parts = kind === "issue"
    ? [details.tried && `Trying to: ${details.tried}`, details.actual && `What happened: ${details.actual}`, details.expected && `Expected: ${details.expected}`, details.errorMessage && `Error: ${details.errorMessage}`]
    : kind === "feature"
      ? [details.problem && `Problem: ${details.problem}`, details.solution && `Suggested solution: ${details.solution}`]
      : kind === "ux"
        ? [details.uxProblems?.length && `Problem: ${details.uxProblems.join(", ")}`, details.goal && `Trying to: ${details.goal}`, details.improvement && `Would be easier if: ${details.improvement}`]
        : [details.more];
  return parts.filter(Boolean).join("\n").slice(0, 6000);
}

router.post("/", async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const body = parsed.data;
  try {
    const orgId = req.user!.orgId;
    const description = summaryText(body.kind, body.details);
    if (!description) throw httpError(400, body.kind === "issue" ? "Say what actually happened." : body.kind === "feature" ? "Say what problem this would solve." : body.kind === "ux" ? "Say what the problem is." : "Tell us more.");
    for (const file of body.files) {
      if (!MIME[file.mime.toLowerCase()]) throw httpError(400, `"${file.name}" is not a PNG, JPG, GIF, MP4 or WebM.`);
      if (file.size > MAX_FILE) throw httpError(413, `"${file.name}" is over 25MB.`);
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const priority = autoPriority({ kind: body.kind, impact: body.impact as Impact | undefined, affected: body.affected as Affected | undefined, affectedRefKind: body.affectedRefKind ?? null, createdAt, status: "new", text: `${body.title}\n${description}` });
    const { data: row, error } = await supabase.from("bug_reports").insert({
      id, org_id: orgId, branch_id: req.user!.branchId ?? null,
      reporter_id: req.user!.id, reporter_name: req.user!.name ?? "", reporter_role: req.user!.role ?? "", department: departmentFor(String(req.user!.role ?? "")),
      kind: body.kind, title: body.title, description, details: body.details, module: body.module, page: body.page || null,
      steps: body.steps.filter(Boolean), impact: body.impact ?? null, affected: body.affected ?? null,
      affected_ref_kind: body.affectedRef ? body.affectedRefKind ?? "order" : null, affected_ref: body.affectedRef || null,
      frequency: body.frequency ?? null, environment: redact(body.environment) ?? {}, error_context: redact(body.errorContext) ?? {},
      wants_updates: body.wantsUpdates, may_contact: body.mayContact, priority, created_at: createdAt
    }).select("*").single();
    if (error) throw error;
    await addEvent(orgId, id, req, { kind: "submitted", body: null, meta: { priority } });
    if (priority) await addEvent(orgId, id, null, { kind: "priority", body: `Protohub set priority ${priority}`, meta: { priority, auto: true }, internal: true });
    // Signed links: the browser uploads each file straight to storage.
    const uploads: Array<{ name: string; path: string; signedUrl: string }> = [];
    for (const file of body.files) {
      const path = `${orgId}/${id}/${randomUUID()}.${MIME[file.mime.toLowerCase()]}`;
      const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (signError) throw signError;
      uploads.push({ name: file.name, path, signedUrl: signed.signedUrl });
    }
    const code = ticketCode(body.kind, Number(row.ticket_no));
    const critical = body.impact === "critical" || priority === "P0";
    await alert(orgId, req.user!.branchId ?? null, await teamRecipients(orgId), {
      title: `${critical ? "Critical issue" : "New " + KIND_LABEL[body.kind]}: ${code} ${body.title}`,
      message: `${actorName(req)} · ${body.module}${body.page ? ` (${body.page})` : ""}${priority ? ` · ${priority}` : ""}`,
      tag: `issue-${id}`, link: LINK_TEAM, warning: critical
    });
    // The reporter's own receipt, so the ticket number is in their bell.
    await alert(orgId, req.user!.branchId ?? null, [{ id: req.user!.id, role: String(req.user!.role) }], {
      title: `Report received: ${code}`, message: `"${body.title}" - we usually respond within 1-2 business days.`, tag: `issue-${id}`, link: LINK_REPORTER
    });
    res.status(201).json({ report: mapRow(row, { team: isTeam(req) }), uploads });
  } catch (error: any) { sendError(res, error, "Could not send the report."); }
});

/** After the browser uploads, record the files that really arrived. */
router.post("/:id/attachments", async (req, res) => {
  const parsed = z.object({ files: z.array(z.object({ path: z.string().min(5).max(300), name: z.string().trim().max(160) })).max(MAX_FILES) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const row = await loadReport(req, String(req.params.id));
    if (row.reporter_id !== req.user!.id && !isTeam(req)) throw httpError(403, "Only the sender can add files.");
    const folder = `${req.user!.orgId}/${row.id}`;
    const { data: stored, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 100 });
    if (error) throw error;
    const byName = new Map((stored ?? []).map((item: any) => [`${folder}/${item.name}`, item]));
    const existing = Array.isArray(row.attachments) ? row.attachments : [];
    const fresh = parsed.data.files.filter((file) => file.path.startsWith(`${folder}/`) && byName.has(file.path) && !existing.some((item: any) => item.path === file.path))
      .map((file) => {
        const meta: any = byName.get(file.path);
        return { path: file.path, name: file.name, mime: meta?.metadata?.mimetype ?? "", size: Number(meta?.metadata?.size ?? 0) };
      });
    const attachments = [...existing, ...fresh].slice(0, MAX_FILES);
    const { error: updateError } = await supabase.from("bug_reports").update({ attachments, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (updateError) throw updateError;
    if (fresh.length) await addEvent(req.user!.orgId, row.id, req, { kind: "attachment", body: `${fresh.length} file${fresh.length === 1 ? "" : "s"} attached` });
    res.json({ attached: fresh.length, missing: parsed.data.files.length - fresh.length });
  } catch (error: any) { sendError(res, error, "Could not save the files."); }
});

// ── Similar issues ──
router.get("/similar", async (req, res) => {
  const parsed = z.object({ title: z.string().trim().min(6).max(100), module: z.string().trim().max(80).optional(), kind: z.enum(["issue", "feature", "ux", "other"]).optional() }).safeParse(req.query);
  if (!parsed.success) { res.json([]); return; }
  try {
    const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const { data, error } = await supabase.from("bug_reports").select("id, ticket_no, kind, title, module, status, affected_count, reporter_id, created_at")
      .eq("org_id", req.user!.orgId).gte("created_at", since).not("status", "in", `(${DONE_STATUSES.join(",")})`).limit(500);
    if (error) throw error;
    const matches = (data ?? []).map((row: any) => ({ row, score: similarity({ title: parsed.data.title, module: parsed.data.module }, { title: row.title, module: row.module }) }))
      .filter((item) => item.score >= 0.34 && (!parsed.data.kind || item.row.kind === parsed.data.kind || parsed.data.kind === "other"))
      .sort((a, b) => b.score - a.score).slice(0, 4);
    res.json(matches.map(({ row }) => ({
      id: row.id, code: ticketCode(row.kind, Number(row.ticket_no)), title: row.title, module: row.module,
      status: row.status, statusLabel: STATUS_LABEL[row.status as IssueStatus] ?? row.status, affectedCount: Number(row.affected_count ?? 1),
      mine: row.reporter_id === req.user!.id
    })));
  } catch (error: any) { sendError(res, error, "Could not check for similar issues."); }
});

/** "I'm experiencing this too": follow it, count the person, maybe raise priority. */
router.post("/:id/me-too", async (req, res) => {
  try {
    const row = await loadReport(req, String(req.params.id));
    if (row.reporter_id === req.user!.id) throw httpError(400, "You reported this one - it's already in My Reports.");
    const { error: followError } = await supabase.from("bug_report_followers").insert({ report_id: row.id, user_id: req.user!.id, org_id: req.user!.orgId });
    if (followError && !/duplicate key/i.test(followError.message)) throw followError;
    if (followError) { res.json(mapRow(row, { team: isTeam(req) })); return; }
    const affectedCount = Number(row.affected_count ?? 1) + 1;
    const next = row.priority_overridden ? row.priority : autoPriority({ kind: row.kind, impact: row.impact, affected: row.affected, affectedCount, affectedRefKind: row.affected_ref_kind, createdAt: row.created_at, status: row.status, text: `${row.title}\n${row.description}` });
    const { data: updated, error } = await supabase.from("bug_reports").update({ affected_count: affectedCount, priority: next, updated_at: new Date().toISOString() }).eq("id", row.id).select("*").single();
    if (error) throw error;
    await addEvent(req.user!.orgId, row.id, req, { kind: "me_too", body: `${actorName(req)} is experiencing this too (${affectedCount} people)` });
    if (next && next !== row.priority) {
      await addEvent(req.user!.orgId, row.id, null, { kind: "priority", internal: true, body: `Priority raised ${row.priority ?? "-"} → ${next}: ${affectedCount} people affected`, meta: { from: row.priority, to: next, auto: true } });
      await alert(req.user!.orgId, row.branch_id ?? req.user!.branchId ?? null, await teamRecipients(req.user!.orgId), {
        title: `${ticketCode(row.kind, Number(row.ticket_no))} raised to ${next}`, message: `${affectedCount} people now report "${row.title}".`,
        tag: `issue-${row.id}`, link: LINK_TEAM, warning: next === "P0"
      });
    }
    res.json(mapRow(updated, { team: isTeam(req) }));
  } catch (error: any) { sendError(res, error, "Could not add you to this ticket."); }
});

// ── Lists ──
router.get("/mine", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const { data: follows } = await supabase.from("bug_report_followers").select("report_id").eq("user_id", req.user!.id);
    const followed = (follows ?? []).map((row: any) => String(row.report_id));
    let query = supabase.from("bug_reports").select("*").eq("org_id", orgId).order("updated_at", { ascending: false }).limit(200);
    query = followed.length ? query.or(`reporter_id.eq.${req.user!.id},id.in.(${followed.slice(0, 150).join(",")})`) : query.eq("reporter_id", req.user!.id);
    const { data, error } = await query;
    if (error) throw error;
    res.json((data ?? []).map((row: any) => ({ ...mapRow(row, { team: false }), following: row.reporter_id !== req.user!.id })));
  } catch (error: any) { sendError(res, error, "Could not load your reports."); }
});

router.get("/", requireRole(...TEAM), async (req, res) => {
  try {
    const { data, error } = await supabase.from("bug_reports").select("*").eq("org_id", req.user!.orgId).order("created_at", { ascending: false }).limit(2000);
    if (error) throw error;
    res.json((data ?? []).map((row: any) => mapRow(row, { team: true })));
  } catch (error: any) { sendError(res, error, "Could not load tickets."); }
});

router.get("/team-members", requireRole(...TEAM), async (req, res) => {
  try {
    const { data, error } = await supabase.from("users").select("id, name, role").eq("org_id", req.user!.orgId).eq("active", true).eq("is_demo", false).in("role", TEAM as UserRole[]).order("name");
    if (error) throw error;
    res.json((data ?? []).map((user: any) => ({ id: user.id, name: user.name, role: user.role })));
  } catch (error: any) { sendError(res, error, "Could not load the team."); }
});

/** One ticket and its timeline. The reporter never sees internal notes. */
router.get("/:id", async (req, res) => {
  try {
    const row = await loadReport(req, String(req.params.id));
    await assertCanSee(req, row);
    const team = isTeam(req);
    let events = supabase.from("bug_report_events").select("id, actor_id, actor_name, kind, internal, body, meta, created_at").eq("report_id", row.id).order("created_at", { ascending: true }).limit(500);
    if (!team) events = events.eq("internal", false);
    const { data, error } = await events;
    if (error) throw error;
    let duplicateOfCode: string | null = null;
    if (row.duplicate_of) {
      const { data: original } = await supabase.from("bug_reports").select("kind, ticket_no").eq("id", row.duplicate_of).maybeSingle();
      if (original) duplicateOfCode = ticketCode(original.kind, Number(original.ticket_no));
    }
    res.json({
      report: { ...mapRow(row, { team }), duplicateOfCode, following: row.reporter_id !== req.user!.id && !team },
      events: (data ?? []).map((event: any) => ({ id: event.id, actorId: event.actor_id, actorName: event.actor_name, kind: event.kind, internal: event.internal, body: event.body, meta: event.meta ?? {}, createdAt: event.created_at }))
    });
  } catch (error: any) { sendError(res, error, "Could not load the ticket."); }
});

// ── Team changes: status, priority, assignee, duplicate ──
const UpdateSchema = z.object({
  status: z.string().trim().max(30).optional(),
  priority: z.union([z.enum(["P0", "P1", "P2", "P3"]), z.literal("auto")]).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  duplicateOf: z.string().trim().max(20).nullable().optional(),
  note: z.string().trim().max(1000).optional()
});

router.patch("/:id", requireRole(...TEAM), async (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const orgId = req.user!.orgId;
    const row = await loadReport(req, String(req.params.id));
    const body = parsed.data;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { updated_at: now };
    const code = ticketCode(row.kind, Number(row.ticket_no));
    const reporter = row.reporter_id ? [{ id: String(row.reporter_id), role: String(row.reporter_role) }] : [];
    const watchers = [...reporter, ...(await followerIds(row.id)).map((id) => ({ id, role: "Sales Rep" }))].filter((person) => person.id !== req.user!.id);
    const tellReporter = row.wants_updates ? watchers : watchers.filter((person) => person.id !== row.reporter_id);
    const branch = row.branch_id ?? req.user!.branchId ?? null;
    const after: Array<() => Promise<void>> = [];

    // Duplicate: point at the original, close this one as Duplicate.
    if (body.duplicateOf !== undefined) {
      if (body.duplicateOf === null || body.duplicateOf === "") {
        patch.duplicate_of = null;
      } else {
        const number = ticketNumberFrom(body.duplicateOf);
        if (!number) throw httpError(400, "Type the original ticket, e.g. BUG-1039.");
        const { data: original } = await supabase.from("bug_reports").select("id, kind, ticket_no, title, affected_count").eq("org_id", orgId).eq("ticket_no", number).maybeSingle();
        if (!original || original.id === row.id) throw httpError(404, "That ticket was not found.");
        patch.duplicate_of = original.id;
        body.status = "duplicate";
        const originalCode = ticketCode(original.kind, Number(original.ticket_no));
        await supabase.from("bug_reports").update({ affected_count: Number(original.affected_count ?? 1) + Number(row.affected_count ?? 1), updated_at: now }).eq("id", original.id);
        if (row.reporter_id) await supabase.from("bug_report_followers").upsert({ report_id: original.id, user_id: row.reporter_id, org_id: orgId }, { onConflict: "report_id,user_id" });
        await addEvent(orgId, row.id, req, { kind: "duplicate", body: `Marked as a duplicate of ${originalCode}. You can follow it there.`, meta: { of: original.id } });
        await addEvent(orgId, original.id, req, { kind: "system", internal: true, body: `${code} merged in as a duplicate (${row.reporter_name}).` });
      }
    }
    if (body.status !== undefined && body.status !== row.status) {
      if (!statusesFor(row.kind).includes(body.status as IssueStatus)) throw httpError(400, `"${body.status}" is not a step for this kind of ticket.`);
      const label = STATUS_LABEL[body.status as IssueStatus];
      const awaiting = AWAITING_CONFIRMATION.includes(body.status as IssueStatus);
      patch.status = body.status;
      patch.status_changed_at = now;
      if (!row.first_response_at) patch.first_response_at = now;
      if (awaiting) patch.resolved_at = now;
      if (body.status === "closed") patch.closed_at = now;
      await addEvent(orgId, row.id, req, { kind: "status", body: `${actorName(req)} changed status → ${label}${body.note ? `: ${body.note}` : ""}`, meta: { from: row.status, to: body.status } });
      after.push(() => alert(orgId, branch, tellReporter, {
        title: body.status === "needs_info" ? `${code}: more information needed` : awaiting ? `${code} has been ${body.status === "released" ? "released" : "fixed"}` : `${code}: ${label}`,
        message: body.status === "needs_info" ? `${body.note || "Please open the ticket and reply."}` : awaiting ? `"${row.title}" - can you confirm it is working now?` : `"${row.title}"${body.note ? ` - ${body.note}` : ""}`,
        tag: `issue-${row.id}`, link: LINK_REPORTER
      }));
    }
    if (body.priority !== undefined) {
      const next = body.priority === "auto"
        ? autoPriority({ kind: row.kind, impact: row.impact, affected: row.affected, affectedCount: row.affected_count, affectedRefKind: row.affected_ref_kind, createdAt: row.created_at, status: String(patch.status ?? row.status), text: `${row.title}\n${row.description}` })
        : body.priority as Priority;
      patch.priority = next;
      patch.priority_overridden = body.priority !== "auto";
      if (next !== row.priority || (body.priority === "auto") !== !row.priority_overridden) {
        await addEvent(orgId, row.id, req, { kind: "priority", internal: true, body: `${actorName(req)} set priority ${row.priority ?? "-"} → ${next ?? "-"}${body.priority === "auto" ? " (worked out by Protohub)" : ""}`, meta: { from: row.priority, to: next } });
      }
    }
    if (body.assigneeId !== undefined && body.assigneeId !== row.assignee_id) {
      let assigneeName: string | null = null;
      if (body.assigneeId) {
        const { data: person } = await supabase.from("users").select("id, name, role").eq("org_id", orgId).eq("id", body.assigneeId).in("role", TEAM as UserRole[]).maybeSingle();
        if (!person) throw httpError(400, "Tickets can be assigned to the Owner or an Admin.");
        assigneeName = person.name;
        if (person.id !== req.user!.id) after.push(() => alert(orgId, branch, [{ id: person.id, role: person.role }], { title: `Assigned to you: ${code}`, message: `"${row.title}"${row.priority ? ` · ${row.priority}` : ""}`, tag: `issue-${row.id}`, link: LINK_TEAM }));
      }
      patch.assignee_id = body.assigneeId;
      patch.assignee_name = assigneeName;
      if (!row.first_response_at) patch.first_response_at = now;
      // A bug that is still New or Triaged moves to Assigned when someone takes it.
      if (body.assigneeId && row.kind !== "feature" && patch.status === undefined && (row.status === "new" || row.status === "triaged")) {
        patch.status = "assigned";
        patch.status_changed_at = now;
        await addEvent(orgId, row.id, req, { kind: "status", body: `Status → ${STATUS_LABEL.assigned}`, meta: { from: row.status, to: "assigned" } });
      }
      await addEvent(orgId, row.id, req, { kind: "assigned", body: body.assigneeId ? `Assigned to ${assigneeName}` : "Unassigned" });
    }
    const { data: updated, error } = await supabase.from("bug_reports").update(patch).eq("id", row.id).select("*").single();
    if (error) throw error;
    for (const job of after) await job();
    res.json(mapRow(updated, { team: true }));
  } catch (error: any) { sendError(res, error, "Could not update the ticket."); }
});

// ── Messages: replies (the reporter sees) and internal notes (team only) ──
router.post("/:id/messages", async (req, res) => {
  const parsed = z.object({ body: z.string().trim().min(1, "Write a message.").max(2000), internal: z.boolean().default(false) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const orgId = req.user!.orgId;
    const row = await loadReport(req, String(req.params.id));
    await assertCanSee(req, row);
    const team = isTeam(req);
    if (parsed.data.internal && !team) throw httpError(403, "Only the technical team can write internal notes.");
    await addEvent(orgId, row.id, req, { kind: parsed.data.internal ? "note" : "reply", internal: parsed.data.internal, body: parsed.data.body });
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { updated_at: now };
    if (team && !parsed.data.internal && !row.first_response_at) patch.first_response_at = now;
    // The reporter answered a "needs more information": back to the team.
    if (!team && row.status === "needs_info") {
      patch.status = row.kind === "feature" ? "under_review" : "triaged";
      patch.status_changed_at = now;
      await addEvent(orgId, row.id, null, { kind: "status", body: `Status → ${STATUS_LABEL[patch.status as IssueStatus]} (reporter replied)`, meta: { from: row.status, to: patch.status } });
    }
    await supabase.from("bug_reports").update(patch).eq("id", row.id);
    const code = ticketCode(row.kind, Number(row.ticket_no));
    const branch = row.branch_id ?? req.user!.branchId ?? null;
    if (!parsed.data.internal) {
      if (team) {
        const people = [...(row.reporter_id ? [{ id: String(row.reporter_id), role: String(row.reporter_role) }] : []), ...(await followerIds(row.id)).map((id) => ({ id, role: "Sales Rep" }))].filter((person) => person.id !== req.user!.id);
        await alert(orgId, branch, people, { title: `Reply on ${code}`, message: parsed.data.body, tag: `issue-${row.id}`, link: LINK_REPORTER });
      } else {
        const to = row.assignee_id ? [{ id: String(row.assignee_id), role: "Admin" }] : await teamRecipients(orgId);
        await alert(orgId, branch, to.filter((person) => person.id !== req.user!.id), { title: `${actorName(req)} replied on ${code}`, message: parsed.data.body, tag: `issue-${row.id}`, link: LINK_TEAM });
      }
    }
    res.status(201).json({ ok: true });
  } catch (error: any) { sendError(res, error, "Could not send the message."); }
});

/** "Is it fixed?" - yes closes it; no reopens it and tells the team. */
router.post("/:id/verify", async (req, res) => {
  const parsed = z.object({ fixed: z.boolean(), comment: z.string().trim().max(1000).optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const orgId = req.user!.orgId;
    const row = await loadReport(req, String(req.params.id));
    await assertCanSee(req, row);
    if (!AWAITING_CONFIRMATION.includes(row.status)) throw httpError(409, "This ticket isn't waiting for your confirmation.");
    const now = new Date().toISOString();
    const code = ticketCode(row.kind, Number(row.ticket_no));
    if (parsed.data.fixed) {
      await supabase.from("bug_reports").update({ status: "closed", closed_at: now, status_changed_at: now, updated_at: now }).eq("id", row.id);
      await addEvent(orgId, row.id, req, { kind: "verified_fixed", body: `${actorName(req)} confirmed it's fixed${parsed.data.comment ? `: ${parsed.data.comment}` : ""}` });
    } else {
      await supabase.from("bug_reports").update({
        status: row.kind === "feature" ? "in_development" : "reopened", reopened_count: Number(row.reopened_count ?? 0) + 1,
        resolved_at: null, status_changed_at: now, updated_at: now
      }).eq("id", row.id);
      await addEvent(orgId, row.id, req, { kind: "reopened", body: `${actorName(req)} says it still happens${parsed.data.comment ? `: ${parsed.data.comment}` : ""}. Reopened.` });
      const to = row.assignee_id ? [{ id: String(row.assignee_id), role: "Admin" }] : await teamRecipients(orgId);
      await alert(orgId, row.branch_id ?? req.user!.branchId ?? null, to, { title: `${code} reopened`, message: `${actorName(req)}: still happening${parsed.data.comment ? ` - ${parsed.data.comment}` : ""}`, tag: `issue-${row.id}`, link: LINK_TEAM, warning: true });
    }
    const updated = await loadReport(req, row.id);
    res.json(mapRow(updated, { team: isTeam(req) }));
  } catch (error: any) { sendError(res, error, "Could not save your answer."); }
});

/** A short-lived link to one file. */
router.get("/:id/file", async (req, res) => {
  const parsed = z.object({ path: z.string().min(5).max(300) }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Which file?" }); return; }
  try {
    const row = await loadReport(req, String(req.params.id));
    await assertCanSee(req, row);
    if (!(row.attachments ?? []).some((file: any) => file.path === parsed.data.path)) throw httpError(404, "File not found.");
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(parsed.data.path, 600);
    if (error) throw error;
    res.json({ url: data.signedUrl });
  } catch (error: any) { sendError(res, error, "Could not open the file."); }
});

export default router;

// ── Response-time alert (hourly) ──
/**
 * Tells the team once when a ticket with no first response has used 75% of its
 * target (P0 4h, P1 24h, P2 72h). P3 and features have no target.
 */
export async function runIssueResponseAlerts() {
  const { data, error } = await supabase.from("bug_reports").select("id, org_id, branch_id, kind, ticket_no, title, priority, status, created_at")
    .is("first_response_at", null).is("sla_alerted_at", null).in("priority", ["P0", "P1", "P2"]).limit(500);
  if (error) throw error;
  const targets: Record<string, number> = { P0: 4, P1: 24, P2: 72 };
  let sent = 0;
  for (const row of (data ?? []) as any[]) {
    if (!isOpen(row.status)) continue;
    const hours = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;
    const target = targets[row.priority];
    if (!target || hours < target * 0.75) continue;
    await supabase.from("bug_reports").update({ sla_alerted_at: new Date().toISOString() }).eq("id", row.id);
    const code = ticketCode(row.kind, Number(row.ticket_no));
    await alert(row.org_id, row.branch_id, await teamRecipients(row.org_id), {
      title: `${code} (${row.priority}) still has no response`, message: `"${row.title}" - ${Math.floor(hours)}h old; the target is ${target}h.`,
      tag: `issue-sla-${row.id}`, link: LINK_TEAM, warning: true
    });
    sent += 1;
  }
  return { sent };
}
