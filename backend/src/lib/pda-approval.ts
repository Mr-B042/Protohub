// What still stands between a Personal Delivery Agent application and approval.
//
// Lives here rather than in the route so it can be tested directly: this is the
// rule that stops someone being approved as a whole person in one click, and it
// guards an account that will hold both company stock and customer cash.
export type KycItemLike = { mandatory: boolean; status: string; label: string };
export type GuarantorLike = { slot: number; verification_status: string; guarantor_type: string | null };
export type DocumentLike = { status: string; label: string };

/**
 * Returns a human-readable reason for every outstanding requirement.
 * An empty array means the application may be approved.
 *
 * The list is returned (rather than a boolean) so the Approve button can say
 * WHY it is disabled instead of just being greyed out.
 */
export function approvalBlockers(
  kycItems: KycItemLike[],
  guarantors: GuarantorLike[],
  documents: DocumentLike[]
): string[] {
  const blockers: string[] = [];

  for (const item of kycItems) {
    if (item.mandatory && item.status !== "Approved") {
      blockers.push(`${item.label} is ${item.status.toLowerCase()}`);
    }
  }

  for (const slot of [1, 2]) {
    const guarantor = guarantors.find((g) => g.slot === slot);
    if (!guarantor) { blockers.push(`Guarantor ${slot} has not been added`); continue; }
    if (guarantor.verification_status !== "Approved") {
      blockers.push(`Guarantor ${slot} is ${guarantor.verification_status.toLowerCase()}`);
    }
  }

  // Two relatives can simply agree with each other. One independently
  // verifiable referee (employer, landlord, business owner, community leader)
  // is what makes the pair worth having.
  const types = guarantors.map((g) => g.guarantor_type).filter(Boolean);
  if (types.length === 2 && !types.includes("Independent")) {
    blockers.push("Both guarantors are family - one must be an independent referee");
  }

  for (const doc of documents) {
    if (doc.status !== "Approved") blockers.push(`${doc.label} is ${doc.status.toLowerCase()}`);
  }

  return blockers;
}
