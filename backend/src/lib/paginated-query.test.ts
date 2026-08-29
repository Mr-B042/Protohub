import assert from "node:assert/strict";
import test from "node:test";
import { fetchAllRows } from "./paginated-query.js";
import { fetchAllRowsOrThrow } from "./query-limits.js";

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

test("fetchAllRows stops rather than paging forever on a growing table", async () => {
  // Every page comes back full, so the short-page check never fires. Without a
  // page ceiling this loop would never return.
  let pages = 0;
  const result = await fetchAllRows(async () => {
    pages += 1;
    return { data: [{ id: pages }], error: null };
  }, 1);

  assert.equal(result.error, null);
  assert.ok(pages <= 201, `expected the loop to stop, made ${pages} requests`);
});

test("fetchAllRowsOrThrow rebuilds the query for every page", async () => {
  // A PostgREST builder is single-use: reusing one returns page one forever.
  // The wrapper must call build() per page, not once.
  const source = Array.from({ length: 2100 }, (_, index) => ({ id: index + 1 }));
  let builds = 0;

  const rows = await fetchAllRowsOrThrow<{ id: number }>(() => {
    builds += 1;
    return {
      range: async (from: number, to: number) => ({ data: source.slice(from, to + 1), error: null })
    };
  });

  assert.equal(rows.length, 2100);
  assert.equal(builds, 3);
  assert.equal(rows.at(-1)?.id, 2100);
});

test("fetchAllRowsOrThrow turns a returned error into a throw", async () => {
  await assert.rejects(
    () => fetchAllRowsOrThrow<{ id: number }>(() => ({
      range: async () => ({ data: null, error: { message: "database unavailable" } })
    })),
    /database unavailable/
  );
});
