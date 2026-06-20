-- Replace single assigned_rep_id with an array so one group can serve multiple reps.
ALTER TABLE public.whatsapp_user_destinations
  ADD COLUMN IF NOT EXISTS assigned_rep_ids uuid[] NOT NULL DEFAULT '{}';

-- Migrate any existing single mapping into the array
UPDATE public.whatsapp_user_destinations
  SET assigned_rep_ids = ARRAY[assigned_rep_id]
  WHERE assigned_rep_id IS NOT NULL
    AND NOT (ARRAY[assigned_rep_id] <@ assigned_rep_ids);

-- Keep assigned_rep_id for backwards compat but it's now secondary
CREATE INDEX IF NOT EXISTS whatsapp_user_destinations_rep_ids_idx
  ON public.whatsapp_user_destinations USING GIN (assigned_rep_ids);
