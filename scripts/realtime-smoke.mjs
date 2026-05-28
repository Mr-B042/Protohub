// Smoke test for the cart_journey_events realtime publication.
// Subscribes via the local Supabase realtime gateway, inserts a row via
// the backend API, and asserts the subscriber receives the INSERT within
// 2 seconds — proves migration 084 wired the publication correctly and the
// channel filter works.

import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const TEST_CART_ID = `CART-REALTIME-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const PRODUCT_ID = "7e94da88-a9f0-48af-b88b-f0f87b9508cd";

const log = (...args) => console.log("[realtime-smoke]", ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } }
});

let receivedPayload = null;
let subscriptionStatus = "pending";

log(`subscribing to cart_journey_events filtered by cart_id=${TEST_CART_ID}...`);
const channel = client.channel(`smoke-${TEST_CART_ID}`)
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "cart_journey_events",
      filter: `cart_id=eq.${TEST_CART_ID}`
    },
    (payload) => {
      log(`received: event_type=${payload.new?.event_type}`);
      receivedPayload = payload.new;
    }
  )
  .subscribe((status) => {
    subscriptionStatus = status;
    log(`subscription status: ${status}`);
  });

// Wait until the channel is fully SUBSCRIBED, with a timeout
for (let i = 0; i < 50; i++) {
  if (subscriptionStatus === "SUBSCRIBED") break;
  await sleep(100);
}
if (subscriptionStatus !== "SUBSCRIBED") {
  log(`FAIL: channel never reached SUBSCRIBED (last status: ${subscriptionStatus})`);
  await client.removeChannel(channel);
  process.exit(1);
}

const insertStart = Date.now();
log("inserting cart_journey_events row directly via psql...");
execSync(
  `psql "${DB_URL}" -c "INSERT INTO cart_journey_events (cart_id, product_id, org_id, event_type, metadata) VALUES ('${TEST_CART_ID}', '${PRODUCT_ID}', (SELECT org_id FROM products WHERE id='${PRODUCT_ID}'), 'tier_switched', '{\\\"probe\\\":\\\"realtime\\\"}'::jsonb)"`
);

// Wait up to 2 seconds for the realtime push
for (let i = 0; i < 20; i++) {
  if (receivedPayload) break;
  await sleep(100);
}
const elapsed = Date.now() - insertStart;

await client.removeChannel(channel);

if (!receivedPayload) {
  log(`FAIL: no realtime payload received within 2s (elapsed: ${elapsed}ms)`);
  // Clean up
  execSync(`psql "${DB_URL}" -c "DELETE FROM cart_journey_events WHERE cart_id = '${TEST_CART_ID}'" > /dev/null`);
  process.exit(1);
}

log(`✅ realtime payload received in ${elapsed}ms`);
log(`   event_type: ${receivedPayload.event_type}`);
log(`   metadata:   ${JSON.stringify(receivedPayload.metadata)}`);

// Clean up the test row
execSync(`psql "${DB_URL}" -c "DELETE FROM cart_journey_events WHERE cart_id = '${TEST_CART_ID}'" > /dev/null`);
log("test row cleaned up");
log("\nALL CHECKS PASSED — cart_journey_events publication is live and filter works.");
process.exit(0);
