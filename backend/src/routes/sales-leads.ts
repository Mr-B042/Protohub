import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";
import { addDaysToDateKey, lagosDateKey } from "../lib/sales-bonus-engine.js";
import { incrementalRevenueForOrder, type HeadOfSalesOrder } from "../lib/head-of-sales-metrics.js";
import { orderInventoryLinesFromRow } from "../lib/order-inventory.js";

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

// A closer only ever sees her own data; leadership may pass ?closerId= to
// review a specific closer's page (the Sales Closers leaderboard drill-in).
function resolveCloserId(req: any): string {
  const scope = scopeOf(req);
  const requested = typeof req.query.closerId === "string" ? req.query.closerId : undefined;
  return SUPERVISOR_ROLES.has(scope.role) && requested ? requested : scope.id;
}

// Routes below must stay ahead of GET /:id and PATCH /:id or Express would
// try to match "overview"/"follow-ups" as a lead id.
router.get("/overview", async (req, res) => {
  try {
    const closerId = resolveCloserId(req);
    const orgId = req.user!.orgId;
    const today = lagosDateKey();
    const yesterday = addDaysToDateKey(today, -1);

    // "My" overview - scoped strictly to leads/orders this closer owns, not
    // the broader own-plus-unassigned set GET / shows for picking up work.
    const [{ data: leadRows, error: leadError }, { data: orderRows, error: orderError }, names] = await Promise.all([
      supabase.from("sales_leads").select("*").eq("org_id", orgId).eq("assigned_closer_id", closerId),
      supabase.from("orders").select("id, status, amount, quantity, created_at, delivered_date, upsell_from_qty, upsell_to_qty, original_amount, original_quantity, cross_sell_lines")
        .eq("org_id", orgId).eq("closed_by_closer_id", closerId),
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

const previousMonthStart = (monthStartKey: string) => {
  const [year, month] = monthStartKey.split("-").map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
};

// Query key is closed_by_closer_id, not assigned_rep_id - this must show
// every order she ever closed permanently, even one later reassigned to a
// different rep for delivery/follow-up handoffs (orders.ts PATCH /:id).
router.get("/orders", async (req, res) => {
  try {
    const closerId = resolveCloserId(req);
    const orgId = req.user!.orgId;
    const today = lagosDateKey();
    const thisMonthStart = `${today.slice(0, 7)}-01`;
    const lastMonthStart = previousMonthStart(thisMonthStart);

    const { data, error } = await supabase
      .from("orders")
      .select("id, customer, product_name, package_name, amount, currency, status, created_at, delivered_date, closed_by_closer_name, upsell_from_qty, upsell_to_qty, original_amount, original_quantity, cross_sell_lines")
      .eq("org_id", orgId)
      .eq("closed_by_closer_id", closerId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const orders = (data ?? []) as (HeadOfSalesOrder & { customer?: string; product_name?: string; package_name?: string; currency?: string; closed_by_closer_name?: string })[];

    const thisMonth = orders.filter((order) => order.created_at && lagosDateKey(order.created_at) >= thisMonthStart);
    const lastMonth = orders.filter((order) => order.created_at && lagosDateKey(order.created_at) >= lastMonthStart && lagosDateKey(order.created_at) < thisMonthStart);
    const deliveredIn = (rows: typeof orders) => rows.filter((order) => order.status === "Delivered");
    const revenueOf = (rows: typeof orders) => rows.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);

    const thisMonthDelivered = deliveredIn(thisMonth);
    const lastMonthDelivered = deliveredIn(lastMonth);
    const thisMonthRevenue = revenueOf(thisMonthDelivered);
    const lastMonthRevenue = revenueOf(lastMonthDelivered);
    const thisMonthAov = thisMonthDelivered.length > 0 ? thisMonthRevenue / thisMonthDelivered.length : 0;
    const lastMonthAov = lastMonthDelivered.length > 0 ? lastMonthRevenue / lastMonthDelivered.length : 0;
    const thisMonthDeliveryRate = thisMonth.length > 0 ? Math.round((thisMonthDelivered.length / thisMonth.length) * 1000) / 10 : 0;
    const lastMonthDeliveryRate = lastMonth.length > 0 ? Math.round((lastMonthDelivered.length / lastMonth.length) * 1000) / 10 : 0;

    const leadsQuery = await supabase.from("sales_leads").select("status, created_at").eq("org_id", orgId).eq("assigned_closer_id", closerId);
    const monthLeads = (leadsQuery.data ?? []).filter((lead) => lead.created_at && lagosDateKey(lead.created_at) >= thisMonthStart);

    const productRevenue = new Map<string, { orders: number; revenue: number }>();
    for (const order of thisMonth) {
      const name = order.product_name ?? "Unknown product";
      const entry = productRevenue.get(name) ?? { orders: 0, revenue: 0 };
      entry.orders += 1;
      entry.revenue += Number(order.amount ?? 0);
      productRevenue.set(name, entry);
    }
    const topProducts = [...productRevenue.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([productName, stats]) => ({ productName, orders: stats.orders, revenue: stats.revenue }));

    res.json({
      kpis: {
        ordersCreated: { value: thisMonth.length, deltaVsLastMonth: thisMonth.length - lastMonth.length },
        deliveredOrders: { value: thisMonthDelivered.length, deltaVsLastMonth: thisMonthDelivered.length - lastMonthDelivered.length },
        deliveredRevenue: { value: thisMonthRevenue, deltaVsLastMonth: thisMonthRevenue - lastMonthRevenue },
        aov: { value: Math.round(thisMonthAov), deltaVsLastMonth: Math.round(thisMonthAov - lastMonthAov) },
        deliveryRate: { value: thisMonthDeliveryRate, deltaVsLastMonth: Math.round((thisMonthDeliveryRate - lastMonthDeliveryRate) * 10) / 10 }
      },
      orders: orders.map((order) => ({
        id: order.id,
        customer: order.customer ?? "",
        productName: order.product_name ?? "",
        packageName: order.package_name ?? "",
        amount: Number(order.amount ?? 0),
        currency: order.currency ?? "NGN",
        status: order.status ?? "New",
        createdAt: order.created_at ?? "",
        closedByCloserName: order.closed_by_closer_name ?? "",
        deliveredDate: order.delivered_date ?? null
      })),
      conversionSummaryThisMonth: {
        leadsCaptured: monthLeads.length,
        ordersCreated: thisMonth.length,
        deliveredOrders: thisMonthDelivered.length,
        leadToOrderRate: monthLeads.length > 0 ? Math.round((thisMonth.length / monthLeads.length) * 1000) / 10 : 0,
        leadToDeliveredRate: monthLeads.length > 0 ? Math.round((thisMonthDelivered.length / monthLeads.length) * 1000) / 10 : 0
      },
      topProducts
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load orders." });
  }
});

router.get("/performance", async (req, res) => {
  try {
    const closerId = resolveCloserId(req);
    const orgId = req.user!.orgId;
    const today = lagosDateKey();
    const rangeStart = addDaysToDateKey(today, -13); // 14-day trend, matches Overview's daily-granularity approach

    const [{ data: leadRows, error: leadError }, { data: orderRows, error: orderError }, names] = await Promise.all([
      supabase.from("sales_leads").select("*").eq("org_id", orgId).eq("assigned_closer_id", closerId),
      supabase.from("orders").select("id, product_name, status, amount, created_at, delivered_date, upsell_from_qty, upsell_to_qty, original_amount, original_quantity, cross_sell_lines")
        .eq("org_id", orgId).eq("closed_by_closer_id", closerId),
      productNameMap(orgId)
    ]);
    if (leadError) throw leadError;
    if (orderError) throw orderError;
    const leads = leadRows ?? [];
    const orders = (orderRows ?? []) as (HeadOfSalesOrder & { product_name?: string })[];

    const funnelNewLeads = leads.length;
    const funnelContacted = leads.filter((lead) => REACHED_CONTACTED.has(lead.status)).length;
    const funnelQualified = leads.filter((lead) => REACHED_QUALIFIED.has(lead.status)).length;
    const funnelOrdersCreated = leads.filter((lead) => Boolean(lead.converted_order_id)).length;
    const deliveredOrderIds = new Set(orders.filter((order) => order.status === "Delivered").map((order) => order.id));
    const funnelDelivered = leads.filter((lead) => lead.converted_order_id && deliveredOrderIds.has(lead.converted_order_id)).length;
    const pct = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

    const trend: Array<{ date: string; leads: number; orders: number }> = [];
    for (let index = 0; index < 14; index += 1) {
      const day = addDaysToDateKey(rangeStart, index);
      trend.push({
        date: day,
        leads: leads.filter((lead) => lead.created_at && lagosDateKey(lead.created_at) === day).length,
        orders: orders.filter((order) => order.created_at && lagosDateKey(order.created_at) === day).length
      });
    }

    const bySource = new Map<string, number>();
    for (const lead of leads) bySource.set(lead.source, (bySource.get(lead.source) ?? 0) + 1);
    const leadsBySource = [...bySource.entries()].map(([source, count]) => ({ source, count }));

    const productStats = new Map<string, { orders: number; delivered: number; revenue: number }>();
    for (const order of orders) {
      const name = order.product_name ?? "Unknown product";
      const entry = productStats.get(name) ?? { orders: 0, delivered: 0, revenue: 0 };
      entry.orders += 1;
      if (order.status === "Delivered") {
        entry.delivered += 1;
        entry.revenue += Number(order.amount ?? 0);
      }
      productStats.set(name, entry);
    }
    const topProducts = [...productStats.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 8)
      .map(([productName, stats]) => ({
        productName,
        orders: stats.orders,
        delivered: stats.delivered,
        revenue: stats.revenue,
        aov: stats.delivered > 0 ? Math.round(stats.revenue / stats.delivered) : 0,
        conversionRate: pct(stats.delivered, stats.orders)
      }));

    const deliveredOrders = orders.filter((order) => order.status === "Delivered");
    const totalRevenue = deliveredOrders.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
    const incremental = deliveredOrders.reduce((sum, order) => {
      const { upsell, crossSell } = incrementalRevenueForOrder(order);
      return { upsell: sum.upsell + upsell, crossSell: sum.crossSell + crossSell };
    }, { upsell: 0, crossSell: 0 });

    res.json({
      funnel: { newLeads: funnelNewLeads, contacted: funnelContacted, qualified: funnelQualified, ordersCreated: funnelOrdersCreated, delivered: funnelDelivered },
      conversionRates: {
        leadToOrder: pct(funnelOrdersCreated, funnelNewLeads),
        leadToDelivered: pct(funnelDelivered, funnelNewLeads),
        orderConversionRate: pct(funnelDelivered, funnelOrdersCreated)
      },
      trend,
      leadsBySource,
      topProducts,
      summary: {
        leadsCaptured: leads.length,
        ordersCreated: orders.length,
        deliveredOrders: deliveredOrders.length,
        deliveredRevenue: totalRevenue,
        aov: deliveredOrders.length > 0 ? Math.round(totalRevenue / deliveredOrders.length) : 0,
        leadToOrderRate: pct(funnelOrdersCreated, funnelNewLeads),
        leadToDeliveredRate: pct(funnelDelivered, funnelNewLeads),
        upsellRevenue: Math.round(incremental.upsell),
        crossSellRevenue: Math.round(incremental.crossSell)
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load performance." });
  }
});

type BonusTier = { id: string; label: string; minValue: number; amount: number };
type BonusComponent = { id: string; label: string; description: string; metric: string; tiers: BonusTier[] };

const DEFAULT_BONUS_COMPONENTS: BonusComponent[] = [
  { id: "lead_to_order", label: "Lead -> Order Conversion Bonus", description: "Earn for high order conversion rate", metric: "leadToOrderRate", tiers: [
    { id: "tier1", label: "Tier 1", minValue: 20, amount: 10000 },
    { id: "tier2", label: "Tier 2", minValue: 25, amount: 15000 },
    { id: "tier3", label: "Tier 3", minValue: 30, amount: 20000 }
  ] },
  { id: "lead_to_delivered", label: "Lead -> Delivered Conversion Bonus", description: "Earn for delivered conversion rate", metric: "leadToDeliveredRate", tiers: [
    { id: "tier1", label: "Tier 1", minValue: 14, amount: 10000 },
    { id: "tier2", label: "Tier 2", minValue: 18, amount: 15000 },
    { id: "tier3", label: "Tier 3", minValue: 22, amount: 20000 }
  ] },
  { id: "aov", label: "Average Order Value Bonus", description: "Earn for maintaining high AOV", metric: "aov", tiers: [
    { id: "tier1", label: "Tier 1", minValue: 18000, amount: 7000 },
    { id: "tier2", label: "Tier 2", minValue: 20000, amount: 10000 },
    { id: "tier3", label: "Tier 3", minValue: 24000, amount: 15000 }
  ] },
  { id: "upsell_cross_sell", label: "Upsell & Cross-sell Bonus", description: "Earn for generating upsell & cross-sell revenue", metric: "upsellCrossSellRevenue", tiers: [
    { id: "tier1", label: "Tier 1", minValue: 100000, amount: 10000 },
    { id: "tier2", label: "Tier 2", minValue: 150000, amount: 20000 },
    { id: "tier3", label: "Tier 3", minValue: 200000, amount: 30000 }
  ] },
  { id: "activity", label: "Activity Bonus", description: "Active follow-ups & consistent activity", metric: "activityScore", tiers: [
    { id: "tier1", label: "Tier 1", minValue: 70, amount: 5000 },
    { id: "tier2", label: "Tier 2", minValue: 80, amount: 10000 },
    { id: "tier3", label: "Tier 3", minValue: 90, amount: 15000 }
  ] },
  { id: "delivery_quality", label: "Delivery Quality Bonus", description: "Based on delivered order rate", metric: "deliveryRate", tiers: [
    { id: "tier1", label: "Tier 1", minValue: 50, amount: 5000 },
    { id: "tier2", label: "Tier 2", minValue: 60, amount: 10000 },
    { id: "tier3", label: "Tier 3", minValue: 70, amount: 15000 }
  ] }
];

async function loadSalesCloserBonusSettings(orgId: string) {
  const { data, error } = await supabase.from("sales_closer_bonus_settings").select("currency, components, allocated_salary_monthly, packaging_cost_per_unit, updated_at").eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  if (!data) return { currency: "NGN", components: DEFAULT_BONUS_COMPONENTS, allocatedSalaryMonthly: 70000, packagingCostPerUnit: 0, updatedAt: null as string | null };
  return {
    currency: data.currency as string,
    components: data.components as BonusComponent[],
    allocatedSalaryMonthly: Number(data.allocated_salary_monthly ?? 70000),
    packagingCostPerUnit: Number(data.packaging_cost_per_unit ?? 0),
    updatedAt: data.updated_at as string | null
  };
}

function achievedTier(tiers: BonusTier[], value: number): BonusTier | null {
  let achieved: BonusTier | null = null;
  for (const tier of [...tiers].sort((a, b) => a.minValue - b.minValue)) {
    if (value >= tier.minValue) achieved = tier;
  }
  return achieved;
}

function requireBonusLeadership(role: string) {
  if (!SUPERVISOR_ROLES.has(role)) {
    throw Object.assign(new Error("Only Owner, Admin, or Manager can confirm a bonus."), { status: 403 });
  }
}

// Every component metric a bonus tier can be evaluated against, for one
// closer over one calendar month. Approximated where the schema has no
// exact equivalent - activityScore is the closest honest proxy available
// (leads with no activity beyond creation are excluded), not a fabricated
// number.
async function computeCloserMonthMetrics(orgId: string, closerId: string, monthStart: string) {
  const [year, month] = monthStart.split("-").map(Number);
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const [{ data: leadRows, error: leadError }, { data: orderRows, error: orderError }] = await Promise.all([
    supabase.from("sales_leads").select("status, created_at, last_activity_at, converted_order_id").eq("org_id", orgId).eq("assigned_closer_id", closerId),
    supabase.from("orders").select("id, status, amount, created_at, upsell_from_qty, upsell_to_qty, original_amount, original_quantity, cross_sell_lines")
      .eq("org_id", orgId).eq("closed_by_closer_id", closerId)
  ]);
  if (leadError) throw leadError;
  if (orderError) throw orderError;

  const leads = (leadRows ?? []).filter((lead) => lead.created_at && lagosDateKey(lead.created_at) >= monthStart && lagosDateKey(lead.created_at) < nextMonth);
  const orders = ((orderRows ?? []) as HeadOfSalesOrder[]).filter((order) => order.created_at && lagosDateKey(order.created_at) >= monthStart && lagosDateKey(order.created_at) < nextMonth);
  const delivered = orders.filter((order) => order.status === "Delivered");
  const revenue = delivered.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
  const incremental = delivered.reduce((sum, order) => {
    const { upsell, crossSell } = incrementalRevenueForOrder(order);
    return sum + upsell + crossSell;
  }, 0);
  const pct = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
  const activeLeads = leads.filter((lead) => lead.last_activity_at && lead.created_at && lead.last_activity_at !== lead.created_at);
  const ordersCreatedFromLeads = leads.filter((lead) => Boolean(lead.converted_order_id)).length;
  const deliveredOrderIds = new Set(delivered.map((order) => order.id));
  const deliveredFromLeads = leads.filter((lead) => lead.converted_order_id && deliveredOrderIds.has(lead.converted_order_id)).length;

  return {
    leadToOrderRate: pct(ordersCreatedFromLeads, leads.length),
    leadToDeliveredRate: pct(deliveredFromLeads, leads.length),
    aov: delivered.length > 0 ? Math.round(revenue / delivered.length) : 0,
    upsellCrossSellRevenue: Math.round(incremental),
    activityScore: pct(activeLeads.length, leads.length),
    deliveryRate: pct(delivered.length, orders.length)
  };
}

function evaluateCloserBonus(components: BonusComponent[], metrics: Record<string, number>) {
  const results = components.map((component) => {
    const achieved = Number(metrics[component.metric] ?? 0);
    const tier = achievedTier(component.tiers, achieved);
    return { id: component.id, label: component.label, metric: component.metric, achieved, tierId: tier?.id ?? null, tierLabel: tier?.label ?? null, amount: tier?.amount ?? 0 };
  });
  return { results, totalAmount: results.reduce((sum, item) => sum + item.amount, 0) };
}

router.get("/bonus-settings", async (req, res) => {
  try {
    const settings = await loadSalesCloserBonusSettings(req.user!.orgId);
    res.json({ settings });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load bonus settings." });
  }
});

const BonusTierSchema = z.object({ id: z.string().min(1), label: z.string().min(1), minValue: z.number().min(0), amount: z.number().min(0) });
const BonusComponentSchema = z.object({ id: z.string().min(1), label: z.string().min(1), description: z.string().max(300), metric: z.enum(["leadToOrderRate", "leadToDeliveredRate", "aov", "upsellCrossSellRevenue", "activityScore", "deliveryRate"]), tiers: z.array(BonusTierSchema).min(1) });
// Every field optional and merged onto the existing row - a settings form
// that only edits Allocated Salary/Packaging (Stage 10) must not have to
// resubmit the full 6-component tier ladder just to change one number, and
// must not silently blank it out if it omits it.
const UpdateBonusSettingsSchema = z.object({
  currency: z.enum(["NGN", "GHS", "USD", "GBP", "EUR"]).optional(),
  components: z.array(BonusComponentSchema).min(1).optional(),
  allocatedSalaryMonthly: z.number().min(0).optional(),
  packagingCostPerUnit: z.number().min(0).optional()
});

router.patch("/bonus-settings", requireRole("Owner"), async (req, res) => {
  const parsed = UpdateBonusSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  try {
    const orgId = req.user!.orgId;
    const { data: existing, error: existingError } = await supabase.from("sales_closer_bonus_settings").select("id").eq("org_id", orgId).maybeSingle();
    if (existingError) throw existingError;
    const current = await loadSalesCloserBonusSettings(orgId);
    const row = {
      currency: parsed.data.currency ?? current.currency,
      components: parsed.data.components ?? current.components,
      allocated_salary_monthly: parsed.data.allocatedSalaryMonthly ?? current.allocatedSalaryMonthly,
      packaging_cost_per_unit: parsed.data.packagingCostPerUnit ?? current.packagingCostPerUnit,
      updated_by: req.user!.id,
      updated_at: new Date().toISOString()
    };
    if (existing) {
      const { error } = await supabase.from("sales_closer_bonus_settings").update(row).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("sales_closer_bonus_settings").insert({ org_id: orgId, ...row });
      if (error) throw error;
    }
    res.json({ settings: await loadSalesCloserBonusSettings(orgId) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save bonus settings." });
  }
});

const MonthQuerySchema = z.object({ monthStart: z.string().regex(/^\d{4}-\d{2}-01$/).optional(), closerId: z.string().uuid().optional() });

router.get("/bonus", async (req, res) => {
  const parsed = MonthQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid month." });
    return;
  }
  try {
    const scope = scopeOf(req);
    const orgId = req.user!.orgId;
    // A closer can only ever see her own bonus (never chooses closerId);
    // leadership may pass closerId to review someone else's.
    const closerId = SUPERVISOR_ROLES.has(scope.role) && parsed.data.closerId ? parsed.data.closerId : scope.id;
    const monthStart = parsed.data.monthStart ?? `${lagosDateKey().slice(0, 7)}-01`;
    const settings = await loadSalesCloserBonusSettings(orgId);

    const { data: recordRow, error: recordError } = await supabase
      .from("sales_closer_bonus_monthly_records")
      .select("id, month_start, component_results, total_amount, status, notes, paid_at")
      .eq("org_id", orgId).eq("closer_id", closerId).eq("month_start", monthStart)
      .maybeSingle();
    if (recordError) throw recordError;

    const record = recordRow ? {
      id: recordRow.id, monthStart: recordRow.month_start, componentResults: recordRow.component_results,
      totalAmount: Number(recordRow.total_amount), status: recordRow.status, notes: recordRow.notes, paidAt: recordRow.paid_at
    } : null;

    let preview: { componentResults: ReturnType<typeof evaluateCloserBonus>["results"]; totalAmount: number } | null = null;
    if (!record) {
      const metrics = await computeCloserMonthMetrics(orgId, closerId, monthStart);
      const evaluation = evaluateCloserBonus(settings.components, metrics);
      preview = { componentResults: evaluation.results, totalAmount: evaluation.totalAmount };
    }

    const { data: historyRows, error: historyError } = await supabase
      .from("sales_closer_bonus_monthly_records")
      .select("month_start, total_amount, status, paid_at")
      .eq("org_id", orgId).eq("closer_id", closerId)
      .order("month_start", { ascending: false })
      .limit(12);
    if (historyError) throw historyError;

    const { data: allRecords, error: allError } = await supabase.from("sales_closer_bonus_monthly_records").select("total_amount, status").eq("org_id", orgId).eq("closer_id", closerId);
    if (allError) throw allError;
    const paidAmounts = (allRecords ?? []).filter((row) => row.status === "Paid").map((row) => Number(row.total_amount));
    const pendingAmount = (allRecords ?? []).filter((row) => row.status === "Pending").reduce((sum, row) => sum + Number(row.total_amount), 0);

    res.json({
      monthStart,
      settings,
      record,
      preview,
      summary: {
        totalEarnedThisMonth: record?.status === "Paid" ? record.totalAmount : (preview?.totalAmount ?? 0),
        totalPotential: preview?.totalAmount ?? record?.totalAmount ?? 0,
        bonusPaid: paidAmounts.reduce((sum, amount) => sum + amount, 0),
        payoutPending: pendingAmount
      },
      history: (historyRows ?? []).map((row) => ({ monthStart: row.month_start, totalAmount: Number(row.total_amount), status: row.status, paidAt: row.paid_at }))
    });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load bonus." });
  }
});

const SaveBonusSchema = z.object({ closerId: z.string().uuid(), monthStart: z.string().regex(/^\d{4}-\d{2}-01$/), notes: z.string().max(2000).optional() });

router.put("/bonus", async (req, res) => {
  const parsed = SaveBonusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  try {
    // Real role, not scopeOf's spied one: Owner reaches this workspace by
    // spying AS a specific closer to confirm her bonus (there is no other
    // entry point for leadership), so the spied role ("Sales Closer") must
    // not be what gates this leadership-only action.
    requireBonusLeadership(req.user!.role);
    const orgId = req.user!.orgId;
    const { data: existing, error: existingError } = await supabase
      .from("sales_closer_bonus_monthly_records").select("id, status")
      .eq("org_id", orgId).eq("closer_id", parsed.data.closerId).eq("month_start", parsed.data.monthStart)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === "Paid") {
      res.status(409).json({ error: "This month's bonus is already marked Paid and locked." });
      return;
    }
    const settings = await loadSalesCloserBonusSettings(orgId);
    const metrics = await computeCloserMonthMetrics(orgId, parsed.data.closerId, parsed.data.monthStart);
    const evaluation = evaluateCloserBonus(settings.components, metrics);
    const row = {
      org_id: orgId, closer_id: parsed.data.closerId, month_start: parsed.data.monthStart,
      component_results: evaluation.results, total_amount: evaluation.totalAmount,
      notes: parsed.data.notes ?? null, updated_at: new Date().toISOString()
    };
    if (existing) {
      const { error } = await supabase.from("sales_closer_bonus_monthly_records").update(row).eq("id", existing.id);
      if (error) throw error;
      res.json({ id: existing.id, totalAmount: evaluation.totalAmount });
    } else {
      const { data: inserted, error } = await supabase.from("sales_closer_bonus_monthly_records").insert({ ...row, created_by: req.user!.id }).select("id").single();
      if (error) throw error;
      res.status(201).json({ id: inserted.id, totalAmount: evaluation.totalAmount });
    }
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not save the bonus." });
  }
});

const MarkBonusPaidSchema = z.object({ closerId: z.string().uuid(), monthStart: z.string().regex(/^\d{4}-\d{2}-01$/) });

router.post("/bonus/mark-paid", async (req, res) => {
  const parsed = MarkBonusPaidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  try {
    // Real role, not scopeOf's spied one: Owner reaches this workspace by
    // spying AS a specific closer to confirm her bonus (there is no other
    // entry point for leadership), so the spied role ("Sales Closer") must
    // not be what gates this leadership-only action.
    requireBonusLeadership(req.user!.role);
    const orgId = req.user!.orgId;
    const { data: existing, error: existingError } = await supabase
      .from("sales_closer_bonus_monthly_records").select("id, status")
      .eq("org_id", orgId).eq("closer_id", parsed.data.closerId).eq("month_start", parsed.data.monthStart)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) {
      res.status(404).json({ error: "Save this month's bonus before marking it Paid." });
      return;
    }
    if (existing.status === "Paid") {
      res.json({ id: existing.id, status: "Paid" });
      return;
    }
    const { error } = await supabase.from("sales_closer_bonus_monthly_records").update({ status: "Paid", paid_at: new Date().toISOString(), paid_by: req.user!.id }).eq("id", existing.id);
    if (error) throw error;
    res.json({ id: existing.id, status: "Paid" });
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not mark this bonus as paid." });
  }
});

// Owner-side cross-closer view (as opposed to every route above, which is
// scoped to "my own" or one closer at a time via ?closerId=) - the
// leaderboard Bright's spec calls for, not reachable via spy-as since it
// spans every closer at once.
router.get("/closers-leaderboard", requireRole("Owner", "Admin", "Manager"), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const today = lagosDateKey();
    const monthStart = typeof req.query.monthStart === "string" && /^\d{4}-\d{2}-01$/.test(req.query.monthStart) ? req.query.monthStart : `${today.slice(0, 7)}-01`;

    const { data: closerUsers, error: usersError } = await supabase.from("users").select("id, name, active").eq("org_id", orgId).eq("role", "Sales Closer");
    if (usersError) throw usersError;
    const closerIds = (closerUsers ?? []).map((user) => user.id);
    if (closerIds.length === 0) {
      res.json({ monthStart, rows: [] });
      return;
    }

    const [{ data: leadRows, error: leadError }, { data: orderRows, error: orderError }] = await Promise.all([
      supabase.from("sales_leads").select("assigned_closer_id, status, created_at, converted_order_id").eq("org_id", orgId).in("assigned_closer_id", closerIds),
      supabase.from("orders").select("id, closed_by_closer_id, status, amount, created_at").eq("org_id", orgId).in("closed_by_closer_id", closerIds)
    ]);
    if (leadError) throw leadError;
    if (orderError) throw orderError;

    const pct = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
    const rows = (closerUsers ?? []).map((user) => {
      const leads = (leadRows ?? []).filter((lead) => lead.assigned_closer_id === user.id && lead.created_at && lagosDateKey(lead.created_at) >= monthStart);
      const orders = (orderRows ?? []).filter((order) => order.closed_by_closer_id === user.id && order.created_at && lagosDateKey(order.created_at) >= monthStart);
      const delivered = orders.filter((order) => order.status === "Delivered");
      const revenue = delivered.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
      const ordersFromLeads = leads.filter((lead) => Boolean(lead.converted_order_id)).length;
      const deliveredOrderIds = new Set(delivered.map((order) => order.id));
      const deliveredFromLeads = leads.filter((lead) => lead.converted_order_id && deliveredOrderIds.has(lead.converted_order_id)).length;
      return {
        closerId: user.id,
        closerName: user.name,
        active: user.active,
        leads: leads.length,
        orders: orders.length,
        leadToOrderRate: pct(ordersFromLeads, leads.length),
        delivered: delivered.length,
        leadToDeliveredRate: pct(deliveredFromLeads, leads.length),
        aov: delivered.length > 0 ? Math.round(revenue / delivered.length) : 0,
        revenue
      };
    }).sort((a, b) => b.revenue - a.revenue);

    res.json({ monthStart, rows });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load the leaderboard." });
  }
});

// Real per-order COGS lookup, same pattern as manager-bonuses.ts's
// loadPricingMap/cogsForOrder and customer-retention.ts's own copy -
// duplicated locally (small, ~20 lines) rather than refactoring those
// working files to export it, to keep this change scoped to Sales Closer.
type PricingMap = Map<string, { byCurrency: Map<string, number>; primary: number; hasPrimary: boolean }>;
async function loadPricingMap(productIds: string[]): Promise<PricingMap> {
  const map: PricingMap = new Map();
  if (productIds.length === 0) return map;
  const { data } = await supabase.from("product_pricings").select("product_id, currency, unit_cost, is_primary").in("product_id", productIds);
  for (const row of data ?? []) {
    let entry = map.get(row.product_id);
    if (!entry) { entry = { byCurrency: new Map(), primary: 0, hasPrimary: false }; map.set(row.product_id, entry); }
    const cost = Number(row.unit_cost ?? 0);
    if (row.currency) entry.byCurrency.set(row.currency, cost);
    if (row.is_primary) { entry.primary = cost; entry.hasPrimary = true; }
  }
  return map;
}
const unitCostFor = (pricingMap: PricingMap, productId?: string | null, currency?: string | null) => {
  if (!productId) return 0;
  const entry = pricingMap.get(productId);
  if (!entry) return 0;
  if (currency && entry.byCurrency.has(currency)) return entry.byCurrency.get(currency) ?? 0;
  if (entry.hasPrimary) return entry.primary;
  const first = entry.byCurrency.values().next();
  return first.done ? 0 : first.value;
};
const cogsForOrder = (order: any, pricingMap: PricingMap) =>
  orderInventoryLinesFromRow(order).reduce((sum, line) => sum + line.quantity * unitCostFor(pricingMap, line.productId, order.currency), 0);

// Owner/Admin only - never visible on the closer's own pages. Advertising
// is deliberately NOT included: ad spend is logged by the Marketer role
// against marketing_spend_records, which has no reliable link back to
// which Sales Closer eventually worked the resulting lead (a closer's
// own "campaign" field on a lead is freeform text she typed, not a real
// UTM match) - showing a number here would mean fabricating an
// attribution that doesn't exist in the data.
router.get("/cost-profitability", requireRole("Owner", "Admin"), async (req, res) => {
  const parsed = MonthQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid month." });
    return;
  }
  if (!parsed.data.closerId) {
    res.status(400).json({ error: "closerId is required." });
    return;
  }
  try {
    const orgId = req.user!.orgId;
    const monthStart = parsed.data.monthStart ?? `${lagosDateKey().slice(0, 7)}-01`;
    const [year, month] = monthStart.split("-").map(Number);
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    const { data: orderRows, error: orderError } = await supabase
      .from("orders")
      .select("id, status, amount, original_amount, quantity, currency, logistics_cost, created_at, product_id, package_id, package_components_snapshot, cross_sell_lines, free_gift_lines")
      .eq("org_id", orgId).eq("closed_by_closer_id", parsed.data.closerId);
    if (orderError) throw orderError;
    const orders = (orderRows ?? []).filter((order) => order.created_at && lagosDateKey(order.created_at) >= monthStart && lagosDateKey(order.created_at) < nextMonth);
    const delivered = orders.filter((order) => order.status === "Delivered");

    const productIds = new Set<string>();
    for (const order of delivered) for (const line of orderInventoryLinesFromRow(order)) if (line.productId) productIds.add(line.productId);
    const pricingMap = await loadPricingMap([...productIds]);

    const settings = await loadSalesCloserBonusSettings(orgId);
    const deliveredRevenue = delivered.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
    const productCost = delivered.reduce((sum, order) => sum + cogsForOrder(order, pricingMap), 0);
    const deliveryCost = delivered.reduce((sum, order) => sum + Number(order.logistics_cost ?? 0), 0);
    const discounts = delivered.reduce((sum, order) => sum + Math.max(0, Number(order.original_amount ?? order.amount ?? 0) - Number(order.amount ?? 0)), 0);
    const deliveredUnits = delivered.reduce((sum, order) => sum + Math.max(0, Number(order.quantity ?? 0)), 0);
    const packaging = deliveredUnits * settings.packagingCostPerUnit;

    const { data: bonusRecord } = await supabase
      .from("sales_closer_bonus_monthly_records").select("total_amount")
      .eq("org_id", orgId).eq("closer_id", parsed.data.closerId).eq("month_start", monthStart).maybeSingle();
    const closerBonus = Number(bonusRecord?.total_amount ?? 0);
    const allocatedSalary = settings.allocatedSalaryMonthly;

    const netProfit = deliveredRevenue - productCost - deliveryCost - packaging - discounts - closerBonus - allocatedSalary;

    res.json({
      monthStart,
      deliveredRevenue,
      productCost,
      deliveryCost,
      packaging,
      discounts,
      closerBonus,
      allocatedSalary,
      netProfit,
      deliveredOrders: delivered.length,
      deliveredUnits
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load cost & profitability." });
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
