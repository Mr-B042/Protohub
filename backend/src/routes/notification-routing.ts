import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { ALERTS, ROUTABLE_ROLES, cleanRoute, forgetRouting, getAllRoutes, type AlertKey } from "../lib/notification-routing.js";

// ── Alert routing (Bright, 20 Oct 2026) ─────────────────────────────────────
// Settings → Alert routing. Owner and Admins can see it; ONLY the Owner can
// change it (Bright's choice), so nobody can switch off the Owner's alerts.

const router = Router();
router.use(requireAuth);

const describe = async (orgId: string, role: string) => {
  const routes = await getAllRoutes(orgId);
  return {
    roles: ROUTABLE_ROLES,
    canEdit: role === "Owner",
    alerts: (Object.keys(ALERTS) as AlertKey[]).map((key) => ({
      key,
      label: ALERTS[key].label,
      group: ALERTS[key].group,
      hint: ALERTS[key].hint,
      repApplies: ALERTS[key].repApplies,
      defaults: ALERTS[key].defaults,
      route: routes[key],
    })),
  };
};

router.get("/", requireRole("Owner", "Admin"), async (req, res) => {
  try { res.json(await describe(req.user!.orgId, req.user!.role)); }
  catch (err: any) { res.status(500).json({ error: err?.message ?? "Could not load alert settings." }); }
});

const routeSchema = z.object({ roles: z.array(z.string()).max(20), rep: z.boolean(), push: z.boolean() });
const bodySchema = z.object({ routes: z.record(z.string(), routeSchema) });

router.put("/", requireRole("Owner"), async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "These alert settings could not be read. Refresh and try again." }); return; }
  const orgId = req.user!.orgId;
  const { data: org, error: readError } = await supabase.from("organizations").select("notification_routing").eq("id", orgId).maybeSingle();
  if (readError) { res.status(500).json({ error: readError.message }); return; }
  const next: Record<string, unknown> = { ...((org as any)?.notification_routing ?? {}) };
  for (const [key, route] of Object.entries(parsed.data.routes)) {
    if (!(key in ALERTS)) continue;
    next[key] = cleanRoute(key as AlertKey, route);
  }
  const { error } = await supabase.from("organizations").update({ notification_routing: next }).eq("id", orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  forgetRouting(orgId);
  res.json(await describe(orgId, req.user!.role));
});

export default router;
