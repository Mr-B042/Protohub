-- Fix for 347: "tg_table_name in (...) and new.product_id" is planned as one
-- expression, so on agents, agent_stock, stock_movements and the other tables
-- without product_id every insert that left branch_id empty failed with
-- 'record "new" has no field "product_id"'. Same rule, product check nested.
create or replace function public.assign_default_branch_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is not null then return new; end if;

  -- Only orders and carts have product_id: check the table first, in its own
  -- IF, or every other table errors with 'record "new" has no field'.
  if tg_table_name in ('orders', 'abandoned_carts') then
    if new.product_id is not null then
      select p.branch_id into new.branch_id from public.products p where p.id = new.product_id and p.org_id = new.org_id;
    end if;
  end if;

  if new.branch_id is not null then
    return new;
  elsif tg_table_name in ('orders', 'agents', 'stock_movements', 'abandoned_carts') then
    select b.id into new.branch_id from public.branches b
    where b.org_id = new.org_id and b.name = 'Nigeria Operations' and b.active
    order by b.created_at limit 1;
  elsif tg_table_name = 'agent_stock' then
    select a.branch_id into new.branch_id from public.agents a where a.id = new.agent_id;
  elsif tg_table_name = 'agent_locations' then
    select a.branch_id into new.branch_id from public.agents a where a.id = new.agent_id;
  elsif tg_table_name = 'agent_location_stock' then
    select l.branch_id into new.branch_id from public.agent_locations l where l.id = new.agent_location_id;
  elsif tg_table_name = 'delivered_stock_reconciliation_lines' then
    select o.branch_id into new.branch_id from public.orders o where o.id = new.order_id;
  end if;

  if new.branch_id is null then
    raise exception 'Unable to resolve branch for % insert', tg_table_name using errcode = '23502';
  end if;
  return new;
end;
$$;
