-- Sales Closer bonus engine. Same instinct as head_of_sales_settings /
-- head_of_sales_bonus_weekly_records (migration 213): a bonus that was
-- actually paid must stay a fixed historical fact even if settings or
-- orders change later, so this is a persisted-record table, not a
-- live-only evaluate() function like manager-bonus.ts.
--
-- Structurally different from head_of_sales_settings' single 3-level
-- ladder: the supplied design shows 6 independently-progressing bonus
-- components (Lead->Order Conversion, Lead->Delivered Conversion, AOV,
-- Upsell & Cross-sell, Activity, Delivery Quality), each with its own
-- target and tier ladder - so components is an array of {id, label,
-- description, metric, tiers: [{id, label, minValue, amount}]}, evaluated
-- monthly rather than weekly (this whole feature is inherently a monthly
-- cadence, unlike Head of Sales Rep's weekly scorecard).
create table if not exists public.sales_closer_bonus_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  currency text not null default 'NGN',
  components jsonb not null default '[
    {"id": "lead_to_order", "label": "Lead -> Order Conversion Bonus", "description": "Earn for high order conversion rate", "metric": "leadToOrderRate", "tiers": [
      {"id": "tier1", "label": "Tier 1", "minValue": 20, "amount": 10000},
      {"id": "tier2", "label": "Tier 2", "minValue": 25, "amount": 15000},
      {"id": "tier3", "label": "Tier 3", "minValue": 30, "amount": 20000}
    ]},
    {"id": "lead_to_delivered", "label": "Lead -> Delivered Conversion Bonus", "description": "Earn for delivered conversion rate", "metric": "leadToDeliveredRate", "tiers": [
      {"id": "tier1", "label": "Tier 1", "minValue": 14, "amount": 10000},
      {"id": "tier2", "label": "Tier 2", "minValue": 18, "amount": 15000},
      {"id": "tier3", "label": "Tier 3", "minValue": 22, "amount": 20000}
    ]},
    {"id": "aov", "label": "Average Order Value Bonus", "description": "Earn for maintaining high AOV", "metric": "aov", "tiers": [
      {"id": "tier1", "label": "Tier 1", "minValue": 18000, "amount": 7000},
      {"id": "tier2", "label": "Tier 2", "minValue": 20000, "amount": 10000},
      {"id": "tier3", "label": "Tier 3", "minValue": 24000, "amount": 15000}
    ]},
    {"id": "upsell_cross_sell", "label": "Upsell & Cross-sell Bonus", "description": "Earn for generating upsell & cross-sell revenue", "metric": "upsellCrossSellRevenue", "tiers": [
      {"id": "tier1", "label": "Tier 1", "minValue": 100000, "amount": 10000},
      {"id": "tier2", "label": "Tier 2", "minValue": 150000, "amount": 20000},
      {"id": "tier3", "label": "Tier 3", "minValue": 200000, "amount": 30000}
    ]},
    {"id": "activity", "label": "Activity Bonus", "description": "Active follow-ups & consistent activity", "metric": "activityScore", "tiers": [
      {"id": "tier1", "label": "Tier 1", "minValue": 70, "amount": 5000},
      {"id": "tier2", "label": "Tier 2", "minValue": 80, "amount": 10000},
      {"id": "tier3", "label": "Tier 3", "minValue": 90, "amount": 15000}
    ]},
    {"id": "delivery_quality", "label": "Delivery Quality Bonus", "description": "Based on delivered order rate", "metric": "deliveryRate", "tiers": [
      {"id": "tier1", "label": "Tier 1", "minValue": 50, "amount": 5000},
      {"id": "tier2", "label": "Tier 2", "minValue": 60, "amount": 10000},
      {"id": "tier3", "label": "Tier 3", "minValue": 70, "amount": 15000}
    ]}
  ]'::jsonb,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_closer_bonus_settings_org_unique
  on public.sales_closer_bonus_settings (org_id);

create table if not exists public.sales_closer_bonus_monthly_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  closer_id uuid not null references public.users(id) on delete cascade,
  month_start date not null,
  component_results jsonb not null default '[]'::jsonb,
  total_amount numeric(12, 2) not null default 0,
  status text not null default 'Pending' check (status in ('Pending', 'Paid')),
  notes text,
  paid_at timestamptz,
  paid_by uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_closer_bonus_monthly_records_org_closer_month
  on public.sales_closer_bonus_monthly_records (org_id, closer_id, month_start);

alter table public.sales_closer_bonus_settings enable row level security;
alter table public.sales_closer_bonus_monthly_records enable row level security;

-- Settings: leadership + the closer herself can read (she needs to see her
-- own targets); only Owner writes - same as every other bonus-rules panel
-- in this codebase.
drop policy if exists "sales closer bonus settings select" on public.sales_closer_bonus_settings;
create policy "sales closer bonus settings select"
  on public.sales_closer_bonus_settings for select to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Sales Closer')
  );

drop policy if exists "sales closer bonus settings write" on public.sales_closer_bonus_settings;
create policy "sales closer bonus settings write"
  on public.sales_closer_bonus_settings for all to authenticated
  using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner')
  with check (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');

-- Records: leadership reads all, a closer reads only her own; never
-- self-certified - only leadership can create/update a record (same
-- reasoning as head_of_sales_bonus_weekly_records).
drop policy if exists "sales closer bonus records select" on public.sales_closer_bonus_monthly_records;
create policy "sales closer bonus records select"
  on public.sales_closer_bonus_monthly_records for select to authenticated
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or (private.auth_user_role()::text = 'Sales Closer' and closer_id = auth.uid())
    )
  );

drop policy if exists "sales closer bonus records write" on public.sales_closer_bonus_monthly_records;
create policy "sales closer bonus records write"
  on public.sales_closer_bonus_monthly_records for all to authenticated
  using (org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager'))
  with check (org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager'));
