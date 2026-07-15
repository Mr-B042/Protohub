import assert from "node:assert/strict";
import test from "node:test";
import { fetchAllRows } from "./paginated-query.js";

test("fetchAllRows keeps reading after the first Supabase-sized page", async () => {
  const source = Array.from({ length: 2150 }, (_, index) => ({ id: index + 1 }));
  const calls: Array<[number, number]> = [];

  const result = await fetchAllRows(async (from, to) => {
    calls.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });

  assert.equal(result.error, null);
  assert.equal(result.data?.length, 2150);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.equal(result.data?.at(-1)?.id, 2150);
});

test("fetchAllRows stops and returns the database error", async () => {
  const failure = { message: "database unavailable" };
  const result = await fetchAllRows(async (from) => (
    from === 0
      ? { data: [{ id: 1 }], error: null }
      : { data: null, error: failure }
  ), 1);

  assert.equal(result.error, failure);
  assert.deepEqual(result.data, [{ id: 1 }]);
});
