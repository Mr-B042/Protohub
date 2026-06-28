import "./lib/load-env.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import { logger } from "./lib/logger.js";
import { runtimeDataProfile } from "./lib/local-safety.js";
import { syncDueOrderFollowUpNotifications } from "./lib/order-follow-up-notifications.js";
import { runSmartStockAlerts } from "./lib/smart-stock-alerts.js";
import { runPhantomStockCheck } from "./lib/phantom-stock-check.js";
import { getOrgPushBranding } from "./lib/push-branding.js";
import { processQueuedSms, syncDueAbandonedCartSms, syncDueFollowUpSms, syncSmsDeliveryReports } from "./lib/sms.js";
import { processQueuedWhatsApp, syncDueFollowUpWhatsApp, runCartRecoveryWhatsApp } from "./lib/whatsapp.js";
import shortLinkRoutes from "./routes/short-links.js";
import { startWhatsAppRuntime } from "./lib/whatsapp-runtime.js";
import { runCartAutoSubmit } from "./lib/cart-auto-submit.js";
import { runFollowUpCloseAllOrgs } from "./lib/follow-up-kpi.js";
import { supabase } from "./lib/supabase.js";
import { processQueuedEmails, sendWeeklyReport } from "./lib/mailer.js";
import { sendPushToRoles } from "./lib/push.js";

import { applySpyHeader } from "./middleware/auth.js";
import authRoutes     from "./routes/auth.js";
import productRoutes  from "./routes/products.js";
import orderRoutes    from "./routes/orders.js";
import batchRoutes    from "./routes/batches.js";
import agentRoutes    from "./routes/agents.js";
import weekendStockSummaryRoutes from "./routes/weekend-stock-summary.js";
import financeSummaryRoutes from "./routes/finance-summary.js";
import weeklyAccountingRoutes from "./routes/weekly-accounting.js";
import bonusCoachRoutes from "./routes/bonus-coach.js";
import remittanceTransactionRoutes from "./routes/remittance-transactions.js";
import stockRoutes    from "./routes/stock.js";
import expenseRoutes  from "./routes/expenses.js";
import payrollRoutes  from "./routes/payroll.js";
import customerRoutes from "./routes/customers.js";
import notifRoutes         from "./routes/notifications.js";
import waybillRoutes       from "./routes/waybills.js";
import emailSettingsRoutes from "./routes/email-settings.js";
import emailReportsRoutes  from "./routes/email-reports.js";
import smsSettingsRoutes   from "./routes/sms-settings.js";
import metaCapiSettingsRoutes from "./routes/meta-capi-settings.js";
import deliveryDistanceAuditRoutes from "./routes/delivery-distance-audits.js";
import whatsappSettingsRoutes from "./routes/whatsapp-settings.js";
import whatsappUserAccountRoutes from "./routes/whatsapp-user-account.js";
import whatsappDestinationRoutes from "./routes/whatsapp-destinations.js";
import whatsappConversationRoutes from "./routes/whatsapp-conversations.js";
import cartRoutes          from "./routes/carts.js";
import publicCartRoutes    from "./routes/public-carts.js";
import publicOrderRoutes   from "./routes/public-orders.js";
import publicProductRoutes from "./routes/public-products.js";
import publicSmsRoutes from "./routes/public-sms.js";
import publicBrandingRoutes from "./routes/public-branding.js";
import publicPwaRoutes from "./routes/public-pwa.js";
import embedSettingsRoutes       from "./routes/embed-settings.js";
import publicEmbedSettingsRoutes from "./routes/public-embed-settings.js";
import payStructureRoutes  from "./routes/pay-structures.js";
import salesTeamRoutes     from "./routes/sales-teams.js";
import penaltyRoutes       from "./routes/penalties.js";
import followUpKpiRoutes   from "./routes/follow-up-kpi.js";
import pushRoutes          from "./routes/push.js";
import userRoutes          from "./routes/users.js";
import marketingLinkVariantRoutes from "./routes/marketing-link-variants.js";
import marketingSpendRoutes from "./routes/marketing-spend.js";

const app = express();
const PORT = process.env.PORT ?? 4000;
const ENABLE_BACKGROUND_JOBS = !["0", "false", "no", "off"].includes((process.env.ENABLE_BACKGROUND_JOBS ?? "true").trim().toLowerCase());
const ENABLE_WHATSAPP_RUNTIME = !["0", "false", "no", "off"].includes((process.env.ENABLE_WHATSAPP_RUNTIME ?? "true").trim().toLowerCase());
const DATA_PROFILE = runtimeDataProfile();

const normalizeOrigin = (value: string) => value.trim().replace(/\/+$/, "");

const configuredFrontendOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URLS
]
  .flatMap((value) => (value ?? "").split(/[,\n]/))
  .map((value) => value.trim())
  .filter(Boolean)
  .map(normalizeOrigin);

const defaultFrontendOrigins = [
  "http://localhost:5173",
  "http://localhost",
  "https://localhost",
  "capacitor://localhost",
  "https://protohub-zeta.vercel.app",
  "https://brightpathhubs.com",
  "https://www.brightpathhubs.com"
].map(normalizeOrigin);

const allowedFrontendOrigins = Array.from(new Set([
  ...defaultFrontendOrigins,
  ...configuredFrontendOrigins
]));
const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isLoopbackIp(ip: string | undefined) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function isAllowedLocalOrigin(origin: string | undefined) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  } catch {
    return false;
  }
}

function isAllowedFrontendOrigin(origin: string | undefined) {
  if (!origin) return true;
  return isAllowedLocalOrigin(origin) || allowedFrontendOrigins.includes(normalizeOrigin(origin));
}

function rateLimitBucketKey(req: express.Request) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1]?.trim();
    if (token) {
      const parts = token.split(".");
      if (parts.length >= 2) {
        try {
          const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
          const sub = typeof payload?.sub === "string" ? payload.sub.trim() : "";
          if (UUID_LIKE_PATTERN.test(sub)) return `user:${sub}`;
        } catch {
          // Fall back to IP-based limiting when the header isn't a valid JWT.
        }
      }
    }
  }
  return `ip:${req.ip ?? "unknown"}`;
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
// restricted to known app origins.
app.use("/api/public", cors({ origin: "*", credentials: false }));
app.use(cors({
  origin(origin, callback) {
    if (isAllowedFrontendOrigin(origin)) {
      callback(null, true);
      return;
    }
    logger.warn("cors_origin_blocked", { origin, allowedFrontendOrigins });
    callback(null, false);
  },
  credentials: true
}));
// Global rate limit — skip for local development
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitBucketKey,
  skip: (req) =>
    isLoopbackIp(req.ip) ||
    req.path.startsWith("/api/public/branding/") ||
    req.path.startsWith("/api/public/pwa/")
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
// Package carousel images can be uploaded as data URLs. 10 MB files expand
// after encoding, and admins may save several images at once.
app.use(express.json({ limit: "90mb" }));

// ── Request logger (before routes so every request is captured) ───
app.use((req, _res, next) => {
  logger.info("request", { method: req.method, path: req.path });
  next();
});

// ── Health check ──────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    dataMode: DATA_PROFILE.dataMode,
    localSandbox: DATA_PROFILE.localSandbox,
    backgroundJobsEnabled: ENABLE_BACKGROUND_JOBS,
    whatsappRuntimeEnabled: ENABLE_WHATSAPP_RUNTIME
  });
});

// ── Public short-link redirector (no auth) ───────────────
app.use("/r", shortLinkRoutes);

// ── Spy middleware (Owner/Admin can pass X-Spy-User-Id to see another user's data) ──
app.use("/api", applySpyHeader);

// ── Routes ────────────────────────────────────────────────
app.use("/api/auth/login",    authRateLimit);
app.use("/api/auth/register", authRateLimit);
app.use("/api/auth/refresh",  authRateLimit);
app.use("/api/auth",          authRoutes);
app.use("/api/products",      productRoutes);
app.use("/api/orders",        orderRoutes);
app.use("/api/batches",       batchRoutes);
app.use("/api/finance-summary", financeSummaryRoutes);
app.use("/api/weekly-accounting", weeklyAccountingRoutes);
app.use("/api/bonus-coach", bonusCoachRoutes);
app.use("/api/agents",        agentRoutes);
app.use("/api/weekend-stock-summary", weekendStockSummaryRoutes);
app.use("/api/remittance-transactions", remittanceTransactionRoutes);
app.use("/api/stock",         stockRoutes);
app.use("/api/expenses",      expenseRoutes);
app.use("/api/payroll",       payrollRoutes);
app.use("/api/customers",     customerRoutes);
app.use("/api/notifications",  notifRoutes);
app.use("/api/waybills",       waybillRoutes);
app.use("/api/email-settings", emailSettingsRoutes);
app.use("/api/email",          emailReportsRoutes);
app.use("/api/sms-settings",   smsSettingsRoutes);
app.use("/api/meta-capi-settings", metaCapiSettingsRoutes);
app.use("/api/delivery-distance-audits", deliveryDistanceAuditRoutes);
app.use("/api/whatsapp-settings", whatsappSettingsRoutes);
app.use("/api/whatsapp-user-account", whatsappUserAccountRoutes);
app.use("/api/whatsapp-destinations", whatsappDestinationRoutes);
app.use("/api/whatsapp/conversations", whatsappConversationRoutes);
app.use("/api/public/carts",           publicCartRoutes);
app.use("/api/public/orders",          publicOrderRoutes);
app.use("/api/public/products",        publicProductRoutes);
app.use("/api/public/sms",             publicSmsRoutes);
app.use("/api/public/branding",        publicBrandingRoutes);
app.use("/api/public/pwa",             publicPwaRoutes);
app.use("/api/public/embed-settings",  publicEmbedSettingsRoutes);
app.use("/api/embed-settings",         embedSettingsRoutes);
app.use("/api/carts",           cartRoutes);
app.use("/api/pay-structures",  payStructureRoutes);
app.use("/api/sales-teams",     salesTeamRoutes);
app.use("/api/penalties",       penaltyRoutes);
app.use("/api/follow-up-kpi",   followUpKpiRoutes);
app.use("/api/push",            pushRoutes);
app.use("/api/users",           userRoutes);
app.use("/api/marketing-link-variants", marketingLinkVariantRoutes);
app.use("/api/marketing-spend", marketingSpendRoutes);

// ── Global error handler ──────────────────────────────────
app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.status === 413 || err.type === "entity.too.large") {
    res.status(413).json({ error: "Upload is too large. Use fewer carousel images or compress them before saving." });
    return;
  }
  logger.error("unhandled error", { message: err.message, stack: err.stack?.split("\n")[1]?.trim() });
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  logger.info("server started", {
    port: PORT,
    dataMode: DATA_PROFILE.dataMode,
    localSandbox: DATA_PROFILE.localSandbox,
    backgroundJobsEnabled: ENABLE_BACKGROUND_JOBS,
    whatsappRuntimeEnabled: ENABLE_WHATSAPP_RUNTIME
  });
  if (ENABLE_WHATSAPP_RUNTIME) {
    void startWhatsAppRuntime().catch((error) => {
      logger.warn("whatsapp runtime bootstrap failed", { error: error instanceof Error ? error.message : String(error) });
    });
  } else {
    logger.info("whatsapp runtime disabled by env");
  }
});

// ── Server-side cart auto-submit — every 2 minutes ───────
// Catches customers who closed the tab before the client-side countdown fired.
// Only runs on complete carts (6/6 fields) idle for 2–15 min with no order yet.
if (ENABLE_BACKGROUND_JOBS) {
cron.schedule("*/2 * * * *", async () => {
  try { await runCartAutoSubmit(); }
  catch (e) { logger.error("cron: cart auto-submit crashed", { error: (e as Error).message }); }
});
}

// ── Follow-up KPI nightly close — 22:00 Africa/Lagos (21:00 UTC) ──
// After the working day ends, record a pending ₦50 miss for every due-but-
// unattended follow-up. Sundays are skipped inside the job.
if (ENABLE_BACKGROUND_JOBS) {
cron.schedule("0 21 * * *", async () => {
  logger.info("cron: follow-up KPI nightly close");
  try { await runFollowUpCloseAllOrgs(); }
  catch (e) { logger.error("cron: follow-up KPI close crashed", { error: (e as Error).message }); }
});
}

// ── WhatsApp abandoned-cart recovery — every minute ──────
// Sends a recovery message (product image + short tracked continue-link) to carts
// that left the form 3+ min ago or have been idle 5+ min and didn't convert.
if (ENABLE_BACKGROUND_JOBS) {
cron.schedule("* * * * *", async () => {
  try { await runCartRecoveryWhatsApp(); }
  catch (e) { logger.error("cron: cart recovery whatsapp crashed", { error: (e as Error).message }); }
});
}

// ── SMS delivery-report sync — every 10 minutes ──────────
if (ENABLE_BACKGROUND_JOBS) {
cron.schedule("*/10 * * * *", async () => {
  logger.info("cron: syncing sms delivery reports");
  try {
    await syncSmsDeliveryReports();
  } catch (e) {
    logger.error("cron: sms delivery report sync crashed", { error: (e as Error).message });
  }
});

// ── SMS follow-up reminders — every 15 minutes ───────────
cron.schedule("*/15 * * * *", async () => {
  logger.info("cron: syncing due sms follow-up reminders");
  try {
    await syncDueFollowUpSms();
  } catch (e) {
    logger.error("cron: sms follow-up reminder sync crashed", { error: (e as Error).message });
  }
});

// ── WhatsApp follow-up reminders — every 15 minutes ──────
cron.schedule("*/15 * * * *", async () => {
  logger.info("cron: syncing due whatsapp follow-up reminders");
  try {
    await syncDueFollowUpWhatsApp();
  } catch (e) {
    logger.error("cron: whatsapp follow-up reminder sync crashed", { error: (e as Error).message });
  }
});

// ── Rep/order follow-up notifications — every 5 minutes ──
cron.schedule("*/5 * * * *", async () => {
  logger.info("cron: syncing due order follow-up notifications");
  try {
    await syncDueOrderFollowUpNotifications();
  } catch (e) {
    logger.error("cron: order follow-up notification sync crashed", { error: (e as Error).message });
  }
});

// ── Smart low-stock alerts — every hour ──────────────────
// Fires only for (state, product) pairs that sold this week AND are < 3 days
// of stock at the current sell rate. 24-hour dedupe prevents notification spam.
cron.schedule("0 * * * *", async () => {
  logger.info("cron: scanning for smart stock alerts");
  try {
    const summary = await runSmartStockAlerts();
    if (summary.firedAlerts > 0) {
      logger.info("cron: smart stock alerts fired", summary);
    }
  } catch (e) {
    logger.error("cron: smart stock alert scan crashed", { error: (e as Error).message });
  }
});

// ── Phantom-stock safety net — daily at 06:00 ────────────
// Flags any order marked Delivered whose agent stock was never actually deducted
// (no "Order Fulfilled" movement). Should never fire given the deduction guards;
// notifies Owners/Admins in-app if it ever does, so it's caught in a day not weeks.
cron.schedule("0 6 * * *", async () => {
  logger.info("cron: phantom-stock audit");
  try {
    const summary = await runPhantomStockCheck();
    if (summary.phantomOrders > 0) {
      logger.warn("cron: phantom-stock audit found undeducted deliveries", summary);
    }
  } catch (e) {
    logger.error("cron: phantom-stock audit crashed", { error: (e as Error).message });
  }
});

// ── SMS retry / deferred queue — every 10 minutes ────────
cron.schedule("*/10 * * * *", async () => {
  logger.info("cron: processing queued sms");
  try {
    await processQueuedSms();
  } catch (e) {
    logger.error("cron: sms queue processor crashed", { error: (e as Error).message });
  }
});

// ── WhatsApp retry / deferred queue — every 10 minutes ───
cron.schedule("*/10 * * * *", async () => {
  logger.info("cron: processing queued whatsapp");
  try {
    await processQueuedWhatsApp();
  } catch (e) {
    logger.error("cron: whatsapp queue processor crashed", { error: (e as Error).message });
  }
});

// ── Deferred email queue — every 10 minutes ──────────────
cron.schedule("*/10 * * * *", async () => {
  logger.info("cron: processing queued emails");
  try {
    await processQueuedEmails();
  } catch (e) {
    logger.error("cron: email queue processor crashed", { error: (e as Error).message });
  }
});

// ── Abandoned-cart recovery SMS — hourly ─────────────────
cron.schedule("0 * * * *", async () => {
  logger.info("cron: syncing abandoned cart sms follow-ups");
  try {
    await syncDueAbandonedCartSms();
  } catch (e) {
    logger.error("cron: abandoned cart sms sync crashed", { error: (e as Error).message });
  }
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
        title:   "Stale Abandoned Carts",
        message,
        link:    "/dashboard/admin/abandoned-carts"
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
        title:   "Remittance Overdue",
        message,
        link:    "/dashboard/admin/finance-accounting"
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
} else {
  logger.info("background jobs disabled by env");
}
