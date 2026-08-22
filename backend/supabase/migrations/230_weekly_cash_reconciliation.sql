-- Weekly Reconciliation: does the cash we think we have actually exist?
--
-- Cash Flow can only ever say what was RECORDED. Reconciliation asks the other
-- question - what is really in the accounts - and the gap between the two is
-- the only number on the page that matters. A week that reconciles to zero
-- means the books are trustworthy; a week that does not means money moved
-- without being written down, and that is exactly what this table catches.

create table if not exists weekly_cash_verifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- Sunday. The official week anchor shared with payroll, bonuses and the
  -- Head of Sales scorecard, so cash weeks can never drift from pay weeks.
  week_start date not null,
  -- ⚠️ SNAPSHOTTED, not recomputed on read. What the system believed at the
  -- moment of verification is frozen here on purpose: a backdated expense
  -- entered next month must not silently rewrite a variance that has already
  -- been investigated and signed off. The live figure is still shown beside
  -- it, and a difference between them is itself worth seeing.
  expected_closing numeric not null default 0,
  actual_closing numeric not null default 0,
  status text not null default 'draft',
  notes text not null default '',
  verified_by uuid references users(id) on delete set null,
  -- Kept alongside the id so a deactivated user still names itself in history.
  verified_by_name text not null default '',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_cash_verifications_week_unique unique (org_id, week_start),
  constraint weekly_cash_verifications_status_check
    check (status in ('draft', 'verified', 'investigating', 'resolved')),
  constraint weekly_cash_verifications_notes_len check (char_length(notes) <= 250)
);

create index if not exists weekly_cash_verifications_org_week_idx
  on weekly_cash_verifications (org_id, week_start desc);

-- The per-account count behind a week's closing figure. "We closed with ₦2.48m"
-- is not checkable; "₦1.3m in GTBank and ₦80k in hand" can be held against the
-- actual statements, and it localises a variance to one account instead of
-- leaving the whole week suspect.
create table if not exists weekly_cash_verification_accounts (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references weekly_cash_verifications(id) on delete cascade,
  bank_account_id uuid references bank_accounts(id) on delete set null,
  account_label text not null default '',
  system_balance numeric not null default 0,
  actual_balance numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists weekly_cash_verification_accounts_parent_idx
  on weekly_cash_verification_accounts (verification_id);

-- A variance that is merely noticed is a variance that repeats. One row per
-- week, carrying how much of the gap has actually been accounted for.
create table if not exists cash_variance_investigations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  week_start date not null,
  verification_id uuid references weekly_cash_verifications(id) on delete set null,
  variance_amount numeric not null default 0,
  reason text not null default '',
  -- Partial explanations are the normal case: ₦100k traced to an unrecorded
  -- ad top-up while ₦20k is still missing. Storing the explained portion keeps
  -- "how far did we get" honest instead of forcing all-or-nothing.
  amount_explained numeric not null default 0,
  description text not null default '',
  occurred_on date,
  category text not null default '',
  evidence_name text not null default '',
  evidence_url text not null default '',
  status text not null default 'in_progress',
  created_by uuid references users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_variance_investigations_week_unique unique (org_id, week_start),
  constraint cash_variance_investigations_status_check
    check (status in ('in_progress', 'submitted', 'resolved')),
  constraint cash_variance_investigations_reason_check
    check (reason in ('', 'missing_transaction', 'incorrect_transaction', 'timing_difference',
                      'bank_charges', 'owner_withdrawal', 'cash_shortage',
                      'agent_remittance', 'transfer_misclassified', 'other')),
  constraint cash_variance_investigations_description_len check (char_length(description) <= 500)
);

create index if not exists cash_variance_investigations_org_week_idx
  on cash_variance_investigations (org_id, week_start desc);

-- The audit trail the investigation panel reads back. Append-only by
-- convention: entries record what happened and are never edited, so a
-- resolved variance can always be re-read in the order it was worked.
create table if not exists cash_variance_investigation_events (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references cash_variance_investigations(id) on delete cascade,
  kind text not null,
  detail text not null default '',
  amount numeric,
  actor_id uuid references users(id) on delete set null,
  actor_name text not null default '',
  created_at timestamptz not null default now(),
  constraint cash_variance_investigation_events_kind_check
    check (kind in ('started', 'evidence_uploaded', 'partial_explained', 'reason_set',
                    'submitted', 'resolved', 'reopened', 'note'))
);

create index if not exists cash_variance_investigation_events_parent_idx
  on cash_variance_investigation_events (investigation_id, created_at asc);

alter table weekly_cash_verifications enable row level security;
alter table weekly_cash_verification_accounts enable row level security;
alter table cash_variance_investigations enable row level security;
alter table cash_variance_investigation_events enable row level security;

-- Read is org-scoped for signed-in staff; writes go through the backend
-- service role, which enforces the Owner gate on the Cash Flow router.
drop policy if exists weekly_cash_verifications_select on weekly_cash_verifications;
create policy weekly_cash_verifications_select on weekly_cash_verifications
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));

drop policy if exists weekly_cash_verification_accounts_select on weekly_cash_verification_accounts;
create policy weekly_cash_verification_accounts_select on weekly_cash_verification_accounts
  for select to authenticated
  using (verification_id in (
    select id from weekly_cash_verifications
    where org_id in (select org_id from users where id = auth.uid())
  ));

drop policy if exists cash_variance_investigations_select on cash_variance_investigations;
create policy cash_variance_investigations_select on cash_variance_investigations
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));

drop policy if exists cash_variance_investigation_events_select on cash_variance_investigation_events;
create policy cash_variance_investigation_events_select on cash_variance_investigation_events
  for select to authenticated
  using (investigation_id in (
    select id from cash_variance_investigations
    where org_id in (select org_id from users where id = auth.uid())
  ));

-- Saving a week's count atomically.
--
-- ⚠️ Same hazard the weekly opening cash function was written to avoid: a
-- delete-then-insert across two round trips destroys the very count being
-- corrected if the second call fails. The parent is upserted (never deleted)
-- and its per-account rows replaced inside one transaction, so either the
-- whole correction lands or nothing moves. Only the named week is touched.
create or replace function public.save_weekly_cash_verification(
  p_org_id uuid,
  p_week_start date,
  p_expected numeric,
  p_actual numeric,
  p_status text,
  p_notes text,
  p_verified_by uuid,
  p_verified_by_name text,
  p_accounts jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into weekly_cash_verifications (
    org_id, week_start, expected_closing, actual_closing, status, notes,
    verified_by, verified_by_name, verified_at
  ) values (
    p_org_id, p_week_start, p_expected, p_actual, p_status, coalesce(p_notes, ''),
    p_verified_by, coalesce(p_verified_by_name, ''),
    case when p_status = 'draft' then null else now() end
  )
  on conflict (org_id, week_start)
  do update set
    expected_closing = excluded.expected_closing,
    actual_closing = excluded.actual_closing,
    status = excluded.status,
    notes = excluded.notes,
    verified_by = excluded.verified_by,
    verified_by_name = excluded.verified_by_name,
    verified_at = excluded.verified_at,
    updated_at = now()
  returning id into v_id;

  delete from weekly_cash_verification_accounts where verification_id = v_id;

  insert into weekly_cash_verification_accounts (
    verification_id, bank_account_id, account_label, system_balance, actual_balance
  )
  select v_id,
         nullif(item->>'bankAccountId', '')::uuid,
         coalesce(item->>'accountLabel', ''),
         coalesce((item->>'systemBalance')::numeric, 0),
         coalesce((item->>'actualBalance')::numeric, 0)
  from jsonb_array_elements(p_accounts) as item;

  return v_id;
end;
$$;

revoke all on function public.save_weekly_cash_verification(uuid, date, numeric, numeric, text, text, uuid, text, jsonb) from public;
revoke all on function public.save_weekly_cash_verification(uuid, date, numeric, numeric, text, text, uuid, text, jsonb) from anon;
revoke all on function public.save_weekly_cash_verification(uuid, date, numeric, numeric, text, text, uuid, text, jsonb) from authenticated;
grant execute on function public.save_weekly_cash_verification(uuid, date, numeric, numeric, text, text, uuid, text, jsonb) to service_role;
