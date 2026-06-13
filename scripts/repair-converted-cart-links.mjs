import { spawnSync } from "node:child_process";

const DEFAULT_LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DB_URL = process.env.DB_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || DEFAULT_LOCAL_DB;
const APPLY = process.argv.includes("--apply");

const runPsql = (sql) => {
  const result = spawnSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    console.error(result.stderr.trim() || result.stdout.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
};

const baseRowsSql = `
with submitted as (
  select distinct on (e.org_id, e.cart_id)
    e.org_id,
    e.cart_id,
    nullif(trim(coalesce(
      e.metadata->>'orderId',
      e.metadata->>'order_id',
      e.metadata->>'linkedOrderId',
      e.metadata->>'linked_order_id'
    )), '') as order_id,
    e.created_at as submitted_at
  from public.cart_journey_events e
  where e.event_type = 'order_submitted'
  order by e.org_id, e.cart_id, e.created_at desc
),
converted as (
  select
    c.org_id,
    c.id as cart_id,
    c.customer,
    c.phone,
    c.product_name,
    c.package_name,
    c.status,
    c.last_activity,
    s.order_id,
    s.submitted_at,
    o.id as journey_order_id,
    o.source_cart_id as journey_order_source_cart_id,
    already.id as already_linked_order_id,
    case
      when already.id is not null then 'already_linked'
      when s.order_id is null then 'manual_review:no_journey_order_id'
      when o.id is null then 'manual_review:journey_order_missing'
      when o.source_cart_id is not null and o.source_cart_id <> c.id then 'manual_review:order_linked_to_another_cart'
      when o.source_cart_id = c.id then 'already_linked'
      else 'repairable'
    end as repair_status
  from public.abandoned_carts c
  left join submitted s
    on s.org_id = c.org_id
   and s.cart_id = c.id
  left join public.orders o
    on o.org_id = c.org_id
   and o.id::text = s.order_id
  left join public.orders already
    on already.org_id = c.org_id
   and already.source_cart_id = c.id
  where c.status = 'Converted'
)
select coalesce(jsonb_agg(to_jsonb(converted) order by last_activity desc), '[]'::jsonb)::text
from converted;
`;

const applySql = `
with submitted as (
  select distinct on (e.org_id, e.cart_id)
    e.org_id,
    e.cart_id,
    nullif(trim(coalesce(
      e.metadata->>'orderId',
      e.metadata->>'order_id',
      e.metadata->>'linkedOrderId',
      e.metadata->>'linked_order_id'
    )), '') as order_id
  from public.cart_journey_events e
  where e.event_type = 'order_submitted'
  order by e.org_id, e.cart_id, e.created_at desc
),
repairable as (
  select c.org_id, c.id as cart_id, o.id as order_id
  from public.abandoned_carts c
  join submitted s
    on s.org_id = c.org_id
   and s.cart_id = c.id
  join public.orders o
    on o.org_id = c.org_id
   and o.id::text = s.order_id
  left join public.orders already
    on already.org_id = c.org_id
   and already.source_cart_id = c.id
  where c.status = 'Converted'
    and already.id is null
    and o.source_cart_id is null
)
update public.orders o
set source_cart_id = r.cart_id
from repairable r
where o.org_id = r.org_id
  and o.id = r.order_id
returning jsonb_build_object('order_id', o.id, 'cart_id', o.source_cart_id)::text;
`;

const rows = JSON.parse(runPsql(baseRowsSql) || "[]");
const summary = rows.reduce((acc, row) => {
  acc.total += 1;
  acc[row.repair_status] = (acc[row.repair_status] ?? 0) + 1;
  return acc;
}, { total: 0 });

console.log("[cart-link-repair] Converted cart link audit");
console.log(JSON.stringify(summary, null, 2));

const importantRows = rows.filter((row) => row.repair_status !== "already_linked");
if (importantRows.length) {
  console.log("\n[cart-link-repair] Rows needing attention:");
  for (const row of importantRows) {
    console.log([
      row.repair_status,
      `cart=${row.cart_id}`,
      `order=${row.order_id || "-"}`,
      `customer=${row.customer || "-"}`,
      `phone=${row.phone || "-"}`,
      `product=${row.product_name || "-"} / ${row.package_name || "-"}`,
      `last=${row.last_activity || "-"}`
    ].join(" | "));
  }
} else {
  console.log("\n[cart-link-repair] No converted carts need repair.");
}

if (!APPLY) {
  console.log("\n[cart-link-repair] Dry run only. Re-run with --apply to backfill repairable rows.");
  process.exit(0);
}

const applied = runPsql(applySql)
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

console.log(`\n[cart-link-repair] Applied ${applied.length} safe repair(s).`);
for (const row of applied) {
  console.log(`linked order=${row.order_id} -> cart=${row.cart_id}`);
}
