import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const backendRoot = process.cwd();
const defaultEnvPath = path.join(backendRoot, ".env");
const localEnvPath = path.join(backendRoot, ".env.local");

if (fs.existsSync(defaultEnvPath)) {
  dotenv.config({ path: defaultEnvPath });
}

if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath, override: true });
}
