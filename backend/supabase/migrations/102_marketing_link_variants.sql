-- Migration 102: saved marketing/landing-page link variants.
--
-- A single product can be advertised through many landing pages by the same
-- marketer. Store each variant so marketers can copy/reuse the exact tracked
-- link across devices, while orders still use the existing UTM fields.

create table if not exists public.marketing_link_variants (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  product_id         uuid not null references public.products(id) on delete cascade,
  marketer_user_id   uuid references public.users(id) on delete set null,
  marketer_tag       text not null,
  label              text not null,
  landing_page_url   text,
  utm_source         text not null default 'Facebook',
  utm_medium         text not null default 'paid_social',
  utm_campaign       text not null default 'embed',
  utm_content        text not null,
  utm_term           text,
  active             boolean not null default true,
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamp with time zone not null default now(),
  updated_at         timestamp with time zone not null default now(),
  constraint marketing_link_variants_unique_content
    unique (org_id, product_id, marketer_tag, utm_content)
);

create index if not exists idx_marketing_link_variants_org_product
  on public.marketing_link_variants (org_id, product_id, created_at desc);

create index if not exists idx_marketing_link_variants_marketer_tag
  on public.marketing_link_variants (org_id, marketer_tag, created_at desc);

alter table public.marketing_link_variants enable row level security;

drop policy if exists "marketing link variants org read" on public.marketing_link_variants;
create policy "marketing link variants org read"
  on public.marketing_link_variants
  for select
  using (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.org_id = marketing_link_variants.org_id
        and (
          u.role in ('Owner', 'Admin', 'Manager')
          or marketing_link_variants.marketer_user_id = auth.uid()
          or marketing_link_variants.marketer_tag = any(coalesce(u.marketing_attribution_tags, '{}'::text[]))
        )
    )
  );
