import { randomUUID } from "node:crypto";
import { buildPackageComponentSnapshot, orderInventoryLinesFromRow } from "./order-inventory.js";
import { packageAllowsState, packageHasAgentStateStock } from "./package-availability.js";
import { supabase } from "./supabase.js";

export const SALES_EXPANSION_EXEMPTIONS = [
  "unreachable_customer",
  "rejected_main_order",
  "main_price_objection",
  "angry_or_complaint_call",
  "cancellation",
  "reschedule_only",
  "no_approved_offer_available",
  "other"
] as const;

export const SALES_EXPANSION_REFUSALS = [
  "price_too_high",
  "not_interested",
  "already_has_product",
  "wants_original_only",
  "will_consider_later",
  "offer_not_appropriate",
  "other"
] as const;

export type SalesExpansionSettings = {
  enabled: boolean;
  enforcementMode: "block_confirmation" | "flag_only" | "measure_only";
  enforcementStartsAt: string;
  attemptTargetPct: number;
  loggingTargetPct: number;
  crossSellConversionTargetPct: number;
  auditSamplePct: number;
  fullBonusCompliancePct: number;
  warningCompliancePct: number;
  minimumCompliancePct: number;
  warningReductionPct: number;
  minimumReductionPct: number;
  pipConsecutiveWeeks: number;
  title: string;
  guidance: string;
};

export const defaultSalesExpansionSettings = (): SalesExpansionSettings => ({
  enabled: true,
  enforcementMode: "block_confirmation",
  enforcementStartsAt: new Date().toISOString(),
  attemptTargetPct: 85,
  loggingTargetPct: 100,
  crossSellConversionTargetPct: 10,
  auditSamplePct: 10,
  fullBonusCompliancePct: 98,
  warningCompliancePct: 95,
  minimumCompliancePct: 90,
  warningReductionPct: 5,
  minimumReductionPct: 10,
  pipConsecutiveWeeks: 2,
  title: "Upsell & Cross-sell Log",
  guidance: "Secure the main order first. Offer one useful upgrade and one relevant companion. Accept a clear refusal and return to confirming the original order."
});

const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const positiveInt = (value: unknown, fallback = 1) => Math.max(1, Math.round(number(value, fallback)));
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const rows = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.map(record).filter((row) => Object.keys(row).length > 0) : [];

export const salesExpansionSettingsFromRow = (row: any): SalesExpansionSettings => {
  const defaults = defaultSalesExpansionSettings();
  if (!row) return defaults;
  return {
    enabled: row.enabled !== false,
    enforcementMode: row.enforcement_mode ?? defaults.enforcementMode,
    enforcementStartsAt: row.enforcement_starts_at ?? defaults.enforcementStartsAt,
    attemptTargetPct: number(row.attempt_target_pct, defaults.attemptTargetPct),
    loggingTargetPct: number(row.logging_target_pct, defaults.loggingTargetPct),
    crossSellConversionTargetPct: number(row.cross_sell_conversion_target_pct, defaults.crossSellConversionTargetPct),
    auditSamplePct: number(row.audit_sample_pct, defaults.auditSamplePct),
    fullBonusCompliancePct: number(row.full_bonus_compliance_pct, defaults.fullBonusCompliancePct),
    warningCompliancePct: number(row.warning_compliance_pct, defaults.warningCompliancePct),
    minimumCompliancePct: number(row.minimum_compliance_pct, defaults.minimumCompliancePct),
    warningReductionPct: number(row.warning_reduction_pct, defaults.warningReductionPct),
    minimumReductionPct: number(row.minimum_reduction_pct, defaults.minimumReductionPct),
    pipConsecutiveWeeks: number(row.pip_consecutive_weeks, defaults.pipConsecutiveWeeks),
    title: text(row.title) || defaults.title,
    guidance: text(row.guidance) || defaults.guidance
  };
};

export async function loadSalesExpansionSettings(orgId: string) {
  const { data, error } = await supabase
    .from("sales_expansion_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return { settings: salesExpansionSettingsFromRow(data), isDefault: !data };
}

type ExpansionOrder = Record<string, any>;
type Offer = {
  key: string;
  offerType: "upsell" | "cross_sell";
  productId: string;
  productName: string;
  packageId: string;
  packageName: string;
  quantity: number;
  amount: number;
  amountIncrease: number;
  benefitReason: string;
  packageComponentsSnapshot: any[];
  priority: number;
};

const normalizeCompanion = (raw: Record<string, any>) => ({
  companionId: text(raw.companionId ?? raw.companion_id),
  productId: text(raw.productId ?? raw.product_id),
  packageId: text(raw.packageId ?? raw.package_id),
  active: raw.active !== false,
  quantity: positiveInt(raw.quantity, 1),
  pricingMode: text(raw.pricingMode ?? raw.pricing_mode) || "standard",
  fixedPrice: number(raw.fixedPrice ?? raw.fixed_price, 0),
  stateFilterMode: text(raw.stateFilterMode ?? raw.state_filter_mode) || "all",
  stateRestrictions: Array.isArray(raw.stateRestrictions ?? raw.state_restrictions) ? raw.stateRestrictions ?? raw.state_restrictions : [],
  requiresStateStock: Boolean(raw.requiresStateStock ?? raw.requires_state_stock),
  placement: text(raw.placement) || "inline",
  pitch: text(raw.pitch),
  headline: text(raw.headline),
  summaryOverride: text(raw.summaryOverride ?? raw.summary_override),
  priority: number(raw.priority, 0),
  bundleComponents: raw.bundleComponents ?? raw.bundle_components
});

async function packageSnapshot(orgId: string, pkg: any, fallbackProduct: { id: string; name: string }, multiplier = 1) {
  const snapshot = await buildPackageComponentSnapshot(orgId, pkg?.package_components ?? []);
  if (snapshot.length > 0) {
    return snapshot.map((line) => ({ ...line, quantity: positiveInt(line.quantity) * multiplier, sourceType: "cross_sell" }));
  }
  return [{
    productId: fallbackProduct.id,
    productName: fallbackProduct.name,
    quantity: positiveInt(multiplier, 1),
    isFreeGift: false,
    sourceType: "cross_sell"
  }];
}

async function getOrder(orgId: string, orderId: string): Promise<ExpansionOrder | null> {
  const { data, error } = await supabase.from("orders").select("*").eq("org_id", orgId).eq("id", orderId).maybeSingle();
  if (error) throw error;
  return data;
}

async function packageIsAvailable(orgId: string, productId: string, pkg: any, state: string | null) {
  if (pkg?.active === false || !packageAllowsState(pkg, state)) return false;
  return packageHasAgentStateStock(orgId, productId, pkg, state, true);
}

const companionAllowsState = (companion: ReturnType<typeof normalizeCompanion>, state: string | null) =>
  packageAllowsState({
    id: companion.companionId || companion.productId,
    state_filter_mode: companion.stateFilterMode,
    state_restrictions: companion.stateRestrictions
  }, state);

export async function buildSalesExpansionContext(orgId: string, orderId: string) {
  const [order, settingsResult] = await Promise.all([getOrder(orgId, orderId), loadSalesExpansionSettings(orgId)]);
  if (!order) return null;

  const orderQty = positiveInt(order.quantity, 1);
  const { data: sameProductPackages, error: packageError } = await supabase
    .from("product_packages")
    .select("*")
    .eq("product_id", order.product_id)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (packageError) throw packageError;

  const upsells: Offer[] = [];
  for (const pkg of (sameProductPackages ?? []).filter((candidate: any) => positiveInt(candidate.quantity) > orderQty)) {
    if (!await packageIsAvailable(orgId, order.product_id, pkg, order.state)) continue;
    upsells.push({
      key: `upsell:${pkg.id}`,
      offerType: "upsell",
      productId: order.product_id,
      productName: order.product_name,
      packageId: pkg.id,
      packageName: pkg.name,
      quantity: positiveInt(pkg.quantity),
      amount: number(pkg.price),
      amountIncrease: Math.max(0, number(pkg.price) - number(order.amount)),
      benefitReason: `Upgrade to ${pkg.name} for ${positiveInt(pkg.quantity) - orderQty} more piece${positiveInt(pkg.quantity) - orderQty === 1 ? "" : "s"} without placing another delivery later.`,
      packageComponentsSnapshot: await buildPackageComponentSnapshot(orgId, pkg.package_components ?? []),
      priority: -positiveInt(pkg.quantity)
    });
  }
  upsells.sort((a, b) => a.quantity - b.quantity);

  const currentPackage = (sameProductPackages ?? []).find((pkg: any) => pkg.id === order.package_id);
  const companions = rows(currentPackage?.companion_products).map(normalizeCompanion)
    .filter((companion) => companion.active && companion.productId && companion.placement !== "upsell")
    .sort((a, b) => b.priority - a.priority);
  const crossSells: Offer[] = [];
  for (const companion of companions) {
    if (!companionAllowsState(companion, order.state)) continue;
    const { data: product } = await supabase.from("products").select("id, name, active").eq("org_id", orgId).eq("id", companion.productId).maybeSingle();
    if (!product || product.active === false) continue;
    let pkg: any = null;
    if (companion.packageId) {
      const { data } = await supabase.from("product_packages").select("*").eq("id", companion.packageId).eq("product_id", companion.productId).maybeSingle();
      pkg = data;
    } else {
      const { data } = await supabase.from("product_packages").select("*").eq("product_id", companion.productId).eq("active", true).order("display_order").limit(1).maybeSingle();
      pkg = data;
    }
    if (!pkg || !await packageIsAvailable(orgId, companion.productId, { ...pkg, requires_state_stock: companion.requiresStateStock || pkg.requires_state_stock }, order.state)) continue;
    const standardAmount = number(pkg.price);
    const amount = companion.pricingMode === "free" ? 0 : companion.pricingMode === "fixed" ? companion.fixedPrice : standardAmount * companion.quantity;
    const snapshot = companion.bundleComponents
      ? (await buildPackageComponentSnapshot(orgId, companion.bundleComponents)).map((line) => ({ ...line, quantity: positiveInt(line.quantity) * companion.quantity, sourceType: "cross_sell" }))
      : await packageSnapshot(orgId, pkg, product, companion.quantity);
    crossSells.push({
      key: `cross_sell:${companion.companionId || `${product.id}:${pkg.id}`}`,
      offerType: "cross_sell",
      productId: product.id,
      productName: product.name,
      packageId: pkg.id,
      packageName: companion.headline || pkg.name,
      quantity: companion.quantity,
      amount,
      amountIncrease: amount,
      benefitReason: companion.pitch || companion.summaryOverride || `${product.name} complements this order and can be included now at the approved add-on price.`,
      packageComponentsSnapshot: snapshot,
      priority: companion.priority
    });
  }

  const { data: existingAttempt } = await supabase
    .from("order_sales_expansion_attempts")
    .select("*, offer_lines:order_sales_expansion_offer_lines(*)")
    .eq("org_id", orgId).eq("order_id", orderId).eq("record_status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const postLaunch = new Date(order.created_at ?? 0).getTime() >= new Date(settingsResult.settings.enforcementStartsAt).getTime();
  return {
    settings: settingsResult.settings,
    isDefaultSettings: settingsResult.isDefault,
    order: {
      id: order.id,
      assignedRepId: order.assigned_rep_id,
      customer: order.customer,
      productId: order.product_id,
      productName: order.product_name,
      packageId: order.package_id,
      packageName: order.package_name,
      quantity: orderQty,
      amount: number(order.amount),
      currency: order.currency ?? "NGN",
      state: order.state,
      status: order.status,
      callOutcome: order.call_outcome,
      createdAt: order.created_at
    },
    postLaunch,
    trackingRequired: settingsResult.settings.enabled && postLaunch,
    systemRecommendation: "eligible",
    upsellOffers: upsells,
    crossSellOffers: crossSells,
    setupWarnings: [
      ...(upsells.length === 0 ? ["No larger active package is available for this product."] : []),
      ...(crossSells.length === 0 ? ["No active, state-valid companion offer is configured for the selected package."] : [])
    ],
    existingAttempt
  };
}

export type SubmitSalesExpansionInput = {
  idempotencyKey: string;
  eligibility: "eligible" | "exempt";
  exemptionReason?: string;
  exemptionNote?: string;
  repNote: string;
  contactAttemptId?: string;
  offers: Array<{
    offerType: "upsell" | "cross_sell";
    response: "accepted" | "declined" | "consider_later" | "not_appropriate" | "waived_no_offer";
    offerKey?: string;
    refusalReason?: string;
    benefitReason?: string;
  }>;
};

export async function submitSalesExpansionAttempt(args: {
  orgId: string;
  orderId: string;
  actorId: string;
  actorName: string;
  input: SubmitSalesExpansionInput;
}) {
  const { orgId, orderId, actorId, actorName, input } = args;
  const context = await buildSalesExpansionContext(orgId, orderId);
  if (!context) throw Object.assign(new Error("Order not found."), { status: 404 });

  const { data: duplicate } = await supabase.from("order_sales_expansion_attempts").select("*, offer_lines:order_sales_expansion_offer_lines(*)")
    .eq("org_id", orgId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (duplicate) return { attempt: duplicate, order: await getOrder(orgId, orderId), idempotent: true };

  if (input.eligibility === "exempt") {
    if (!SALES_EXPANSION_EXEMPTIONS.includes(input.exemptionReason as any)) throw Object.assign(new Error("Choose a valid exemption reason."), { status: 400 });
    if (input.exemptionReason === "other" && !text(input.exemptionNote)) throw Object.assign(new Error("Explain the Other exemption."), { status: 400 });
  }

  const offersByType = new Map(input.offers.map((offer) => [offer.offerType, offer]));
  if (input.offers.filter((offer) => offer.offerType === "upsell").length > 1) {
    throw Object.assign(new Error("Log only one upsell offer per call."), { status: 400 });
  }
  const duplicateOfferKeys = input.offers
    .map((offer) => offer.offerKey)
    .filter((key): key is string => Boolean(key));
  if (new Set(duplicateOfferKeys).size !== duplicateOfferKeys.length) {
    throw Object.assign(new Error("The same offer cannot be logged twice."), { status: 400 });
  }
  if (input.eligibility === "eligible") {
    for (const [type, available] of [["upsell", context.upsellOffers], ["cross_sell", context.crossSellOffers]] as const) {
      const line = offersByType.get(type);
      if (available.length > 0 && !line) throw Object.assign(new Error(`Log the ${type === "upsell" ? "upsell" : "cross-sell"} offer before confirming.`), { status: 400 });
      if (available.length === 0 && line?.response !== "waived_no_offer" && line) throw Object.assign(new Error(`No approved ${type} offer is available.`), { status: 400 });
    }
  }
  for (const line of input.offers) {
    if (["declined", "consider_later", "not_appropriate"].includes(line.response) && !SALES_EXPANSION_REFUSALS.includes(line.refusalReason as any)) {
      throw Object.assign(new Error("Choose a valid refusal reason for each declined offer."), { status: 400 });
    }
  }

  const order = await getOrder(orgId, orderId);
  if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
  const originalAmount = number(order.amount);
  const originalQty = positiveInt(order.quantity);
  const offerRows: any[] = [];
  const update: Record<string, unknown> = {};
  let finalAmount = originalAmount;
  let nextCrossSells = Array.isArray(order.cross_sell_lines) ? [...order.cross_sell_lines] : [];

  const orderedInputOffers = [...input.offers].sort((a, b) => Number(a.offerType === "cross_sell") - Number(b.offerType === "cross_sell"));
  for (const inputLine of orderedInputOffers) {
    const available = inputLine.offerType === "upsell" ? context.upsellOffers : context.crossSellOffers;
    const selected = available.find((offer) => offer.key === inputLine.offerKey);
    if (inputLine.response === "accepted" && !selected) throw Object.assign(new Error("The accepted offer is no longer available. Refresh and choose again."), { status: 409 });
    let linkedOrderItemId: string | null = null;
    let acceptedAmount = 0;
    if (inputLine.response === "accepted" && selected) {
      if (inputLine.offerType === "upsell") {
        finalAmount = selected.amount;
        update.package_id = selected.packageId;
        update.package_name = selected.packageName;
        update.quantity = selected.quantity;
        update.amount = selected.amount;
        update.package_components_snapshot = selected.packageComponentsSnapshot;
        update.original_quantity = order.original_quantity ?? originalQty;
        update.original_amount = order.original_amount ?? originalAmount;
        update.upsell_from_qty = originalQty;
        update.upsell_to_qty = selected.quantity;
        update.upsell_note = `Accepted during sales expansion log by ${actorName}: ${selected.benefitReason}`;
        acceptedAmount = Math.max(0, selected.amount - originalAmount);
      } else {
        linkedOrderItemId = `manual-expansion-${randomUUID()}`;
        acceptedAmount = selected.amount;
        finalAmount += acceptedAmount;
        nextCrossSells.push({
          id: linkedOrderItemId,
          productId: selected.productId,
          productName: selected.productName,
          displayName: selected.packageName || selected.productName,
          packageId: selected.packageId,
          packageName: selected.packageName,
          packageQuantity: selected.quantity,
          quantity: selected.quantity,
          amount: selected.amount,
          packageComponentsSnapshot: selected.packageComponentsSnapshot,
          selectionSource: "manual_rep",
          addedById: actorId,
          addedByName: actorName,
          addedByRole: "Sales Rep",
          addedAt: new Date().toISOString()
        });
        update.cross_sell_lines = nextCrossSells;
        update.amount = finalAmount;
      }
    }
    offerRows.push({ inputLine, selected, linkedOrderItemId, acceptedAmount });
  }

  const automaticFlags = input.eligibility === "eligible" && input.offers.length === 0 ? ["eligible_without_offer_lines"] : [];
  const { data: attempt, error: attemptError } = await supabase.from("order_sales_expansion_attempts").insert({
    org_id: orgId,
    order_id: orderId,
    rep_id: order.assigned_rep_id ?? actorId,
    contact_attempt_id: input.contactAttemptId || null,
    idempotency_key: input.idempotencyKey,
    eligibility: input.eligibility,
    exemption_reason: input.eligibility === "exempt" ? input.exemptionReason : null,
    exemption_note: input.eligibility === "exempt" ? input.exemptionNote : null,
    original_product_id: order.product_id,
    original_product_name: order.product_name,
    original_package_id: order.package_id,
    original_package_name: order.package_name,
    original_quantity: originalQty,
    original_order_value: originalAmount,
    final_order_value: finalAmount,
    currency: order.currency ?? "NGN",
    rep_note: text(input.repNote),
    automatic_flags: automaticFlags
  }).select("*").single();
  if (attemptError) throw attemptError;

  try {
    if (offerRows.length > 0) {
      const { error } = await supabase.from("order_sales_expansion_offer_lines").insert(offerRows.map(({ inputLine, selected, linkedOrderItemId, acceptedAmount }) => ({
        org_id: orgId,
        attempt_id: attempt.id,
        order_id: orderId,
        offer_type: inputLine.offerType,
        response: inputLine.response,
        refusal_reason: inputLine.refusalReason || null,
        benefit_reason: text(inputLine.benefitReason) || selected?.benefitReason || "",
        offered_product_id: selected?.productId || null,
        offered_product_name: selected?.productName || null,
        offered_package_id: selected?.packageId || null,
        offered_package_name: selected?.packageName || null,
        offered_quantity: selected?.quantity || null,
        offered_amount: selected?.amount ?? null,
        accepted_amount: acceptedAmount,
        linked_order_item_id: linkedOrderItemId,
        offer_snapshot: selected ?? {}
      })));
      if (error) throw error;
    }
    let updatedOrder = order;
    if (Object.keys(update).length > 0) {
      update.updated_at = new Date().toISOString();
      const { data, error } = await supabase.from("orders").update(update).eq("org_id", orgId).eq("id", orderId).eq("updated_at", order.updated_at).select("*").maybeSingle();
      if (error) throw error;
      if (!data) throw Object.assign(new Error("Order changed while the sales log was open. Refresh and try again."), { status: 409 });
      updatedOrder = data;
    }
    const accepted = offerRows.filter(({ inputLine }) => inputLine.response === "accepted");
    const auditNote = input.eligibility === "exempt"
      ? `Sales expansion log: exempt (${input.exemptionReason}). ${text(input.exemptionNote)}`.trim()
      : `Sales expansion log completed by ${actorName}. ${accepted.length} offer${accepted.length === 1 ? "" : "s"} accepted. Order value ${order.currency ?? "NGN"} ${originalAmount.toLocaleString()} -> ${finalAmount.toLocaleString()}.`;
    const offerAuditNotes = offerRows.map(({ inputLine, selected, acceptedAmount }) => {
      const label = inputLine.offerType === "upsell" ? "Upsell" : "Cross-sell";
      const offerName = selected ? `${selected.productName} - ${selected.packageName}` : "No approved offer available";
      const refusal = inputLine.refusalReason ? ` Refusal reason: ${inputLine.refusalReason.replace(/_/g, " ")}.` : "";
      const value = inputLine.response === "accepted" ? ` Accepted value: ${order.currency ?? "NGN"} ${number(acceptedAmount).toLocaleString()}.` : "";
      return `${label} offered: ${offerName}. Response: ${inputLine.response.replace(/_/g, " ")}.${refusal}${value}`;
    });
    await supabase.from("order_audit").insert([auditNote, ...offerAuditNotes].map((note) => ({ order_id: orderId, org_id: orgId, changed_by: actorId, from_status: order.status, to_status: order.status, note })));
    if (Object.keys(update).length > 0) {
      const trackedFields = ["package_id", "package_name", "quantity", "amount", "package_components_snapshot", "cross_sell_lines", "upsell_from_qty", "upsell_to_qty", "upsell_note"];
      const fieldRows = trackedFields.filter((field) => Object.prototype.hasOwnProperty.call(update, field) && JSON.stringify(order[field]) !== JSON.stringify((updatedOrder as any)[field])).map((field) => ({
        order_id: orderId,
        org_id: orgId,
        changed_by: actorId,
        changed_by_name: actorName,
        field_name: field,
        from_value: order[field] ?? null,
        to_value: (updatedOrder as any)[field] ?? null
      }));
      if (fieldRows.length > 0) await supabase.from("order_field_edits").insert(fieldRows);
    }
    return { attempt: { ...attempt, offerLines: offerRows }, order: updatedOrder, idempotent: false };
  } catch (error) {
    await supabase.from("order_sales_expansion_attempts").delete().eq("id", attempt.id).eq("org_id", orgId);
    throw error;
  }
}

export async function confirmationNeedsSalesExpansionLog(orgId: string, order: ExpansionOrder) {
  const { settings } = await loadSalesExpansionSettings(orgId);
  if (!settings.enabled || settings.enforcementMode !== "block_confirmation") return false;
  if (new Date(order.created_at ?? 0).getTime() < new Date(settings.enforcementStartsAt).getTime()) return false;
  const { count, error } = await supabase.from("order_sales_expansion_attempts").select("id", { count: "exact", head: true })
    .eq("org_id", orgId).eq("order_id", order.id).eq("record_status", "active");
  if (error) throw error;
  return (count ?? 0) === 0;
}

export function salesExpansionSummaryFromRows(attempts: any[], orders: any[], offerLines: any[]) {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const active = attempts.filter((attempt) => attempt.record_status === "active");
  const eligible = active.filter((attempt) => attempt.eligibility === "eligible");
  const acceptedCrossSells = offerLines.filter((line) => line.offer_type === "cross_sell" && line.response === "accepted");
  const deliveredCrossSells = acceptedCrossSells.filter((line) => {
    const order = orderById.get(line.order_id);
    return order?.status === "Delivered" && (order.cross_sell_lines ?? []).some((item: any) => item.id === line.linked_order_item_id);
  });
  const deliveredAddOnValue = deliveredCrossSells.reduce((sum, line) => sum + number(line.accepted_amount), 0);
  return {
    attemptCount: active.length,
    eligibleCount: eligible.length,
    exemptionCount: active.length - eligible.length,
    loggingCompliancePct: active.length > 0 ? 100 : 0,
    crossSellAcceptedCount: acceptedCrossSells.length,
    crossSellDeliveredCount: deliveredCrossSells.length,
    crossSellAcceptancePct: eligible.length > 0 ? Math.round((acceptedCrossSells.length / eligible.length) * 1000) / 10 : 0,
    deliveredConversionPct: eligible.length > 0 ? Math.round((deliveredCrossSells.length / eligible.length) * 1000) / 10 : 0,
    deliveredAddOnValue
  };
}

export type SalesExpansionCompliance = {
  eligibleConfirmedCount: number;
  loggedCount: number;
  compliancePct: number;
  bonusMultiplier: number;
  reductionPct: number;
  level: "full" | "warning_5" | "warning_10" | "no_compliance_bonus";
  formalWarning: boolean;
  pipRecommended: boolean;
  previousWeekCompliancePct: number | null;
};

export function complianceBonusDecision(
  compliancePct: number,
  settings: SalesExpansionSettings
): Pick<SalesExpansionCompliance, "bonusMultiplier" | "reductionPct" | "level" | "formalWarning"> {
  if (compliancePct >= settings.fullBonusCompliancePct) {
    return { bonusMultiplier: 1, reductionPct: 0, level: "full", formalWarning: false };
  }
  if (compliancePct >= settings.warningCompliancePct) {
    return {
      bonusMultiplier: Math.max(0, 1 - settings.warningReductionPct / 100),
      reductionPct: settings.warningReductionPct,
      level: "warning_5",
      formalWarning: false
    };
  }
  if (compliancePct >= settings.minimumCompliancePct) {
    return {
      bonusMultiplier: Math.max(0, 1 - settings.minimumReductionPct / 100),
      reductionPct: settings.minimumReductionPct,
      level: "warning_10",
      formalWarning: false
    };
  }
  return { bonusMultiplier: 0, reductionPct: 100, level: "no_compliance_bonus", formalWarning: true };
}

const addDays = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

async function complianceRateForRepWeek(orgId: string, repId: string, weekStart: string, settings: SalesExpansionSettings) {
  const weekEndExclusive = addDays(weekStart, 7);
  const rangeStart = new Date(`${weekStart}T00:00:00Z`).getTime() < new Date(settings.enforcementStartsAt).getTime()
    ? settings.enforcementStartsAt
    : `${weekStart}T00:00:00Z`;
  const { data: orders, error } = await supabase.from("orders").select("id")
    .eq("org_id", orgId).eq("assigned_rep_id", repId)
    .gte("created_at", rangeStart).lt("created_at", `${weekEndExclusive}T00:00:00Z`)
    .in("status", ["Confirmed", "In Process", "Dispatched", "Delivered"]);
  if (error) throw error;
  const orderIds = (orders ?? []).map((order: any) => order.id);
  if (orderIds.length === 0) return { eligibleConfirmedCount: 0, loggedCount: 0, compliancePct: 100 };
  const { data: attempts, error: attemptsError } = await supabase.from("order_sales_expansion_attempts").select("order_id, audit_status")
    .eq("org_id", orgId).eq("rep_id", repId).eq("record_status", "active").in("order_id", orderIds);
  if (attemptsError) throw attemptsError;
  const loggedIds = new Set((attempts ?? []).filter((attempt: any) => attempt.audit_status !== "flagged").map((attempt: any) => attempt.order_id));
  return {
    eligibleConfirmedCount: orderIds.length,
    loggedCount: loggedIds.size,
    compliancePct: Math.round((loggedIds.size / orderIds.length) * 1000) / 10
  };
}

export async function salesExpansionComplianceForRepWeek(orgId: string, repId: string, weekStart: string): Promise<SalesExpansionCompliance> {
  const { settings } = await loadSalesExpansionSettings(orgId);
  if (!settings.enabled) {
    return { eligibleConfirmedCount: 0, loggedCount: 0, compliancePct: 100, bonusMultiplier: 1, reductionPct: 0, level: "full", formalWarning: false, pipRecommended: false, previousWeekCompliancePct: null };
  }
  const current = await complianceRateForRepWeek(orgId, repId, weekStart, settings);
  const previousWeeks = [];
  for (let offset = 1; offset < settings.pipConsecutiveWeeks; offset += 1) {
    const previousWeekStart = addDays(weekStart, -7 * offset);
    if (new Date(`${previousWeekStart}T23:59:59Z`).getTime() < new Date(settings.enforcementStartsAt).getTime()) break;
    previousWeeks.push(await complianceRateForRepWeek(orgId, repId, previousWeekStart, settings));
  }
  const previous = previousWeeks[0] ?? null;
  const decision = complianceBonusDecision(current.compliancePct, settings);
  return {
    ...current,
    ...decision,
    previousWeekCompliancePct: previous?.compliancePct ?? null,
    pipRecommended: previousWeeks.length === settings.pipConsecutiveWeeks - 1
      && [current, ...previousWeeks].every((week) => week.compliancePct < settings.fullBonusCompliancePct)
  };
}

export function expansionInventoryLines(order: ExpansionOrder) {
  return orderInventoryLinesFromRow(order);
}
