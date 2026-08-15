-- Initiatives (Head of Sales Rep, Stage 8): leadership initiatives she runs
-- to improve the whole team - "Introduce a cross-sell script," "Run a
-- weekly upsell huddle" - not something logged about an individual rep, so
-- the owning column is named explicitly rather than reusing rep_id the way
-- Stage 7's coaching tables did for a team MEMBER.
--
-- One table covers both pipeline ideas and active work via `status`, rather
-- than two separate CRUD surfaces for "ideas" vs "initiatives."

create table if not exists public.sales_initiatives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  head_of_sales_rep_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'Idea' check (status in ('Idea', 'Planned', 'In Progress', 'Completed', 'Abandoned')),
  target_metric text,
  started_at date,
  target_date date,
  completed_at timestamptz,
  outcome_summary text,
  was_successful boolean,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_initiatives_org_head on public.sales_initiatives (org_id, head_of_sales_rep_id, status);

create table if not exists public.sales_initiative_learnings (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references public.sales_initiatives(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  note text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists sales_initiative_learnings_initiative on public.sales_initiative_learnings (initiative_id, created_at desc);

alter table public.sales_initiatives enable row level security;
alter table public.sales_initiative_learnings enable row level security;

drop policy if exists "sales initiatives select leadership or self" on public.sales_initiatives;
drop policy if exists "sales initiatives write leadership or self" on public.sales_initiatives;

-- Owner/Admin/Manager can read/write any Head of Sales Rep's initiatives.
-- The Head of Sales Rep herself can read AND write her own - unlike Stage
-- 7's coaching writes, these are initiatives she runs herself, not
-- something authored about her.
create policy "sales initiatives select leadership or self"
  on public.sales_initiatives
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or head_of_sales_rep_id = auth.uid())
  );

create policy "sales initiatives write leadership or self"
  on public.sales_initiatives
  for all
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or head_of_sales_rep_id = auth.uid())
  )
  with check (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or head_of_sales_rep_id = auth.uid())
  );

drop policy if exists "sales initiative learnings select leadership or self" on public.sales_initiative_learnings;
drop policy if exists "sales initiative learnings write leadership or self" on public.sales_initiative_learnings;

create policy "sales initiative learnings select leadership or self"
  on public.sales_initiative_learnings
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or exists (
        select 1 from public.sales_initiatives i
        where i.id = sales_initiative_learnings.initiative_id and i.head_of_sales_rep_id = auth.uid()
      )
    )
  );

create policy "sales initiative learnings write leadership or self"
  on public.sales_initiative_learnings
  for all
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or exists (
        select 1 from public.sales_initiatives i
        where i.id = sales_initiative_learnings.initiative_id and i.head_of_sales_rep_id = auth.uid()
      )
    )
  )
  with check (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or exists (
        select 1 from public.sales_initiatives i
        where i.id = sales_initiative_learnings.initiative_id and i.head_of_sales_rep_id = auth.uid()
      )
    )
  );
