-- Sales Scripting (Bright, 1 Oct 2026). Additive only. Replaces the
-- Head of Sales "Initiatives" page and the single weekly script (276).
--
-- A controlled sales playbook:
--   Head of Sales writes a script -> submits -> Manager / Admin / Owner
--   approves (or returns with a comment, or rejects) -> the approved version
--   goes live for reps -> reps record using it on an order and whether the
--   customer said yes -> the system measures accepted / delivered / extra
--   revenue per script, per rep and per product pairing.
--
-- Editing a live script makes a NEW draft version. Reps keep seeing the live
-- version until the new one is approved; then the old one is archived.
-- Orders stay linked to the exact version that was used.

create table if not exists public.sales_script_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  category text not null check (category in ('closing', 'upsell', 'cross_sell', 'objection')),
  -- The approved version reps see. Null until the first approval.
  live_version_id uuid,
  deactivated_at timestamptz,
  deactivated_by uuid references public.users(id) on delete set null,
  deactivated_by_name text,
  deactivation_note text,
  -- Archived = retired for good (hidden from the library unless asked for).
  archived_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_script_items_product on public.sales_script_items (branch_id, product_id, category);

create table if not exists public.sales_script_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  script_id uuid not null references public.sales_script_items(id) on delete cascade,
  version_no integer not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'rejected', 'approved', 'archived')),
  title text not null,
  scenario text not null default '',
  objective text not null default '',
  when_to_use text not null default '',
  customer_trigger text not null default '',
  what_to_say text not null default '',
  key_points jsonb not null default '[]'::jsonb,
  must_say jsonb not null default '[]'::jsonb,
  never_say jsonb not null default '[]'::jsonb,
  desired_action text not null default '',
  priority text not null default 'primary' check (priority in ('primary', 'alternative', 'experimental')),
  impact text not null default 'medium' check (impact in ('high', 'medium', 'low')),
  closing_style text check (closing_style in ('direct', 'choice', 'delivery', 'urgency', 'confirmation')),
  objection text,
  upsell_from_qty integer,
  upsell_to_qty integer,
  cross_sell_product_id uuid references public.products(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_by_name text,
  submitted_at timestamptz,
  decided_by uuid references public.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  approved_at timestamptz,
  archived_at timestamptz,
  replaced_by_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_script_versions_no on public.sales_script_versions (script_id, version_no);
create index if not exists sales_script_versions_status on public.sales_script_versions (branch_id, status);

-- A rep recorded using a script on an order, and what the customer said.
create table if not exists public.sales_script_uses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_id text not null,
  rep_id uuid not null references public.users(id) on delete cascade,
  script_id uuid not null references public.sales_script_items(id) on delete cascade,
  version_id uuid not null references public.sales_script_versions(id) on delete cascade,
  product_id uuid,
  category text not null,
  outcome text not null check (outcome in ('accepted', 'declined')),
  week_start date not null,
  used_at timestamptz not null default now()
);

create unique index if not exists sales_script_uses_order_script on public.sales_script_uses (org_id, order_id, script_id);
create index if not exists sales_script_uses_week on public.sales_script_uses (branch_id, week_start, rep_id);
create index if not exists sales_script_uses_script on public.sales_script_uses (script_id, used_at);

-- A rep opened a script (once per rep / script / order / day).
create table if not exists public.sales_script_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  rep_id uuid not null references public.users(id) on delete cascade,
  script_id uuid not null references public.sales_script_items(id) on delete cascade,
  version_id uuid not null references public.sales_script_versions(id) on delete cascade,
  order_id text not null default '',
  view_date date not null,
  created_at timestamptz not null default now()
);

create unique index if not exists sales_script_views_once on public.sales_script_views (org_id, rep_id, script_id, order_id, view_date);
create index if not exists sales_script_views_script on public.sales_script_views (script_id, view_date);

-- Per-branch settings: minimum scripts per category, health thresholds, and
-- the delivery offer text for {{delivery_offer}} (per product, with a default).
create table if not exists public.sales_script_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_script_settings_branch on public.sales_script_settings (org_id, branch_id);

-- Who created, changed, submitted, approved, returned, rejected, published,
-- deactivated or archived each script. Written by the server only.
create table if not exists public.sales_script_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  script_id uuid references public.sales_script_items(id) on delete cascade,
  version_id uuid,
  action text not null,
  actor_id uuid references public.users(id) on delete set null,
  actor_name text,
  actor_role text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sales_script_audit_script on public.sales_script_audit (script_id, created_at desc);
create index if not exists sales_script_audit_branch on public.sales_script_audit (branch_id, created_at desc);

alter table public.sales_script_items enable row level security;
alter table public.sales_script_versions enable row level security;
alter table public.sales_script_uses enable row level security;
alter table public.sales_script_views enable row level security;
alter table public.sales_script_settings enable row level security;
alter table public.sales_script_audit enable row level security;

-- Reads go through the server; these only cover direct reads by signed-in
-- users of the same organisation.
create policy "sales script items select org" on public.sales_script_items
  for select to authenticated using (org_id = private.auth_org_id());
create policy "sales script versions select org" on public.sales_script_versions
  for select to authenticated using (org_id = private.auth_org_id());
create policy "sales script uses select" on public.sales_script_uses
  for select to authenticated using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or rep_id = auth.uid())
  );
create policy "sales script views select" on public.sales_script_views
  for select to authenticated using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or rep_id = auth.uid())
  );
create policy "sales script settings select org" on public.sales_script_settings
  for select to authenticated using (org_id = private.auth_org_id());
create policy "sales script audit select leadership" on public.sales_script_audit
  for select to authenticated using (
    org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );
