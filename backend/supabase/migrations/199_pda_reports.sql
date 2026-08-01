-- 199: generated reports for the Personal Delivery Agents module.
--
-- A row here is a RECORD that someone generated a report, not a stored file.
-- Downloading re-runs it against live data, so an old report can never hand
-- back figures that quietly disagree with the system they came from - which is
-- exactly how two people end up arguing from two different "official" numbers.
create table if not exists public.pda_reports (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  report_code   text,
  name          text not null,
  category      text not null,
  description   text,
  date_from     date,
  date_to       date,
  status        text not null default 'Completed',
  failure_reason text,
  row_count     integer,
  generated_by  uuid,
  generated_by_name text,
  generated_by_role text,
  generated_at  timestamptz not null default now(),
  downloaded_count integer not null default 0,
  last_downloaded_at timestamptz,
  -- Scheduled reports are declared here but not yet run automatically; the
  -- flag exists so a schedule can be recorded without pretending it fires.
  is_scheduled  boolean not null default false,
  schedule_note text,
  created_at    timestamptz not null default now(),
  constraint pda_report_category_valid check (category in (
    'Collections','Remittance','Payments','Earnings','Performance',
    'Incidents','Deliveries','Inventory','Discrepancies','Other'
  )),
  constraint pda_report_status_valid check (status in ('Completed','Failed','Scheduled','Generating'))
);

create index if not exists idx_pda_reports_org on public.pda_reports (org_id, generated_at desc);

alter table public.pda_reports enable row level security;
