-- Extend whatsapp_inbox_messages to also store outbound (rep-sent) messages
-- so the full conversation thread lives in one table.
ALTER TABLE public.whatsapp_inbox_messages
  ADD COLUMN IF NOT EXISTS direction      text NOT NULL DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS sent_by_user_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS sent_by_name   text,
  ADD COLUMN IF NOT EXISTS read_at        timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at        timestamptz;

ALTER TABLE public.whatsapp_inbox_messages
  DROP CONSTRAINT IF EXISTS whatsapp_inbox_messages_direction_check;
ALTER TABLE public.whatsapp_inbox_messages
  ADD CONSTRAINT whatsapp_inbox_messages_direction_check
  CHECK (direction IN ('inbound', 'outbound'));

-- Index for fast unread-count queries
CREATE INDEX IF NOT EXISTS whatsapp_inbox_messages_unread_idx
  ON public.whatsapp_inbox_messages (org_id, normalized_phone, direction, read_at)
  WHERE direction = 'inbound' AND read_at IS NULL;
