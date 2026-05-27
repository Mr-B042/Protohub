import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

const cwd = process.cwd();
const repoRoot = path.basename(cwd) === "backend" ? path.dirname(cwd) : cwd;
const backendRoot = path.join(repoRoot, "backend");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const result = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function mergeEnv(...sources) {
  return Object.assign({}, ...sources);
}

function readBool(value) {
  return TRUE_VALUES.has(String(value ?? "").trim().toLowerCase());
}

function readFalse(value) {
  return FALSE_VALUES.has(String(value ?? "").trim().toLowerCase());
}

function normalizeUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function isLocalApiUrl(value) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function labelUrl(value) {
  if (!value) return "(not set)";
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return "(invalid URL)";
  }
}

function migrationVersionsFromFiles() {
  const migrationsDir = path.join(backendRoot, "supabase", "migrations");
  if (!fs.existsSync(migrationsDir)) return [];
  return fs.readdirSync(migrationsDir)
    .map((name) => name.match(/^(\d+)_.*\.sql$/)?.[1])
    .filter(Boolean)
    .sort();
}

function localMigrationDbUrl(env) {
  if (env.LOCAL_SUPABASE_DB_URL) return env.LOCAL_SUPABASE_DB_URL;
  try {
    const parsed = new URL(env.SUPABASE_URL ?? "");
    const isLocalSupabase = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (!isLocalSupabase || parsed.port !== "54321") return "";
    const host = parsed.hostname === "::1" ? "[::1]" : parsed.hostname;
    return `postgresql://postgres:postgres@${host}:54322/postgres`;
  } catch {
    return "";
  }
}

function appliedMigrationVersions(dbUrl) {
  const output = execFileSync(
    "psql",
    [
      dbUrl,
      "-Atc",
      "select version from supabase_migrations.schema_migrations order by version;"
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

const frontendEnv = mergeEnv(
  parseEnvFile(path.join(repoRoot, ".env")),
  parseEnvFile(path.join(repoRoot, ".env.local")),
  process.env
);

const backendEnv = mergeEnv(
  parseEnvFile(path.join(backendRoot, ".env")),
  parseEnvFile(path.join(backendRoot, ".env.local")),
  process.env
);

const errors = [];
const warnings = [];

if (!isLocalApiUrl(frontendEnv.VITE_API_URL)) {
  errors.push("VITE_API_URL must point to localhost/127.0.0.1 for local testing.");
}

if (
  frontendEnv.VITE_SUPABASE_URL &&
  backendEnv.SUPABASE_URL &&
  normalizeUrl(frontendEnv.VITE_SUPABASE_URL) !== normalizeUrl(backendEnv.SUPABASE_URL)
) {
  errors.push("VITE_SUPABASE_URL must match the backend test Supabase URL when realtime is enabled locally.");
}

if (
  frontendEnv.VITE_SUPABASE_URL &&
  backendEnv.PRODUCTION_SUPABASE_URL &&
  normalizeUrl(frontendEnv.VITE_SUPABASE_URL) === normalizeUrl(backendEnv.PRODUCTION_SUPABASE_URL)
) {
  errors.push("VITE_SUPABASE_URL matches PRODUCTION_SUPABASE_URL.");
}

if (!backendEnv.SUPABASE_URL) {
  errors.push("backend SUPABASE_URL is missing.");
}

if (!backendEnv.SUPABASE_SERVICE_ROLE_KEY) {
  errors.push("backend SUPABASE_SERVICE_ROLE_KEY is missing.");
}

if (String(backendEnv.LOCAL_DATA_MODE ?? "").trim().toLowerCase() !== "test-supabase") {
  errors.push("backend LOCAL_DATA_MODE must be test-supabase.");
}

if (!readBool(backendEnv.LOCAL_DATABASE_IS_MOCK)) {
  errors.push("backend LOCAL_DATABASE_IS_MOCK must be true after configuring a separate test/mock database.");
}

if (
  backendEnv.PRODUCTION_SUPABASE_URL &&
  normalizeUrl(backendEnv.SUPABASE_URL) === normalizeUrl(backendEnv.PRODUCTION_SUPABASE_URL)
) {
  errors.push("backend SUPABASE_URL matches PRODUCTION_SUPABASE_URL.");
}

if (backendEnv.SUPABASE_URL?.includes("your-project-id.supabase.co")) {
  errors.push("backend SUPABASE_URL is still the placeholder value.");
}

if (!readFalse(backendEnv.ENABLE_BACKGROUND_JOBS)) {
  warnings.push("ENABLE_BACKGROUND_JOBS is not disabled in env files. backend dev:local disables it at runtime.");
}

if (!readFalse(backendEnv.ENABLE_WHATSAPP_RUNTIME)) {
  warnings.push("ENABLE_WHATSAPP_RUNTIME is not disabled in env files. backend dev:local disables it at runtime.");
}

const migrationDbUrl = localMigrationDbUrl(backendEnv);
if (migrationDbUrl) {
  try {
    const expectedVersions = migrationVersionsFromFiles();
    const appliedVersions = appliedMigrationVersions(migrationDbUrl);
    const missingVersions = expectedVersions.filter((version) => !appliedVersions.has(version));
    if (missingVersions.length > 0) {
      errors.push(
        `local Supabase is missing migrations: ${missingVersions.join(", ")}. Run: cd backend && supabase db push --local --include-all --yes`
      );
    }
  } catch (error) {
    errors.push(
      `could not verify local Supabase migrations (${error?.message ?? "unknown error"}). Start Supabase locally or set LOCAL_SUPABASE_DB_URL.`
    );
  }
}

console.log("Local sandbox check");
console.log(`- Frontend API: ${labelUrl(frontendEnv.VITE_API_URL || "http://localhost:4000")}`);
console.log(`- Backend data mode: ${backendEnv.LOCAL_DATA_MODE || "(not set)"}`);
console.log(`- Backend mock/test flag: ${readBool(backendEnv.LOCAL_DATABASE_IS_MOCK) ? "yes" : "no"}`);
console.log(`- Backend Supabase host: ${labelUrl(backendEnv.SUPABASE_URL)}`);
console.log(`- Local migrations: ${migrationDbUrl ? "verified" : "not checked (non-local Supabase URL)"}`);

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`);
}

if (errors.length > 0) {
  console.error("\nRefusing local sandbox start:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  console.error("\nUse docs/local-sandbox.md and backend/.env.local.example to point localhost at mock/test data.");
  process.exit(1);
}

console.log("Local sandbox config looks safe.");
