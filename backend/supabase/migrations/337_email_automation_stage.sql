-- Email Marketing: Customer Journey (Bright's design 53, 8 Nov 2026).
--
-- Customer Journey shows the same automated flows as Automations, grouped by
-- the customer's stage. Each flow keeps its stage here; empty = worked out
-- from its template and trigger (lib/email-automation-rules.ts, defaultStage).
alter table public.email_automations add column if not exists stage text
  check (stage is null or stage in ('acquisition', 'nurture', 'conversion', 'retention', 'winback', 'post_purchase'));
