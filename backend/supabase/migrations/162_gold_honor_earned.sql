-- Migration 162: persist "ever qualified for the delivery-rate pay boost" per rep
-- Backs the Gold Tier honor badge staying visible as a permanent achievement
-- once a Sales Rep first hits the delivery_rate_per_delivered rule, even in
-- weeks they don't maintain it - only the "N per Order Unlocked" + countdown
-- part is live/weekly, per Bright's design.

alter table users add column if not exists gold_honor_earned boolean not null default false;
