-- Zambia's Email Marketing (Bright, 15 Nov 2026): one email account for the
-- company (email_settings, one row per org), but each branch can send under
-- its own sender name / reply-to ("Protohub Zambia").
alter table public.email_marketing_settings add column if not exists from_name text;
alter table public.email_marketing_settings add column if not exists reply_to text;
-- The branch's customer WhatsApp number for emails ("WhatsApp us on …", add-to-delivery
-- buttons). Nigeria's 07083515972 stays the default for Nigeria; other branches use theirs.
alter table public.email_marketing_settings add column if not exists whatsapp text;
-- Bright's choice: Zambia sends as "Protohub Zambia" on the shared account.
insert into public.email_marketing_settings (branch_id, org_id, from_name)
select b.id, b.org_id, 'Protohub Zambia' from public.branches b where b.country_code = 'ZM'
on conflict (branch_id) do update set from_name = coalesce(public.email_marketing_settings.from_name, excluded.from_name);
