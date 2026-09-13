-- Separate the last of the operational tables: people, targets, bonuses,
-- retention, the delivery-agent family, and messaging.
--
-- Seventy-two tables. Every one of them has an org_id and every existing row
-- was created in Nigeria Operations - the other three branches were seeded
-- empty in migration 256 and have never traded - so the backfill is a straight
-- fill and provable rather than a guess. The row counts prove it: nothing in
-- here is older than the branch that owns it.
--
-- ⚠️ THE TRIGGER IS WHERE THE REAL WORK IS, not the backfill. From now on a
-- retention touchpoint reads its branch from the order it is about, and a
-- delivery agent's KYC, fees and remittances read theirs from the agent. That
-- matters the moment Accra signs its first agent: without it, that agent's
-- paperwork would default to Nigeria and the record would sit in the wrong
-- country's file.
--
-- ⚠️ personal_delivery_agents IS NOT agents. The pda_* tables' agent_id points
-- at the personal delivery agent, a separate module from the state agents that
-- migration 258 dealt with. Joining the wrong one would file a Lagos rider's
-- documents under whichever state agent happened to share the id.

-- ── 1. The column ───────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    -- people, targets, bonuses
    'sales_teams','sales_leads','sales_bonus_programs','sales_bonus_rules',
    'sales_closer_bonus_settings','sales_closer_bonus_monthly_records','manager_bonus_settings',
    'manager_product_challenges','manager_product_challenge_allocations','manager_activity_logs',
    'head_of_sales_settings','head_of_sales_weekly_reports','head_of_sales_bonus_weekly_records',
    'rep_weekly_targets','rep_coaching_plans','rep_coaching_action_items','target_periods',
    'daily_target_snapshots','incentive_rules','upsell_bonus_settings','sales_expansion_settings',
    'sales_expansion_compliance_waivers','recovery_rep_kpi_settings','recovery_templates',
    'sales_initiatives','sales_initiative_learnings',
    -- retention
    'customer_retention_touchpoints','customer_retention_action_events','customer_retention_tasks',
    'customer_retention_referrals','customer_retention_bonus_settings',
    -- marketing
    'marketing_spend_records','marketing_link_variants',
    -- personal delivery agents
    'personal_delivery_agents','pda_agent_stock','pda_agreement_acceptances','pda_application_links',
    'pda_blocked_applicants','pda_cod_discrepancies','pda_documents','pda_earning_payouts',
    'pda_fee_negotiations','pda_fee_rules','pda_guarantors','pda_incidents','pda_inventory_baselines',
    'pda_kyc_items','pda_notes','pda_order_assignments','pda_remittance_allocations','pda_remittances',
    'pda_reports','pda_settings','pda_stock_discrepancies','pda_stock_ledger','pda_stock_transfers',
    -- messaging and the settings that drive it
    'system_notifications','short_links',
    'sms_messages','sms_inbound_messages','sms_opt_outs','sms_settings',
    'email_messages','email_settings',
    'whatsapp_messages','whatsapp_inbox_messages','whatsapp_opt_outs','whatsapp_settings',
    'whatsapp_user_accounts','whatsapp_user_destinations',
    'embed_settings','meta_capi_configs'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists branch_id uuid references public.branches(id) on delete restrict',
      t);
    execute format('create index if not exists %I on public.%I (branch_id)', t || '_branch_idx', t);
  end loop;
end $$;

-- ── 2. Inherit where a parent already knows the answer ──────────────────────
-- Done before the fill below, so a real answer always beats the default.
update public.customer_retention_touchpoints c set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;
update public.customer_retention_action_events c set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;
update public.customer_retention_tasks c        set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;
update public.manager_activity_logs c           set branch_id = o.branch_id from public.orders o where o.id = c.order_id and c.branch_id is null;

update public.personal_delivery_agents p set branch_id = b.id from public.branches b
  where p.branch_id is null and b.org_id = p.org_id and b.name = 'Nigeria Operations' and b.active;

-- The rider's own paperwork follows the rider.
do $$
declare t text;
begin
  foreach t in array array[
    'pda_agent_stock','pda_agreement_acceptances','pda_blocked_applicants','pda_cod_discrepancies',
    'pda_documents','pda_earning_payouts','pda_fee_negotiations','pda_guarantors','pda_incidents',
    'pda_inventory_baselines','pda_kyc_items','pda_notes','pda_order_assignments','pda_remittances',
    'pda_stock_discrepancies','pda_stock_ledger','pda_stock_transfers'
  ]
  loop
    execute format($f$
      update public.%I c set branch_id = p.branch_id
      from public.personal_delivery_agents p
      where p.id = c.agent_id and c.branch_id is null
    $f$, t);
  end loop;
end $$;

update public.pda_remittance_allocations a set branch_id = r.branch_id from public.pda_remittances r where r.id = a.remittance_id and a.branch_id is null;
update public.sales_bonus_rules r set branch_id = p.branch_id from public.sales_bonus_programs p where p.id = r.program_id and r.branch_id is null;
update public.sales_initiative_learnings l set branch_id = i.branch_id from public.sales_initiatives i where i.id = l.initiative_id and l.branch_id is null;
update public.rep_coaching_action_items a set branch_id = p.branch_id from public.rep_coaching_plans p where p.id = a.coaching_plan_id and a.branch_id is null;
update public.manager_product_challenge_allocations a set branch_id = c.branch_id from public.manager_product_challenges c where c.id = a.challenge_id and a.branch_id is null;

-- ── 3. Everything else was created in Nigeria ───────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'sales_teams','sales_leads','sales_bonus_programs','sales_bonus_rules',
    'sales_closer_bonus_settings','sales_closer_bonus_monthly_records','manager_bonus_settings',
    'manager_product_challenges','manager_product_challenge_allocations','manager_activity_logs',
    'head_of_sales_settings','head_of_sales_weekly_reports','head_of_sales_bonus_weekly_records',
    'rep_weekly_targets','rep_coaching_plans','rep_coaching_action_items','target_periods',
    'daily_target_snapshots','incentive_rules','upsell_bonus_settings','sales_expansion_settings',
    'sales_expansion_compliance_waivers','recovery_rep_kpi_settings','recovery_templates',
    'sales_initiatives','sales_initiative_learnings',
    'customer_retention_touchpoints','customer_retention_action_events','customer_retention_tasks',
    'customer_retention_referrals','customer_retention_bonus_settings',
    'marketing_spend_records','marketing_link_variants',
    'pda_agent_stock','pda_agreement_acceptances','pda_application_links',
    'pda_blocked_applicants','pda_cod_discrepancies','pda_documents','pda_earning_payouts',
    'pda_fee_negotiations','pda_fee_rules','pda_guarantors','pda_incidents','pda_inventory_baselines',
    'pda_kyc_items','pda_notes','pda_order_assignments','pda_remittance_allocations','pda_remittances',
    'pda_reports','pda_settings','pda_stock_discrepancies','pda_stock_ledger','pda_stock_transfers',
    'system_notifications','short_links',
    'sms_messages','sms_inbound_messages','sms_opt_outs','sms_settings',
    'email_messages','email_settings',
    'whatsapp_messages','whatsapp_inbox_messages','whatsapp_opt_outs','whatsapp_settings',
    'whatsapp_user_accounts','whatsapp_user_destinations',
    'embed_settings','meta_capi_configs'
  ]
  loop
    execute format($f$
      update public.%I t set branch_id = b.id
      from public.branches b
      where t.branch_id is null and b.org_id = t.org_id
        and b.name = 'Nigeria Operations' and b.active
    $f$, t);
  end loop;
end $$;

-- ── 4. Nothing new arrives without a branch ─────────────────────────────────
create or replace function public.assign_people_branch_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_branch uuid;
begin
  if new.branch_id is not null then return new; end if;

  begin
    case tg_table_name
      when 'customer_retention_touchpoints','customer_retention_action_events',
           'customer_retention_tasks','manager_activity_logs' then
        select o.branch_id into v_branch from public.orders o where o.id = new.order_id;
      -- ⚠️ personal_delivery_agents, NOT agents. Different module, different ids.
      when 'pda_agent_stock','pda_agreement_acceptances','pda_blocked_applicants',
           'pda_cod_discrepancies','pda_documents','pda_earning_payouts','pda_fee_negotiations',
           'pda_guarantors','pda_incidents','pda_inventory_baselines','pda_kyc_items','pda_notes',
           'pda_order_assignments','pda_remittances','pda_stock_discrepancies','pda_stock_ledger',
           'pda_stock_transfers' then
        select p.branch_id into v_branch from public.personal_delivery_agents p where p.id = new.agent_id;
      when 'pda_remittance_allocations' then
        select r.branch_id into v_branch from public.pda_remittances r where r.id = new.remittance_id;
      when 'sales_bonus_rules' then
        select p.branch_id into v_branch from public.sales_bonus_programs p where p.id = new.program_id;
      when 'sales_initiative_learnings' then
        select i.branch_id into v_branch from public.sales_initiatives i where i.id = new.initiative_id;
      when 'rep_coaching_action_items' then
        select p.branch_id into v_branch from public.rep_coaching_plans p where p.id = new.coaching_plan_id;
      when 'manager_product_challenge_allocations' then
        select c.branch_id into v_branch from public.manager_product_challenges c where c.id = new.challenge_id;
      else
        v_branch := null;
    end case;
  exception when others then
    v_branch := null;
  end;

  if v_branch is null then
    begin
      select b.id into v_branch from public.branches b
      where b.org_id = new.org_id and b.name = 'Nigeria Operations' and b.active
      order by b.created_at limit 1;
    exception when others then
      v_branch := null;
    end;
  end if;

  new.branch_id := v_branch;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'sales_teams','sales_leads','sales_bonus_programs','sales_bonus_rules',
    'sales_closer_bonus_settings','sales_closer_bonus_monthly_records','manager_bonus_settings',
    'manager_product_challenges','manager_product_challenge_allocations','manager_activity_logs',
    'head_of_sales_settings','head_of_sales_weekly_reports','head_of_sales_bonus_weekly_records',
    'rep_weekly_targets','rep_coaching_plans','rep_coaching_action_items','target_periods',
    'daily_target_snapshots','incentive_rules','upsell_bonus_settings','sales_expansion_settings',
    'sales_expansion_compliance_waivers','recovery_rep_kpi_settings','recovery_templates',
    'sales_initiatives','sales_initiative_learnings',
    'customer_retention_touchpoints','customer_retention_action_events','customer_retention_tasks',
    'customer_retention_referrals','customer_retention_bonus_settings',
    'marketing_spend_records','marketing_link_variants',
    'personal_delivery_agents','pda_agent_stock','pda_agreement_acceptances','pda_application_links',
    'pda_blocked_applicants','pda_cod_discrepancies','pda_documents','pda_earning_payouts',
    'pda_fee_negotiations','pda_fee_rules','pda_guarantors','pda_incidents','pda_inventory_baselines',
    'pda_kyc_items','pda_notes','pda_order_assignments','pda_remittance_allocations','pda_remittances',
    'pda_reports','pda_settings','pda_stock_discrepancies','pda_stock_ledger','pda_stock_transfers',
    'system_notifications','short_links',
    'sms_messages','sms_inbound_messages','sms_opt_outs','sms_settings',
    'email_messages','email_settings',
    'whatsapp_messages','whatsapp_inbox_messages','whatsapp_opt_outs','whatsapp_settings',
    'whatsapp_user_accounts','whatsapp_user_destinations',
    'embed_settings','meta_capi_configs'
  ]
  loop
    execute format('drop trigger if exists trg_assign_people_branch on public.%I', t);
    execute format(
      'create trigger trg_assign_people_branch before insert on public.%I for each row execute function public.assign_people_branch_id()',
      t);
  end loop;
end $$;
