-- =====================================================================
-- Migration 002: Email Settings (Mailjet + Resend)
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard
-- =====================================================================

-- ── 1. email_settings table (one row per org) ────────────────────────
create table if not exists public.email_settings (
  org_id          uuid primary key references public.organizations(id) on delete cascade,
  enabled         boolean not null default false,
  provider        text not null default 'mailjet',   -- 'mailjet' | 'resend'
  api_key_public  text not null default '',          -- Mailjet public key  (unused for Resend)
  api_key_private text not null default '',          -- Mailjet secret key  (unused for Resend)
  resend_api_key  text not null default '',          -- Resend API key      (unused for Mailjet)
  from_name       text not null default '',
  from_email      text not null default '',
  reply_to        text not null default '',
  triggers        jsonb not null default '{
    "order_new": false,
    "order_status_change": true,
    "order_delivered": false,
    "payroll_approved": false
  }',
  templates       jsonb not null default '{
    "order_new": {
      "subject": "New order {{order_id}} received",
      "body": "Hello,\n\nA new order {{order_id}} has been placed by {{customer}}.\n\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\nPhone: {{phone}}\n\nThank you."
    },
    "order_status_change": {
      "subject": "Your order {{order_id}} has been updated",
      "body": "Hello {{customer}},\n\nYour order {{order_id}} status has changed from {{from_status}} to {{status}}.\n\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\n\nThank you for your business."
    },
    "order_delivered": {
      "subject": "Your order {{order_id}} has been delivered!",
      "body": "Hello {{customer}},\n\nGreat news! Your order {{order_id}} has been delivered successfully.\n\nProduct: {{product_name}}\nAmount: {{currency}} {{amount}}\n\nThank you for shopping with us!"
    },
    "payroll_approved": {
      "subject": "Your payroll for {{period}} has been approved",
      "body": "Hello {{name}},\n\nYour payroll for the period {{period}} has been approved.\n\nNet Amount: {{currency}} {{amount}}\n\nThank you."
    }
  }',
  updated_at      timestamptz not null default now()
);

-- ── 2. RLS ───────────────────────────────────────────────────────────
alter table public.email_settings enable row level security;

drop policy if exists "same org email_settings" on public.email_settings;
create policy "same org email_settings"
  on public.email_settings for all
  using (org_id = public.auth_org_id());
