-- Add the cross_sell_offer rule type: lets Owner/Admin bonus a SPECIFIC
-- pre-vetted cross-sell combo (product/package scope + minimum quantity +
-- minimum price), instead of the generic cross_sell_count "any add-on"
-- count. See computeSalesBonusForRep in sales-bonus-engine.ts for the
-- matching logic (quantity/amount are floors, not exact matches).
alter table sales_bonus_rules
  drop constraint if exists sales_bonus_rules_type_check;
alter table sales_bonus_rules
  add constraint sales_bonus_rules_type_check
  check (type in ('upgrade_count', 'cross_sell_count', 'upfront_percent', 'delivery_rate_per_delivered', 'cross_sell_offer'));
