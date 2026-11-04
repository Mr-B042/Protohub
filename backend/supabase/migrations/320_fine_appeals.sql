-- Fine appeals (Bright, 4 Nov 2026: "can sale reps appeal on each of the fine
-- being charged by telling us why it shouldn't"). Missed-log charges already
-- had disputes (migration 272); this covers every other fine (rep_penalties):
-- late order sends, no delivery fee, fines typed by leadership.
--
-- Rules Bright chose: the Manager/Admin decides, and cancelling a fine the
-- Owner charged goes to the Owner; the fine is NOT deducted while the appeal
-- is open; a rep can appeal until that week's report goes to the Owner (and
-- the report cannot go while an appeal is undecided).
--
-- One appeal per fine. A cancelled fine's rep_penalties row is deleted; this
-- row keeps what it was (amount, label, who charged it).

create table if not exists public.fine_appeals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  rep_id uuid not null references public.users(id) on delete cascade,
  penalty_id uuid not null,
  week_start date not null,
  amount numeric(12,2) not null,
  fine_type text,
  fine_label text not null,
  charged_by_name text,
  charged_at timestamptz,
  rep_reason text not null check (char_length(btrim(rep_reason)) >= 5),
  status text not null default 'open' check (status in ('open', 'awaiting_owner', 'kept', 'cancelled')),
  decided_by uuid references public.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fine_appeals_one_per_fine on public.fine_appeals (penalty_id);
create index if not exists fine_appeals_branch_week on public.fine_appeals (org_id, branch_id, week_start);
alter table public.fine_appeals enable row level security;
