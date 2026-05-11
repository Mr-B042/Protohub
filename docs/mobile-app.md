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

## Important current limitation

This branch sets up the native shell only.

Push notifications in the current production app still rely on browser web push. Native push for Android/iOS will need a separate feature branch that adds:

- `@capacitor/push-notifications`
- APNs / Firebase configuration
- backend device-token handling
- app-side native push permission and registration flows

## Recommended next branch

Create a new branch from `develop` for native push, for example:

```bash
git checkout develop
git checkout -b feature/native-push-bridge
```
