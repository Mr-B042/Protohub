import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes     from "./routes/auth.js";
import productRoutes  from "./routes/products.js";
import orderRoutes    from "./routes/orders.js";
import agentRoutes    from "./routes/agents.js";
import stockRoutes    from "./routes/stock.js";
import expenseRoutes  from "./routes/expenses.js";
import payrollRoutes  from "./routes/payroll.js";
import customerRoutes from "./routes/customers.js";
import notifRoutes    from "./routes/notifications.js";
import waybillRoutes  from "./routes/waybills.js";

const app = express();
const PORT = process.env.PORT ?? 4000;

// ── Security ──────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
  credentials: true
}));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false
}));

// ── Body parsing ──────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));

// ── Health check ──────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────
app.use("/api/auth",          authRoutes);
app.use("/api/products",      productRoutes);
app.use("/api/orders",        orderRoutes);
app.use("/api/agents",        agentRoutes);
app.use("/api/stock",         stockRoutes);
app.use("/api/expenses",      expenseRoutes);
app.use("/api/payroll",       payrollRoutes);
app.use("/api/customers",     customerRoutes);
app.use("/api/notifications", notifRoutes);
app.use("/api/waybills",      waybillRoutes);

// ── Global error handler ──────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[ERROR]", err.message);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`ProtoHub API running on http://localhost:${PORT}`);
});
