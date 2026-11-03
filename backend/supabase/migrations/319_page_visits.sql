-- Page visits (Bright, 3 Nov 2026: "can you tell me if this role users is
-- opening this page ... Who Needs Stock"). The app never recorded which pages
-- people open. One row per person, page and Lagos day: how many times they
-- opened it that day, first and last time. Written and read by the server only
-- (RLS on, no policies for anon / signed-in logins).

create table if not exists public.page_visit_days (
  org_id uuid not null,
  branch_id uuid,
  user_id uuid not null,
  page_key text not null,
  page_label text not null,
  day date not null,
  visits integer not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (user_id, page_key, day)
);
create index if not exists page_visit_days_org_day on public.page_visit_days (org_id, day desc);
alter table public.page_visit_days enable row level security;

create or replace function public.record_page_visit(p_org uuid, p_branch uuid, p_user uuid, p_key text, p_label text, p_day date)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.page_visit_days (org_id, branch_id, user_id, page_key, page_label, day)
  values (p_org, p_branch, p_user, p_key, p_label, p_day)
  on conflict (user_id, page_key, day) do update
    set visits = public.page_visit_days.visits + 1, last_at = now(), page_label = excluded.page_label, branch_id = coalesce(excluded.branch_id, public.page_visit_days.branch_id);
$$;
revoke all on function public.record_page_visit(uuid, uuid, uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.record_page_visit(uuid, uuid, uuid, text, text, date) to service_role;
