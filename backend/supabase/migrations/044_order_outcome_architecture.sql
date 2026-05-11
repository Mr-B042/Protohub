ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS outcome_code text,
  ADD COLUMN IF NOT EXISTS outcome_category text,
  ADD COLUMN IF NOT EXISTS next_action_type text,
  ADD COLUMN IF NOT EXISTS next_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_action_note text;

UPDATE orders
SET
  outcome_code = COALESCE(outcome_code, call_outcome),
  outcome_category = COALESCE(
    outcome_category,
    CASE
      WHEN COALESCE(call_outcome, '') IN ('Delivered', 'Recovered Delivery') THEN 'success'
      WHEN COALESCE(call_outcome, '') IN ('Refused') THEN 'customer_declined'
      WHEN COALESCE(call_outcome, '') IN ('Waybill') THEN 'dispatch'
      WHEN COALESCE(call_outcome, '') IN ('Out of Stock', 'out of coverage') THEN 'logistics_blocker'
      WHEN COALESCE(call_outcome, '') IN ('Awaiting payment') THEN 'payment_hold'
      WHEN COALESCE(call_outcome, '') IN ('Line Busy', 'No Answer', 'Not Picking', 'Number not going', 'Wrong Number', 'Switched off', 'Not Reached', 'Not Available') THEN 'customer_unreachable'
      WHEN COALESCE(call_outcome, '') IN ('Pending', 'Ready', 'Rescheduled', 'Have questions to ask', 'Will get back to us', 'We should call back', 'Will Call Back', 'Scheduled Callback', 'Not Ready', 'Travelled', 'Seat at home') THEN 'customer_follow_up'
      WHEN status = 'Delivered' THEN 'success'
      WHEN status = 'Cancelled' THEN 'customer_declined'
      WHEN status = 'Dispatched' THEN 'dispatch'
      WHEN status = 'Postponed' THEN 'customer_follow_up'
      WHEN status = 'Failed' THEN 'other'
      ELSE 'core_status'
    END
  ),
  next_action_type = COALESCE(
    next_action_type,
    CASE
      WHEN scheduled_at IS NOT NULL THEN 'deliver'
      WHEN COALESCE(call_outcome, '') IN ('Awaiting payment') THEN 'payment_check'
      WHEN COALESCE(call_outcome, '') IN ('Out of Stock') THEN 'confirm_stock'
      WHEN COALESCE(call_outcome, '') IN ('Waybill') THEN 'waybill'
      WHEN COALESCE(call_outcome, '') IN ('Pending', 'Ready', 'Rescheduled', 'Have questions to ask', 'Will get back to us', 'We should call back', 'Will Call Back', 'Scheduled Callback', 'Not Ready', 'Travelled', 'Seat at home', 'Line Busy', 'No Answer', 'Not Picking', 'Switched off', 'Not Reached', 'Not Available') THEN 'call'
      ELSE NULL
    END
  ),
  next_action_at = COALESCE(next_action_at, scheduled_at),
  next_action_note = COALESCE(
    next_action_note,
    CASE
      WHEN scheduled_at IS NOT NULL OR COALESCE(call_outcome, '') IN ('Awaiting payment', 'Out of Stock', 'Waybill', 'Pending', 'Ready', 'Rescheduled', 'Have questions to ask', 'Will get back to us', 'We should call back', 'Will Call Back', 'Scheduled Callback', 'Not Ready', 'Travelled', 'Seat at home', 'Line Busy', 'No Answer', 'Not Picking', 'Switched off', 'Not Reached', 'Not Available')
        THEN NULLIF(response, '')
      ELSE NULL
    END
  )
WHERE
  outcome_code IS NULL
  OR outcome_category IS NULL
  OR next_action_type IS NULL
  OR next_action_at IS NULL
  OR next_action_note IS NULL;
