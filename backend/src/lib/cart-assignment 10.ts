/**
 * Automatic round-robin assignment for abandoned carts.
 *
 * Bright's rule: an abandoned cart is a fresh sales opportunity, not a recovery
 * lead. It must not be carried to the next day before the first contact. Once a
 * customer has been quiet for ten minutes and their phone is on file, a rep gets
 * it and calls the same day. The next-day call is attempt two, not attempt one.
 *
 * ⚠️ THIS ONLY TOUCHES CARTS THAT CANNOT BECOME ORDERS BY THEMSELVES.
 *
 * A cart with everything filled in - name, phone, address, city, state, product
 * and package - is already turned into a real order by runCartAutoSubmit about
 * two minutes after the customer stops, and that order is round-robined to a rep
 * on the spot. Waiting ten minutes to hand somebody a cart would be slower than
 * what already happens, and it would race the converter for the same record.
 *
 * The carts nobody is working are the half-finished ones: a phone number typed,
 * then they stopped at the address or before choosing a size. Nothing can be
 * delivered from that, so the converter leaves them alone and they sit with no
 * owner. On the day this was written there were 23 open carts - 10 complete and
 * already handled, and 13 half-finished with NOT ONE assigned to anybody.
 *
 * Those 13 are what this picks up.
 */

import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { notifyCartAssignedToRep } from "./cart-notifications.js";
import { isWorkingDay, lagosDateKey } from "./follow-up-kpi.js";

/**
 * What the rules are when a branch has no row of its own - which should not
 * happen, since a trigger seeds one per branch, but a job that silently stops
 * because a row is missing is worse than one that carries on with the numbers
 * everybody already agreed to.
 */
export const DEFAULT_ASSIGNMENT_RULES = {
  enabled: true,
  assignmentDelayMinutes: 10,
  contactSlaMinutes: 10,
  workStartMinute: 8 * 60 + 30,
  workEndMinute: 17 * 60 + 30,
  worksSunday: false
};

export type AssignmentRules = typeof DEFAULT_ASSIGNMENT_RULES;

/** Kept for callers that only need the default, e.g. the screen's fallback. */
export const ASSIGNMENT_DELAY_MS = DEFAULT_ASSIGNMENT_RULES.assignmentDelayMinutes * 60 * 1000;
export const CONTACT_SLA_MS = DEFAULT_ASSIGNMENT_RULES.contactSlaMinutes * 60 * 1000;

const rulesFromRow = (row: any): AssignmentRules => ({
  enabled: row?.enabled !== false,
  assignmentDelayMinutes: Number(row?.assignment_delay_minutes) || DEFAULT_ASSIGNMENT_RULES.assignmentDelayMinutes,
  contactSlaMinutes: Number(row?.contact_sla_minutes) || DEFAULT_ASSIGNMENT_RULES.contactSlaMinutes,
  workStartMinute: Number.isFinite(Number(row?.work_start_minute)) ? Number(row.work_start_minute) : DEFAULT_ASSIGNMENT_RULES.workStartMinute,
  workEndMinute: Number.isFinite(Number(row?.work_end_minute)) ? Number(row.work_end_minute) : DEFAULT_ASSIGNMENT_RULES.workEndMinute,
  worksSunday: row?.works_sunday === true
});

/** The rules for one branch. */
export async function assignmentRulesForBranch(branchId: string): Promise<AssignmentRules> {
  const { data } = await supabase
    .from("cart_assignment_settings")
    .select("enabled, assignment_delay_minutes, contact_sla_minutes, work_start_minute, work_end_minute, works_sunday")
    .eq("branch_id", branchId)
    .maybeSingle();
  return rulesFromRow(data);
}

/**
 * Stop reaching back forever. A cart from last week is a recovery lead and
 * belongs in the recovery queue, not on today's hot board.
 *
 * ⚠️ WIDE ENOUGH TO SURVIVE A CLOSED SUNDAY. With assignment limited to
 * working hours, a cart abandoned on Saturday evening cannot be handed out
 * until Monday morning - about 38 hours later. A 24-hour cutoff would have
 * quietly thrown those away before anybody could ring them, which is the
 * opposite of the rule.
 */
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

const OPEN_STATUSES = ["Open abandoned", "In progress"];

/**
 * Carts are only handed out while somebody is there to ring them.
 *
 * ⚠️ THIS RAN AROUND THE CLOCK AND IT SHOWED. The first live run handed five
 * carts out at 01:00 UTC - 2am in Lagos. By the time the rep started work the
 * call deadline had been blown for six hours, so she would have opened the
 * board to nothing but red through no fault of her own. A warning that is
 * always on gets ignored within a week, and then it is worth nothing on the
 * day it matters.
 *
 * So a cart abandoned overnight waits and goes out at 08:30, first in the
 * queue. Nothing is lost - it is still the same day's first contact, which is
 * the whole rule.
 *
 * ⚠️ NO SUNDAYS. Bright asked for this explicitly and the rest of the app
 * already works that way: the follow-up KPI charges nobody on a Sunday and
 * scheduling refuses one. A Saturday-night cart waits for Monday morning.
 * isWorkingDay is reused rather than redefined here so there is one answer to
 * "is anybody working" and it cannot drift.
 *
 * Hours match the follow-up KPI's working window, for the same reason.
 */
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1 year-round, no DST

export const isAssignmentWindowOpen = (
  rules: AssignmentRules = DEFAULT_ASSIGNMENT_RULES,
  now: Date = new Date()
): boolean => {
  if (!rules.enabled) return false;
  if (!rules.worksSunday && !isWorkingDay(lagosDateKey(now))) return false;
  const lagos = new Date(now.getTime() + LAGOS_OFFSET_MS);
  const minute = lagos.getUTCHours() * 60 + lagos.getUTCMinutes();
  return minute >= rules.workStartMinute && minute < rules.workEndMinute;
};

/**
 * ⚠️ "No phone yet" IS NOT A PHONE NUMBER. The order form stores that literal
 * placeholder while a customer is still typing, and assigning a rep to it hands
 * them a cart they cannot ring.
 */
export const hasReachablePhone = (phone?: string | null): boolean => {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 7;
};

/** Whether the converter could turn this cart into an order on its own. */
export const cartCanBecomeOrder = (cart: {
  customer?: string | null; phone?: string | null; address?: string | null;
  city?: string | null; state?: string | null;
  product_id?: string | null; package_id?: string | null;
}): boolean =>
  Boolean(cart.customer) && cart.customer !== "Partial lead"
  && Boolean(cart.phone) && Boolean(cart.address) && Boolean(cart.city)
  && Boolean(cart.state) && Boolean(cart.product_id) && Boolean(cart.package_id);

export type EligibleRep = {
  id: string;
  name: string;
  roundRobinPosition: number;
  openCarts: number;
  /** When this rep last received a cart. null = never, so they go first. */
  lastAssignedAt: string | null;
};

/**
 * Who may be handed a cart.
 *
 * ⚠️ SAME RULES THE ORDER ROTATION USES, DELIBERATELY. Active Sales Reps only,
 * never a demo account, and never somebody paused from the rotation - being
 * paused has to mean paused for carts too, or "excluded" quietly means "excluded
 * from orders but still gets carts at 3am".
 */
export async function eligibleReps(orgId: string, branchId?: string | null): Promise<EligibleRep[]> {
  const { data: reps, error } = await supabase
    .from("users")
    .select("id, name, round_robin_position")
    .eq("org_id", orgId)
    .eq("role", "Sales Rep")
    .eq("active", true)
    .eq("is_demo", false)
    .eq("round_robin_excluded", false)
    .order("round_robin_position", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = reps ?? [];
  if (rows.length === 0) return [];

  // Two things about each rep: how many open carts they are carrying (shown on
  // the panel so a manager can see the load) and when they last took their
  // turn, which is what actually decides who is next.
  let loadQuery = supabase
    .from("abandoned_carts")
    .select("assigned_rep_id, status, assigned_at")
    .not("assigned_rep_id", "is", null)
    .order("assigned_at", { ascending: false })
    .limit(2000);
  if (branchId) loadQuery = loadQuery.eq("branch_id", branchId);
  const { data: loadRows } = await loadQuery;

  const openCount = new Map<string, number>();
  const lastAssigned = new Map<string, string>();
  for (const row of loadRows ?? []) {
    const repId = (row as any).assigned_rep_id as string;
    if (OPEN_STATUSES.includes((row as any).status)) {
      openCount.set(repId, (openCount.get(repId) ?? 0) + 1);
    }
    const at = (row as any).assigned_at as string | null;
    if (at && !lastAssigned.has(repId)) lastAssigned.set(repId, at);
  }

  return rows.map((rep: any) => ({
    id: rep.id,
    name: rep.name ?? "",
    roundRobinPosition: rep.round_robin_position ?? 0,
    openCarts: openCount.get(rep.id) ?? 0,
    lastAssignedAt: lastAssigned.get(rep.id) ?? null
  }));
}

/**
 * The rep next in line: strict rotation, one after another.
 *
 * ⚠️ TURN ORDER, NOT WORKLOAD. This first picked whoever was carrying the
 * fewest carts and Bright rejected it - "give it orderly, not by fewer carts".
 * He is right: load-balancing quietly punishes the rep who works fast. Clear
 * your carts and the machine hands you every new one while a colleague sitting
 * on four untouched carts is passed over. That is the opposite of the intent,
 * which is simply that everyone takes their turn.
 *
 * So the order is: whoever went longest without a turn goes next. A rep who has
 * never had one is ahead of everybody. Ties - the normal case on day one, when
 * nobody has had a cart - fall back to the Active Sequence position and then the
 * name, the same order that screen lists people in, so the "Next" badge on the
 * panel always names the rep who will actually get it.
 */
export const nextRepInLine = (reps: EligibleRep[]): EligibleRep | null => {
  if (reps.length === 0) return null;
  return [...reps].sort((a, b) => {
    if (a.lastAssignedAt === null && b.lastAssignedAt !== null) return -1;
    if (b.lastAssignedAt === null && a.lastAssignedAt !== null) return 1;
    if (a.lastAssignedAt && b.lastAssignedAt && a.lastAssignedAt !== b.lastAssignedAt) {
      return a.lastAssignedAt < b.lastAssignedAt ? -1 : 1;
    }
    return a.roundRobinPosition - b.roundRobinPosition || a.name.localeCompare(b.name);
  })[0];
};

export type AssignmentRun = { considered: number; assigned: number; noRepAvailable: number };

/**
 * Hand out every cart that has been waiting long enough. Safe to run often;
 * a cart already carrying a rep is never touched again.
 */
export async function runCartAutoAssign(): Promise<AssignmentRun> {
  const now = Date.now();
  // ⚠️ THE WIDEST POSSIBLE WINDOW IS READ FIRST, THEN EACH BRANCH DECIDES.
  // Branches keep their own wait, so a single query cannot use one cutoff -
  // it reads anything that could be ready for the most impatient branch, and
  // every cart is then checked against its own branch's rules below.
  const readyBefore = new Date(now - 60 * 1000).toISOString();
  const notOlderThan = new Date(now - MAX_AGE_MS).toISOString();

  const { data: carts, error } = await supabase
    .from("abandoned_carts")
    .select("id, org_id, branch_id, customer, phone, address, city, state, product_id, package_id, product_name, package_name, amount, currency, last_activity, created_at")
    .in("status", OPEN_STATUSES)
    .is("assigned_rep_id", null)
    .is("merged_into", null)
    .lte("last_activity", readyBefore)
    .gte("last_activity", notOlderThan)
    .order("last_activity", { ascending: true })
    .limit(200);
  if (error) {
    logger.error("cart auto-assign: could not read carts", { error: error.message });
    return { considered: 0, assigned: 0, noRepAvailable: 0 };
  }

  const rulesCache = new Map<string, AssignmentRules>();
  const rulesFor = async (branchId: string | null) => {
    const key = branchId ?? "";
    if (!rulesCache.has(key)) {
      rulesCache.set(key, branchId ? await assignmentRulesForBranch(branchId) : DEFAULT_ASSIGNMENT_RULES);
    }
    return rulesCache.get(key)!;
  };

  const waiting: any[] = [];
  for (const cart of (carts ?? []) as any[]) {
    if (!hasReachablePhone(cart.phone) || cartCanBecomeOrder(cart)) continue;
    const rules = await rulesFor(cart.branch_id ?? null);
    if (!isAssignmentWindowOpen(rules, new Date(now))) continue;
    const quietSince = Date.parse(cart.last_activity ?? cart.created_at ?? "");
    if (!Number.isFinite(quietSince)) continue;
    if (now - quietSince < rules.assignmentDelayMinutes * 60 * 1000) continue;
    waiting.push(cart);
  }

  const run: AssignmentRun = { considered: waiting.length, assigned: 0, noRepAvailable: 0 };
  if (waiting.length === 0) return run;

  // Reps are read once per organisation and per branch, then the running count
  // is kept in memory - otherwise a batch of ten carts would all see the same
  // "fewest carts" rep and pile onto that one person.
  const repCache = new Map<string, EligibleRep[]>();

  for (const cart of waiting as any[]) {
    const cacheKey = `${cart.org_id}:${cart.branch_id ?? ""}`;
    if (!repCache.has(cacheKey)) {
      try {
        repCache.set(cacheKey, await eligibleReps(cart.org_id, cart.branch_id));
      } catch (err) {
        logger.error("cart auto-assign: could not read reps", { error: (err as Error).message });
        repCache.set(cacheKey, []);
      }
    }
    const reps = repCache.get(cacheKey)!;
    const rep = nextRepInLine(reps);
    if (!rep) { run.noRepAvailable += 1; continue; }

    // ⚠️ THE `is null` GUARD IS THE WHOLE RACE PROTECTION. Two runs overlapping,
    // or a manager assigning by hand at the same moment, must not both win - the
    // update simply does nothing if somebody already owns it.
    const { data: claimed, error: claimError } = await supabase
      .from("abandoned_carts")
      .update({ assigned_rep_id: rep.id, assigned_at: new Date().toISOString() })
      .eq("id", cart.id)
      .is("assigned_rep_id", null)
      .select("id")
      .maybeSingle();
    if (claimError) {
      logger.error("cart auto-assign: claim failed", { cartId: cart.id, error: claimError.message });
      continue;
    }
    if (!claimed) continue; // somebody else took it first

    // Take their turn: move them to the back so the next cart in this same run
    // goes to the following rep rather than piling onto one person.
    rep.lastAssignedAt = new Date().toISOString();
    rep.openCarts += 1;
    run.assigned += 1;

    await notifyCartAssignedToRep(cart.org_id, {
      id: cart.id,
      customer: cart.customer ?? "",
      phone: cart.phone ?? "",
      product_name: cart.product_name ?? "",
      package_name: cart.package_name ?? null,
      amount: Number(cart.amount ?? 0),
      currency: cart.currency ?? "NGN",
      assignedRepId: rep.id,
      assignedRepName: rep.name
    }).catch((err) => logger.warn("cart auto-assign: notify failed", { error: (err as Error).message }));
  }

  if (run.assigned > 0 || run.noRepAvailable > 0) {
    logger.info("cart auto-assign", run);
  }
  return run;
}
