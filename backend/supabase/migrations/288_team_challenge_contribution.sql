-- Team Challenges, profit-weighted points (Bright, 3 Oct 2026). A
-- transaction scores by the ADDED CONTRIBUTION it created: additional amount
-- collected − added product cost − extra logistics − rep bonus − packaging −
-- gifts. ₦10,000–₦49,999 = 1 point, ₦50,000+ = 2, below = 0 (still shown).
-- Additive only.
alter table public.team_challenge_entries
  add column if not exists contribution numeric(14, 2),
  add column if not exists contribution_breakdown jsonb,
  add column if not exists contribution_final boolean not null default false,
  -- Manager adjustment (e.g. the upgrade raised delivery cost), with a reason; logged.
  add column if not exists adjustment_amount numeric(14, 2) not null default 0,
  add column if not exists adjustment_reason text,
  add column if not exists adjustment_by_name text,
  add column if not exists adjusted_at timestamptz,
  add column if not exists escalated_at timestamptz,
  add column if not exists escalation_note text;
-- The last three months run through the same rule, before the challenge starts.
alter table public.team_challenges add column if not exists baseline jsonb;
