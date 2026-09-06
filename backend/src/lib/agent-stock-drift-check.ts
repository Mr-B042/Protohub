import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

// Migration 247 establishes opening balances and records every later balance
// delta with its ledger row in the same transaction. These views therefore
// report exact post-migration drift across all inventory stores and caches.
const DRIFT_TYPE = "agent_stock_drift";

type Finding = {
  orgId: string;
  key: string;
  signature: string;
  title: string;
  message: string;
};

async function alreadyReported(finding: Finding) {
  const marker = `[inventory:${finding.key}@${finding.signature}]`;
  const { data } = await supabase
    .from("system_notifications")
    .select("id")
    .eq("org_id", finding.orgId)
    .eq("type", DRIFT_TYPE)
    .ilike("message", `%${marker}%`)
    .limit(1);
  return Boolean(data?.length);
}

const signed = (value: unknown) => {
  const number = Number(value ?? 0);
  return `${number > 0 ? "+" : ""}${number}`;
};

export async function runAgentStockDriftCheck() {
  const [balanceResult, aggregateResult, pdaResult] = await Promise.all([
    supabase.from("inventory_balance_reconciliation").select("*"),
    supabase.from("inventory_aggregate_reconciliation").select("*"),
    supabase.from("pda_inventory_reconciliation").select("*")
  ]);
  if (balanceResult.error) throw balanceResult.error;
  if (aggregateResult.error) throw aggregateResult.error;
  if (pdaResult.error) throw pdaResult.error;

  const balanceRows = (balanceResult.data ?? []).filter((row: any) => Number(row.drift ?? 0) !== 0);
  const aggregateRows = (aggregateResult.data ?? []).filter((row: any) =>
    [row.quantity_drift, row.defective_drift, row.missing_drift, row.product_cache_drift]
      .some((value) => Number(value ?? 0) !== 0)
  );
  const pdaRows = (pdaResult.data ?? []).filter((row: any) =>
    [row.available_drift, row.reserved_drift, row.out_for_delivery_drift,
      row.damaged_drift, row.missing_drift, row.awaiting_investigation_drift]
      .some((value) => Number(value ?? 0) !== 0)
  );

  const productIds = [...new Set([
    ...balanceRows.map((row: any) => row.product_id),
    ...aggregateRows.map((row: any) => row.product_id),
    ...pdaRows.map((row: any) => row.product_id)
  ].filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))];
  const locationIds = [...new Set(balanceRows.map((row: any) => row.agent_location_id).filter(Boolean))];
  const agentIds = [...new Set(aggregateRows.map((row: any) => row.agent_id).filter(Boolean))];
  const pdaAgentIds = [...new Set(pdaRows.map((row: any) => row.agent_id).filter(Boolean))];

  const [products, locations, agents, pdaAgents] = await Promise.all([
    productIds.length ? supabase.from("products").select("id, name").in("id", productIds) : Promise.resolve({ data: [] }),
    locationIds.length ? supabase.from("agent_locations").select("id, name").in("id", locationIds) : Promise.resolve({ data: [] }),
    agentIds.length ? supabase.from("agents").select("id, name").in("id", agentIds) : Promise.resolve({ data: [] }),
    pdaAgentIds.length ? supabase.from("personal_delivery_agents").select("id, full_name").in("id", pdaAgentIds) : Promise.resolve({ data: [] })
  ]);
  const productName = new Map((products.data ?? []).map((row: any) => [row.id, String(row.name ?? row.id)]));
  const locationName = new Map((locations.data ?? []).map((row: any) => [row.id, String(row.name ?? row.id)]));
  const agentName = new Map((agents.data ?? []).map((row: any) => [row.id, String(row.name ?? row.id)]));
  const pdaAgentName = new Map((pdaAgents.data ?? []).map((row: any) => [row.id, String(row.full_name ?? row.id)]));

  const findings: Finding[] = [];
  for (const row of balanceRows as any[]) {
    const place = row.scope === "warehouse"
      ? "Warehouse"
      : (locationName.get(row.agent_location_id) ?? "Unknown hub");
    const product = productName.get(row.product_id) ?? row.product_id;
    const drift = Number(row.drift ?? 0);
    findings.push({
      orgId: row.org_id,
      key: `balance:${row.scope}:${row.agent_location_id ?? "warehouse"}:${row.product_id}`,
      signature: String(drift),
      title: `Inventory and ledger differ — ${place}`,
      message: `${product} at ${place} stores ${row.stored_quantity}, while its atomic ledger explains ${row.ledger_quantity} (${signed(drift)}).`
    });
  }
  for (const row of aggregateRows as any[]) {
    const product = productName.get(row.product_id) ?? row.product_id;
    const agent = agentName.get(row.agent_id) ?? "Unknown agent";
    const values = [row.quantity_drift, row.defective_drift, row.missing_drift, row.product_cache_drift].map(Number);
    findings.push({
      orgId: row.org_id,
      key: `aggregate:${row.agent_id}:${row.product_id}`,
      signature: values.join(","),
      title: `Inventory cache differs — ${agent}`,
      message: `${product} cache differences for ${agent}: available ${signed(values[0])}, defective ${signed(values[1])}, missing ${signed(values[2])}, product total ${signed(values[3])}.`
    });
  }
  for (const row of pdaRows as any[]) {
    const agent = pdaAgentName.get(row.agent_id) ?? "Unknown delivery agent";
    const product = productName.get(row.product_id) ?? row.product_id;
    const values = [row.available_drift, row.reserved_drift, row.out_for_delivery_drift,
      row.damaged_drift, row.missing_drift, row.awaiting_investigation_drift].map(Number);
    findings.push({
      orgId: row.org_id,
      key: `pda:${row.agent_id}:${row.product_id}`,
      signature: values.join(","),
      title: `Delivery-agent inventory differs — ${agent}`,
      message: `${product} bucket differences for ${agent}: available ${signed(values[0])}, reserved ${signed(values[1])}, out ${signed(values[2])}, damaged ${signed(values[3])}, missing ${signed(values[4])}, investigation ${signed(values[5])}.`
    });
  }

  if (findings.length === 0) {
    return {
      checked: (balanceResult.data?.length ?? 0) + (aggregateResult.data?.length ?? 0) + (pdaResult.data?.length ?? 0),
      flagged: 0,
      alerted: 0
    };
  }

  const { data: recipients, error: recipientError } = await supabase
    .from("users").select("id, org_id, role, active")
    .in("role", ["Owner", "Admin", "Inventory Manager"]).eq("active", true);
  if (recipientError) throw recipientError;

  let alerted = 0;
  for (const finding of findings) {
    if (await alreadyReported(finding)) continue;
    const marker = `[inventory:${finding.key}@${finding.signature}]`;
    for (const user of (recipients ?? []).filter((row: any) => row.org_id === finding.orgId)) {
      const { error } = await supabase.from("system_notifications").insert({
        org_id: finding.orgId,
        recipient_id: (user as any).id,
        type: DRIFT_TYPE,
        title: finding.title,
        message: `${finding.message} Direct stock writes are blocked; investigate this immediately. ${marker}`,
        link: "#/inventory",
        read: false
      });
      if (error) {
        logger.warn("inventory drift notification failed", { key: finding.key, error: error.message });
      } else {
        alerted += 1;
      }
    }
  }

  return {
    checked: (balanceResult.data?.length ?? 0) + (aggregateResult.data?.length ?? 0) + (pdaResult.data?.length ?? 0),
    flagged: findings.length,
    alerted
  };
}
