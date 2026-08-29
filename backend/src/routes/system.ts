import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { probeRowCapDeep } from "../lib/row-cap-probe.js";
import { REPORT_ROW_CEILING } from "../lib/query-limits.js";

const router = Router();
router.use(requireAuth);

/**
 * ⚠️ WHY THIS ENDPOINT EXISTS. `Supabase → Settings → API → Max rows` silently
 * governs over 100 reporting queries, and nothing in the code can see it. The
 * probe that reads it used to run ONLY at boot, so on 2026-08-29 the setting
 * was raised at 21:01 and could not be confirmed until production was
 * restarted at 22:15 - a restart whose entire purpose was to re-run three
 * read-only queries. Owner-only because it reports schema-level facts (real
 * table sizes), not because it changes anything: it writes nothing.
 */
router.get("/row-cap", requireRole("Owner"), async (_req, res) => {
  const probe = await probeRowCapDeep();
  const setting = "Supabase → Settings → API → Max rows";
  if (probe.status === "capped") {
    res.json({
      ...probe,
      reportCeiling: REPORT_ROW_CEILING,
      verdict: `PostgREST is truncating reads at ${probe.cap} rows. Every unpaged list query is returning a partial set with no error. Raise ${setting} to at least ${REPORT_ROW_CEILING}.`
    });
    return;
  }
  if (probe.status === "clear") {
    res.json({
      ...probe,
      reportCeiling: REPORT_ROW_CEILING,
      verdict: probe.capIsAtLeast >= REPORT_ROW_CEILING
        ? `No truncation. The cap clears REPORT_ROW_CEILING (${REPORT_ROW_CEILING}), so every query carrying that limit gets its full result.`
        : `No truncation on ${probe.table}, but the largest table available only proves the cap is at least ${probe.capIsAtLeast} - below REPORT_ROW_CEILING (${REPORT_ROW_CEILING}). A query over a bigger table could still truncate.`
    });
    return;
  }
  res.status(503).json({
    ...probe,
    reportCeiling: REPORT_ROW_CEILING,
    verdict: probe.status === "inconclusive"
      ? "No table is large enough for a probe to mean anything yet."
      : "The probe could not run."
  });
});

export default router;
