-- Backward-compatible write guard: older embeds, public checkout RPCs and
-- background jobs may not yet send branch_id. Keep them in the organisation's
-- Nigeria Operations branch instead of rejecting the write or mixing branches.
create or replace function public.assign_default_branch_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is not null then return new; end if;

  if tg_table_name in ('orders', 'agents', 'stock_movements', 'abandoned_carts') then
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

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'orders', 'agents', 'agent_stock', 'stock_movements', 'abandoned_carts',
    'agent_locations', 'agent_location_stock', 'delivered_stock_reconciliation_lines'
  ] loop
    execute format('drop trigger if exists trg_assign_default_branch on public.%I', table_name);
    execute format('create trigger trg_assign_default_branch before insert on public.%I for each row execute function public.assign_default_branch_id()', table_name);
  end loop;
end $$;
