-- Store Baileys session credentials in Supabase so they survive Railway restarts.
-- Org-level automation account
ALTER TABLE whatsapp_settings
  ADD COLUMN IF NOT EXISTS baileys_creds  jsonb,
  ADD COLUMN IF NOT EXISTS baileys_keys   jsonb;

-- Per-user personal dispatch accounts
ALTER TABLE whatsapp_user_accounts
  ADD COLUMN IF NOT EXISTS baileys_creds  jsonb,
  ADD COLUMN IF NOT EXISTS baileys_keys   jsonb;
