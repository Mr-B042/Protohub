-- Mandatory, auditable upsell and cross-sell logging for eligible confirmed orders.

create table if not exists public.sales_expansion_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  enforcement_mode text not null default 'block_confirmation'
    check (enforcement_mode in ('block_confirmation', 'flag_only', 'measure_only')),
  enforcement_starts_at timestamptz not null default now(),
  attempt_target_pct numeric(5,2) not null default 85 check (attempt_target_pct between 0 and 100),
  logging_target_pct numeric(5,2) not null default 100 check (logging_target_pct between 0 and 100),
  cross_sell_conversion_target_pct numeric(5,2) not null default 10 check (cross_sell_conversion_target_pct between 0 and 100),
  audit_sample_pct numeric(5,2) not null default 10 check (audit_sample_pct between 0 and 100),
  full_bonus_compliance_pct numeric(5,2) not null default 98 check (full_bonus_compliance_pct between 0 and 100),
  warning_compliance_pct numeric(5,2) not null default 95 check (warning_compliance_pct between 0 and 100),
  minimum_compliance_pct numeric(5,2) not null default 90 check (minimum_compliance_pct between 0 and 100),
  warning_reduction_pct numeric(5,2) not null default 5 check (warning_reduction_pct between 0 and 100),
  minimum_reduction_pct numeric(5,2) not null default 10 check (minimum_reduction_pct between 0 and 100),
  pip_consecutive_weeks integer not null default 2 check (pip_consecutive_weeks between 1 and 12),
  title text not null default 'Upsell & Cross-sell Log',
  guidance text not null default 'Secure the main order first. Offer one useful upgrade and one relevant companion. Accept a clear refusal and return to confirming the original order.',
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_sales_expansion_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id text not null references public.orders(id) on delete cascade,
  rep_id uuid not null references public.users(id) on delete restrict,
  contact_attempt_id uuid references public.order_contact_attempts(id) on delete set null,
  idempotency_key text not null,
  eligibility text not null check (eligibility in ('eligible', 'exempt')),
  exemption_reason text,
  exemption_note text,
  original_product_id uuid references public.products(id) on delete set null,
  original_product_name text not null,
  original_package_id uuid references public.product_packages(id) on delete set null,
  original_package_name text,
  original_quantity integer not null check (original_quantity > 0),
  original_order_value numeric(12,2) not null check (original_order_value >= 0),
  final_order_value numeric(12,2) not null check (final_order_value >= 0),
  currency text not null default 'NGN',
  rep_note text not null default '',
  record_status text not null default 'active' check (record_status in ('active', 'voided', 'superseded')),
  supersedes_attempt_id uuid references public.order_sales_expansion_attempts(id) on delete set null,
  correction_reason text,
  audit_status text not null default 'pending' check (audit_status in ('pending', 'verified', 'flagged')),
  audit_note text,
  audited_by uuid references public.users(id) on delete set null,
  audited_at timestamptz,
  automatic_flags jsonb not null default '[]'::jsonb,
  attempted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);

create table if not exists public.order_sales_expansion_offer_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  attempt_id uuid not null references public.order_sales_expansion_attempts(id) on delete cascade,
  order_id text not null references public.orders(id) on delete cascade,
  offer_type text not null check (offer_type in ('upsell', 'cross_sell')),
  response text not null check (response in ('accepted', 'declined', 'consider_later', 'not_appropriate', 'waived_no_offer')),
  refusal_reason text,
  benefit_reason text not null default '',
  offered_product_id uuid references public.products(id) on delete set null,
  offered_product_name text,
  offered_package_id uuid references public.product_packages(id) on delete set null,
  offered_package_name text,
  offered_quantity integer,
  offered_amount numeric(12,2),
  accepted_amount numeric(12,2) not null default 0,
  linked_order_item_id text,
  offer_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint sales_expansion_offer_quantity_positive check (offered_quantity is null or offered_quantity > 0)
);

create index if not exists idx_sales_expansion_attempts_org_time
  on public.order_sales_expansion_attempts (org_id, attempted_at desc);
create index if not exists idx_sales_expansion_attempts_rep_time
  on public.order_sales_expansion_attempts (org_id, rep_id, attempted_at desc);
create index if not exists idx_sales_expansion_attempts_order
  on public.order_sales_expansion_attempts (org_id, order_id, record_status);
create index if not exists idx_sales_expansion_offer_lines_reporting
  on public.order_sales_expansion_offer_lines (org_id, offer_type, response, created_at desc);
create unique index if not exists idx_sales_expansion_one_upsell_per_attempt
  on public.order_sales_expansion_offer_lines (attempt_id)
  where offer_type = 'upsell';

insert into public.sales_expansion_settings (org_id, enforcement_starts_at)
select id, now() from public.organizations
on conflict (org_id) do nothing;

create or replace function public.create_default_sales_expansion_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sales_expansion_settings (org_id, enforcement_starts_at)
  values (new.id, now())
  on conflict (org_id) do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_default_sales_expansion_settings on public.organizations;
create trigger organizations_default_sales_expansion_settings
after insert on public.organizations
for each row execute function public.create_default_sales_expansion_settings();

alter table public.sales_expansion_settings enable row level security;
alter table public.order_sales_expansion_attempts enable row level security;
alter table public.order_sales_expansion_offer_lines enable row level security;

create policy "sales expansion settings read org" on public.sales_expansion_settings
  for select to authenticated using (org_id = private.auth_org_id());
create policy "sales expansion settings owner insert" on public.sales_expansion_settings
  for insert to authenticated with check (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
create policy "sales expansion settings owner update" on public.sales_expansion_settings
  for update to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner')
  with check (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');

create policy "sales expansion attempts read scope" on public.order_sales_expansion_attempts
  for select to authenticated using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or rep_id = auth.uid())
  );
create policy "sales expansion offer lines read scope" on public.order_sales_expansion_offer_lines
  for select to authenticated using (
    org_id = private.auth_org_id()
    and exists (
      select 1 from public.order_sales_expansion_attempts a
      where a.id = attempt_id
        and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or a.rep_id = auth.uid())
    )
  );

notify pgrst, 'reload schema';
