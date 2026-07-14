-- Append-only Owner decisions that waive or restore a weekly sales-log compliance deduction.

create table if not exists public.sales_expansion_compliance_waivers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_id uuid not null references public.users(id) on delete cascade,
  week_start date not null,
  active boolean not null,
  reason text not null check (char_length(trim(reason)) >= 5),
  created_by uuid not null references public.users(id) on delete restrict,
  created_by_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_expansion_compliance_waivers_latest
  on public.sales_expansion_compliance_waivers (org_id, rep_id, week_start, created_at desc);

alter table public.sales_expansion_compliance_waivers enable row level security;

create policy "sales expansion compliance waivers read scope"
  on public.sales_expansion_compliance_waivers
  for select to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or rep_id = auth.uid())
  );

create policy "sales expansion compliance waivers owner insert"
  on public.sales_expansion_compliance_waivers
  for insert to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
    and created_by = auth.uid()
  );

notify pgrst, 'reload schema';
