-- sales_leads: manually logged social-DM inquiries that feed the Sales
-- Closer funnel (Inquiry -> Contacted -> Qualified -> Order Created ->
-- Delivered). Same lifecycle-object shape as customer_retention_referrals
-- (migration 181): a lead is its own object with its own status/timeline,
-- not a note bolted onto something else - generalized here for a cold
-- inbound inquiry rather than an existing customer's referral.

create table if not exists public.sales_leads (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.organizations(id) on delete cascade,

  full_name                 text not null,
  phone                     text not null,
  alternate_phone           text,
  whatsapp_number           text,
  email                     text,
  preferred_contact_method  text not null default 'whatsapp'
    check (preferred_contact_method in ('whatsapp', 'call', 'sms', 'email')),
  state                     text,
  city                      text,
  address                   text,
  source                    text not null default 'whatsapp'
    check (source in ('whatsapp', 'instagram', 'tiktok', 'facebook', 'website', 'phone', 'referral', 'other')),
  -- Freeform, not an FK to marketing_link_variants: DMs aren't integrated
  -- yet, so a lead usually arrives via an Instagram bio link or a WhatsApp
  -- broadcast with no clean UTM to link against the way an order has.
  campaign                  text,

  -- Many-products-per-row uses the same convention as products.cross_
  -- sell_product_ids / products.alternative_product_ids (migration 087) /
  -- sales_teams.product_ids (migration 017) - a plain array, not a
  -- junction table.
  interested_product_ids    uuid[] not null default '{}',
  package_id                uuid references public.product_packages(id) on delete set null,

  notes                     text check (notes is null or char_length(notes) <= 500),

  status                    text not null default 'new_lead'
    check (status in ('new_lead', 'contacted', 'qualified', 'follow_up', 'order_created', 'not_interested')),
  tags                      text[] not null default '{}',
  priority                  text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  assigned_closer_id        uuid references public.users(id) on delete set null,
  follow_up_at              timestamptz,

  -- "Don't make her re-enter the customer" - Convert to Order (Stage 4)
  -- writes these back once a real order exists. orders.id is text
  -- (ORD-XXXX), same FK shape as customer_retention_referrals.
  converted_order_id        text references public.orders(id) on delete set null,
  converted_at              timestamptz,

  last_activity_at          timestamptz not null default now(),
  created_by                uuid references public.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists idx_sales_leads_status
  on public.sales_leads(org_id, status, created_at desc);
create index if not exists idx_sales_leads_closer
  on public.sales_leads(org_id, assigned_closer_id, created_at desc);
create index if not exists idx_sales_leads_phone
  on public.sales_leads(org_id, phone);
create index if not exists idx_sales_leads_follow_up
  on public.sales_leads(org_id, follow_up_at)
  where follow_up_at is not null and status not in ('order_created', 'not_interested');
create index if not exists idx_sales_leads_products
  on public.sales_leads using gin (interested_product_ids);
create index if not exists idx_sales_leads_converted
  on public.sales_leads(org_id, converted_order_id)
  where converted_order_id is not null;

alter table public.sales_leads enable row level security;

-- Same visibility rule as customer_retention_referrals: leadership sees
-- the org, a Sales Closer sees her own assigned leads plus unassigned
-- ones she could pick up.
drop policy if exists "sales leads select" on public.sales_leads;
create policy "sales leads select"
  on public.sales_leads for select to authenticated
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or (
        private.auth_user_role()::text = 'Sales Closer'
        and (assigned_closer_id = auth.uid() or assigned_closer_id is null)
      )
    )
  );

drop policy if exists "sales leads insert" on public.sales_leads;
create policy "sales leads insert"
  on public.sales_leads for insert to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Sales Closer')
  );

drop policy if exists "sales leads update" on public.sales_leads;
create policy "sales leads update"
  on public.sales_leads for update to authenticated
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or (private.auth_user_role()::text = 'Sales Closer' and assigned_closer_id = auth.uid())
    )
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Sales Closer')
  );

-- No delete policy - leads are status-transitioned, never hard-deleted
-- (matches customer_retention_referrals, which also has none).
