-- Past "Interested" customers back on the reps' follow-up (Bright, 24 Nov 2026).
--
-- Interested used to FINISH a cart, so 141 open carts logged Interested in past
-- months never became an order and nobody called them again. They go back on
-- the assigned rep's daily follow-up list with a grace period: nothing is
-- charged this week (grace_until = end of Sat 28 Nov 2026, Lagos; Bright:
-- "extend it through this week, fine will start next week"). From Mon 30 Nov
-- each one not logged that day is ₦50 (like an order follow-up), until it
-- becomes an order, is rescheduled with a date, or is closed as Not interested.
-- Quick mass closing of these carts is watched (cart-call-alerts.ts).
--
-- A fixed list, made once here, so it cannot grow or change under anybody.
-- Same rules as the "Said Interested, never ordered" list: still open, no
-- order linked to the cart or made under the customer's phone, and not
-- rescheduled / closed since.

create table if not exists public.cart_interested_followups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  cart_id text not null,
  rep_id uuid,
  first_interested_at timestamptz not null,
  grace_until timestamptz not null,
  source text not null default 'backfill',
  created_at timestamptz not null default now()
);
create unique index if not exists cart_interested_followups_one on public.cart_interested_followups (org_id, cart_id);
alter table public.cart_interested_followups enable row level security;

with i as (
  select cart_id, min(created_at) fi from public.cart_contact_attempts where outcome_code = 'Interested' group by 1
), n as (
  select i.*, c.org_id, c.branch_id, c.assigned_rep_id,
         right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) ph
  from i join public.abandoned_carts c on c.id = i.cart_id
  where c.assigned_rep_id is not null
    and c.status not in ('Converted', 'Not interested', 'No response')
    and not exists (select 1 from public.orders o where o.source_cart_id = i.cart_id)
    and i.fi < timestamptz '2026-11-24 00:00:00+01'
)
insert into public.cart_interested_followups (org_id, branch_id, cart_id, rep_id, first_interested_at, grace_until)
select n.org_id, n.branch_id, n.cart_id, n.assigned_rep_id, n.fi, timestamptz '2026-11-29 00:00:00+01'
from n
join public.users u on u.id = n.assigned_rep_id and u.active
where not exists (
    select 1 from public.orders o
    where n.ph <> '' and right(regexp_replace(coalesce(o.phone, ''), '\D', '', 'g'), 10) = n.ph and o.created_at >= n.fi - interval '1 day'
  )
  and not exists (
    select 1 from public.cart_contact_attempts a
    where a.cart_id = n.cart_id and a.created_at > n.fi and a.outcome_code in ('Not interested', 'Wrong number', 'Rescheduled')
  )
on conflict (org_id, cart_id) do nothing;
