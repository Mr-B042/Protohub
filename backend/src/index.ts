import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import { logger } from "./lib/logger.js";
import { supabase } from "./lib/supabase.js";
import { sendWeeklyReport } from "./lib/mailer.js";

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
import embedSettingsRoutes       from "./routes/embed-settings.js";
import publicEmbedSettingsRoutes from "./routes/public-embed-settings.js";
import payStructureRoutes  from "./routes/pay-structures.js";
import salesTeamRoutes     from "./routes/sales-teams.js";
import penaltyRoutes       from "./routes/penalties.js";
import pushRoutes          from "./routes/push.js";
import userRoutes          from "./routes/users.js";

const app = express();
const PORT = process.env.PORT ?? 4000;

// Trust the first proxy hop so req.ip reflects the real client IP behind
// Railway/Vercel/Cloudflare. Required for accurate login_audit IP capture
// and per-IP rate limiting.
app.set("trust proxy", 1);

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
  skip: (req) => req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1"
}));

// Strict rate limit on auth endpoints — 10 requests per 15 minutes per IP
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in 15 minutes." }
});

// ── Body parsing ──────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));

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
app.use("/api/public/embed-settings",  publicEmbedSettingsRoutes);
app.use("/api/embed-settings",         embedSettingsRoutes);
app.use("/api/carts",           cartRoutes);
app.use("/api/pay-structures",  payStructureRoutes);
app.use("/api/sales-teams",     salesTeamRoutes);
app.use("/api/penalties",       penaltyRoutes);
app.use("/api/push",            pushRoutes);
app.use("/api/users",           userRoutes);

// ── Request logger ────────────────────────────────────────
app.use((req, _res, next) => {
  logger.info("request", { method: req.method, path: req.path });
  next();
});

// ── Global error handler ──────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("unhandled error", { message: err.message, stack: err.stack?.split("\n")[1]?.trim() });
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  logger.info("server started", { port: PORT });
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
