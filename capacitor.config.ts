import type { CapacitorConfig } from "@capacitor/cli";

// LIVE MODE — the native Android shell loads the deployed web app directly (via
// server.url), so it ALWAYS has the latest features the moment the web deploys.
// No per-feature APK rebuild, no drift. The native plugins (FCM push, status bar,
// splash screen) keep working because the very same src/ code drives them inside
// the WebView (see src/lib/native-push.ts, src/lib/native-shell.ts).
//
// After changing anything in THIS file you must cut one signed APK release for it
// to take effect on devices (see MOBILE-RELEASE.md). Once a server.url build is
// live, future *web* features need NO native release — they appear automatically.
const config: CapacitorConfig = {
  appId: "com.protohub.app",          // must match the Play Store listing + google-services.json
  appName: "Protohub",
  webDir: "dist",                      // fallback bundle; server.url takes precedence at runtime
  server: {
    // Staff CRM production web app — the stable Vercel production alias (always
    // serves the latest production deploy). NOT brightpathhubs.com, which is the
    // customer-facing storefront. The build served here already points its API
    // calls at the prod backend (baked in at build time), so nothing else moves.
    url: "https://protohub-zeta.vercel.app",
    cleartext: false
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#ffffff",
      showSpinner: false
    }
  }
};

export default config;
