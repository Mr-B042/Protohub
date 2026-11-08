-- Reviews & UGC (Bright's design 56, 8 Nov 2026).
--
-- Bright's calls:
--  * "Personal review link": each delivered order gets its own link. The
--    customer gives stars, writes, and adds photos or a video, with consent
--    ticks; it lands in Pending for approval like a rep's review, so the
--    order's rep is still paid (approve_customer_review, migration 329).
--    The link goes out by email (Request Review) or a rep copies it into WhatsApp.
--  * "Keep rep pay": no customer reward.

create table if not exists public.review_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_id text not null unique references public.orders(id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{20,40}$'),
  opened_at timestamptz,
  emailed_at timestamptz,
  email_count integer not null default 0,
  copied_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists review_links_branch on public.review_links (org_id, branch_id, created_at desc);
alter table public.review_links enable row level security;

-- Who sent the review in: a rep (from Upload media) or the customer (their link).
alter table public.customer_reviews add column if not exists source text not null default 'rep' check (source in ('rep', 'customer'));
-- Featured: picked to show first (approved reviews with marketing permission only).
alter table public.customer_reviews add column if not exists featured boolean not null default false;
alter table public.customer_reviews drop constraint if exists customer_reviews_channel_check;
alter table public.customer_reviews add constraint customer_reviews_channel_check check (channel in ('whatsapp', 'call', 'sms', 'in_person', 'other', 'link'));
