-- Migration 175: per-product configurable Customer Retention lifecycle
-- timing, per the redesign doc ("The exact timing should be configurable
-- by product because a bathroom organizer, cleaning tool and other
-- household products may have different ideal follow-up windows").
--
-- Additive JSONB override, same convention as product_packages
-- .companion_products - null/absent means "use the org-wide defaults"
-- (3/7/14/21/45/90 days), so this never breaks an existing product.
alter table public.products
  add column if not exists retention_timing_overrides jsonb;
