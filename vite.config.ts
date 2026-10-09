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

export default defineConfig({
  plugins: [react(), excludeHostedDownloads()],
  // The build a bug report was sent from (Issue Management, 9 Oct 2026).
  define: {
    __APP_BUILD__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : "local")
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
