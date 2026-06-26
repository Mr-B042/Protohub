-- Optional native Android app link (Play Store URL or hosted APK). When set, a
-- "Download Android app" button shows alongside the PWA install in Settings.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS android_app_url text;
