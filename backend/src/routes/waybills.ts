import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { syncAgentStockAggregate } from "../lib/agent-locations.js";
import { notifyWaybillEvent } from "../lib/waybill-notifications.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// A single line item on a waybill, stored snake_case to match the DB jsonb.
type WaybillItem = { product_id: string; product_name: string; quantity: number };

// Resolve a waybill row (or insert payload) to its line items. Multi-item rows
// carry an `items` jsonb array; legacy single-item rows fall back to the
// product_id / product_name / quantity columns.
function waybillItemsOf(row: { items?: unknown; product_id?: string | null; product_name?: string | null; quantity?: number | null }): WaybillItem[] {
  if (Array.isArray(row.items) && row.items.length > 0) {
    return row.items
      .map((raw): WaybillItem => {
        const i = raw as Record<string, unknown>;
        return {
          product_id: String(i.product_id ?? i.productId ?? ""),
          product_name: String(i.product_name ?? i.productName ?? ""),
          quantity: Math.max(1, Number(i.quantity) || 1)
        };
      })
      .filter((i) => i.product_id);
  }
  if (row.product_id) {
    return [{ product_id: row.product_id, product_name: row.product_name ?? "", quantity: Math.max(1, Number(row.quantity) || 1) }];
  }
  return [];
}

const waybillItemsLabel = (items: WaybillItem[]) => items.map((i) => `${i.product_name} x${i.quantity}`).join(", ");

async function deleteLinkedWaybillExpenses(orgId: string, waybillId: string) {
  await supabase.from("expenses").delete().eq("org_id", orgId).eq("waybill_id", waybillId);
  // Legacy frontend-created waybill expenses used this deterministic id but did
  // not set waybill_id, so clean that row too.
  await supabase.from("expenses").delete().eq("org_id", orgId).eq("id", `EXP-WB-${waybillId}`);
}

/** Upsert a linked expense for a waybill's fee. Idempotent — updates if exists, inserts if not. */
async function syncWaybillExpense(
  orgId: string,
  waybill: { id: string; waybill_fee: number; itemsLabel: string; from_location?: string | null; to_location?: string | null; dispatched_date?: string | null }
) {
  if (waybill.waybill_fee <= 0) {
    // Fee is zero — remove any linked expense, including legacy unlinked rows.
    await deleteLinkedWaybillExpenses(orgId, waybill.id);
    return;
  }
  const route = [waybill.from_location, waybill.to_location].filter(Boolean).join(" → ") || "—";
  const description = `Waybill #${waybill.id} — ${route} — ${waybill.itemsLabel}`;
  const date = waybill.dispatched_date ?? new Date().toISOString().split("T")[0];
  const legacyExpenseId = `EXP-WB-${waybill.id}`;

  // Older frontend code created EXP-WB-<waybill> without waybill_id while the
  // backend created another linked row. Keep one canonical row and delete extras.
  const { data: existingRows } = await supabase
    .from("expenses")
    .select("id, created_at, waybill_id")
    .eq("org_id", orgId)
    .or(`waybill_id.eq.${waybill.id},id.eq.${legacyExpenseId}`)
    .order("created_at", { ascending: true });
  const rows = existingRows ?? [];
  const keep = rows.find((row) => row.id === legacyExpenseId) ?? rows[0] ?? null;
  const extras = keep ? rows.filter((row) => row.id !== keep.id).map((row) => row.id) : [];
  if (extras.length > 0) {
    await supabase.from("expenses").delete().eq("org_id", orgId).in("id", extras);
  }

  if (keep) {
    await supabase.from("expenses").update({
      amount: waybill.waybill_fee,
      category: "Waybill",
      description,
      date,
      currency: "NGN",
      waybill_id: waybill.id
    }).eq("org_id", orgId).eq("id", keep.id);
  } else {
    await supabase.from("expenses").insert({
      id:          legacyExpenseId,
      org_id:      orgId,
      date,
      category:    "Waybill",
      description,
      amount:      waybill.waybill_fee,
      currency:    "NGN",
      waybill_id:  waybill.id
    });
  }
}

async function restoreWaybillSourceStock(
  orgId: string,
  waybill: {
    from_agent_id?: string | null;
    from_agent_location_id?: string | null;
  },
  items: WaybillItem[]
) {
  let restoredUnits = 0;
  for (const item of items) {
    if (item.quantity <= 0) continue;
    restoredUnits += item.quantity;
    if (waybill.from_agent_location_id && waybill.from_agent_id) {
      const { data: sourceStock } = await supabase
        .from("agent_location_stock")
        .select("quantity")
        .eq("agent_location_id", waybill.from_agent_location_id)
        .eq("product_id", item.product_id)
        .single();
      const balanceAfter = (sourceStock?.quantity ?? 0) + item.quantity;
      await supabase.from("agent_location_stock").upsert({
        org_id: orgId,
        agent_id: waybill.from_agent_id,
        agent_location_id: waybill.from_agent_location_id,
        product_id: item.product_id,
        quantity: balanceAfter
      }, { onConflict: "agent_location_id,product_id" });
      await syncAgentStockAggregate(orgId, waybill.from_agent_id, item.product_id);
    } else {
      const { data: product } = await supabase
        .from("products")
        .select("warehouse_stock")
        .eq("id", item.product_id)
        .single();
      await supabase.from("products").update({
        warehouse_stock: Number(product?.warehouse_stock ?? 0) + item.quantity
      }).eq("id", item.product_id);
    }
  }
  return restoredUnits;
}

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("waybill_records")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

const WaybillItemInput = z.object({
  productId:   z.string().uuid(),
  productName: z.string().min(1),
  quantity:    z.number().int().min(1)
});
const WaybillSchema = z.object({
  id:             z.string().min(1),
  // New multi-item waybills send `items`. Legacy single-product callers may
  // still send productId/productName/quantity (normalized into items below).
  items:          z.array(WaybillItemInput).min(1).optional(),
  productId:      z.string().uuid().optional(),
  productName:    z.string().min(1).optional(),
  quantity:       z.number().int().min(1).optional(),
  waybillFee:     z.number().min(0).default(0),
  fromLocation:   z.string().optional(),
  toLocation:     z.string().optional(),
  carrier:        z.string().optional(),
  trackingNumber: z.string().optional(),
  agentId:        z.string().uuid().optional(),
  fromAgentId:    z.string().uuid().optional(),
  toAgentId:      z.string().uuid().optional(),
  fromAgentLocationId: z.string().uuid().optional(),
  toAgentLocationId: z.string().uuid().optional(),
  notes:          z.string().optional(),
  dispatchedDate: z.string().optional()
});

router.post("/",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = WaybillSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const d = parsed.data;
    const toAgentId = d.toAgentId ?? d.agentId ?? null;
    const fromAgentId = d.fromAgentId ?? null;

    if (d.fromAgentLocationId) {
      const { data: locationCheck } = await supabase
        .from("agent_locations")
        .select("id, agent_id")
        .eq("id", d.fromAgentLocationId)
        .eq("org_id", req.user!.orgId)
        .single();
      if (!locationCheck || (fromAgentId && locationCheck.agent_id !== fromAgentId)) {
        res.status(400).json({ error: "Sending agent location not found." });
        return;
      }
    }
    if (d.toAgentLocationId) {
      const { data: locationCheck } = await supabase
        .from("agent_locations")
        .select("id, agent_id")
        .eq("id", d.toAgentLocationId)
        .eq("org_id", req.user!.orgId)
        .single();
      if (!locationCheck || (toAgentId && locationCheck.agent_id !== toAgentId)) {
        res.status(400).json({ error: "Receiving agent location not found." });
        return;
      }
    }
    if (d.fromAgentLocationId && d.toAgentLocationId && d.fromAgentLocationId === d.toAgentLocationId) {
      res.status(400).json({ error: "Choose a different receiving hub/state. A waybill cannot move stock to the same exact hub it was sent from." });
      return;
    }

    // Normalize to line items (multi-item waybills send `items`; legacy callers
    // send a single productId/quantity).
    const items: WaybillItem[] = (d.items && d.items.length > 0)
      ? d.items.map((i) => ({ product_id: i.productId, product_name: i.productName, quantity: i.quantity }))
      : (d.productId
          ? [{ product_id: d.productId, product_name: d.productName ?? "", quantity: d.quantity ?? 1 }]
          : []);
    if (items.length === 0) {
      res.status(400).json({ error: "Add at least one product to the waybill." });
      return;
    }
    // The same product twice would double-deduct — reject it.
    const seenProductIds = new Set<string>();
    for (const it of items) {
      if (seenProductIds.has(it.product_id)) {
        res.status(400).json({ error: `${it.product_name} is listed twice — combine it into one line.` });
        return;
      }
      seenProductIds.add(it.product_id);
    }

    // Validate ALL items have enough stock at the source BEFORE deducting any, so
    // a shortfall on one item never leaves another partially deducted.
    const sourceLabel = d.fromAgentLocationId ? "Sending hub" : "Warehouse";
    const planned: { item: WaybillItem; balanceAfter: number }[] = [];
    for (const item of items) {
      let available = 0;
      if (d.fromAgentLocationId) {
        const { data: locationStock } = await supabase
          .from("agent_location_stock")
          .select("quantity")
          .eq("agent_location_id", d.fromAgentLocationId)
          .eq("product_id", item.product_id)
          .single();
        available = locationStock?.quantity ?? 0;
      } else {
        const { data: product } = await supabase
          .from("products").select("warehouse_stock").eq("id", item.product_id).single();
        available = product?.warehouse_stock ?? 0;
      }
      if (available < item.quantity) {
        res.status(400).json({ error: `${sourceLabel} only has ${available} unit${available === 1 ? "" : "s"} of ${item.product_name} (need ${item.quantity}).` });
        return;
      }
      planned.push({ item, balanceAfter: Math.max(0, available - item.quantity) });
    }

    // Deduct each item from the source.
    for (const { item, balanceAfter } of planned) {
      if (d.fromAgentLocationId) {
        const { error: stockError } = await supabase
          .from("agent_location_stock")
          .update({ quantity: balanceAfter })
          .eq("agent_location_id", d.fromAgentLocationId)
          .eq("product_id", item.product_id);
        if (stockError) { res.status(500).json({ error: stockError.message }); return; }
        if (fromAgentId) await syncAgentStockAggregate(req.user!.orgId, fromAgentId, item.product_id);
      } else {
        await supabase.from("products").update({ warehouse_stock: balanceAfter }).eq("id", item.product_id);
      }
    }

    const firstItem = items[0];
    const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
    const label = waybillItemsLabel(items);

    const { data, error } = await supabase
      .from("waybill_records")
      .insert({
        id: d.id, org_id: req.user!.orgId,
        // Legacy columns mirror the first item (kept for older views/queries);
        // `items` is the full source of truth.
        product_id: firstItem.product_id,
        product_name: items.length > 1 ? `${firstItem.product_name} +${items.length - 1} more` : firstItem.product_name,
        quantity: items.length > 1 ? totalQty : firstItem.quantity,
        items,
        waybill_fee: d.waybillFee,
        from_location: d.fromLocation, to_location: d.toLocation, carrier: d.carrier,
        tracking_number: d.trackingNumber, agent_id: toAgentId, from_agent_id: fromAgentId,
        to_agent_id: toAgentId, from_agent_location_id: d.fromAgentLocationId ?? null,
        to_agent_location_id: d.toAgentLocationId ?? null, notes: d.notes,
        dispatched_date: d.dispatchedDate, status: "In Transit"
      })
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    // Auto-create linked expense for waybill fee
    if (d.waybillFee > 0) {
      await syncWaybillExpense(req.user!.orgId, {
        id: d.id, waybill_fee: d.waybillFee, itemsLabel: label,
        from_location: d.fromLocation, to_location: d.toLocation,
        dispatched_date: d.dispatchedDate
      });
    }

    // Auto-log a "Waybill Out" stock movement per item.
    for (const { item, balanceAfter } of planned) {
      await supabase.from("stock_movements").insert({
        id:            `MOV-${randomUUID()}`,
        org_id:        req.user!.orgId,
        product_id:    item.product_id,
        product_name:  item.product_name,
        type:          "Waybill Out",
        qty:           item.quantity,
        balance_after: balanceAfter,
        agent_id:      toAgentId ?? fromAgentId ?? null,
        by_name:       req.user!.name,
        by_user_id:    req.user!.id,
        waybill_id:    d.id,
        from_agent_location_id: d.fromAgentLocationId ?? null,
        to_agent_location_id: d.toAgentLocationId ?? null,
        from_location: d.fromLocation ?? null,
        to_location:   d.toLocation ?? null,
        note:          `Waybill ${d.id} dispatched${d.carrier ? ` via ${d.carrier}` : ""}`
      });
    }

    await notifyWaybillEvent(req.user!.orgId, {
      id: data.id,
      productName: data.product_name,
      quantity: data.quantity,
      itemsLabel: label,
      fromLocation: data.from_location,
      toLocation: data.to_location,
      carrier: data.carrier
    }, "dispatched");

    res.status(201).json(data);
  }
);

// ── PATCH /api/waybills/:id ───────────────────────────────
const WaybillPatchSchema = z.object({
  waybill_fee:     z.number().min(0).optional(),
  carrier:         z.string().max(120).optional(),
  to_location:     z.string().max(120).optional(),
  from_location:   z.string().max(120).optional(),
  agent_id:        z.string().uuid().nullable().optional(),
  from_agent_id:   z.string().uuid().nullable().optional(),
  to_agent_id:     z.string().uuid().nullable().optional(),
  from_agent_location_id: z.string().uuid().nullable().optional(),
  to_agent_location_id: z.string().uuid().nullable().optional(),
  dispatched_date: z.string().optional(),
  notes:           z.string().max(500).nullable().optional(),
  tracking_number: z.string().max(120).optional()
}).strict();

router.patch("/:id",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = WaybillPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const updates: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(parsed.data)) {
      if (val !== undefined) updates[key] = val;
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update." });
      return;
    }
    const { data: current, error: currentError } = await supabase
      .from("waybill_records")
      .select("id, from_agent_location_id, to_agent_location_id")
      .eq("id", req.params.id).eq("org_id", req.user!.orgId)
      .single();
    if (currentError || !current) { res.status(404).json({ error: "Waybill not found." }); return; }
    const nextFromLocationId = Object.prototype.hasOwnProperty.call(updates, "from_agent_location_id")
      ? updates.from_agent_location_id
      : current.from_agent_location_id;
    const nextToLocationId = Object.prototype.hasOwnProperty.call(updates, "to_agent_location_id")
      ? updates.to_agent_location_id
      : current.to_agent_location_id;
    if (nextFromLocationId && nextToLocationId && nextFromLocationId === nextToLocationId) {
      res.status(400).json({ error: "Choose a different receiving hub/state. A waybill cannot move stock to the same exact hub it was sent from." });
      return;
    }
    const { data, error } = await supabase
      .from("waybill_records")
      .update(updates)
      .eq("id", req.params.id).eq("org_id", req.user!.orgId)
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "Waybill not found." }); return; }

    const patchLabel = waybillItemsLabel(waybillItemsOf(data));

    // Sync linked expense if fee was touched
    if (req.body.waybill_fee !== undefined) {
      await syncWaybillExpense(req.user!.orgId, {
        id: data.id, waybill_fee: data.waybill_fee, itemsLabel: patchLabel,
        from_location: data.from_location, to_location: data.to_location,
        dispatched_date: data.dispatched_date
      });
    }

    await notifyWaybillEvent(req.user!.orgId, {
      id: data.id,
      productName: data.product_name,
      quantity: data.quantity,
      itemsLabel: patchLabel,
      fromLocation: data.from_location,
      toLocation: data.to_location,
      carrier: data.carrier,
      status: data.status
    }, "updated");

    res.json(data);
  }
);

const WaybillStatusSchema = z.object({
  status:       z.enum(["In Transit", "Received", "Returned", "Cancelled", "Defective", "Missing"]),
  receivedDate: z.string().optional(),
  notes:        z.string().max(500).optional()
}).strict();

router.patch("/:id/status",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = WaybillStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { status, receivedDate, notes } = parsed.data;
    const updates: Record<string, unknown> = { status };
    if (status === "Received" && receivedDate) updates.received_date = receivedDate;
    if (notes !== undefined) updates.notes = notes;
    const { data, error } = await supabase
      .from("waybill_records")
      .update(updates)
      .eq("id", req.params.id).eq("org_id", req.user!.orgId)
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    // Auto-log stock movements for terminal statuses — once per line item.
    if (data && ["Received", "Returned", "Cancelled", "Defective", "Missing"].includes(status)) {
      const statusItems = waybillItemsOf(data);
      const movType = status === "Received" ? "Waybill In"
        : status === "Returned" || status === "Cancelled" ? "Waybill In"
        : "Correction";
      // "In" movements add stock back; "Correction" (Defective/Missing) removes it.
      const isInbound = movType === "Waybill In";
      for (const item of statusItems) {
        const { data: product } = await supabase
          .from("products").select("warehouse_stock, agent_stock").eq("id", item.product_id).single();
        let balanceAfter = 0;
        if (status === "Received") {
          if (data.to_agent_location_id && data.to_agent_id) {
            const { data: destStock } = await supabase
              .from("agent_location_stock")
              .select("quantity")
              .eq("agent_location_id", data.to_agent_location_id)
              .eq("product_id", item.product_id)
              .single();
            balanceAfter = (destStock?.quantity ?? 0) + item.quantity;
            await supabase.from("agent_location_stock").upsert({
              org_id: req.user!.orgId,
              agent_id: data.to_agent_id,
              agent_location_id: data.to_agent_location_id,
              product_id: item.product_id,
              quantity: balanceAfter
            }, { onConflict: "agent_location_id,product_id" });
            await syncAgentStockAggregate(req.user!.orgId, data.to_agent_id, item.product_id);
          } else {
            balanceAfter = (product?.warehouse_stock ?? 0) + item.quantity;
            await supabase.from("products").update({ warehouse_stock: balanceAfter }).eq("id", item.product_id);
          }
        } else if (status === "Cancelled") {
          if (data.from_agent_location_id && data.from_agent_id) {
            const { data: sourceStock } = await supabase
              .from("agent_location_stock")
              .select("quantity")
              .eq("agent_location_id", data.from_agent_location_id)
              .eq("product_id", item.product_id)
              .single();
            balanceAfter = (sourceStock?.quantity ?? 0) + item.quantity;
            await supabase.from("agent_location_stock").upsert({
              org_id: req.user!.orgId,
              agent_id: data.from_agent_id,
              agent_location_id: data.from_agent_location_id,
              product_id: item.product_id,
              quantity: balanceAfter
            }, { onConflict: "agent_location_id,product_id" });
            await syncAgentStockAggregate(req.user!.orgId, data.from_agent_id, item.product_id);
          } else {
            balanceAfter = (product?.warehouse_stock ?? 0) + item.quantity;
            await supabase.from("products").update({ warehouse_stock: balanceAfter }).eq("id", item.product_id);
          }
        } else {
          balanceAfter = isInbound
            ? (product?.warehouse_stock ?? 0) + item.quantity
            : Math.max(0, (product?.warehouse_stock ?? 0) - item.quantity);
        }
        await supabase.from("stock_movements").insert({
          id:            `MOV-${randomUUID()}`,
          org_id:        req.user!.orgId,
          product_id:    item.product_id,
          product_name:  item.product_name,
          type:          movType,
          qty:           item.quantity,
          balance_after: balanceAfter,
          agent_id:      data.to_agent_id ?? data.from_agent_id ?? data.agent_id ?? null,
          by_name:       req.user!.name,
          by_user_id:    req.user!.id,
          waybill_id:    data.id,
          from_agent_location_id: data.from_agent_location_id ?? null,
          to_agent_location_id: data.to_agent_location_id ?? null,
          from_location: data.from_location ?? null,
          to_location:   data.to_location ?? null,
          note:          `Waybill ${data.id} marked ${status}${notes ? ` — ${notes}` : ""}`
        });
      }
    }

    if (data && status === "Cancelled") {
      await deleteLinkedWaybillExpenses(req.user!.orgId, data.id);
    }

    if (data) {
      await notifyWaybillEvent(req.user!.orgId, {
        id: data.id,
        productName: data.product_name,
        quantity: data.quantity,
        itemsLabel: waybillItemsLabel(waybillItemsOf(data)),
        fromLocation: data.from_location,
        toLocation: data.to_location,
        carrier: data.carrier,
        status: data.status
      }, "status_changed");
    }

    res.json(data);
  }
);

router.delete("/:id",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const { data, error } = await supabase
      .from("waybill_records")
      .select("*")
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .single();
    if (error || !data) { res.status(404).json({ error: "Waybill not found." }); return; }
    if (!["In Transit", "Cancelled"].includes(data.status)) {
      res.status(400).json({ error: "Only in-transit or cancelled waybills can be deleted. Received/returned/defective/missing waybills are kept for stock audit." });
      return;
    }

    const items = waybillItemsOf(data);
    const restoredUnits = data.status === "In Transit"
      ? await restoreWaybillSourceStock(req.user!.orgId, data, items)
      : 0;

    await deleteLinkedWaybillExpenses(req.user!.orgId, data.id);
    await supabase.from("stock_movements").delete().eq("org_id", req.user!.orgId).eq("waybill_id", data.id);
    const { error: deleteError } = await supabase
      .from("waybill_records")
      .delete()
      .eq("id", data.id)
      .eq("org_id", req.user!.orgId);
    if (deleteError) { res.status(500).json({ error: deleteError.message }); return; }

    res.json({ deleted: true, restoredUnits });
  }
);

export default router;
