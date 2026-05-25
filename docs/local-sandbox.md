# Local Sandbox Policy

Localhost and production must run the same app code and the same UI. The only difference is the data source:

- Production uses the live Supabase project and live provider settings.
- Localhost uses a separate test Supabase project seeded with mock data.
- Localhost must not run background queues or WhatsApp runtime by default.

This gives us safe testing without creating a second interface that drifts away from production.

## Setup

1. Copy the local env examples:

```bash
cp .env.local.example .env.local
cp backend/.env.local.example backend/.env.local
```

2. Create or choose a separate Supabase project for local testing.

3. Put that test project's URL, anon key, and service-role key in `backend/.env.local`.

4. Put the same test project's public URL and anon key in `.env.local` if realtime is needed.

5. Paste the live Supabase URL into `PRODUCTION_SUPABASE_URL` inside `backend/.env.local`. This lets the backend block accidental local use of the production database.

6. Confirm the safety flags stay set:

```env
LOCAL_DATA_MODE=test-supabase
LOCAL_DATABASE_IS_MOCK=true
ENABLE_BACKGROUND_JOBS=0
ENABLE_WHATSAPP_RUNTIME=0
```

## Run Locally

Use the local scripts instead of the generic dev commands:

```bash
npm run local:sandbox:check
npm run backend:dev:local
npm run dev:local
```

`backend:dev:local` disables background jobs and WhatsApp runtime for the process. The backend also refuses to start unless local data mode is explicitly marked as a mock/test Supabase dataset.

## Mock Data

After the test Supabase schema has the latest migrations and at least one organization, user, and product, seed extra mock records:

```bash
ORG_ID=<test-org-id> npm --prefix backend run db:seed-agents
ORG_ID=<test-org-id> COUNT=80 npm --prefix backend run db:seed-orders
```

The order seed script skips email/push/in-app side effects unless `EMIT_SIDE_EFFECTS=true` is explicitly set.

## Release Guardrails

Before pushing UI changes, run:

```bash
npm run guard:live-ui
npm run build
npm --prefix backend run build
```

The live UX guard protects restored interface features like the global WhatsApp picker, Cart Details customer journey, tracked orders, mobile topbar, and Orders KPI role split. The local sandbox guard protects production data while we test those same features on localhost.
