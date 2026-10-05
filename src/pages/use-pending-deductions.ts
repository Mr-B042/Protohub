// Delivered order lines still waiting on the Inventory Officer. They are in
// the shelf balance but already out the door, so every "available" figure must
// subtract them - the delivery check in the backend does, and a stock page
// that doesn't will show a hub as covered right up until a delivery is refused.
import { useEffect, useState } from "react";
import { deliveredStockReconciliationApi } from "../lib/api";
import type { PendingDeductionLine } from "./product-availability-model";

export function usePendingDeductionLines() {
  const [lines, setLines] = useState<PendingDeductionLine[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    deliveredStockReconciliationApi.list()
      .then((result) => {
        if (cancelled) return;
        setLines((result.rows ?? []).map((row) => ({
          agentLocationId: row.agentLocationId,
          productId: row.productId,
          quantity: row.quantity,
          status: row.status
        })));
      })
      .catch(() => { if (!cancelled) setError("Pending deductions could not be loaded, so available stock may read high until the delivered-stock queue is reachable."); });
    return () => { cancelled = true; };
  }, []);
  return { lines, error };
}
