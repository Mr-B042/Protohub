-- Each Meta ad's destination page (Bright, 15 Nov 2026): lets Protohub tell an
-- ad's product from the landing page it sends people to, without mapping by hand.
create table if not exists public.tracking_meta_ad_links (
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  ad_id text not null,
  account_id text not null,
  -- host + path, lower case, no trailing slash ("brightpathhubs.com/shelf"); null = Meta showed no link.
  page text,
  link text,
  fetched_at timestamptz not null default now(),
  primary key (org_id, branch_id, ad_id)
);
alter table public.tracking_meta_ad_links enable row level security;
