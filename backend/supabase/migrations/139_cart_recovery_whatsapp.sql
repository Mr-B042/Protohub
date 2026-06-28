-- WhatsApp abandoned-cart recovery: track when the customer left the form and when
-- a recovery message was sent (dedupe), plus a short-link table for the
-- continue-where-you-left URL (so the message isn't a scary 800-char link).
alter table public.abandoned_carts
  add column if not exists left_at timestamptz,
  add column if not exists recovery_sent_at timestamptz;

create table if not exists public.short_links (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.organizations(id) on delete set null,
  code        text not null unique,
  target_url  text not null,
  click_count integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_short_links_code on public.short_links (code);
