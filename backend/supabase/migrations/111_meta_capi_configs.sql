-- Migration 111: owner-managed Meta Conversions API configs.
--
-- Tokens stay server-side. Public embed links reference these rows by
-- tracking_key instead of exposing a CAPI access token in browser code.

create table if not exists public.meta_capi_configs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  tracking_key text not null,
  label text not null,
  mode text not null default 'protohub',
  pixel_id text not null,
  access_token text not null,
  active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_capi_configs_mode_check check (mode in ('protohub', 'hybrid', 'landing_page', 'off')),
  constraint meta_capi_configs_tracking_key_check check (tracking_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{1,119}$'),
  constraint meta_capi_configs_org_tracking_key_unique unique (org_id, tracking_key)
);

drop trigger if exists meta_capi_configs_updated_at on public.meta_capi_configs;
create trigger meta_capi_configs_updated_at
  before update on public.meta_capi_configs
  for each row execute function public.set_updated_at();

create index if not exists meta_capi_configs_org_active_idx
  on public.meta_capi_configs (org_id, active, label);

alter table public.meta_capi_configs enable row level security;

drop policy if exists "Owner manages meta capi configs"
  on public.meta_capi_configs;

create policy "Owner manages meta capi configs"
  on public.meta_capi_configs
  for all
  to authenticated
  using (org_id = private.auth_org_id() and private.auth_user_role() = 'Owner')
  with check (org_id = private.auth_org_id() and private.auth_user_role() = 'Owner');
