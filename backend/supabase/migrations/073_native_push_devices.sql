create table if not exists native_push_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('android', 'ios')),
  provider text not null default 'fcm' check (provider in ('fcm', 'apns')),
  device_id text,
  device_name text,
  app_id text,
  app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  unique (token)
);

create index if not exists idx_native_push_devices_user
  on native_push_devices(user_id, created_at desc);

create index if not exists idx_native_push_devices_org
  on native_push_devices(org_id, created_at desc);

create index if not exists idx_native_push_devices_platform
  on native_push_devices(platform, provider, created_at desc);
