// Refuses to ship a production build that cannot open a realtime connection.
//
// src/lib/realtime.ts creates the Supabase client only when BOTH VITE_SUPABASE_URL
// and VITE_SUPABASE_ANON_KEY are present, and exports null otherwise:
//
//   export const realtimeClient = url && anonKey ? createClient(...) : null;
//
// Every subscription then short-circuits on that null. That is correct for local
// dev without Supabase - but in production it means orders, notifications and
// abandoned carts silently stop arriving live and fall back to polling and
// manual refresh. Nothing anywhere says so.
//
// That is exactly what happened: the production bundle contained the realtime
// code and neither variable, so Supabase reported 0 realtime connections and 0
// messages, and reps refreshed the carts page by hand for months without anyone
// knowing why. A missing environment variable should break a build, not degrade
// a live app quietly.
//
// Local and preview builds only warn - the variables are legitimately absent
// when running against mock data.

const has = (name) => Boolean(String(process.env[name] ?? "").trim());
// Either key name is correct - Supabase issues publishable keys now and calls
// the older JWT one legacy.
const missing = [];
if (!has("VITE_SUPABASE_URL")) missing.push("VITE_SUPABASE_URL");
if (!has("VITE_SUPABASE_ANON_KEY") && !has("VITE_SUPABASE_PUBLISHABLE_KEY")) {
  missing.push("VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY)");
}

// Vercel sets VERCEL_ENV=production for a production deployment. CI covers other
// pipelines. Anything else is somebody building locally.
const isProductionDeploy =
  process.env.VERCEL_ENV === "production" ||
  (process.env.CI === "true" && process.env.VERCEL_ENV !== "preview");

if (missing.length === 0) {
  console.log("[realtime-env] Supabase realtime configured.");
  process.exit(0);
}

if (!isProductionDeploy) {
  console.warn(`[realtime-env] WARNING: ${missing.join(" and ")} not set.`);
  console.warn("[realtime-env] Live updates will be OFF in this build - the app will poll instead.");
  console.warn("[realtime-env] Fine for local work against mock data. Not fine in production.");
  process.exit(0);
}

console.error("\n[realtime-env] Refusing to build production without Supabase realtime.\n");
console.error(`Missing: ${missing.join(", ")}`);
console.error("\nWhy this matters: realtime.ts exports a null client when either is absent, so every");
console.error("subscription is skipped. Orders, notifications and abandoned carts stop arriving live");
console.error("and the app falls back to polling - with nothing on screen to say it happened.");
console.error("\nSet both in Vercel > Settings > Environment Variables (Production), then redeploy.");
console.error("Vite inlines VITE_* at BUILD time, so an existing deployment will not pick them up.\n");
process.exit(1);
