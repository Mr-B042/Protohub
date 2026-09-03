-- Keep one product challenge while separating the manager reward from the
-- sales-rep reward pool distributed through challenge allocations.
alter table public.manager_product_challenges
  add column if not exists manager_reward_amount numeric(12,2) not null default 0;

alter table public.manager_product_challenges
  drop constraint if exists manager_product_challenges_manager_reward_check;

alter table public.manager_product_challenges
  add constraint manager_product_challenges_manager_reward_check
  check (manager_reward_amount >= 0);

comment on column public.manager_product_challenges.manager_reward_amount is
  'Manager/team reward for this shared challenge. reward_amount remains the independently allocated sales-rep reward pool.';
