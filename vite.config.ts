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
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
