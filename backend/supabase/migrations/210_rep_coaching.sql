-- Rep Coaching (Head of Sales Rep, Stage 7): a manually-logged call review
-- record and one ongoing coaching plan per rep, with a checklist of action
-- items. Nothing here is computed - it is authored by whoever is running
-- the coaching conversation.

create table if not exists public.sales_call_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_id uuid not null references public.users(id) on delete cascade,
  customer_name text not null,
  called_at timestamptz not null,
  duration_seconds integer,
  outcome text not null,
  star_score smallint check (star_score between 1 and 5),
  reviewer_id uuid references public.users(id) on delete set null,
  reviewer_notes text,
  created_at timestamptz not null default now(),
  constraint sales_call_reviews_duration_nonnegative check (duration_seconds is null or duration_seconds >= 0)
);

create index if not exists sales_call_reviews_org_rep on public.sales_call_reviews (org_id, rep_id, called_at desc);

create table if not exists public.rep_coaching_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_id uuid not null references public.users(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One ongoing plan per rep - action items accumulate on it rather than a
-- new plan being created every week.
create unique index if not exists rep_coaching_plans_org_rep_unique on public.rep_coaching_plans (org_id, rep_id);

create table if not exists public.rep_coaching_action_items (
  id uuid primary key default gen_random_uuid(),
  coaching_plan_id uuid not null references public.rep_coaching_plans(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  description text not null,
  target_count integer,
  completed_count integer not null default 0,
  due_date date,
  status text not null default 'Not Started' check (status in ('Not Started', 'In Progress', 'Completed')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rep_coaching_action_items_counts_nonnegative check (
    (target_count is null or target_count >= 0) and completed_count >= 0
  )
);

create index if not exists rep_coaching_action_items_plan on public.rep_coaching_action_items (coaching_plan_id);

alter table public.sales_call_reviews enable row level security;
alter table public.rep_coaching_plans enable row level security;
alter table public.rep_coaching_action_items enable row level security;

drop policy if exists "sales call reviews select leadership or self" on public.sales_call_reviews;
drop policy if exists "sales call reviews write leadership" on public.sales_call_reviews;

-- Leadership (Owner/Admin/Manager) can read every rep's reviews. A Sales
-- Rep can only read her OWN - coaching is authored ABOUT her, not BY her,
-- but she should still be able to see what was logged.
create policy "sales call reviews select leadership or self"
  on public.sales_call_reviews
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or rep_id = auth.uid())
  );

create policy "sales call reviews write leadership"
  on public.sales_call_reviews
  for all
  to authenticated
  using (org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager'))
  with check (org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager'));

drop policy if exists "rep coaching plans select leadership or self" on public.rep_coaching_plans;
drop policy if exists "rep coaching plans write leadership" on public.rep_coaching_plans;

create policy "rep coaching plans select leadership or self"
  on public.rep_coaching_plans
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or rep_id = auth.uid())
  );

create policy "rep coaching plans write leadership"
  on public.rep_coaching_plans
  for all
  to authenticated
  using (org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager'))
  with check (org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager'));

drop policy if exists "rep coaching action items select leadership or self" on public.rep_coaching_action_items;
drop policy if exists "rep coaching action items write leadership" on public.rep_coaching_action_items;

create policy "rep coaching action items select leadership or self"
  on public.rep_coaching_action_items
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or exists (
        select 1 from public.rep_coaching_plans p
        where p.id = rep_coaching_action_items.coaching_plan_id and p.rep_id = auth.uid()
      )
    )
  );

create policy "rep coaching action items write leadership"
  on public.rep_coaching_action_items
  for all
  to authenticated
  using (org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager'))
  with check (org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager'));
