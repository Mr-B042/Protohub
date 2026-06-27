-- Generalize the per-product dedicated handler from ONE user to a SET of users.
-- When non-empty, only these reps share the product's auto-assigned orders
-- (round-robin among them) instead of the whole team. Empty = normal global
-- round-robin. Supersedes the single dedicated_handler_user_id column, which is
-- left in place (ignored) for reversibility.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS dedicated_handler_user_ids uuid[] NOT NULL DEFAULT '{}';

-- Backfill from the existing single-handler column so nothing currently pinned breaks.
UPDATE public.products
   SET dedicated_handler_user_ids = ARRAY[dedicated_handler_user_id]
 WHERE dedicated_handler_user_id IS NOT NULL
   AND (dedicated_handler_user_ids IS NULL OR dedicated_handler_user_ids = '{}');
