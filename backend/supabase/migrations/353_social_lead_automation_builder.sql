-- Create Automation builder (Bright, 13 Nov 2026): automations that Protohub
-- itself runs (trigger → conditions → actions → schedule → settings), next to
-- the ManyChat flows it only tracks.
alter table public.social_lead_automations add column if not exists kind text not null default 'manychat' check (kind in ('manychat', 'protohub'));
alter table public.social_lead_automations add column if not exists config jsonb not null default '{}'::jsonb;
alter table public.social_lead_automations add column if not exists next_run_at timestamptz;
alter table public.social_lead_automations add column if not exists runs_done integer not null default 0;
alter table public.social_lead_automations drop constraint if exists social_lead_automations_trigger_check;
alter table public.social_lead_automations add constraint social_lead_automations_trigger_check check (trigger in (
  'comment', 'keyword', 'time_delay', 'inactivity', 'after_reply', 'order_created', 'other',
  'new_message', 'new_lead', 'tag_added', 'order_update', 'assigned', 'time_based'));

-- One row per automation run for one lead: waits, limits, cool-downs and the numbers.
create table if not exists public.social_lead_automation_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  automation_id uuid not null references public.social_lead_automations(id) on delete cascade,
  lead_id uuid not null references public.social_leads(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'skipped', 'cancelled')),
  step integer not null default 0,
  run_at timestamptz not null default now(),
  log jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists social_lead_automation_runs_due on public.social_lead_automation_runs (status, run_at) where status = 'pending';
create index if not exists social_lead_automation_runs_lead on public.social_lead_automation_runs (automation_id, lead_id, created_at desc);
alter table public.social_lead_automation_runs enable row level security;

-- Order status last seen, so "Order Update" fires once per change.
alter table public.social_leads add column if not exists order_status text;
