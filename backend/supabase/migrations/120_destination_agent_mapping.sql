-- Map WhatsApp destinations to delivery agents (couriers) instead of/alongside users.
ALTER TABLE public.whatsapp_user_destinations
  ADD COLUMN IF NOT EXISTS assigned_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS whatsapp_user_destinations_agent_idx
  ON public.whatsapp_user_destinations (org_id, assigned_agent_id)
  WHERE assigned_agent_id IS NOT NULL;
