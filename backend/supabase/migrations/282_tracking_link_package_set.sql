-- Tracking links carry the order form's package set and currency (Bright,
-- 2 Oct 2026). Without a package set the form shows the packages of EVERY
-- set; the live Racks form uses "Default". Additive only.
alter table public.meta_capi_configs add column if not exists package_set text;
alter table public.meta_capi_configs add column if not exists currency text;
