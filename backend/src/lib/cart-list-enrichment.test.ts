import assert from "node:assert/strict";
import test from "node:test";
import { readScopedCartListEnrichment } from "./cart-list-enrichment.js";

type Row = Record<string, any>;
type ReadCall = { table: string; fields: string; equals: Record<string, unknown>; ids: { column: string; values: string[] }; from: number; to: number };

function database(tables: Record<string, Row[]>, failures: Record<string, { message: string }> = {}) {
  const calls: ReadCall[] = [];
  let active = 0;
  let most = 0;
  return {
    calls,
    most: () => most,
    from(table: string) {
      let fields = "";
      const equals: Record<string, unknown> = {};
      let ids = { column: "", values: [] as string[] };
      const orders: Array<{ column: string; ascending: boolean }> = [];
      const query = {
        select(value: string) { fields = value; return query; },
        eq(column: string, value: unknown) { equals[column] = value; return query; },
        in(column: string, values: string[]) { ids = { column, values: [...values] }; return query; },
        order(column: string, options: { ascending: boolean }) { orders.push({ column, ascending: options.ascending }); return query; },
        async range(from: number, to: number) {
          calls.push({ table, fields, equals: { ...equals }, ids, from, to });
          active++;
          most = Math.max(most, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active--;
          if (failures[table]) return { data: null, error: failures[table] };
          const rows = (tables[table] ?? [])
            .filter((row) => Object.entries(equals).every(([column, value]) => row[column] === value)
              && ids.values.includes(row[ids.column]))
            .sort((a, b) => {
              for (const { column, ascending } of orders) {
                const diff = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
                if (diff) return ascending ? diff : -diff;
              }
              return 0;
            })
            .slice(from, Math.min(to + 1, from + 1000));
          return { data: rows.map((row) => Object.fromEntries(fields.split(", ").map((column) => [column, row[column]]))), error: null };
        }
      };
      return query;
    }
  };
}

const attempt = (cartId: string, at: string, extra: Row = {}) => ({
  id: `${cartId}-${at}`, org_id: "org-1", cart_id: cartId, outcome_code: "Interested", attempted_at: at, ...extra
});
const deletion = (cartId: string, at: string, extra: Row = {}) => ({
  id: `${cartId}-${at}`, org_id: "org-1", source_cart_id: cartId, order_id: "ORDER-1", deleted_at: at,
  deleted_by_name: "Manager", note: "Duplicate order", ...extra
});

test("only returned cart IDs and the current org are read, preserving older matching history", async () => {
  const db = database({
    cart_contact_attempts: [
      attempt("visible", "2026-01-01T10:00:00Z", { outcome_code: "Unresponsive" }),
      attempt("visible", "2026-06-01T10:00:00Z"),
      attempt("not-returned", "2026-10-31T10:00:00Z"),
      attempt("visible", "2026-10-31T10:00:00Z", { org_id: "other-org" })
    ],
    deleted_orders: [
      deletion("visible", "2026-06-02T10:00:00Z"),
      deletion("not-returned", "2026-10-31T10:00:00Z"),
      deletion("visible", "2026-10-31T10:00:00Z", { org_id: "other-org" })
    ]
  });
  const result = await readScopedCartListEnrichment(db, { orgId: "org-1", cartIds: ["visible", "visible"], includeDeleted: true });
  assert.equal(result.attempts.data?.length, 2);
  assert.deepEqual(result.attempts.data?.[0], { cart_id: "visible", outcome_code: "Interested", attempted_at: "2026-06-01T10:00:00Z" });
  assert.deepEqual(result.deleted?.data, [{ order_id: "ORDER-1", source_cart_id: "visible", deleted_at: "2026-06-02T10:00:00Z", deleted_by_name: "Manager", note: "Duplicate order" }]);
  for (const call of db.calls) {
    assert.equal(call.equals.org_id, "org-1");
    assert.deepEqual(call.ids.values, ["visible"]);
    assert.equal(call.ids.column, call.table === "cart_contact_attempts" ? "cart_id" : "source_cart_id");
  }
});

test("metadata is paged beyond the server cap so a busy cart cannot hide another cart's latest call", async () => {
  const busy = Array.from({ length: 1000 }, (_, i) => attempt("busy", "2026-10-31T10:00:00Z", { id: `attempt-${String(i).padStart(4, "0")}` }));
  const db = database({ cart_contact_attempts: [...busy, attempt("quiet", "2026-01-01T10:00:00Z")], deleted_orders: [] });
  const result = await readScopedCartListEnrichment(db, { orgId: "org-1", cartIds: ["busy", "quiet"], includeDeleted: true });
  assert.equal(result.attempts.data?.length, 1001);
  assert.equal(result.attempts.data?.at(-1)?.cart_id, "quiet");
  assert.deepEqual(db.calls.filter((call) => call.table === "cart_contact_attempts").map(({ from, to }) => [from, to]), [[0, 999], [1000, 1999]]);
});

test("long ID lists are batched safely with no more than four metadata requests in flight", async () => {
  const ids = Array.from({ length: 451 }, (_, i) => `CART-${i}`);
  const db = database({ cart_contact_attempts: ids.map((id) => attempt(id, "2026-10-31T10:00:00Z")), deleted_orders: ids.map((id) => deletion(id, "2026-10-31T10:00:00Z")) });
  const result = await readScopedCartListEnrichment(db, { orgId: "org-1", cartIds: ids, includeDeleted: true });
  assert.equal(result.attempts.data?.length, ids.length);
  assert.equal(result.deleted?.data?.length, ids.length);
  const attemptReads = db.calls.filter((call) => call.table === "cart_contact_attempts");
  assert.deepEqual(attemptReads.map((call) => call.ids.values.length), [200, 200, 51]);
  assert.deepEqual(new Set(attemptReads.flatMap((call) => call.ids.values)), new Set(ids));
  assert.ok(db.most() > 1 && db.most() <= 4, `unexpected metadata concurrency: ${db.most()}`);
});

test("empty scoped results perform no metadata reads", async () => {
  const db = database({});
  const result = await readScopedCartListEnrichment(db, { orgId: "org-1", cartIds: [], includeDeleted: true });
  assert.deepEqual(result, { attempts: { data: [], error: null }, deleted: { data: [], error: null } });
  assert.equal(db.calls.length, 0);
});

test("maximum-length valid cart IDs stay within the metadata URL budget", async () => {
  const ids = Array.from({ length: 200 }, (_, i) => `CART-${String(i).padStart(75, "0")}`);
  const db = database({ cart_contact_attempts: [], deleted_orders: [] });
  await readScopedCartListEnrichment(db, { orgId: "org-1", cartIds: ids, includeDeleted: false });
  assert.ok(db.calls.length > 1);
  assert.deepEqual(db.calls.flatMap((call) => call.ids.values), ids);
  for (const call of db.calls) {
    assert.ok(call.ids.values.reduce((length, id) => length + encodeURIComponent(id).length + 3, 0) <= 6000);
  }
});

test("inventory list shape does not fetch deleted-order notes", async () => {
  const db = database({ cart_contact_attempts: [attempt("visible", "2026-10-31T10:00:00Z")], deleted_orders: [deletion("visible", "2026-10-31T10:00:00Z")] });
  const result = await readScopedCartListEnrichment(db, { orgId: "org-1", cartIds: ["visible"], includeDeleted: false });
  assert.equal(result.attempts.data?.length, 1);
  assert.equal(result.deleted, null);
  assert.deepEqual(db.calls.map((call) => call.table), ["cart_contact_attempts"]);
});

test("missing deletion-table errors remain available for the route's existing compatibility handling", async () => {
  const db = database({ cart_contact_attempts: [attempt("visible", "2026-10-31T10:00:00Z")] }, { deleted_orders: { message: "relation deleted_orders does not exist" } });
  const result = await readScopedCartListEnrichment(db, { orgId: "org-1", cartIds: ["visible"], includeDeleted: true });
  assert.equal(result.attempts.data?.length, 1);
  assert.equal(result.deleted?.data, null);
  assert.match(result.deleted?.error.message, /deleted_orders/);
});
