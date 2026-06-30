-- Migration 145: close Supabase "RLS Disabled in Public" advisor findings.
--
-- These tables are owned by backend routes/jobs that use the service-role
-- Supabase client, which bypasses RLS. Enabling RLS here blocks direct anon /
-- authenticated REST access while preserving application behavior through the
-- API layer where role and org checks already happen.

alter table public.whatsapp_user_destinations enable row level security;
alter table public.whatsapp_user_accounts enable row level security;
alter table public.whatsapp_order_dispatches enable row level security;
alter table public.follow_up_misses enable row level security;
alter table public.short_links enable row level security;
