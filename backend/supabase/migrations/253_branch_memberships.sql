-- A user may work in one or more branches. Existing users retain access to
-- the migrated Nigeria Operations workspace.
create table if not exists public.branch_memberships (
  branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (branch_id, user_id)
);

create index if not exists idx_branch_memberships_user on public.branch_memberships(user_id, is_default desc);

insert into public.branch_memberships (branch_id, user_id, is_default)
select b.id, u.id, true
from public.branches b
join public.users u on u.org_id = b.org_id
where b.name = 'Nigeria Operations'
  and not exists (
    select 1 from public.branch_memberships m
    where m.branch_id = b.id and m.user_id = u.id
  );

alter table public.branch_memberships enable row level security;
create policy branch_memberships_org_read on public.branch_memberships
  for select using (exists (
    select 1 from public.branches b
    where b.id = branch_id and b.org_id = private.auth_org_id()
  ));
create policy branch_memberships_owner_write on public.branch_memberships
  for all using (exists (
    select 1 from public.branches b
    where b.id = branch_id and b.org_id = private.auth_org_id()
  ) and private.auth_user_role()::text = 'Owner')
  with check (exists (
    select 1 from public.branches b
    where b.id = branch_id and b.org_id = private.auth_org_id()
  ) and private.auth_user_role()::text = 'Owner');
