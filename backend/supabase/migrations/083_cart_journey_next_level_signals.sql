-- Migration 083: extend cart_journey_events allowlist with the five
-- next-level customer-behavior signals shipped by commit 39ae713
-- (tier hops, image dwell, field hesitation, submit-area idle, back press).
--
-- Why: the matching commit added the event types to the backend zod schema
-- and to the frontend, but the cart_journey_events.event_type CHECK
-- constraint still rejected them, so every new-type insert failed with 500
-- and the frontend's best-effort .catch swallowed it. Result: nothing
-- landed in the DB after deploy, even with traffic.
--
-- Drops + re-adds the constraint with the full union of (a) every
-- previously-allowed value (064 + 065 + 069) and (b) the five new values.

alter table public.cart_journey_events
  drop constraint if exists cart_journey_events_event_type_check;

alter table public.cart_journey_events
  add constraint cart_journey_events_event_type_check
  check (
    event_type in (
      -- baseline + 064 submit blockers
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
      -- 065 post-submit + admin lifecycle events
      'order_assigned',
      'order_reassigned',
      'delivery_agent_assigned',
      'delivery_agent_reassigned',
      'order_status_changed',
      'contact_attempt_logged',
      -- 083 next-level customer behavior signals
      'tier_switched',
      'image_viewed',
      'field_hesitated',
      'submit_idle',
      'back_button_pressed'
    )
  );
