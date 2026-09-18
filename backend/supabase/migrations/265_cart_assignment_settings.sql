-- How abandoned carts are handed to reps, so Bright can change it without me.
--
-- Until now the ten-minute wait, the ten-minute call deadline and the working
-- window were constants in the code. They were the right starting point, but
-- the number Bright actually wants to learn is which wait converts best - and
-- that means trying five and fifteen, which he should be able to do himself.
--
-- ⚠️ ONE ROW PER BRANCH, NOT PER ORGANISATION. Lagos, Accra and Nairobi keep
-- their own working hours. A shared row would make the day open at Lagos time
-- everywhere, which is wrong by an hour in Accra before anyone notices.
--
-- ⚠️ EVERY ROW CARRIES A branch_id, so this table is safe to add to
-- BRANCH_TABLES immediately. The rule that list depends on is that a table only
-- belongs there once no row has a null branch - listing one too early hides its
-- records rather than separating them.

create table if not exists public.cart_assignment_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,

  -- Off means carts stay unassigned and a human hands them out, which is how
  -- this worked before. Kept as a switch so a bad setting can be stopped
  -- without a deploy.
  enabled boolean not null default true,

  -- Quiet this long before a rep is handed the cart.
  assignment_delay_minutes integer not null default 10,
  -- How long the rep then has to make the first call.
  contact_sla_minutes integer not null default 10,

  -- Minutes past midnight, Lagos time. 510 = 08:30, 1050 = 17:30.
  work_start_minute integer not null default 510,
  work_end_minute integer not null default 1050,
  -- Sundays are off across this app - the follow-up KPI charges nobody and
  -- scheduling refuses one - so this defaults to false and exists only because
  -- a branch in another country may not keep the same rest day.
  works_sunday boolean not null default false,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,

  constraint cart_assignment_settings_branch_unique unique (branch_id),

  -- ⚠️ BOUNDS, BECAUSE THESE NUMBERS DRIVE A JOB THAT RINGS REAL CUSTOMERS.
  -- A zero-minute wait would hand over a cart while the customer is still
  -- typing; a 1,440-minute one is a day, which is the very thing the rule
  -- exists to prevent.
  constraint cart_assignment_delay_sane check (assignment_delay_minutes between 1 and 240),
  constraint cart_assignment_sla_sane check (contact_sla_minutes between 1 and 240),
  constraint cart_assignment_window_sane check (
    work_start_minute between 0 and 1439
    and work_end_minute between 1 and 1440
    and work_end_minute > work_start_minute
  )
);

create index if not exists cart_assignment_settings_branch_idx
  on public.cart_assignment_settings (branch_id);

-- Every branch that exists today starts on the values the code has been using,
-- so turning this on changes nothing until somebody edits it.
insert into public.cart_assignment_settings (org_id, branch_id)
select b.org_id, b.id
from public.branches b
where not exists (
  select 1 from public.cart_assignment_settings s where s.branch_id = b.id
);

-- A branch created later gets the same defaults without anybody remembering to
-- add them. Without this, a new country would silently have no rules and its
-- carts would never be handed out.
create or replace function public.seed_cart_assignment_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.cart_assignment_settings (org_id, branch_id)
  values (new.org_id, new.id)
  on conflict (branch_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_seed_cart_assignment_settings on public.branches;
create trigger trg_seed_cart_assignment_settings
  after insert on public.branches
  for each row execute function public.seed_cart_assignment_settings();

-- ⚠️ THE BACKEND USES THE SERVICE ROLE AND BYPASSES ALL OF THIS. These policies
-- are the same belt-and-braces the other settings tables carry: they keep a
-- direct client connection honest, they are not what enforces the rule.
alter table public.cart_assignment_settings enable row level security;

drop policy if exists "cart assignment settings select" on public.cart_assignment_settings;
create policy "cart assignment settings select"
  on public.cart_assignment_settings for select
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = any (array['Owner', 'Admin', 'Manager'])
  );

drop policy if exists "cart assignment settings update owner" on public.cart_assignment_settings;
create policy "cart assignment settings update owner"
  on public.cart_assignment_settings for update
  using (org_id = private.auth_org_id() and private.auth_user_role()::text = any (array['Owner', 'Admin']));

drop policy if exists "cart assignment settings insert owner" on public.cart_assignment_settings;
create policy "cart assignment settings insert owner"
  on public.cart_assignment_settings for insert
  with check (org_id = private.auth_org_id() and private.auth_user_role()::text = any (array['Owner', 'Admin']));
