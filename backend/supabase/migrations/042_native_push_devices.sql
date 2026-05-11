create table if not exists native_push_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  token text not null,
  device_name text not null default '',
  app_id text not null default '',
  app_version text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (org_id, token)
);

create index if not exists idx_native_push_devices_org_user
  on native_push_devices(org_id, user_id, updated_at desc);

create index if not exists idx_native_push_devices_user
  on native_push_devices(user_id, updated_at desc);
