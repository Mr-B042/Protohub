-- Make child records belong to the same branch as their parent.
--
-- ⚠️ ORDERS, CARTS AND AGENTS ARE BRANCH-OWNED. THEIR HISTORY IS NOT.
-- An order belongs to Nigeria Operations; its audit trail, its call logs and
-- its follow-up tasks belong to nobody, so they show in every branch. Open
-- Accra today and you read Nigeria's call notes. Same for cart journeys, agent
-- coverage and the weekly balance snapshots.
--
-- This adds branch_id to those children and to the stock/logistics tables, and
-- fills it in FROM THE PARENT so no row has to be guessed at. Where a table has
-- no parent to inherit from (a stock count session, a valuation snapshot), it
-- falls back to the organisation's Nigeria Operations branch, which is where
-- every existing row was created.
--
-- This migration changes no behaviour on its own. Nothing filters on branch_id
-- until the routes do - the server signs in with the service role, so row-level
-- security cannot enforce it. This is the foundation that lets those route
-- changes be written and checked one group at a time.

-- ── 1. The column, everywhere ───────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    -- children of orders
    'order_audit','order_field_edits','order_contact_attempts',
    'order_sales_expansion_attempts','order_sales_expansion_offer_lines',
    'follow_up_tasks','follow_up_misses','recovery_order_claims',
    'delivery_distance_audits','whatsapp_order_dispatches','recovery_template_sends',
    -- children of abandoned carts
    'cart_journey_events','cart_contact_attempts','cart_log_misses',
    -- children of agents / agent locations
    'agent_coverage','agent_stock_audit','agent_stock_drift_baseline',
    'agent_balance_weekly_snapshots','agent_balance_weekly_followups',
    'user_agent_assignments','inventory_balance_baselines',
    -- stock and logistics
    'waybill_records','stock_count_sessions','stock_count_entries',
    'inventory_valuation_snapshots','inventory_valuation_snapshot_lines',
    'state_replenishment_notes',
    -- misc operational
    'recovery_actions','sales_call_reviews','customer_flags'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists branch_id uuid references public.branches(id) on delete restrict',
      t);
  end loop;
end $$;

-- ── 2. Inherit from the parent ──────────────────────────────────────────────
-- Every one of these reads the branch off the record it already belongs to, so
-- the answer is the parent's, never an assumption.

-- Children of orders. orders.id is text, so these join on text.
update public.order_audit c                      set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;
update public.order_field_edits c                set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;
update public.order_contact_attempts c           set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;
update public.order_sales_expansion_attempts c   set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;
update public.order_sales_expansion_offer_lines c set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;
update public.follow_up_tasks c                  set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;
update public.follow_up_misses c                 set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;
update public.recovery_order_claims c            set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;
update public.delivery_distance_audits c         set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;
update public.whatsapp_order_dispatches c        set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;
update public.recovery_template_sends c          set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;

-- Children of abandoned carts.
update public.cart_journey_events c    set branch_id = a.branch_id from public.abandoned_carts a where a.id = c.cart_id and c.branch_id is null;
update public.cart_contact_attempts c  set branch_id = a.branch_id from public.abandoned_carts a where a.id = c.cart_id and c.branch_id is null;

-- Children of agents and their hubs.
update public.agent_coverage c                set branch_id = a.branch_id from public.agents a          where a.id = c.agent_id and c.branch_id is null;
update public.agent_stock_audit c             set branch_id = a.branch_id from public.agents a          where a.id = c.agent_id and c.branch_id is null;
update public.agent_balance_weekly_snapshots c set branch_id = a.branch_id from public.agents a         where a.id = c.agent_id and c.branch_id is null;
update public.agent_balance_weekly_followups c set branch_id = a.branch_id from public.agents a         where a.id = c.agent_id and c.branch_id is null;
update public.user_agent_assignments c        set branch_id = a.branch_id from public.agents a          where a.id = c.agent_id and c.branch_id is null;
update public.agent_stock_drift_baseline c    set branch_id = l.branch_id from public.agent_locations l where l.id = c.agent_location_id and c.branch_id is null;
update public.inventory_balance_baselines c   set branch_id = l.branch_id from public.agent_locations l where l.id = c.agent_location_id and c.branch_id is null;

-- Waybills follow the hub that sent or received them. A waybill from the
-- warehouse has no sending agent, so the receiver decides, then the sender.
update public.waybill_records w set branch_id = a.branch_id from public.agents a
  where w.branch_id is null and a.id = coalesce(w.to_agent_id, w.from_agent_id, w.agent_id);

-- A stock count line belongs to its session.
update public.stock_count_entries e set branch_id = s.branch_id from public.stock_count_sessions s
  where s.id = e.session_id and e.branch_id is null;
-- A valuation line belongs to its snapshot.
update public.inventory_valuation_snapshot_lines l set branch_id = s.branch_id from public.inventory_valuation_snapshots s
  where s.id = l.snapshot_id and l.branch_id is null;

-- ── 3. Anything with no parent to inherit from ──────────────────────────────
-- ⚠️ EVERY EXISTING ROW WAS CREATED IN NIGERIA, because the other three
-- branches were seeded empty in migration 256 and have never traded. Falling
-- back to Nigeria Operations is a statement of fact about this data, not a
-- guess - and it is deliberately the LAST step, so a row that could inherit a
-- real parent always does.
do $$
declare t text;
begin
  foreach t in array array[
    'cart_log_misses','recovery_actions','sales_call_reviews','customer_flags',
    'stock_count_sessions','inventory_valuation_snapshots','state_replenishment_notes',
    'order_audit','order_field_edits','order_contact_attempts',
    'order_sales_expansion_attempts','order_sales_expansion_offer_lines',
    'follow_up_tasks','follow_up_misses','recovery_order_claims',
    'delivery_distance_audits','whatsapp_order_dispatches','recovery_template_sends',
    'cart_journey_events','cart_contact_attempts','agent_stock_audit',
    'agent_balance_weekly_snapshots','agent_balance_weekly_followups',
    'user_agent_assignments','inventory_balance_baselines','waybill_records'
  ]
  loop
    execute format($f$
      update public.%I t set branch_id = b.id
      from public.branches b
      where t.branch_id is null
        and b.org_id = t.org_id
        and b.name = 'Nigeria Operations'
        and b.active
    $f$, t);
  end loop;
end $$;

-- These three have no org_id of their own, so they reach it through a parent.
update public.agent_coverage c set branch_id = b.id
from public.agents a join public.branches b on b.org_id = a.org_id
where c.branch_id is null and a.id = c.agent_id and b.name = 'Nigeria Operations' and b.active;

update public.stock_count_entries e set branch_id = b.id
from public.stock_count_sessions s join public.branches b on b.org_id = s.org_id
where e.branch_id is null and s.id = e.session_id and b.name = 'Nigeria Operations' and b.active;

update public.inventory_valuation_snapshot_lines l set branch_id = b.id
from public.inventory_valuation_snapshots s join public.branches b on b.org_id = s.org_id
where l.branch_id is null and s.id = l.snapshot_id and b.name = 'Nigeria Operations' and b.active;

update public.agent_stock_drift_baseline c set branch_id = b.id
from public.agent_locations l join public.branches b on b.org_id = l.org_id
where c.branch_id is null and l.id = c.agent_location_id and b.name = 'Nigeria Operations' and b.active;

-- ── 4. Indexes ──────────────────────────────────────────────────────────────
-- Every read of these tables is about to gain "and branch_id = ?", so each one
-- needs the column indexed or the filter turns a fast query into a scan.
do $$
declare t text;
begin
  foreach t in array array[
    'order_audit','order_field_edits','order_contact_attempts',
    'order_sales_expansion_attempts','order_sales_expansion_offer_lines',
    'follow_up_tasks','follow_up_misses','recovery_order_claims',
    'delivery_distance_audits','whatsapp_order_dispatches','recovery_template_sends',
    'cart_journey_events','cart_contact_attempts','cart_log_misses',
    'agent_coverage','agent_stock_audit','agent_stock_drift_baseline',
    'agent_balance_weekly_snapshots','agent_balance_weekly_followups',
    'user_agent_assignments','inventory_balance_baselines',
    'waybill_records','stock_count_sessions','stock_count_entries',
    'inventory_valuation_snapshots','inventory_valuation_snapshot_lines',
    'state_replenishment_notes','recovery_actions','sales_call_reviews','customer_flags'
  ]
  loop
    execute format('create index if not exists %I on public.%I (branch_id)', t || '_branch_idx', t);
  end loop;
end $$;

-- ── 5. Nothing new arrives without a branch ─────────────────────────────────
-- ⚠️ THE ROUTES DO NOT SET branch_id YET. Without this, every row written from
-- today until those routes ship would land with a null branch and drop out of
-- the branch it belongs to the moment filtering is switched on - silently, and
-- only for the newest records, which is the worst kind of gap to find later.
--
-- The parent is asked first; the organisation's Nigeria branch is the fallback,
-- exactly as migration 257 does for orders and agents.
create or replace function public.assign_child_branch_id()
returns trigger language plpgsql security definer set search_path = public as $$
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
    -- A missing parent must never block the write. The fallback below covers it.
    v_branch := null;
  end;

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
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'order_audit','order_field_edits','order_contact_attempts',
    'order_sales_expansion_attempts','order_sales_expansion_offer_lines',
    'follow_up_tasks','follow_up_misses','recovery_order_claims',
    'delivery_distance_audits','whatsapp_order_dispatches','recovery_template_sends',
    'cart_journey_events','cart_contact_attempts','cart_log_misses',
    'agent_coverage','agent_stock_audit','agent_stock_drift_baseline',
    'agent_balance_weekly_snapshots','agent_balance_weekly_followups',
    'user_agent_assignments','inventory_balance_baselines',
    'waybill_records','stock_count_sessions','stock_count_entries',
    'inventory_valuation_snapshots','inventory_valuation_snapshot_lines',
    'state_replenishment_notes','recovery_actions','sales_call_reviews','customer_flags'
  ]
  loop
    execute format('drop trigger if exists trg_assign_child_branch on public.%I', t);
    execute format(
      'create trigger trg_assign_child_branch before insert on public.%I for each row execute function public.assign_child_branch_id()',
      t);
  end loop;
end $$;
