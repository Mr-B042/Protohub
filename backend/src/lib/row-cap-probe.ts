import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { REPORT_ROW_CEILING } from "./query-limits.js";

/**
 * Detect PostgREST's row cap and say so out loud.
 *
 * ⚠️ WHY THIS EXISTS. PostgREST enforces a project-level max-rows ceiling and
 * truncates to it WITHOUT an error. A query can ask for 20,000 rows, be handed
 * 1,000, and report them as the complete set - which is how the expense ledger
 * silently cut off at 2026-07-18 and made every ad cost before that date look
 * deleted, while carrying an explicit .limit() that was supposed to prevent it.
 *
 * Over 100 queries in this codebase pass .limit(REPORT_ROW_CEILING). Every one
 * of them is only as good as that project setting, and nothing in the code can
 * see it. This probe compares what the REST layer returns against what SQL
 * says is really there, so a wrong setting is loud rather than a number
 * quietly missing from a report months later.
 *
 * It does NOT fix anything. Raising the cap is a dashboard change:
 *   Supabase → Settings → API → Max rows
 *
 * ⚠️ IT NO LONGER RUNS ONLY AT BOOT. It used to, and that was a bad trade for
 * a read-only check: on 2026-08-29 the setting was raised at 21:01 and could
 * not be confirmed until production was restarted at 22:15, purely to re-run
 * three queries. GET /api/system/row-cap (Owner) runs it on demand.
 */
const BOOT_PROBE_TABLE = "orders";
const BOOT_PROBE_ASK = 5000;

/**
 * Tried in order by the on-demand probe, largest first. A probe can only prove
 * the cap is at least as high as the rows that came back, so measuring a
 * 20,000 ceiling needs a table with more than 20,000 rows in it - `orders`
 * (~3,000) can only ever report "not truncating".
 */
const DEEP_PROBE_TABLES = ["cart_journey_events", "order_audit", "system_notifications", "orders"] as const;

export type RowCapProbe =
  | { status: "clear"; table: string; asked: number; returned: number; rows: number; capIsAtLeast: number }
  | { status: "capped"; table: string; asked: number; returned: number; rows: number; cap: number }
  | { status: "inconclusive"; table: string; rows: number; reason: string }
  | { status: "failed"; reason: string };

async function countRows(table: string, orgId?: string): Promise<number | null> {
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  if (orgId) query = query.eq("org_id", orgId);
  const { count, error } = await query;
  if (error || count == null) return null;
  return count;
}

export async function probeRowCap(opts: { table?: string; ask?: number; orgId?: string } = {}): Promise<RowCapProbe> {
  const table = opts.table ?? BOOT_PROBE_TABLE;
  const ask = opts.ask ?? BOOT_PROBE_ASK;
  try {
    // What SQL says exists. count() is computed server-side and is NOT subject
    // to the row cap, which is what makes it a usable reference.
    const count = await countRows(table, opts.orgId);
    if (count == null) return { status: "failed", reason: `could not count ${table}` };

    // Only meaningful once the table is big enough to be truncated at all.
    if (count <= 1000) {
      return { status: "inconclusive", table, rows: count, reason: "table is below any plausible cap" };
    }

    let rowQuery = supabase.from(table).select("id").limit(ask);
    if (opts.orgId) rowQuery = rowQuery.eq("org_id", opts.orgId);
    const { data, error } = await rowQuery;
    if (error) return { status: "failed", reason: error.message };

    const returned = (data ?? []).length;
    const expected = Math.min(count, ask);
    if (returned < expected) {
      return { status: "capped", table, asked: ask, returned, rows: count, cap: returned };
    }
    return { status: "clear", table, asked: ask, returned, rows: count, capIsAtLeast: returned };
  } catch (error: any) {
    return { status: "failed", reason: error?.message ?? "probe threw" };
  }
}

/**
 * On-demand probe. Picks the largest available table and asks for more rows
 * than REPORT_ROW_CEILING, so a "clear" result means the setting genuinely
 * clears the ceiling every report relies on - not merely that one small table
 * fitted underneath it.
 */
export async function probeRowCapDeep(orgId?: string): Promise<RowCapProbe> {
  const ask = REPORT_ROW_CEILING + 5000;
  let best: RowCapProbe | null = null;
  for (const table of DEEP_PROBE_TABLES) {
    const count = await countRows(table, orgId);
    if (count == null || count <= 1000) continue;
    const result = await probeRowCap({ table, ask: Math.min(ask, Math.max(count, 1001)), orgId });
    // A table bigger than the ask settles it; anything smaller can only ever
    // say "at least this many", so keep looking for a better witness.
    if (result.status === "capped") return result;
    best = result;
    if (count >= ask) return result;
  }
  return best ?? { status: "failed", reason: "no table large enough to probe" };
}

/** Boot-time probe: logs, ignores the return value. */
export async function logRowCapAtBoot(orgId?: string): Promise<RowCapProbe> {
  const result = await probeRowCap({ orgId });
  if (result.status === "capped") {
    logger.error(
      "⚠️ POSTGREST IS TRUNCATING READS. Every unpaged list query is silently "
      + "returning a partial set. Raise Supabase → Settings → API → Max rows.",
      { table: result.table, asked: result.asked, returned: result.returned, actuallyExists: result.rows, capAppearsToBe: result.cap }
    );
  } else if (result.status === "clear") {
    logger.info("row-cap probe clear", { table: result.table, returned: result.returned, rows: result.rows });
  } else if (result.status === "inconclusive") {
    logger.info("row-cap probe skipped: table below any plausible cap", { table: result.table, rows: result.rows });
  } else {
    logger.warn("row-cap probe failed", { error: result.reason });
  }
  return result;
}
