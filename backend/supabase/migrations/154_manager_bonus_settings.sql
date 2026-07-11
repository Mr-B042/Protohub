-- Manager bonus settings: owner-editable profit gate and delivery-rate tiers.

create table if not exists public.manager_bonus_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  title text not null default 'Manager Bonus (Fixed + Profit-Safe)',
  description text not null default 'Profit gate protects the company first. If weekly Net Profit (Ops) is below the gate, the manager gets support only. Once the gate is met, payout follows total company delivery rate across all products.',
  profit_gate_amount numeric(12,2) not null default 150000,
  support_bonus_amount numeric(12,2) not null default 10000,
  below_tier_amount numeric(12,2) not null default 0,
  currency public.currency_code not null default 'NGN',
  delivery_rate_tiers jsonb not null default '[
    {"id":"tier-55","label":"55% - 59.9%","minRate":55,"maxRate":59.9,"amount":15000},
    {"id":"tier-60","label":"60% - 64.9%","minRate":60,"maxRate":64.9,"amount":20000},
    {"id":"tier-65","label":"65% - 69.9%","minRate":65,"maxRate":69.9,"amount":25000},
    {"id":"tier-70","label":"70% - 74.9%","minRate":70,"maxRate":74.9,"amount":30000},
    {"id":"tier-75","label":"75%+","minRate":75,"maxRate":null,"amount":40000}
  ]'::jsonb,
  gate_miss_message text not null default 'Profit gate was not met, so only support bonus applies.',
  gate_met_message text not null default 'Profit gate was met, so delivery-rate bonus applies.',
  below_tier_message text not null default 'Profit gate was met, but delivery rate is below the first bonus tier.',
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manager_bonus_settings_amounts_nonnegative check (
    profit_gate_amount >= 0
    and support_bonus_amount >= 0
    and below_tier_amount >= 0
  )
);

alter table public.manager_bonus_settings enable row level security;

drop policy if exists "manager bonus settings select org managers" on public.manager_bonus_settings;
drop policy if exists "manager bonus settings insert owner" on public.manager_bonus_settings;
drop policy if exists "manager bonus settings update owner" on public.manager_bonus_settings;
drop policy if exists "manager bonus settings delete owner" on public.manager_bonus_settings;

create policy "manager bonus settings select org managers"
  on public.manager_bonus_settings
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

create policy "manager bonus settings insert owner"
  on public.manager_bonus_settings
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  );

create policy "manager bonus settings update owner"
  on public.manager_bonus_settings
  for update
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  );

create policy "manager bonus settings delete owner"
  on public.manager_bonus_settings
  for delete
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  );
