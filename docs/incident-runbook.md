# Incident Runbook — "Live data temporarily unavailable"

Practical playbook for when the app shows **"Live data is temporarily unavailable.
Showing cached data while reconnecting"** or the Supabase project goes **Unhealthy**.

## What the banner means
The frontend shows it only when the **entire API batch fails** (`src/App.tsx`,
`setDataError`). The client already retries, refreshes tokens, and fails over —
so a full-batch failure means the **backend/DB is genuinely unreachable**, not a
UI bug. Root cause is almost always the **Supabase project being overwhelmed on
the MICRO compute tier** (shared CPU, ~1 GB RAM, ~60 connections).

## 1. Confirm (30 seconds)
- Supabase Dashboard → project **status**. If DB/PostgREST/Auth show *Unhealthy*,
  it's a Supabase-side overload, not the app.
- A recently restarted project needs **~5 min** to go healthy — wait before acting.
- If it's healthy but the app still shows the banner, check Railway backend logs.

## 2. Shed load immediately (stops the pile-on)
Set these on **Railway** (backend env vars), then redeploy/restart the service:
- `ENABLE_BACKGROUND_JOBS=0` — halts **all** crons (cart auto-submit, cart
  recovery, SMS delivery/reminder syncs, follow-up notifications, follow-up
  nightly close, cart-journey prune). Removes the biggest recurring query load.
- `ENABLE_WHATSAPP_RUNTIME=0` — stops the Baileys runtime + its reconnect loop
  (the session-blob upsert churn that seized the DB twice before).

Also, if a WhatsApp number is restricted/looping, pause dispatch in-app:
`UPDATE whatsapp_settings SET enabled = false WHERE org_id = '<org>';`
(the send path early-returns when disabled).

## 3. Kill the worst queries (if the DB is up but choked)
```sql
-- Longest-running non-idle queries right now
SELECT pid, now()-query_start AS runtime, state, left(query,120) AS query
FROM pg_stat_activity
WHERE state <> 'idle' AND query NOT ILIKE '%pg_stat_activity%'
ORDER BY runtime DESC LIMIT 10;

-- Terminate a specific offender
SELECT pg_terminate_backend(<pid>);
```
Connection pressure check (MICRO cap is ~60):
```sql
SELECT count(*) total, count(*) FILTER (WHERE state='active') active,
       count(*) FILTER (WHERE wait_event_type='Lock') waiting_locks
FROM pg_stat_activity;
```

## 4. Restore
- If the DB is seized (queries timing out, lock waits piling up): **restart the
  project** from the Supabase Dashboard. This clears a connection/lock pileup fast.
- Wait ~5 min for services to report Healthy.
- Verify: `SELECT 1;` returns; connection count back to a low baseline.

## 5. Re-enable gradually
- Turn `ENABLE_BACKGROUND_JOBS` back to `1`, redeploy, watch for a few minutes.
- Turn `ENABLE_WHATSAPP_RUNTIME` back to `1` **only** if the WhatsApp number is
  healthy (not restricted) — otherwise leave it off to avoid the reconnect churn.
- Re-enable in-app WhatsApp dispatch (`whatsapp_settings.enabled = true`) last.

## 6. Fix the root cause (so it stops recurring)
- **Upgrade Supabase compute: Micro → Small** (Project Settings → Compute and
  Disk). This is the durable fix for the connection/RAM ceiling behind the
  outages. ~$10–15/mo. Restarting only clears it temporarily.
- Set up **alerts** (Supabase Dashboard): sustained high RAM, high connection
  count, high disk. Early warning before the banner ever shows.

## Known load hot-spots (kept in check — re-check if they climb)
- `cart_journey_events`: append-only, ~1,400 rows/day. Pruned nightly to 30 days
  (`CART_JOURNEY_RETENTION_DAYS`). If it balloons, lower the window; disk shrink
  needs an **off-hours** `VACUUM FULL` (it's a hot write table — never mid-day).
- `whatsapp_user_accounts` / `whatsapp_settings`: session-blob churn re-bloats
  them. `VACUUM (FULL, ANALYZE)` reclaims (safe while WhatsApp is paused).
- Dashboard orders load is progressive (recent 90 days on the critical path,
  full history in the background) — don't revert it to a single `limit: 5000`.

Related: `docs/northflank-backup-rollout.md` for the backend host, and the
progressive-load / retention changes in `src/App.tsx` and
`backend/src/lib/cart-journey.ts`.
