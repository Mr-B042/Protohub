-- Restricted cash: money that is still in the account but already spoken for.
--
-- ⚠️ A reserve is a LABEL, not a movement. Setting ₦800,000 aside for payroll
-- does not transfer, withdraw, or otherwise touch a single naira - the cash
-- stays exactly where it is and every bank balance, cash flow total and
-- reconciliation figure is unaffected. All a reserve changes is Free Operating
-- Cash: what is left once the promises are taken off the top.
--
-- This is deliberate. Making reserves move money would put a bank transaction
-- behind every bookkeeping decision, and each one would then have to be matched
-- on a statement that never showed it. Nothing in this file writes to
-- bank_accounts, expenses, or remittance_transactions, and nothing should.

create table if not exists cash_reserves (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- Human-facing handle (RES-2508-001) so a reserve can be named in a
  -- conversation without reading out a uuid.
  ref_code text not null,
  name text not null,
  purpose text not null default '',
  -- Which account the money is notionally held in. Nullable: a reserve can be
  -- taken against the business as a whole rather than one account.
  bank_account_id uuid references bank_accounts(id) on delete set null,
  -- Kept alongside the id so a deleted account still names itself in history.
  account_label text not null default '',
  amount numeric not null,
  -- Whether operations may dip into it without a formal release. Most reserves
  -- are "No"; an advertising buffer might reasonably be "Yes".
  available_to_use boolean not null default false,
  expected_release_date date,
  status text not null default 'active',
  -- Released so far. A reserve can be let go in parts - half the payroll
  -- reserve paid out mid-month - so this is a running figure, not a flag.
  released_amount numeric not null default 0,
  category text not null default 'other',
  created_by uuid references users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_reserves_ref_unique unique (org_id, ref_code),
  constraint cash_reserves_amount_check check (amount > 0),
  constraint cash_reserves_released_check check (released_amount >= 0 and released_amount <= amount),
  constraint cash_reserves_status_check check (status in ('active', 'released', 'cancelled')),
  constraint cash_reserves_category_check
    check (category in ('payroll', 'tax', 'supplier', 'advertising', 'emergency', 'owner', 'other')),
  constraint cash_reserves_name_len check (char_length(name) between 1 and 80),
  constraint cash_reserves_purpose_len check (char_length(purpose) <= 200)
);

create index if not exists cash_reserves_org_status_idx on cash_reserves (org_id, status);
create index if not exists cash_reserves_org_release_idx on cash_reserves (org_id, expected_release_date);

-- Releasing in parts, with who did it and why. Again: no money moves. A
-- release only stops the amount being held back from Free Operating Cash.
create table if not exists cash_reserve_releases (
  id uuid primary key default gen_random_uuid(),
  reserve_id uuid not null references cash_reserves(id) on delete cascade,
  amount numeric not null,
  released_at timestamptz not null default now(),
  released_by uuid references users(id) on delete set null,
  released_by_name text not null default '',
  note text not null default '',
  constraint cash_reserve_releases_amount_check check (amount > 0),
  constraint cash_reserve_releases_note_len check (char_length(note) <= 200)
);

create index if not exists cash_reserve_releases_parent_idx
  on cash_reserve_releases (reserve_id, released_at desc);

alter table cash_reserves enable row level security;
alter table cash_reserve_releases enable row level security;

drop policy if exists cash_reserves_select on cash_reserves;
create policy cash_reserves_select on cash_reserves
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));

drop policy if exists cash_reserve_releases_select on cash_reserve_releases;
create policy cash_reserve_releases_select on cash_reserve_releases
  for select to authenticated
  using (reserve_id in (
    select id from cash_reserves
    where org_id in (select org_id from users where id = auth.uid())
  ));

-- Releasing atomically.
--
-- ⚠️ Read-modify-write from the API would let two concurrent releases each
-- read the same released_amount and both succeed, letting more out of a
-- reserve than it ever held. The running total is incremented inside one
-- statement and the CHECK constraint refuses an over-release, so the second
-- caller fails rather than quietly overdrawing it.
create or replace function public.release_cash_reserve(
  p_reserve_id uuid,
  p_org_id uuid,
  p_amount numeric,
  p_note text,
  p_released_by uuid,
  p_released_by_name text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released numeric;
  v_amount numeric;
begin
  update cash_reserves
     set released_amount = released_amount + p_amount,
         status = case when released_amount + p_amount >= amount then 'released' else status end,
         updated_at = now()
   where id = p_reserve_id and org_id = p_org_id
  returning released_amount, amount into v_released, v_amount;

  if v_released is null then
    raise exception 'Reserve not found.';
  end if;

  insert into cash_reserve_releases (reserve_id, amount, released_by, released_by_name, note)
  values (p_reserve_id, p_amount, p_released_by, coalesce(p_released_by_name, ''), coalesce(p_note, ''));

  return v_amount - v_released;
end;
$$;

revoke all on function public.release_cash_reserve(uuid, uuid, numeric, text, uuid, text) from public;
revoke all on function public.release_cash_reserve(uuid, uuid, numeric, text, uuid, text) from anon;
revoke all on function public.release_cash_reserve(uuid, uuid, numeric, text, uuid, text) from authenticated;
grant execute on function public.release_cash_reserve(uuid, uuid, numeric, text, uuid, text) to service_role;
