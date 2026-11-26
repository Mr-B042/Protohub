-- "Order not sent out in 15 min" (lib/late-send.ts) has saved its alerts as
-- type 'order_late_send' since 24 Oct 2026, but the type was never added here,
-- so every insert failed and the push after it never ran: the alert was
-- completely silent (0 rows). Bright, 26 Nov 2026: "yes" - switch it on.
alter type notification_type add value if not exists 'order_late_send';
