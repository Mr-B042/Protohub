-- Enforce the transaction boundary introduced in migration 247.
--
-- Balance tables and ledger tables are no longer independent write targets.
-- Only the SECURITY DEFINER atomic writers may change physical quantities or
-- append ledger rows. This also blocks accidental edits through SQL scripts or
-- the table editor from silently creating another balance/ledger mismatch.

create or replace function public.guard_standard_inventory_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_allowed boolean := current_setting('app.inventory_atomic_writer', true) = '1';
begin
  if v_allowed then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'products' then
    if tg_op = 'INSERT' and coalesce(new.warehouse_stock, 0) = 0 and coalesce(new.agent_stock, 0) = 0 then return new; end if;
    if tg_op = 'UPDATE'
       and old.warehouse_stock is not distinct from new.warehouse_stock
       and old.agent_stock is not distinct from new.agent_stock then return new; end if;
    if tg_op = 'DELETE' and coalesce(old.warehouse_stock, 0) = 0 and coalesce(old.agent_stock, 0) = 0 then return old; end if;
  elsif tg_table_name = 'agent_location_stock' then
    if tg_op = 'INSERT'
       and coalesce(new.quantity, 0) = 0 and coalesce(new.defective, 0) = 0 and coalesce(new.missing, 0) = 0 then return new; end if;
    if tg_op = 'UPDATE'
       and old.quantity is not distinct from new.quantity
       and old.defective is not distinct from new.defective
       and old.missing is not distinct from new.missing then return new; end if;
    if tg_op = 'DELETE'
       and coalesce(old.quantity, 0) = 0 and coalesce(old.defective, 0) = 0 and coalesce(old.missing, 0) = 0 then return old; end if;
  elsif tg_table_name = 'agent_stock' then
    if tg_op = 'INSERT'
       and coalesce(new.quantity, 0) = 0 and coalesce(new.defective, 0) = 0 and coalesce(new.missing, 0) = 0 then return new; end if;
    if tg_op = 'UPDATE'
       and old.quantity is not distinct from new.quantity
       and old.defective is not distinct from new.defective
       and old.missing is not distinct from new.missing then return new; end if;
    if tg_op = 'DELETE'
       and coalesce(old.quantity, 0) = 0 and coalesce(old.defective, 0) = 0 and coalesce(old.missing, 0) = 0 then return old; end if;
  end if;

  raise exception 'INVENTORY_WRITE_BLOCKED|Use the inventory action API so the balance and ledger are committed together.';
end;
$$;

drop trigger if exists trg_products_atomic_inventory_guard on public.products;
create trigger trg_products_atomic_inventory_guard
  before insert or update or delete on public.products
  for each row execute function public.guard_standard_inventory_write();

drop trigger if exists trg_agent_location_stock_atomic_guard on public.agent_location_stock;
create trigger trg_agent_location_stock_atomic_guard
  before insert or update or delete on public.agent_location_stock
  for each row execute function public.guard_standard_inventory_write();

drop trigger if exists trg_agent_stock_atomic_guard on public.agent_stock;
create trigger trg_agent_stock_atomic_guard
  before insert or update or delete on public.agent_stock
  for each row execute function public.guard_standard_inventory_write();

create or replace function public.guard_standard_inventory_ledger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and current_setting('app.inventory_atomic_writer', true) = '1' then
    return new;
  end if;
  -- ON DELETE SET NULL foreign keys may detach a deleted product, agent,
  -- location, order, or user. Permit only that metadata cleanup; quantities,
  -- scope, retry key, labels, and balance evidence remain immutable.
  if tg_op = 'UPDATE'
     and old.id is not distinct from new.id
     and old.org_id is not distinct from new.org_id
     and old.product_name is not distinct from new.product_name
     and old.type is not distinct from new.type
     and old.qty is not distinct from new.qty
     and old.balance_after is not distinct from new.balance_after
     and old.by_name is not distinct from new.by_name
     and old.note is not distinct from new.note
     and old.waybill_id is not distinct from new.waybill_id
     and old.from_location is not distinct from new.from_location
     and old.to_location is not distinct from new.to_location
     and old.idempotency_key is not distinct from new.idempotency_key
     and old.source_scope is not distinct from new.source_scope
     and old.destination_scope is not distinct from new.destination_scope
     and old.source_balance_after is not distinct from new.source_balance_after
     and old.destination_balance_after is not distinct from new.destination_balance_after
     and old.created_at is not distinct from new.created_at then
    return new;
  end if;
  raise exception 'INVENTORY_LEDGER_WRITE_BLOCKED|The stock ledger is append-only and must be written with its balance.';
end;
$$;

drop trigger if exists trg_stock_movements_atomic_guard on public.stock_movements;
create trigger trg_stock_movements_atomic_guard
  before insert or update or delete on public.stock_movements
  for each row execute function public.guard_standard_inventory_ledger();

create or replace function public.guard_pda_inventory_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_allowed boolean := current_setting('app.pda_inventory_atomic_writer', true) = '1';
begin
  if v_allowed then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'INSERT'
     and coalesce(new.available, 0) = 0
     and coalesce(new.reserved, 0) = 0
     and coalesce(new.out_for_delivery, 0) = 0
     and coalesce(new.damaged, 0) = 0
     and coalesce(new.missing, 0) = 0
     and coalesce(new.awaiting_investigation, 0) = 0 then return new; end if;
  if tg_op = 'UPDATE'
     and old.available is not distinct from new.available
     and old.reserved is not distinct from new.reserved
     and old.out_for_delivery is not distinct from new.out_for_delivery
     and old.damaged is not distinct from new.damaged
     and old.missing is not distinct from new.missing
     and old.awaiting_investigation is not distinct from new.awaiting_investigation then return new; end if;
  if tg_op = 'DELETE'
     and coalesce(old.available, 0) = 0
     and coalesce(old.reserved, 0) = 0
     and coalesce(old.out_for_delivery, 0) = 0
     and coalesce(old.damaged, 0) = 0
     and coalesce(old.missing, 0) = 0
     and coalesce(old.awaiting_investigation, 0) = 0 then return old; end if;

  raise exception 'PDA_INVENTORY_WRITE_BLOCKED|Use the delivery-agent stock action API so the balance and ledger are committed together.';
end;
$$;

drop trigger if exists trg_pda_agent_stock_atomic_guard on public.pda_agent_stock;
create trigger trg_pda_agent_stock_atomic_guard
  before insert or update or delete on public.pda_agent_stock
  for each row execute function public.guard_pda_inventory_write();

create or replace function public.guard_pda_inventory_ledger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and current_setting('app.pda_inventory_atomic_writer', true) = '1' then
    return new;
  end if;
  raise exception 'PDA_INVENTORY_LEDGER_WRITE_BLOCKED|The delivery-agent stock ledger is append-only and must be written with its balance.';
end;
$$;

drop trigger if exists trg_pda_stock_ledger_atomic_guard on public.pda_stock_ledger;
create trigger trg_pda_stock_ledger_atomic_guard
  before insert or update or delete on public.pda_stock_ledger
  for each row execute function public.guard_pda_inventory_ledger();

revoke all on function public.guard_standard_inventory_write() from public, anon, authenticated;
revoke all on function public.guard_standard_inventory_ledger() from public, anon, authenticated;
revoke all on function public.guard_pda_inventory_write() from public, anon, authenticated;
revoke all on function public.guard_pda_inventory_ledger() from public, anon, authenticated;
