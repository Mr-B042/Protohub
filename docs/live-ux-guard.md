# Live UX Guard

This project has a build-time guard for restored production UX that must not be lost when shipping new localhost work.

Run it before pushing any feature:

```bash
npm run guard:live-ui
```

The normal build also runs it:

```bash
npm run build
```

## What It Protects

- Global WhatsApp app picker: Normal WhatsApp vs WhatsApp Business.
- Assigned-rep order WhatsApp greeting.
- Owner/admin Orders dashboard Revenue KPI vs Sales Rep Bonus est. KPI.
- Orders, Follow-up Queue, and Closed Orders workspace restoration.
- Cart Details Customer Journey timeline and analytics.
- Ad Tracking Tracked Orders restored layout.
- Global mobile fixed topbar and content offset.
- Mobile-safe shared date range calendar.

## If It Fails

Do not push the feature as-is.

1. Fetch the latest live branch.

```bash
git fetch origin main
```

2. Rebase or merge the feature branch onto the latest `origin/main`.

3. Re-apply only the intended feature changes.

4. Run the guard and build again.

```bash
npm run guard:live-ui
npm run build
```

The goal is simple: a new feature can change these areas intentionally, but it should never silently remove them because local code was stale.

Pair this with the local sandbox policy in [local-sandbox.md](local-sandbox.md): localhost should run the same UI/features as production, but against a separate test Supabase project seeded with mock data.
