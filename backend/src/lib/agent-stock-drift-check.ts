import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

// Nightly check: does each hub's stored balance still match the balance its
// ledger explains?
//
// ⚠️ WHY THIS EXISTS. On 2026-08-26 nine units vanished from four products at
// one hub inside four seconds, with no stock movement, no order, no waybill and
// no HTTP request that mutates stock. Nobody noticed until a shelf count came
// up short days later, and reconstructing it by hand took dozens of queries.
//
// This is the fifth drift incident on this system. The check below is the one
// query that would have caught every one of them the following morning.
//
// ⚠️ IT ALERTS ON *CHANGE*, NOT ON DRIFT. Hubs stocked before location-level
// ledgering existed carry permanent positive drift - their opening balances
// have no movements behind them. 26 pairs were in that state at install.
// Alerting on those nightly would train everyone to ignore the alert, which is
// exactly how a real shortfall goes unseen. Migration 238 seeded those into
// agent_stock_drift_baseline; this compares against it and reports only what
// moved.

const DRIFT_TYPE = "agent_stock_drift";

type DriftRow = {
  org_id: string;
  agent_id: string;
  agent_location_id: string;
  product_id: string;
  stored_quantity: number;
  ledger_quantity: number;
  drift: number;
};

type Baseline = { agent_location_id: string; product_id: string; drift: number };

const key = (locationId: string, productId: string) => `${locationId}|${productId}`;

/**
 * One notification per hub/product per drift value.
 *
 * ⚠️ Keyed on the DRIFT, not just the pair. A shortfall that gets worse must be
 * able to raise a fresh alarm, while a nightly job must not re-send the same
 * unresolved figure every single night until someone mutes it.
 */
async function alreadyReported(orgId: string, locationId: string, productId: string, drift: number) {
  const { data } = await supabase
    .from("system_notifications")
    .select("id")
    .eq("org_id", orgId)
    .eq("type", DRIFT_TYPE)
    .ilike("message", `%[${key(locationId, productId)}@${drift}]%`)
    .limit(1);
  return Boolean(data && data.length > 0);
}

export async function runAgentStockDriftCheck() {
  const [{ data: rows, error }, { data: baselineRows, error: baselineError }] = await Promise.all([
    supabase.from("agent_stock_reconciliation")
      .select("org_id, agent_id, agent_location_id, product_id, stored_quantity, ledger_quantity, drift"),
    supabase.from("agent_stock_drift_baseline").select("agent_location_id, product_id, drift")
  ]);
  if (error) throw error;
  if (baselineError) throw baselineError;

  const baseline = new Map<string, number>();
  for (const row of (baselineRows ?? []) as Baseline[]) {
    baseline.set(key(row.agent_location_id, row.product_id), Number(row.drift ?? 0));
  }

  const changed = ((rows ?? []) as DriftRow[]).filter(
    (row) => Number(row.drift ?? 0) !== (baseline.get(key(row.agent_location_id, row.product_id)) ?? 0)
  );
  if (changed.length === 0) return { checked: (rows ?? []).length, flagged: 0, alerted: 0 };

  // Names, so an alert reads as a place and a product rather than two UUIDs.
  const locationIds = [...new Set(changed.map((row) => row.agent_location_id))];
  const productIds = [...new Set(changed.map((row) => row.product_id))];
  const [{ data: locations }, { data: products }] = await Promise.all([
    supabase.from("agent_locations").select("id, name").in("id", locationIds),
    supabase.from("products").select("id, name").in("id", productIds)
  ]);
  const locationName = new Map((locations ?? []).map((row: any) => [row.id, row.name as string]));
  const productName = new Map((products ?? []).map((row: any) => [row.id, row.name as string]));

  // Owners and Admins - this is a money question, not a rep's task.
  const { data: recipients } = await supabase
    .from("users").select("id, org_id, role, active")
    .in("role", ["Owner", "Admin", "Inventory Manager"]).eq("active", true);

  let alerted = 0;
  for (const row of changed) {
    const orgId = row.org_id;
    const drift = Number(row.drift ?? 0);
    if (await alreadyReported(orgId, row.agent_location_id, row.product_id, drift)) continue;

    const hub = locationName.get(row.agent_location_id) ?? "a hub";
    const product = productName.get(row.product_id) ?? "a product";
    // Short is the dangerous direction: stock left the books with nothing
    // recording where it went. Over is usually a missing inbound movement.
    const short = drift < 0;
    const title = short
      ? `Stock short of its ledger — ${hub}`
      : `Stock above its ledger — ${hub}`;
    const message =
      `${product} at ${hub} shows ${row.stored_quantity}, but its movements only account for `
      + `${row.ledger_quantity} (${drift > 0 ? "+" : ""}${drift}). `
      + (short
        ? "Units have left the books with no movement recording it. Check agent_stock_audit for who changed the row."
        : "There is more stock on the books than inbound movements explain.")
      + ` [${key(row.agent_location_id, row.product_id)}@${drift}]`;

    for (const user of (recipients ?? []).filter((u: any) => u.org_id === orgId)) {
      const { error: insertError } = await supabase.from("system_notifications").insert({
        org_id: orgId,
        recipient_id: (user as any).id,
        type: DRIFT_TYPE,
        title,
        message,
        link: "#/inventory",
        read: false
      });
      if (insertError) {
        logger.warn("agent stock drift insert failed", { orgId, hub, product, error: insertError.message });
        continue;
      }
      alerted += 1;
    }
  }

  return { checked: (rows ?? []).length, flagged: changed.length, alerted };
}
