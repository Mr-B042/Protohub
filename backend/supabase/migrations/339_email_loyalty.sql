-- Email Marketing: Loyalty & Rewards, part 1 (Bright's design 55, 8 Nov 2026).
--
-- Bright's calls (8 Nov 2026):
--  * "Comes off by itself": when a member orders again with the same phone,
--    the server takes their voucher off the order. The order form looks the
--    same (no code box) and the rep tells the customer on the call.
--  * "Email only for now": customers hear about points by email.
--  * "Level now, points from today": past delivered spend sets each
--    customer's level straight away; points start at 0 when a points
--    program is turned on.
--  * Part 1 = points + VIP levels. Refer & Earn and Birthday come next.
--
-- A member is a phone number with a delivered order. Nothing is stored per
-- member: levels and balances are worked out from orders and the rows below,
-- so a voucher on an order that fails, is cancelled or is deleted comes back
-- by itself, and points stop counting if a delivered order is undone.

-- A program: "points" (how many points an order earns) or "tier" (the VIP
-- levels). Settings live in config:
--   points: {"rate": 1, "productIds": []}  (points per N1,000; [] = every product)
--   tier:   {"levels": [{"key","name","minSpend","multiplier","welcomeVoucher","monthlyVoucher","perks":[]}]}
create table if not exists public.loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  type text not null check (type in ('points', 'tier')),
  name text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  config jsonb not null default '{}'::jsonb,
  -- Set the first time it is turned on: points count from this day (Lagos),
  -- and only levels reached after it give a welcome voucher.
  starts_at timestamptz,
  -- Optional end.
  ends_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loyalty_programs_branch on public.loyalty_programs (org_id, branch_id, status);
-- One points program and one set of VIP levels per branch (archived ones don't count).
create unique index if not exists loyalty_programs_one_each on public.loyalty_programs (branch_id, type) where status <> 'archived';
alter table public.loyalty_programs enable row level security;

-- What points buy: a voucher worth `value` naira for `points` points.
create table if not exists public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  points integer not null check (points > 0),
  value numeric not null check (value > 0),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loyalty_rewards_branch on public.loyalty_rewards (org_id, branch_id, status);
alter table public.loyalty_rewards enable row level security;

create table if not exists public.loyalty_settings (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- A voucher only comes off orders of at least this much (0 = any order).
  min_order numeric not null default 0 check (min_order >= 0),
  updated_at timestamptz not null default now()
);
alter table public.loyalty_settings enable row level security;

-- Points an order earned, worked out once when it was first seen delivered
-- (a later change to the rate never rewrites them).
create table if not exists public.loyalty_earnings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_id text not null unique,
  phone_key text not null,
  points integer not null check (points >= 0),
  -- Points per N1,000 from the live points programs, and the level's multiplier.
  rate numeric not null default 0,
  multiplier numeric not null default 1,
  level_key text,
  amount numeric not null default 0,
  program_ids uuid[] not null default '{}',
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_earnings_member on public.loyalty_earnings (branch_id, phone_key);
alter table public.loyalty_earnings enable row level security;

-- One voucher per order: a reward bought with points, a level's welcome
-- voucher, or a level's monthly voucher.
create table if not exists public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_id text not null unique,
  phone_key text not null,
  kind text not null check (kind in ('reward', 'welcome', 'monthly')),
  reward_id uuid references public.loyalty_rewards(id) on delete set null,
  program_id uuid references public.loyalty_programs(id) on delete set null,
  level_key text,
  -- Lagos month (2026-11) for a monthly voucher.
  month text,
  points integer not null default 0 check (points >= 0),
  discount numeric not null check (discount > 0),
  amount_before numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_redemptions_member on public.loyalty_redemptions (branch_id, phone_key);
alter table public.loyalty_redemptions enable row level security;

-- Points added or taken away by hand (Owner/Admin), always with a reason.
create table if not exists public.loyalty_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  phone_key text not null,
  points integer not null check (points <> 0),
  reason text not null,
  created_by uuid references public.users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists loyalty_adjustments_member on public.loyalty_adjustments (branch_id, phone_key);
alter table public.loyalty_adjustments enable row level security;

-- The order keeps what came off (orders.amount is already the lower amount),
-- so Order Details can show it to the rep.
alter table public.orders add column if not exists loyalty_discount numeric;
alter table public.orders add column if not exists loyalty_note text;
