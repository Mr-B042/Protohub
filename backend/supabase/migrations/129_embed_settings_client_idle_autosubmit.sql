ALTER TABLE public.embed_settings ADD COLUMN IF NOT EXISTS client_idle_autosubmit_enabled boolean DEFAULT true;
