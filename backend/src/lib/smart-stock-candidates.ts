export type SmartStockCandidate = {
  scope: "state" | "agent";
  productId: string;
  state: string;
  stock: number;
  recentOrders: number;
  recentUnits: number;
  daysOfStock: number;
  agentId?: string;
  agentName?: string;
  locationId?: string;
  locationName?: string;
};

export function buildSmartStockAlertCandidates(args: {
  stateSupply: Array<{ productId: string; state: string; stock: number }>;
  agentSupply: Array<{ agentId: string; agentName: string; locationId?: string; locationName?: string; productId: string; state: string; stock: number }>;
  demand: Array<{ productId: string; state: string; recentOrders: number; recentUnits: number }>;
  minimumRecentUnits?: number;
  daysThreshold?: number;
  recentDaysWindow?: number;
}): SmartStockCandidate[] {
  const minimumRecentUnits = args.minimumRecentUnits ?? 3;
  const daysThreshold = args.daysThreshold ?? 3;
  const recentDaysWindow = args.recentDaysWindow ?? 7;
  const demandByKey = new Map(args.demand.map((row) => [`${row.productId}::${row.state}`, row]));
  const stateSupplyByKey = new Map(args.stateSupply.map((row) => [`${row.productId}::${row.state}`, Math.max(0, row.stock)]));
  const stateCandidates: SmartStockCandidate[] = [];

  for (const [key, demand] of demandByKey.entries()) {
    if (demand.recentUnits < minimumRecentUnits) continue;
    const stock = stateSupplyByKey.get(key) ?? 0;
    const dailyUnits = demand.recentUnits / recentDaysWindow;
    const daysOfStock = dailyUnits > 0 ? stock / dailyUnits : Number.POSITIVE_INFINITY;
    if (daysOfStock >= daysThreshold) continue;
    stateCandidates.push({
      scope: "state",
      productId: demand.productId,
      state: demand.state,
      stock,
      recentOrders: demand.recentOrders,
      recentUnits: demand.recentUnits,
      daysOfStock
    });
  }

  const stateCandidateKeys = new Set(stateCandidates.map((row) => `${row.productId}::${row.state}`));
  const agentCandidates = args.agentSupply.flatMap((row): SmartStockCandidate[] => {
    const key = `${row.productId}::${row.state}`;
    const demand = demandByKey.get(key);
    if (!demand || demand.recentUnits < minimumRecentUnits || stateCandidateKeys.has(key)) return [];
    const dailyUnits = demand.recentUnits / recentDaysWindow;
    const stock = Math.max(0, row.stock);
    const daysOfStock = dailyUnits > 0 ? stock / dailyUnits : Number.POSITIVE_INFINITY;
    if (daysOfStock >= daysThreshold) return [];
    return [{
      scope: "agent",
      productId: row.productId,
      state: row.state,
      stock,
      recentOrders: demand.recentOrders,
      recentUnits: demand.recentUnits,
      daysOfStock,
      agentId: row.agentId,
      agentName: row.agentName,
      ...(row.locationId ? { locationId: row.locationId } : {}),
      ...(row.locationName ? { locationName: row.locationName } : {})
    }];
  });

  return [...stateCandidates, ...agentCandidates];
}
