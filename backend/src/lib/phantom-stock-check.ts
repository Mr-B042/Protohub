// Phantom-stock safety net - a daily audit that flags any order marked Delivered
// whose agent stock was NOT actually deducted (no "Order Fulfilled" movement).
//
// This should essentially never fire. The delivery deduction has a lenient hub
// fallback (commit 430f17e) plus a try/catch that flips stock_deducted=false on
// any failure, so a Delivered order that still reads stock_deducted=true has had
// its deduction run to completion. This cron is belt-and-suspenders: if some
// unforeseen edge ever strands an order Delivered-but-undeducted, an Owner/Admin
// hears about it within a day instead of discovering phantom stock weeks later.
//
// Detection = Delivered + agent-fulfilled + physical (product set) order that has
// NO "Order Fulfilled" stock_movements row. Notifies Owners/Admins in-app.
// Runs from cron in src/index.ts under ENABLE_BACKGROUND_JOBS.

import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { createHash } from "node:crypto";

const RECIPIENT_ROLES = ["Owner", "Admin"] as const;
// Older phantoms (the one-off June remediation) are already fixed, and bounding
// the scan keeps the daily job cheap. New phantoms would be recent.
const LOOKBACK_DAYS = 60;
const DEDUPE_LINK = "stock-audit/phantom";
// Keep the legacy base-link guard briefly so old deployed notifications don't
// duplicate while a new deployment is rolling out.
const LEGACY_DEDUPE_WINDOW_HOURS = 72;

function phantomDedupeLink(orderIds: string[]) {
  const stable = orderIds.slice().sort().join(",");
  const hash = createHash("sha256").update(stable).digest("hex").slice(0, 16);
  return `${DEDUPE_LINK}/${hash}`;
}

async function scanOrgForPhantomStock(orgId: string): Promise<number> {
  const sinceDate = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().split("T")[0];

  // Delivered + agent-fulfilled + physical (has a product) orders in the window.
  const { data: delivered, error } = await supabase
    .from("orders")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "Delivered")
    .gte("delivered_date", sinceDate)
    .not("agent_id", "is", null)
    .not("product_id", "is", null);
  if (error) { logger.warn("phantom-stock: orders fetch failed", { orgId, error: error.message }); return 0; }
  if (!delivered || delivered.length === 0) return 0;

  const orderIds = (delivered as { id: string }[]).map((o) => o.id);

  // Which of these actually have a fulfilment movement? (chunk the IN list)
  const fulfilled = new Set<string>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200);
    const { data: movs } = await supabase
      .from("stock_movements")
      .select("order_id")
      .eq("org_id", orgId)
      .eq("type", "Order Fulfilled")
      .in("order_id", chunk);
    for (const m of (movs ?? []) as { order_id: string | null }[]) {
      if (m.order_id) fulfilled.add(m.order_id);
    }
  }

  const phantoms = orderIds.filter((id) => !fulfilled.has(id));
  if (phantoms.length === 0) return 0;

  // Reset stock_deducted=false so a "Re-save the delivery" actually retriggers
  // the deduction. Without this, the isDeliveredDateCorrection guard in the
  // status handler silently skips deduction on every re-save attempt.
  for (let i = 0; i < phantoms.length; i += 200) {
    await supabase.from("orders")
      .update({ stock_deducted: false })
      .eq("org_id", orgId)
      .in("id", phantoms.slice(i, i + 200));
  }

  // Recipients = active Owners/Admins
  const { data: recipientsRaw } = await supabase
    .from("users").select("id").eq("org_id", orgId).eq("active", true)
    .in("role", RECIPIENT_ROLES as unknown as string[]);
  const recipientIds = Array.from(new Set(((recipientsRaw ?? []) as { id: string }[]).map((r) => r.id)));
  if (recipientIds.length === 0) return 0;

  // Dedupe per exact phantom set. If the same order stays broken overnight, don't
  // spam Owner/Admin again. If a new/different phantom appears, send a fresh alert.
  const n = phantoms.length;
  const sample = phantoms.slice(0, 6).join(", ");
  const link = phantomDedupeLink(phantoms);
  const { data: recent } = await supabase
    .from("system_notifications").select("id")
    .eq("org_id", orgId).eq("type", "info").eq("link", link)
    .limit(1);
  if (recent && recent.length > 0) return 0;

  const legacyDedupeSince = new Date(Date.now() - LEGACY_DEDUPE_WINDOW_HOURS * 3_600_000).toISOString();
  const { data: legacyRecent } = await supabase
    .from("system_notifications").select("id")
    .eq("org_id", orgId).eq("type", "info").eq("link", DEDUPE_LINK)
    .ilike("message", `%(${sample}%`)
    .gte("created_at", legacyDedupeSince).limit(1);
  if (legacyRecent && legacyRecent.length > 0) return 0;

  const title = `Stock audit: ${n} delivered order${n === 1 ? "" : "s"} not deducted`;
  const message = `${n} order${n === 1 ? " was" : "s were"} marked Delivered but agent stock was NOT deducted (${sample}${n > 6 ? ", ..." : ""}). Re-save the delivery on each to retry, or check the agent's hub.`;

  const rows = recipientIds.map((rid) => ({
    org_id: orgId,
    recipient_id: rid,
    type: "info",
    title,
    message,
    link,
    read: false
  }));
  const { error: insertErr } = await supabase.from("system_notifications").insert(rows);
  if (insertErr) { logger.error("phantom-stock: insert failed", { orgId, error: insertErr.message }); return 0; }

  logger.info("phantom-stock: alert fired", { orgId, phantoms: n, recipients: recipientIds.length });
  return n;
}

export async function runPhantomStockCheck(): Promise<{ scannedOrgs: number; phantomOrders: number }> {
  const { data: orgsRaw, error } = await supabase.from("organizations").select("id");
  if (error) { logger.error("phantom-stock: orgs fetch failed", { error: error.message }); return { scannedOrgs: 0, phantomOrders: 0 }; }
  let phantomOrders = 0;
  for (const org of (orgsRaw ?? []) as { id: string }[]) {
    try {
      phantomOrders += await scanOrgForPhantomStock(org.id);
    } catch (err: any) {
      logger.warn("phantom-stock: org scan crashed", { orgId: org.id, error: err?.message ?? String(err) });
    }
  }
  return { scannedOrgs: (orgsRaw ?? []).length, phantomOrders };
}
