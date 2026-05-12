import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const warn = [];

function readFileIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function parseEnvFile(filePath) {
  const env = {};
  const source = readFileIfExists(filePath);
  if (!source) return env;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

function readConfigValue(key) {
  return (
    process.env[key] ??
    localBackendEnv[key] ??
    backendEnv[key] ??
    ""
  );
}

function parseCapacitorAppId() {
  const source = readFileIfExists(path.join(repoRoot, "capacitor.config.ts"));
  const match = source.match(/appId:\s*['"]([^'"]+)['"]/);
  return match?.[1] ?? "";
}

function parseBundleIds() {
  const source = readFileIfExists(path.join(repoRoot, "ios", "App", "App.xcodeproj", "project.pbxproj"));
  return [...source.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((match) => match[1].trim());
}

function check(label, ok, detail, failureDetail = detail) {
  const mark = ok ? "OK" : "MISSING";
  console.log(`${mark.padEnd(7)} ${label} — ${ok ? detail : failureDetail}`);
  if (!ok) warn.push(label);
}

const backendEnv = parseEnvFile(path.join(repoRoot, "backend", ".env"));
const localBackendEnv = parseEnvFile(path.join(repoRoot, "backend", ".env.local"));

const appId = parseCapacitorAppId();
const bundleIds = parseBundleIds();

const googleServicesPath = path.join(repoRoot, "android", "app", "google-services.json");
const entitlementsPath = path.join(repoRoot, "ios", "App", "App", "App.entitlements");

let androidPackageNames = [];
if (fs.existsSync(googleServicesPath)) {
  try {
    const googleServices = JSON.parse(fs.readFileSync(googleServicesPath, "utf8"));
    androidPackageNames = (googleServices.client ?? [])
      .map((client) => client?.client_info?.android_client_info?.package_name)
      .filter(Boolean);
  } catch (error) {
    warn.push("android google-services.json parse");
    console.log(`MISSING android google-services.json parse — ${error instanceof Error ? error.message : String(error)}`);
  }
}

const firebaseConfigured = Boolean(
  readConfigValue("FIREBASE_SERVICE_ACCOUNT_JSON") ||
  readConfigValue("FIREBASE_SERVICE_ACCOUNT_JSON_BASE64") ||
  readConfigValue("FIREBASE_SERVICE_ACCOUNT_JSON_PATH") ||
  (
    readConfigValue("FIREBASE_PROJECT_ID") &&
    readConfigValue("FIREBASE_CLIENT_EMAIL") &&
    readConfigValue("FIREBASE_PRIVATE_KEY")
  )
);

const apnsConfigured = Boolean(
  readConfigValue("APNS_KEY_ID") &&
  readConfigValue("APNS_TEAM_ID") &&
  readConfigValue("APNS_BUNDLE_ID") &&
  (
    readConfigValue("APNS_PRIVATE_KEY") ||
    readConfigValue("APNS_PRIVATE_KEY_BASE64") ||
    readConfigValue("APNS_PRIVATE_KEY_PATH")
  )
);

console.log("\nProtohub mobile push doctor\n");

check("Capacitor appId", Boolean(appId), appId || "set in capacitor.config.ts");
check("Android google-services.json", fs.existsSync(googleServicesPath), googleServicesPath, `add ${googleServicesPath}`);
check(
  "Android package name",
  !appId || androidPackageNames.length === 0 || androidPackageNames.includes(appId),
  androidPackageNames.length ? androidPackageNames.join(", ") : "no package names to validate yet",
  androidPackageNames.length
    ? `google-services.json package names (${androidPackageNames.join(", ")}) do not include ${appId}`
    : "add google-services.json to validate the Android package name"
);
check(
  "Firebase backend credentials",
  firebaseConfigured,
  "backend Firebase env values are present",
  "set FIREBASE_SERVICE_ACCOUNT_JSON[_BASE64|_PATH] or FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY"
);

const entitlementsSource = readFileIfExists(entitlementsPath);
check("iOS entitlements file", Boolean(entitlementsSource), entitlementsPath, `add ${entitlementsPath}`);
check(
  "iOS push entitlement",
  /aps-environment/.test(entitlementsSource),
  "aps-environment is wired",
  "enable aps-environment in ios/App/App/App.entitlements"
);
check(
  "iOS bundle identifier",
  !appId || bundleIds.length === 0 || bundleIds.every((bundleId) => bundleId === appId),
  bundleIds.length ? bundleIds.join(", ") : "no iOS bundle ids found",
  bundleIds.length
    ? `Xcode bundle ids (${bundleIds.join(", ")}) do not all match appId ${appId}`
    : "set PRODUCT_BUNDLE_IDENTIFIER in ios/App/App.xcodeproj"
);
check(
  "APNs backend credentials",
  apnsConfigured,
  `bundle=${readConfigValue("APNS_BUNDLE_ID") || "(missing)"} production=${readConfigValue("APNS_PRODUCTION") || "false"}`,
  "set APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID plus APNS_PRIVATE_KEY[_BASE64|_PATH]"
);

console.log("");
if (warn.length > 0) {
  console.log(`Mobile push is not store-ready yet. Missing checks: ${warn.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("Mobile push setup looks complete.");
}
