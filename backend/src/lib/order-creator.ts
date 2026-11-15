import { supabase } from "./supabase.js";

/**
 * Who created an order (Bright, 15 Nov 2026: "was it from the customer, the
 * email, or a sales rep converted it?"). The order's first history entry has
 * the staff member who created it; orders the customer placed (order form,
 * cart auto-submit) have none.
 */
export async function orderCreators(orderIds: string[]): Promise<Map<string, { staff: boolean; name: string | null }>> {
  const out = new Map<string, { staff: boolean; name: string | null }>();
  const ids = [...new Set(orderIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 200) {
    // launch-safe: reads only who created orders already matched to an email; shows no order.
    const { data } = await supabase.from("order_audit").select("order_id, changed_by, created_at").in("order_id", ids.slice(i, i + 200)).order("created_at", { ascending: true });
    const first = new Map<string, string | null>();
    for (const row of (data ?? []) as any[]) if (!first.has(String(row.order_id))) first.set(String(row.order_id), row.changed_by ? String(row.changed_by) : null);
    const staffIds = [...new Set([...first.values()].filter((v): v is string => Boolean(v)))];
    const names = new Map<string, string>();
    if (staffIds.length) {
      const { data: users } = await supabase.from("users").select("id, name").in("id", staffIds);
      for (const u of (users ?? []) as any[]) names.set(String(u.id), String(u.name ?? ""));
    }
    for (const [orderId, by] of first) out.set(orderId, { staff: Boolean(by), name: by ? names.get(by) ?? null : null });
  }
  return out;
}
