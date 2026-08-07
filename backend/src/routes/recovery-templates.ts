// Reusable recovery offers, call scripts and broadcast messages (migration
// 182), plus the send log that makes offer performance measurable.
//
// Sending itself is NOT reimplemented here - the frontend dispatches through
// the existing WhatsApp custom-send path and calls /record-send so the trail
// is written once, by whoever actually sent it.
import { Router } from "express";
import { humanFieldErrors } from "../lib/validation-message.js";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const TEMPLATES_TABLE = "recovery_templates";
const SENDS_TABLE = "recovery_template_sends";
const READ_ROLES = ["Owner", "Admin", "Manager", "Recovery Rep", "Sales Rep"] as const;
const WRITE_ROLES = ["Owner", "Admin", "Manager"] as const;

function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "42P01"
    || error.code === "PGRST205"
    || /recovery_templates|recovery_template_sends/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
}

const TemplateSchema = z.object({
  kind: z.enum(["offer", "script", "message"]),
  name: z.string().trim().min(1, "Name is required.").max(120),
  body: z.string().trim().min(1, "Body is required.").max(4000),
  offerType: z.enum(["discount_pct", "free_shipping", "bundle", "new_arrival", "other"]).nullable().optional(),
  discountPct: z.number().min(0).max(100).nullable().optional(),
  active: z.boolean().optional()
});

const TemplateUpdateSchema = TemplateSchema.partial();

const RecordSendSchema = z.object({
  templateId: z.string().uuid().nullable().optional(),
  orderId: z.string().trim().min(1).nullable().optional(),
  customerName: z.string().trim().max(200).nullable().optional(),
  customerPhone: z.string().trim().min(1, "Customer phone is required."),
  channel: z.enum(["whatsapp", "sms", "call", "other"]).default("whatsapp")
});

const RecordSendBatchSchema = z.object({ sends: z.array(RecordSendSchema).min(1).max(200) });

const SELECT = "id, kind, name, body, offer_type, discount_pct, active, created_at, updated_at";

const mapTemplate = (row: any) => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  body: row.body,
  offerType: row.offer_type ?? null,
  discountPct: row.discount_pct === null || row.discount_pct === undefined ? null : Number(row.discount_pct),
  active: row.active,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

router.get("/", requireRole(...READ_ROLES), async (req, res) => {
  try {
    const kind = typeof req.query.kind === "string" ? req.query.kind : null;
    let query = supabase.from(TEMPLATES_TABLE).select(SELECT).eq("org_id", req.user!.orgId).order("name");
    if (kind) query = query.eq("kind", kind);
    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error)) { res.json({ rows: [], pendingMigration: true }); return; }
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ rows: (data ?? []).map(mapTemplate) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load templates." });
  }
});

router.post("/", requireRole(...WRITE_ROLES), async (req, res) => {
  const parsed = TemplateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const { data, error } = await supabase.from(TEMPLATES_TABLE).insert({
      org_id: req.user!.orgId,
      kind: parsed.data.kind,
      name: parsed.data.name,
      body: parsed.data.body,
      offer_type: parsed.data.kind === "offer" ? (parsed.data.offerType ?? "other") : null,
      discount_pct: parsed.data.kind === "offer" ? (parsed.data.discountPct ?? null) : null,
      active: parsed.data.active ?? true,
      created_by: req.user!.id
    }).select(SELECT).single();
    if (error) {
      if (isMissingTable(error)) { res.status(503).json({ error: "Recovery templates are still being activated on this environment." }); return; }
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({ row: mapTemplate(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not create the template." });
  }
});

router.patch("/:id", requireRole(...WRITE_ROLES), async (req, res) => {
  const parsed = TemplateUpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.body !== undefined) patch.body = parsed.data.body;
    if (parsed.data.offerType !== undefined) patch.offer_type = parsed.data.offerType;
    if (parsed.data.discountPct !== undefined) patch.discount_pct = parsed.data.discountPct;
    if (parsed.data.active !== undefined) patch.active = parsed.data.active;
    const { data, error } = await supabase.from(TEMPLATES_TABLE)
      .update(patch).eq("org_id", req.user!.orgId).eq("id", req.params.id).select(SELECT).single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "Template not found." }); return; }
    res.json({ row: mapTemplate(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not update the template." });
  }
});

// Deactivate rather than delete: send-log rows reference the template, and a
// past send should keep showing what was actually sent.
router.delete("/:id", requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { error } = await supabase.from(TEMPLATES_TABLE)
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("org_id", req.user!.orgId).eq("id", req.params.id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true, deactivated: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not deactivate the template." });
  }
});

// Insert-only audit rows. Accepts a batch so a broadcast writes its trail in
// one round trip after the messages themselves have gone out.
router.post("/record-send", requireRole(...READ_ROLES), async (req, res) => {
  const single = RecordSendSchema.safeParse(req.body);
  const batch = RecordSendBatchSchema.safeParse(req.body);
  const sends = batch.success ? batch.data.sends : single.success ? [single.data] : null;
  if (!sends) {
    res.status(400).json({ error: (single.error ?? batch.error)?.flatten().fieldErrors ?? "Invalid payload." });
    return;
  }
  try {
    const rows = sends.map((s) => ({
      org_id: req.user!.orgId,
      template_id: s.templateId ?? null,
      order_id: s.orderId ?? null,
      customer_name: s.customerName ?? null,
      customer_phone: s.customerPhone,
      channel: s.channel,
      sent_by: req.user!.id
    }));
    const { data, error } = await supabase.from(SENDS_TABLE).insert(rows).select("id");
    if (error) {
      if (isMissingTable(error)) { res.status(503).json({ error: "Recovery templates are still being activated on this environment." }); return; }
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({ recorded: (data ?? []).length });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not record the send." });
  }
});

// Offer performance: how often each offer went out, and what the customers
// who received it went on to spend. Revenue is attributed only through a real
// delivered order placed AFTER the send, never assumed from the send itself.
router.get("/usage", requireRole(...READ_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const { data: sends, error } = await supabase
      .from(SENDS_TABLE)
      .select("template_id, customer_phone, sent_at, resulting_order_id")
      .eq("org_id", orgId)
      .order("sent_at", { ascending: false })
      .limit(2000);
    if (error) {
      if (isMissingTable(error)) { res.json({ rows: [], pendingMigration: true }); return; }
      res.status(500).json({ error: error.message });
      return;
    }
    const sendRows = sends ?? [];
    if (sendRows.length === 0) { res.json({ rows: [] }); return; }

    const { data: templates } = await supabase.from(TEMPLATES_TABLE).select("id, name, kind").eq("org_id", orgId);
    const nameById = new Map((templates ?? []).map((t: any) => [t.id, { name: t.name, kind: t.kind }]));

    // Delivered orders for the recipients, so "did this offer earn anything"
    // is answered by a real order that came after the message.
    const phones = [...new Set(sendRows.map((s: any) => String(s.customer_phone).replace(/\D/g, "")).filter(Boolean))];
    const { data: orders } = phones.length
      ? await supabase.from("orders").select("id, phone, amount, delivered_date, status").eq("org_id", orgId).eq("status", "Delivered")
      : { data: [] as any[] };
    const ordersByPhone = new Map<string, Array<{ amount: number; delivered: string }>>();
    for (const o of (orders ?? []) as any[]) {
      const key = String(o.phone ?? "").replace(/\D/g, "");
      if (!key) continue;
      if (!ordersByPhone.has(key)) ordersByPhone.set(key, []);
      ordersByPhone.get(key)!.push({ amount: Number(o.amount ?? 0), delivered: String(o.delivered_date ?? "") });
    }

    const agg = new Map<string, { templateId: string; name: string; kind: string; sends: number; conversions: number; revenue: number }>();
    for (const s of sendRows as any[]) {
      const id = s.template_id ?? "none";
      const meta = nameById.get(s.template_id) ?? { name: "Ad-hoc message", kind: "message" };
      if (!agg.has(id)) agg.set(id, { templateId: id, name: meta.name, kind: meta.kind, sends: 0, conversions: 0, revenue: 0 });
      const row = agg.get(id)!;
      row.sends += 1;
      const key = String(s.customer_phone).replace(/\D/g, "");
      const sentDay = String(s.sent_at).slice(0, 10);
      const after = (ordersByPhone.get(key) ?? []).filter((o) => o.delivered && o.delivered >= sentDay);
      if (after.length > 0) {
        row.conversions += 1;
        row.revenue += after.reduce((sum, o) => sum + o.amount, 0);
      }
    }
    const rows = [...agg.values()]
      .map((r) => ({ ...r, conversionPct: r.sends > 0 ? Math.round((r.conversions / r.sends) * 1000) / 10 : 0 }))
      .sort((a, b) => b.revenue - a.revenue || b.sends - a.sends);
    res.json({ rows });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load template usage." });
  }
});

export default router;
