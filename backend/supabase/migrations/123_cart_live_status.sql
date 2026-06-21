ALTER TABLE public.abandoned_carts ADD COLUMN IF NOT EXISTS live_status jsonb;
