-- Email Marketing: Automations (Bright's designs 50, 51 and steps 2-4, 8 Nov 2026).
--
-- An automation is a flow of steps (wait, email, a yes/no check, tag, list)
-- that a customer walks through after a trigger (an order delivered, a cart
-- left behind, joining the list, no purchase in N days, a birthday...).
--  * email_automations: the flow, its trigger, audience and settings.
--  * email_automation_runs: one customer's walk through one automation.
--  * Each email step is sent through a hidden email_campaigns row
--    (automation_id + step_id), so sending, opens, clicks, unsubscribes and
--    orders from the email all work exactly as for campaigns.

create table if not exists public.email_automations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  description text not null default '',
  -- The ready-made flow it started from (post_purchase, win_back, ...), if any.
  template text,
  goal text not null default 'repeat',
  trigger jsonb not null default '{}'::jsonb,
  audience jsonb not null default '{"source":"all"}'::jsonb,
  -- Extra conditions a customer must meet to enter (optional).
  enrollment jsonb not null default '{}'::jsonb,
  -- Re-entry, frequency, priority, exit rules, send window, tracking, reply-to.
  settings jsonb not null default '{}'::jsonb,
  workflow jsonb not null default '{"nodes":[]}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  launched_at timestamptz,
  paused_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_automations_branch on public.email_automations (org_id, branch_id, status);
alter table public.email_automations enable row level security;

create table if not exists public.email_automation_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  automation_id uuid not null references public.email_automations(id) on delete cascade,
  contact_id uuid references public.email_contacts(id) on delete set null,
  email text not null,
  phone text,
  name text not null default '',
  -- The event that started it (an order id, a cart id, "date:2026", ...):
  -- one walk per event, never two.
  entry_key text not null,
  -- This customer's 1st, 2nd, ... time in this automation.
  entry_no integer not null default 1,
  status text not null default 'active' check (status in ('active', 'completed', 'exited')),
  exit_reason text,
  -- The step to do next, and when.
  node_id text,
  next_at timestamptz not null default now(),
  last_send_id uuid references public.email_campaign_sends(id) on delete set null,
  history jsonb not null default '[]'::jsonb,
  entered_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (automation_id, entry_key)
);
create index if not exists email_automation_runs_due on public.email_automation_runs (next_at) where status = 'active';
create index if not exists email_automation_runs_person on public.email_automation_runs (automation_id, email);
alter table public.email_automation_runs enable row level security;

-- The hidden campaign behind each email step.
alter table public.email_campaigns add column if not exists automation_id uuid references public.email_automations(id) on delete cascade;
alter table public.email_campaigns add column if not exists step_id text;
create index if not exists email_campaigns_automation on public.email_campaigns (automation_id) where automation_id is not null;
