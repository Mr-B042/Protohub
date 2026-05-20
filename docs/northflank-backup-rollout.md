# Northflank Backup Rollout

This sets up Northflank as a passive backup backend for Protohub while Railway stays primary.

## What this gives you

- a second always-on backend outside Railway
- the same Supabase production database
- safe passive mode by default
- frontend failover support when Railway is unavailable

## Files prepared in this repo

- [backend/Dockerfile.northflank](/private/tmp/protohub-pulse-range/backend/Dockerfile.northflank)
- [backend/Dockerfile.northflank.dockerignore](/private/tmp/protohub-pulse-range/backend/Dockerfile.northflank.dockerignore)
- [backend/.env.northflank.example](/private/tmp/protohub-pulse-range/backend/.env.northflank.example)
- [src/lib/backend-origin.ts](/private/tmp/protohub-pulse-range/src/lib/backend-origin.ts)

## Northflank service settings

Create a service with:

- build type: `Dockerfile`
- build context: `/backend`
- Dockerfile location: `/backend/Dockerfile.northflank`
- port: `4000`
- health check path: `/health`

## Required env vars

Copy the same production backend secrets from Railway, especially:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `FRONTEND_URL`
- `FRONTEND_URLS`
- your mail, SMS, push, and Firebase env vars

Fastest starting point:

- [backend/.env.northflank.example](/private/tmp/protohub-pulse-range/backend/.env.northflank.example)

Then set these backup values:

```env
PUBLIC_API_URL=https://<your-northflank-domain>
ENABLE_BACKGROUND_JOBS=false
```

## Frontend failover env

Once the Northflank backend is live, set the frontend env like this:

```env
VITE_API_URL=https://protohub-production.up.railway.app
VITE_API_FALLBACK_URLS=https://<your-northflank-domain>
```

The frontend will keep Railway as primary and try Northflank automatically when the primary is unreachable or returns `502`, `503`, or `504`.

## Promotion rules during an outage

### Normal mode

- Railway stays primary
- Northflank stays passive
- `ENABLE_BACKGROUND_JOBS=false`

This avoids duplicate cron jobs and duplicate reminder processing.

### If Railway goes down briefly

- let the frontend fail over to Northflank
- keep Northflank passive

### If Railway is down for a long time

After you confirm Railway is really down or intentionally stopped, you can promote Northflank by changing:

```env
ENABLE_BACKGROUND_JOBS=true
```

## Health check behavior

`/health` now returns:

- `status`
- `timestamp`
- `backgroundJobsEnabled`

## Recommended first test

1. Deploy the Northflank backend in passive mode
2. Open `https://<your-northflank-domain>/health`
3. Confirm:
   - `status: ok`
   - `backgroundJobsEnabled: false`
4. Add the Northflank URL to `VITE_API_FALLBACK_URLS`
5. Redeploy the frontend
6. Simulate primary outage and confirm the app still works through the backup
