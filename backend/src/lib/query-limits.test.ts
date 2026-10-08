import assert from "node:assert/strict";
import test from "node:test";
import { selectByIdBatches } from "./query-limits.js";

test("long id lists go in batches of 200, and a refusal throws instead of reading as 'none'", async () => {
  const seen: number[] = [];
  const ids = Array.from({ length: 751 }, (_, i) => `CART-${i}`);
  const rows = await selectByIdBatches<string>(ids, async (batch) => { seen.push(batch.length); return { data: batch, error: null }; });
  assert.deepEqual(seen, [200, 200, 200, 151]);
  assert.equal(rows.length, 751);
  await assert.rejects(
    selectByIdBatches(ids, async (batch) => (batch[0] === "CART-400" ? { data: null, error: { message: "URI too long" } } : { data: [], error: null })),
    /URI too long/
  );
});
