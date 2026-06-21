ALTER TABLE public.abandoned_carts
  ADD COLUMN IF NOT EXISTS dedup_merged_from text[],
  ADD COLUMN IF NOT EXISTS dedup_signal text;
