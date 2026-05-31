-- Multi-item waybills: a single waybill (one route, one fee, one tracking #) can
-- now carry several products, each with its own quantity. Stored as a jsonb array
-- of { product_id, product_name, quantity } on waybill_records.items.
--
-- Back-compat: existing single-product waybills leave items NULL and continue to
-- use the product_id / product_name / quantity columns. New multi-item waybills
-- populate items; the legacy columns are kept in sync with the FIRST item so any
-- code/queries still reading them keep working.

alter table public.waybill_records
  add column if not exists items jsonb;

comment on column public.waybill_records.items is
  'Array of { product_id, product_name, quantity } for multi-item waybills. NULL on legacy single-item rows (which use product_id/product_name/quantity).';
