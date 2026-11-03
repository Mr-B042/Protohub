import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { addDaysToDateKey, lagosDateKey } from "../lib/sales-bonus-engine.js";

/**
 * Page visits (Bright, 3 Nov 2026): which pages each person opens. The app
 * calls POST when someone settles on a page; the Owner reads them on User
 * Management. One row per person, page and day (migration 319).
 */
const router = Router();
router.use(requireAuth);

const VisitSchema = z.object({
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160)
});

router.post("/", async (req, res) => {
  const parsed = VisitSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Page name missing." }); return; }
  // The Owner's "View as" is not the other person opening the page.
  if (req.user!.effectiveUserId && req.user!.effectiveUserId !== req.user!.id) { res.json({ ok: true, skipped: true }); return; }
  const { error } = await supabase.rpc("record_page_visit", {
    p_org: req.user!.orgId, p_branch: req.user!.branchId ?? null, p_user: req.user!.id,
    p_key: parsed.data.key, p_label: parsed.data.label, p_day: lagosDateKey(new Date().toISOString())
  });
  // Never trouble the person over a visit that could not be noted.
  if (error) console.warn("[page-visits]", error.message);
  res.json({ ok: !error });
});

router.get("/", requireRole("Owner"), async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const today = lagosDateKey(new Date().toISOString());
    const since = addDaysToDateKey(today, -(days - 1));
    const rows: any[] = [];
    for (let page = 0; page < 50; page += 1) {
      const { data, error } = await supabase.from("page_visit_days").select("user_id, page_key, page_label, day, visits, last_at")
        .eq("org_id", req.user!.orgId).gte("day", since).order("day", { ascending: false }).order("user_id").order("page_key")
        .range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    const { data: users, error: userError } = await supabase.from("users").select("id, name, role, active").eq("org_id", req.user!.orgId).eq("active", true);
    if (userError) throw userError;
    // Per person and page: times opened, days opened, last opened.
    const summary = new Map<string, { userId: string; pageKey: string; pageLabel: string; visits: number; days: number; lastAt: string; today: number }>();
    for (const row of rows) {
      const key = `${row.user_id}|${row.page_key}`;
      const entry = summary.get(key) ?? { userId: String(row.user_id), pageKey: String(row.page_key), pageLabel: String(row.page_label), visits: 0, days: 0, lastAt: String(row.last_at), today: 0 };
      entry.visits += Number(row.visits) || 0;
      entry.days += 1;
      if (String(row.last_at) > entry.lastAt) { entry.lastAt = String(row.last_at); entry.pageLabel = String(row.page_label); }
      if (String(row.day).slice(0, 10) === today) entry.today += Number(row.visits) || 0;
      summary.set(key, entry);
    }
    res.json({
      since, today, days,
      users: (users ?? []).map((user: any) => ({ id: String(user.id), name: String(user.name ?? "User"), role: String(user.role ?? "") })),
      visits: [...summary.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    });
  } catch (error: any) {
    console.error("[page-visits]", error?.message ?? error);
    res.status(500).json({ error: error?.message ?? "Could not load page visits." });
  }
});

export default router;
