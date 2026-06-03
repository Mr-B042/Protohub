# Native Android release (Capacitor — Live mode)

The Android app is a thin **Capacitor** shell around the web app. It runs in
**live mode**: [`capacitor.config.ts`](capacitor.config.ts) sets
`server.url = https://protohub-zeta.vercel.app`, so the native WebView loads the
**deployed web app**. The same `src/` code drives the native plugins (FCM push,
status bar, splash) inside that WebView.

### What this means
- **Web features appear in the app automatically** — every Vercel deploy shows up
  on next app launch. **No APK rebuild per feature, ever.**
- You only cut a new APK when you change **native** things: `capacitor.config.ts`,
  a Capacitor plugin/version, the app icon/splash, the appId, or Android perms.

---

## One-time setup of the native project (on a build machine)

Prereqs: Node, Android Studio + SDK, JDK 17, the **existing signing keystore**
(same one the current Play Store app was signed with — a *new* key cannot update
the existing listing), and `google-services.json` for `com.protohub.app`.

```bash
npm install
npm run build                 # produces dist/ (required as the webDir fallback)
npx cap add android           # first time only — generates the android/ project
# drop your Firebase client config in place:
cp /path/to/google-services.json android/app/google-services.json
npx cap sync android          # copies capacitor.config.ts + plugins into android/
npx cap open android          # opens Android Studio
```

`android/` and `google-services.json` are git-ignored on purpose — they're
regenerated from `capacitor.config.ts` and must not be committed.

## Brand icons (re-apply after `cap add android`)

The launcher icon + status-bar notification icon are NOT Capacitor defaults — they
must be regenerated into the fresh `android/` project:

```bash
node scripts/gen-android-icons.mjs   # writes the brand launcher + ic_stat_notify drawables
```

Then re-apply these two edits (lost when android/ is regenerated):

1. `android/app/src/main/res/values/ic_launcher_background.xml` — set the adaptive
   background + accent colour:
   ```xml
   <color name="ic_launcher_background">#20262E</color>
   <color name="notification_accent">#1F8FE0</color>
   ```
2. `android/app/src/main/AndroidManifest.xml` — inside `<application>`, the FCM
   defaults (brand white-silhouette small icon + accent tint; per-event colour is
   sent per-message and overrides it):
   ```xml
   <meta-data android:name="com.google.firebase.messaging.default_notification_icon"
              android:resource="@drawable/ic_stat_notify" />
   <meta-data android:name="com.google.firebase.messaging.default_notification_color"
              android:resource="@color/notification_accent" />
   ```

The icon design lives in `scripts/gen-android-icons.mjs` (SVG source) — edit there
to change it. `sharp` (used by the script) is resolved from `backend/node_modules`.

## Cutting the release (in Android Studio)

1. Bump **versionCode** (integer, must increase) and **versionName** in
   `android/app/build.gradle`.
2. **Build → Generate Signed Bundle/APK → Android App Bundle (.aab)**, signing
   with the **existing** keystore.
3. Upload the `.aab` to **Play Console → Production → Create new release**.

After this single release lands, your reps' phones load the live web app — so
the combo dispatch name, the net-profit column, the assignment push, and
everything we ship next are all there with **no further native work**.

## Verifying after install
- App opens straight into the live web app (pull-to-refresh shows current build).
- Log in as a rep → assign them an order from another account → their phone
  should get the **"Order Assigned"** push (native FCM via `com.protohub.app`).

## Changing the target URL
Edit `server.url` in `capacitor.config.ts`, then repeat *Cutting the release*.
`https://protohub-zeta.vercel.app` is the **staff CRM** production alias (stable —
always serves the latest production deploy). Do **not** point it at
`brightpathhubs.com`, which is the customer-facing storefront, not the staff app.
