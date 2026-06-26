-- WhatsApp setup mode. false (default) = Shared: the admin/owner connects once and
-- sets up the org's groups; everyone dispatches through that one account.
-- true = Per-user: every member connects their OWN WhatsApp and manages their own
-- destinations, and their dispatch sends from their own number.
ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS per_user_dispatch boolean NOT NULL DEFAULT false;
