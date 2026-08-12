-- Demo users
--
-- Accounts that exist so the Owner can view-as a role and see it with that
-- role's own data scoping, without a real person's workload being involved.
--
-- The flag is the whole point. A demo account that reaches payroll, the
-- round-robin, a leaderboard or a bonus run is not a testing tool - it is a
-- phantom employee quietly changing the numbers the business is run on. So the
-- exclusion lives here as a column, not as a naming convention someone has to
-- remember, and every money or assignment path filters on it explicitly.
--
-- Deliberately NOT reusing `active = false`. A disabled user cannot sign in and
-- cannot be viewed-as, which is the opposite of what this needs: demo accounts
-- must be fully functional inside the app and fully invisible to operations.
alter table public.users
  add column if not exists is_demo boolean not null default false;

comment on column public.users.is_demo is
  'Testing account. Fully usable in-app, excluded from payroll, round-robin, bonuses, leaderboards, assignment pickers and presence. Never a real person.';

-- Round-robin, payroll and bonus queries all filter on this, so it earns an
-- index despite the low cardinality - they run on every order and every run.
create index if not exists users_org_is_demo on public.users (org_id, is_demo);
