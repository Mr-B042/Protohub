-- Migration 027: durable email activity logs for pagination and auditing.

create table if not exists email_messages (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  trigger          text not null,
  audience         text not null default 'customer',
  recipient_name   text,
  recipient_email  text not null,
  subject          text not null,
  body             text not null,
  provider         text,
  fallback_from    text,
  status           text not null default 'sent',
  error_message    text,
  metadata         jsonb not null default '{}'::jsonb,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_email_messages_org_created
  on email_messages(org_id, created_at desc);
create index if not exists idx_email_messages_org_status
  on email_messages(org_id, status, created_at desc);
create index if not exists idx_email_messages_trigger
  on email_messages(org_id, trigger, created_at desc);
create index if not exists idx_email_messages_recipient
  on email_messages(org_id, recipient_email, created_at desc);
alter table email_messages enable row level security;
create policy "Owner sees email logs"
  on email_messages for select
  using (org_id = auth_org_id() and auth_user_role() = 'Owner');
create policy "System inserts email logs"
  on email_messages for insert
  with check (org_id = auth_org_id());
