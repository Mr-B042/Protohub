-- Email Marketing, part 1 (Bright, 8 Nov 2026): the list of customers who gave
-- an email, saved groups of them, and campaigns sent to those groups.
--
-- Bright chose "email only": campaigns reach customers who type an email on
-- the order form. Until now no order or cart carried an email, so every list
-- starts empty and grows. The form's Email box was switched on by migration
-- 333, together with the fix that drops a mistyped email instead of refusing
-- the order.
--
-- Every row carries the branch of the order, cart or person it came from.

-- ── The people we can email ─────────────────────────────────────────────
create table if not exists public.email_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'),
  name text not null default '',
  phone text,
  source text not null check (source in ('order', 'cart', 'manual', 'import')),
  -- Unsubscribed and bounced people are never emailed again, and the sync
  -- below never switches them back on.
  status text not null default 'subscribed' check (status in ('subscribed', 'unsubscribed', 'bounced')),
  status_changed_at timestamptz,
  status_reason text,
  -- Kept up to date by the sender and the open/click counters, so a group
  -- like "opened an email in the last 30 days" needs no scan of every send.
  last_emailed_at timestamptz,
  last_opened_at timestamptz,
  last_clicked_at timestamptz,
  -- Answers to the business's own custom fields (email_custom_fields.key).
  fields jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, email)
);
create index if not exists email_contacts_org_branch_status on public.email_contacts (org_id, branch_id, status);
create index if not exists email_contacts_phone on public.email_contacts (org_id, phone);
alter table public.email_contacts enable row level security;

-- ── Saved groups ("segments") ───────────────────────────────────────────
-- kind 'auto' re-checks its conditions every time it is used; 'fixed' is a
-- list of people (an uploaded list).
create table if not exists public.email_segments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '',
  icon text not null default 'users',
  kind text not null default 'auto' check (kind in ('auto', 'fixed')),
  match text not null default 'all' check (match in ('all', 'any')),
  conditions jsonb not null default '[]'::jsonb,
  -- "And exclude customers": anyone matching ANY of these is left out.
  exclude_on boolean not null default false,
  exclude_conditions jsonb not null default '[]'::jsonb,
  contact_ids uuid[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  -- The ready-made groups from Bright's designs, added once per branch.
  -- 'list_*' ones are the Lists tab's automatic lists (by where the email came from).
  built_in text,
  created_by uuid references public.users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, built_in)
);
create index if not exists email_segments_org_branch on public.email_segments (org_id, branch_id, updated_at desc);
alter table public.email_segments enable row level security;

-- ── Campaigns ───────────────────────────────────────────────────────────
create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  goal text not null default 'retention',
  subject text not null default '',
  subject_b text not null default '',
  preheader text not null default '',
  offer_type text not null default 'product',
  product_id uuid references public.products(id) on delete set null,
  offer jsonb not null default '{}'::jsonb,
  audience jsonb not null default '{}'::jsonb,
  design jsonb not null default '{}'::jsonb,
  delivery jsonb not null default '{}'::jsonb,
  options jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'active', 'paused', 'completed', 'cancelled', 'archived')),
  -- The utm_campaign value its links carry, so an order placed from the
  -- email names the campaign.
  slug text not null,
  -- The links of the run being sent; a click goes to links[i].
  links jsonb not null default '[]'::jsonb,
  send_at timestamptz,
  next_run_at timestamptz,
  run_count integer not null default 0,
  audience_count integer not null default 0,
  thumbnail_url text,
  -- The status to go back to on Resume / Unarchive.
  paused_from text,
  archived_from text,
  created_by uuid references public.users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  launched_at timestamptz,
  completed_at timestamptz,
  unique (org_id, slug)
);
create index if not exists email_campaigns_org_branch on public.email_campaigns (org_id, branch_id, created_at desc);
create index if not exists email_campaigns_due on public.email_campaigns (status, next_run_at);
alter table public.email_campaigns enable row level security;

-- ── One row per email sent (or waiting to be sent) ──────────────────────
create table if not exists public.email_campaign_sends (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  run_no integer not null default 1,
  kind text not null default 'main' check (kind in ('main', 'resend')),
  contact_id uuid references public.email_contacts(id) on delete set null,
  email text not null,
  name text not null default '',
  phone text,
  variant text not null default 'a' check (variant in ('a', 'b')),
  token text not null unique,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  error text,
  provider text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  first_opened_at timestamptz,
  open_count integer not null default 0,
  first_clicked_at timestamptz,
  click_count integer not null default 0,
  unsubscribed_at timestamptz,
  order_id text,
  converted_at timestamptz,
  unique (campaign_id, run_no, kind, email)
);
create index if not exists email_campaign_sends_queue on public.email_campaign_sends (queued_at) where status = 'queued';
create index if not exists email_campaign_sends_campaign on public.email_campaign_sends (campaign_id, status);
create index if not exists email_campaign_sends_org_sent on public.email_campaign_sends (org_id, sent_at desc);
create index if not exists email_campaign_sends_contact on public.email_campaign_sends (contact_id);
alter table public.email_campaign_sends enable row level security;

-- ── Which link of a campaign each click opened ──────────────────────────
create table if not exists public.email_campaign_clicks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  send_id uuid not null references public.email_campaign_sends(id) on delete cascade,
  link_index integer not null,
  clicked_at timestamptz not null default now()
);
create index if not exists email_campaign_clicks_campaign on public.email_campaign_clicks (campaign_id, link_index);
alter table public.email_campaign_clicks enable row level security;

-- ── Tags ────────────────────────────────────────────────────────────────
-- 'system' tags follow a rule (VIP, Repeat Buyer, ...); 'custom' tags are put
-- on people by hand (email_contact_tags).
create table if not exists public.email_tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  kind text not null default 'custom' check (kind in ('system', 'custom')),
  color text not null default 'purple',
  icon text not null default 'tag',
  description text not null default '',
  match text not null default 'all' check (match in ('all', 'any')),
  conditions jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  built_in text,
  created_by uuid references public.users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, built_in)
);
create unique index if not exists email_tags_branch_name on public.email_tags (branch_id, lower(name));
alter table public.email_tags enable row level security;

create table if not exists public.email_contact_tags (
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  contact_id uuid not null references public.email_contacts(id) on delete cascade,
  tag_id uuid not null references public.email_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);
create index if not exists email_contact_tags_tag on public.email_contact_tags (tag_id);
alter table public.email_contact_tags enable row level security;

-- ── Custom fields ───────────────────────────────────────────────────────
-- system_key fields are worked out from orders (State, Order Count, ...);
-- the rest are the business's own questions, answered per person.
create table if not exists public.email_custom_fields (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  name text not null check (length(btrim(name)) between 1 and 60),
  type text not null check (type in ('text', 'number', 'date', 'dropdown', 'multi')),
  options text[] not null default '{}',
  description text not null default '',
  required boolean not null default false,
  use_in_forms boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  system_key text,
  icon text not null default 'form',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, key)
);
alter table public.email_custom_fields enable row level security;

-- ── Blocks and designs saved for reuse ──────────────────────────────────
create table if not exists public.email_saved_blocks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  kind text not null default 'block' check (kind in ('block', 'template')),
  name text not null check (length(btrim(name)) between 1 and 80),
  content jsonb not null,
  created_by uuid references public.users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists email_saved_blocks_org_branch on public.email_saved_blocks (org_id, branch_id, kind, created_at desc);
alter table public.email_saved_blocks enable row level security;

-- ── Import history (Import / Sync tab) ──────────────────────────────────
create table if not exists public.email_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  source text not null check (source in ('csv', 'paste', 'device', 'manual')),
  details text not null default '',
  contacts integer not null default 0,
  added integer not null default 0,
  updated integer not null default 0,
  duplicates integer not null default 0,
  invalid integer not null default 0,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  list_id uuid,
  created_by uuid references public.users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists email_imports_org_branch on public.email_imports (org_id, branch_id, created_at desc);
alter table public.email_imports enable row level security;

-- ── Sending settings, one row per branch ────────────────────────────────
create table if not exists public.email_marketing_settings (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Campaign emails a day, so the email service's own daily limit is left
  -- for order and staff emails.
  daily_limit integer not null default 150 check (daily_limit between 1 and 100000),
  footer_note text not null default '' check (length(footer_note) <= 300),
  -- When the ready-made groups, lists, tags and fields were added (once; deleting one keeps it gone).
  seeded_at timestamptz,
  -- Import / Sync: copy new order and cart emails in (every 5 minutes), the
  -- list uploads also join, and whether an upload fills in people already on the list.
  auto_sync boolean not null default true,
  default_list_id uuid,
  update_existing boolean not null default true,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.email_marketing_settings enable row level security;

-- ── Copy new emails from orders and carts into the list ─────────────────
-- Org-wide on purpose (the background job has no branch): each contact takes
-- the branch of the order or cart it came from. ON CONFLICT DO NOTHING keeps
-- an unsubscribed person unsubscribed. Silent Test orders are left out.
create or replace function public.sync_email_contacts(p_org uuid)
returns integer language plpgsql as $$
declare
  v_orders integer := 0;
  v_carts integer := 0;
begin
  insert into public.email_contacts (org_id, branch_id, email, name, phone, source, created_at)
  select distinct on (o.branch_id, lower(btrim(o.email)))
    o.org_id, o.branch_id, lower(btrim(o.email)), coalesce(btrim(o.customer), ''), nullif(btrim(o.phone), ''), 'order', o.created_at
  from public.orders o
  where o.org_id = p_org
    and o.branch_id is not null
    and coalesce(o.launch_stage, 'live') <> 'silent'
    and not exists (select 1 from public.email_marketing_settings s where s.branch_id = o.branch_id and s.auto_sync = false)
    and lower(btrim(coalesce(o.email, ''))) ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
  order by o.branch_id, lower(btrim(o.email)), o.created_at
  on conflict (branch_id, email) do nothing;
  get diagnostics v_orders = row_count;

  insert into public.email_contacts (org_id, branch_id, email, name, phone, source, created_at)
  select distinct on (c.branch_id, lower(btrim(c.email)))
    c.org_id, c.branch_id, lower(btrim(c.email)), coalesce(btrim(c.customer), ''), nullif(btrim(c.phone), ''), 'cart', c.created_at
  from public.abandoned_carts c
  where c.org_id = p_org
    and c.branch_id is not null
    and not exists (select 1 from public.email_marketing_settings s where s.branch_id = c.branch_id and s.auto_sync = false)
    and lower(btrim(coalesce(c.email, ''))) ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
  order by c.branch_id, lower(btrim(c.email)), c.created_at
  on conflict (branch_id, email) do nothing;
  get diagnostics v_carts = row_count;

  return v_orders + v_carts;
end $$;
revoke all on function public.sync_email_contacts(uuid) from public, anon, authenticated;

-- ── Results per campaign, counted per person ────────────────────────────
-- A person's first email and its "didn't open" resend count once: opened if
-- either was opened. Money counts DELIVERED orders only (pay on delivery).
-- Called with ids from a branch-filtered campaign list.
create or replace function public.email_campaign_stats(p_ids uuid[])
returns table (
  campaign_id uuid, queued integer, sent integer, failed integer, skipped integer,
  opened integer, clicked integer, orders integer, delivered_orders integer, revenue numeric,
  unsubscribed integer, sent_a integer, opened_a integer, clicked_a integer,
  sent_b integer, opened_b integer, clicked_b integer, last_sent_at timestamptz
) language sql stable as $$
  with per as (
    select s.campaign_id, s.run_no, s.email,
      bool_or(s.status = 'sent') as was_sent,
      bool_or(s.status = 'queued') as is_queued,
      bool_or(s.status = 'failed') as did_fail,
      bool_or(s.status = 'skipped') as was_skipped,
      bool_or(s.first_opened_at is not null or s.first_clicked_at is not null) as did_open,
      bool_or(s.first_clicked_at is not null) as did_click,
      max(s.order_id) as order_id,
      bool_or(s.unsubscribed_at is not null) as did_unsub,
      min(s.variant) as variant,
      max(s.sent_at) as sent_at
    from public.email_campaign_sends s
    where s.campaign_id = any(p_ids)
    group by s.campaign_id, s.run_no, s.email
  )
  select per.campaign_id,
    count(*) filter (where per.is_queued and not per.was_sent)::integer,
    count(*) filter (where per.was_sent)::integer,
    count(*) filter (where per.did_fail and not per.was_sent and not per.is_queued)::integer,
    count(*) filter (where per.was_skipped and not per.was_sent)::integer,
    count(*) filter (where per.was_sent and per.did_open)::integer,
    count(*) filter (where per.was_sent and per.did_click)::integer,
    count(*) filter (where per.order_id is not null)::integer,
    count(*) filter (where o.status = 'Delivered')::integer,
    coalesce(sum(o.amount) filter (where o.status = 'Delivered'), 0),
    count(*) filter (where per.did_unsub)::integer,
    count(*) filter (where per.was_sent and per.variant = 'a')::integer,
    count(*) filter (where per.was_sent and per.variant = 'a' and per.did_open)::integer,
    count(*) filter (where per.was_sent and per.variant = 'a' and per.did_click)::integer,
    count(*) filter (where per.was_sent and per.variant = 'b')::integer,
    count(*) filter (where per.was_sent and per.variant = 'b' and per.did_open)::integer,
    count(*) filter (where per.was_sent and per.variant = 'b' and per.did_click)::integer,
    max(per.sent_at)
  from per
  left join public.orders o on o.id = per.order_id and coalesce(o.launch_stage, 'live') <> 'silent'
  group by per.campaign_id
$$;
revoke all on function public.email_campaign_stats(uuid[]) from public, anon, authenticated;

-- ── Pictures used in emails: public so every email app can show them ───
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-assets', 'email-assets', true, 5242880, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;
