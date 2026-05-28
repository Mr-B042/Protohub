import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...args) => console.log("[insert-probe]", ...args);

const client = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 10 } } });
let receivedInsert = null;
let receivedUpdate = null;
let status = "pending";

const channel = client.channel("cart-both-probe")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "abandoned_carts" }, (payload) => {
    log(`received INSERT id=${payload.new?.id}`);
    receivedInsert = payload;
  })
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "abandoned_carts" }, (payload) => {
    log(`received UPDATE id=${payload.new?.id}`);
    receivedUpdate = payload;
  })
  .subscribe((s) => { status = s; log(`status: ${s}`); });

for (let i = 0; i < 50 && status !== "SUBSCRIBED"; i++) await sleep(100);

const cartId = `CART-RT-PROBE-${Date.now()}`;
const productId = "7e94da88-a9f0-48af-b88b-f0f87b9508cd";
const orgId = execSync(`psql "${DB_URL}" -At -c "SELECT org_id FROM products WHERE id='${productId}'"`).toString().trim();

log(`INSERT new cart ${cartId}...`);
execSync(`psql "${DB_URL}" -c "INSERT INTO abandoned_carts (id, org_id, customer, phone, product_id, product_name, package_name, amount, currency, source, status) VALUES ('${cartId}', '${orgId}', 'probe', '0', '${productId}', 'p', 'Trial', 0, 'NGN', 'Website', 'Open abandoned')" > /dev/null`);

await sleep(1500);

log(`UPDATE same cart...`);
execSync(`psql "${DB_URL}" -c "UPDATE abandoned_carts SET package_name='UPDATED-${Date.now()}' WHERE id='${cartId}'" > /dev/null`);

await sleep(2000);

await client.removeChannel(channel);

log(`INSERT received: ${Boolean(receivedInsert)}`);
log(`UPDATE received: ${Boolean(receivedUpdate)}`);

execSync(`psql "${DB_URL}" -c "DELETE FROM abandoned_carts WHERE id='${cartId}'" > /dev/null`);

if (!receivedInsert || !receivedUpdate) process.exit(1);
log("BOTH delivered.");
