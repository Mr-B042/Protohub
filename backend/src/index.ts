import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import { logger } from "./lib/logger.js";
import { getOrgPushBranding } from "./lib/push-branding.js";
import { supabase } from "./lib/supabase.js";
import { sendWeeklyReport } from "./lib/mailer.js";
import { sendPushToRoles } from "./lib/push.js";

import authRoutes     from "./routes/auth.js";
import productRoutes  from "./routes/products.js";
import orderRoutes    from "./routes/orders.js";
import agentRoutes    from "./routes/agents.js";
import stockRoutes    from "./routes/stock.js";
import expenseRoutes  from "./routes/expenses.js";
import payrollRoutes  from "./routes/payroll.js";
import customerRoutes from "./routes/customers.js";
import notifRoutes         from "./routes/notifications.js";
import waybillRoutes       from "./routes/waybills.js";
import emailSettingsRoutes from "./routes/email-settings.js";
import emailReportsRoutes  from "./routes/email-reports.js";
import cartRoutes          from "./routes/carts.js";
import publicCartRoutes    from "./routes/public-carts.js";
import publicOrderRoutes   from "./routes/public-orders.js";
import publicProductRoutes from "./routes/public-products.js";
import publicBrandingRoutes from "./routes/public-branding.js";
import embedSettingsRoutes       from "./routes/embed-settings.js";
import publicEmbedSettingsRoutes from "./routes/public-embed-settings.js";
import payStructureRoutes  from "./routes/pay-structures.js";
import salesTeamRoutes     from "./routes/sales-teams.js";
import penaltyRoutes       from "./routes/penalties.js";
import pushRoutes          from "./routes/push.js";
import userRoutes          from "./routes/users.js";

const app = express();
const PORT = process.env.PORT ?? 4000;

function isLoopbackIp(ip: string | undefined) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

// Trust the first proxy hop so req.ip reflects the real client IP behind
// Railway/Vercel/Cloudflare. Required for accurate login_audit IP capture
// and per-IP rate limiting.
app.set("trust proxy", 1);

// Disable ETag generation for /api responses — Express's auto-ETag was
// triggering 304 Not Modified for orders/notifications polling, which made
// the browser keep using stale cached payloads after order edits (e.g. agent
// assignments not visible after refresh even though DB had the change).
app.set("etag", false);

// Belt-and-suspenders: every /api response must be revalidated, never cached.
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  next();
});

// ── Security ──────────────────────────────────────────────
app.use(helmet());

// Public endpoints are designed to be hit from customer-owned domains hosting
// the embed iframe — they need wildcard CORS. Authenticated endpoints stay
// locked to the configured FRONTEND_URL.
app.use("/api/public", cors({ origin: "*", credentials: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
  credentials: true
}));
// Global rate limit — skip for local development
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isLoopbackIp(req.ip)
}));

// Rate limit on auth endpoints — 20 attempts per 15 minutes per IP. Bumped
// from the previous 10 because the limit is per-IP and reps behind the same
// NAT share a budget; legitimate password typos were locking out the whole
// office. Successful logins still count against the budget (express-rate-limit
// counts on response, not just on auth failure) — if that becomes a problem,
// consider `skipSuccessfulRequests: true` in a follow-up.
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isLoopbackIp(req.ip),
  message: { error: "Too many attempts. Please try again in 15 minutes." }
});

// ── Body parsing ──────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));

// ── Request logger (before routes so every request is captured) ───
app.use((req, _res, next) => {
  logger.info("request", { method: req.method, path: req.path });
  next();
});

// ── Health check ──────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────
app.use("/api/auth/login",    authRateLimit);
app.use("/api/auth/register", authRateLimit);
app.use("/api/auth/refresh",  authRateLimit);
app.use("/api/auth",          authRoutes);
app.use("/api/products",      productRoutes);
app.use("/api/orders",        orderRoutes);
app.use("/api/agents",        agentRoutes);
app.use("/api/stock",         stockRoutes);
app.use("/api/expenses",      expenseRoutes);
app.use("/api/payroll",       payrollRoutes);
app.use("/api/customers",     customerRoutes);
app.use("/api/notifications",  notifRoutes);
app.use("/api/waybills",       waybillRoutes);
app.use("/api/email-settings", emailSettingsRoutes);
app.use("/api/email",          emailReportsRoutes);
app.use("/api/public/carts",           publicCartRoutes);
app.use("/api/public/orders",          publicOrderRoutes);
app.use("/api/public/products",        publicProductRoutes);
app.use("/api/public/branding",        publicBrandingRoutes);
app.use("/api/public/embed-settings",  publicEmbedSettingsRoutes);
app.use("/api/embed-settings",         embedSettingsRoutes);
app.use("/api/carts",           cartRoutes);
app.use("/api/pay-structures",  payStructureRoutes);
app.use("/api/sales-teams",     salesTeamRoutes);
app.use("/api/penalties",       penaltyRoutes);
app.use("/api/push",            pushRoutes);
app.use("/api/users",           userRoutes);

// ── Global error handler ──────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("unhandled error", { message: err.message, stack: err.stack?.split("\n")[1]?.trim() });
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  logger.info("server started", { port: PORT });
});

// ── Abandoned-cart staleness cron — daily at 9:00 AM ─────
// Fires an in-app notification per org for every cart that has been
// sitting in 'Open abandoned' or 'Assigned' status for more than 3 days
// without any activity.
cron.schedule("0 9 * * *", async () => {
  logger.info("cron: checking stale abandoned carts");
  try {
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: staleCarts, error } = await supabase
      .from("abandoned_carts")
      .select("org_id")
      .in("status", ["Open abandoned", "Assigned"])
      .lt("last_activity", cutoff);
    if (error) { logger.error("cron: stale carts query failed", { error: error.message }); return; }

    // Group by org
    const countByOrg: Record<string, number> = {};
    for (const cart of staleCarts ?? []) {
      countByOrg[cart.org_id] = (countByOrg[cart.org_id] ?? 0) + 1;
    }

    for (const [orgId, count] of Object.entries(countByOrg)) {
      // Skip if an unread notification of this type was sent in the last 24h
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("system_notifications")
        .select("id")
        .eq("org_id", orgId)
        .eq("type", "info")
        .ilike("message", "Stale abandoned carts%")
        .eq("read", false)
        .gte("created_at", since)
        .limit(1);
      if (existing && existing.length > 0) continue;

      const message = `Stale abandoned carts: ${count} cart${count === 1 ? "" : "s"} with no activity for 3+ days — follow up now.`;
      await supabase.from("system_notifications").insert({
        org_id:  orgId,
        type:    "info",
        message
      });
      const branding = await getOrgPushBranding(orgId);
      await sendPushToRoles(orgId, ["Owner", "Admin"], {
        title: "Stale Abandoned Carts",
        body: message,
        kind: "stale_carts",
        url: "/dashboard/admin/abandoned-carts",
        tag: `stale-carts-${orgId}`,
        brandName: branding.brandName,
        brandLogo: branding.brandLogo
      });
    }
    logger.info("cron: stale carts done", { orgsNotified: Object.keys(countByOrg).length });
  } catch (e) {
    logger.error("cron: stale carts job crashed", { error: (e as Error).message });
  }
});

// ── Remittance overdue cron — daily at 9:05 AM ────────────
// Fires a 'remittance_overdue' notification per org for every delivered
// order whose agent has not remitted cash within 7 days of delivery.
cron.schedule("5 9 * * *", async () => {
  logger.info("cron: checking overdue remittances");
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]; // date only
    const { data: overdueOrders, error } = await supabase
      .from("orders")
      .select("org_id, id, amount, amount_remitted, logistics_cost")
      .eq("status", "Delivered")
      .neq("remittance_status", "Paid")
      .lte("delivered_date", cutoff);
    if (error) { logger.error("cron: overdue remittance query failed", { error: error.message }); return; }

    // Group by org
    const summaryByOrg: Record<string, { count: number; outstanding: number }> = {};
    for (const order of overdueOrders ?? []) {
      const net = (order.amount ?? 0) - (order.logistics_cost ?? 0);
      const paid = order.amount_remitted ?? 0;
      const owed = Math.max(0, net - paid);
      if (owed <= 0) continue;
      if (!summaryByOrg[order.org_id]) summaryByOrg[order.org_id] = { count: 0, outstanding: 0 };
      summaryByOrg[order.org_id].count++;
      summaryByOrg[order.org_id].outstanding += owed;
    }

    for (const [orgId, { count, outstanding }] of Object.entries(summaryByOrg)) {
      // Skip if an unread remittance_overdue notification was sent in the last 24h
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("system_notifications")
        .select("id")
        .eq("org_id", orgId)
        .eq("type", "remittance_overdue")
        .eq("read", false)
        .gte("created_at", since)
        .limit(1);
      if (existing && existing.length > 0) continue;

      const formatted = outstanding.toLocaleString("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
      const message = `Remittance overdue: ${count} delivered order${count === 1 ? "" : "s"} unpaid for 7+ days — ${formatted} outstanding.`;
      await supabase.from("system_notifications").insert({
        org_id:  orgId,
        type:    "remittance_overdue",
        message
      });
      const branding = await getOrgPushBranding(orgId);
      await sendPushToRoles(orgId, ["Owner", "Admin"], {
        title: "Remittance Overdue",
        body: message,
        kind: "remittance_overdue",
        url: "/dashboard/admin/finance-accounting",
        tag: `remittance-overdue-${orgId}`,
        brandName: branding.brandName,
        brandLogo: branding.brandLogo
      });
    }
    logger.info("cron: overdue remittances done", { orgsNotified: Object.keys(summaryByOrg).length });
  } catch (e) {
    logger.error("cron: overdue remittances job crashed", { error: (e as Error).message });
  }
});

// ── Weekly report cron — every Sunday at 7:00 AM ──────────
cron.schedule("0 7 * * 0", async () => {
  logger.info("cron: sending weekly reports");
  try {
    const { data: orgs, error } = await supabase.from("organizations").select("id");
    if (error) { logger.error("cron: failed to fetch orgs", { error: error.message }); return; }
    let sent = 0;
    let failed = 0;
    for (const org of orgs ?? []) {
      try {
        await sendWeeklyReport(org.id);
        sent++;
      } catch (e) {
        failed++;
        logger.error("cron: weekly report failed for org", { orgId: org.id, error: (e as Error).message });
      }
    }
    logger.info("cron: weekly reports done", { sent, failed, total: orgs?.length ?? 0 });
  } catch (e) {
    logger.error("cron: weekly report job crashed", { error: (e as Error).message });
  }
});
