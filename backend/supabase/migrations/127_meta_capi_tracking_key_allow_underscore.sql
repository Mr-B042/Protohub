-- Allow a leading underscore in tracking_key so the reserved org-wide sentinel
-- "__default__" (used by server-side auto-submit CAPI fallback) passes validation.
ALTER TABLE public.meta_capi_configs DROP CONSTRAINT IF EXISTS meta_capi_configs_tracking_key_check;
ALTER TABLE public.meta_capi_configs ADD CONSTRAINT meta_capi_configs_tracking_key_check
  CHECK (tracking_key ~ '^[A-Za-z0-9_][A-Za-z0-9_.:-]{1,119}$');
