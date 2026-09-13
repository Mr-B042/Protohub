-- Remove the org-keyed weekly uniqueness, now that every caller passes a branch.
--
-- ⚠️ THIS IS THE STEP THAT ACTUALLY LETS A SECOND BRANCH TRADE. Until now both
-- keys were enforced: the branch-keyed index from 262 AND the original
-- (org_id, week_start) one. The old one is what still stopped Accra saving its
-- own cash week, because Nigeria already had a row for that week in the same
-- organisation. Everything before this made the collision impossible to write
-- wrongly; this is what makes the right write possible at all.
--
-- Safe to run only because the routes calling these functions now pass
-- p_branch_id and were deployed first (PR #635, live before this migration).
-- The old overloads go too, so nothing can reach the org-keyed upsert by
-- accident and quietly recreate the collision.
--
-- Two are table constraints and one is a bare partial index, so both forms are
-- handled - dropping the index alone fails on a constraint-backed one.

alter table public.weekly_cash_verifications drop constraint if exists weekly_cash_verifications_week_unique;
alter table public.inventory_valuation_snapshots drop constraint if exists inventory_valuation_snapshots_week_unique;
drop index if exists public.weekly_cash_verifications_week_unique;
drop index if exists public.inventory_valuation_snapshots_week_unique;
drop index if exists public.cash_opening_balances_week_unique;

-- Named by full signature so only the org-keyed versions go.
drop function if exists public.save_weekly_opening_cash(uuid, date, numeric, text, uuid, text, jsonb);
drop function if exists public.save_weekly_cash_verification(uuid, date, numeric, numeric, text, text, uuid, text, jsonb);
drop function if exists public.save_inventory_valuation(uuid, date, text, text, uuid, text, jsonb);
