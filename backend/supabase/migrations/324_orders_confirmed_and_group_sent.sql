-- Confirmed time + WhatsApp group time on the order list (Bright, 6 Nov 2026:
-- "what matters is confirmed ... the sent out is an extra info").
--  * sent_out_status: the status an order FIRST moved to from New, so the list
--    can say "Confirmed" when it was a confirmation and "Responded" when the
--    first move was Failed / Cancelled / Postponed.
--  * group_sent_at: first time the order was copied or sent to the WhatsApp
--    group. Not every order goes to a group (rescheduled, unserious customers),
--    so a missing time is never treated as a fault.

alter table public.orders add column if not exists sent_out_status text;
alter table public.orders add column if not exists group_sent_at timestamptz;

create or replace function public.orders_mark_sent_out()
returns trigger
language plpgsql
as $$
begin
  if new.sent_out_at is null and old.status = 'New' and new.status is distinct from 'New' then
    new.sent_out_at := now();
    new.sent_out_status := new.status::text;
  end if;
  return new;
end;
$$;

-- Past orders: the status of their first New -> other change. updated_at is
-- read as a closure time in places, so its trigger is off for this update.
alter table public.orders disable trigger orders_updated_at;
update public.orders o
   set sent_out_status = a.to_status
  from (
    select distinct on (order_id) order_id, to_status::text as to_status
      from public.order_audit
     where from_status = 'New' and to_status is not null and to_status <> 'New'
     order by order_id, created_at
  ) a
 where a.order_id = o.id and o.sent_out_status is null and o.sent_out_at is not null;
alter table public.orders enable trigger orders_updated_at;
