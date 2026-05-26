alter table public.whatsapp_settings
  add column if not exists assistant_outcome_autofill_enabled boolean not null default true;
