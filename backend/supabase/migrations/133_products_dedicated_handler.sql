-- Per-product dedicated handler: when set, ALL auto-assigned orders for this product
-- go to this one user (a Sales Rep or Admin) instead of the round-robin. NULL = use
-- the round-robin as normal. ON DELETE SET NULL so removing the user clears it.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS dedicated_handler_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
