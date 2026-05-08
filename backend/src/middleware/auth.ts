import type { Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabase.js";

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
    .select("id, org_id, role, email, name, active")
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
    name: profile.name
  };

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
