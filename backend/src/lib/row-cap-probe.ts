import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

/**
 * Detect PostgREST's row cap at boot and say so out loud.
 *
 * ⚠️ WHY THIS EXISTS. PostgREST enforces a project-level max-rows ceiling and
 * truncates to it WITHOUT an error. A query can ask for 20,000 rows, be handed
 * 1,000, and report them as the complete set - which is how the expense ledger
 * silently cut off at 2026-07-18 and made every ad cost before that date look
 * deleted, while carrying an explicit .limit() that was supposed to prevent it.
 *
 * 112 queries in this codebase pass .limit(REPORT_ROW_CEILING). Every one of
 * them is only as good as that project setting, and nothing in the code can
 * see it. This probe compares what the REST layer returns against what SQL
 * says is really there, so a wrong setting is a loud line in the boot log
 * rather than a number quietly missing from a report months later.
 *
 * It does NOT fix anything. Raising the cap is a dashboard change:
 *   Supabase → Settings → API → Max rows
 */
const PROBE_TABLE = "orders";
const PROBE_ASK = 5000;

export async function probeRowCap(orgId?: string) {
  try {
    // What SQL says exists.
    let countQuery = supabase.from(PROBE_TABLE).select("id", { count: "exact", head: true });
    if (orgId) countQuery = countQuery.eq("org_id", orgId);
    const { count, error: countError } = await countQuery;
    if (countError || count == null) return null;

    // Only meaningful once the table is big enough to be truncated at all.
    if (count <= 1000) {
      logger.info("row-cap probe skipped: table below any plausible cap", { table: PROBE_TABLE, rows: count });
      return null;
    }

    let rowQuery = supabase.from(PROBE_TABLE).select("id").limit(PROBE_ASK);
    if (orgId) rowQuery = rowQuery.eq("org_id", orgId);
    const { data, error } = await rowQuery;
    if (error) return null;

    const returned = (data ?? []).length;
    const expected = Math.min(count, PROBE_ASK);
    if (returned < expected) {
      logger.error(
        "⚠️ POSTGREST IS TRUNCATING READS. Every unpaged list query is silently "
        + "returning a partial set. Raise Supabase → Settings → API → Max rows.",
        { table: PROBE_TABLE, asked: PROBE_ASK, returned, actuallyExists: count, capAppearsToBe: returned }
      );
      return { capped: true, cap: returned, rows: count };
    }
    logger.info("row-cap probe clear", { table: PROBE_TABLE, returned, rows: count });
    return { capped: false, cap: null, rows: count };
  } catch (error: any) {
    logger.warn("row-cap probe failed", { error: error?.message });
    return null;
  }
}
