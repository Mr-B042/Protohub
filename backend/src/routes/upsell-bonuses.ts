import { Router } from "express";
import { z } from "zod";
import {
  DEFAULT_UPSELL_BONUS_SETTINGS,
  normalizeUpsellBonusSettings,
  type UpsellBonusSettings
} from "../lib/upsell-bonus.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

// Settings-only route. The two weekly gate numbers this bonus needs
// (Net Profit Ops, company delivery rate) are already computed correctly by
// GET /api/manager-bonuses/summary for the existing Delivery Rate Bonus -
// reused as-is rather than recomputed here, so both bonuses always agree on
// what "this week's profit and delivery rate" means. The Delivered Sales
// Expansion Rate and contribution-profit math need per-order COGS/commission
// logic that today only exists client-side (costForOrder, computeOrderBonus
// in src/App.tsx) - reimplementing all of that here would duplicate deep,
// already-correct logic and risk drifting from it, so that part is computed
// in the browser from already-loaded orders, same as the rest of the
// Manager Dashboard's Team performance / Finance summary sections.
const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin", "Manager"));

const TierSchema = z.object({
  id: z.string().trim().max(80).optional(),
  label: z.string().trim().max(120).optional(),
  minRate: z.coerce.number().min(0).max(100),
  maxRate: z.coerce.number().min(0).max(100).nullable().optional(),
  amount: z.coerce.number().min(0).max(1_000_000_000)
});

const SettingsPatchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  profitGateAmount: z.coerce.number().min(0).max(1_000_000_000).optional(),
  deliveryRateGatePct: z.coerce.number().min(0).max(100).optional(),
  contributionCapPct: z.coerce.number().min(0).max(100).optional(),
  currency: z.enum(["NGN", "USD", "GBP"]).optional(),
  profitGateMissMessage: z.string().trim().min(1).max(500).optional(),
  deliveryGateMissMessage: z.string().trim().min(1).max(500).optional(),
  gatesMetMessage: z.string().trim().min(1).max(500).optional(),
  belowTierMessage: z.string().trim().min(1).max(500).optional(),
  tiers: z.array(TierSchema).min(1).max(20).optional()
}).strict();

const settingsFromRow = (row: any): UpsellBonusSettings => normalizeUpsellBonusSettings(row ? {
  title: row.title,
  description: row.description,
  profitGateAmount: row.profit_gate_amount,
  deliveryRateGatePct: row.delivery_rate_gate_pct,
  contributionCapPct: row.contribution_cap_pct,
  currency: row.currency,
  profitGateMissMessage: row.profit_gate_miss_message,
  deliveryGateMissMessage: row.delivery_gate_miss_message,
  gatesMetMessage: row.gates_met_message,
  belowTierMessage: row.below_tier_message,
  tiers: row.expansion_rate_tiers
} : DEFAULT_UPSELL_BONUS_SETTINGS);

const settingsToRow = (orgId: string, settings: UpsellBonusSettings, updatedBy: string) => ({
  org_id: orgId,
  title: settings.title,
  description: settings.description,
  profit_gate_amount: settings.profitGateAmount,
  delivery_rate_gate_pct: settings.deliveryRateGatePct,
  contribution_cap_pct: settings.contributionCapPct,
  currency: settings.currency,
  expansion_rate_tiers: settings.tiers,
  profit_gate_miss_message: settings.profitGateMissMessage,
  delivery_gate_miss_message: settings.deliveryGateMissMessage,
  gates_met_message: settings.gatesMetMessage,
  below_tier_message: settings.belowTierMessage,
  updated_by: updatedBy,
  updated_at: new Date().toISOString()
});

async function loadSettings(orgId: string): Promise<{ settings: UpsellBonusSettings; isDefault: boolean }> {
  const { data, error } = await supabase
    .from("upsell_bonus_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return { settings: settingsFromRow(data), isDefault: !data };
}

router.get("/settings", async (req, res) => {
  try {
    const { settings, isDefault } = await loadSettings(req.user!.orgId);
    res.json({ settings, isDefault, canEdit: req.user!.role === "Owner" });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load upsell bonus settings." });
  }
});

router.patch("/settings", requireRole("Owner"), async (req, res) => {
  const parsed = SettingsPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const existing = await loadSettings(req.user!.orgId);
    const patch: Partial<UpsellBonusSettings> = {
      ...parsed.data,
      tiers: parsed.data.tiers?.map((tier, index) => ({
        id: tier.id ?? `tier-${index + 1}`,
        label: tier.label ?? "",
        minRate: tier.minRate,
        maxRate: tier.maxRate ?? null,
        amount: tier.amount
      }))
    };
    const settings = normalizeUpsellBonusSettings({ ...existing.settings, ...patch });
    const { data, error } = await supabase
      .from("upsell_bonus_settings")
      .upsert(settingsToRow(req.user!.orgId, settings, req.user!.id), { onConflict: "org_id" })
      .select("*")
      .single();
    if (error) throw error;
    res.json({ settings: settingsFromRow(data), isDefault: false, canEdit: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save upsell bonus settings." });
  }
});

export default router;
