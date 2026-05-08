-- Add admin_cart_notifications flag to organizations so the setting persists.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS admin_cart_notifications boolean NOT NULL DEFAULT false;
