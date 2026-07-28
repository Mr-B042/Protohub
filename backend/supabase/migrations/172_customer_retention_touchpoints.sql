-- Migration 172: post-delivery Customer Retention tracking.
--
-- New tab on the EXISTING Recovery Rep Dashboard (renderRecoveryRepConsole).
-- Not a new role, not a new page permission - Recovery Rep already has
-- "Recovery Rep Dashboard" in roleAllowedPages (migration 164).
--
-- One table with a `stage` discriminator (not three tables) - all three
-- stages share the same order anchor, actor, and worklist-timeline query
-- shape; see order_contact_attempts (044/072) for the same one-table,
-- discriminator-column precedent in this codebase.

create table if not exists public.customer_retention_touchpoints (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations(id) on delete cascade,
  order_id                 text not null references public.orders(id) on delete cascade,
  stage                    text not null check (stage in ('satisfaction_check', 'review_referral', 'retention_sale')),
  logged_by                uuid references public.users(id) on delete set null,
  logged_at                timestamptz not null default now(),

  -- Stage 1: Satisfaction check (Day 3-4) - Bright's exact 7 outcomes.
  satisfaction_outcome     text check (satisfaction_outcome in (
                             'satisfied',
                             'has_not_used_it',
                             'needs_usage_guidance',
                             'wrong_damaged_or_incomplete',
                             'not_satisfied',
                             'potential_repeat_buyer',
                             'potential_referral_customer'
                           )),
  satisfaction_notes       text,

  -- Stage 2: Review & referral (Day 7-14)
  review_collected         boolean not null default false,
  review_text              text,
  review_is_video          boolean not null default false,
  media_urls               text[] not null default '{}',
  ad_permission_granted    boolean not null default false,
  referral_collected       boolean not null default false,
  referral_contact_name    text,
  referral_contact_phone   text,
  customer_discount_owed   boolean not null default false,
  customer_discount_note   text,
  customer_discount_cleared_at timestamptz,

  -- Stage 3: Retention sale (Day 21-45)
  offered_product_id       uuid references public.products(id) on delete set null,
  offered_package_id       uuid references public.product_packages(id) on delete set null,
  retention_outcome        text check (retention_outcome in ('accepted', 'declined', 'no_response')),
  resulting_order_id       text references public.orders(id) on delete set null,

  created_at               timestamptz not null default now()
);

create index if not exists idx_crt_order on public.customer_retention_touchpoints(org_id, order_id, stage);
create index if not exists idx_crt_logged_by on public.customer_retention_touchpoints(org_id, logged_by, logged_at desc);
create index if not exists idx_crt_stage on public.customer_retention_touchpoints(org_id, stage, logged_at desc);

alter table public.customer_retention_touchpoints enable row level security;

drop policy if exists "customer retention touchpoints select" on public.customer_retention_touchpoints;
create policy "customer retention touchpoints select"
  on public.customer_retention_touchpoints
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Recovery Rep')
  );

drop policy if exists "customer retention touchpoints insert" on public.customer_retention_touchpoints;
create policy "customer retention touchpoints insert"
  on public.customer_retention_touchpoints
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Recovery Rep')
  );

-- Own-authored rows only editable by the logger (or Owner/Admin as a
-- correction path) - same spirit as sales-expansion's audit/void pattern.
drop policy if exists "customer retention touchpoints update" on public.customer_retention_touchpoints;
create policy "customer retention touchpoints update"
  on public.customer_retention_touchpoints
  for update
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin') or logged_by = auth.uid())
  )
  with check (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin') or logged_by = auth.uid())
  );

-- Org-level bonus settings for this feature - separate from
-- recovery_rep_kpi_settings (different purpose: per-action payout
-- attribution, not monthly KPI grading). Same shape/convention as
-- recovery_rep_kpi_settings (migration 164).
create table if not exists public.customer_retention_bonus_settings (
  org_id                        uuid primary key references public.organizations(id) on delete cascade,
  satisfaction_check_bonus      numeric not null default 200,
  written_review_bonus          numeric not null default 500,
  video_testimonial_bonus       numeric not null default 1500,
  referral_bonus                numeric not null default 1000,
  retention_sale_bonus_pct      numeric not null default 10,
  customer_discount_pct         numeric not null default 10,
  updated_by                    uuid references public.users(id) on delete set null,
  updated_at                    timestamptz not null default now()
);

alter table public.customer_retention_bonus_settings enable row level security;

drop policy if exists "customer retention bonus settings select" on public.customer_retention_bonus_settings;
create policy "customer retention bonus settings select"
  on public.customer_retention_bonus_settings
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Recovery Rep')
  );

drop policy if exists "customer retention bonus settings write owner" on public.customer_retention_bonus_settings;
create policy "customer retention bonus settings write owner"
  on public.customer_retention_bonus_settings
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  );

drop policy if exists "customer retention bonus settings update owner" on public.customer_retention_bonus_settings;
create policy "customer retention bonus settings update owner"
  on public.customer_retention_bonus_settings
  for update
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  );

-- Storage bucket for review media, same convention as the existing
-- package-image/product-video buckets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('retention-media', 'retention-media', true, 52428800, array[
  'image/png', 'image/jpeg', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime'
])
on conflict (id) do nothing;
