create table if not exists follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  order_id text not null references orders(id) on delete cascade,
  assigned_rep_id uuid references users(id) on delete set null,
  team_id uuid references sales_teams(id) on delete set null,
  manager_id uuid references users(id) on delete set null,
  task_type text not null check (task_type in ('callback', 'payment_check', 'delivery_confirmation', 'waybill_follow_up')),
  priority text not null default 'normal' check (priority in ('same_day', 'normal', 'low_intent')),
  status text not null default 'open' check (status in ('open', 'due', 'overdue', 'completed', 'cancelled')),
  due_at timestamptz not null,
  sla_minutes integer not null default 15 check (sla_minutes >= 0),
  note text,
  source_kind text,
  source_ref text,
  created_from_attempt_id uuid,
  completed_attempt_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_follow_up_tasks_set_updated_at on follow_up_tasks;
create trigger trg_follow_up_tasks_set_updated_at
before update on follow_up_tasks
for each row execute function set_updated_at();

create index if not exists idx_follow_up_tasks_org_due
  on follow_up_tasks (org_id, due_at desc);

create index if not exists idx_follow_up_tasks_order_status
  on follow_up_tasks (order_id, status, due_at desc);

create index if not exists idx_follow_up_tasks_assigned_rep
  on follow_up_tasks (assigned_rep_id, status, due_at desc);

create table if not exists order_contact_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  order_id text not null references orders(id) on delete cascade,
  task_id uuid references follow_up_tasks(id) on delete set null,
  rep_id uuid references users(id) on delete set null,
  team_id uuid references sales_teams(id) on delete set null,
  manager_id uuid references users(id) on delete set null,
  attempted_at timestamptz not null default now(),
  channel text not null default 'manual' check (channel in ('call', 'whatsapp', 'sms', 'manual')),
  attempt_type text not null default 'fresh_follow_up' check (attempt_type in ('scheduled_callback', 'fresh_follow_up', 'delivery_confirmation', 'payment_follow_up', 'waybill_follow_up')),
  outcome_code text not null,
  outcome_note text,
  customer_reached boolean,
  next_action_type text,
  next_action_at timestamptz,
  promise_window text check (promise_window in ('same_day', 'tomorrow', 'later')),
  is_serious_signal boolean,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_contact_attempts_org_attempted
  on order_contact_attempts (org_id, attempted_at desc);

create index if not exists idx_order_contact_attempts_order_attempted
  on order_contact_attempts (order_id, attempted_at desc);

create index if not exists idx_order_contact_attempts_rep_attempted
  on order_contact_attempts (rep_id, attempted_at desc);

alter table orders
  add column if not exists buyer_health text not null default 'healthy',
  add column if not exists follow_up_attempt_count integer not null default 0,
  add column if not exists last_contact_attempt_at timestamptz,
  add column if not exists last_contact_attempt_outcome text,
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists overdue_follow_up_count integer not null default 0;

create index if not exists idx_orders_buyer_health
  on orders (org_id, buyer_health);

create index if not exists idx_orders_next_follow_up
  on orders (org_id, next_follow_up_at desc);
