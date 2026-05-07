-- =====================================================================
-- Migration 004: Atomic warehouse stock adjustment
-- Replaces the read-modify-write loop in /api/stock/update with a single
-- transactional UPDATE so concurrent writers can never lose increments.
-- Run in Supabase SQL Editor.
-- =====================================================================

create or replace function public.adjust_warehouse_stock(
  p_product_id uuid,
  p_org_id     uuid,
  p_delta      int
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new int;
begin
  update public.products
     set warehouse_stock = greatest(0, warehouse_stock + p_delta)
   where id     = p_product_id
     and org_id = p_org_id
  returning warehouse_stock into v_new;

  if v_new is null then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  return v_new;
end;
$$;

revoke all on function public.adjust_warehouse_stock(uuid, uuid, int) from public;
grant execute on function public.adjust_warehouse_stock(uuid, uuid, int) to authenticated, service_role;
