-- ─────────────────────────────────────────────────────────────────────────────
-- Agent stock: make silent changes impossible to hide, and drift impossible to
-- miss.
--
-- ⚠️ WHY THIS EXISTS. On 2026-08-26 at 02:22:32 UTC four products at Edo State
-- Hub had their quantity overwritten in four seconds. No stock_movements row,
-- no order, no waybill, no transfer, no stock count, and the Railway HTTP log
-- for that window shows only GET /api/agents and GET /api/products — nothing
-- that mutates stock. Nine units left the books and nothing anywhere recorded
-- who did it or why.
--
-- That is the fifth stock-drift incident on this system. They keep recurring
-- for one structural reason: the BALANCE and the LEDGER are two separate
-- writes, so they can always diverge.
--
-- This migration does not fix that. It makes it VISIBLE and ATTRIBUTABLE:
--   1. a trigger that records every quantity change, whatever wrote it
--   2. a view that reconciles stored balances against the ledger
--   3. a baseline so the daily check alerts on NEW drift, not on history
--
-- The structural fix — one writer, ledger and balance in a single transaction,
-- after which the trigger can REJECT rather than merely record — is deliberately
-- NOT attempted here. The app currently writes the balance and the movement as
-- two separate PostgREST calls, so a same-transaction check would reject every
-- legitimate write.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The audit trail ──────────────────────────────────────────────────────
--
-- A trigger fires for EVERY writer: the API, a script, psql, an MCP call, or a
-- hand edit in the Supabase table editor. That last one is the case we could
-- not attribute, and it is the case RLS cannot stop.
create table if not exists agent_stock_audit (
  id                bigserial primary key,
  org_id            uuid,
  agent_id          uuid,
  agent_location_id uuid,
  product_id        uuid,
  operation         text        not null,
  old_quantity      integer,
  new_quantity      integer,
  delta             integer,
  old_defective     integer,
  new_defective     integer,
  old_missing       integer,
  new_missing       integer,
  -- Postgres role that made the change. The dashboard/table editor and the
  -- backend service key present differently here, which is the whole point.
  db_role           text        not null,
  -- Set by the API when it knows the human. NULL is itself a finding: it means
  -- the write did not come through an application path that identifies anyone.
  app_actor         text,
  changed_at        timestamptz not null default now()
);

create index if not exists agent_stock_audit_changed_at_idx
  on agent_stock_audit (changed_at desc);
create index if not exists agent_stock_audit_target_idx
  on agent_stock_audit (agent_location_id, product_id, changed_at desc);

comment on table agent_stock_audit is
  'Append-only record of every agent_location_stock change. Written by trigger, so no writer can bypass it. See migration 238.';

create or replace function log_agent_location_stock_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id   uuid;
  v_agent    uuid;
  v_location uuid;
  v_product  uuid;
  v_old_qty  integer;
  v_new_qty  integer;
  v_old_def  integer;
  v_new_def  integer;
  v_old_mis  integer;
  v_new_mis  integer;
begin
  -- ⚠️ Branch explicitly rather than coalesce(new, old): COALESCE over trigger
  -- RECORDs is not portable, and a trigger that throws here would block every
  -- stock write in the system rather than merely failing to log one.
  if tg_op = 'DELETE' then
    v_org_id := old.org_id; v_agent := old.agent_id;
    v_location := old.agent_location_id; v_product := old.product_id;
    v_old_qty := old.quantity;  v_new_qty := null;
    v_old_def := old.defective; v_new_def := null;
    v_old_mis := old.missing;   v_new_mis := null;
  elsif tg_op = 'INSERT' then
    v_org_id := new.org_id; v_agent := new.agent_id;
    v_location := new.agent_location_id; v_product := new.product_id;
    v_old_qty := null; v_new_qty := new.quantity;
    v_old_def := null; v_new_def := new.defective;
    v_old_mis := null; v_new_mis := new.missing;
  else
    v_org_id := new.org_id; v_agent := new.agent_id;
    v_location := new.agent_location_id; v_product := new.product_id;
    v_old_qty := old.quantity;  v_new_qty := new.quantity;
    v_old_def := old.defective; v_new_def := new.defective;
    v_old_mis := old.missing;   v_new_mis := new.missing;
  end if;

  -- Ignore no-op updates. An upsert that rewrites the same numbers is not a
  -- stock change and would only bury the real ones.
  if tg_op = 'UPDATE'
     and old.quantity  is not distinct from new.quantity
     and old.defective is not distinct from new.defective
     and old.missing   is not distinct from new.missing then
    return null;
  end if;

  insert into agent_stock_audit (
    org_id, agent_id, agent_location_id, product_id, operation,
    old_quantity, new_quantity, delta,
    old_defective, new_defective, old_missing, new_missing,
    db_role, app_actor
  ) values (
    v_org_id, v_agent, v_location, v_product, tg_op,
    v_old_qty, v_new_qty, coalesce(v_new_qty, 0) - coalesce(v_old_qty, 0),
    v_old_def, v_new_def, v_old_mis, v_new_mis,
    current_user,
    nullif(current_setting('app.actor', true), '')
  );

  return null;
exception when others then
  -- ⚠️ NEVER block a stock write because the audit insert failed. Losing one
  -- audit row is bad; refusing every delivery deduction in the business because
  -- of a logging fault is far worse. The failure is raised as a warning so it
  -- lands in the Postgres log rather than vanishing.
  raise warning 'agent_stock_audit insert failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_agent_location_stock_audit on agent_location_stock;
create trigger trg_agent_location_stock_audit
  after insert or update or delete on agent_location_stock
  for each row execute function log_agent_location_stock_change();

-- ── 2. Ledger reconciliation ────────────────────────────────────────────────
--
-- ⚠️ SIGNED DELTAS, NOT balance_after. balance_after means different things per
-- movement type — on a `Return` from a hub it holds the WAREHOUSE's balance,
-- not the hub's — so reading it as the hub's balance is exactly the kind of
-- mistake that produced the earlier ledger sign bug.
--
-- The sign map below was validated against live data before being written here:
-- 355 of 385 hub/product pairs reconcile exactly. Every rule is stated once.
--
--   Waybill In            to = hub    → +qty   (destination gains on receipt)
--   Distributed to Agent  to = hub    → +qty
--   Return                to = hub    → +qty
--   Waybill Out         from = hub    → -qty   (source loses on dispatch)
--   Order Fulfilled     from = hub    → -qty
--   Return              from = hub    → -qty
--   Correction          either side   → +qty   (qty is ALREADY SIGNED: a
--                                               reduction is stored as -3)
--
-- A hub→hub waybill writes both an Out and an In carrying both ids; the source
-- is debited only by the Out and the destination credited only by the In, which
-- is why each rule names the side it applies to.
create or replace view agent_stock_reconciliation as
select
  als.org_id,
  als.agent_id,
  als.agent_location_id,
  als.product_id,
  als.quantity as stored_quantity,
  coalesce((
    select sum(
      case
        when sm.type in ('Waybill In', 'Distributed to Agent')
             and sm.to_agent_location_id = als.agent_location_id then sm.qty
        when sm.type = 'Return'
             and sm.to_agent_location_id = als.agent_location_id then sm.qty
        when sm.type in ('Waybill Out', 'Order Fulfilled', 'Return')
             and sm.from_agent_location_id = als.agent_location_id then -sm.qty
        when sm.type = 'Correction'
             and (sm.from_agent_location_id = als.agent_location_id
               or sm.to_agent_location_id = als.agent_location_id) then sm.qty
        else 0
      end)
    from stock_movements sm
    where sm.product_id = als.product_id
      and (sm.from_agent_location_id = als.agent_location_id
        or sm.to_agent_location_id = als.agent_location_id)
  ), 0)::integer as ledger_quantity,
  (als.quantity - coalesce((
    select sum(
      case
        when sm.type in ('Waybill In', 'Distributed to Agent')
             and sm.to_agent_location_id = als.agent_location_id then sm.qty
        when sm.type = 'Return'
             and sm.to_agent_location_id = als.agent_location_id then sm.qty
        when sm.type in ('Waybill Out', 'Order Fulfilled', 'Return')
             and sm.from_agent_location_id = als.agent_location_id then -sm.qty
        when sm.type = 'Correction'
             and (sm.from_agent_location_id = als.agent_location_id
               or sm.to_agent_location_id = als.agent_location_id) then sm.qty
        else 0
      end)
    from stock_movements sm
    where sm.product_id = als.product_id
      and (sm.from_agent_location_id = als.agent_location_id
        or sm.to_agent_location_id = als.agent_location_id)
  ), 0))::integer as drift
from agent_location_stock als;

comment on view agent_stock_reconciliation is
  'Stored hub balance vs the balance its ledger explains. drift > 0 = more stock on the books than movements account for (usually pre-ledger seeding); drift < 0 = stock has left the books with nothing recording it.';

-- ── 3. Accepted drift ───────────────────────────────────────────────────────
--
-- Hubs stocked before location-level ledgering existed carry permanent positive
-- drift — their opening balances have no movements behind them. Alerting on
-- those every night would train everyone to ignore the alert, which is how a
-- real shortfall gets missed.
--
-- So the daily check compares against this baseline and reports only CHANGE.
create table if not exists agent_stock_drift_baseline (
  agent_location_id uuid        not null,
  product_id        uuid        not null,
  drift             integer     not null,
  noted_at          timestamptz not null default now(),
  note              text,
  primary key (agent_location_id, product_id)
);

comment on table agent_stock_drift_baseline is
  'Drift that has been seen and accepted. The nightly check alerts when current drift differs from this, not when drift merely exists.';

-- ⚠️ SEEDS ONLY NON-NEGATIVE DRIFT. Positive drift is the legacy-seeding
-- artefact described above. NEGATIVE drift means stock left the books with
-- nothing explaining it — the Edo State Hub shortfall this migration exists
-- because of — and baselining that would silence the alarm on the way in.
insert into agent_stock_drift_baseline (agent_location_id, product_id, drift, note)
select agent_location_id, product_id, drift,
       'Seeded at install (migration 238) — pre-existing, unexplained by the ledger'
from agent_stock_reconciliation
where drift > 0
on conflict (agent_location_id, product_id) do nothing;

-- ── 4. Lock the new tables down ─────────────────────────────────────────────
-- No client-side policies: these are read through the backend, which uses the
-- service key. RLS on with no policy denies anon and authenticated outright.
alter table agent_stock_audit          enable row level security;
alter table agent_stock_drift_baseline enable row level security;
