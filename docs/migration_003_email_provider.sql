-- =====================================================================
-- Migration 003: Add provider + Resend key to email_settings
-- Only run this if you already ran migration_002.
-- Run in Supabase SQL Editor: https://supabase.com/dashboard
-- =====================================================================

alter table public.email_settings
  add column if not exists provider       text not null default 'mailjet',
  add column if not exists resend_api_key text not null default '';
