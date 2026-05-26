-- Migration 015: document every column that exists in prod but is absent from
-- the on-file migrations. All statements use IF NOT EXISTS so they are safe
-- no-ops when run against a live DB that already has these columns.

-- ── orders ────────────────────────────────────────────────
-- UTM attribution fields
alter table orders
  add column if not exists utm_medium   text,
  add column if not exists utm_content  text,
  add column if not exists utm_term     text;
-- Remittance tracking
alter table orders
  add column if not exists logistics_cost   numeric(12,2) not null default 0,
  add column if not exists amount_remitted  numeric(12,2) not null default 0,
  add column if not exists remittance_status text not null default 'Unpaid';
-- Cross-sell / free-gift order lines (jsonb arrays stored on the order)
alter table orders
  add column if not exists cross_sell_lines jsonb not null default '[]',
  add column if not exists free_gift_lines  jsonb not null default '[]';
-- Upsell metadata
alter table orders
  add column if not exists upsell_from_qty  integer,
  add column if not exists upsell_to_qty    integer,
  add column if not exists upsell_note      text;
-- Manual bonus override (allows admin to adjust commission post-delivery)
alter table orders
  add column if not exists manual_bonus_override   numeric(12,2),
  add column if not exists manual_bonus_reason     text,
  add column if not exists bonus_manually_adjusted boolean not null default false;
-- ── products ──────────────────────────────────────────────
alter table products
  add column if not exists bonus_config               jsonb,
  add column if not exists available_states           text[]  not null default '{}',
  add column if not exists role                       text,
  add column if not exists can_be_cross_sell          boolean not null default false,
  add column if not exists can_be_free_gift           boolean not null default false,
  add column if not exists cross_sell_product_ids     uuid[]  not null default '{}',
  add column if not exists cross_sell_price_overrides jsonb   not null default '{}',
  add column if not exists cross_sell_state_restrictions jsonb not null default '{}',
  add column if not exists free_gift_product_ids      uuid[]  not null default '{}',
  add column if not exists free_gift_state_restrictions jsonb not null default '{}',
  add column if not exists form_custom_text           text,
  add column if not exists package_description        text;
-- ── product_packages ──────────────────────────────────────
alter table product_packages
  add column if not exists companion_products jsonb not null default '[]';
-- ── users ─────────────────────────────────────────────────
alter table users
  add column if not exists permissions jsonb not null default '{}',
  add column if not exists extra_pages jsonb not null default '[]';
-- ── organizations ─────────────────────────────────────────
alter table organizations
  add column if not exists cache_version               integer       not null default 0,
  add column if not exists logo_url                    text,
  add column if not exists top_performer_bonus_enabled  boolean       not null default false,
  add column if not exists top_performer_bonus_amount   numeric(12,2) not null default 0,
  add column if not exists timezone                    text          not null default 'Africa/Lagos';
-- ── pay_structures ────────────────────────────────────────
alter table pay_structures
  add column if not exists type text not null default 'Per Delivered Order';
-- ── expenses ──────────────────────────────────────────────
alter table expenses
  add column if not exists product_id uuid references products(id) on delete set null,
  add column if not exists waybill_id text;
-- ── stock_movements ───────────────────────────────────────
alter table stock_movements
  add column if not exists waybill_id    text,
  add column if not exists from_location text,
  add column if not exists to_location   text;
