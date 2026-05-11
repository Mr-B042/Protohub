import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envFile = path.join(backendRoot, ".env");
const envLocalFile = path.join(backendRoot, ".env.local");

if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
}

if (fs.existsSync(envLocalFile)) {
  dotenv.config({ path: envLocalFile, override: true });
}
