-- The third weekly writer, made branch-aware like the other two in 262.
--
-- ⚠️ ITS "ALREADY FINAL" GUARD READ BY (org_id, week_start) TOO. Accra opening
-- a week that Nigeria had already finalised would have been refused - with
-- Nigeria's reason - before it ever reached the upsert. Separating the table
-- did not help, because the lookup inside the function never mentioned a
-- branch.
--
-- Added alongside the existing overload, same as 262, so the deployed code
-- keeps working until the new route ships.

create or replace function public.save_inventory_valuation(
  p_org_id uuid, p_branch_id uuid, p_week_start date, p_status text, p_notes text,
  p_captured_by uuid, p_captured_by_name text, p_lines jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_id uuid;
  v_existing_status text;
  v_units numeric;
  v_value numeric;
begin
  if p_branch_id is null then
    raise exception 'BRANCH_REQUIRED|A valuation must belong to a branch.';
  end if;

  select id, status into v_id, v_existing_status
    from inventory_valuation_snapshots
   where branch_id = p_branch_id and week_start = p_week_start;

  if v_existing_status = 'final' then
    raise exception 'This week''s valuation is already final and cannot be replaced.';
  end if;

  select coalesce(sum(coalesce((item->>'units')::numeric, 0)), 0),
         coalesce(sum(coalesce((item->>'value')::numeric, 0)), 0)
    into v_units, v_value
    from jsonb_array_elements(p_lines) as item;

  insert into inventory_valuation_snapshots (
    org_id, branch_id, week_start, status, total_units, total_value, notes,
    captured_by, captured_by_name, captured_at
  ) values (
    p_org_id, p_branch_id, p_week_start, p_status, v_units, v_value, coalesce(p_notes, ''),
    p_captured_by, coalesce(p_captured_by_name, ''), now()
  )
  on conflict (branch_id, week_start)
  do update set
    status = excluded.status,
    total_units = excluded.total_units,
    total_value = excluded.total_value,
    notes = excluded.notes,
    captured_by = excluded.captured_by,
    captured_by_name = excluded.captured_by_name,
    captured_at = now(),
    updated_at = now()
  returning id into v_id;

  delete from inventory_valuation_snapshot_lines where snapshot_id = v_id;

  insert into inventory_valuation_snapshot_lines (
    snapshot_id, branch_id, product_id, product_name, units, unit_cost, value, condition, note
  )
  select v_id, p_branch_id,
         nullif(item->>'productId', '')::uuid,
         coalesce(item->>'productName', ''),
         coalesce((item->>'units')::numeric, 0),
         coalesce((item->>'unitCost')::numeric, 0),
         coalesce((item->>'value')::numeric, 0),
         coalesce(nullif(item->>'condition', ''), 'healthy'),
         coalesce(item->>'note', '')
  from jsonb_array_elements(p_lines) as item;

  return v_id;
end;
$function$;
