import { Router, type Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { logger } from "../lib/logger.js";
import { sendPushToUser } from "../lib/push.js";
import {
  APPROVER_ROLES, DEFAULT_APPROVAL_RULES, DEPARTMENTS, PAYMENT_SOURCES, approverFor, canApprove, nextRequestCode, parseExpenseCsv,
  type ApprovalRule
} from "../lib/expense-intel-rules.js";

/**
 * Expense & Cost Intelligence (Bright, 16 Nov 2026). The money figures (profit,
 * COGS, logistics) are worked out in the browser with the same helpers as the
 * Dashboard so every page agrees; this route keeps what the page SAVES:
 * requests/approvals, budgets, settings, alert actions, savings plans, report
 * schedules, checks, receipts and imports.
 */

const router = Router();
router.use(requireAuth);

const FULL = ["Owner", "Admin"] as const;
// The Logistics role stays money-free: no expense page (logistics role allowlist).
const PAGE_ROLES = ["Owner", "Admin", "Manager", "Inventory Manager", "Accountant"] as const;
const branchOf = (req: Request) => req.user!.branchId!;
const roleOf = (req: Request) => req.user!.role as string;

async function loadSettings(orgId: string, branchId: string) {
  const { data, error } = await supabase.from("expense_settings").select("*").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
  if (error) throw error;
  return {
    approvalRules: ((data as any)?.approval_rules ?? DEFAULT_APPROVAL_RULES) as ApprovalRule[],
    budgetAlertSteps: ((data as any)?.budget_alert_steps ?? [50, 75, 90, 100]) as number[],
    departments: ((data as any)?.departments ?? {}) as Record<string, string>
  };
}

const requestRow = (row: any) => ({
  id: row.id, code: row.code, category: row.category, productId: row.product_id, amount: Number(row.amount), purpose: row.purpose,
  department: row.department, paymentSource: row.payment_source, expenseDate: row.expense_date, hasReceipt: Boolean(row.receipt_url),
  requestedBy: row.requested_by, requestedByName: row.requested_by_name, requestedByRole: row.requested_by_role,
  status: row.status, decidedByName: row.decided_by_name, decidedAt: row.decided_at, decisionNote: row.decision_note,
  expenseId: row.expense_id, createdAt: row.created_at
});

/** Everything the page keeps, in one call. */
router.get("/state", requireRole(...PAGE_ROLES), async (req, res) => {
  const orgId = req.user!.orgId, branchId = branchOf(req), role = roleOf(req);
  try {
    const full = (FULL as readonly string[]).includes(role);
    const approver = (APPROVER_ROLES as readonly string[]).includes(role);
    let requests = supabase.from("expense_requests").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: false }).limit(2000);
    // An Accountant sees their own requests; approvers see all.
    if (!approver) requests = requests.eq("requested_by", req.user!.id);
    const [settings, reqs, budgets, actions, plans, schedules, people] = await Promise.all([
      loadSettings(orgId, branchId),
      requests,
      full ? supabase.from("expense_budgets").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("month") : Promise.resolve({ data: [], error: null }),
      full ? supabase.from("expense_alert_actions").select("*").eq("org_id", orgId).eq("branch_id", branchId) : Promise.resolve({ data: [], error: null }),
      full ? supabase.from("expense_savings_plans").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      full ? supabase.from("expense_report_schedules").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at") : Promise.resolve({ data: [], error: null }),
      supabase.from("users").select("id, name, role").eq("org_id", orgId).eq("active", true).in("role", ["Owner", "Admin", "Manager", "Accountant"]).order("name")
    ]);
    for (const r of [reqs, budgets, actions, plans, schedules, people] as any[]) if (r.error) throw r.error;
    res.json({
      me: { id: req.user!.id, role, full, approver },
      settings, departmentsList: DEPARTMENTS, paymentSources: PAYMENT_SOURCES,
      requests: ((reqs.data ?? []) as any[]).map(requestRow),
      budgets: ((budgets.data ?? []) as any[]).map((b) => ({ id: b.id, month: b.month, category: b.category, amount: Number(b.amount), recurring: b.recurring, updatedByName: b.updated_by_name, updatedAt: b.updated_at })),
      alertActions: ((actions.data ?? []) as any[]).map((a) => ({ key: a.alert_key, action: a.action, assignedToName: a.assigned_to_name, note: a.note, byName: a.by_name, at: a.created_at })),
      plans: ((plans.data ?? []) as any[]).map((p) => ({ id: p.id, title: p.title, target: p.target, expectedSavings: Number(p.expected_savings), realizedSavings: Number(p.realized_savings), ownerDepartment: p.owner_department, ownerUser: p.owner_user, ownerName: p.owner_name, dueDate: p.due_date, status: p.status, sourceKey: p.source_key, createdByName: p.created_by_name, createdAt: p.created_at, updatedAt: p.updated_at })),
      schedules: ((schedules.data ?? []) as any[]).map((s) => ({ id: s.id, report: s.report, frequency: s.frequency, emails: s.emails, active: s.active, lastSentAt: s.last_sent_at, createdByName: s.created_by_name })),
      people: ((people.data ?? []) as any[]).map((p) => ({ id: p.id, name: p.name, role: p.role }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load the expense page." });
  }
});

// ---------- Receipts (private bucket, signed links) ----------
const RECEIPT_MIME: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

router.post("/receipts", requireRole(...PAGE_ROLES), async (req, res) => {
  const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
  const match = dataUrl.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  const ext = match ? RECEIPT_MIME[match[1].toLowerCase()] : undefined;
  if (!match || !ext) { res.status(400).json({ error: "Upload a photo (PNG, JPG, WEBP) or a PDF." }); return; }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 10 * 1024 * 1024) { res.status(413).json({ error: "The receipt is over 10 MB." }); return; }
  const path = `${req.user!.orgId}/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("expense-receipts").upload(path, buffer, { contentType: match[1].toLowerCase(), upsert: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json({ path });
});

/** A 10-minute link to a receipt of this organisation. */
router.get("/receipts/link", requireRole(...PAGE_ROLES), async (req, res) => {
  const path = String(req.query.path ?? "");
  if (!path.startsWith(`${req.user!.orgId}/`)) { res.status(404).json({ error: "Receipt not found." }); return; }
  const { data, error } = await supabase.storage.from("expense-receipts").createSignedUrl(path, 600);
  if (error || !data) { res.status(404).json({ error: "Receipt not found." }); return; }
  res.json({ url: data.signedUrl });
});

/** A request's receipt link (the requester or an approver). */
router.get("/requests/:id/receipt", requireRole(...PAGE_ROLES), async (req, res) => {
  const { data } = await supabase.from("expense_requests").select("receipt_url, requested_by").eq("id", req.params.id).eq("org_id", req.user!.orgId).maybeSingle();
  const approver = (APPROVER_ROLES as readonly string[]).includes(roleOf(req));
  if (!data?.receipt_url || (!approver && data.requested_by !== req.user!.id)) { res.status(404).json({ error: "No receipt." }); return; }
  const { data: link } = await supabase.storage.from("expense-receipts").createSignedUrl(String(data.receipt_url), 600);
  if (!link) { res.status(404).json({ error: "No receipt." }); return; }
  res.json({ url: link.signedUrl });
});

// ---------- Requests & approvals ----------
const RequestSchema = z.object({
  category: z.string().trim().min(1).max(60),
  productId: z.string().max(80).nullable().optional(),
  amount: z.number().positive().max(1_000_000_000),
  purpose: z.string().trim().min(3, "Say what the money is for.").max(500),
  department: z.enum(DEPARTMENTS),
  paymentSource: z.enum(PAYMENT_SOURCES),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receiptPath: z.string().max(300).nullable().optional()
});

router.post("/requests", requireRole(...PAGE_ROLES), async (req, res) => {
  const parsed = RequestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const d = parsed.data, orgId = req.user!.orgId, branchId = branchOf(req);
  if (d.receiptPath && !d.receiptPath.startsWith(`${orgId}/`)) { res.status(400).json({ error: "That receipt is not from this account." }); return; }
  try {
    const { data: codes } = await supabase.from("expense_requests").select("code").eq("org_id", orgId);
    let inserted: any = null;
    const taken = ((codes ?? []) as any[]).map((r) => String(r.code));
    // Two people sending at once can pick the same code: try the next one.
    for (let attempt = 0; attempt < 4 && !inserted; attempt += 1) {
      const code = nextRequestCode(taken);
      taken.push(code);
      const { data, error } = await supabase.from("expense_requests").insert({
        org_id: orgId, branch_id: branchId, code, category: d.category, product_id: d.productId || null, amount: d.amount, purpose: d.purpose,
        department: d.department, payment_source: d.paymentSource, expense_date: d.expenseDate, receipt_url: d.receiptPath || null,
        requested_by: req.user!.id, requested_by_name: req.user!.name ?? "Staff", requested_by_role: roleOf(req)
      }).select("*").single();
      if (error && error.code !== "23505") throw error;
      inserted = data;
    }
    if (!inserted) throw new Error("Could not number the request. Try again.");
    await tellApprovers(orgId, branchId, inserted);
    res.status(201).json(requestRow(inserted));
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not send the request." });
  }
});

/** In-app alert + push to everyone allowed to approve this amount. */
async function tellApprovers(orgId: string, branchId: string, row: any) {
  try {
    const settings = await loadSettings(orgId, branchId);
    const lowest = approverFor(Number(row.amount), settings.approvalRules);
    const roles = APPROVER_ROLES.filter((r) => canApprove(r, Number(row.amount), settings.approvalRules));
    const { data: users } = await supabase.from("users").select("id, role").eq("org_id", orgId).eq("active", true).in("role", roles);
    const recipients = ((users ?? []) as any[]).map((u) => String(u.id));
    if (!recipients.length) return;
    const amount = `₦${Math.round(Number(row.amount)).toLocaleString("en-NG")}`;
    const title = `Expense request ${row.code}: ${amount}`;
    const message = `${row.requested_by_name} asks for ${amount} (${row.category}): ${row.purpose}. Needs ${lowest} or above.`;
    const link = `/dashboard/admin/expenses?tab=approvals&request=${row.id}`;
    await supabase.from("system_notifications").insert(recipients.map((id) => ({ org_id: orgId, branch_id: branchId, recipient_id: id, type: "expense_request", read: false, link, title, message })));
    await Promise.all(recipients.map((id) => sendPushToUser(orgId, id, { title, body: message, url: link, tag: `expense-request-${row.id}`, kind: "expense_request" } as any).catch(() => undefined)));
  } catch (error: any) {
    logger.warn("expense request alert failed", { orgId, error: error?.message ?? String(error) });
  }
}

router.post("/requests/:id/decide", requireRole(...APPROVER_ROLES), async (req, res) => {
  const parsed = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const orgId = req.user!.orgId, branchId = branchOf(req);
  try {
    const { data: row, error } = await supabase.from("expense_requests").select("*").eq("id", req.params.id).eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
    if (error) throw error;
    if (!row) { res.status(404).json({ error: "Request not found." }); return; }
    if (row.status !== "pending") { res.status(409).json({ error: `Already ${row.status} by ${row.decided_by_name ?? "someone"}.` }); return; }
    if (row.requested_by === req.user!.id) { res.status(403).json({ error: "You can't decide your own request." }); return; }
    const settings = await loadSettings(orgId, branchId);
    if (!canApprove(roleOf(req), Number(row.amount), settings.approvalRules)) {
      res.status(403).json({ error: `${approverFor(Number(row.amount), settings.approvalRules)} or above must decide this amount.` }); return;
    }
    if (parsed.data.decision === "rejected" && !parsed.data.note?.trim()) { res.status(400).json({ error: "Say why it is rejected." }); return; }
    let expenseId: string | null = null;
    if (parsed.data.decision === "approved") {
      expenseId = `EXP-REQ-${String(row.code).replace(/^EXP-REQ-/, "")}`;
      const { error: insertError } = await supabase.from("expenses").upsert({
        id: expenseId, org_id: orgId, branch_id: branchId, date: row.expense_date, category: row.category, amount: row.amount, currency: "NGN",
        description: `${row.purpose} (request ${row.code})`, paid_by: row.payment_source, product_id: row.product_id,
        check_status: "verified", recorded_by: row.requested_by, recorded_by_name: row.requested_by_name,
        checked_by_name: req.user!.name ?? "Approver", checked_at: new Date().toISOString(), receipt_url: row.receipt_url, request_id: row.id
      }, { onConflict: "id" });
      if (insertError) throw insertError;
    }
    // Only a still-pending row changes: two approvers at once can't both win.
    const { data: updated, error: updateError } = await supabase.from("expense_requests").update({
      status: parsed.data.decision, decided_by: req.user!.id, decided_by_name: req.user!.name ?? "Approver", decided_at: new Date().toISOString(),
      decision_note: parsed.data.note?.trim() || null, expense_id: expenseId
    }).eq("id", row.id).eq("status", "pending").select("*").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      if (expenseId) await supabase.from("expenses").delete().eq("id", expenseId).eq("org_id", orgId);
      res.status(409).json({ error: "Someone else decided it first. Refresh." }); return;
    }
    res.json(requestRow(updated));
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save the decision." });
  }
});

/** The requester can withdraw a request nobody has decided yet. */
router.delete("/requests/:id", requireRole(...PAGE_ROLES), async (req, res) => {
  const { data, error } = await supabase.from("expense_requests").delete().eq("id", req.params.id).eq("org_id", req.user!.orgId).eq("requested_by", req.user!.id).eq("status", "pending").select("id");
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data?.length) { res.status(404).json({ error: "Only your own undecided request can be withdrawn." }); return; }
  res.json({ ok: true });
});

// ---------- Settings ----------
router.put("/settings", requireRole("Owner"), async (req, res) => {
  const parsed = z.object({
    approvalRules: z.array(z.object({ upTo: z.number().positive().nullable(), role: z.enum(APPROVER_ROLES) })).min(1).max(5).optional(),
    budgetAlertSteps: z.array(z.number().int().min(1).max(200)).min(1).max(6).optional(),
    departments: z.record(z.string().max(60), z.enum(DEPARTMENTS)).optional()
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const rules = parsed.data.approvalRules;
  if (rules && !rules.some((r) => r.upTo === null)) { res.status(400).json({ error: "The last approval step must cover any amount above it." }); return; }
  const current = await loadSettings(req.user!.orgId, branchOf(req));
  const { error } = await supabase.from("expense_settings").upsert({
    org_id: req.user!.orgId, branch_id: branchOf(req),
    approval_rules: rules ?? current.approvalRules,
    budget_alert_steps: parsed.data.budgetAlertSteps ? [...new Set(parsed.data.budgetAlertSteps)].sort((a, b) => a - b) : current.budgetAlertSteps,
    departments: parsed.data.departments ?? current.departments,
    updated_at: new Date().toISOString()
  }, { onConflict: "org_id,branch_id" });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(await loadSettings(req.user!.orgId, branchOf(req)));
});

// ---------- Budgets ----------
router.put("/budgets", requireRole(...FULL), async (req, res) => {
  const parsed = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    items: z.array(z.object({ category: z.string().trim().min(1).max(60), amount: z.number().min(0).max(10_000_000_000), recurring: z.boolean().default(false) })).max(40),
    remove: z.array(z.string().max(60)).max(40).optional()
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const orgId = req.user!.orgId, branchId = branchOf(req), d = parsed.data;
  if (d.items.length) {
    const { error } = await supabase.from("expense_budgets").upsert(d.items.map((item) => ({
      org_id: orgId, branch_id: branchId, month: d.month, category: item.category, amount: item.amount, recurring: item.recurring,
      updated_by_name: req.user!.name ?? null, updated_at: new Date().toISOString()
    })), { onConflict: "org_id,branch_id,month,category" });
    if (error) { res.status(500).json({ error: error.message }); return; }
  }
  if (d.remove?.length) await supabase.from("expense_budgets").delete().eq("org_id", orgId).eq("branch_id", branchId).eq("month", d.month).in("category", d.remove);
  res.json({ ok: true });
});

// ---------- Alerts ----------
router.post("/alerts/action", requireRole(...FULL), async (req, res) => {
  const parsed = z.object({ key: z.string().min(1).max(200), action: z.enum(["resolved", "dismissed", "assigned", "reopen"]), assignedTo: z.string().uuid().optional(), note: z.string().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const orgId = req.user!.orgId, branchId = branchOf(req), d = parsed.data;
  if (d.action === "reopen") {
    await supabase.from("expense_alert_actions").delete().eq("org_id", orgId).eq("branch_id", branchId).eq("alert_key", d.key);
    res.json({ ok: true }); return;
  }
  let assignedName: string | null = null;
  if (d.action === "assigned") {
    if (!d.assignedTo) { res.status(400).json({ error: "Pick who it is assigned to." }); return; }
    const { data: user } = await supabase.from("users").select("id, name").eq("id", d.assignedTo).eq("org_id", orgId).maybeSingle();
    if (!user) { res.status(400).json({ error: "That person is not in this account." }); return; }
    assignedName = (user as any).name;
  }
  const { error } = await supabase.from("expense_alert_actions").upsert({
    org_id: orgId, branch_id: branchId, alert_key: d.key, action: d.action, assigned_to: d.assignedTo ?? null, assigned_to_name: assignedName,
    note: d.note ?? null, by_name: req.user!.name ?? "Owner", created_at: new Date().toISOString()
  }, { onConflict: "org_id,branch_id,alert_key" });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ---------- Savings plans ----------
const PlanSchema = z.object({
  title: z.string().trim().min(2).max(160), target: z.string().max(80).default(""),
  expectedSavings: z.number().min(0).max(10_000_000_000).default(0), realizedSavings: z.number().min(0).max(10_000_000_000).default(0),
  ownerDepartment: z.string().max(60).default(""), ownerUser: z.string().uuid().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(["not_started", "pending", "in_progress", "approved", "done"]).default("not_started"),
  sourceKey: z.string().max(200).nullable().optional()
});

async function ownerName(orgId: string, id?: string | null) {
  if (!id) return null;
  const { data } = await supabase.from("users").select("name").eq("id", id).eq("org_id", orgId).maybeSingle();
  return (data as any)?.name ?? null;
}

router.post("/plans", requireRole(...FULL), async (req, res) => {
  const parsed = PlanSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const d = parsed.data, orgId = req.user!.orgId;
  const { data, error } = await supabase.from("expense_savings_plans").insert({
    org_id: orgId, branch_id: branchOf(req), title: d.title, target: d.target, expected_savings: d.expectedSavings, realized_savings: d.realizedSavings,
    owner_department: d.ownerDepartment, owner_user: d.ownerUser ?? null, owner_name: await ownerName(orgId, d.ownerUser), due_date: d.dueDate ?? null,
    status: d.status, source_key: d.sourceKey ?? null, created_by_name: req.user!.name ?? "Owner"
  }).select("id").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

router.patch("/plans/:id", requireRole(...FULL), async (req, res) => {
  const parsed = PlanSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const d = parsed.data, orgId = req.user!.orgId;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.title !== undefined) patch.title = d.title;
  if (d.target !== undefined) patch.target = d.target;
  if (d.expectedSavings !== undefined) patch.expected_savings = d.expectedSavings;
  if (d.realizedSavings !== undefined) patch.realized_savings = d.realizedSavings;
  if (d.ownerDepartment !== undefined) patch.owner_department = d.ownerDepartment;
  if (d.ownerUser !== undefined) { patch.owner_user = d.ownerUser; patch.owner_name = await ownerName(orgId, d.ownerUser); }
  if (d.dueDate !== undefined) patch.due_date = d.dueDate;
  if (d.status !== undefined) patch.status = d.status;
  const { error } = await supabase.from("expense_savings_plans").update(patch).eq("id", req.params.id).eq("org_id", orgId).eq("branch_id", branchOf(req));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

router.delete("/plans/:id", requireRole(...FULL), async (req, res) => {
  const { error } = await supabase.from("expense_savings_plans").delete().eq("id", req.params.id).eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ---------- Report schedules ----------
export const SCHEDULED_REPORTS = ["expenses", "budget", "advertising"] as const;

router.post("/schedules", requireRole(...FULL), async (req, res) => {
  const parsed = z.object({
    report: z.enum(SCHEDULED_REPORTS), frequency: z.enum(["weekly", "monthly"]),
    emails: z.array(z.string().trim().email()).min(1).max(5)
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { error } = await supabase.from("expense_report_schedules").insert({
    org_id: req.user!.orgId, branch_id: branchOf(req), report: parsed.data.report, frequency: parsed.data.frequency,
    emails: parsed.data.emails, created_by_name: req.user!.name ?? "Owner"
  });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json({ ok: true });
});

router.delete("/schedules/:id", requireRole(...FULL), async (req, res) => {
  const { error } = await supabase.from("expense_report_schedules").delete().eq("id", req.params.id).eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ---------- Checks & imports on expense rows ----------
router.post("/expenses/check", requireRole(...APPROVER_ROLES), async (req, res) => {
  const parsed = z.object({ ids: z.array(z.string().min(1).max(120)).min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  // System-booked rows stay "auto": only unchecked rows become verified.
  const { data, error } = await supabase.from("expenses").update({ check_status: "verified", checked_by_name: req.user!.name ?? "Owner", checked_at: new Date().toISOString() })
    .eq("org_id", req.user!.orgId).eq("check_status", "unchecked").in("id", parsed.data.ids).select("id");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ checked: data?.length ?? 0 });
});

router.post("/expenses/:id/receipt", requireRole(...APPROVER_ROLES), async (req, res) => {
  const path = String(req.body?.path ?? "");
  if (!path.startsWith(`${req.user!.orgId}/`)) { res.status(400).json({ error: "That receipt is not from this account." }); return; }
  const { error } = await supabase.from("expenses").update({ receipt_url: path }).eq("id", req.params.id).eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

router.post("/expenses/import", requireRole(...FULL), async (req, res) => {
  const csv = typeof req.body?.csv === "string" ? req.body.csv : "";
  if (!csv.trim()) { res.status(400).json({ error: "The file is empty." }); return; }
  if (csv.length > 2_000_000) { res.status(413).json({ error: "The file is too big (2 MB at most)." }); return; }
  const { rows, problems } = parseExpenseCsv(csv);
  if (problems.length) { res.status(400).json({ error: `Nothing was imported. Fix these lines first: ${problems.slice(0, 30).join(" · ")}` }); return; }
  if (!rows.length) { res.status(400).json({ error: "No expense lines found." }); return; }
  if (rows.length > 2000) { res.status(400).json({ error: "2,000 lines at most per file." }); return; }
  const orgId = req.user!.orgId, branchId = branchOf(req);
  const { data: products } = await supabase.from("products").select("id, name").eq("org_id", orgId);
  const byName = new Map(((products ?? []) as any[]).map((p) => [String(p.name).trim().toLowerCase(), String(p.id)]));
  const unknown = [...new Set(rows.filter((r) => r.productName && !byName.has(r.productName.trim().toLowerCase())).map((r) => r.productName!))];
  if (unknown.length) { res.status(400).json({ error: `Nothing was imported. These products are not in Protohub (spell them as in Products & Stock): ${unknown.slice(0, 30).join(" · ")}` }); return; }
  const batch = Date.now().toString(36);
  const insert = rows.map((r, i) => ({
    id: `EXP-IMP-${batch}-${i + 1}`, org_id: orgId, branch_id: branchId, date: r.date, category: r.category, amount: r.amount, currency: "NGN",
    description: r.description, paid_by: r.paidBy ?? null, product_id: r.productName ? byName.get(r.productName.trim().toLowerCase()) : null,
    check_status: "verified", recorded_by: req.user!.id, recorded_by_name: req.user!.name ?? null
  }));
  for (let i = 0; i < insert.length; i += 200) {
    const { error } = await supabase.from("expenses").insert(insert.slice(i, i + 200));
    if (error) { res.status(500).json({ error: `Stopped at line ${i + 1}: ${error.message}. Lines before it were saved.` }); return; }
  }
  res.status(201).json({ imported: insert.length, total: insert.reduce((s, r) => s + r.amount, 0) });
});

export default router;
