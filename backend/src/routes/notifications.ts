import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, scopeOf } from "../middleware/auth.js";
import { getOrgPushBranding } from "../lib/push-branding.js";
import { sendPushToUsers } from "../lib/push.js";

const router = Router();
router.use(requireAuth);

const SMART_STOCK_ADMIN_ROLES = ["Owner", "Admin", "Inventory Manager"] as const;
const SMART_STOCK_PRIVILEGED_ROLES = new Set<string>(SMART_STOCK_ADMIN_ROLES);
const SMART_STOCK_SIGNAL_LIMIT = 6;
const SMART_STOCK_DIGEST_TITLE = "Stock risk summary";
const SMART_STOCK_DIGEST_CACHE_TTL_MS = 25 * 60 * 60 * 1000;
const smartStockDigestCache = new Map<string, number>();

const titleSlug = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "stock";

// ── Who an ORG-WIDE notification is actually for ──────────────────────────
// A row with recipient_id IS NULL is delivered to every authenticated user,
// which is how a Recovery Rep ended up reading "Remittance overdue ... ₦58,498
// outstanding" and every rep's postponed orders.
//
// There is no audience column, so the audience is derived from the title the
// creator wrote. That is the only signal these rows carry - 1,995 of them are
// type "info" and the title is what separates "Order failed" from "Low SMS
// Balance". Storing an explicit audience is the durable fix; this makes the
// existing rows behave correctly without a migration.
//
// Anything not matched here (order postponed / failed / edited) stays visible
// to everyone - those are the shared operational feed.
const NOTIFICATION_MANAGEMENT = ["Owner", "Admin", "Manager"] as const;
const NOTIFICATION_AUDIENCE_RULES: Array<{ test: RegExp; roles: readonly string[] }> = [
  // Money and account admin. Never to the floor - the Recovery Rep dashboard
  // already strips financials server-side, and the bell must not undo that.
  { test: /remittance|sms balance|payout|salary|bonus pool/i, roles: NOTIFICATION_MANAGEMENT },
  // Stock and waybill movement belongs to whoever owns inventory.
  { test: /stock|waybill|inventory/i, roles: [...NOTIFICATION_MANAGEMENT, "Inventory Manager"] },
  // Cart supervision: sales reps work carts, recovery reps do not.
  { test: /cart/i, roles: [...NOTIFICATION_MANAGEMENT, "Sales Rep"] }
];

export const notificationReachesRole = (title: string | null, type: string | null, role: string): boolean => {
  if ((NOTIFICATION_MANAGEMENT as readonly string[]).includes(role)) return true;
  const subject = `${title ?? ""} ${type ?? ""}`;
  const rule = NOTIFICATION_AUDIENCE_RULES.find((candidate) => candidate.test.test(subject));
  return rule ? rule.roles.includes(role) : true;
};

type SmartStockSignal = {
  productId: string;
  productName: string;
  state: string;
  stock: number;
  warehouseStock?: number;
  totalAvailableStock?: number;
  recentUnits: number;
  openOrders: number;
  daysCover?: number;
  lookbackDays?: number;
  severity: "stockout" | "critical" | "watch";
  salesRepRecipientIds?: string[];
};

const smartStockSeverityRank: Record<SmartStockSignal["severity"], number> = {
  stockout: 3,
  critical: 2,
  watch: 1
};

const smartStockDigestCacheKey = (orgId: string, recipientId: string, dayKey: string) =>
  `${orgId}::${recipientId}::${dayKey}::${SMART_STOCK_DIGEST_TITLE}`;

const reserveSmartStockDigest = (key: string) => {
  const now = Date.now();
  for (const [cachedKey, expiresAt] of smartStockDigestCache) {
    if (expiresAt <= now) smartStockDigestCache.delete(cachedKey);
  }
  const expiresAt = smartStockDigestCache.get(key);
  if (expiresAt && expiresAt > now) return false;
  smartStockDigestCache.set(key, now + SMART_STOCK_DIGEST_CACHE_TTL_MS);
  return true;
};

const smartStockDigestMessage = (signals: SmartStockSignal[]) => {
  const sorted = [...signals].sort((a, b) =>
    smartStockSeverityRank[b.severity] - smartStockSeverityRank[a.severity]
    || b.openOrders - a.openOrders
    || b.recentUnits - a.recentUnits
    || a.stock - b.stock
  );
  const stockoutCount = sorted.filter((signal) => signal.severity === "stockout").length;
  const criticalCount = sorted.filter((signal) => signal.severity === "critical").length;
  const watchCount = sorted.filter((signal) => signal.severity === "watch").length;
  const totalOpenOrders = sorted.reduce((sum, signal) => sum + signal.openOrders, 0);
  const lookbackDays = Math.max(1, Math.round(sorted[0]?.lookbackDays ?? 7));
  const headline = stockoutCount > 0
    ? `${stockoutCount} serviceable stock risk${stockoutCount === 1 ? "" : "s"} need attention now`
    : criticalCount > 0
      ? `${criticalCount} critical fast-moving stock coverage risk${criticalCount === 1 ? "" : "s"}`
      : `${watchCount} moving stock coverage item${watchCount === 1 ? "" : "s"} to watch`;
  const topLines = sorted.slice(0, 3).map((signal) => {
    const warehouse = Number(signal.warehouseStock ?? 0);
    const cover = Number.isFinite(signal.daysCover)
      ? `${Math.max(0, Math.ceil(Number(signal.daysCover)))}d service cover`
      : "cover unknown";
    const open = signal.openOrders > 0 ? `, ${signal.openOrders} open` : "";
    const warehouseText = signal.stock <= 0 && warehouse > 0
      ? `, ${warehouse} warehouse reserve`
      : "";
    return `${signal.productName} for ${signal.state}: ${signal.stock} serviceable with covered agents${warehouseText}, ${signal.recentUnits} ordered/${lookbackDays}d, ${cover}${open}`;
  });
  const remaining = sorted.length > topLines.length
    ? ` +${sorted.length - topLines.length} more in Inventory Dashboard.`
    : "";
  const openText = totalOpenOrders > 0
    ? ` ${totalOpenOrders} open order${totalOpenOrders === 1 ? "" : "s"} may need serviceable agent stock when confirmed/delivered.`
    : "";
  return `${headline}.${openText} ${topLines.join(" • ")}${remaining}`.trim();
};

router.get("/", async (req, res) => {
  // Return org-wide notifications (recipient_id IS NULL) + those addressed to this user
  const scope = scopeOf(req);
  // Over-fetch, then drop what this role has no business reading, then take
  // the page. Filtering after a LIMIT 100 would hand a restricted role a short
  // list; filtering before it keeps the page full of things they can act on.
  const { data, error } = await supabase
    .from("system_notifications")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .or(`recipient_id.is.null,recipient_id.eq.${scope.id}`)
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) { res.status(500).json({ error: error.message }); return; }
  const visible = (data ?? []).filter((row: any) =>
    // Anything addressed to this person specifically was already a decision to
    // send it to them; only the org-wide broadcast needs an audience check.
    row.recipient_id ? true : notificationReachesRole(row.title ?? null, row.type ?? null, scope.role)
  ).slice(0, 100);
  res.json(visible);
});

// Create notification
router.post("/", async (req, res) => {
  const Schema = z.object({
    type:      z.enum(["low_stock", "remittance_overdue", "info", "order_new", "order_confirmed", "order_delivered", "order_cancelled", "order_failed", "order_rescheduled", "order_assigned", "order_follow_up", "needs_attention"]),
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
    warehouseStock: z.number().int().min(0).optional(),
    totalAvailableStock: z.number().int().min(0).optional(),
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

  const signalsByRecipient = new Map<string, { role: string; signals: SmartStockSignal[] }>();

  for (const signal of parsed.data.signals) {
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
      const group = signalsByRecipient.get(recipientId) ?? { role, signals: [] };
      group.signals.push(signal);
      signalsByRecipient.set(recipientId, group);
    }
  }

  if (signalsByRecipient.size === 0) {
    res.json([]);
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = today.toISOString().slice(0, 10);
  const candidateRows = [...signalsByRecipient.entries()].map(([recipientId, group]) => {
    const sortedSignals = [...group.signals].sort((a, b) =>
      smartStockSeverityRank[b.severity] - smartStockSeverityRank[a.severity]
      || b.openOrders - a.openOrders
      || b.recentUnits - a.recentUnits
      || a.stock - b.stock
    );
    const primarySignal = sortedSignals[0];
    return {
      org_id: req.user!.orgId,
      recipient_id: recipientId,
      type: "low_stock" as const,
      title: SMART_STOCK_DIGEST_TITLE,
      message: smartStockDigestMessage(sortedSignals),
      link: group.role === "Sales Rep" ? "/dashboard/sales-rep/notifications" : "/dashboard/admin/inventory/state-stock",
      product_id: primarySignal.productId,
      read: false
    };
  });
  const recipientIds = candidateRows.map((row) => row.recipient_id);
  const { data: existing, error: existingError } = await supabase
    .from("system_notifications")
    .select("recipient_id, title")
    .eq("org_id", req.user!.orgId)
    .eq("type", "low_stock")
    .eq("title", SMART_STOCK_DIGEST_TITLE)
    .gte("created_at", today.toISOString())
    .in("recipient_id", recipientIds);

  if (existingError) {
    res.status(500).json({ error: existingError.message });
    return;
  }

  const existingKeys = new Set((existing ?? []).map((row) => smartStockDigestCacheKey(req.user!.orgId, row.recipient_id ?? "", todayKey)));
  const seenKeys = new Set<string>();
  const reservedKeys: string[] = [];
  const rows = candidateRows.filter((row) => {
    const key = smartStockDigestCacheKey(req.user!.orgId, row.recipient_id, todayKey);
    if (existingKeys.has(key) || seenKeys.has(key) || !reserveSmartStockDigest(key)) return false;
    seenKeys.add(key);
    reservedKeys.push(key);
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
    reservedKeys.forEach((key) => smartStockDigestCache.delete(key));
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
        tag: `smart-stock-digest-${todayKey}-${titleSlug(row.title)}`,
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
    .or(`recipient_id.is.null,recipient_id.eq.${req.user!.effectiveUserId ?? req.user!.id}`);
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
    .or(`recipient_id.is.null,recipient_id.eq.${req.user!.effectiveUserId ?? req.user!.id}`);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
