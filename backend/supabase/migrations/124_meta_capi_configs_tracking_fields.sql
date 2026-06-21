ALTER TABLE public.meta_capi_configs
  ADD COLUMN IF NOT EXISTS redirect_url      text,
  ADD COLUMN IF NOT EXISTS landing_page_url  text,
  ADD COLUMN IF NOT EXISTS product_id        uuid REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS utm_source        text,
  ADD COLUMN IF NOT EXISTS utm_medium        text,
  ADD COLUMN IF NOT EXISTS utm_campaign      text,
  ADD COLUMN IF NOT EXISTS test_event_code   text;
