-- ₦500 daily penalty for a rep who logs nothing on their assigned carts.
--
-- The order follow-up KPI already charges ₦50 per ORDER per day. This is
-- deliberately different: ₦500 flat per REP per day, because a rep with 61
-- carts and a rep with 6 have committed the same offence by not logging, and
-- a per-cart rate would have charged one of them ₦30,500 for it.
--
-- ⚠️ NEVER auto-deducted. A miss is recorded as 'pending' and only becomes
-- money when the Owner approves it, exactly as the order penalty works. The
-- rep can be wrong about a day; payroll should not be.

create table if not exists cart_log_misses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  rep_id uuid not null references users(id) on delete cascade,
  -- Kept alongside the id so a deactivated rep still names itself in history.
  rep_name text not null default '',
  miss_date date not null,
  amount numeric not null default 500,
  -- How many assigned, still-open carts needed a log that day. Stored so a
  -- disputed charge can be re-read without reconstructing the whole board.
  carts_due integer not null default 0,
  status text not null default 'pending',
  reviewed_by uuid references users(id) on delete set null,
  reviewed_by_name text not null default '',
  reviewed_at timestamptz,
  review_note text not null default '',
  created_at timestamptz not null default now(),
  constraint cart_log_misses_unique unique (org_id, rep_id, miss_date),
  constraint cart_log_misses_status_check check (status in ('pending', 'approved', 'waived')),
  constraint cart_log_misses_amount_check check (amount >= 0),
  constraint cart_log_misses_note_len check (char_length(review_note) <= 250)
);

create index if not exists cart_log_misses_org_date_idx on cart_log_misses (org_id, miss_date desc);
create index if not exists cart_log_misses_rep_idx on cart_log_misses (rep_id, miss_date desc);

alter table cart_log_misses enable row level security;

drop policy if exists cart_log_misses_select on cart_log_misses;
create policy cart_log_misses_select on cart_log_misses
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));
