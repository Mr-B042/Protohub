import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const packageFile = path.join(repoRoot, "ios", "App", "CapApp-SPM", "Package.swift");
const androidSettingsFile = path.join(repoRoot, "android", "capacitor.settings.gradle");

function normalizeIosPackagePaths() {
  if (!fs.existsSync(packageFile)) {
    console.warn("[mobile-sync] iOS Swift package file not found, skipping path normalization.");
    return;
  }

  const source = fs.readFileSync(packageFile, "utf8");
  const nodeModulesRoot = path.relative(path.dirname(packageFile), path.join(repoRoot, "node_modules"));

  const normalized = source.replace(
    /(\.package\(name:\s*"[^"]+",\s*path:\s*")([^"]*?node_modules\/)([^"]+)("\))/g,
    (_, prefix, _oldRoot, suffix, end) => `${prefix}${nodeModulesRoot}/${suffix}${end}`
  );

  if (normalized !== source) {
    fs.writeFileSync(packageFile, normalized);
    console.log(`[mobile-sync] normalized iOS Swift package paths to ${nodeModulesRoot}/...`);
  } else {
    console.log("[mobile-sync] iOS Swift package paths already normalized.");
  }
}

function normalizeAndroidSettingsPaths() {
  if (!fs.existsSync(androidSettingsFile)) {
    console.warn("[mobile-sync] Android capacitor.settings.gradle not found, skipping path normalization.");
    return;
  }

  const source = fs.readFileSync(androidSettingsFile, "utf8");
  const nodeModulesRoot = path.relative(path.dirname(androidSettingsFile), path.join(repoRoot, "node_modules"));

  const normalized = source.replace(
    /(project\(':[^']+'\)\.projectDir = new File\(')([^']*?node_modules\/)([^']+)('\))/g,
    (_, prefix, _oldRoot, suffix, end) => `${prefix}${nodeModulesRoot}/${suffix}${end}`
  );

  if (normalized !== source) {
    fs.writeFileSync(androidSettingsFile, normalized);
    console.log(`[mobile-sync] normalized Android Capacitor paths to ${nodeModulesRoot}/...`);
  } else {
    console.log("[mobile-sync] Android Capacitor paths already normalized.");
  }
}

normalizeIosPackagePaths();
normalizeAndroidSettingsPaths();
