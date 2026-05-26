alter table order_contact_attempts
  add column if not exists outcome_group text
    check (outcome_group in ('progress', 'recoverable', 'unreachable', 'closed_loss', 'other')),
  add column if not exists recovery_bucket text
    check (recovery_bucket in (
      'ready_now',
      'call_tomorrow',
      'call_in_2_3_days',
      'salary_wait',
      'spouse_approval',
      'wants_discount',
      'asked_for_whatsapp',
      'no_answer',
      'switched_off',
      'line_busy',
      'not_interested',
      'wrong_number',
      'out_of_coverage'
    ));
create index if not exists idx_order_contact_attempts_outcome_group
  on order_contact_attempts (org_id, outcome_group, attempted_at desc);
create index if not exists idx_order_contact_attempts_recovery_bucket
  on order_contact_attempts (org_id, recovery_bucket, attempted_at desc);
