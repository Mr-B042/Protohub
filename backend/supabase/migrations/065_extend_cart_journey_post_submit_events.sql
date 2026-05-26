alter table public.cart_journey_events
  drop constraint if exists cart_journey_events_event_type_check;
alter table public.cart_journey_events
  add constraint cart_journey_events_event_type_check
  check (
    event_type = any (
      array[
        'form_opened'::text,
        'package_selected'::text,
        'state_selected'::text,
        'additional_item_preview_opened'::text,
        'additional_item_added'::text,
        'additional_item_removed'::text,
        'submit_attempted'::text,
        'submit_blocked_missing_name'::text,
        'submit_blocked_missing_phone'::text,
        'submit_blocked_invalid_phone'::text,
        'submit_blocked_missing_whatsapp'::text,
        'submit_blocked_invalid_whatsapp'::text,
        'submit_blocked_missing_address'::text,
        'submit_blocked_missing_city'::text,
        'submit_blocked_missing_delivery'::text,
        'submit_blocked_missing_confirmation'::text,
        'submit_blocked_missing_commitment'::text,
        'order_submitted'::text,
        'order_assigned'::text,
        'order_reassigned'::text,
        'delivery_agent_assigned'::text,
        'delivery_agent_reassigned'::text,
        'order_status_changed'::text,
        'contact_attempt_logged'::text,
        'form_exited'::text
      ]
    )
  );
