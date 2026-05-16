import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { loadAssignedAgentIdsForUser } from "../lib/user-agent-assignments.js";

const router = Router();
router.use(requireAuth);

const QuerySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  agentId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  productId: z.string().uuid().optional()
});

const DAY_MS = 24 * 60 * 60 * 1000;
const WAT_OFFSET_MS = 60 * 60 * 1000;

type BalanceAccumulator = {
  agentId: string;
  agentName: string;
  agentPhone?: string | null;
  agentWhatsappPhone?: string | null;
  locationId: string;
  locationName: string;
  locationState?: string | null;
  locationCity?: string | null;
  productId: string;
  productName: string;
  productSku?: string | null;
  currentBalance: number;
  netSinceWeekStart: number;
  netAfterWeekEnd: number;
  receivedThisWeek: number;
  deliveredThisWeek: number;
  returnedThisWeek: number;
  transferredOutThisWeek: number;
  restoredThisWeek: number;
  writtenOffThisWeek: number;
};

type MovementRow = {
  product_id: string;
  product_name?: string | null;
  type: string;
  qty: number | string | null;
  created_at: string;
  agent_id?: string | null;
  from_agent_location_id?: string | null;
  to_agent_location_id?: string | null;
  from_location?: string | null;
  to_location?: string | null;
};

type AgentRow = {
  id: string;
  name: string;
  phone?: string | null;
  whatsapp_phone?: string | null;
  locations?: Array<{
    id: string;
    name?: string | null;
    state?: string | null;
    city?: string | null;
    active?: boolean | null;
    is_primary?: boolean | null;
    stock?: Array<{
      product_id: string;
      quantity?: number | null;
    }>;
  }>;
};

type UserWeekendStockSummaryScopeRow = {
  agent_balance_scope_mode?: unknown;
  agent_balance_state_scope?: unknown;
  agent_balance_agent_ids?: unknown;
};

type WeeklySnapshotRow = {
  agent_id: string;
  agent_location_id: string;
  product_id: string;
  opening_quantity: number | null;
  generated_at?: string | null;
};

const formatDateKey = (date: Date) => date.toISOString().slice(0, 10);

const mondayWeekStartKey = (source = new Date()) => {
  const wat = new Date(source.getTime() + WAT_OFFSET_MS);
  const mondayOffset = (wat.getUTCDay() + 6) % 7;
  wat.setUTCHours(0, 0, 0, 0);
  wat.setUTCDate(wat.getUTCDate() - mondayOffset);
  return formatDateKey(wat);
};

const addDaysToKey = (dateKey: string, days: number) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return formatDateKey(new Date(Date.UTC(year, month - 1, day + days)));
};

const watDayStartIso = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, -1, 0, 0, 0)).toISOString();
};

const absoluteQty = (value: unknown) => Math.abs(Number(value ?? 0));
const signedQty = (value: unknown) => Number(value ?? 0);

const keyFor = (agentId: string, locationId: string, productId: string) => `${agentId}::${locationId}::${productId}`;
const groupKeyFor = (agentId: string, locationId: string) => `${agentId}::${locationId}`;

const emptyWeeklyPayload = (weekStart: string, weekEnd: string) => ({
  weekStart,
  weekEnd,
  generatedAt: new Date().toISOString(),
  summary: {
    openingUnits: 0,
    receivedUnits: 0,
    deliveredUnits: 0,
    closingUnits: 0,
    returnedUnits: 0,
    writeOffUnits: 0,
    transferredOutUnits: 0,
    restoredUnits: 0,
    agentCount: 0,
    hubCount: 0,
    productCount: 0
  },
  rows: []
});

type WeekendStockSummaryAccessScope = {
  mode: "all" | "states" | "agents" | "assigned_agents";
  states: Set<string>;
  agentIds: Set<string>;
};

const normalizeWeekendStockSummaryAccessScope = (row: UserWeekendStockSummaryScopeRow | null | undefined): WeekendStockSummaryAccessScope => {
  const rawMode = typeof row?.agent_balance_scope_mode === "string" ? row.agent_balance_scope_mode : "all";
  const mode = rawMode === "states" || rawMode === "agents" || rawMode === "assigned_agents" ? rawMode : "all";
  const states = new Set<string>();
  const rawStates = Array.isArray(row?.agent_balance_state_scope) ? row?.agent_balance_state_scope : [];
  for (const state of rawStates) {
    if (typeof state === "string" && state.trim()) states.add(state.trim());
  }
  const agentIds = new Set<string>();
  const rawAgentIds = Array.isArray(row?.agent_balance_agent_ids) ? row?.agent_balance_agent_ids : [];
  for (const id of rawAgentIds) {
    if (typeof id === "string" && id.trim()) agentIds.add(id.trim());
  }
  return { mode, states, agentIds };
};

const loadWeekendStockSummaryAccessScopeForUser = async (orgId: string, userId: string) => {
  const { data: scopeRow, error: scopeError } = await supabase
    .from("users")
    .select("agent_balance_scope_mode, agent_balance_state_scope, agent_balance_agent_ids")
    .eq("id", userId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (scopeError) return { error: scopeError, scope: null as WeekendStockSummaryAccessScope | null };
  const scope = normalizeWeekendStockSummaryAccessScope(scopeRow as UserWeekendStockSummaryScopeRow);
  if (scope.mode === "assigned_agents") {
    scope.agentIds = new Set(await loadAssignedAgentIdsForUser(orgId, userId));
  }
  return { error: null, scope };
};

router.get(
  "/weekly",
  requireRole("Owner", "Admin", "Manager", "Sales Rep", "Inventory Manager"),
  async (req, res) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const weekStart = parsed.data.weekStart ?? mondayWeekStartKey();
    const weekEnd = addDaysToKey(weekStart, 6);
    const weekStartIso = watDayStartIso(weekStart);
    const weekEndExclusiveIso = watDayStartIso(addDaysToKey(weekEnd, 1));
    let accessScope: WeekendStockSummaryAccessScope = { mode: "all", states: new Set<string>(), agentIds: new Set<string>() };

    if (req.user!.role !== "Owner") {
      const { scope, error: scopeError } = await loadWeekendStockSummaryAccessScopeForUser(req.user!.orgId, req.user!.id);
      if (scopeError) {
        res.status(500).json({ error: scopeError.message });
        return;
      }
      accessScope = scope ?? accessScope;
      if (accessScope.mode === "states" && accessScope.states.size === 0) {
        res.json(emptyWeeklyPayload(weekStart, weekEnd));
        return;
      }
      if ((accessScope.mode === "agents" || accessScope.mode === "assigned_agents") && accessScope.agentIds.size === 0) {
        res.json(emptyWeeklyPayload(weekStart, weekEnd));
        return;
      }
      if (
        parsed.data.agentId
        && (accessScope.mode === "agents" || accessScope.mode === "assigned_agents")
        && !accessScope.agentIds.has(parsed.data.agentId)
      ) {
        res.json(emptyWeeklyPayload(weekStart, weekEnd));
        return;
      }
    }

    let agentsQuery = supabase
      .from("agents")
      .select("id, name, phone, whatsapp_phone, locations:agent_locations(id, name, state, city, active, is_primary, stock:agent_location_stock(product_id, quantity))")
      .eq("org_id", req.user!.orgId)
      .order("name");

    if (parsed.data.agentId) {
      agentsQuery = agentsQuery.eq("id", parsed.data.agentId);
    }

    const { data: agents, error: agentsError } = await agentsQuery;
    if (agentsError) {
      res.status(500).json({ error: agentsError.message });
      return;
    }

    let movementsQuery = supabase
      .from("stock_movements")
      .select("product_id, product_name, type, qty, created_at, agent_id, from_agent_location_id, to_agent_location_id, from_location, to_location")
      .eq("org_id", req.user!.orgId)
      .gte("created_at", weekStartIso)
      .order("created_at", { ascending: true });

    if (parsed.data.agentId) movementsQuery = movementsQuery.eq("agent_id", parsed.data.agentId);
    else if ((accessScope.mode === "agents" || accessScope.mode === "assigned_agents") && accessScope.agentIds.size > 0) {
      movementsQuery = movementsQuery.in("agent_id", Array.from(accessScope.agentIds));
    }
    if (parsed.data.productId) movementsQuery = movementsQuery.eq("product_id", parsed.data.productId);

    const { data: movements, error: movementsError } = await movementsQuery;
    if (movementsError) {
      res.status(500).json({ error: movementsError.message });
      return;
    }

    const productIds = new Set<string>();
    const agentMeta = new Map<string, { name: string; phone?: string | null; whatsappPhone?: string | null }>();
    const locationMeta = new Map<string, { agentId: string; name: string; state?: string | null; city?: string | null }>();
    const balances = new Map<string, BalanceAccumulator>();

    for (const row of (agents ?? []) as AgentRow[]) {
      agentMeta.set(row.id, {
        name: row.name,
        phone: row.phone ?? null,
        whatsappPhone: row.whatsapp_phone ?? null
      });
      for (const location of row.locations ?? []) {
        if (parsed.data.locationId && location.id !== parsed.data.locationId) continue;
        if ((accessScope.mode === "agents" || accessScope.mode === "assigned_agents") && !accessScope.agentIds.has(row.id)) continue;
        if (accessScope.mode === "states" && !accessScope.states.has(location.state?.trim() || "")) continue;
        locationMeta.set(location.id, {
          agentId: row.id,
          name: location.name?.trim() || `${location.state ?? "Hub"} Hub`,
          state: location.state ?? null,
          city: location.city ?? null
        });
        for (const stockRow of location.stock ?? []) {
          if (!stockRow.product_id) continue;
          if (parsed.data.productId && stockRow.product_id !== parsed.data.productId) continue;
          productIds.add(stockRow.product_id);
          const key = keyFor(row.id, location.id, stockRow.product_id);
          balances.set(key, {
            agentId: row.id,
            agentName: row.name,
            agentPhone: row.phone ?? null,
            agentWhatsappPhone: row.whatsapp_phone ?? null,
            locationId: location.id,
            locationName: location.name?.trim() || `${location.state ?? "Hub"} Hub`,
            locationState: location.state ?? null,
            locationCity: location.city ?? null,
            productId: stockRow.product_id,
            productName: stockRow.product_id,
            productSku: null,
            currentBalance: Number(stockRow.quantity ?? 0),
            netSinceWeekStart: 0,
            netAfterWeekEnd: 0,
            receivedThisWeek: 0,
            deliveredThisWeek: 0,
            returnedThisWeek: 0,
            transferredOutThisWeek: 0,
            restoredThisWeek: 0,
            writtenOffThisWeek: 0
          });
        }
      }
    }

    const ensureBalance = (agentId: string | null | undefined, locationId: string | null | undefined, productId: string, movementProductName?: string | null) => {
      if (!agentId || !locationId) return null;
      if (parsed.data.locationId && locationId !== parsed.data.locationId) return null;
      const locMeta = locationMeta.get(locationId);
      const agent = agentMeta.get(agentId);
      const key = keyFor(agentId, locationId, productId);
      const existing = balances.get(key);
      if (existing) {
        if (movementProductName && existing.productName === existing.productId) existing.productName = movementProductName;
        return existing;
      }
      const created: BalanceAccumulator = {
        agentId,
        agentName: agent?.name ?? agentId,
        agentPhone: agent?.phone ?? null,
        agentWhatsappPhone: agent?.whatsappPhone ?? null,
        locationId,
        locationName: locMeta?.name ?? "Agent Hub",
        locationState: locMeta?.state ?? null,
        locationCity: locMeta?.city ?? null,
        productId,
        productName: movementProductName?.trim() || productId,
        productSku: null,
        currentBalance: 0,
        netSinceWeekStart: 0,
        netAfterWeekEnd: 0,
        receivedThisWeek: 0,
        deliveredThisWeek: 0,
        returnedThisWeek: 0,
        transferredOutThisWeek: 0,
        restoredThisWeek: 0,
        writtenOffThisWeek: 0
      };
      balances.set(key, created);
      return created;
    };

    for (const movement of (movements ?? []) as MovementRow[]) {
      if (!movement.product_id) continue;
      productIds.add(movement.product_id);
      const createdAtMs = new Date(movement.created_at).getTime();
      const isWithinWeek = createdAtMs < new Date(weekEndExclusiveIso).getTime();
      const qtyAbs = absoluteQty(movement.qty);
      const qtySigned = signedQty(movement.qty);

      const apply = (
        balance: BalanceAccumulator | null,
        impact: number,
        counters?: Partial<Pick<BalanceAccumulator, "receivedThisWeek" | "deliveredThisWeek" | "returnedThisWeek" | "transferredOutThisWeek" | "restoredThisWeek" | "writtenOffThisWeek">>
      ) => {
        if (!balance) return;
        balance.netSinceWeekStart += impact;
        if (!isWithinWeek) {
          balance.netAfterWeekEnd += impact;
          return;
        }
        if (counters?.receivedThisWeek) balance.receivedThisWeek += counters.receivedThisWeek;
        if (counters?.deliveredThisWeek) balance.deliveredThisWeek += counters.deliveredThisWeek;
        if (counters?.returnedThisWeek) balance.returnedThisWeek += counters.returnedThisWeek;
        if (counters?.transferredOutThisWeek) balance.transferredOutThisWeek += counters.transferredOutThisWeek;
        if (counters?.restoredThisWeek) balance.restoredThisWeek += counters.restoredThisWeek;
        if (counters?.writtenOffThisWeek) balance.writtenOffThisWeek += counters.writtenOffThisWeek;
      };

      switch (movement.type) {
        case "Distributed to Agent":
          apply(
            ensureBalance(movement.agent_id, movement.to_agent_location_id, movement.product_id, movement.product_name),
            qtyAbs,
            { receivedThisWeek: qtyAbs }
          );
          break;
        case "Order Fulfilled":
          apply(
            ensureBalance(movement.agent_id, movement.from_agent_location_id, movement.product_id, movement.product_name),
            -qtyAbs,
            { deliveredThisWeek: qtyAbs }
          );
          break;
        case "Return":
          apply(
            ensureBalance(movement.agent_id, movement.from_agent_location_id, movement.product_id, movement.product_name),
            -qtyAbs,
            { returnedThisWeek: qtyAbs }
          );
          break;
        case "Waybill Out":
          apply(
            ensureBalance(movement.agent_id, movement.from_agent_location_id, movement.product_id, movement.product_name),
            -qtyAbs,
            { transferredOutThisWeek: qtyAbs }
          );
          break;
        case "Waybill In":
          if (movement.to_agent_location_id) {
            apply(
              ensureBalance(movement.agent_id, movement.to_agent_location_id, movement.product_id, movement.product_name),
              qtyAbs,
              { receivedThisWeek: qtyAbs }
            );
          } else if (movement.from_agent_location_id) {
            apply(
              ensureBalance(movement.agent_id, movement.from_agent_location_id, movement.product_id, movement.product_name),
              qtyAbs,
              { restoredThisWeek: qtyAbs }
            );
          }
          break;
        case "Status Reversal":
          apply(
            ensureBalance(movement.agent_id, movement.to_agent_location_id, movement.product_id, movement.product_name),
            qtyAbs,
            { restoredThisWeek: qtyAbs }
          );
          break;
        case "Correction":
          if (movement.from_agent_location_id) {
            apply(
              ensureBalance(movement.agent_id, movement.from_agent_location_id, movement.product_id, movement.product_name),
              qtySigned,
              { writtenOffThisWeek: qtySigned < 0 ? Math.abs(qtySigned) : 0 }
            );
          }
          break;
        default:
          break;
      }
    }

    const productIdList = Array.from(productIds);
    const productMap = new Map<string, { name: string; sku?: string | null }>();
    if (productIdList.length > 0) {
      const { data: products, error: productsError } = await supabase
        .from("products")
        .select("id, name, sku")
        .in("id", productIdList);
      if (productsError) {
        res.status(500).json({ error: productsError.message });
        return;
      }
      for (const product of products ?? []) {
        productMap.set(product.id, { name: product.name, sku: product.sku ?? null });
      }
    }

    const derivedRows = Array.from(balances.values())
      .map((entry) => {
        const product = productMap.get(entry.productId);
        const openingBalance = Math.max(0, entry.currentBalance - entry.netSinceWeekStart);
        const closingBalance = Math.max(0, entry.currentBalance - entry.netAfterWeekEnd);
        return {
          agentId: entry.agentId,
          agentName: entry.agentName,
          agentPhone: entry.agentPhone ?? null,
          agentWhatsappPhone: entry.agentWhatsappPhone ?? null,
          locationId: entry.locationId,
          locationName: entry.locationName,
          locationState: entry.locationState ?? null,
          locationCity: entry.locationCity ?? null,
          productId: entry.productId,
          productName: product?.name ?? entry.productName,
          productSku: product?.sku ?? null,
          openingBalance,
          receivedThisWeek: entry.receivedThisWeek,
          deliveredThisWeek: entry.deliveredThisWeek,
          returnedThisWeek: entry.returnedThisWeek,
          transferredOutThisWeek: entry.transferredOutThisWeek,
          restoredThisWeek: entry.restoredThisWeek,
          writtenOffThisWeek: entry.writtenOffThisWeek,
          closingBalance,
          netChange: closingBalance - openingBalance
        };
      })
      .filter((row) => {
        if (parsed.data.productId && row.productId !== parsed.data.productId) return false;
        return [
          row.openingBalance,
          row.receivedThisWeek,
          row.deliveredThisWeek,
          row.returnedThisWeek,
          row.transferredOutThisWeek,
          row.restoredThisWeek,
          row.writtenOffThisWeek,
          row.closingBalance
        ].some((value) => Number(value ?? 0) !== 0);
      })
      .sort((a, b) =>
        a.agentName.localeCompare(b.agentName)
        || a.locationName.localeCompare(b.locationName)
        || a.productName.localeCompare(b.productName)
      );

    let snapshotQuery = supabase
      .from("agent_balance_weekly_snapshots")
      .select("agent_id, agent_location_id, product_id, opening_quantity, generated_at")
      .eq("org_id", req.user!.orgId)
      .eq("week_start", weekStart);

    if (parsed.data.agentId) snapshotQuery = snapshotQuery.eq("agent_id", parsed.data.agentId);
    if (parsed.data.locationId) snapshotQuery = snapshotQuery.eq("agent_location_id", parsed.data.locationId);
    if (parsed.data.productId) snapshotQuery = snapshotQuery.eq("product_id", parsed.data.productId);

    const { data: snapshotRows, error: snapshotError } = await snapshotQuery;
    if (snapshotError) {
      res.status(500).json({ error: snapshotError.message });
      return;
    }

    const snapshotMap = new Map<string, WeeklySnapshotRow>();
    for (const snapshot of (snapshotRows ?? []) as WeeklySnapshotRow[]) {
      snapshotMap.set(keyFor(snapshot.agent_id, snapshot.agent_location_id, snapshot.product_id), snapshot);
    }

    const snapshotInsertRows = derivedRows
      .filter((row) => !snapshotMap.has(keyFor(row.agentId, row.locationId, row.productId)))
      .map((row) => ({
        org_id: req.user!.orgId,
        week_start: weekStart,
        agent_id: row.agentId,
        agent_location_id: row.locationId,
        product_id: row.productId,
        opening_quantity: row.openingBalance
      }));

    if (snapshotInsertRows.length > 0) {
      const { error: snapshotInsertError } = await supabase
        .from("agent_balance_weekly_snapshots")
        .upsert(snapshotInsertRows, {
          onConflict: "org_id,week_start,agent_id,agent_location_id,product_id",
          ignoreDuplicates: true
        });
      if (snapshotInsertError) {
        res.status(500).json({ error: snapshotInsertError.message });
        return;
      }
    }

    const rows = derivedRows.map((row) => {
      const snapshotKey = keyFor(row.agentId, row.locationId, row.productId);
      const snapshot = snapshotMap.get(snapshotKey);
      const openingBalance = snapshot?.opening_quantity != null ? Number(snapshot.opening_quantity) : row.openingBalance;
      return {
        ...row,
        openingBalance,
        netChange: row.closingBalance - openingBalance,
        openingSnapshotAt: snapshot?.generated_at ?? null
      };
    });

    const summary = rows.reduce((acc, row) => {
      acc.openingUnits += row.openingBalance;
      acc.receivedUnits += row.receivedThisWeek;
      acc.deliveredUnits += row.deliveredThisWeek;
      acc.closingUnits += row.closingBalance;
      acc.returnedUnits += row.returnedThisWeek;
      acc.writeOffUnits += row.writtenOffThisWeek;
      acc.transferredOutUnits += row.transferredOutThisWeek;
      acc.restoredUnits += row.restoredThisWeek;
      return acc;
    }, {
      openingUnits: 0,
      receivedUnits: 0,
      deliveredUnits: 0,
      closingUnits: 0,
      returnedUnits: 0,
      writeOffUnits: 0,
      transferredOutUnits: 0,
      restoredUnits: 0
    });

    res.json({
      weekStart,
      weekEnd,
      generatedAt: new Date().toISOString(),
      summary: {
        ...summary,
        agentCount: new Set(rows.map((row) => row.agentId)).size,
        hubCount: new Set(rows.map((row) => `${row.agentId}::${row.locationId}`)).size,
        productCount: new Set(rows.map((row) => row.productId)).size
      },
      rows
    });
  }
);

export default router;
