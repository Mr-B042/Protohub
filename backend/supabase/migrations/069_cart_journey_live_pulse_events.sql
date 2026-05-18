-- Migration 069: extend cart journey for live form pulse signals
-- Adds true form-view / first-interaction / redirect events plus the missing
-- state submit blocker so the live pulse can show accurate health metrics.

alter table public.cart_journey_events
  drop constraint if exists cart_journey_events_event_type_check;

alter table public.cart_journey_events
  add constraint cart_journey_events_event_type_check
  check (
    event_type in (
      'form_opened',
      'first_interaction',
      'package_selected',
      'state_selected',
      'additional_item_preview_opened',
      'additional_item_added',
      'additional_item_removed',
      'submit_attempted',
      'submit_blocked_missing_name',
      'submit_blocked_missing_phone',
      'submit_blocked_invalid_phone',
      'submit_blocked_missing_whatsapp',
      'submit_blocked_invalid_whatsapp',
      'submit_blocked_missing_address',
      'submit_blocked_missing_city',
      'submit_blocked_missing_state',
      'submit_blocked_missing_delivery',
      'submit_blocked_missing_confirmation',
      'submit_blocked_missing_commitment',
      'order_submitted',
      'redirect_triggered',
      'form_exited',
      'order_assigned',
      'order_reassigned',
      'delivery_agent_assigned',
      'delivery_agent_reassigned',
      'order_status_changed',
      'contact_attempt_logged'
    )
  );
