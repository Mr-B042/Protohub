import { Router } from "express";
import { z } from "zod";
import { supabase, supabaseAuth } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── POST /api/auth/register ───────────────────────────────
// Creates the first user (Owner) and their organization.
const RegisterSchema = z.object({
  orgName:  z.string().min(2),
  name:     z.string().min(2),
  email:    z.string().email(),
  password: z.string().min(8)
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
    void supabase.from("login_audit").insert({ email, success: false, ip: null });
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

  void supabase.from("login_audit").insert({ email, success: true, ip: null });
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
router.get("/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

// ── GET /api/auth/team ────────────────────────────────────
router.get("/team", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, role, active, created_at")
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
  const allowed = ["name", "role", "active", "email", "permissions"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
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
    name:     z.string().min(2),
    email:    z.string().email(),
    password: z.string().min(8),
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
// Sends a Supabase magic link / password-reset email.
router.post("/reset-password", async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "email is required." });
    return;
  }
  // Always return 200 so we don't leak whether an email is registered.
  await supabase.auth.admin.generateLink({
    type: "recovery",
    email: email.trim().toLowerCase()
  });
  res.json({ message: "If that email is registered, a password-reset link has been sent." });
});

// ── POST /api/auth/set-password ──────────────────────────
// If userId is provided and caller is Owner/Admin, reset that user's password.
// Otherwise reset the caller's own password.
router.post("/set-password", requireAuth, async (req, res) => {
  const { password, userId } = req.body;
  if (!password || typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters." });
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
