import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";
import { addDays, cleanSettings, lagosDay } from "../lib/waybill-follow-up-rules.js";
import {
  FollowUpError, RESPONSIBLE_ROLES, activeWaybills, addLogs, dashboardFor, decideMiss, disputeMiss, evidenceUrl, historyFor,
  missesBetween, responsibleFor, settingsFor, weekReport
} from "../lib/waybill-follow-up.js";

/**
 * Waybill Follow-Up Center (Bright, 7 Nov 2026), under Inventory & Logistics
 * Operations. Leadership and inventory staff use it; the Logistics manager
 * logs the follow-ups and is charged ₦500 per waybill per missed session.
 */
const router = Router();
router.use(requireAuth);

const VIEW = ["Owner", "Admin", "Manager", "Inventory Manager", "Inventory Manager & Logistics Operations"] as const;
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const fail = (res: any, error: unknown, fallback: string) => {
  if (error instanceof FollowUpError) { res.status(error.status).json({ error: error.message }); return; }
  const message = error instanceof Error ? error.message : (error as any)?.message ?? fallback;
  res.status(500).json({ error: String(message || fallback) });
};

router.get("/dashboard", requireRole(...VIEW), async (req, res) => {
  try {
    const date = dateSchema.safeParse(req.query.date).success ? String(req.query.date) : lagosDay(Date.now());
    res.json(await dashboardFor(req.user!.orgId, date));
  } catch (error) { fail(res, error, "Could not load the follow-up dashboard."); }
});

router.get("/waybills", requireRole(...VIEW), async (req, res) => {
  try { res.json(await activeWaybills(req.user!.orgId)); } catch (error) { fail(res, error, "Could not load the waybills."); }
});

router.get("/history", requireRole(...VIEW), async (req, res) => {
  try {
    const today = lagosDay(Date.now());
    const to = dateSchema.safeParse(req.query.to).success ? String(req.query.to) : today;
    const from = dateSchema.safeParse(req.query.from).success ? String(req.query.from) : addDays(to, -6);
    const waybill = typeof req.query.waybill === "string" ? req.query.waybill.trim().slice(0, 40) : "";
    res.json(await historyFor(req.user!.orgId, from, to, waybill || undefined));
  } catch (error) { fail(res, error, "Could not load the history."); }
});

router.post("/logs", requireRole(...VIEW), async (req, res) => {
  try {
    const body = req.body ?? {};
    res.status(201).json(await addLogs(req.user!.orgId, { id: req.user!.id, name: req.user!.name ?? null }, {
      waybillIds: body.waybillIds, channels: body.channels, response: body.response, responseNote: body.responseNote,
      nextAction: body.nextAction, evidence: body.evidence ?? null
    }));
  } catch (error) { fail(res, error, "Could not save the follow-up."); }
});

router.get("/logs/:id/evidence", requireRole(...VIEW), async (req, res) => {
  try { res.json({ url: await evidenceUrl(req.user!.orgId, String(req.params.id)) }); } catch (error) { fail(res, error, "Could not open the photo."); }
});

router.get("/misses", requireRole(...VIEW), async (req, res) => {
  try {
    const today = lagosDay(Date.now());
    const to = dateSchema.safeParse(req.query.to).success ? String(req.query.to) : today;
    const from = dateSchema.safeParse(req.query.from).success ? String(req.query.from) : addDays(to, -13);
    res.json({ misses: await missesBetween(req.user!.orgId, from, to), viewerId: scopeOf(req).id });
  } catch (error) { fail(res, error, "Could not load the charges."); }
});

router.post("/misses/:id/dispute", requireRole(...VIEW), async (req, res) => {
  const parsed = z.object({ reason: z.string().max(500) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Say why this charge is wrong." }); return; }
  try {
    await disputeMiss(req.user!.orgId, String(req.params.id), { id: req.user!.id, role: req.user!.role }, parsed.data.reason);
    res.json({ ok: true });
  } catch (error) { fail(res, error, "Could not dispute the charge."); }
});

// Keeping or cancelling a charge is the Owner's (Bright chose: charged automatically, the Owner decides disputes).
router.post("/misses/:id/decide", requireRole("Owner"), async (req, res) => {
  const parsed = z.object({ decision: z.enum(["keep", "cancel"]), note: z.string().max(500).default("") }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose keep or cancel." }); return; }
  try {
    await decideMiss(req.user!.orgId, String(req.params.id), { name: req.user!.name ?? null }, parsed.data.decision, parsed.data.note);
    res.json({ ok: true });
  } catch (error) { fail(res, error, "Could not save the decision."); }
});

router.get("/report", requireRole(...VIEW), async (req, res) => {
  try {
    const today = lagosDay(Date.now());
    const asked = dateSchema.safeParse(req.query.weekStart).success ? String(req.query.weekStart) : today;
    const weekStart = addDays(asked, -new Date(`${asked}T12:00:00Z`).getUTCDay());
    res.json(await weekReport(req.user!.orgId, weekStart));
  } catch (error) { fail(res, error, "Could not load the report."); }
});

router.get("/settings", requireRole(...VIEW), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const settings = await settingsFor(orgId);
    const [responsible, people] = await Promise.all([
      responsibleFor(orgId, settings),
      supabase.from("users").select("id, name, role").eq("org_id", orgId).eq("active", true).in("role", RESPONSIBLE_ROLES).order("name")
    ]);
    if (people.error) throw people.error;
    res.json({ settings, responsible, people: people.data ?? [] });
  } catch (error) { fail(res, error, "Could not load the settings."); }
});

router.patch("/settings", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const current = await settingsFor(orgId);
    const next = cleanSettings({ ...current, ...(req.body ?? {}) });
    if (next.responsibleUserId) {
      const { data } = await supabase.from("users").select("id, role, active").eq("org_id", orgId).eq("id", next.responsibleUserId).maybeSingle();
      if (!data || (data as any).active === false || !RESPONSIBLE_ROLES.includes(String((data as any).role))) {
        res.status(400).json({ error: "Choose an active Logistics, Inventory, Manager or Admin user." });
        return;
      }
    }
    const { error } = await supabase.from("waybill_follow_up_settings").upsert({
      org_id: orgId, responsible_user_id: next.responsibleUserId, amount: next.amount, grace_minutes: next.graceMinutes,
      working_days: next.workingDays, charges_from: next.chargesFrom, overdue_after_days: next.overdueAfterDays,
      updated_by_name: req.user!.name ?? null, updated_at: new Date().toISOString()
    }, { onConflict: "org_id" });
    if (error) throw error;
    res.json({ settings: next });
  } catch (error) { fail(res, error, "Could not save the settings."); }
});

export default router;
