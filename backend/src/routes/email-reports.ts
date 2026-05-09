import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendWeeklyReport } from "../lib/mailer.js";

const router = Router();
router.use(requireAuth);

// ── POST /api/email/weekly-report ─────────────────────────
// Trigger manually from the admin Settings page, or call from a cron job.
// For Railway cron: Settings → Cron Jobs → "0 7 * * 0" → POST this endpoint
// (add CRON_SECRET env var and pass it as Authorization: Bearer <secret> for cron calls)
router.post("/weekly-report", requireRole("Owner"), async (req, res) => {
  const result = await sendWeeklyReport(req.user!.orgId);
  if (!result.ok) {
    res.status(500).json({ error: result.error });
    return;
  }
  res.json({ message: "Weekly report sent to owner(s)." });
});

export default router;
