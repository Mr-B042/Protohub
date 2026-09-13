import { supabase } from "./supabase.js";

/**
 * Which branches a person may open, and where they land at sign-in.
 *
 * ⚠️ `branch_memberships` MUST NEVER GO IN `BRANCH_TABLES`. It is keyed on
 * branch_id, so the branch filter would match it and hide every row belonging
 * to another branch - which is exactly the rows this feature exists to read.
 * Working in Nigeria, you could no longer see that Chelsea also covers Accra,
 * and saving her branches would wipe the ones you could not see. The table is
 * the map between branches; it cannot live inside one.
 *
 * ⚠️ A PERSON IS NEVER DUPLICATED. `users` stays one row per human. That is
 * what lets somebody work in two branches with one sign-in instead of keeping
 * two accounts and two passwords.
 */

export type BranchMembershipRow = {
  branchId: string;
  name: string;
  countryName: string;
  currency: string;
  isDefault: boolean;
};

/** Every branch this person works in, the sign-in one first. */
export async function listUserBranches(userId: string, orgId: string): Promise<BranchMembershipRow[]> {
  const { data, error } = await supabase
    .from("branch_memberships")
    .select("branch_id, is_default, branches!inner(id, name, country_name, currency, org_id, active)")
    .eq("user_id", userId)
    .eq("branches.org_id", orgId)
    .order("is_default", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    branchId: row.branch_id,
    name: row.branches?.name ?? "",
    countryName: row.branches?.country_name ?? "",
    currency: row.branches?.currency ?? "",
    isDefault: row.is_default === true
  }));
}

export class BranchMembershipError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Replace the whole set of branches a person works in.
 *
 * Sent as the complete list rather than one add at a time, because that is how
 * the screen works: tick the branches, save once. Anything left unticked is
 * removed in the same write, so the saved state always matches what was on
 * screen - no half-applied edit if a second call never happens.
 */
export async function setUserBranches(
  userId: string,
  orgId: string,
  branchIds: string[],
  defaultBranchId?: string | null
): Promise<BranchMembershipRow[]> {
  const wanted = [...new Set(branchIds)];

  // ⚠️ NOBODY MAY BE LEFT WITH NOWHERE TO SIGN IN. requireAuth resolves a
  // branch from these rows; with none, the person is locked out by an error
  // that says nothing about why. Deactivating the account is the deliberate
  // way to stop someone working - this is not.
  if (wanted.length === 0) {
    throw new BranchMembershipError(400, "Everybody needs at least one branch. To stop someone working, switch their account off instead.");
  }

  // An id from another company would otherwise grant access across companies.
  const { data: allowed, error: branchError } = await supabase
    .from("branches")
    .select("id, name, active")
    .eq("org_id", orgId)
    .in("id", wanted);
  if (branchError) throw new Error(branchError.message);

  const allowedIds = new Set((allowed ?? []).map((row: any) => row.id));
  const unknown = wanted.filter((id) => !allowedIds.has(id));
  if (unknown.length > 0) throw new BranchMembershipError(404, "One of those branches does not exist here.");

  const closed = (allowed ?? []).filter((row: any) => row.active === false);
  if (closed.length > 0) {
    throw new BranchMembershipError(409, `${closed.map((row: any) => row.name).join(" and ")} is closed, so nobody can be added to it.`);
  }

  // Exactly one default - it decides where they land at sign-in. An unticked
  // default (or none sent) falls back to the first branch on the list, so the
  // person always has somewhere to land.
  const landing = defaultBranchId && allowedIds.has(defaultBranchId) ? defaultBranchId : wanted[0];

  const { error: removeError } = await supabase
    .from("branch_memberships")
    .delete()
    .eq("user_id", userId)
    .not("branch_id", "in", `(${wanted.join(",")})`);
  if (removeError) throw new Error(removeError.message);

  const { error: writeError } = await supabase
    .from("branch_memberships")
    .upsert(
      wanted.map((branchId) => ({ branch_id: branchId, user_id: userId, is_default: branchId === landing })),
      { onConflict: "branch_id,user_id" }
    );
  if (writeError) throw new Error(writeError.message);

  return listUserBranches(userId, orgId);
}

/**
 * The branch somebody gets when they have not asked for one.
 *
 * ⚠️ ONE ANSWER, TWO CALLERS. `requireAuth` uses this when no X-Branch-Id
 * header arrives, and GET /api/branches uses it to tell the browser which
 * branch to open. They MUST agree. When they did not, a phone with nothing
 * saved opened the first branch alphabetically - Ghana sorts before Nigeria -
 * so the Owner landed in Accra and saw an empty app, while the server would
 * have given them Nigeria.
 */
export async function resolveDefaultBranchId(
  userId: string,
  orgId: string,
  role: string
): Promise<string | null> {
  // What the person actually chose, which is now settable per user. This runs
  // for the Owner too: before, their "opens first" was read for everyone
  // except them.
  const { data: chosen } = await supabase
    .from("branch_memberships")
    .select("branch_id, branches!inner(id, org_id, active)")
    .eq("user_id", userId)
    .eq("is_default", true)
    .eq("branches.org_id", orgId)
    .eq("branches.active", true)
    .limit(1)
    .maybeSingle();
  if (chosen?.branch_id) return chosen.branch_id as string;

  // Everyone else stops here: no membership is not a branch to guess at, it is
  // an account that has not been set up, and 403 says so.
  if (role !== "Owner") return null;

  // The Owner can open any branch, so they always get one. The home branch
  // first, then whatever exists - never an arbitrary alphabetical pick.
  const { data: home } = await supabase
    .from("branches").select("id")
    .eq("org_id", orgId).eq("name", "Nigeria Operations").eq("active", true).maybeSingle();
  if (home?.id) return home.id as string;

  const { data: fallback } = await supabase
    .from("branches").select("id")
    .eq("org_id", orgId).eq("active", true)
    .order("country_name").order("name").limit(1).maybeSingle();
  return (fallback?.id as string) ?? null;
}
