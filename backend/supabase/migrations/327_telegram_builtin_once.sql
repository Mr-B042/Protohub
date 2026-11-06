-- Telegram: each ready-made automation once per organisation (Bright, 6 Nov
-- 2026). The Overview and the Automations tab both added missing ready-made
-- automations on page load at the same moment, so Order Assigned, Cart
-- Assigned and the Weekly Late & Fines Note were added twice. Keep the copy
-- edited last (both copies were identical), then make a second copy impossible.

delete from public.telegram_automations a
 using public.telegram_automations b
 where a.built_in and b.built_in
   and a.org_id = b.org_id and a.trigger = b.trigger
   and (a.updated_at, a.id) < (b.updated_at, b.id);

create unique index if not exists telegram_automations_builtin_once
  on public.telegram_automations (org_id, trigger) where built_in;
