import assert from "node:assert/strict";
import test from "node:test";
import { fetchPagesTogether } from "./paged-fetch.js";

const table = Array.from({ length: 4815 }, (_, i) => ({ id: i }));
const reader = (rows: any[], { count = true, cap = 1000, failAt = -1 } = {}) => {
  const calls: Array<[number, number]> = [];
  let inFlight = 0; let most = 0;
  const readPage = async (from: number, to: number, withCount: boolean) => {
    calls.push([from, to]); inFlight++; most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    if (from === failAt) return { data: null, error: { message: "boom" } };
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null, count: withCount && count ? rows.length : null };
  };
  return { readPage, calls, most: () => most };
};

test("all rows, in order, pages asked for together", async () => {
  const r = reader(table);
  const out = await fetchPagesTogether(r.readPage, { limit: 50000 });
  assert.deepEqual(out.rows, table);
  assert.equal(out.total, 4815);
  assert.equal(r.calls.length, 5);
  assert.ok(r.most() > 1 && r.most() <= 4);
});

test("respects start and limit (one page of a paged list)", async () => {
  const out = await fetchPagesTogether(reader(table).readPage, { start: 25, limit: 25 });
  assert.deepEqual(out.rows, table.slice(25, 50));
  const big = await fetchPagesTogether(reader(table).readPage, { start: 1000, limit: 2500 });
  assert.deepEqual(big.rows, table.slice(1000, 3500));
});

test("no total: falls back to one page after another", async () => {
  const r = reader(table, { count: false });
  const out = await fetchPagesTogether(r.readPage, { limit: 50000 });
  assert.deepEqual(out.rows, table);
  assert.equal(r.most(), 1);
});

test("an exact multiple of the page size and an empty list", async () => {
  assert.deepEqual((await fetchPagesTogether(reader(table.slice(0, 3000)).readPage, { limit: 50000 })).rows, table.slice(0, 3000));
  assert.deepEqual((await fetchPagesTogether(reader([]).readPage, { limit: 50000 })).rows, []);
});

test("a failed page fails the whole list", async () => {
  const out = await fetchPagesTogether(reader(table, { failAt: 2000 }).readPage, { limit: 50000 });
  assert.equal(out.error?.message, "boom");
  assert.deepEqual(out.rows, []);
});
