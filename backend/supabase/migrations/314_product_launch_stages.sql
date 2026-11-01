-- Product Launch stages (Bright, 1 Nov 2026).
--
-- A product being tried out goes through two stages before it sells normally:
--   silent - "Silent Test": orders are shared out by round robin as usual,
--            but only the Owner sees them or hears about them. Customers get
--            no message.
--   soft   - "Soft Launch": everyone sees and works the orders, but they are
--            left out of the weekly report's delivery rate. Delivered ones
--            still pay the rep's bonus.
--   live   - a normal product.
-- Switching silent -> soft reveals every hidden order to its rep.

alter table public.products
  add column if not exists launch_stage text not null default 'live',
  add column if not exists launch_settings jsonb not null default '{}'::jsonb;

alter table public.products drop constraint if exists products_launch_stage_check;
alter table public.products add constraint products_launch_stage_check
  check (launch_stage in ('live', 'silent', 'soft'));

-- Each order keeps the stage it came in under, so the weekly report can leave
-- test orders out of the rate even after the product goes live.
alter table public.orders
  add column if not exists launch_stage text not null default 'live',
  add column if not exists revealed_at timestamptz;

alter table public.orders drop constraint if exists orders_launch_stage_check;
alter table public.orders add constraint orders_launch_stage_check
  check (launch_stage in ('live', 'silent', 'soft'));

create index if not exists orders_launch_stage_idx
  on public.orders (org_id, product_id, launch_stage)
  where launch_stage <> 'live';

-- One rule for every way an order is made (order form, cart auto-submit,
-- manual entry): a new order takes its product's stage.
create or replace function public.stamp_order_launch_stage()
returns trigger
language plpgsql
as $$
declare
  product_stage text;
begin
  if new.product_id is not null and coalesce(new.launch_stage, 'live') = 'live' then
    select launch_stage into product_stage from public.products where id = new.product_id;
    if product_stage is not null and product_stage <> 'live' then
      new.launch_stage := product_stage;
    end if;
  end if;
  -- An order made during Soft Launch is visible from the start.
  if new.launch_stage = 'soft' and new.revealed_at is null then
    new.revealed_at := coalesce(new.created_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists orders_stamp_launch_stage on public.orders;
create trigger orders_stamp_launch_stage
  before insert on public.orders
  for each row execute function public.stamp_order_launch_stage();

-- Every stage switch, who made it and what it did.
create table if not exists public.product_launch_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  from_stage text not null,
  to_stage text not null,
  orders_revealed integer not null default 0,
  -- "End test" (a Silent Test that did not sell): the product is switched off
  -- and its hidden orders are either cancelled quietly or handed to the team.
  ended_with text check (ended_with in ('cancelled', 'delivered')),
  orders_cancelled integer not null default 0,
  note text,
  changed_by uuid references public.users(id) on delete set null,
  changed_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists product_launch_events_product_idx
  on public.product_launch_events (org_id, product_id, created_at desc);

alter table public.product_launch_events enable row level security;
