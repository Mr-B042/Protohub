-- Initiatives design-match (Stage 2): the supplied mockup tracks a lot more
-- per initiative than the original build did - a type classification, a
-- target segment, manually-tracked funnel numbers, and separate
-- impact/priority framing depending on whether the initiative is active or
-- still a pipeline idea. Manual entry for the funnel numbers was already
-- confirmed acceptable - there's no real per-initiative offer data (offers
-- aren't tagged with which script/initiative produced them).

alter table public.sales_initiatives
  add column if not exists initiative_type text not null default 'Promotion'
    check (initiative_type in ('Upsell', 'Cross-sell', 'Retention', 'Promotion', 'Training', 'Process', 'Offer')),
  add column if not exists target_segment text,
  add column if not exists customers_offered integer not null default 0,
  add column if not exists customers_accepted integer not null default 0,
  add column if not exists customers_delivered integer not null default 0,
  add column if not exists incremental_revenue numeric(12, 2) not null default 0,
  add column if not exists impact_level text check (impact_level in ('Low', 'Medium', 'High')),
  add column if not exists priority text check (priority in ('Low', 'Medium', 'High')),
  add column if not exists expected_impact text;

alter table public.sales_initiatives
  add constraint sales_initiatives_funnel_counts_nonnegative check (
    customers_offered >= 0 and customers_accepted >= 0 and customers_delivered >= 0 and incremental_revenue >= 0
  );

-- A manual tag on a learning ("Use & Scale," "Test More," ...) is how the
-- Initiatives page's cross-initiative "Initiative Learnings" panel labels
-- each card - simplest honest option since inferring sentiment from free
-- text isn't something to fabricate.
alter table public.sales_initiative_learnings
  add column if not exists tag text check (tag in ('Use & Scale', 'Test More', 'Adjust Approach', 'Keep Doing'));
