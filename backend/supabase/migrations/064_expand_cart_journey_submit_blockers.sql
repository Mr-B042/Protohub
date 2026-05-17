-- Migration 064: expand cart journey events with submit blocker reasons
-- Lets the form capture why a customer tried to submit but got stopped,
-- which powers rep follow-up hints and journey analytics.

alter table public.cart_journey_events
  drop constraint if exists cart_journey_events_event_type_check;

alter table public.cart_journey_events
  add constraint cart_journey_events_event_type_check
  check (
    event_type in (
      'form_opened',
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
      'submit_blocked_missing_delivery',
      'submit_blocked_missing_confirmation',
      'submit_blocked_missing_commitment',
      'order_submitted',
      'form_exited'
    )
  );
