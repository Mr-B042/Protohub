-- Multi-ad attribution: when duplicate carts (same phone+product across separate
-- ad clicks) are merged, each visit's ad snapshot is preserved in touchpoints[].
-- merged_into marks an absorbed cart (the "Merged" state) so it drops out of the
-- abandoned-cart lists/counts while staying auditable + reversible.
ALTER TABLE public.abandoned_carts
  ADD COLUMN IF NOT EXISTS touchpoints  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS merged_into  text;

CREATE INDEX IF NOT EXISTS idx_abandoned_carts_merged_into
  ON public.abandoned_carts (merged_into) WHERE merged_into IS NOT NULL;
