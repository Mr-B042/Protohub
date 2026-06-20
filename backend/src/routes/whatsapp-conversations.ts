import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { sendConnectedWhatsApp, ensureWhatsAppReady } from "../lib/whatsapp-runtime.js";

const router = Router();
router.use(requireAuth);

const normalizeDigits = (v: string) => v.replace(/\D/g, "");

// Normalize Nigerian phone numbers to WhatsApp format (234XXXXXXXXXX).
// Handles: 0812..., 812..., +234812..., 234812... all → 234812...
function normalizeNgPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (!d) return d;
  if (d.startsWith("234") && d.length >= 13) return d;
  if (d.startsWith("0") && d.length === 11) return `234${d.slice(1)}`;
  if (!d.startsWith("0") && d.length === 10) return `234${d}`;
  if (d.length >= 11) return d; // other international
  return d;
}

// ── GET /api/whatsapp/conversations ─────────────────────────────────────────
// List conversations grouped by customer phone.
// Owner/Admin: all conversations.
// Sales Rep/Manager: only where linked_order is assigned to them (or their team).
router.get("/", async (req, res) => {
  const role = req.user!.effectiveUserRole ?? req.user!.role;
  const userId = req.user!.effectiveUserId ?? req.user!.id;
  const orgId = req.user!.orgId;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));

  try {
    // Get the most recent message per normalized_phone using a window approach:
    // Fetch all messages, group client-side (simpler than complex Supabase aggregation)
    let query = supabase
      .from("whatsapp_inbox_messages")
      .select("id, normalized_phone, sender_phone, sender_name, body, direction, linked_order_id, received_at, sent_at, sent_by_name, read_at, message_type")
      .eq("org_id", orgId)
      .order("received_at", { ascending: false })
      .limit(2000); // fetch enough to build conversation list

    // Sales Reps + Managers: scope to their assigned orders' phones only.
    // Owner/Admin see all conversations.
    if (role === "Sales Rep" || role === "Manager") {
      const repFilter = supabase
        .from("orders")
        .select("phone")
        .eq("org_id", orgId)
        .not("phone", "is", null);

      // Sales Rep → their directly assigned orders only
      // Manager → orders assigned to anyone in their team
      // For simplicity we scope Manager to same as rep for now (their direct assigns)
      const filteredRepOrders = await repFilter.eq("assigned_rep_id", userId);

      const myOrders = filteredRepOrders.data ?? [];

      // Normalize all phones to 234-prefixed format so they match the inbox table
      const myPhones = Array.from(new Set(
        myOrders
          .map((o: any) => normalizeNgPhone(o.phone ?? ""))
          .filter((p) => p.length >= 10)
      ));

      if (myPhones.length === 0) { res.json({ conversations: [] }); return; }
      // Also require a linked_order so random people who text the org number never appear
      query = query.in("normalized_phone", myPhones).not("linked_order_id", "is", null);
    }

    const { data: messages, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }

    // Group by normalized_phone → pick latest message per thread
    const threadMap = new Map<string, any>();
    for (const msg of (messages ?? [])) {
      const phone = msg.normalized_phone;
      if (!threadMap.has(phone)) {
        threadMap.set(phone, {
          normalizedPhone: phone,
          senderPhone: msg.sender_phone,
          customerName: msg.sender_name ?? null,
          lastMessage: msg.body,
          lastMessageAt: msg.received_at,
          lastDirection: msg.direction,
          linkedOrderId: msg.linked_order_id ?? null,
          unreadCount: 0
        });
      }
      // Count unread inbound
      if (msg.direction === "inbound" && !msg.read_at) {
        threadMap.get(phone)!.unreadCount += 1;
      }
    }

    // Enrich with order customer name where available
    const orderIds = [...threadMap.values()].map(t => t.linkedOrderId).filter(Boolean);
    if (orderIds.length > 0) {
      const { data: orders } = await supabase
        .from("orders")
        .select("id, customer, phone, assigned_rep_id")
        .eq("org_id", orgId)
        .in("id", orderIds);
      const orderMap = new Map((orders ?? []).map((o: any) => [o.id, o]));
      for (const thread of threadMap.values()) {
        if (thread.linkedOrderId) {
          const ord = orderMap.get(thread.linkedOrderId);
          if (ord) {
            if (!thread.customerName) thread.customerName = ord.customer;
            thread.assignedRepId = ord.assigned_rep_id ?? null;
          }
        }
      }
    }

    const conversations = [...threadMap.values()]
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
      .slice(0, limit);

    res.json({ conversations });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Could not load conversations." });
  }
});

// ── GET /api/whatsapp/conversations/:phone ───────────────────────────────────
// Full thread for a customer phone number.
router.get("/:phone", async (req, res) => {
  const orgId = req.user!.orgId;
  const role = req.user!.effectiveUserRole ?? req.user!.role;
  const userId = req.user!.effectiveUserId ?? req.user!.id;
  const normalizedPhone = normalizeNgPhone(req.params["phone"] ?? "");
  if (!normalizedPhone) { res.status(400).json({ error: "Invalid phone." }); return; }

  try {
    // Rep/Manager scope check — verify the requested phone belongs to one of their assigned orders
    if (role === "Sales Rep" || role === "Manager") {
      const { data: assignedOrders } = await supabase
        .from("orders").select("phone").eq("org_id", orgId).eq("assigned_rep_id", userId);
      const myPhones = new Set(
        (assignedOrders ?? []).map((o: any) => normalizeNgPhone(o.phone ?? "")).filter((p) => p.length >= 10)
      );
      if (!myPhones.has(normalizedPhone)) {
        res.status(403).json({ error: "Not your assigned customer." }); return;

      }
    }

    const { data: messages, error } = await supabase
      .from("whatsapp_inbox_messages")
      .select("id, normalized_phone, sender_phone, sender_name, body, direction, linked_order_id, received_at, sent_at, sent_by_name, sent_by_user_id, read_at, message_type, metadata")
      .eq("org_id", orgId)
      .eq("normalized_phone", normalizedPhone)
      .order("received_at", { ascending: true })
      .limit(200);

    if (error) { res.status(500).json({ error: error.message }); return; }

    // Count unread BEFORE marking as read — frontend uses this to place the divider
    const unreadCount = (messages ?? []).filter(m => m.direction === "inbound" && !m.read_at).length;

    // Mark all inbound as read
    await supabase.from("whatsapp_inbox_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("normalized_phone", normalizedPhone)
      .eq("direction", "inbound")
      .is("read_at", null)
      .then(() => undefined, () => undefined);

    // Get linked order details
    const linkedOrderId = [...(messages ?? [])].reverse().find(m => m.linked_order_id)?.linked_order_id ?? null;
    let linkedOrder = null;
    if (linkedOrderId) {
      const { data: ord } = await supabase
        .from("orders")
        .select("id, customer, phone, status, product_name, package_name, amount, currency, assigned_rep_id")
        .eq("org_id", orgId)
        .eq("id", linkedOrderId)
        .maybeSingle();
      linkedOrder = ord ?? null;
    }

    res.json({ messages: messages ?? [], linkedOrder, unreadCount });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Could not load thread." });
  }
});

// ── POST /api/whatsapp/conversations/:phone/send ─────────────────────────────
// Rep sends a message via the org automation account.
const SendSchema = z.object({
  body: z.string().trim().min(1).max(4096),
  linkedOrderId: z.string().nullable().optional(),
  fallbackPhone: z.string().nullable().optional() // alternate number to try if primary isn't on WA
});

// Check if a normalized phone is registered on WhatsApp via the live socket.
// Returns the confirmed JID digits if registered, null otherwise.
// Build all plausible Nigerian number variants for a given input.
// Nigerian operators: 070/071 (9mobile), 080/081 (MTN), 090/091 (Airtel), etc.
// WhatsApp JID always needs the 234 country code.
function ngPhoneVariants(phone: string): string[] {
  const d = phone.replace(/\D/g, "");
  const variants: string[] = [];
  // Already international
  if (d.startsWith("234") && d.length >= 13) { variants.push(d); }
  // 0XXXXXXXXXX (11 digits) → 234XXXXXXXXXX
  else if (d.startsWith("0") && d.length === 11) { variants.push(`234${d.slice(1)}`); variants.push(d.slice(1)); }
  // XXXXXXXXXX (10 digits) → 234XXXXXXXXXX
  else if (!d.startsWith("0") && d.length === 10) { variants.push(`234${d}`); variants.push(`0${d}`); }
  else { variants.push(d); }
  return [...new Set(variants)].filter(v => v.length >= 10);
}

async function checkOnWhatsApp(orgId: string, normalizedPhone: string): Promise<string | null> {
  try {
    const socket = await ensureWhatsAppReady(orgId);
    if (!socket) return normalizedPhone; // proceed optimistically if socket unavailable

    // Try all plausible variants of the number (handles 070/080/090 prefixes)
    for (const variant of ngPhoneVariants(normalizedPhone)) {
      const jid = `${variant}@s.whatsapp.net`;
      const results = await (socket as any).onWhatsApp(jid).catch(() => null);
      const hit = Array.isArray(results) ? results[0] : results;
      if (hit?.exists) return normalizeDigits(hit.jid ?? variant);
    }
    return null;
  } catch {
    // If the check errors entirely, proceed optimistically rather than blocking
    return normalizedPhone;
  }
}

router.post("/:phone/send", async (req, res) => {
  const orgId = req.user!.orgId;
  const role = req.user!.effectiveUserRole ?? req.user!.role;
  const userId = req.user!.effectiveUserId ?? req.user!.id;
  const normalizedPhone = normalizeNgPhone(req.params["phone"] ?? "");
  if (!normalizedPhone) { res.status(400).json({ error: "Invalid phone." }); return; }

  const parsed = SendSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }

  // Rep/Manager can only message their assigned customers
  if (role === "Sales Rep" || role === "Manager") {
    const { data: assignedOrders } = await supabase.from("orders").select("phone").eq("org_id", orgId).eq("assigned_rep_id", userId);
    const myPhones = new Set(
      (assignedOrders ?? []).map((o: any) => normalizeNgPhone(o.phone ?? "")).filter((p: string) => p.length >= 10)
    );
    if (!myPhones.has(normalizedPhone)) {
      res.status(403).json({ error: "Not your assigned customer." }); return;
    }
  }

  try {
    // Validate the number is on WhatsApp; try fallback if provided.
    let confirmedPhone = await checkOnWhatsApp(orgId, normalizedPhone);
    let usedFallback = false;

    if (!confirmedPhone) {
      const fallback = normalizeNgPhone(parsed.data.fallbackPhone ?? "");
      if (fallback && fallback !== normalizedPhone) {
        confirmedPhone = await checkOnWhatsApp(orgId, fallback);
        if (confirmedPhone) usedFallback = true;
      }
      if (!confirmedPhone) {
        res.status(422).json({
          error: "NOT_ON_WHATSAPP",
          message: "Neither number is registered on WhatsApp. The customer cannot be reached via WhatsApp.",
          triedPhone: normalizedPhone,
          triedFallback: normalizeDigits(parsed.data.fallbackPhone ?? "") || null
        });
        return;
      }
    }

    // Send via org Baileys socket using the confirmed number
    await sendConnectedWhatsApp(orgId, confirmedPhone, parsed.data.body);

    // Log as outbound in the inbox table
    const now = new Date().toISOString();
    const { data: inserted, error: insertErr } = await supabase
      .from("whatsapp_inbox_messages")
      .insert({
        org_id: orgId,
        provider: "baileys",
        sender_phone: null,
        normalized_phone: normalizedPhone,
        direction: "outbound",
        body: parsed.data.body,
        message_type: "text",
        linked_order_id: parsed.data.linkedOrderId ?? null,
        sent_by_user_id: req.user!.id,
        sent_by_name: req.user!.name,
        received_at: now,
        sent_at: now,
        read_at: now, // outbound is always "read"
        metadata: { sentViaInbox: true, usedFallback, confirmedPhone }
      })
      .select("id")
      .single();

    if (insertErr) {
      res.status(500).json({ error: insertErr.message }); return;
    }

    res.json({ ok: true, id: inserted?.id, confirmedPhone, usedFallback });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Could not send message." });
  }
});

// ── PATCH /api/whatsapp/conversations/:phone/read ────────────────────────────
router.patch("/:phone/read", async (req, res) => {
  const orgId = req.user!.orgId;
  const normalizedPhone = normalizeNgPhone(req.params["phone"] ?? "");
  await supabase.from("whatsapp_inbox_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("normalized_phone", normalizedPhone)
    .eq("direction", "inbound")
    .is("read_at", null)
    .then(() => undefined, () => undefined);
  res.json({ ok: true });
});

export default router;
