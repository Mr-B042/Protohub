import type { Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabase.js";
import { sanitizeMarketingAttributionTags } from "../lib/marketing-attribution.js";
import { TtlCache } from "../lib/ttl-cache.js";
import { publicUserRole } from "../lib/user-role.js";

type UserProfile = {
  id: string; org_id: string; role: import("../types/index.js").UserRole;
  email: string; name: string;
  active: boolean | null; marketing_attribution_tags: unknown;
};

// The profile was re-read from Supabase on EVERY authenticated request -
// 33,485 reads a day of a row that changes when somebody is hired or their
// role is edited. Held for 30 seconds instead.
//
// Correctness rests on invalidateUserProfile() being called on every write to
// a user, which is what makes a deactivation or role change take effect at
// once rather than after the TTL. The token itself is still verified against
// Supabase Auth on every request - only the profile lookup is cached, so a
// revoked session is rejected immediately regardless of this.
const USER_PROFILE_TTL_MS = 30_000;
const userProfileCache = new TtlCache<UserProfile | null>(USER_PROFILE_TTL_MS);

/** Call after ANY write to a users row - role change, deactivation, deletion. */
export function invalidateUserProfile(userId: string): void {
  userProfileCache.invalidate(userId);
}
export function invalidateAllUserProfiles(): void {
  userProfileCache.clear();
}

// Validates the Bearer token from the Authorization header.
// Attaches the user profile to req.user for downstream handlers.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header." });
    return;
  }

  const token = header.slice(7);

  // Verify the token against Supabase Auth
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: "Invalid or expired token." });
    return;
  }

  // Fetch the user's profile from our users table (cached - see above)
  const profile = await userProfileCache.get(user.id, async () => {
    const { data } = await supabase
      .from("users")
      .select("id, org_id, role, email, name, active, marketing_attribution_tags")
      .eq("id", user.id)
      .single();
    return (data as UserProfile | null) ?? null;
  });

  if (!profile) {
    // Not cached as a hit-with-null for long: a profile created moments after a
    // first failed call must not stay missing for the rest of the TTL.
    userProfileCache.invalidate(user.id);
    res.status(403).json({ error: "User profile not found. Contact your administrator." });
    return;
  }

  if (profile.active === false) {
    res.status(403).json({ error: "Your account has been deactivated. Contact your administrator." });
    return;
  }

  req.user = {
    id: profile.id,
    orgId: profile.org_id,
    role: publicUserRole(profile.role),
    email: profile.email,
    name: profile.name,
    marketingAttributionTags: sanitizeMarketingAttributionTags(profile.marketing_attribution_tags)
  };

  // Apply spy header inline — must happen after req.user is set.
  // The global applySpyHeader middleware runs before requireAuth so req.user
  // is null when it fires. Doing it here guarantees correct ordering.
  const spyId = req.headers["x-spy-user-id"];
  if (spyId && typeof spyId === "string" &&
      (profile.role === "Owner" || profile.role === "Admin")) {
    const { data: spyProfile } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", spyId)
      .eq("org_id", profile.org_id)
      .maybeSingle();
    if (spyProfile) {
      req.user.effectiveUserId = spyProfile.id as string;
      req.user.effectiveUserRole = publicUserRole(spyProfile.role);
    }
  }

  next();
}

/**
 * The identity a route should scope its DATA to.
 *
 * Under view-as this is the spied user; otherwise the caller. Always use this
 * for "which rows does this person get" — req.user.role/id is the real session
 * and does not follow view-as, so scoping on it makes an Owner viewing as a rep
 * silently see the whole org under headings that say "yours".
 *
 * Deliberately NOT for permission checks: requireRole still guards on the real
 * role, so viewing-as narrows what is shown without granting anything.
 */
export function scopeOf(req: Request): { role: string; id: string } {
  return {
    role: req.user!.effectiveUserRole ?? req.user!.role,
    id: req.user!.effectiveUserId ?? req.user!.id
  };
}

// Role guard — use after requireAuth
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const acceptsLegacyInventoryGuard = roles.includes("Inventory Manager")
      && req.user?.role === "Inventory Manager & Logistics Operations";
    if (!req.user || (!roles.includes(req.user.role) && !acceptsLegacyInventoryGuard)) {
      res.status(403).json({ error: `Requires one of: ${roles.join(", ")}.` });
      return;
    }
    next();
  };
}

// Spy middleware — mount on the app router after requireAuth.
// When an Owner/Admin sends X-Spy-User-Id, loads that user's profile and sets
// req.user.effectiveUserId so routes scope their DB queries to the spied user.
export async function applySpyHeader(req: Request, _res: Response, next: NextFunction) {
  const spyId = req.headers["x-spy-user-id"];
  if (!spyId || typeof spyId !== "string" || !req.user) {
    return next();
  }
  if (req.user.role !== "Owner" && req.user.role !== "Admin") {
    return next();
  }
  const { data: profile } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", spyId)
    .eq("org_id", req.user.orgId)
    .maybeSingle();
  if (profile) {
    req.user.effectiveUserId = profile.id as string;
    req.user.effectiveUserRole = publicUserRole(profile.role);
  }
  next();
}
