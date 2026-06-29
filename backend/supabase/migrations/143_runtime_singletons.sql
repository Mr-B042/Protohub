-- Lease-based leader election so only ONE backend instance runs a given background
-- runtime (the Baileys WhatsApp socket). Two instances each running Baileys means two
-- clients on one WhatsApp number (session conflicts + ban risk) AND both rewriting the
-- shared session row (the lock contention that seized the DB on 2026-06-29). A
-- heartbeated lease is used instead of a pg advisory lock because the backend talks to
-- Postgres through a connection pool, where session-level advisory locks aren't stable.
create table if not exists public.runtime_singletons (
  name         text primary key,
  holder       text not null,
  heartbeat_at timestamptz not null default now()
);

alter table public.runtime_singletons enable row level security;
-- No policies: only the service role (backend) — which bypasses RLS — may touch it.

-- Atomically claim/renew a lease. Returns true if the caller now holds it. The caller
-- wins only when the row is absent, already theirs, or the current holder's heartbeat
-- is older than p_ttl_seconds (i.e. that instance died).
create or replace function public.claim_runtime_singleton(p_name text, p_holder text, p_ttl_seconds int)
returns boolean
language plpgsql
as $$
declare current_holder text;
begin
  insert into public.runtime_singletons (name, holder, heartbeat_at)
  values (p_name, p_holder, now())
  on conflict (name) do update
    set holder = p_holder, heartbeat_at = now()
    where runtime_singletons.holder = p_holder
       or runtime_singletons.heartbeat_at < now() - make_interval(secs => p_ttl_seconds);
  select holder into current_holder from public.runtime_singletons where name = p_name;
  return current_holder = p_holder;
end;
$$;
