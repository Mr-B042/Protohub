-- WordPress page pickers for tracking links (Bright, 15 Oct 2026). The
-- published pages of each WordPress site in the Tracking Hub, read from the
-- site's public REST API (/wp-json/wp/v2/pages), so a tracking link's landing
-- page and thank-you page are picked from a list instead of typed. Links still
-- store plain URLs; this table is only the list to pick from.
create table if not exists public.website_pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  website_id uuid not null references public.tracking_websites(id) on delete cascade,
  wp_page_id bigint not null,
  title text not null default '',
  slug text not null default '',
  url text not null,
  wp_modified_at timestamptz,
  is_thank_you boolean not null default false,
  last_synced_at timestamptz not null default now(),
  unique (website_id, wp_page_id)
);
create index if not exists website_pages_website on public.website_pages (website_id);
create index if not exists website_pages_org_branch on public.website_pages (org_id, branch_id);

alter table public.website_pages enable row level security;
-- Same rule as tracking_websites: the Owner of the organisation reads; the API
-- (service role) writes.
drop policy if exists "website pages owner" on public.website_pages;
create policy "website pages owner" on public.website_pages
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
