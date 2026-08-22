-- Extra products on an order that are NOT cross-sell.
--
-- Until now the only way to put a second product on an order was to add it as
-- a cross-sell, which pays the rep a bonus and reports as cross-sell revenue.
-- Bright wants to add items without either of those being true - a customer
-- who simply asked for two more of something is not an upsell win.
--
-- ⚠️ These lines DO count toward orders.amount, DO deduct stock and DO cost
-- COGS. The only things they skip are the cross-sell bonus and the cross-sell
-- reporting bucket - unless the Owner marks an individual line bonus-eligible.
--
-- Shape, mirroring cross_sell_lines so every existing reader stays familiar:
--   [{ id, productId, productName, quantity, amount, bonusEligible,
--      addedAt, addedById, addedByName, addedByRole, note }]
--
-- ⚠️ quantity is PIECES ordered, never pieces x units_per_pack. Cross-sell had
-- exactly this bug and over-deducted stock four-fold before it was caught.
alter table orders add column if not exists additional_lines jsonb;

comment on column orders.additional_lines is
  'Extra non-cross-sell products on the order. Counts toward amount, deducts stock, costs COGS; pays no cross-sell bonus unless a line is flagged bonusEligible. quantity is PIECES.';
