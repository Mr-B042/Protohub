// Cart call alerts (Bright, 24 Nov 2026): "most of them don't call their
// abandoned cart early ... heavy alert ... morning and afternoon chase ...
// the head of sales rep to also alert on each sales rep who hasn't called".
//
//  1. sendRepCallNow        the moment a cart is handed to a rep (rotation or by
//                           hand): a loud alert that stays on screen.
//  2. runCartCallEscalations every 2 minutes in working hours: a cart not called
//                           (no Call/WhatsApp tap and no log by its rep since it
//                           was assigned) at the branch's call time (10 working
//                           min) reminds the rep; at twice that, the rep AND the
//                           Head of Sales; after an hour, both again.
//  3. runCartChase          9am and 2pm on working days: each rep's carts not
//                           logged today, and a summary to the Head of Sales.
//
// Rules (working minutes, stages, wording) are in cart-call-alerts-model.ts.
// Every alert is claimed in cart_call_alerts first, so none is sent twice.

import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { sendPushToUsers } from "./push.js";
import { getOrgPushBranding } from "./push-branding.js";
import { assignmentRulesForBranch } from "./cart-assignment.js";
import { CART_LOG_MISS_AMOUNT, CART_LOG_PENALTY_START_DATE } from "./cart-log-penalty.js";
import { selectByIdBatches } from "./query-limits.js";
import { pausedOn, type RescheduleLog } from "./cart-log-integrity.js";
import {
  chaseMessage, hosChaseMessage, isWorkingNow, lagosParts, stagesDue, workingMinutesBetween, type ChaseCart, type RepChase, type Stage
} from "./cart-call-alerts-model.js";

const REP_LINK = "/dashboard/sales-rep/abandoned-carts";
const HOS_LINK = "/dashboard/admin/head-of-sales-rep";
const CLOSED_STATUSES = ["Converted", "Not interested", "No response"];
/** Escalations look back this far; older never-called carts are the chase's job. */
const ESCALATE_LOOKBACK_MS = 24 * 3_600_000;
/** Heavy: stays on screen until opened, long strong buzz. */
const HEAVY_VIBRATE = [500, 200, 500, 200, 900];

type Heavy = { title: string; message: string; link: string; kind: string; tag: string };

/** Bell + loud push to one person. Never throws. */
async function sendHeavy(orgId: string, branchId: string | null, userId: string, alert: Heavy) {
  try {
    const { error } = await supabase.from("system_notifications").insert({
      org_id: orgId, ...(branchId ? { branch_id: branchId } : {}), recipient_id: userId,
      type: "needs_attention", title: alert.title, message: alert.message, link: alert.link, read: false
    });
    if (error) logger.warn("cart call alert: bell insert failed", { error: error.message });
    const branding = await getOrgPushBranding(orgId);
    await sendPushToUsers(orgId, [userId], {
      title: alert.title, body: alert.message, url: alert.link, kind: alert.kind, tag: alert.tag,
      requireInteraction: true, vibrate: HEAVY_VIBRATE, brandName: branding.brandName, brandLogo: branding.brandLogo
    });
  } catch (err) {
    logger.warn("cart call alert: send failed", { userId, error: (err as Error).message });
  }
}

/** Claim alerts so each goes out once; returns the keys this run won. */
async function claim(rows: Array<{ org_id: string; branch_id: string | null; cart_id: string; rep_id: string; stage: string }>) {
  if (rows.length === 0) return new Set<string>();
  const { data, error } = await supabase.from("cart_call_alerts")
    .upsert(rows, { onConflict: "org_id,cart_id,rep_id,stage", ignoreDuplicates: true })
    .select("cart_id, rep_id, stage");
  if (error) { logger.warn("cart call alert: claim failed", { error: error.message }); return new Set<string>(); }
  return new Set((data ?? []).map((r: any) => `${r.cart_id}|${r.rep_id}|${r.stage}`));
}

const MANAGER_LINK = "/dashboard/admin/follow-up-queue";

/**
 * Who hears about reps not calling: the branch's Head of Sales
 * (users.is_head_of_sales_rep) AND its Managers - or its Admins while the
 * branch has no Manager (Bright, 24 Nov 2026:
 * "manager" - the Head of Sales was also a rep being chased).
 */
async function supervisors(orgId: string, branchId: string) {
  const [{ data: heads }, { data: managers }, { data: admins }, { data: members }] = await Promise.all([
    supabase.from("users").select("id, name").eq("org_id", orgId).eq("active", true).eq("is_head_of_sales_rep", true),
    supabase.from("users").select("id, name").eq("org_id", orgId).eq("active", true).eq("is_demo", false).eq("role", "Manager"),
    supabase.from("users").select("id, name").eq("org_id", orgId).eq("active", true).eq("is_demo", false).eq("role", "Admin"),
    supabase.from("branch_memberships").select("user_id").eq("branch_id", branchId)
  ]);
  const inBranch = new Set((members ?? []).map((m: any) => String(m.user_id)));
  const out = new Map<string, { id: string; link: string }>();
  for (const h of heads ?? []) if (inBranch.has(String(h.id))) out.set(String(h.id), { id: String(h.id), link: HOS_LINK });
  const branchManagers = (managers ?? []).filter((m: any) => inBranch.has(String(m.id)));
  // No Manager in the branch yet: its Admins get them instead (Bright chose
  // Onyin, 24 Nov 2026). Adding a Manager switches it over by itself.
  const backups = branchManagers.length > 0 ? branchManagers : (admins ?? []).filter((a: any) => inBranch.has(String(a.id)));
  for (const m of backups) if (!out.has(String(m.id))) out.set(String(m.id), { id: String(m.id), link: MANAGER_LINK });
  return [...out.values()];
}

const who = (cart: any) => String(cart.customer ?? "").trim() || "a customer";
// The product, not the package ("Starter" alone says nothing).
const what = (cart: any) => String(cart.product_name || cart.package_name || "").trim();
const money = (cart: any) => {
  const n = Number(cart.amount ?? 0);
  return n > 0 ? `₦${Math.round(n).toLocaleString("en-NG")}` : "";
};

/** 1. The moment a cart lands on a rep. */
export async function sendRepCallNow(orgId: string, repId: string, cart: {
  id: string; customer?: string | null; phone?: string | null; product_name?: string | null; package_name?: string | null; amount?: number | null; branch_id?: string | null;
}) {
  let branchId = cart.branch_id ?? null;
  let callMinutes = 10;
  try {
    if (!branchId) {
      const { data } = await supabase.from("abandoned_carts").select("branch_id").eq("id", cart.id).maybeSingle();
      branchId = (data as any)?.branch_id ?? null;
    }
    if (branchId) callMinutes = (await assignmentRulesForBranch(branchId)).contactSlaMinutes;
  } catch { /* keep the default */ }
  const bits = [what(cart), money(cart), cart.phone?.trim() || ""].filter(Boolean).join(" · ");
  await sendHeavy(orgId, branchId, repId, {
    title: `📞 Call now: ${who(cart)}`,
    message: `New cart for you${bits ? `: ${bits}` : ""}. Call within ${callMinutes} minutes. Tap Call on the cart so it counts.`,
    link: REP_LINK, kind: "cart_call_now", tag: `cart-call-now-${cart.id}`
  });
}

/** 2. Carts not called in time: remind the rep, then tell the Head of Sales. */
export async function runCartCallEscalations(now = new Date()) {
  const nowMs = now.getTime();
  const { data: branches, error } = await supabase.from("branches").select("id, org_id").eq("active", true);
  if (error) throw error;
  let sent = 0;
  for (const branch of branches ?? []) {
    try {
      const rules = await assignmentRulesForBranch(branch.id);
      if (!isWorkingNow(nowMs, rules)) continue;
      const { data: carts, error: cartError } = await supabase.from("abandoned_carts")
        .select("id, org_id, branch_id, customer, phone, product_name, package_name, amount, assigned_rep_id, assigned_at, status")
        .eq("org_id", branch.org_id).eq("branch_id", branch.id)
        .not("assigned_rep_id", "is", null).not("status", "in", `(${CLOSED_STATUSES.map((s) => `"${s}"`).join(",")})`)
        .gte("assigned_at", new Date(nowMs - ESCALATE_LOOKBACK_MS).toISOString()).limit(2000);
      if (cartError) throw cartError;
      const open = carts ?? [];
      if (open.length === 0) continue;
      const ids = open.map((c: any) => String(c.id));
      const since = new Date(Math.min(...open.map((c: any) => Date.parse(c.assigned_at)))).toISOString();
      const [attempts, taps] = await Promise.all([
        selectByIdBatches<any>(ids, (batch) => supabase.from("cart_contact_attempts").select("cart_id, rep_id, created_at").in("cart_id", batch).gte("created_at", since)),
        selectByIdBatches<any>(ids, (batch) => supabase.from("cart_contact_taps").select("cart_id, rep_id, tapped_at").in("cart_id", batch).gte("tapped_at", since))
      ]);
      const touched = new Set<string>();
      const assignedAt = new Map(open.map((c: any) => [String(c.id), Date.parse(c.assigned_at)]));
      const repOf = new Map(open.map((c: any) => [String(c.id), String(c.assigned_rep_id)]));
      for (const a of attempts) if (String(a.rep_id) === repOf.get(String(a.cart_id)) && Date.parse(a.created_at) >= (assignedAt.get(String(a.cart_id)) ?? 0)) touched.add(String(a.cart_id));
      for (const t of taps) if (String(t.rep_id) === repOf.get(String(t.cart_id)) && Date.parse(t.tapped_at) >= (assignedAt.get(String(t.cart_id)) ?? 0)) touched.add(String(t.cart_id));

      const wanted: Array<{ cart: any; stage: Stage; waited: number }> = [];
      for (const cart of open) {
        if (touched.has(String(cart.id))) continue;
        const waited = workingMinutesBetween(Date.parse(cart.assigned_at), nowMs, rules);
        for (const stage of stagesDue(waited, rules.contactSlaMinutes)) wanted.push({ cart, stage, waited });
      }
      if (wanted.length === 0) continue;
      const won = await claim(wanted.map((w) => ({ org_id: branch.org_id, branch_id: branch.id, cart_id: String(w.cart.id), rep_id: String(w.cart.assigned_rep_id), stage: w.stage })));
      // Only the highest new stage per cart is said out loud (a cart that
      // earned all three at once - e.g. right after this went live - gets one alert).
      const order: Stage[] = ["remind", "escalate", "hour"];
      const top = new Map<string, { cart: any; stage: Stage; waited: number }>();
      for (const w of wanted) {
        if (!won.has(`${w.cart.id}|${w.cart.assigned_rep_id}|${w.stage}`)) continue;
        const cur = top.get(String(w.cart.id));
        if (!cur || order.indexOf(w.stage) > order.indexOf(cur.stage)) top.set(String(w.cart.id), w);
      }
      if (top.size === 0) continue;

      const { data: reps } = await supabase.from("users").select("id, name").in("id", [...new Set([...top.values()].map((w) => String(w.cart.assigned_rep_id)))]);
      const repName = new Map((reps ?? []).map((r: any) => [String(r.id), String(r.name ?? "A rep")]));
      const mins = (n: number) => (n >= 60 ? `${Math.floor(n / 60)} hr${n % 60 ? ` ${n % 60} min` : ""}` : `${n} min`);

      // Rep: one alert per rep per run, listing their carts.
      const byRep = new Map<string, Array<{ cart: any; stage: Stage; waited: number }>>();
      for (const w of top.values()) byRep.set(String(w.cart.assigned_rep_id), [...(byRep.get(String(w.cart.assigned_rep_id)) ?? []), w]);
      for (const [repId, list] of byRep) {
        const worst = list.some((w) => w.stage !== "remind");
        const lines = list.map((w) => `${who(w.cart)}${what(w.cart) ? ` (${what(w.cart)})` : ""} ${mins(w.waited)}`);
        await sendHeavy(branch.org_id, branch.id, repId, {
          title: list.length === 1
            ? `${worst ? "🚨" : "⏰"} Still not called: ${who(list[0].cart)} (${mins(list[0].waited)})`
            : `${worst ? "🚨" : "⏰"} ${list.length} carts still not called`,
          message: `${list.length === 1 ? "" : `${lines.join(" · ")}. `}Call now and tap Call on the cart.${worst ? " Your Head of Sales has been told." : ""}`,
          link: REP_LINK, kind: "cart_call_late", tag: `cart-call-late-${repId}`
        });
        sent += 1;
      }
      // Head of Sales: one alert per run naming each rep and their late carts.
      const late = [...top.values()].filter((w) => w.stage !== "remind");
      if (late.length > 0) {
        const perRep = new Map<string, string[]>();
        for (const w of late) perRep.set(String(w.cart.assigned_rep_id), [...(perRep.get(String(w.cart.assigned_rep_id)) ?? []), `${who(w.cart)} ${mins(w.waited)}`]);
        for (const boss of await supervisors(branch.org_id, branch.id)) {
          await sendHeavy(branch.org_id, branch.id, boss.id, {
            title: `🚨 ${late.length} cart${late.length === 1 ? "" : "s"} not called in time`,
            message: `${[...perRep].map(([id, carts]) => `${repName.get(id) ?? "A rep"}: ${carts.join(", ")}`).join(" · ")}. Push them to call now.`,
            link: boss.link, kind: "hos_cart_not_called", tag: `hos-cart-not-called-${branch.id}`
          });
          sent += 1;
        }
      }
    } catch (err) {
      logger.warn("cart call escalations: branch failed", { branchId: branch.id, error: (err as Error).message });
    }
  }
  return { sent };
}

/** 3. 9am / 2pm: each rep's carts not logged today, and the Head of Sales summary. */
export async function runCartChase(slot: "morning" | "afternoon", now = new Date()) {
  const nowMs = now.getTime();
  const { day: today, dow } = lagosParts(nowMs);
  const todayStart = new Date(Date.parse(`${today}T00:00:00+01:00`)).toISOString();
  const { data: branches, error } = await supabase.from("branches").select("id, org_id").eq("active", true);
  if (error) throw error;
  let sent = 0;
  for (const branch of branches ?? []) {
    try {
      const rules = await assignmentRulesForBranch(branch.id);
      if (dow === 0 && !rules.worksSunday) continue;
      const [{ data: members }, { data: reps }] = await Promise.all([
        supabase.from("branch_memberships").select("user_id").eq("branch_id", branch.id),
        supabase.from("users").select("id, name").eq("org_id", branch.org_id).eq("active", true).eq("is_demo", false).eq("role", "Sales Rep")
      ]);
      const inBranch = new Set((members ?? []).map((m: any) => String(m.user_id)));
      const branchReps = (reps ?? []).filter((r: any) => inBranch.has(String(r.id)));
      if (branchReps.length === 0) continue;
      const { data: carts, error: cartError } = await supabase.from("abandoned_carts")
        .select("id, customer, product_name, package_name, assigned_rep_id, status")
        .eq("org_id", branch.org_id).eq("branch_id", branch.id)
        .in("assigned_rep_id", branchReps.map((r: any) => r.id))
        .not("status", "in", `(${CLOSED_STATUSES.map((s) => `"${s}"`).join(",")})`).limit(5000);
      if (cartError) throw cartError;
      const open = carts ?? [];
      if (open.length === 0) continue;
      const attempts = await selectByIdBatches<any>(open.map((c: any) => String(c.id)), (batch) =>
        supabase.from("cart_contact_attempts").select("cart_id, created_at, outcome_code, next_action_at").in("cart_id", batch));
      // A dated reschedule pauses the cart until the callback day (cart-log-integrity.ts).
      const reschedules: RescheduleLog[] = attempts.filter((a: any) => a.outcome_code === "Rescheduled" && a.next_action_at).map((a: any) => ({
        cartId: String(a.cart_id), savedDay: lagosParts(Date.parse(a.created_at)).day, outcome: "Rescheduled", callbackDay: String(a.next_action_at).slice(0, 10)
      }));
      const ever = new Set(attempts.map((a: any) => String(a.cart_id)));
      const todaySet = new Set(attempts.filter((a: any) => String(a.created_at) >= todayStart).map((a: any) => String(a.cart_id)));
      const fine = today >= CART_LOG_PENALTY_START_DATE ? CART_LOG_MISS_AMOUNT : 0;
      const stage = `chase:${slot}:${today}`;

      const summary: RepChase[] = [];
      const wanted: Array<{ repId: string; msg: NonNullable<ReturnType<typeof chaseMessage>> }> = [];
      for (const rep of branchReps) {
        const mine: ChaseCart[] = open.filter((c: any) => String(c.assigned_rep_id) === String(rep.id))
          .filter((c: any) => !pausedOn(reschedules, String(c.id), today))
          .map((c: any) => ({
            id: String(c.id), customer: String(c.customer ?? "").trim(), product: what(c), neverCalled: !ever.has(String(c.id)), loggedToday: todaySet.has(String(c.id)),
            callbackToday: reschedules.some((r) => r.cartId === String(c.id) && r.callbackDay === today)
          }));
        if (mine.length === 0) continue;
        const msg = chaseMessage(slot, mine, fine);
        summary.push({ repName: String(rep.name ?? "A rep"), due: msg?.due ?? 0, never: msg?.never ?? 0, total: mine.length });
        if (msg) wanted.push({ repId: String(rep.id), msg });
      }
      const bosses = await supervisors(branch.org_id, branch.id);
      const hosMsg = hosChaseMessage(slot, summary);
      const won = await claim([
        ...wanted.map((w) => ({ org_id: branch.org_id, branch_id: branch.id, cart_id: "rep", rep_id: w.repId, stage })),
        ...(hosMsg ? bosses.map((b) => ({ org_id: branch.org_id, branch_id: branch.id, cart_id: "hos", rep_id: b.id, stage })) : [])
      ]);
      for (const w of wanted) {
        if (!won.has(`rep|${w.repId}|${stage}`)) continue;
        await sendHeavy(branch.org_id, branch.id, w.repId, { title: w.msg.title, message: w.msg.message, link: REP_LINK, kind: "cart_chase", tag: `cart-chase-${slot}-${w.repId}` });
        sent += 1;
      }
      for (const boss of bosses) {
        if (!hosMsg || !won.has(`hos|${boss.id}|${stage}`)) continue;
        await sendHeavy(branch.org_id, branch.id, boss.id, { title: hosMsg.title, message: hosMsg.message, link: boss.link, kind: "hos_cart_chase", tag: `hos-cart-chase-${slot}-${branch.id}` });
        sent += 1;
      }
    } catch (err) {
      logger.warn("cart chase: branch failed", { branchId: branch.id, error: (err as Error).message });
    }
  }
  return { sent };
}
