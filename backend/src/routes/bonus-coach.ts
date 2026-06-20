import { Router } from "express";
import { z } from "zod";
import { getRepBonusCoach } from "../lib/bonus-coach.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const QuerySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const ParamsSchema = z.object({
  repId: z.string().uuid()
});

router.get("/me", async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const scopeId = req.user!.effectiveUserId ?? req.user!.id;
    const payload = await getRepBonusCoach(req.user!.orgId, scopeId, parsed.data.weekStart);
    res.json(payload);
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Failed to build bonus coach." });
  }
});

router.get("/rep/:repId", requireRole("Owner", "Admin", "Manager"), async (req, res) => {
  const parsedQuery = QuerySchema.safeParse(req.query);
  const parsedParams = ParamsSchema.safeParse(req.params);
  if (!parsedQuery.success || !parsedParams.success) {
    res.status(400).json({
      error: {
        ...(!parsedQuery.success ? parsedQuery.error.flatten().fieldErrors : {}),
        ...(!parsedParams.success ? parsedParams.error.flatten().fieldErrors : {})
      }
    });
    return;
  }
  try {
    const payload = await getRepBonusCoach(req.user!.orgId, parsedParams.data.repId, parsedQuery.data.weekStart);
    res.json(payload);
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Failed to build bonus coach." });
  }
});

export default router;
