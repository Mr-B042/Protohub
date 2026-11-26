-- Two notification types the server already sends (26 Nov 2026):
--   stock_state_restock      busy state with < a week of stock (PR #1067) -
--                            its inserts were failing: the type was missing here.
--   same_customer_other_rep  one customer's orders / carts with 2+ reps.
alter type notification_type add value if not exists 'stock_state_restock';
alter type notification_type add value if not exists 'same_customer_other_rep';
