ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS cloud_api_phone_number_id text,
  ADD COLUMN IF NOT EXISTS cloud_api_waba_id text,
  ADD COLUMN IF NOT EXISTS cloud_api_access_token text,
  ADD COLUMN IF NOT EXISTS cloud_api_verified_at timestamptz;
