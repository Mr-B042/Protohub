-- Line up prod's migration history with this folder (1 Oct 2026).
-- Migrations 258-273 had been recorded on prod under timestamp versions by the
-- Supabase MCP tool; this renames them to their file numbers. 266 and 267 are
-- recorded as done WITHOUT running: prod already has the newer 13-rule upgrade
-- bonus tables, and running them would bring back the old ones.
-- Only touches the history table. On a database that is already numbered
-- (local), both statements change nothing.

update supabase_migrations.schema_migrations m set version = v.num
from (values
 ('20260913090157','258','branch_child_records'),
 ('20260913093145','259','branch_money'),
 ('20260913094203','260','branch_people_and_messaging'),
 ('20260913095704','261','branch_catalogue'),
 ('20260913101438','262','branch_weekly_cash_functions'),
 ('20260913104011','263','branch_inventory_valuation_function'),
 ('20260913105150','264','drop_org_keyed_weekly_uniqueness'),
 ('20260918015908','265','cart_assignment_settings'),
 ('20260930160218','268','cart_assignment_close_5pm'),
 ('20261001050654','269','weekly_report_approvals'),
 ('20261001062118','270','weekly_bonus_queries'),
 ('20261001140505','271','manager_funds'),
 ('20261001151601','272','log_miss_disputes'),
 ('20261001153848','273','cycle_aware_delivered_stock_movement_ids')
) as v(ts, num, nm)
where m.version = v.ts and m.name = v.nm;

insert into supabase_migrations.schema_migrations (version, name, statements) values
 ('266','upgrade_bonus_ladder_2800', array['-- recorded only; superseded, never run']),
 ('267','correct_upgrade_bonus_calculation', array['-- recorded only; superseded, never run'])
on conflict (version) do nothing;
