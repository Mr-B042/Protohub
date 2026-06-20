-- Link a saved destination to a specific rep/agent so the dispatch picker
-- can auto-suggest the right group based on the order's assigned rep.
ALTER TABLE public.whatsapp_user_destinations
  ADD COLUMN IF NOT EXISTS assigned_rep_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS whatsapp_user_destinations_rep_idx
  ON public.whatsapp_user_destinations (org_id, assigned_rep_id)
  WHERE assigned_rep_id IS NOT NULL;
