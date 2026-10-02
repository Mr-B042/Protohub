-- A tracking link can send each sale to more than one Pixel (Bright, 2 Oct
-- 2026): the Racks page is advertised from two businesses, each optimising
-- on its own Pixel (5-in-1 Corner Set / Corner Rack). Additive only.
--
-- meta_capi_configs.extra_data_source_ids   the "Also send to" Pixels
-- tracking_extra_pixel_sends                 one row per order per extra Pixel
--   (the main Pixel's send stays in meta_capi_events, unchanged)

alter table public.meta_capi_configs add column if not exists extra_data_source_ids uuid[] not null default '{}';

create table if not exists public.tracking_extra_pixel_sends (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_id text not null,
  event_name text not null default 'Purchase',
  data_source_id uuid references public.tracking_data_sources(id) on delete set null,
  pixel_id text not null,
  event_id text not null,
  status text not null,
  http_status integer,
  message text,
  test_mode boolean not null default false,
  value numeric(14, 2),
  currency text,
  attempts integer not null default 1,
  sent_at timestamptz not null default now()
);
create unique index if not exists tracking_extra_pixel_sends_once on public.tracking_extra_pixel_sends (org_id, order_id, event_name, pixel_id);
create index if not exists tracking_extra_pixel_sends_recent on public.tracking_extra_pixel_sends (org_id, sent_at desc);

alter table public.tracking_extra_pixel_sends enable row level security;
create policy "tracking extra pixel sends owner" on public.tracking_extra_pixel_sends
  for select to authenticated using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');
