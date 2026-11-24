-- Cart follow-up integrity (Bright, 24 Nov 2026, after the follow-up audit).
--
-- The audit found carts logged to clear the ₦500-a-day charge rather than
-- worked: the form pre-filled "Interested" and was saved untouched, the same
-- words repeated on one cart day after day, many different carts "called" in
-- seconds, and no trace that any call was made. These two tables give the
-- missing evidence.
--
-- 1. cart_contact_taps: every tap on Call / WhatsApp / SMS for a cart, from
--    inside Protohub. A follow-up log needs a tap on that cart first, and
--    keeps the time of that tap (cart_contact_attempts.tapped_at), so "called
--    and logged 20 seconds later" can be told apart from a real call.
--
-- 2. cart_spot_checks: each week up to 3 of each rep's logged carts are picked
--    at random for a manager to call back and ask "did someone call you?".
--    The picks are stored, so they never change once made, and reps never
--    see them.

create table if not exists public.cart_contact_taps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  cart_id text not null,
  rep_id uuid not null,
  channel text not null check (channel in ('call', 'whatsapp', 'sms')),
  tapped_at timestamptz not null default now()
);
create index if not exists cart_contact_taps_lookup
  on public.cart_contact_taps (org_id, cart_id, rep_id, tapped_at desc);

alter table public.cart_contact_attempts
  add column if not exists tapped_at timestamptz,
  add column if not exists tap_channel text;

create table if not exists public.cart_spot_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  week_start date not null,
  rep_id uuid not null,
  rep_name text,
  cart_id text not null,
  attempt_id uuid not null,
  attempt_outcome text,
  attempt_note text,
  attempted_at timestamptz,
  customer text,
  phone text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'denied', 'unreachable')),
  result_note text,
  checked_by uuid,
  checked_by_name text,
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists cart_spot_checks_one_per_attempt
  on public.cart_spot_checks (org_id, week_start, attempt_id);
create index if not exists cart_spot_checks_week
  on public.cart_spot_checks (org_id, branch_id, week_start);

-- The API uses the service role; these stop any direct client reading them.
alter table public.cart_contact_taps enable row level security;
alter table public.cart_spot_checks enable row level security;
