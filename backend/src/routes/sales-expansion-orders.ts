import { Router } from "express";
import { z } from "zod";
import { buildSalesExpansionContext, SALES_EXPANSION_EXEMPTIONS, SALES_EXPANSION_REFUSALS, submitSalesExpansionAttempt } from "../lib/sales-expansion.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const OfferSchema = z.object({
  offerType: z.enum(["upsell", "cross_sell"]),
  response: z.enum(["accepted", "declined", "consider_later", "not_appropriate", "waived_no_offer"]),
  offerKey: z.string().max(300).optional(),
  refusalReason: z.enum(SALES_EXPANSION_REFUSALS).optional(),
  benefitReason: z.string().max(1000).optional()
});

const AttemptSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  eligibility: z.enum(["eligible", "exempt"]),
  exemptionReason: z.enum(SALES_EXPANSION_EXEMPTIONS).optional(),
  exemptionNote: z.string().max(1200).optional(),
  repNote: z.string().max(2000).default(""),
  contactAttemptId: z.string().uuid().optional(),
  offers: z.array(OfferSchema).max(6).default([])
});

const canAccessOrder = (role: string, userId: string, assignedRepId: string | null | undefined) =>
  role !== "Sales Rep" || assignedRepId === userId;

router.get("/:id/sales-expansion-context", async (req, res) => {
  try {
    const context = await buildSalesExpansionContext(req.user!.orgId, req.params.id);
    if (!context) { res.status(404).json({ error: "Order not found." }); return; }
    const role = req.user!.effectiveUserRole ?? req.user!.role;
    const userId = req.user!.effectiveUserId ?? req.user!.id;
    if (!canAccessOrder(role, userId, context.order.assignedRepId)) {
      res.status(403).json({ error: "You can only view sales logs for orders assigned to you." });
      return;
    }
    res.json(context);
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not load sales expansion guidance." });
  }
});

router.post("/:id/sales-expansion-attempts", async (req, res) => {
  const parsed = AttemptSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const context = await buildSalesExpansionContext(req.user!.orgId, req.params.id);
    if (!context) { res.status(404).json({ error: "Order not found." }); return; }
    const role = req.user!.effectiveUserRole ?? req.user!.role;
    const userId = req.user!.effectiveUserId ?? req.user!.id;
    if (!canAccessOrder(role, userId, context.order.assignedRepId)) {
      res.status(403).json({ error: "You can only log calls for orders assigned to you." });
      return;
    }
    const result = await submitSalesExpansionAttempt({
      orgId: req.user!.orgId,
      orderId: req.params.id,
      actorId: userId,
      actorName: req.user!.name,
      input: parsed.data
    });
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error: any) {
    res.status(error?.status ?? 500).json({ error: error?.message ?? "Could not save the sales expansion log." });
  }
});

export default router;
