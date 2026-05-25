type EnvMap = Record<string, string | undefined>;

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const SAFE_LOCAL_DATA_MODES = new Set(["test-supabase"]);
const HOSTED_RUNTIME_MARKERS = [
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_DEPLOYMENT_ID",
  "VERCEL",
  "RENDER",
  "FLY_APP_NAME",
  "NORTHFLANK_PROJECT_ID",
  "NORTHFLANK_SERVICE_ID"
];

function readBool(value: string | undefined) {
  return TRUE_VALUES.has((value ?? "").trim().toLowerCase());
}

function normalizeUrl(value: string | undefined) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

export function isProductionRuntime(env: EnvMap = process.env) {
  if (readBool(env.PROTOHUB_PRODUCTION_RUNTIME)) return true;
  if ((env.NODE_ENV ?? "").trim().toLowerCase() === "production") return true;
  return HOSTED_RUNTIME_MARKERS.some((key) => Boolean(env[key]?.trim()));
}

export function runtimeDataProfile(env: EnvMap = process.env) {
  const productionRuntime = isProductionRuntime(env);
  const configuredMode = (env.LOCAL_DATA_MODE ?? "").trim().toLowerCase();

  return {
    dataMode: productionRuntime ? "production" : configuredMode || "unconfigured-local",
    localSandbox: !productionRuntime
  };
}

export function assertSafeSupabaseRuntime(supabaseUrl: string | undefined, env: EnvMap = process.env) {
  if (isProductionRuntime(env) || readBool(env.ALLOW_PROD_DB_LOCAL)) return;

  const localDataMode = (env.LOCAL_DATA_MODE ?? "").trim().toLowerCase();
  const localDatabaseIsMock = readBool(env.LOCAL_DATABASE_IS_MOCK);
  const productionSupabaseUrl = normalizeUrl(env.PRODUCTION_SUPABASE_URL);
  const configuredSupabaseUrl = normalizeUrl(supabaseUrl);
  const errors: string[] = [];

  if (!SAFE_LOCAL_DATA_MODES.has(localDataMode)) {
    errors.push("set LOCAL_DATA_MODE=test-supabase in backend/.env.local");
  }

  if (!localDatabaseIsMock) {
    errors.push("set LOCAL_DATABASE_IS_MOCK=true after pointing SUPABASE_URL at a test/mock Supabase project");
  }

  if (productionSupabaseUrl && configuredSupabaseUrl === productionSupabaseUrl) {
    errors.push("SUPABASE_URL matches PRODUCTION_SUPABASE_URL; use a separate local/test project");
  }

  if (configuredSupabaseUrl.includes("your-project-id.supabase.co")) {
    errors.push("replace the placeholder SUPABASE_URL with a real local/test Supabase URL");
  }

  if (errors.length > 0) {
    throw new Error([
      "Local backend refused to start because the data sandbox is not safe.",
      ...errors.map((message) => `- ${message}`),
      "If this is an intentional production-like backend, set PROTOHUB_PRODUCTION_RUNTIME=true in that hosted environment."
    ].join("\n"));
  }
}
