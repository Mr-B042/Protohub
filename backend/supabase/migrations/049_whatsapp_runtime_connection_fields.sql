alter table public.whatsapp_settings
  add column if not exists pairing_mode text,
  add column if not exists pairing_phone text,
  add column if not exists pairing_code text,
  add column if not exists qr_code_data_url text;
alter table public.whatsapp_settings
  drop constraint if exists whatsapp_settings_pairing_mode_check;
alter table public.whatsapp_settings
  add constraint whatsapp_settings_pairing_mode_check
  check (pairing_mode is null or pairing_mode in ('qr', 'pairing_code'));
