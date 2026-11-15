/** Pure part of shared ad accounts (ad-account-shares.ts): which branch a shared campaign counts in. */

export type ClaimEvidence = {
  /** Campaign id -> branches whose orders carry it (count). */
  orderBranches: Map<string, Map<string, number>>;
  /** Campaign id -> branches it was mapped to by hand. */
  mappedBranches: Map<string, Set<string>>;
  /** Campaign id -> branches whose product its landing page sells. */
  pageBranches: Map<string, Set<string>>;
};

/** Pure: campaign -> sharing branch that claims it (home keeps the rest). Ties go home. */
export function decideClaims(campaigns: Array<{ campaignId: string; homeBranchId: string; sharedWith: string[] }>, ev: ClaimEvidence): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of campaigns) {
    const candidates = c.sharedWith.filter((b) => b !== c.homeBranchId);
    if (!candidates.length) continue;
    const mapped = candidates.filter((b) => ev.mappedBranches.get(c.campaignId)?.has(b));
    if (mapped.length === 1) { out.set(c.campaignId, mapped[0]); continue; }
    const orders = ev.orderBranches.get(c.campaignId) ?? new Map<string, number>();
    const homeOrders = orders.get(c.homeBranchId) ?? 0;
    const best = candidates.map((b) => [b, orders.get(b) ?? 0] as const).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > homeOrders) { out.set(c.campaignId, best[0]); continue; }
    if (homeOrders > 0) continue;
    const pages = candidates.filter((b) => ev.pageBranches.get(c.campaignId)?.has(b));
    if (pages.length === 1) out.set(c.campaignId, pages[0]);
  }
  return out;
}

