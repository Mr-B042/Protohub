-- Our Store activity (Bright, 9 Nov 2026): "track every activity of this store
-- each of the roles has done… analytics only for the Owner".
-- A session = one visit to Our Store inside Protohub (start, last seen while the
-- page is open, pages gone through). Events = what happened: opened, a store
-- page loaded, opened the full store, and, once the store sends them, product
-- views, searches, add to cart, checkout, order. Written by the server only.

create table if not exists public.store_activity_sessions (
  id text primary key,
  org_id uuid not null,
  branch_id uuid,
  user_id uuid not null,
  user_name text not null default '',
  role text not null default '',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  pages integer not null default 0,
  device text not null default ''
);
create index if not exists store_activity_sessions_org_started on public.store_activity_sessions (org_id, started_at desc);
create index if not exists store_activity_sessions_user on public.store_activity_sessions (org_id, user_id, started_at desc);

create table if not exists public.store_activity_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  branch_id uuid,
  session_id text not null,
  user_id uuid not null,
  user_name text not null default '',
  role text not null default '',
  event text not null check (event in ('open', 'page', 'full_store', 'home', 'product', 'search', 'cart', 'checkout', 'order')),
  url text,
  title text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists store_activity_events_org_created on public.store_activity_events (org_id, created_at desc);
create index if not exists store_activity_events_session on public.store_activity_events (session_id);

alter table public.store_activity_sessions enable row level security;
alter table public.store_activity_events enable row level security;
