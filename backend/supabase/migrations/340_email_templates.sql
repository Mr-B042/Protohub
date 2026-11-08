-- Email Marketing: Templates tab + Create Custom Template (Bright's design, 8 Nov 2026).
--
-- Saved templates already live in email_saved_blocks (kind = 'template'),
-- saved from Create Campaign's design step. They gain what the new window
-- asks for. Ready-made templates are not stored: they are built in
-- email-render.ts from the business's own brand and products.

alter table public.email_saved_blocks add column if not exists category text not null default 'custom';
alter table public.email_saved_blocks add column if not exists description text not null default '';
alter table public.email_saved_blocks add column if not exists template_type text not null default 'promotional'
  check (template_type in ('promotional', 'retention', 'transactional', 'announcement'));
-- team = everyone in the branch can use it; private = only the person who made it.
alter table public.email_saved_blocks add column if not exists visibility text not null default 'team' check (visibility in ('team', 'private'));
alter table public.email_saved_blocks add column if not exists subject text not null default '';
alter table public.email_saved_blocks add column if not exists preheader text not null default '';
-- draft = still being made (not offered in Create Campaign yet).
alter table public.email_saved_blocks add column if not exists status text not null default 'ready' check (status in ('draft', 'ready'));
alter table public.email_saved_blocks add column if not exists updated_at timestamptz not null default now();

-- Which template a campaign started from ("starter:promo_offer" or "saved:<id>"), for Most Used.
alter table public.email_campaigns add column if not exists template_key text;
