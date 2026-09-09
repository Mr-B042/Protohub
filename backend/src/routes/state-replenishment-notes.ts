import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { REPORT_ROW_CEILING } from "../lib/query-limits.js";

// Notes pinned to a state on the State Replenishment page. Everything else on
// that page is derived in the browser from stock, orders and waybills; this is
// the only part with anything to store - the reason a state that looks short
// was deliberately left alone.

const router = Router();
router.use(requireAuth);
// ⚠️ BOTH INVENTORY ROLES, for the same reason delivered-stock-reconciliation
// lists both: "Inventory Manager" is a legacy enum value, and the role actually
// assignable today is "Inventory Manager & Logistics Operations". Listing one
// would 403 whichever holder has the other.
router.use(requireRole("Owner", "Admin", "Manager", "Inventory Manager", "Inventory Manager & Logistics Operations"));

const NoteSchema = z.object({
  stateKey: z.string().trim().min(1).max(80),
  stateLabel: z.string().trim().max(120).default(""),
  productId: z.string().uuid().nullish(),
  productName: z.string().trim().max(160).default(""),
  body: z.string().trim().min(1).max(2000)
}).strict();

const rowToNote = (row: any) => ({
  id: row.id as string,
  stateKey: String(row.state_key ?? ""),
  stateLabel: String(row.state_label ?? ""),
  productId: (row.product_id ?? null) as string | null,
  productName: String(row.product_name_snapshot ?? ""),
  body: String(row.body ?? ""),
  createdBy: (row.created_by ?? null) as string | null,
  createdByName: String(row.created_by_name ?? ""),
  createdAt: String(row.created_at ?? "")
});

const COLUMNS = "id, state_key, state_label, product_id, product_name_snapshot, body, created_by, created_by_name, created_at";

// ── GET /api/state-replenishment-notes ────────────────────
// Every note for the org in one call. The page already holds all its states in
// memory and switches between them without a round trip, so per-state fetching
// would be a request each time an Inventory Manager clicked a different row.
router.get("/", async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  try {
    const { data, error } = await supabase
      .from("state_replenishment_notes")
      .select(COLUMNS)
      .eq("org_id", req.user!.orgId)
      .order("created_at", { ascending: false })
      .limit(REPORT_ROW_CEILING);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ notes: (data ?? []).map(rowToNote) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load replenishment notes." });
  }
});

// ── POST /api/state-replenishment-notes ───────────────────
router.post("/", async (req, res) => {
  try {
    const parsed = NoteSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    const note = parsed.data;

    // A product id from another org would otherwise be stored and then never
    // match anything this org can see - the note would read as unscoped.
    if (note.productId) {
      const { data: product } = await supabase.from("products")
        .select("id").eq("org_id", orgId).eq("id", note.productId).maybeSingle();
      if (!product) { res.status(404).json({ error: "That product does not exist here." }); return; }
    }

    const { data, error } = await supabase.from("state_replenishment_notes")
      .insert({
        org_id: orgId,
        state_key: note.stateKey,
        state_label: note.stateLabel,
        product_id: note.productId ?? null,
        product_name_snapshot: note.productName,
        body: note.body,
        created_by: req.user!.id,
        created_by_name: req.user!.name || ""
      })
      .select(COLUMNS)
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json({ note: rowToNote(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save that note." });
  }
});

// ── DELETE /api/state-replenishment-notes/:id ─────────────
// Notes are append-only rather than editable: one records what somebody
// believed at a moment, and rewriting that is worse than removing it. Owner and
// Admin can remove; everyone else can only add.
router.delete("/:id", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const { data, error } = await supabase.from("state_replenishment_notes")
      .delete()
      .eq("org_id", req.user!.orgId)
      .eq("id", req.params.id)
      .select("id")
      .maybeSingle();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "That note no longer exists." }); return; }
    res.json({ deleted: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not delete that note." });
  }
});

export default router;
