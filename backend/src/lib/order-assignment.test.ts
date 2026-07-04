import assert from "node:assert/strict";
import test from "node:test";

// Pure TS mirror of pick_and_advance_dedicated_handler's ORDER BY (migration
// 148) — deliberately NOT imported by order-assignment.ts / the real code
// path (that logic lives in Postgres, run atomically via the RPC). This only
// exists to fast-test that the ordering rule actually converges to the
// configured weight proportions, without spinning up a database. Keep the
// comparison textually aligned with the SQL: lowest assigned_count/weight
// first, then longest-idle, then user_id, matching
// `148_product_dedicated_handler_weights.sql`'s `order by` clause.
type WeightedHandler = { userId: string; weight: number };

function simulateDedicatedHandlerPicks(handlers: WeightedHandler[], iterations: number): Record<string, number> {
  const state = handlers
    .filter((h) => h.weight > 0)
    .map((h) => ({ ...h, assignedCount: 0, lastAssignedAt: -1 }));
  const tally: Record<string, number> = {};

  for (let tick = 0; tick < iterations; tick++) {
    if (state.length === 0) break;
    state.sort((a, b) =>
      (a.assignedCount / a.weight) - (b.assignedCount / b.weight)
      || a.lastAssignedAt - b.lastAssignedAt
      || a.userId.localeCompare(b.userId)
    );
    const winner = state[0];
    winner.assignedCount += 1;
    winner.lastAssignedAt = tick;
    tally[winner.userId] = (tally[winner.userId] ?? 0) + 1;
  }

  return tally;
}

test("equal weights reproduce exact equal rotation", () => {
  const tally = simulateDedicatedHandlerPicks(
    [{ userId: "A", weight: 100 }, { userId: "B", weight: 100 }, { userId: "C", weight: 100 }],
    300
  );
  assert.equal(tally.A, 100);
  assert.equal(tally.B, 100);
  assert.equal(tally.C, 100);
});

test("60/40 weights converge to a ~60/40 split", () => {
  const tally = simulateDedicatedHandlerPicks(
    [{ userId: "A", weight: 60 }, { userId: "B", weight: 40 }],
    1000
  );
  assert.ok(Math.abs(tally.A - 600) <= 2, `expected A near 600, got ${tally.A}`);
  assert.ok(Math.abs(tally.B - 400) <= 2, `expected B near 400, got ${tally.B}`);
});

test("100/100/60 weights converge to their proportional split", () => {
  const tally = simulateDedicatedHandlerPicks(
    [{ userId: "A", weight: 100 }, { userId: "B", weight: 100 }, { userId: "C", weight: 60 }],
    10_000
  );
  const total = tally.A + tally.B + tally.C;
  assert.equal(total, 10_000);
  assert.ok(Math.abs(tally.A / total - 100 / 260) < 0.01, `A share off: ${tally.A / total}`);
  assert.ok(Math.abs(tally.B / total - 100 / 260) < 0.01, `B share off: ${tally.B / total}`);
  assert.ok(Math.abs(tally.C / total - 60 / 260) < 0.01, `C share off: ${tally.C / total}`);
});

test("weight 0 is excluded from every pick", () => {
  const tally = simulateDedicatedHandlerPicks(
    [{ userId: "A", weight: 100 }, { userId: "B", weight: 0 }],
    50
  );
  assert.equal(tally.A, 50);
  assert.equal(tally.B, undefined);
});

test("empty or all-zero weight set falls through with no picks", () => {
  assert.deepEqual(simulateDedicatedHandlerPicks([], 10), {});
  assert.deepEqual(simulateDedicatedHandlerPicks([{ userId: "A", weight: 0 }], 10), {});
});
