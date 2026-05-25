import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrgPushBranding } from "../lib/push-branding.js";
import { sendPushToUsers } from "../lib/push.js";

const router = Router();
router.use(requireAuth);

const SMART_STOCK_ADMIN_ROLES = ["Owner", "Admin", "Inventory Manager"] as const;
const SMART_STOCK_PRIVILEGED_ROLES = new Set<string>(SMART_STOCK_ADMIN_ROLES);
const SMART_STOCK_SIGNAL_LIMIT = 6;

const titleSlug = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "stock";

const smartStockTitle = (signal: { severity: "stockout" | "critical" | "watch"; productName: string; state: string }) => {
  const prefix = signal.severity === "stockout"
    ? "Stockout risk"
    : signal.severity === "critical"
      ? "Critical fast mover"
      : "Watch fast mover";
  return `${prefix}: ${signal.productName} in ${signal.state}`;
};

const smartStockMessage = (signal: {
  stock: number;
  recentUnits: number;
  openOrders: number;
  daysCover?: number;
  lookbackDays?: number;
  state: string;
}) => {
  const lookbackDays = Number.isFinite(signal.lookbackDays) ? Math.max(1, Math.round(Number(signal.lookbackDays))) : 7;
  const cover = Number.isFinite(signal.daysCover)
    ? `${Math.max(0, Math.ceil(Number(signal.daysCover)))} day${Math.ceil(Number(signal.daysCover)) === 1 ? "" : "s"} cover`
    : "cover unknown";
  const open = signal.openOrders > 0
    ? ` ${signal.openOrders} open order${signal.openOrders === 1 ? "" : "s"} still need stock.`
    : "";
  return `${signal.state} has ${signal.stock} left after ${signal.recentUnits} unit${signal.recentUnits === 1 ? "" : "s"} ordered in the last ${lookbackDays} day${lookbackDays === 1 ? "" : "s"} (${cover}).${open}`;
};

router.get("/", async (req, res) => {
  // Return org-wide notifications (recipient_id IS NULL) + those addressed to this user
  const { data, error } = await supabase
    .from("system_notifications")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .or(`recipient_id.is.null,recipient_id.eq.${req.user!.id}`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Create notification
router.post("/", async (req, res) => {
  const Schema = z.object({
    type:      z.enum(["low_stock", "remittance_overdue", "info", "order_new", "order_confirmed", "order_delivered", "order_cancelled", "order_failed", "order_rescheduled", "order_assigned", "order_follow_up"]),
    message:   z.string().min(1),
    productId: z.string().uuid().optional(),
    title:     z.string().trim().min(1).max(160).optional(),
    link:      z.string().trim().min(1).max(300).optional(),
    orderId:   z.string().trim().min(1).max(80).optional()
  });
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { type, message, productId, title, link, orderId } = parsed.data;
  const { data, error } = await supabase
    .from("system_notifications")
    .insert({
      org_id: req.user!.orgId,
      type,
      title: title ?? null,
      message,
      link: link ?? null,
      order_id: orderId ?? null,
      product_id: productId ?? null
    })
    .select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// Demand-aware stock-risk notifications.
// The frontend calculates velocity from the loaded workspace state; the server
// handles recipient targeting, one-per-day dedupe, persistence, and push.
router.post("/stock-risk", async (req, res) => {
  const SignalSchema = z.object({
    productId: z.string().uuid(),
    productName: z.string().trim().min(1).max(180),
    state: z.string().trim().min(1).max(80),
    stock: z.number().int().min(0),
    recentUnits: z.number().int().min(0),
    openOrders: z.number().int().min(0),
    daysCover: z.number().min(0).optional(),
    lookbackDays: z.number().int().min(1).max(60).optional(),
    severity: z.enum(["stockout", "critical", "watch"]),
    salesRepRecipientIds: z.array(z.string().uuid()).optional()
  });
  const Schema = z.object({
    signals: z.array(SignalSchema).min(1).max(SMART_STOCK_SIGNAL_LIMIT)
  });
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const privileged = SMART_STOCK_PRIVILEGED_ROLES.has(req.user!.role);
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, role")
    .eq("org_id", req.user!.orgId)
    .eq("active", true)
    .in("role", [...SMART_STOCK_ADMIN_ROLES, "Sales Rep"]);

  if (usersError) {
    res.status(500).json({ error: usersError.message });
    return;
  }

  const roleByUserId = new Map((users ?? []).map((user) => [user.id as string, user.role as string]));
  const activeSalesRepIds = new Set((users ?? []).filter((user) => user.role === "Sales Rep").map((user) => user.id as string));
  const adminRecipientIds = privileged
    ? (users ?? []).filter((user) => SMART_STOCK_ADMIN_ROLES.includes(user.role as any)).map((user) => user.id as string)
    : [];

  const candidateRows: Array<{
    org_id: string;
    recipient_id: string;
    type: "low_stock";
    title: string;
    message: string;
    link: string;
    product_id: string;
    read: false;
  }> = [];

  for (const signal of parsed.data.signals) {
    const title = smartStockTitle(signal);
    const message = smartStockMessage(signal);
    const salesRepRecipientIds = [...new Set(signal.salesRepRecipientIds ?? [])]
      .filter((id) => activeSalesRepIds.has(id))
      .filter((id) => privileged || id === req.user!.id);
    const recipientIds = new Set<string>([
      ...adminRecipientIds,
      ...salesRepRecipientIds,
      ...(privileged ? [] : req.user!.role === "Sales Rep" ? [req.user!.id] : [])
    ]);

    for (const recipientId of recipientIds) {
      const role = roleByUserId.get(recipientId) ?? req.user!.role;
      candidateRows.push({
        org_id: req.user!.orgId,
        recipient_id: recipientId,
        type: "low_stock",
        title,
        message,
        link: role === "Sales Rep" ? "/dashboard/sales-rep/notifications" : "/dashboard/admin/inventory/state-stock",
        product_id: signal.productId,
        read: false
      });
    }
  }

  if (candidateRows.length === 0) {
    res.json([]);
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const productIds = [...new Set(candidateRows.map((row) => row.product_id))];
  const titles = [...new Set(candidateRows.map((row) => row.title))];
  const { data: existing, error: existingError } = await supabase
    .from("system_notifications")
    .select("recipient_id, product_id, title")
    .eq("org_id", req.user!.orgId)
    .gte("created_at", today.toISOString())
    .in("product_id", productIds)
    .in("title", titles);

  if (existingError) {
    res.status(500).json({ error: existingError.message });
    return;
  }

  const existingKeys = new Set((existing ?? []).map((row) => `${row.recipient_id ?? ""}::${row.product_id ?? ""}::${row.title ?? ""}`));
  const seenKeys = new Set<string>();
  const rows = candidateRows.filter((row) => {
    const key = `${row.recipient_id}::${row.product_id}::${row.title}`;
    if (existingKeys.has(key) || seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  if (rows.length === 0) {
    res.json([]);
    return;
  }

  const { data: inserted, error } = await supabase
    .from("system_notifications")
    .insert(rows)
    .select("*");

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const branding = await getOrgPushBranding(req.user!.orgId);
  await Promise.allSettled(
    rows.map((row) =>
      sendPushToUsers(req.user!.orgId, [row.recipient_id], {
        title: row.title,
        body: row.message,
        kind: "low_stock",
        url: row.link,
        tag: `smart-stock-${row.product_id}-${titleSlug(row.title)}`,
        brandName: branding.brandName,
        brandLogo: branding.brandLogo
      })
    )
  );

  res.status(201).json((inserted ?? []).filter((row) => row.recipient_id === req.user!.id));
});

// Mark all as read (org-wide + user's own)
router.patch("/read-all", async (req, res) => {
  const { error } = await supabase
    .from("system_notifications")
    .update({ read: true })
    .eq("org_id", req.user!.orgId)
    .eq("read", false)
    .or(`recipient_id.is.null,recipient_id.eq.${req.user!.id}`);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: "All notifications marked as read." });
});

// Mark single as read
router.patch("/:id/read", async (req, res) => {
  const { data, error } = await supabase
    .from("system_notifications")
    .update({ read: true })
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Delete all read notifications for this org+user
router.delete("/read", async (req, res) => {
  const { error } = await supabase
    .from("system_notifications")
    .delete()
    .eq("org_id", req.user!.orgId)
    .eq("read", true)
    .or(`recipient_id.is.null,recipient_id.eq.${req.user!.id}`);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
