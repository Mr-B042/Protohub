import type { Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabase.js";
import { sanitizeMarketingAttributionTags } from "../lib/marketing-attribution.js";

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

  // Fetch the user's profile from our users table
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, org_id, role, email, name, active, marketing_attribution_tags")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
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
    role: profile.role,
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
      req.user.effectiveUserRole = spyProfile.role as import("../types/index.js").UserRole;
    }
  }

  next();
}

// Role guard — use after requireAuth
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
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
    req.user.effectiveUserRole = profile.role as import("../types/index.js").UserRole;
  }
  next();
}
