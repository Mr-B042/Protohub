import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeSupabaseRuntime, isProductionRuntime, runtimeDataProfile } from "./local-safety.js";

const TEST_SUPABASE_URL = "https://test-project.supabase.co";

test("local backend refuses to start without an explicit mock/test data mode", () => {
  assert.throws(
    () => assertSafeSupabaseRuntime(TEST_SUPABASE_URL, { NODE_ENV: "development" }),
    /LOCAL_DATA_MODE=test-supabase/
  );
});

test("local backend accepts an explicitly marked test Supabase dataset", () => {
  assert.doesNotThrow(() => assertSafeSupabaseRuntime(TEST_SUPABASE_URL, {
    NODE_ENV: "development",
    LOCAL_DATA_MODE: "test-supabase",
    LOCAL_DATABASE_IS_MOCK: "true"
  }));
});

test("local backend blocks the configured production Supabase URL", () => {
  assert.throws(
    () => assertSafeSupabaseRuntime(TEST_SUPABASE_URL, {
      LOCAL_DATA_MODE: "test-supabase",
      LOCAL_DATABASE_IS_MOCK: "true",
      PRODUCTION_SUPABASE_URL: `${TEST_SUPABASE_URL}/`
    }),
    /matches PRODUCTION_SUPABASE_URL/
  );
});

test("hosted production runtime is not treated as a local sandbox", () => {
  const env = {
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT: "production"
  };

  assert.equal(isProductionRuntime(env), true);
  assert.deepEqual(runtimeDataProfile(env), {
    dataMode: "production",
    localSandbox: false
  });
  assert.doesNotThrow(() => assertSafeSupabaseRuntime(TEST_SUPABASE_URL, env));
});
