import { Router } from "express";
import { z } from "zod";
import { supabase, supabaseAuth, supabaseAnon } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── POST /api/auth/register ───────────────────────────────
// Creates the first user (Owner) and their organization.
const RegisterSchema = z.object({
  orgName:  z.string().min(2).max(160),
  name:     z.string().min(2).max(120),
  email:    z.string().email().max(254),
  password: z.string().min(8).max(200)
});

router.post("/register", async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { orgName, name, email, password } = parsed.data;

  // 1. Create the Supabase auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (authError || !authData.user) {
    res.status(400).json({ error: authError?.message ?? "Failed to create user." });
    return;
  }

  // 2. Create the organization
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name: orgName })
    .select("id")
    .single();
  if (orgError || !org) {
    // Rollback: delete the auth user we just created so a retry can reuse the email.
    await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
    if ((orgError as { code?: string } | null)?.code === "23505") {
      res.status(409).json({ error: "An organization with this name already exists." });
      return;
    }
    res.status(500).json({ error: "Failed to create organization." });
    return;
  }

  // 3. Create the user profile
  const { error: profileError } = await supabase
    .from("users")
    .insert({ id: authData.user.id, org_id: org.id, name, email, role: "Owner", active: true });
  if (profileError) {
    res.status(500).json({ error: "Failed to create user profile." });
    return;
  }

  // 4. Set the org owner
  await supabase
    .from("organizations")
    .update({ owner_id: authData.user.id })
    .eq("id", org.id);

  res.status(201).json({ message: "Account created. Please sign in." });
});

// ── POST /api/auth/login ──────────────────────────────────
const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1)
});

router.post("/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email or password format." });
    return;
  }
  const { email, password } = parsed.data;

  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    logger.warn("login failed", { email, reason: error?.message ?? "no session" });
    // Record failed attempt (fire-and-forget, never blocks login flow)
    supabase.from("login_audit").insert({ email, success: false, ip: req.ip ?? null })
      .then(({ error: auditErr }) => { if (auditErr) logger.warn("login_audit insert failed", { error: auditErr.message }); });
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  // Fetch profile to return role etc.
  const { data: profile } = await supabase
    .from("users")
    .select("id, org_id, name, role, active")
    .eq("id", data.user.id)
    .single();

  if (!profile) {
    res.status(500).json({ error: "User profile not found. Please contact support." });
    return;
  }
  if (!profile.active) {
    res.status(403).json({ error: "Your account has been deactivated. Contact your administrator." });
    return;
  }

  supabase.from("login_audit").insert({ email, success: true, ip: req.ip ?? null })
    .then(({ error: auditErr }) => { if (auditErr) logger.warn("login_audit insert failed", { error: auditErr.message }); });
  logger.info("login success", { userId: profile.id, email, role: profile.role });

  res.json({
    accessToken:  data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: {
      id:    profile.id,
      orgId: profile.org_id,
      name:  profile.name,
      role:  profile.role,
      email: data.user.email
    }
  });
});

// ── POST /api/auth/refresh ────────────────────────────────
router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).json({ error: "refreshToken is required." });
    return;
  }
  const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    res.status(401).json({ error: "Invalid or expired refresh token." });
    return;
  }
  res.json({
    accessToken:  data.session.access_token,
    refreshToken: data.session.refresh_token
  });
});

// ── GET /api/auth/me ──────────────────────────────────────
// Includes the org's cache_version so the frontend can auto-purge stale
// localStorage when an Owner/Admin has bumped the version.
router.get("/me", requireAuth, async (req, res) => {
  const { data: org } = await supabase
    .from("organizations")
    .select("cache_version, name, logo_url, top_performer_bonus_enabled, top_performer_bonus_amount, timezone, admin_cart_notifications")
    .eq("id", req.user!.orgId)
    .single();
  res.json({
    user: req.user,
    cacheVersion: org?.cache_version ?? 0,
    branding: { name: org?.name ?? "", logoUrl: org?.logo_url ?? "" },
    payroll: {
      topPerformerBonusEnabled: !!org?.top_performer_bonus_enabled,
      topPerformerBonusAmount:  Number(org?.top_performer_bonus_amount ?? 0)
    },
    timezone: org?.timezone ?? "Africa/Lagos",
    adminCartNotifications: !!org?.admin_cart_notifications
  });
});

// ── PATCH /api/auth/org-branding ──────────────────────────
// Owner/Admin only. Persists company name + logo so all team members
// see the same branding regardless of device. Logo can be a data URL
// (base64) or external URL — both stored as TEXT.
router.patch("/org-branding", requireAuth, async (req, res) => {
  if (!["Owner", "Admin"].includes(req.user!.role)) {
    res.status(403).json({ error: "Only Owner or Admin can edit org settings." });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (typeof req.body.name === "string") updates.name = req.body.name.trim();
  if (typeof req.body.logoUrl === "string") updates.logo_url = req.body.logoUrl;
  if (typeof req.body.topPerformerBonusEnabled === "boolean") updates.top_performer_bonus_enabled = req.body.topPerformerBonusEnabled;
  if (typeof req.body.topPerformerBonusAmount === "number") updates.top_performer_bonus_amount = req.body.topPerformerBonusAmount;
  if (typeof req.body.timezone === "string" && req.body.timezone.trim()) updates.timezone = req.body.timezone.trim();
  if (typeof req.body.adminCartNotifications === "boolean") updates.admin_cart_notifications = req.body.adminCartNotifications;
  if (!Object.keys(updates).length) { res.status(400).json({ error: "No fields to update." }); return; }
  const { data, error } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", req.user!.orgId)
    .select("name, logo_url, top_performer_bonus_enabled, top_performer_bonus_amount, timezone, admin_cart_notifications")
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({
    name: data?.name ?? "",
    logoUrl: data?.logo_url ?? "",
    topPerformerBonusEnabled: !!data?.top_performer_bonus_enabled,
    topPerformerBonusAmount:  Number(data?.top_performer_bonus_amount ?? 0),
    timezone: data?.timezone ?? "Africa/Lagos",
    adminCartNotifications: !!data?.admin_cart_notifications
  });
});

// ── POST /api/auth/bump-cache-version ─────────────────────
// Owner/Admin only. Increments the org's cache_version so every team
// member's browser purges localStorage on next load. Use after a tenant
// reset, mass data import, or major migration.
router.post("/bump-cache-version", requireAuth, async (req, res) => {
  if (!["Owner", "Admin"].includes(req.user!.role)) {
    res.status(403).json({ error: "Only Owner or Admin can bump the cache version." });
    return;
  }
  const { data: current } = await supabase
    .from("organizations")
    .select("cache_version")
    .eq("id", req.user!.orgId)
    .single();
  const next = (current?.cache_version ?? 0) + 1;
  const { error } = await supabase
    .from("organizations")
    .update({ cache_version: next })
    .eq("id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ cacheVersion: next });
});

// ── GET /api/auth/team ────────────────────────────────────
router.get("/team", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, role, active, created_at, round_robin_position")
    .eq("org_id", req.user!.orgId)
    .order("created_at");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── PATCH /api/auth/team/:id ──────────────────────────────
router.patch("/team/:id", requireAuth, async (req, res) => {
  if (!["Owner", "Admin"].includes(req.user!.role)) {
    res.status(403).json({ error: "Only Owner or Admin can edit users." });
    return;
  }
  // Frontend sends camelCase (e.g. extraPages); DB columns are snake_case.
  // Allow-list the DB column names and accept either casing on input.
  const allowed: Record<string, string> = {
    name: "name",
    role: "role",
    active: "active",
    email: "email",
    permissions: "permissions",
    extraPages: "extra_pages",
    extra_pages: "extra_pages",
    roundRobinPosition: "round_robin_position",
    round_robin_position: "round_robin_position"
  };
  const updates: Record<string, unknown> = {};
  for (const [inKey, dbKey] of Object.entries(allowed)) {
    if (req.body[inKey] !== undefined) updates[dbKey] = req.body[inKey];
  }
  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── PUT /api/auth/team/round-robin ───────────────────────
// Accepts { order: string[] } — an ordered array of user IDs.
// Writes position 0, 1, 2, … to each user's round_robin_position column.
router.put("/team/round-robin", requireAuth, async (req, res) => {
  if (!["Owner", "Admin"].includes(req.user!.role)) {
    res.status(403).json({ error: "Only Owner or Admin can reorder the round-robin." });
    return;
  }
  const order: unknown = req.body.order;
  if (!Array.isArray(order) || order.some((id) => typeof id !== "string")) {
    res.status(400).json({ error: "order must be an array of user ID strings." });
    return;
  }
  // Write positions in parallel
  const updates = (order as string[]).map((id, idx) =>
    supabase.from("users").update({ round_robin_position: idx }).eq("id", id).eq("org_id", req.user!.orgId)
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) { res.status(500).json({ error: failed.error.message }); return; }
  res.json({ ok: true });
});

// ── DELETE /api/auth/team/:id ─────────────────────────────
router.delete("/team/:id", requireAuth, async (req, res) => {
  if (!["Owner", "Admin"].includes(req.user!.role)) {
    res.status(403).json({ error: "Only Owner or Admin can delete users." });
    return;
  }
  // Prevent deleting yourself or the org owner
  if (req.params.id === req.user!.id) {
    res.status(400).json({ error: "You cannot delete your own account." });
    return;
  }
  const { data: target } = await supabase
    .from("users")
    .select("role")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .single();
  if (!target) { res.status(404).json({ error: "User not found." }); return; }
  if (target.role === "Owner") { res.status(400).json({ error: "The Owner account cannot be deleted." }); return; }

  // Soft-delete: deactivate in DB
  const { error } = await supabase
    .from("users")
    .update({ active: false })
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

// ── POST /api/auth/invite ─────────────────────────────────
// Owner/Admin invites a new team member
router.post("/invite", requireAuth, async (req, res) => {
  if (!["Owner", "Admin"].includes(req.user!.role)) {
    res.status(403).json({ error: "Only Owner or Admin can invite users." });
    return;
  }

  const Schema = z.object({
    name:     z.string().min(2).max(120),
    email:    z.string().email().max(254),
    password: z.string().min(8).max(200),
    role:     z.enum(["Admin", "Sales Rep", "Inventory Manager"])
  });

  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { name, email, password, role } = parsed.data;

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (authError || !authData.user) {
    res.status(400).json({ error: authError?.message ?? "Failed to create user." });
    return;
  }

  const { error: profileError } = await supabase
    .from("users")
    .insert({ id: authData.user.id, org_id: req.user!.orgId, name, email, role });
  if (profileError) {
    res.status(500).json({ error: "User created in auth but profile failed. Contact support." });
    return;
  }

  res.status(201).json({ message: `${name} added as ${role}.` });
});

// ── POST /api/auth/reset-password ────────────────────────
// Sends a Supabase password-reset email via the anon-key auth API.
// The admin generateLink endpoint returns the link but does NOT email it;
// resetPasswordForEmail goes through Supabase's built-in mailer using the
// auth project's email templates and SMTP settings.
router.post("/reset-password", async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "email is required." });
    return;
  }
  // Always return 200 so we don't leak whether an email is registered.
  if (!supabaseAnon) {
    logger.error("reset-password: SUPABASE_ANON_KEY not configured — no recovery email sent");
    res.json({ message: "If that email is registered, a password-reset link has been sent." });
    return;
  }
  const redirectTo = `${process.env.FRONTEND_URL ?? "http://localhost:5173"}/#/reset-password`;
  const { error } = await supabaseAnon.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo }
  );
  if (error) {
    logger.warn("reset-password: resetPasswordForEmail failed", { error: error.message });
  }
  res.json({ message: "If that email is registered, a password-reset link has been sent." });
});

// ── POST /api/auth/set-password ──────────────────────────
// If userId is provided and caller is Owner/Admin, reset that user's password.
// Otherwise reset the caller's own password.
router.post("/set-password", requireAuth, async (req, res) => {
  const { password, userId } = req.body;
  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }
  let targetId = req.user!.id;
  if (userId && userId !== req.user!.id) {
    if (!["Owner", "Admin"].includes(req.user!.role)) {
      res.status(403).json({ error: "Only Owner or Admin can reset other users' passwords." });
      return;
    }
    // Verify target belongs to same org
    const { data: target } = await supabase.from("users").select("id").eq("id", userId).eq("org_id", req.user!.orgId).single();
    if (!target) { res.status(404).json({ error: "User not found." }); return; }
    targetId = userId;
  }
  const { error } = await supabase.auth.admin.updateUserById(targetId, { password });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ message: "Password updated successfully." });
});

export default router;
