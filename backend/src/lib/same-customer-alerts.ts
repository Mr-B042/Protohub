// Sends "one customer, two reps" alerts (rules: same-customer-model.ts).
// Every 10 minutes in working hours: orders and OPEN carts from the last 7
// days, per branch. Each rep involved is told who else has the customer; the
// Head of Sales (+ Manager, or Admin while there is no Manager) gets one
// summary to decide. Once per situation: a new order/cart joining re-alerts.

import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { sendPushToUsers } from "./push.js";
import { getOrgPushBranding } from "./push-branding.js";
import { supervisors } from "./cart-call-alerts.js";
import { phone10, repMessage, situationKey, splitCustomers, supervisorMessage, type CustomerRecord } from "./same-customer-model.js";

const TYPE = "same_customer_other_rep";
const WINDOW_DAYS = 7;
const CLOSED_CART = new Set(["Converted", "Not interested", "No response"]);

async function scanBranch(orgId: string, branchId: string) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const [ordersRes, cartsRes] = await Promise.all([
    supabase.from("orders").select("id, phone, assigned_rep_id, customer, product_name, created_at, review_hold, source_cart_id")
      .eq("org_id", orgId).eq("branch_id", branchId).gte("created_at", since).not("assigned_rep_id", "is", null).limit(5000),
    supabase.from("abandoned_carts").select("id, phone, assigned_rep_id, customer, product_name, created_at, status")
      .eq("org_id", orgId).eq("branch_id", branchId).gte("created_at", since).not("assigned_rep_id", "is", null).limit(5000)
  ]);
  if (ordersRes.error || cartsRes.error) throw new Error(ordersRes.error?.message ?? cartsRes.error?.message);
  // A cart that became an order is the same purchase, not a second rep's customer.
  const convertedCarts = new Set((ordersRes.data ?? []).map((o: any) => String(o.source_cart_id ?? "")).filter(Boolean));
  const repIds = [...new Set([...(ordersRes.data ?? []), ...(cartsRes.data ?? [])].map((r: any) => String(r.assigned_rep_id)))];
  const { data: reps } = await supabase.from("users").select("id, name").in("id", repIds.length ? repIds : ["00000000-0000-0000-0000-000000000000"]);
  const repName = new Map((reps ?? []).map((u: any) => [String(u.id), String(u.name ?? "Another rep")]));
  const records: CustomerRecord[] = [
    ...(ordersRes.data ?? []).filter((o: any) => !o.review_hold).map((o: any) => ({
      kind: "order" as const, id: String(o.id), phone10: phone10(o.phone), repId: String(o.assigned_rep_id), repName: repName.get(String(o.assigned_rep_id)) ?? "Another rep",
      customer: String(o.customer ?? ""), product: String(o.product_name ?? ""), createdAt: String(o.created_at)
    })),
    ...(cartsRes.data ?? []).filter((c: any) => !CLOSED_CART.has(String(c.status)) && !convertedCarts.has(String(c.id))).map((c: any) => ({
      kind: "cart" as const, id: String(c.id), phone10: phone10(c.phone), repId: String(c.assigned_rep_id), repName: repName.get(String(c.assigned_rep_id)) ?? "Another rep",
      customer: String(c.customer ?? ""), product: String(c.product_name ?? ""), createdAt: String(c.created_at)
    }))
  ];
  const splits = splitCustomers(records);
  if (splits.length === 0) return 0;

  // Once per situation per person: the message names every order / cart and
  // rep involved, so a new one joining changes it. (A "?key" on the link would
  // break the app reading the order number from it.)
  const { data: sent } = await supabase.from("system_notifications").select("recipient_id, message")
    .eq("org_id", orgId).eq("type", TYPE).gte("created_at", new Date(Date.now() - 9 * 86_400_000).toISOString()).limit(5000);
  const seen = new Set((sent ?? []).map((r: any) => `${r.recipient_id}|${r.message}`));
  const bosses = await supervisors(orgId, branchId);
  const branding = await getOrgPushBranding(orgId).catch(() => ({ brandName: "Protohub", brandLogo: undefined }));
  let count = 0;
  for (const split of splits) {
    const key = situationKey(split);
    const out: Array<{ recipient: string; title: string; message: string; link: string }> = [];
    for (const repId of new Set(split.records.map((r) => r.repId))) {
      const msg = repMessage(split, repId);
      const own = msg.mine.find((r) => r.kind === "order");
      const base = own ? `/dashboard/admin/orders/${own.id}` : "/dashboard/sales-rep/abandoned-carts";
      out.push({ recipient: repId, title: msg.title, message: msg.message, link: base });
    }
    const sup = supervisorMessage(split);
    const firstOrder = split.records.find((r) => r.kind === "order");
    for (const boss of bosses) {
      if (out.some((o) => o.recipient === boss.id)) continue;
      out.push({ recipient: boss.id, title: sup.title, message: sup.message, link: firstOrder ? `/dashboard/admin/orders/${firstOrder.id}` : boss.link });
    }
    const fresh = out.filter((o) => !seen.has(`${o.recipient}|${o.message}`));
    if (fresh.length === 0) continue;
    const { error } = await supabase.from("system_notifications").insert(fresh.map((o) => ({
      org_id: orgId, branch_id: branchId, recipient_id: o.recipient, type: TYPE, title: o.title, message: o.message, link: o.link,
      order_id: firstOrder?.id ?? null, read: false
    })));
    if (error) { logger.error("same-customer alert: insert failed", { orgId, error: error.message }); continue; }
    count += 1;
    for (const o of fresh) {
      sendPushToUsers(orgId, [o.recipient], { title: o.title, body: o.message, kind: TYPE, url: o.link, tag: `${TYPE}-${key}`, brandName: branding.brandName, brandLogo: branding.brandLogo })
        .catch((err) => logger.warn("same-customer alert: push failed", { error: err?.message ?? String(err) }));
    }
  }
  return count;
}

export async function runSameCustomerAlerts(): Promise<{ branches: number; alerted: number }> {
  const { data: branches, error } = await supabase.from("branches").select("id, org_id").eq("active", true);
  if (error) { logger.error("same-customer alerts: branches read failed", { error: error.message }); return { branches: 0, alerted: 0 }; }
  let alerted = 0;
  for (const b of branches ?? []) {
    try { alerted += await scanBranch(String((b as any).org_id), String((b as any).id)); }
    catch (err: any) { logger.warn("same-customer alerts: branch failed", { branchId: (b as any).id, error: err?.message ?? String(err) }); }
  }
  return { branches: (branches ?? []).length, alerted };
}
