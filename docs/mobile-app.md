# Protohub Mobile App Shell

Protohub now has a Capacitor shell so the existing React/Vite app can run as:

- an Android app project in `android/`
- an iOS app project in `ios/`

This keeps the current web codebase as the main UI while giving us native app packaging and native plugin support.

## What is already wired

- Capacitor core config in `capacitor.config.ts`
- Android project scaffold in `android/`
- iOS project scaffold in `ios/`
- Native-safe runtime bootstrap in `src/lib/native-shell.ts`
- Service worker auto-registration disabled inside the native shell
- Basic splash screen and status bar shell config

## Commands

From the repo root:

```bash
npm run mobile:doctor
npm run mobile:build
npm run mobile:open:android
npm run mobile:open:ios
```

`mobile:doctor` checks:

- Android `google-services.json`
- Firebase backend env readiness
- iOS bundle id alignment
- iOS push entitlement wiring
- APNs backend env readiness

## Day-to-day flow

1. Build the web app and sync it into the native shells:

```bash
npm run mobile:build
```

2. Open the native project you want to work on:

```bash
npm run mobile:open:android
```

or

```bash
npm run mobile:open:ios
```

3. Run/sign from Android Studio or Xcode.

## Native push status

The native shell now includes the native push bridge:

- `@capacitor/push-notifications` in the app shell
- backend device-token registration
- Android delivery via Firebase Cloud Messaging
- iOS delivery via Apple Push Notification service
- native push diagnostics in `Settings -> Workspace -> Push Notifications`

## Still required before store-ready delivery

You still need to provide the real platform credentials/files:

### Android

1. Put `google-services.json` in:

```text
android/app/google-services.json
```

2. Configure backend env with either:

```bash
FIREBASE_SERVICE_ACCOUNT_JSON_PATH=/absolute/path/to/firebase-service-account.json
```

or:

```bash
FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=
```

or the individual fields:

```bash
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

### iOS

1. The repo now includes `ios/App/App/App.entitlements` and push capability wiring.
2. In Xcode, set your real Apple signing team for `ios/App/App.xcodeproj`
3. Configure backend env with either:

```bash
APNS_PRIVATE_KEY_PATH=/absolute/path/to/AuthKey_XXXXXXXXXX.p8
```

or:

```bash
APNS_PRIVATE_KEY_BASE64=
```

or the inline key below:

```bash
APNS_KEY_ID=
APNS_TEAM_ID=
APNS_PRIVATE_KEY=
APNS_BUNDLE_ID=com.protohub.app
APNS_PRODUCTION=false
```

Without those credentials, the native app shell can register locally but the backend cannot deliver real mobile push.

## Notes about portability

- `npm run mobile:sync` now normalizes both:
  - iOS Swift package paths
  - Android Capacitor plugin paths
- That keeps both native projects portable across machines instead of baking one developer's absolute `node_modules` path into the checked-in shell.
