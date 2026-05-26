ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ad_tracking_campaign_labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ad_tracking_creative_labels jsonb NOT NULL DEFAULT '{}'::jsonb;;
