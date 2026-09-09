-- Notes on a state's replenishment position.
--
-- The rest of the State Replenishment page is derived - stock, orders and
-- waybills the browser already holds, recomputed on every render. This is the
-- one thing on it that has to be remembered: why an Inventory Manager did NOT
-- send stock into a state that looks short ("agent travelling until Monday",
-- "customer already refunded"), so the next person reading the same red row
-- does not ship against a decision that was already made.
--
-- Scoped to a state, optionally narrowed to one product. Append-only by
-- design: a note is a record of what someone believed at a moment, so it is
-- deleted rather than edited.

create table if not exists public.state_replenishment_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- ⚠️ THE CANONICAL KEY, NOT THE TYPED STATE. Hubs and orders carry free text:
  -- "Rivers" and "Rivers State" are one place, "Abuja"/"FCT" another. Keying on
  -- the raw string splits one state's notes across two rows - the same label
  -- mismatch that once skipped stock deduction outright. The client sends the
  -- same canonicalStateKey() the stock pages group by, and the label it
  -- displayed alongside it.
  state_key text not null check (length(trim(state_key)) > 0),
  state_label text not null default '',
  product_id uuid references public.products(id) on delete set null,
  product_name_snapshot text not null default '',
  body text not null check (length(trim(body)) between 1 and 2000),
  created_by uuid references public.users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists state_replenishment_notes_state_idx
  on public.state_replenishment_notes (org_id, state_key, created_at desc);

alter table public.state_replenishment_notes enable row level security;
drop policy if exists state_replenishment_notes_select on public.state_replenishment_notes;
create policy state_replenishment_notes_select on public.state_replenishment_notes
  -- private.auth_org_id(), not public - migration 092 moved the auth helpers
  -- into the private schema and there is no public.auth_org_id() on this
  -- project. Wrapped in a sub-select so the planner evaluates it once.
  for select using (org_id = (select private.auth_org_id()));
