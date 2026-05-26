create table if not exists public.whatsapp_opt_outs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone text not null,
  normalized_phone text not null,
  source text not null default 'manual',
  keyword text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, normalized_phone)
);
create trigger whatsapp_opt_outs_updated_at
  before update on whatsapp_opt_outs
  for each row execute function set_updated_at();
create index if not exists idx_whatsapp_opt_outs_org_phone
  on public.whatsapp_opt_outs(org_id, normalized_phone);
alter table whatsapp_opt_outs enable row level security;
create policy "Owner/Admin see whatsapp opt outs"
  on whatsapp_opt_outs for select
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));
create policy "Owner/Admin manage whatsapp opt outs"
  on whatsapp_opt_outs for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));
