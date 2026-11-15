-- Rows saved without a branch fell back to "Nigeria Operations" even when they
-- belong to another branch (15 Nov 2026 audit: Zambia's "+150 Edge Brusher Max"
-- stock history and its baseline were filed under Nigeria). Both branch
-- triggers now ask ANY linked record the row carries (product, order, cart,
-- agent, hub, count session, valuation snapshot) before the Nigeria fallback.

create or replace function public.branch_from_linked_record(p_row jsonb, p_org uuid)
 returns uuid
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v uuid;
begin
  begin
    if p_row ? 'product_id' and p_row->>'product_id' is not null then
      select branch_id into v from public.products where id::text = p_row->>'product_id' and org_id = p_org;
      if v is not null then return v; end if;
    end if;
    if p_row ? 'order_id' and p_row->>'order_id' is not null then
      select branch_id into v from public.orders where id::text = p_row->>'order_id' and org_id = p_org;
      if v is not null then return v; end if;
    end if;
    if p_row ? 'cart_id' and p_row->>'cart_id' is not null then
      select branch_id into v from public.abandoned_carts where id::text = p_row->>'cart_id';
      if v is not null then return v; end if;
    end if;
      if p_row ? 'agent_location_id' and p_row->>'agent_location_id' is not null then
        select branch_id into v from public.agent_locations where id::text = p_row->>'agent_location_id';
        if v is not null then return v; end if;
      end if;
      if p_row ? 'to_agent_location_id' and p_row->>'to_agent_location_id' is not null then
        select branch_id into v from public.agent_locations where id::text = p_row->>'to_agent_location_id';
        if v is not null then return v; end if;
      end if;
      if p_row ? 'from_agent_location_id' and p_row->>'from_agent_location_id' is not null then
        select branch_id into v from public.agent_locations where id::text = p_row->>'from_agent_location_id';
        if v is not null then return v; end if;
      end if;
    if p_row ? 'agent_id' and p_row->>'agent_id' is not null then
      select branch_id into v from public.agents where id::text = p_row->>'agent_id';
      if v is not null then return v; end if;
    end if;
    if p_row ? 'session_id' and p_row->>'session_id' is not null then
      select branch_id into v from public.stock_count_sessions where id::text = p_row->>'session_id';
      if v is not null then return v; end if;
    end if;
    if p_row ? 'snapshot_id' and p_row->>'snapshot_id' is not null then
      select branch_id into v from public.inventory_valuation_snapshots where id::text = p_row->>'snapshot_id';
      if v is not null then return v; end if;
    end if;
  exception when others then
    return null;
  end;
  return null;
end $function$;

create or replace function public.assign_default_branch_id()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.branch_id is not null then return new; end if;

  if tg_table_name = 'agent_stock' then
    select a.branch_id into new.branch_id from public.agents a where a.id = new.agent_id;
  elsif tg_table_name = 'agent_locations' then
    select a.branch_id into new.branch_id from public.agents a where a.id = new.agent_id;
  elsif tg_table_name = 'agent_location_stock' then
    select l.branch_id into new.branch_id from public.agent_locations l where l.id = new.agent_location_id;
  elsif tg_table_name = 'delivered_stock_reconciliation_lines' then
    select o.branch_id into new.branch_id from public.orders o where o.id = new.order_id;
  end if;
  -- Any linked record (product first) before the Nigeria fallback.
  if new.branch_id is null then
    new.branch_id := public.branch_from_linked_record(to_jsonb(new), new.org_id);
  end if;

  if new.branch_id is null and tg_table_name in ('orders', 'agents', 'stock_movements', 'abandoned_carts') then
    select b.id into new.branch_id from public.branches b
    where b.org_id = new.org_id and b.name = 'Nigeria Operations' and b.active
    order by b.created_at limit 1;
  end if;

  if new.branch_id is null then
    raise exception 'Unable to resolve branch for % insert', tg_table_name using errcode = '23502';
  end if;
  return new;
end;
$function$;

create or replace function public.assign_child_branch_id()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_branch uuid;
begin
  if new.branch_id is not null then return new; end if;

  -- Ask the parent record first.
  begin
    case tg_table_name
      when 'order_audit','order_field_edits','order_contact_attempts',
           'order_sales_expansion_attempts','order_sales_expansion_offer_lines',
           'follow_up_tasks','follow_up_misses','recovery_order_claims',
           'delivery_distance_audits','whatsapp_order_dispatches','recovery_template_sends' then
        select o.branch_id into v_branch from public.orders o where o.id = new.order_id;
      when 'cart_journey_events','cart_contact_attempts' then
        select a.branch_id into v_branch from public.abandoned_carts a where a.id = new.cart_id;
      when 'agent_coverage','agent_stock_audit','agent_balance_weekly_snapshots',
           'agent_balance_weekly_followups','user_agent_assignments' then
        select a.branch_id into v_branch from public.agents a where a.id = new.agent_id;
      when 'agent_stock_drift_baseline','inventory_balance_baselines' then
        select l.branch_id into v_branch from public.agent_locations l where l.id = new.agent_location_id;
      when 'waybill_records' then
        select a.branch_id into v_branch from public.agents a
        where a.id = coalesce(new.to_agent_id, new.from_agent_id, new.agent_id);
      when 'stock_count_entries' then
        select s.branch_id into v_branch from public.stock_count_sessions s where s.id = new.session_id;
      when 'inventory_valuation_snapshot_lines' then
        select s.branch_id into v_branch from public.inventory_valuation_snapshots s where s.id = new.snapshot_id;
      else
        v_branch := null;
    end case;
  exception when others then
    v_branch := null;
  end;

  -- Then any other linked record the row carries (warehouse baselines: their product).
  if v_branch is null then
    v_branch := public.branch_from_linked_record(to_jsonb(new), new.org_id);
  end if;

  if v_branch is null then
    begin
      select b.id into v_branch from public.branches b
      where b.org_id = new.org_id and b.name = 'Nigeria Operations' and b.active
      order by b.created_at limit 1;
    exception when others then
      v_branch := null;
    end;
  end if;

  new.branch_id := v_branch;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.assign_people_branch_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_branch uuid;
begin
  if new.branch_id is not null then return new; end if;

  begin
    case tg_table_name
      when 'customer_retention_touchpoints','customer_retention_action_events',
           'customer_retention_tasks','manager_activity_logs' then
        select o.branch_id into v_branch from public.orders o where o.id = new.order_id;
      when 'pda_agent_stock','pda_agreement_acceptances','pda_blocked_applicants',
           'pda_cod_discrepancies','pda_documents','pda_earning_payouts','pda_fee_negotiations',
           'pda_guarantors','pda_incidents','pda_inventory_baselines','pda_kyc_items','pda_notes',
           'pda_order_assignments','pda_remittances','pda_stock_discrepancies','pda_stock_ledger',
           'pda_stock_transfers' then
        select p.branch_id into v_branch from public.personal_delivery_agents p where p.id = new.agent_id;
      when 'pda_remittance_allocations' then
        select r.branch_id into v_branch from public.pda_remittances r where r.id = new.remittance_id;
      when 'sales_bonus_rules' then
        select p.branch_id into v_branch from public.sales_bonus_programs p where p.id = new.program_id;
      when 'sales_initiative_learnings' then
        select i.branch_id into v_branch from public.sales_initiatives i where i.id = new.initiative_id;
      when 'rep_coaching_action_items' then
        select p.branch_id into v_branch from public.rep_coaching_plans p where p.id = new.coaching_plan_id;
      when 'manager_product_challenge_allocations' then
        select c.branch_id into v_branch from public.manager_product_challenges c where c.id = new.challenge_id;
      else
        v_branch := null;
    end case;
  exception when others then
    v_branch := null;
  end;

  -- Then any other linked record the row carries (e.g. a stock notification's product).
  if v_branch is null then
    v_branch := public.branch_from_linked_record(to_jsonb(new), new.org_id);
  end if;

  if v_branch is null then
    begin
      select b.id into v_branch from public.branches b
      where b.org_id = new.org_id and b.name = 'Nigeria Operations' and b.active
      order by b.created_at limit 1;
    exception when others then
      v_branch := null;
    end;
  end if;

  new.branch_id := v_branch;
  return new;
end $function$;
