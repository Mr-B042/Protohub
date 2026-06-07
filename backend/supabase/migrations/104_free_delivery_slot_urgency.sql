-- Migration 104: optional free-delivery slot urgency for public order forms.
--
-- This is deliberately configured on embed_settings (org-wide form behavior),
-- and the live slot count is calculated from real submitted orders in the
-- current reset window. Admins can optionally start every reset window with a
-- manual "already claimed" number for sales pressure; real submitted orders are
-- added on top of that number. Nothing is stored per window, so "full" resets
-- automatically when the next interval starts.

alter table public.embed_settings
  add column if not exists free_delivery_slots_enabled boolean not null default false,
  add column if not exists free_delivery_slot_limit integer not null default 15,
  add column if not exists free_delivery_slot_manual_claimed integer not null default 0,
  add column if not exists free_delivery_reset_interval_minutes integer not null default 1440;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'embed_settings_free_delivery_slot_limit_check'
  ) then
    alter table public.embed_settings
      add constraint embed_settings_free_delivery_slot_limit_check
      check (free_delivery_slot_limit between 1 and 500)
      not valid;
  end if;
end $$;

alter table public.embed_settings
  validate constraint embed_settings_free_delivery_slot_limit_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'embed_settings_free_delivery_manual_claimed_check'
  ) then
    alter table public.embed_settings
      add constraint embed_settings_free_delivery_manual_claimed_check
      check (free_delivery_slot_manual_claimed between 0 and 500)
      not valid;
  end if;
end $$;

alter table public.embed_settings
  validate constraint embed_settings_free_delivery_manual_claimed_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'embed_settings_free_delivery_reset_interval_check'
  ) then
    alter table public.embed_settings
      add constraint embed_settings_free_delivery_reset_interval_check
      check (free_delivery_reset_interval_minutes between 10 and 10080)
      not valid;
  end if;
end $$;

alter table public.embed_settings
  validate constraint embed_settings_free_delivery_reset_interval_check;
