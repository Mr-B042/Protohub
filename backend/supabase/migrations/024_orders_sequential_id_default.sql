-- Migration 024: new orders should get simple sequential text IDs like
-- 1, 2, 3... while preserving the existing text primary key and historical
-- ORD-* records.

create sequence if not exists orders_id_seq
  as bigint
  increment by 1
  minvalue 1
  start with 1
  no cycle;
do $$
declare
  last_small_numeric_id bigint;
begin
  select max(id::bigint)
    into last_small_numeric_id
  from orders
  where id ~ '^[0-9]{1,9}$';

  if last_small_numeric_id is null then
    perform setval('orders_id_seq', 1, false);
  else
    perform setval('orders_id_seq', last_small_numeric_id, true);
  end if;
end $$;
alter table orders
  alter column id set default nextval('orders_id_seq')::text;
