ALTER TABLE public.meta_capi_configs
  ADD COLUMN IF NOT EXISTS tiktok_pixel_id     text,
  ADD COLUMN IF NOT EXISTS tiktok_access_token text;
