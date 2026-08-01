-- 198: the incident taxonomy the Incidents screen actually uses.
--
-- The original list was written around stock and cash loss. Day to day, most
-- incidents are service problems - a rude rider, a late delivery, a return that
-- was never collected - and forcing those into "Other" makes the whole report
-- useless for spotting patterns.
alter table public.pda_incidents drop constraint if exists pda_incident_type_valid;
alter table public.pda_incidents add constraint pda_incident_type_valid check (incident_type in (
  'Customer Complaint','COD Discrepancy','Delivery Issue','Return Issue','Payment Delay',
  'Missing inventory','Damaged product','Missing COD','Customer complaint',
  'Agent misconduct','Delivery accident','Theft','Wrong product delivered',
  'False delivery claim','Unsafe delivery location','Other'
));

-- "In Progress" and "Closed" are what people actually say. The older wording is
-- kept so existing rows stay valid.
alter table public.pda_incidents drop constraint if exists pda_incident_status_valid;
alter table public.pda_incidents add constraint pda_incident_status_valid check (status in (
  'Open','In Progress','Resolved','Closed',
  'Under Investigation','Awaiting Agent Response','Closed - No Action','Escalated'
));

-- A human reference. Staff quote "INC-260731-001" on a call; a uuid is useless
-- for that.
alter table public.pda_incidents
  add column if not exists incident_code text;

create index if not exists idx_pda_incident_code on public.pda_incidents (org_id, incident_code);
