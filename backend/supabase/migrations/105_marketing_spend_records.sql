-- Migration 105: daily marketer ad-budget / spend ledger.
--
-- Marketing attribution already tells us which orders came from each media
-- buyer. This table records the money given/spent per buyer/day/product/campaign
-- so the app can calculate cost per order, cost per delivered order, ROAS, and
-- profit without relying on loose expense descriptions.

create table if not exists public.marketing_spend_records (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  spend_date         date not null,
  marketer_user_id   uuid references public.users(id) on delete set null,
  marketer_tag       text not null,
  product_id         uuid references public.products(id) on delete set null,
  platform           text not null default 'Facebook',
  campaign           text,
  landing_page_url   text,
  budget_given       numeric(12,2) not null default 0,
  actual_spent       numeric(12,2),
  currency           public.currency_code not null default 'NGN',
  notes              text,
  proof_url          text,
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamp with time zone not null default now(),
  updated_at         timestamp with time zone not null default now(),
  constraint marketing_spend_non_negative_budget check (budget_given >= 0),
  constraint marketing_spend_non_negative_actual check (actual_spent is null or actual_spent >= 0),
  constraint marketing_spend_has_money check (budget_given > 0 or coalesce(actual_spent, 0) > 0)
);

create index if not exists idx_marketing_spend_org_date
  on public.marketing_spend_records (org_id, spend_date desc);

create index if not exists idx_marketing_spend_org_tag_date
  on public.marketing_spend_records (org_id, marketer_tag, spend_date desc);

create index if not exists idx_marketing_spend_org_marketer_date
  on public.marketing_spend_records (org_id, marketer_user_id, spend_date desc);

create index if not exists idx_marketing_spend_org_product_date
  on public.marketing_spend_records (org_id, product_id, spend_date desc);

alter table public.marketing_spend_records enable row level security;

drop policy if exists "marketing spend org read" on public.marketing_spend_records;
create policy "marketing spend org read"
  on public.marketing_spend_records
  for select
  using (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.org_id = marketing_spend_records.org_id
        and (
          u.role in ('Owner', 'Admin', 'Manager')
          or marketing_spend_records.marketer_user_id = auth.uid()
          or marketing_spend_records.marketer_tag = any(coalesce(u.marketing_attribution_tags, '{}'::text[]))
        )
    )
  );

drop policy if exists "marketing spend owner admin write" on public.marketing_spend_records;
create policy "marketing spend owner admin write"
  on public.marketing_spend_records
  for all
  using (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.org_id = marketing_spend_records.org_id
        and u.role in ('Owner', 'Admin')
    )
  )
  with check (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.org_id = marketing_spend_records.org_id
        and u.role in ('Owner', 'Admin')
    )
  );
