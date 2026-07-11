-- Manager Upselling & Cross-Selling Growth Bonus: owner-editable profit gate,
-- delivery-rate gate, expansion-rate tiers, and the contribution-profit cap.
-- Separate from manager_bonus_settings (the existing Delivery Rate Bonus) -
-- different metric (Delivered Sales Expansion Rate, not company delivery
-- rate) and an extra profit-protection cap rule that bonus doesn't have.

create table if not exists public.upsell_bonus_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  title text not null default 'Upselling & Cross-Selling Growth Bonus',
  description text not null default 'Rewards the manager for growing the share of delivered orders with a verified upsell, package upgrade, or cross-sell - gated on its own profit and delivery-rate floors, and capped so the bonus can never exceed a share of the real profit those add-ons generated.',
  profit_gate_amount numeric(12,2) not null default 250000,
  delivery_rate_gate_pct numeric(5,2) not null default 60,
  contribution_cap_pct numeric(5,2) not null default 20,
  currency public.currency_code not null default 'NGN',
  expansion_rate_tiers jsonb not null default '[
    {"id":"tier-10","label":"10% - 14.9%","minRate":10,"maxRate":14.9,"amount":5000},
    {"id":"tier-15","label":"15% - 19.9%","minRate":15,"maxRate":19.9,"amount":10000},
    {"id":"tier-20","label":"20% - 24.9%","minRate":20,"maxRate":24.9,"amount":15000},
    {"id":"tier-25","label":"25% - 29.9%","minRate":25,"maxRate":29.9,"amount":20000},
    {"id":"tier-30","label":"30%+","minRate":30,"maxRate":null,"amount":25000}
  ]'::jsonb,
  profit_gate_miss_message text not null default 'Weekly Net Profit (Ops) is below the ₦250,000 gate, so no Upselling & Cross-Selling Bonus applies this week.',
  delivery_gate_miss_message text not null default 'Company delivery rate is below 60%, so the Upselling & Cross-Selling Bonus is withheld this week to avoid encouraging add-ons customers may reject.',
  gates_met_message text not null default 'Both gates are met - payout follows the Delivered Sales Expansion Rate, capped at a share of real contribution profit.',
  below_tier_message text not null default 'Both gates are met, but the Delivered Sales Expansion Rate is below the first bonus tier.',
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upsell_bonus_settings_amounts_nonnegative check (
    profit_gate_amount >= 0
    and delivery_rate_gate_pct >= 0 and delivery_rate_gate_pct <= 100
    and contribution_cap_pct >= 0 and contribution_cap_pct <= 100
  )
);

alter table public.upsell_bonus_settings enable row level security;

drop policy if exists "upsell bonus settings select org managers" on public.upsell_bonus_settings;
drop policy if exists "upsell bonus settings insert owner" on public.upsell_bonus_settings;
drop policy if exists "upsell bonus settings update owner" on public.upsell_bonus_settings;
drop policy if exists "upsell bonus settings delete owner" on public.upsell_bonus_settings;

create policy "upsell bonus settings select org managers"
  on public.upsell_bonus_settings
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

create policy "upsell bonus settings insert owner"
  on public.upsell_bonus_settings
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  );

create policy "upsell bonus settings update owner"
  on public.upsell_bonus_settings
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

create policy "upsell bonus settings delete owner"
  on public.upsell_bonus_settings
  for delete
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  );
