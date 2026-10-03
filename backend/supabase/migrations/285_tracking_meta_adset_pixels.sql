-- One Pixel per sale (Bright, 3 Oct 2026). Sending a sale to every Pixel on a
-- tracking link let Meta count it once per Pixel - purchases that never
-- happened. A sale now goes only to the Pixel the clicked ad set optimises on
-- (its promoted_object), read from Meta once and remembered here. pixel_id is
-- null when Meta has none for that ad set. Additive only.
create table if not exists public.tracking_meta_adset_pixels (
  org_id uuid not null references public.organizations(id) on delete cascade,
  adset_id text not null,
  campaign_id text,
  ad_account_id text,
  pixel_id text,
  fetched_at timestamptz not null default now(),
  primary key (org_id, adset_id)
);
alter table public.tracking_meta_adset_pixels enable row level security;
create policy "tracking meta adset pixels read" on public.tracking_meta_adset_pixels
  for select to authenticated using (org_id = private.auth_org_id());
