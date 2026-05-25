ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS smart_stock_lookback_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS smart_stock_dormant_days integer NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS smart_stock_critical_days_cover integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS smart_stock_watch_days_cover integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS smart_stock_low_threshold integer NOT NULL DEFAULT 5;
