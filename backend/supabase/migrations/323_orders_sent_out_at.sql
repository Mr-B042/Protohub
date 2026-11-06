-- Quick / Late response on the order list (Bright, 6 Nov 2026). The clock
-- under each order's status only showed how long ago the order came in, and
-- kept counting after the rep had acted. The response is when the order first
-- LEFT "New" - the same moment the late-send fine (lib/late-send.ts) reads
-- from order_audit. Kept on the order so the list can show it without
-- reading the history of every order.

alter table public.orders add column if not exists sent_out_at timestamptz;

-- First time only: an order sent back to New and out again keeps its first time.
create or replace function public.orders_mark_sent_out()
returns trigger
language plpgsql
as $$
begin
  if new.sent_out_at is null and old.status = 'New' and new.status is distinct from 'New' then
    new.sent_out_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_sent_out on public.orders;
create trigger trg_orders_sent_out
  before update of status on public.orders
  for each row execute function public.orders_mark_sent_out();

-- Past orders: the first New -> other status in their history. updated_at is
-- read as a closure time in places, so its trigger is off for this one update.
alter table public.orders disable trigger orders_updated_at;
update public.orders o
   set sent_out_at = a.first_at
  from (
    select order_id, min(created_at) as first_at
      from public.order_audit
     where from_status = 'New' and to_status is not null and to_status <> 'New'
     group by order_id
  ) a
 where a.order_id = o.id and o.sent_out_at is null;
alter table public.orders enable trigger orders_updated_at;
