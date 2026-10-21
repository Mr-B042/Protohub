import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { rm } from "node:fs/promises";

const excludeHostedDownloads = () => ({
  name: "exclude-hosted-downloads",
  apply: "build" as const,
  async closeBundle() {
    // The APK is downloaded from GitHub and must not be duplicated in every
    // retained Vercel deployment.
    await rm(path.resolve(__dirname, "dist/protohub.apk"), { force: true });
  },
});

const APP_BUILD = process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : "local";

// /version.json names the build that is live. An open app compares it with its
// own __APP_BUILD__ and reloads when they differ (src/components/AppUpdateWatcher).
const emitVersionFile = () => ({
  name: "emit-version-file",
  apply: "build" as const,
  generateBundle(this: { emitFile: (file: { type: "asset"; fileName: string; source: string }) => void }) {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: APP_BUILD }) });
  },
});

export default defineConfig({
  plugins: [react(), excludeHostedDownloads(), emitVersionFile()],
  // The build a bug report was sent from (Issue Management, 9 Oct 2026).
  define: {
    __APP_BUILD__: JSON.stringify(APP_BUILD)
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
