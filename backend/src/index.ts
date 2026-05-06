import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { logger } from "./lib/logger.js";

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

const app = express();
const PORT = process.env.PORT ?? 4000;

// ── Security ──────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
  credentials: true
}));
// Global rate limit
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false
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
