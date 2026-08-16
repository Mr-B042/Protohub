import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";
import { addDaysToDateKey, lagosDateKey } from "../lib/sales-bonus-engine.js";
import { incrementalRevenueForOrder, type HeadOfSalesOrder } from "../lib/head-of-sales-metrics.js";

const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin", "Manager", "Sales Closer"));

const SUPERVISOR_ROLES = new Set(["Owner", "Admin", "Manager"]);
// Statuses a lead has "at least reached", approximated from its single
// current status field - the schema has no per-transition history, so a
// lead that went new_lead -> contacted -> not_interested is indistinguishable
// from one that skipped straight to not_interested. Reasonable proxy for a
// funnel view, not a true reached-this-stage-ever log.
const REACHED_CONTACTED = new Set(["contacted", "qualified", "follow_up", "order_created"]);
const REACHED_QUALIFIED = new Set(["qualified", "follow_up", "order_created"]);

const LeadFields = z.object({
  fullName: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(5).max(32),
  alternatePhone: z.string().trim().max(32).optional(),
  whatsappNumber: z.string().trim().max(32).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  preferredContactMethod: z.enum(["whatsapp", "call", "sms", "email"]).default("whatsapp"),
  state: z.string().trim().max(80).optional(),
  city: z.string().trim().max(120).optional(),
  address: z.string().trim().max(400).optional(),
  source: z.enum(["whatsapp", "instagram", "tiktok", "facebook", "website", "phone", "referral", "other"]).default("whatsapp"),
  campaign: z.string().trim().max(200).optional(),
  interestedProductIds: z.array(z.string().uuid()).max(20).default([]),
  packageId: z.string().uuid().optional(),
  notes: z.string().trim().max(500).optional(),
  status: z.enum(["new_lead", "contacted", "qualified", "follow_up", "order_created", "not_interested"]).default("new_lead"),
  tags: z.array(z.string().trim().max(40)).max(10).default([]),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  assignedCloserId: z.string().uuid().optional(),
  followUpAt: z.string().datetime().optional(),
  // Set once, by Convert to Order (never by the Add Lead / edit form).
  convertedOrderId: z.string().min(1).max(50).optional(),
  convertedAt: z.string().datetime().optional()
}).strict();

const CreateSchema = LeadFields;
const PatchSchema = LeadFields.partial().strict();

const rowToApi = (row: any) => ({
  id: row.id,
  fullName: row.full_name,
  phone: row.phone,
  alternatePhone: row.alternate_phone ?? "",
  whatsappNumber: row.whatsapp_number ?? "",
  email: row.email ?? "",
  preferredContactMethod: row.preferred_contact_method,
  state: row.state ?? "",
  city: row.city ?? "",
  address: row.address ?? "",
  source: row.source,
  campaign: row.campaign ?? "",
  interestedProductIds: Array.isArray(row.interested_product_ids) ? row.interested_product_ids : [],
  packageId: row.package_id,
  notes: row.notes ?? "",
  status: row.status,
  tags: Array.isArray(row.tags) ? row.tags : [],
  priority: row.priority,
  assignedCloserId: row.assigned_closer_id,
  followUpAt: row.follow_up_at,
  convertedOrderId: row.converted_order_id,
  convertedAt: row.converted_at,
  lastActivityAt: row.last_activity_at,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

type LeadFieldValues = {
  fullName: string;
  phone: string;
  alternatePhone?: string;
  whatsappNumber?: string;
  email?: string;
  preferredContactMethod: string;
  state?: string;
  city?: string;
  address?: string;
  source: string;
  campaign?: string;
  interestedProductIds: string[];
  packageId?: string;
  notes?: string;
  status: string;
  tags: string[];
  priority: string;
  assignedCloserId?: string;
  followUpAt?: string;
  convertedOrderId?: string;
  convertedAt?: string;
};

const rowPayload = (value: LeadFieldValues, req: any) => ({
  org_id: req.user.orgId,
  full_name: value.fullName,
  phone: value.phone,
  alternate_phone: value.alternatePhone || null,
  whatsapp_number: value.whatsappNumber || null,
  email: value.email || null,
  preferred_contact_method: value.preferredContactMethod,
  state: value.state || null,
  city: value.city || null,
  address: value.address || null,
  source: value.source,
  campaign: value.campaign || null,
  interested_product_ids: value.interestedProductIds,
  package_id: value.packageId || null,
  notes: value.notes || null,
  status: value.status,
  tags: value.tags,
  priority: value.priority,
  assigned_closer_id: value.assignedCloserId || null,
  follow_up_at: value.followUpAt || null,
  converted_order_id: value.convertedOrderId || null,
  converted_at: value.convertedAt || null,
  updated_at: new Date().toISOString()
});

router.get("/", async (req, res) => {
  try {
    const scope = scopeOf(req);
    let query = supabase
      .from("sales_leads")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .order("created_at", { ascending: false });
    if (!SUPERVISOR_ROLES.has(scope.role)) {
      query = query.or(`assigned_closer_id.eq.${scope.id},assigned_closer_id.is.null`);
    }
    if (typeof req.query.status === "string" && req.query.status !== "all") {
      query = query.eq("status", req.query.status);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json({ leads: (data ?? []).map(rowToApi) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load leads." });
  }
});

async function productNameMap(orgId: string) {
  const { data } = await supabase.from("products").select("id, name").eq("org_id", orgId);
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

function productNamesFor(ids: unknown, names: Map<string, string>) {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => names.get(id))
    .filter((name): name is string => Boolean(name));
}

// Routes below must stay ahead of GET /:id and PATCH /:id or Express would
// try to match "overview"/"follow-ups" as a lead id.
router.get("/overview", async (req, res) => {
  try {
    const scope = scopeOf(req);
    const orgId = req.user!.orgId;
    const today = lagosDateKey();
    const yesterday = addDaysToDateKey(today, -1);

    // "My" overview - scoped strictly to leads/orders this closer owns, not
    // the broader own-plus-unassigned set GET / shows for picking up work.
    const [{ data: leadRows, error: leadError }, { data: orderRows, error: orderError }, names] = await Promise.all([
      supabase.from("sales_leads").select("*").eq("org_id", orgId).eq("assigned_closer_id", scope.id),
      supabase.from("orders").select("id, status, amount, quantity, created_at, delivered_date, upsell_from_qty, upsell_to_qty, original_amount, original_quantity, cross_sell_lines")
        .eq("org_id", orgId).eq("closed_by_closer_id", scope.id),
      productNameMap(orgId)
    ]);
    if (leadError) throw leadError;
    if (orderError) throw orderError;
    const leads = leadRows ?? [];
    const orders = (orderRows ?? []) as HeadOfSalesOrder[];

    const countOn = (day: string, predicate: (lead: any) => boolean) =>
      leads.filter((lead) => predicate(lead) && lagosDateKey(lead.created_at) === day).length;
    // Approximated from last_activity_at (any edit bumps it, not only a
    // status change) since there is no per-transition history to read a
    // true "became Contacted today" count from.
    const countActiveOn = (day: string, statuses: Set<string>) =>
      leads.filter((lead) => statuses.has(lead.status) && lagosDateKey(lead.last_activity_at) === day).length;
    const ordersOn = (day: string) => orders.filter((order) => order.created_at && lagosDateKey(order.created_at) === day).length;
    const deliveredOn = (day: string) => orders.filter((order) => order.status === "Delivered" && order.delivered_date && String(order.delivered_date).slice(0, 10) === day).length;

    const kpi = (todayCount: number, yesterdayCount: number) => ({ value: todayCount, deltaVsYesterday: todayCount - yesterdayCount });

    const funnelNewLeads = leads.length;
    const funnelContacted = leads.filter((lead) => REACHED_CONTACTED.has(lead.status)).length;
    const funnelQualified = leads.filter((lead) => REACHED_QUALIFIED.has(lead.status)).length;
    const funnelOrdersCreated = leads.filter((lead) => Boolean(lead.converted_order_id)).length;
    const deliveredOrderIds = new Set(orders.filter((order) => order.status === "Delivered").map((order) => order.id));
    const funnelDelivered = leads.filter((lead) => lead.converted_order_id && deliveredOrderIds.has(lead.converted_order_id)).length;

    const pct = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

    const monthStart = `${today.slice(0, 7)}-01`;
    const monthLeads = leads.filter((lead) => lead.created_at && lagosDateKey(lead.created_at) >= monthStart);
    const monthOrders = orders.filter((order) => order.created_at && lagosDateKey(order.created_at) >= monthStart);
    const monthDelivered = monthOrders.filter((order) => order.status === "Delivered");
    const monthDeliveredRevenue = monthDelivered.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
    const monthIncremental = monthDelivered.reduce((sum, order) => {
      const { upsell, crossSell } = incrementalRevenueForOrder(order);
      return { upsell: sum.upsell + upsell, crossSell: sum.crossSell + crossSell };
    }, { upsell: 0, crossSell: 0 });

    const followUpsDue = leads
      .filter((lead) => lead.follow_up_at && !["order_created", "not_interested"].includes(lead.status) && lead.follow_up_at <= new Date(Date.now() + 86_400_000).toISOString())
      .sort((a, b) => String(a.follow_up_at).localeCompare(String(b.follow_up_at)))
      .slice(0, 6)
      .map((lead) => ({ id: lead.id, fullName: lead.full_name, productNames: productNamesFor(lead.interested_product_ids, names), followUpAt: lead.follow_up_at }));

    const recentLeads = [...leads]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 6)
      .map((lead) => ({ id: lead.id, fullName: lead.full_name, productNames: productNamesFor(lead.interested_product_ids, names), source: lead.source, status: lead.status, createdAt: lead.created_at }));

    res.json({
      kpis: {
        newLeads: kpi(countOn(today, () => true), countOn(yesterday, () => true)),
        contacted: kpi(countActiveOn(today, REACHED_CONTACTED), countActiveOn(yesterday, REACHED_CONTACTED)),
        qualified: kpi(countActiveOn(today, REACHED_QUALIFIED), countActiveOn(yesterday, REACHED_QUALIFIED)),
        ordersCreated: kpi(ordersOn(today), ordersOn(yesterday)),
        delivered: kpi(deliveredOn(today), deliveredOn(yesterday))
      },
      funnel: { newLeads: funnelNewLeads, contacted: funnelContacted, qualified: funnelQualified, ordersCreated: funnelOrdersCreated, delivered: funnelDelivered },
      conversionRates: {
        leadToOrder: pct(funnelOrdersCreated, funnelNewLeads),
        leadToDelivered: pct(funnelDelivered, funnelNewLeads),
        orderConversionRate: pct(funnelDelivered, funnelOrdersCreated)
      },
      followUpsDue,
      performanceThisMonth: {
        leads: monthLeads.length,
        ordersCreated: monthOrders.length,
        deliveredOrders: monthDelivered.length,
        deliveryRate: pct(monthDelivered.length, monthOrders.length),
        aovDelivered: monthDelivered.length > 0 ? Math.round(monthDeliveredRevenue / monthDelivered.length) : 0,
        deliveredRevenue: monthDeliveredRevenue,
        upsellRevenue: Math.round(monthIncremental.upsell),
        crossSellRevenue: Math.round(monthIncremental.crossSell)
      },
      recentLeads
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load the overview." });
  }
});

router.get("/follow-ups", async (req, res) => {
  try {
    const scope = scopeOf(req);
    const orgId = req.user!.orgId;
    const today = lagosDateKey();
    const names = await productNameMap(orgId);
    const { data, error } = await supabase.from("sales_leads").select("*").eq("org_id", orgId).eq("assigned_closer_id", scope.id);
    if (error) throw error;
    const leads = data ?? [];
    const withFollowUp = leads.filter((lead) => lead.follow_up_at);
    const dueToday = withFollowUp.filter((lead) => lagosDateKey(lead.follow_up_at) === today && !["order_created", "not_interested"].includes(lead.status));
    const overdue = withFollowUp.filter((lead) => lagosDateKey(lead.follow_up_at) < today && !["order_created", "not_interested"].includes(lead.status));
    const dueThisWeek = withFollowUp.filter((lead) => {
      const day = lagosDateKey(lead.follow_up_at);
      return day >= today && day <= addDaysToDateKey(today, 6) && !["order_created", "not_interested"].includes(lead.status);
    });
    const converted = withFollowUp.filter((lead) => lead.status === "order_created");
    res.json({
      kpis: {
        totalFollowUps: withFollowUp.filter((lead) => !["order_created", "not_interested"].includes(lead.status)).length,
        dueToday: dueToday.length,
        dueThisWeek: dueThisWeek.length,
        overdue: overdue.length,
        converted: converted.length
      },
      rows: withFollowUp
        .sort((a, b) => String(a.follow_up_at).localeCompare(String(b.follow_up_at)))
        .map((lead) => ({
          id: lead.id,
          fullName: lead.full_name,
          phone: lead.phone,
          whatsappNumber: lead.whatsapp_number,
          productNames: productNamesFor(lead.interested_product_ids, names),
          source: lead.source,
          status: lead.status,
          priority: lead.priority,
          followUpAt: lead.follow_up_at,
          lastActivityAt: lead.last_activity_at,
          overdue: lagosDateKey(lead.follow_up_at) < today && !["order_created", "not_interested"].includes(lead.status)
        }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load follow-ups." });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const scope = scopeOf(req);
    const { data, error } = await supabase
      .from("sales_leads")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: "Lead not found." });
      return;
    }
    if (!SUPERVISOR_ROLES.has(scope.role) && data.assigned_closer_id && data.assigned_closer_id !== scope.id) {
      res.status(403).json({ error: "This lead is assigned to another closer." });
      return;
    }
    res.json(rowToApi(data));
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load this lead." });
  }
});

router.post("/", async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  try {
    const scope = scopeOf(req);
    // A Sales Closer logging her own lead always owns it - only leadership
    // can hand a new lead straight to someone else.
    const assignedCloserId = SUPERVISOR_ROLES.has(scope.role)
      ? (parsed.data.assignedCloserId || null)
      : scope.id;
    const { data, error } = await supabase
      .from("sales_leads")
      .insert({
        ...rowPayload(parsed.data, req),
        assigned_closer_id: assignedCloserId,
        created_by: req.user!.id
      })
      .select("*")
      .single();
    if (error) throw error;
    res.status(201).json(rowToApi(data));
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not create this lead." });
  }
});

router.patch("/:id", async (req, res) => {
  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  try {
    const scope = scopeOf(req);
    const { data: existing, error: existingError } = await supabase
      .from("sales_leads")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .eq("id", req.params.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) {
      res.status(404).json({ error: "Lead not found." });
      return;
    }
    if (!SUPERVISOR_ROLES.has(scope.role) && existing.assigned_closer_id && existing.assigned_closer_id !== scope.id) {
      res.status(403).json({ error: "This lead is assigned to another closer." });
      return;
    }
    // existing.* comes straight from the DB (already valid, already
    // trusted) - only the incoming body needs Zod's scrutiny, which
    // already happened via PatchSchema.safeParse above. Re-running trusted
    // values like follow_up_at back through LeadFields would reject them:
    // Postgres returns timestamptz as "+00:00", not the "Z" suffix
    // z.string().datetime() requires by default.
    const merged: LeadFieldValues = {
      fullName: existing.full_name,
      phone: existing.phone,
      alternatePhone: existing.alternate_phone ?? undefined,
      whatsappNumber: existing.whatsapp_number ?? undefined,
      email: existing.email ?? undefined,
      preferredContactMethod: existing.preferred_contact_method,
      state: existing.state ?? undefined,
      city: existing.city ?? undefined,
      address: existing.address ?? undefined,
      source: existing.source,
      campaign: existing.campaign ?? undefined,
      interestedProductIds: existing.interested_product_ids ?? [],
      packageId: existing.package_id ?? undefined,
      notes: existing.notes ?? undefined,
      status: existing.status,
      tags: existing.tags ?? [],
      priority: existing.priority,
      assignedCloserId: existing.assigned_closer_id ?? undefined,
      followUpAt: existing.follow_up_at ?? undefined,
      convertedOrderId: existing.converted_order_id ?? undefined,
      convertedAt: existing.converted_at ?? undefined,
      ...parsed.data
    };
    const { data, error } = await supabase
      .from("sales_leads")
      .update({ ...rowPayload(merged, req), last_activity_at: new Date().toISOString() })
      .eq("org_id", req.user!.orgId)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    res.json(rowToApi(data));
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not update this lead." });
  }
});

export default router;
