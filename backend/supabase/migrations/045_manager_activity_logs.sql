create table if not exists manager_activity_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  team_id uuid not null references sales_teams(id) on delete cascade,
  manager_id uuid references users(id) on delete set null,
  actor_id uuid references users(id) on delete set null,
  actor_name text,
  order_id text references orders(id) on delete set null,
  rep_id uuid references users(id) on delete set null,
  action_type text not null check (action_type in ('reviewed_queue', 'nudged_rep', 'escalated_order', 'manager_note')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_manager_activity_logs_org_created
  on manager_activity_logs (org_id, created_at desc);
create index if not exists idx_manager_activity_logs_team_created
  on manager_activity_logs (team_id, created_at desc);
create index if not exists idx_manager_activity_logs_manager_created
  on manager_activity_logs (manager_id, created_at desc);
