

import { Router } from "express";
import { z } from "zod";
import { supabase, supabaseAuth, supabaseAnon } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { normalizeWorkingDays } from "../lib/business-schedule.js";
import { loadAssignedAgentIdsByUser } from "../lib/user-agent-assignments.js";
import { sanitizeMarketingAttributionTags } from "../lib/marketing-attribution.js";

const router = Router();

const sanitizeStoredPageList = (pages: unknown) =>
  Array.from(
    new Set(
      (Array.isArray(pages) ? pages : [])
        .filter((page): page is string => typeof page === "string" && page.trim().length > 0)
    )
  );

const sanitizeStoredPermissionList = (permissions: unknown) =>
  Array.from(
    new Set(
      (Array.isArray(permissions) ? permissions : [])
        .filter((permission): permission is string => typeof permission === "string" && permission.trim().length > 0)
    )
  );

const sanitizeAdTrackingLabelMap = (value: unknown) => {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const next: Record<string, string> = {};
  Object.entries(source).forEach(([rawKey, rawValue]) => {
    const key = typeof rawKey === "string" ? rawKey.trim().slice(0, 160) : "";
    const label = typeof rawValue === "string" ? rawValue.trim().slice(0, 80) : "";
    if (!key || !label) return;
    next[key] = label;
  });
  return next;
};

const loadOrgAdTrackingLabels = async (orgId: string) => {
  const { data, error } = await supabase
    .from("organizations")
    .select("ad_tracking_campaign_labels, ad_tracking_creative_labels")
    .eq("id", orgId)
    .single();
  if (error) throw error;
  return {
    campaigns: sanitizeAdTrackingLabelMap(data?.ad_tracking_campaign_labels),
    creatives: sanitizeAdTrackingLabelMap(data?.ad_tracking_creative_labels)
  };
};

const isMissingAdTrackingLabelsColumn = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error?.code === "42703" || /ad_tracking_campaign_labels|ad_tracking_creative_labels/i.test(error?.message ?? ""));

const DEFAULT_SMART_STOCK_RULES = {
  demandLookbackDays: 7,
  dormantDays: 21,
  criticalDaysCover: 2,
  watchDaysCover: 5,
  lowStockThreshold: 5
};

const clampSmartStockNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

const sanitizeSmartStockRules = (value: unknown) => {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const demandLookbackDays = clampSmartStockNumber(
    row.demandLookbackDays ?? row.smart_stock_lookback_days,
    DEFAULT_SMART_STOCK_RULES.demandLookbackDays,
    1,
    60
  );
  const dormantDays = Math.max(
    demandLookbackDays,
    clampSmartStockNumber(
      row.dormantDays ?? row.smart_stock_dormant_days,
      DEFAULT_SMART_STOCK_RULES.dormantDays,
      1,
      120
    )
  );
  const criticalDaysCover = clampSmartStockNumber(
    row.criticalDaysCover ?? row.smart_stock_critical_days_cover,
    DEFAULT_SMART_STOCK_RULES.criticalDaysCover,
    1,
    30
  );
  const watchDaysCover = Math.max(
    criticalDaysCover,
    clampSmartStockNumber(
      row.watchDaysCover ?? row.smart_stock_watch_days_cover,
      DEFAULT_SMART_STOCK_RULES.watchDaysCover,
      1,
      60
    )
  );
  const lowStockThreshold = clampSmartStockNumber(
    row.lowStockThreshold ?? row.smart_stock_low_threshold,
    DEFAULT_SMART_STOCK_RULES.lowStockThreshold,
    0,
    1000
  );
  return { demandLookbackDays, dormantDays, criticalDaysCover, watchDaysCover, lowStockThreshold };
};

const sanitizeTeamMemberPayload = <T extends Record<string, unknown>>(row: T) => ({
  ...row,
  permissions: sanitizeStoredPermissionList(row.permissions),
  extra_pages: sanitizeStoredPageList(row.extra_pages),
  marketing_attribution_tags: sanitizeMarketingAttributionTags(row.marketing_attribution_tags)
});

const touchUserPresence = async (userId: string) => {
  if (!userId) return;
  await supabase
    .from("users")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", userId);
};

// ── POST /api/auth/register ───────────────────────────────
// Creates the first user (Owner) and their organization.
//
// Public self-registration is DISABLED — this is a private, single-tenant
// deployment, not a SaaS. New team members are created by the Owner/Admin in
// User Management. Flip this to true only if you ever need to bootstrap a
// brand-new organization, then turn it back off.
const PUBLIC_REGISTRATION_ENABLED = false;
const RegisterSchema = z.object({
  orgName: z.string().min(2).max(160),
  name: z.string().min(2).max(120),
  email: z.string().email().max(254),
  password: z.string().min(8).max(200)
});

router.post("/register", async (req, res) => {
  if (!PUBLIC_REGISTRATION_ENABLED) {
    res.status(403).json({ error: "Self-registration is disabled. Ask your workspace owner to create your account." });
    return;
  }
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
    const message = authError?.message ?? "Failed to create user.";
    const lower = message.toLowerCase();
    if (lower.includes("already") && (lower.includes("registered") || lower.includes("exists"))) {
      res.status(409).json({
        error: "This email is already registered in authentication. If it was used before, reset or reuse that account instead of creating a new one."
      });
      return;
    }
    res.status(400).json({ error: message });
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
    await supabase.auth.admin.deleteUser(authData.user.id).catch(() => { });
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
    // Rollback: remove the auth user and the org so a retry starts clean.
    await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
    await supabase.from("organizations").delete().eq("id", org.id);
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
  email: z.string().email(),
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
    .select("id, org_id, name, role, active, marketing_attribution_tags")
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
  touchUserPresence(profile.id).catch(() => {});
  logger.info("login success", { userId: profile.id, email, role: profile.role });

  res.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: {
      id: profile.id,
      orgId: profile.org_id,
      name: profile.name,
      role: profile.role,
      email: data.user.email,
      marketingAttributionTags: sanitizeMarketingAttributionTags(profile.marketing_attribution_tags)
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
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token
  });
});

// ── GET /api/auth/me ──────────────────────────────────────
// Includes the org's cache_version so the frontend can auto-purge stale
// localStorage when an Owner/Admin has bumped the version.
router.get("/me", requireAuth, async (req, res) => {
  touchUserPresence(req.user!.id).catch(() => {});
  const orgSelectLegacy = "cache_version, name, logo_url, android_app_url, top_performer_bonus_enabled, top_performer_bonus_amount, timezone, admin_cart_notifications, working_schedule_enabled, working_days, working_day_start, working_day_end";
  const orgSelectBase = `${orgSelectLegacy}, smart_stock_lookback_days, smart_stock_dormant_days, smart_stock_critical_days_cover, smart_stock_watch_days_cover, smart_stock_low_threshold`;
  const orgSelectWithAdTracking = `${orgSelectBase}, ad_tracking_campaign_labels, ad_tracking_creative_labels`;
  let org: Record<string, unknown> | null = null;
  let orgError: { code?: string; message?: string } | null = null;
  let adTrackingLabelsShared = true;
  const initialOrgQuery = await supabase
    .from("organizations")
    .select(orgSelectWithAdTracking)
    .eq("id", req.user!.orgId)
    .single();
  org = initialOrgQuery.data as Record<string, unknown> | null;
  orgError = initialOrgQuery.error;
  if (isMissingAdTrackingLabelsColumn(orgError)) {
    adTrackingLabelsShared = false;
  }
  if (orgError && (isMissingAdTrackingLabelsColumn(orgError) || /smart_stock_/i.test(orgError.message ?? ""))) {
    const fallback = await supabase
      .from("organizations")
      .select(orgSelectBase)
      .eq("id", req.user!.orgId)
      .single();
    org = fallback.data as Record<string, unknown> | null;
    orgError = fallback.error;
    if (orgError && (orgError.code === "42703" || /smart_stock_/i.test(orgError.message ?? ""))) {
      const legacyFallback = await supabase
        .from("organizations")
        .select(orgSelectLegacy)
        .eq("id", req.user!.orgId)
        .single();
      org = legacyFallback.data as Record<string, unknown> | null;
      orgError = legacyFallback.error;
    }
  }
  if (orgError) {
    res.status(500).json({ error: orgError.message });
    return;
  }
  const response: Record<string, unknown> = {
    user: req.user,
    cacheVersion: org?.cache_version ?? 0,
    branding: { name: org?.name ?? "", logoUrl: org?.logo_url ?? "", androidAppUrl: org?.android_app_url ?? "" },
    payroll: {
      topPerformerBonusEnabled: !!org?.top_performer_bonus_enabled,
      topPerformerBonusAmount: Number(org?.top_performer_bonus_amount ?? 0)
    },
    timezone: org?.timezone ?? "Africa/Lagos",
    adminCartNotifications: !!org?.admin_cart_notifications,
    workingScheduleEnabled: !!org?.working_schedule_enabled,
    workingDays: normalizeWorkingDays(org?.working_days),
    workingDayStart: typeof org?.working_day_start === "string" && org.working_day_start.trim() ? org.working_day_start.trim() : "08:00",
    workingDayEnd: typeof org?.working_day_end === "string" && org.working_day_end.trim() ? org.working_day_end.trim() : "18:00",
    adTrackingLabelsShared,
    adTrackingLabels: {
      campaigns: sanitizeAdTrackingLabelMap((org as Record<string, unknown> | null)?.ad_tracking_campaign_labels),
      creatives: sanitizeAdTrackingLabelMap((org as Record<string, unknown> | null)?.ad_tracking_creative_labels)
    }
  };
  if (org && Object.prototype.hasOwnProperty.call(org, "smart_stock_lookback_days")) {
    response.smartStockRules = sanitizeSmartStockRules(org);
  }
  res.json(response);
});

// ── POST /api/auth/presence ───────────────────────────────
// Lightweight heartbeat so Owner can see Active / Offline / Last seen.
router.post("/presence", requireAuth, async (req, res) => {
  try {
    await touchUserPresence(req.user!.id);
    res.json({ ok: true, lastSeenAt: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to update presence." });
  }
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
  if (typeof req.body.androidAppUrl === "string") updates.android_app_url = req.body.androidAppUrl.trim() || null;
  if (typeof req.body.topPerformerBonusEnabled === "boolean") updates.top_performer_bonus_enabled = req.body.topPerformerBonusEnabled;
  if (typeof req.body.topPerformerBonusAmount === "number") updates.top_performer_bonus_amount = req.body.topPerformerBonusAmount;
  if (typeof req.body.timezone === "string" && req.body.timezone.trim()) updates.timezone = req.body.timezone.trim();
  if (typeof req.body.adminCartNotifications === "boolean") updates.admin_cart_notifications = req.body.adminCartNotifications;
  let requestedSmartStockRules: ReturnType<typeof sanitizeSmartStockRules> | null = null;
  if (req.body.smartStockRules && typeof req.body.smartStockRules === "object" && !Array.isArray(req.body.smartStockRules)) {
    const smartStockRules = sanitizeSmartStockRules(req.body.smartStockRules);
    requestedSmartStockRules = smartStockRules;
    updates.smart_stock_lookback_days = smartStockRules.demandLookbackDays;
    updates.smart_stock_dormant_days = smartStockRules.dormantDays;
    updates.smart_stock_critical_days_cover = smartStockRules.criticalDaysCover;
    updates.smart_stock_watch_days_cover = smartStockRules.watchDaysCover;
    updates.smart_stock_low_threshold = smartStockRules.lowStockThreshold;
  }
  if (typeof req.body.workingScheduleEnabled === "boolean") updates.working_schedule_enabled = req.body.workingScheduleEnabled;
  if (Array.isArray(req.body.workingDays)) updates.working_days = normalizeWorkingDays(req.body.workingDays);
  if (typeof req.body.workingDayStart === "string" && req.body.workingDayStart.trim()) updates.working_day_start = req.body.workingDayStart.trim();
  if (typeof req.body.workingDayEnd === "string" && req.body.workingDayEnd.trim()) updates.working_day_end = req.body.workingDayEnd.trim();
  if (!Object.keys(updates).length) { res.status(400).json({ error: "No fields to update." }); return; }
  const orgSettingsSelect = "name, logo_url, android_app_url, top_performer_bonus_enabled, top_performer_bonus_amount, timezone, admin_cart_notifications, working_schedule_enabled, working_days, working_day_start, working_day_end";
  let { data, error } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", req.user!.orgId)
    .select(orgSettingsSelect)
    .single();
  if (error && requestedSmartStockRules && (error.code === "42703" || /smart_stock_/i.test(error.message ?? ""))) {
    const fallbackUpdates = Object.fromEntries(
      Object.entries(updates).filter(([key]) => !key.startsWith("smart_stock_"))
    );
    const retry = Object.keys(fallbackUpdates).length > 0
      ? await supabase
        .from("organizations")
        .update(fallbackUpdates)
        .eq("id", req.user!.orgId)
        .select(orgSettingsSelect)
        .single()
      : await supabase
        .from("organizations")
        .select(orgSettingsSelect)
        .eq("id", req.user!.orgId)
        .single();
    data = retry.data;
    error = retry.error;
  }
  if (error) { res.status(500).json({ error: error.message }); return; }
  const response: Record<string, unknown> = {
    name: data?.name ?? "",
    logoUrl: data?.logo_url ?? "",
    androidAppUrl: data?.android_app_url ?? "",
    topPerformerBonusEnabled: !!data?.top_performer_bonus_enabled,
    topPerformerBonusAmount: Number(data?.top_performer_bonus_amount ?? 0),
    timezone: data?.timezone ?? "Africa/Lagos",
    adminCartNotifications: !!data?.admin_cart_notifications,
    workingScheduleEnabled: !!data?.working_schedule_enabled,
    workingDays: normalizeWorkingDays(data?.working_days),
    workingDayStart: typeof data?.working_day_start === "string" && data.working_day_start.trim() ? data.working_day_start.trim() : "08:00",
    workingDayEnd: typeof data?.working_day_end === "string" && data.working_day_end.trim() ? data.working_day_end.trim() : "18:00"
  };
  if (requestedSmartStockRules) {
    response.smartStockRules = requestedSmartStockRules;
  }
  res.json(response);
});

const AdTrackingLabelsSchema = z.object({
  campaigns: z.record(z.string()).optional(),
  creatives: z.record(z.string()).optional()
});

router.get("/ad-tracking-labels", requireAuth, async (req, res) => {
  try {
    const labels = await loadOrgAdTrackingLabels(req.user!.orgId);
    res.json({ shared: true, ...labels });
  } catch (error: any) {
    if (isMissingAdTrackingLabelsColumn(error)) {
      res.status(503).json({ error: "Shared ad tracking labels are not ready yet. Apply migration 076 first." });
      return;
    }
    res.status(500).json({ error: error?.message ?? "Failed to load ad tracking labels." });
  }
});

router.patch("/ad-tracking-labels", requireAuth, async (req, res) => {
  if (!["Owner", "Admin", "Manager"].includes(req.user!.role)) {
    res.status(403).json({ error: "You do not have permission to edit ad tracking labels." });
    return;
  }
  const parsed = AdTrackingLabelsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ad tracking labels payload." });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (parsed.data.campaigns) updates.ad_tracking_campaign_labels = sanitizeAdTrackingLabelMap(parsed.data.campaigns);
  if (parsed.data.creatives) updates.ad_tracking_creative_labels = sanitizeAdTrackingLabelMap(parsed.data.creatives);
  if (!Object.keys(updates).length) {
    res.status(400).json({ error: "No ad tracking labels to update." });
    return;
  }
  const { data, error } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", req.user!.orgId)
    .select("ad_tracking_campaign_labels, ad_tracking_creative_labels")
    .single();
  if (error) {
    if (isMissingAdTrackingLabelsColumn(error)) {
      res.status(503).json({ error: "Shared ad tracking labels are not ready yet. Apply migration 076 first." });
      return;
    }
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({
    shared: true,
    campaigns: sanitizeAdTrackingLabelMap(data?.ad_tracking_campaign_labels),
    creatives: sanitizeAdTrackingLabelMap(data?.ad_tracking_creative_labels)
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
  let query = supabase
    .from("users")
    .select("id, name, email, phone, role, active, created_at, round_robin_position, round_robin_excluded, last_seen_at, permissions, extra_pages, agent_balance_scope_mode, agent_balance_state_scope, agent_balance_agent_ids, marketing_attribution_tags")
    .eq("org_id", req.user!.orgId)
    .order("created_at");

  if (req.user!.role === "Marketer") {
    query = query.eq("id", req.user!.id);
  }

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  try {
    const assignedAgentIdsByUser = await loadAssignedAgentIdsByUser(req.user!.orgId, (data ?? []).map((row) => row.id));
    res.json((data ?? []).map((row) => ({
      ...sanitizeTeamMemberPayload(row),
      assigned_agent_ids: assignedAgentIdsByUser.get(row.id) ?? []
    })));
  } catch (assignmentError: any) {
    res.status(500).json({ error: assignmentError?.message ?? "Failed to load assigned agents." });
  }
});

// ── PATCH /api/auth/team/:id ──────────────────────────────
router.patch("/team/:id", requireAuth, async (req, res) => {
  if (!["Owner", "Admin"].includes(req.user!.role)) {
    res.status(403).json({ error: "Only Owner or Admin can edit users." });
    return;
  }
  // Frontend sends camelCase (e.g. extraPages); DB columns are snake_case.
  // Allow-list the DB column names and accept either casing on input.
  const VALID_ROLES = ["Owner", "Admin", "Manager", "Sales Rep", "Inventory Manager", "Marketer", "Viewer"] as const;
  const VALID_AGENT_BALANCE_SCOPE_MODES = ["all", "states", "agents", "assigned_agents"] as const;
  if (req.body.role !== undefined && !VALID_ROLES.includes(req.body.role)) {
    res.status(400).json({ error: { role: [`Invalid role. Must be one of: ${VALID_ROLES.join(", ")}.`] } });
    return;
  }
  const incomingScopeMode = req.body.agentBalanceScopeMode ?? req.body.agent_balance_scope_mode;
  if (incomingScopeMode !== undefined && !VALID_AGENT_BALANCE_SCOPE_MODES.includes(incomingScopeMode)) {
    res.status(400).json({ error: { agentBalanceScopeMode: [`Invalid scope mode. Must be one of: ${VALID_AGENT_BALANCE_SCOPE_MODES.join(", ")}.`] } });
    return;
  }
  const incomingStateScope = req.body.agentBalanceStateScope ?? req.body.agent_balance_state_scope;
  if (incomingStateScope !== undefined && (!Array.isArray(incomingStateScope) || incomingStateScope.some((value: unknown) => typeof value !== "string"))) {
    res.status(400).json({ error: { agentBalanceStateScope: ["State scope must be an array of state names."] } });
    return;
  }
  const incomingAgentScope = req.body.agentBalanceAgentIds ?? req.body.agent_balance_agent_ids;
  if (incomingAgentScope !== undefined && (!Array.isArray(incomingAgentScope) || incomingAgentScope.some((value: unknown) => typeof value !== "string"))) {
    res.status(400).json({ error: { agentBalanceAgentIds: ["Agent scope must be an array of agent IDs."] } });
    return;
  }
  const incomingMarketingTags = req.body.marketingAttributionTags ?? req.body.marketing_attribution_tags;
  if (incomingMarketingTags !== undefined && !Array.isArray(incomingMarketingTags) && typeof incomingMarketingTags !== "string") {
    res.status(400).json({ error: { marketingAttributionTags: ["Marketing tags must be a comma-separated string or an array of tags."] } });
    return;
  }
  const allowed: Record<string, string> = {
    name: "name",
    role: "role",
    active: "active",
    email: "email",
    phone: "phone",
    permissions: "permissions",
    extraPages: "extra_pages",
    extra_pages: "extra_pages",
    agentBalanceScopeMode: "agent_balance_scope_mode",
    agent_balance_scope_mode: "agent_balance_scope_mode",
    agentBalanceStateScope: "agent_balance_state_scope",
    agent_balance_state_scope: "agent_balance_state_scope",
    agentBalanceAgentIds: "agent_balance_agent_ids",
    agent_balance_agent_ids: "agent_balance_agent_ids",
    marketingAttributionTags: "marketing_attribution_tags",
    marketing_attribution_tags: "marketing_attribution_tags",
    roundRobinPosition: "round_robin_position",
    round_robin_position: "round_robin_position",
    roundRobinExcluded: "round_robin_excluded",
    round_robin_excluded: "round_robin_excluded"
  };
  const updates: Record<string, unknown> = {};
  for (const [inKey, dbKey] of Object.entries(allowed)) {
    if (req.body[inKey] !== undefined) updates[dbKey] = req.body[inKey];
  }
  if (updates.permissions !== undefined) {
    updates.permissions = sanitizeStoredPermissionList(updates.permissions);
  }
  if (updates.extra_pages !== undefined) {
    updates.extra_pages = sanitizeStoredPageList(updates.extra_pages);
  }
  if (updates.marketing_attribution_tags !== undefined) {
    updates.marketing_attribution_tags = sanitizeMarketingAttributionTags(updates.marketing_attribution_tags);
  }
  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();
  if (error) {
    if (error.code === "PGRST116") { res.status(404).json({ error: "User not found." }); return; }
    res.status(500).json({ error: error.message }); return;
  }
  res.json(sanitizeTeamMemberPayload(data));
});

const TeamAgentAssignmentsSchema = z.object({
  agentIds: z.array(z.string().uuid()).default([])
});

router.put("/team/:id/agent-assignments", requireAuth, async (req, res) => {
  if (!["Owner", "Admin"].includes(req.user!.role)) {
    res.status(403).json({ error: "Only Owner or Admin can assign agents." });
    return;
  }

  const parsed = TeamAgentAssignmentsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { data: targetUser, error: targetError } = await supabase
    .from("users")
    .select("id")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .maybeSingle();
  if (targetError) {
    res.status(500).json({ error: targetError.message });
    return;
  }
  if (!targetUser) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  const agentIds = Array.from(new Set(parsed.data.agentIds));
  if (agentIds.length > 0) {
    const { data: validAgents, error: agentsError } = await supabase
      .from("agents")
      .select("id")
      .eq("org_id", req.user!.orgId)
      .in("id", agentIds);
    if (agentsError) {
      res.status(500).json({ error: agentsError.message });
      return;
    }
    const validSet = new Set((validAgents ?? []).map((row) => row.id));
    const invalidIds = agentIds.filter((id) => !validSet.has(id));
    if (invalidIds.length > 0) {
      res.status(400).json({ error: `Some selected agents do not belong to this organization: ${invalidIds.join(", ")}` });
      return;
    }
  }

  const { error: deleteError } = await supabase
    .from("user_agent_assignments")
    .delete()
    .eq("org_id", req.user!.orgId)
    .eq("user_id", req.params.id);
  if (deleteError) {
    res.status(500).json({ error: deleteError.message });
    return;
  }

  if (agentIds.length > 0) {
    const { error: insertError } = await supabase
      .from("user_agent_assignments")
      .insert(agentIds.map((agentId) => ({
        org_id: req.user!.orgId,
        user_id: req.params.id,
        agent_id: agentId
      })));
    if (insertError) {
      res.status(500).json({ error: insertError.message });
      return;
    }
  }

  res.json({ userId: req.params.id, agentIds });
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

  // Soft-delete: deactivate in DB and remove push subscriptions so the
  // device can't receive notifications after the account is disabled.
  const { error } = await supabase
    .from("users")
    .update({ active: false })
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  await supabase.from("push_subscriptions").delete().eq("user_id", req.params.id);
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
    name: z.string().min(2).max(120),
    email: z.string().email().max(254),
    phone: z.string().trim().max(40).optional(),
    password: z.string().min(8).max(200),
    role: z.enum(["Admin", "Manager", "Sales Rep", "Inventory Manager", "Marketer", "Viewer"]),
    marketingAttributionTags: z.union([z.array(z.string()), z.string()]).optional(),
    marketing_attribution_tags: z.union([z.array(z.string()), z.string()]).optional()
  });

  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { name, email, phone, password, role } = parsed.data;
  const marketingAttributionTags = sanitizeMarketingAttributionTags(parsed.data.marketingAttributionTags ?? parsed.data.marketing_attribution_tags);

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
    .insert({
      id: authData.user.id,
      org_id: req.user!.orgId,
      name,
      email,
      phone: phone?.trim() || null,
      role,
      marketing_attribution_tags: marketingAttributionTags
    });
  if (profileError) {
    // Rollback the auth user so the email can be reused on retry.
    await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
    if (profileError.code === "23505") {
      res.status(409).json({ error: "A team member with this email already exists in your workspace." });
      return;
    }
    res.status(500).json({ error: `Failed to create user profile. ${profileError.message}` });
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
