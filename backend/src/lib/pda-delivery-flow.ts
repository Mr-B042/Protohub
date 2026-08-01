// The rules governing a Personal Delivery Agent's order workflow.
//
// Kept out of the route so they can be tested directly: these decide when an
// agent may start moving, when an order may be called delivered, and whether
// stock stays reserved - the three points where a mistake costs real money or
// real inventory.

/** Customer contact states that mean the customer is genuinely expecting us. */
export const CUSTOMER_READY = "Customer Ready";

export type DispatchCheckInput = {
  assignmentStatus: string;
  customerContactStatus: string;
  deliveryStatus: string;
  feeStatus: string;
};

/**
 * Why this agent may not start dispatch yet. Empty array = clear to go.
 *
 * "Dispatch Started" must not mean "I am about to ring the customer". A rider
 * who sets off before the customer has confirmed readiness is how a delivery
 * fee gets spent on a failed trip - which the company then pays for.
 */
export function dispatchBlockers(input: DispatchCheckInput): string[] {
  const blockers: string[] = [];
  if (input.assignmentStatus !== "Accepted") {
    blockers.push("Accept the assignment first");
  }
  if (input.customerContactStatus !== CUSTOMER_READY) {
    blockers.push("The customer has not confirmed they are ready to receive");
  }
  if (input.deliveryStatus !== "Ready for Dispatch" && input.deliveryStatus !== "Rescheduled") {
    blockers.push(`Delivery is already ${input.deliveryStatus.toLowerCase()}`);
  }
  // The fee is agreed BEFORE movement so it cannot be renegotiated afterwards,
  // when the company has already borne the cost of the trip.
  if (input.feeStatus !== "Locked" && input.feeStatus !== "Approved") {
    blockers.push("The delivery fee has not been agreed and locked");
  }
  return blockers;
}

export type DeliveryProof = {
  proofType?: string | null;
  proofFilePath?: string | null;
  proofReference?: string | null;
  amountCollected?: number | null;
};

export const ACCEPTED_PROOF_TYPES = ["Customer OTP", "Customer signature", "Delivery photograph", "Confirmation call"];

/**
 * Why this order cannot be marked delivered. Empty array = acceptable.
 *
 * At least one real proof is required. A proof type with nothing attached to
 * it is not proof, so photo/signature need a file and OTP/call need a
 * reference.
 */
export function deliveryProofBlockers(proof: DeliveryProof): string[] {
  const blockers: string[] = [];
  const type = (proof.proofType ?? "").trim();
  if (!type) {
    blockers.push("Record how the delivery was proved");
  } else if (!ACCEPTED_PROOF_TYPES.includes(type)) {
    blockers.push(`"${type}" is not an accepted proof type`);
  } else if (type === "Delivery photograph" || type === "Customer signature") {
    if (!proof.proofFilePath?.trim()) blockers.push(`Attach the ${type.toLowerCase()}`);
  } else if (!proof.proofReference?.trim()) {
    blockers.push(`Record the ${type.toLowerCase()} details`);
  }

  if (proof.amountCollected === null || proof.amountCollected === undefined) {
    blockers.push("Record how much was collected");
  } else if (!Number.isFinite(proof.amountCollected) || proof.amountCollected < 0) {
    blockers.push("The amount collected is not a valid figure");
  }
  return blockers;
}

/**
 * Whether a reschedule keeps the stock reserved for this order.
 *
 * A firm date is a real appointment, so the unit stays held. "I will call you
 * later" is not a date - holding stock for it blocks inventory indefinitely on
 * a customer who may never come back, so the unit returns to available stock
 * and the order becomes a follow-up instead.
 */
export function rescheduleKeepsStockReserved(rescheduledTo?: string | null): boolean {
  const date = (rescheduledTo ?? "").trim();
  if (!date) return false;
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isFinite(parsed.getTime());
}

export const FAILURE_REASONS = [
  "Customer unavailable",
  "Customer rejected product",
  "Customer did not have payment",
  "Price objection",
  "Customer changed mind",
  "Wrong address",
  "Customer could not be reached",
  "Product issue",
  "Agent transport problem",
  "Safety concern",
  "Other"
];

/** A failure with no reason teaches nobody anything, so one is required. */
export function failureReasonBlockers(reason?: string | null, note?: string | null): string[] {
  const value = (reason ?? "").trim();
  if (!value) return ["Choose why the delivery failed"];
  if (!FAILURE_REASONS.includes(value)) return [`"${value}" is not a recognised failure reason`];
  if (value === "Other" && !(note ?? "").trim()) return ["Describe what happened"];
  return [];
}
