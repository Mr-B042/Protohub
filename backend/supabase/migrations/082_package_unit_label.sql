-- Optional per-package unit label override. Lets owners say "3 sets" instead
-- of "3 pcs" when the package's quantity counts something other than pieces
-- (e.g. sets, packs, bottles, rolls, bundles).
--
-- Both columns are nullable. Null means "use the default" — frontend falls
-- back to "pc" / "pcs", so existing packages render identically until an
-- owner edits the unit on a specific package.

alter table public.product_packages
  add column if not exists unit_singular text,
  add column if not exists unit_plural text;
