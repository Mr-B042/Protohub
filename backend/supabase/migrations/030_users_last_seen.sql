alter table if exists public.users
  add column if not exists last_seen_at timestamptz;

create index if not exists users_org_last_seen_idx
  on public.users (org_id, last_seen_at desc);
