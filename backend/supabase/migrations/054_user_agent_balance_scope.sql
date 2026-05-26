alter table public.users
  add column if not exists agent_balance_scope_mode text not null default 'all';
alter table public.users
  drop constraint if exists users_agent_balance_scope_mode_check;
alter table public.users
  add constraint users_agent_balance_scope_mode_check
  check (agent_balance_scope_mode in ('all', 'states', 'agents'));
alter table public.users
  add column if not exists agent_balance_state_scope text[] not null default '{}'::text[];
alter table public.users
  add column if not exists agent_balance_agent_ids uuid[] not null default '{}'::uuid[];
