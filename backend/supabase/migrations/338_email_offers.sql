-- Email Marketing: Coupons & Offers (Bright's design 54, 8 Nov 2026).
--
-- Bright's calls (8 Nov 2026):
--  * No code box on the live order form. An offer travels with an email: the
--    email's tracked link already brings its send token (utm_content) into
--    the order form, the form shows the lower price, and the server applies
--    the offer again when it saves the order (it never trusts the browser).
--  * Rep pay uses the lower amount: orders.amount IS the discounted amount,
--    so pay, profit and cash all follow what the customer actually paid.
--  * Part 1 = % off and N off (Discount Coupon, Fixed Discount, Flash Sale,
--    Loyalty Offer). Bundles and Free Gifts come next (stock and cost).

create table if not exists public.email_offers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  description text not null default '',
  -- What the design calls the offer type (tabs and the performance donut).
  type text not null default 'discount' check (type in ('discount', 'fixed', 'flash', 'loyalty')),
  -- The money: a percent of the order, or naira off.
  benefit text not null default 'percent' check (benefit in ('percent', 'fixed')),
  value numeric not null check (value > 0),
  -- Shown on the order and in reports (e.g. FLASH10). Unique per branch.
  code text not null check (code ~ '^[A-Z0-9_-]{3,24}$'),
  min_order numeric not null default 0,
  -- Empty = every product.
  product_ids uuid[] not null default '{}',
  -- Loyalty: delivered orders a customer needs (0 = anyone).
  min_delivered integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  per_customer_limit integer not null default 1 check (per_customer_limit > 0),
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'archived')),
  created_by uuid references public.users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, code)
);
create index if not exists email_offers_branch on public.email_offers (org_id, branch_id, status);
alter table public.email_offers enable row level security;

-- One row per order that got an offer.
create table if not exists public.email_offer_redemptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  offer_id uuid not null references public.email_offers(id) on delete cascade,
  order_id text not null unique,
  send_id uuid references public.email_campaign_sends(id) on delete set null,
  phone text,
  amount_before numeric not null,
  discount numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists email_offer_redemptions_offer on public.email_offer_redemptions (offer_id, created_at desc);
alter table public.email_offer_redemptions enable row level security;

-- The order keeps what was applied (orders.amount is already the lower amount).
alter table public.orders add column if not exists offer_id uuid references public.email_offers(id) on delete set null;
alter table public.orders add column if not exists offer_code text;
alter table public.orders add column if not exists offer_discount numeric;

-- The offer an email carries (campaigns, and each automation email step).
alter table public.email_campaigns add column if not exists offer_id uuid references public.email_offers(id) on delete set null;
