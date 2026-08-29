-- Per-browser-session presence. A single users.last_seen_at timestamp cannot
-- represent multiple devices and cannot safely mark one tab offline without
-- hiding another tab that is still open.
create table if not exists public.user_presence_sessions (
  session_id      uuid primary key,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  visible         boolean not null default true,
  last_seen_at    timestamptz not null default now(),
  disconnected_at timestamptz
);

create index if not exists user_presence_sessions_org_seen_idx
  on public.user_presence_sessions (org_id, last_seen_at desc);
create index if not exists user_presence_sessions_user_seen_idx
  on public.user_presence_sessions (user_id, last_seen_at desc);

alter table public.user_presence_sessions enable row level security;
create policy "Service role manages user presence sessions"
  on public.user_presence_sessions for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

-- Presence rows are disposable leases, not activity history. Keep one day for
-- diagnosis and remove older rows without touching users.last_seen_at.
create or replace function public.cleanup_stale_user_presence_sessions()
returns integer language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
  delete from public.user_presence_sessions where last_seen_at < now() - interval '1 day';
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.cleanup_stale_user_presence_sessions() from public, anon, authenticated;
grant execute on function public.cleanup_stale_user_presence_sessions() to service_role;

notify pgrst, 'reload schema';
