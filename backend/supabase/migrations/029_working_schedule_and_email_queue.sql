alter table organizations
  add column if not exists working_schedule_enabled boolean not null default false,
  add column if not exists working_days text[] not null default array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
  add column if not exists working_day_start text not null default '08:00',
  add column if not exists working_day_end text not null default '18:00';

alter table email_messages
  add column if not exists scheduled_for timestamptz;

create index if not exists idx_email_messages_queue
  on email_messages(org_id, status, scheduled_for);
