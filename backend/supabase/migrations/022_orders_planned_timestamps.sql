-- Planned delivery/follow-up activity needs real timestamps, not date-only
-- placeholders, so preserve both the planned moment and the structured order
-- timeline on the order record itself.

alter table orders
  add column if not exists scheduled_at timestamptz,
  add column if not exists timeline_notes jsonb not null default '[]';
