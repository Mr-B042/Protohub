-- Products & Stock redesign: media gallery, approvals, categories (Bright, 17 Oct 2026).
--
--   product_categories      the chips on each product card ("Bathroom", "Kitchen")
--   products.category_id    one category per product, optional
--   product_media           every photo and video, with its approval state
--   product_catalog_settings per branch: upload rules, approval, display and
--                           notification switches for the Products & Stock page
--   product_media_events    who uploaded, approved, rejected, deleted or refused
--                           what (the Settings > Audit Log and Security lists)
--   product_stock_daily     one total-units figure per branch per day, for the
--                           "from last week" line on the Total Units card
--
-- Files: a rep's upload lands in the PRIVATE product-media-holding bucket. The
-- server checks what the file really is, redraws photos as fresh clean copies
-- (which also drops phone GPS data), and only an approved file is copied into
-- the PUBLIC product-media bucket. Nothing in holding is ever public.

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  color text not null default 'blue',
  icon text not null default 'grid',
  description text not null default '',
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint product_categories_name_len check (char_length(btrim(name)) between 1 and 40),
  constraint product_categories_description_len check (char_length(description) <= 200)
);
create unique index if not exists product_categories_branch_name on public.product_categories (branch_id, lower(btrim(name)));
create index if not exists product_categories_org_branch on public.product_categories (org_id, branch_id);

alter table public.products add column if not exists category_id uuid references public.product_categories(id) on delete set null;

create table if not exists public.product_media (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  kind text not null check (kind in ('image', 'video')),
  -- uploading: link handed out, file not checked yet
  -- pending:   checked, waiting for Owner / Admin / Manager
  -- approved:  in the public gallery
  -- rejected:  files deleted; the row stays so the sender sees why
  -- changes_requested: same, but worded as "fix and send again"
  status text not null default 'uploading' check (status in ('uploading', 'pending', 'approved', 'rejected', 'changes_requested')),
  label text not null default 'other' check (label in ('product_in_use', 'customer_review', 'unboxing', 'size', 'packaging', 'other')),
  caption text not null default '',
  tags text[] not null default '{}',
  -- where the file may be used: product_page, sales_workspace, whatsapp, ads
  usage text[] not null default '{product_page,sales_workspace,whatsapp}',
  -- files sent together in one go share a batch (one row in the Approval Queue)
  batch_id uuid,
  -- what the server's check found: real type, size, content check
  scan jsonb not null default '{}'::jsonb,
  original_name text not null default '',
  mime text not null default '',
  size_bytes bigint not null default 0,
  width integer,
  height integer,
  duration_seconds numeric,
  holding_path text,
  holding_thumb_path text,
  public_path text,
  public_thumb_path text,
  url text,
  thumb_url text,
  is_cover boolean not null default false,
  display_order integer not null default 0,
  uploaded_by uuid references public.users(id) on delete set null,
  uploaded_by_name text not null default '',
  uploaded_by_role text not null default '',
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_media_caption_len check (char_length(caption) <= 300)
);
create index if not exists product_media_product on public.product_media (product_id, status, display_order);
create index if not exists product_media_org_branch_status on public.product_media (org_id, branch_id, status, created_at desc);
create index if not exists product_media_uploader on public.product_media (uploaded_by, created_at desc);
create index if not exists product_media_batch on public.product_media (batch_id) where batch_id is not null;

drop trigger if exists product_media_updated_at on public.product_media;
create trigger product_media_updated_at before update on public.product_media
  for each row execute function public.set_updated_at();

create table if not exists public.product_catalog_settings (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_uploads_enabled boolean not null default true,
  require_approval boolean not null default true,
  max_image_mb integer not null default 10 check (max_image_mb between 1 and 10),
  max_video_mb integer not null default 100 check (max_video_mb between 5 and 100),
  allowed_image_types text[] not null default '{jpg,png,webp}',
  allowed_video_types text[] not null default '{mp4,mov,webm}',
  show_sku boolean not null default true,
  show_stock_to_reps boolean not null default true,
  show_low_stock_warning boolean not null default true,
  hide_unavailable_from_reps boolean not null default false,
  default_view text not null default 'grid' check (default_view in ('grid', 'list')),
  price_format text not null default 'full' check (price_format in ('full', 'short')),
  units_word text not null default 'units' check (units_word in ('units', 'pcs', 'pieces')),
  preferred_currency text not null default 'NGN',
  notify_approvers boolean not null default true,
  notify_senders boolean not null default true,
  default_main_image_url text,
  default_video_thumb_url text,
  default_lifestyle_image_url text,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.product_media_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  media_id uuid,
  product_id uuid references public.products(id) on delete set null,
  action text not null,
  detail text not null default '',
  actor_id uuid references public.users(id) on delete set null,
  actor_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists product_media_events_org_branch on public.product_media_events (org_id, branch_id, created_at desc);

create table if not exists public.product_stock_daily (
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  day date not null,
  total_units numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (branch_id, day)
);

-- The API (service role) reads and writes; no direct browser access.
alter table public.product_categories enable row level security;
alter table public.product_media enable row level security;
alter table public.product_catalog_settings enable row level security;
alter table public.product_media_events enable row level security;
alter table public.product_stock_daily enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-media-holding', 'product-media-holding', false, 104857600,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']),
  ('product-media', 'product-media', true, 104857600,
    array['image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
