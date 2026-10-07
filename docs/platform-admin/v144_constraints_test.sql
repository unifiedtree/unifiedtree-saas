-- Behaviour tests for V144_101..V144_106. Runs against a DISPOSABLE database only.
-- Each check prints PASS or FAIL; the script never stops on an expected error.
\set ON_ERROR_STOP 0
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE results (n serial, check_name text, outcome text);

CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text, sqlstate_like text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE stmt;
        INSERT INTO results(check_name, outcome) VALUES (label, 'FAIL (no error)');
    EXCEPTION WHEN OTHERS THEN
        IF sqlstate_like IS NULL OR SQLSTATE LIKE sqlstate_like THEN
            INSERT INTO results(check_name, outcome) VALUES (label, 'PASS (' || SQLSTATE || ')');
        ELSE
            INSERT INTO results(check_name, outcome) VALUES (label, 'FAIL (wrong error ' || SQLSTATE || ': ' || SQLERRM || ')');
        END IF;
    END;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_ok(label text, stmt text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE stmt;
        INSERT INTO results(check_name, outcome) VALUES (label, 'PASS');
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO results(check_name, outcome) VALUES (label, 'FAIL (' || SQLSTATE || ': ' || SQLERRM || ')');
    END;
END $$;

-- Fixtures: workspace A with companies A1, A2; workspace B with company B1.
-- RLS on org.companies: this script runs as superuser, which bypasses it.
INSERT INTO platform.tenants (id, subdomain, display_name, status, plan_type)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'ws-a', 'Workspace A', 'ACTIVE', 'STARTER'),
       ('bbbbbbbb-0000-0000-0000-00000000000b', 'ws-b', 'Workspace B', 'ACTIVE', 'STARTER');
INSERT INTO org.companies (id, tenant_id, name)
VALUES ('a1a1a1a1-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'A1'),
       ('a2a2a2a2-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-00000000000a', 'A2'),
       ('b1b1b1b1-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-00000000000b', 'B1');
INSERT INTO platform.accounts (id, email, display_name, password_hash)
VALUES ('acc00000-0000-0000-0000-000000000001', 'person@example.test', 'Person', 'x');

-- V144_101 ---------------------------------------------------------------------
INSERT INTO results(check_name, outcome)
SELECT 'V144_101 PLATFORM_SUPER_ADMIN holds the 11 new platform permissions',
       CASE WHEN count(*) = 11 THEN 'PASS' ELSE 'FAIL (' || count(*) || ')' END
  FROM rbac.role_permissions
 WHERE role_id = '00000000-0000-0000-0000-000000000006'
   AND permission_code IN ('platform.company.read','platform.account.read','platform.catalog.read',
       'platform.catalog.manage','platform.subscription.read','platform.billing.read','platform.billing.manage',
       'platform.entitlement.manage','platform.marketing.read','platform.marketing.manage','platform.audit.read');
INSERT INTO results(check_name, outcome)
SELECT 'V144_101 no other role received a new platform permission',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL (' || count(*) || ')' END
  FROM rbac.role_permissions
 WHERE role_id <> '00000000-0000-0000-0000-000000000006'
   AND permission_code IN ('platform.company.read','platform.account.read','platform.catalog.manage',
       'platform.billing.manage','platform.entitlement.manage','platform.marketing.manage','platform.audit.read');
INSERT INTO results(check_name, outcome)
SELECT 'V144_101 new permissions are module=platform (OWNER invariant ignores them)',
       CASE WHEN bool_and(module = 'platform') THEN 'PASS' ELSE 'FAIL' END
  FROM rbac.permissions WHERE code LIKE 'platform.%';

-- V144_102 ---------------------------------------------------------------------
SELECT pg_temp.expect_ok('V144_102 company A1 gets Marketing (whatsapp) manually with a reason',
  $q$INSERT INTO platform.company_modules (tenant_id, company_id, module_key, source, reason, granted_by)
     VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','a1a1a1a1-0000-0000-0000-0000000000a1','whatsapp','MANUAL','Pilot customer for marketing','ops@test')$q$);
SELECT pg_temp.expect_error('V144_102 company B1 cannot be filed under workspace A (composite FK)',
  $q$INSERT INTO platform.company_modules (tenant_id, company_id, module_key, source, reason)
     VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','b1b1b1b1-0000-0000-0000-0000000000b1','whatsapp','MANUAL','wrong workspace test')$q$, '23503');
SELECT pg_temp.expect_error('V144_102 manual override without a reason is refused',
  $q$INSERT INTO platform.company_modules (tenant_id, company_id, module_key, source)
     VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','a2a2a2a2-0000-0000-0000-0000000000a2','whatsapp','MANUAL')$q$, '23514');
SELECT pg_temp.expect_error('V144_102 duplicate (company, module, source) is refused',
  $q$INSERT INTO platform.company_modules (tenant_id, company_id, module_key, source, reason)
     VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','a1a1a1a1-0000-0000-0000-0000000000a1','whatsapp','MANUAL','second manual row')$q$, '23505');
SELECT pg_temp.expect_ok('V144_102 subscription and trial rows coexist with the manual one',
  $q$INSERT INTO platform.company_modules (tenant_id, company_id, module_key, source, ends_at)
     VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','a1a1a1a1-0000-0000-0000-0000000000a1','whatsapp','TRIAL', now() + interval '7 days')$q$);
SELECT pg_temp.expect_error('V144_102 a period that ends before it starts is refused',
  $q$INSERT INTO platform.company_modules (tenant_id, company_id, module_key, source, starts_at, ends_at)
     VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','a2a2a2a2-0000-0000-0000-0000000000a2','whatsapp','TRIAL', now(), now() - interval '1 day')$q$, '23514');
SELECT pg_temp.expect_error('V144_102 company-level subscription must name its workspace',
  $q$INSERT INTO platform.subscriptions (id, tenant_id, company_id, plan_keys, current_period_end)
     VALUES (gen_random_uuid(), NULL, 'a1a1a1a1-0000-0000-0000-0000000000a1', ARRAY['marketing'], now() + interval '30 days')$q$, '23514');
SELECT pg_temp.expect_error('V144_102 subscription cannot point at another workspace''s company',
  $q$INSERT INTO platform.subscriptions (id, tenant_id, company_id, plan_keys, current_period_end)
     VALUES (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-00000000000a', 'b1b1b1b1-0000-0000-0000-0000000000b1', ARRAY['marketing'], now() + interval '30 days')$q$, '23503');
SELECT pg_temp.expect_ok('V144_102 existing-style workspace subscription (company_id NULL) still works',
  $q$INSERT INTO platform.subscriptions (id, tenant_id, plan_keys, current_period_end)
     VALUES ('5a5a0000-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-00000000000a', ARRAY['hr-employees'], now() + interval '30 days')$q$);
INSERT INTO results(check_name, outcome)
SELECT 'V144_102 tenant_modules.seats exists (fresh-database drift fixed)',
       CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
  FROM information_schema.columns WHERE table_schema='platform' AND table_name='tenant_modules' AND column_name='seats';

-- V144_103 ---------------------------------------------------------------------
INSERT INTO results(check_name, outcome)
SELECT 'V144_103 every plan has exactly one open (current) price',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL (' || count(*) || ' plans wrong)' END
  FROM platform.module_plans p
 WHERE (SELECT count(*) FROM platform.module_plan_prices v WHERE v.plan_key = p.key AND v.valid_to IS NULL) <> 1;
INSERT INTO results(check_name, outcome)
SELECT 'V144_103 seeded current price equals module_plans.price_inr',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL (' || count(*) || ')' END
  FROM platform.module_plans p JOIN platform.module_plan_prices v ON v.plan_key = p.key AND v.valid_to IS NULL
 WHERE v.unit_price <> p.price_inr OR v.price_model <> p.price_model;
SELECT pg_temp.expect_error('V144_103 a second open price for the same plan is refused',
  $q$INSERT INTO platform.module_plan_prices (plan_key, unit_price, price_model, valid_from)
     SELECT key, 1, 'PER_SEAT', now() FROM platform.module_plans LIMIT 1$q$, '23505');
SELECT pg_temp.expect_error('V144_103 negative price is refused',
  $q$INSERT INTO platform.module_plan_prices (plan_key, unit_price, price_model, valid_from, valid_to)
     SELECT key, -5, 'PER_SEAT', now() - interval '2 days', now() - interval '1 day' FROM platform.module_plans LIMIT 1$q$, '23514');

-- V144_104 ---------------------------------------------------------------------
SELECT pg_temp.expect_error('V144_104 malformed GSTIN is refused',
  $q$INSERT INTO platform.company_billing_profiles (company_id, tenant_id, gstin)
     VALUES ('a1a1a1a1-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','not-a-gstin')$q$, '23514');
SELECT pg_temp.expect_ok('V144_104 valid billing profile for A1',
  $q$INSERT INTO platform.company_billing_profiles (company_id, tenant_id, legal_name, gstin, pan, billing_email, state_code)
     VALUES ('a1a1a1a1-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','A One Pvt Ltd','29ABCDE1234F1Z5','ABCDE1234F','billing@a1.test','29')$q$);
SELECT pg_temp.expect_error('V144_104 billing profile cannot attach a company to the wrong workspace',
  $q$INSERT INTO platform.company_billing_profiles (company_id, tenant_id)
     VALUES ('b1b1b1b1-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-00000000000a')$q$, '23503');
SELECT pg_temp.expect_ok('V144_104 draft invoice with a line',
  $q$WITH i AS (INSERT INTO platform.invoices (id, tenant_id, company_id, status, subtotal, tax_total, total)
                VALUES ('11110000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a',
                        'a1a1a1a1-0000-0000-0000-0000000000a1','DRAFT',1000,180,1180) RETURNING id)
     INSERT INTO platform.invoice_lines (invoice_id, line_no, description, quantity, unit_price, tax_rate_pct, tax_amount, amount)
     SELECT id, 1, 'Marketing Automation - October', 1, 1000, 18, 180, 1180 FROM i$q$);
SELECT pg_temp.expect_error('V144_104 total must equal subtotal - discount + tax',
  $q$INSERT INTO platform.invoices (tenant_id, status, subtotal, tax_total, total)
     VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','DRAFT',100,18,999)$q$, '23514');
SELECT pg_temp.expect_error('V144_104 issuing without number/date/snapshot is refused',
  $q$UPDATE platform.invoices SET status='ISSUED' WHERE id='11110000-0000-0000-0000-000000000001'$q$, '23514');
SELECT pg_temp.expect_ok('V144_104 issue the invoice properly',
  $q$UPDATE platform.invoices SET status='ISSUED', invoice_number='UT/26-27/00001', issued_at=now(),
            billing_snapshot='{"legal_name":"A One Pvt Ltd"}'::jsonb WHERE id='11110000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_error('V144_104 issued invoice amount cannot be edited (trigger)',
  $q$UPDATE platform.invoices SET subtotal=1, total=181 WHERE id='11110000-0000-0000-0000-000000000001'$q$, '23514');
SELECT pg_temp.expect_error('V144_104 issued invoice snapshot cannot be edited (trigger)',
  $q$UPDATE platform.invoices SET billing_snapshot='{"legal_name":"Changed"}'::jsonb WHERE id='11110000-0000-0000-0000-000000000001'$q$, '23514');
SELECT pg_temp.expect_error('V144_104 issued invoice cannot go back to draft',
  $q$UPDATE platform.invoices SET status='DRAFT' WHERE id='11110000-0000-0000-0000-000000000001'$q$, '23514');
SELECT pg_temp.expect_error('V144_104 lines of an issued invoice are frozen (trigger)',
  $q$UPDATE platform.invoice_lines SET amount=1 WHERE invoice_id='11110000-0000-0000-0000-000000000001'$q$, '23514');
SELECT pg_temp.expect_error('V144_104 cannot add a line to an issued invoice (trigger)',
  $q$INSERT INTO platform.invoice_lines (invoice_id, line_no, description, unit_price, amount)
     VALUES ('11110000-0000-0000-0000-000000000001', 2, 'sneaky', 1, 1)$q$, '23514');
SELECT pg_temp.expect_ok('V144_104 marking it paid is allowed (only payment fields change)',
  $q$UPDATE platform.invoices SET status='PAID', amount_paid=1180, paid_at=now() WHERE id='11110000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_error('V144_104 voiding needs a reason',
  $q$UPDATE platform.invoices SET status='VOID', voided_at=now() WHERE id='11110000-0000-0000-0000-000000000001'$q$, '23514');
SELECT pg_temp.expect_ok('V144_104 void with a reason',
  $q$UPDATE platform.invoices SET status='VOID', voided_at=now(), void_reason='Issued to wrong company' WHERE id='11110000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_error('V144_104 a void invoice cannot be reopened',
  $q$UPDATE platform.invoices SET status='PAID' WHERE id='11110000-0000-0000-0000-000000000001'$q$, '23514');
INSERT INTO results(check_name, outcome)
SELECT 'V144_104 no payment_methods table (how a workspace pays lives on platform.subscriptions)',
       CASE WHEN to_regclass('platform.payment_methods') IS NULL THEN 'PASS' ELSE 'FAIL' END;
INSERT INTO results(check_name, outcome)
SELECT 'V144_104 invoices carry no unused provider/pdf columns',
       CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'platform'
                              AND table_name = 'invoices'
                              AND column_name IN ('provider', 'provider_invoice_id', 'provider_payment_id', 'pdf_storage_key'))
            THEN 'PASS' ELSE 'FAIL' END;
SELECT pg_temp.expect_ok('V144_104 a draft to discard',
  $q$INSERT INTO platform.invoices (id, tenant_id, status, subtotal, tax_total, total)
     VALUES ('11110000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','DRAFT',100,18,118)$q$);
SELECT pg_temp.expect_ok('V144_104 a wrong draft is DISCARDED with a reason (no number)',
  $q$UPDATE platform.invoices SET status='DISCARDED', voided_at=now(), void_reason='Drafted from the wrong payment'
      WHERE id='11110000-0000-0000-0000-000000000002'$q$);
INSERT INTO results(check_name, outcome)
SELECT 'V144_104 the discard really happened',
       CASE WHEN status = 'DISCARDED' THEN 'PASS' ELSE 'FAIL (' || status || ')' END
  FROM platform.invoices WHERE id = '11110000-0000-0000-0000-000000000002';
SELECT pg_temp.expect_error('V144_104 a discarded draft cannot be issued (trigger)',
  $q$UPDATE platform.invoices SET status='ISSUED', invoice_number='UT/26-27/09999', issued_at=now(),
            billing_snapshot='{}'::jsonb WHERE id='11110000-0000-0000-0000-000000000002'$q$, '23514');
SELECT pg_temp.expect_error('V144_104 discarding needs a reason',
  $q$INSERT INTO platform.invoices (tenant_id, status, voided_at) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','DISCARDED', now())$q$, '23514');
SELECT pg_temp.expect_error('V144_104 invoice prefix longer than 4 characters is refused (GST 16-char numbers)',
  $q$UPDATE platform.billing_settings SET invoice_prefix='UTREE' WHERE id = 1$q$, '23514');

-- V144_105 ---------------------------------------------------------------------
INSERT INTO results(check_name, outcome)
SELECT 'V144_105 plan marketing now includes module whatsapp',
       CASE WHEN included_modules = ARRAY['whatsapp']::text[] THEN 'PASS' ELSE 'FAIL (' || included_modules::text || ')' END
  FROM platform.module_plans WHERE key = 'marketing'
UNION ALL
SELECT 'V144_105 plan marketing exists in this database', 'SKIP (fresh DB has no marketing plan)'
 WHERE NOT EXISTS (SELECT 1 FROM platform.module_plans WHERE key = 'marketing');
SELECT pg_temp.expect_ok('V144_105 map company A1 to a Marketing owner principal',
  $q$INSERT INTO platform.marketing_identity_map (kind, legacy_marketing_user_id, tenant_id, company_id, status, source, mapped_at)
     VALUES ('COMPANY_OWNER','65a1b2c3d4e5f60718293a4b','aaaaaaaa-0000-0000-0000-00000000000a','a1a1a1a1-0000-0000-0000-0000000000a1','MAPPED','SSO',now())$q$);
SELECT pg_temp.expect_error('V144_105 a second owner principal for the same company is refused',
  $q$INSERT INTO platform.marketing_identity_map (kind, legacy_marketing_user_id, tenant_id, company_id, status, source)
     VALUES ('COMPANY_OWNER','65a1b2c3d4e5f60718293a4c','aaaaaaaa-0000-0000-0000-00000000000a','a1a1a1a1-0000-0000-0000-0000000000a1','MAPPED','SSO')$q$, '23505');
SELECT pg_temp.expect_error('V144_105 a non-ObjectId Mongo id is refused',
  $q$INSERT INTO platform.marketing_identity_map (kind, legacy_marketing_user_id, status, source)
     VALUES ('LEGACY_USER','not-an-object-id','PENDING','BACKFILL')$q$, '23514');
SELECT pg_temp.expect_error('V144_105 quarantine needs a reason (never a silent guess)',
  $q$INSERT INTO platform.marketing_identity_map (kind, legacy_marketing_user_id, status, source)
     VALUES ('LEGACY_USER','65a1b2c3d4e5f60718293a4d','QUARANTINED','BACKFILL')$q$, '23514');
SELECT pg_temp.expect_error('V144_105 MAPPED member without an account is refused',
  $q$INSERT INTO platform.marketing_identity_map (kind, legacy_marketing_user_id, tenant_id, company_id, status, source)
     VALUES ('MEMBER','65a1b2c3d4e5f60718293a4e','aaaaaaaa-0000-0000-0000-00000000000a','a1a1a1a1-0000-0000-0000-0000000000a1','MAPPED','SSO')$q$, '23514');
SELECT pg_temp.expect_ok('V144_105 60-second SSO ticket',
  $q$INSERT INTO platform.sso_handoff_tickets (ticket_hash, audience, account_id, tenant_id, company_id, auth_user_id, expires_at)
     VALUES (repeat('a',64),'marketing','acc00000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a',
             'a1a1a1a1-0000-0000-0000-0000000000a1',gen_random_uuid(), now() + interval '60 seconds')$q$);
SELECT pg_temp.expect_error('V144_105 a ticket living longer than 5 minutes is refused',
  $q$INSERT INTO platform.sso_handoff_tickets (ticket_hash, audience, account_id, tenant_id, company_id, auth_user_id, expires_at)
     VALUES (repeat('b',64),'marketing','acc00000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a',
             'a1a1a1a1-0000-0000-0000-0000000000a1',gen_random_uuid(), now() + interval '1 hour')$q$, '23514');
SELECT pg_temp.expect_error('V144_105 a ticket for another workspace''s company is refused',
  $q$INSERT INTO platform.sso_handoff_tickets (ticket_hash, audience, account_id, tenant_id, company_id, auth_user_id, expires_at)
     VALUES (repeat('c',64),'marketing','acc00000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a',
             'b1b1b1b1-0000-0000-0000-0000000000b1',gen_random_uuid(), now() + interval '60 seconds')$q$, '23503');
SELECT pg_temp.expect_error('V144_105 only a hex SHA-256 can be stored, never a raw ticket',
  $q$INSERT INTO platform.sso_handoff_tickets (ticket_hash, audience, account_id, tenant_id, company_id, auth_user_id, expires_at)
     VALUES ('raw-ticket-value-raw-ticket-value-raw-ticket-value-raw-tickets!','marketing','acc00000-0000-0000-0000-000000000001',
             'aaaaaaaa-0000-0000-0000-00000000000a','a1a1a1a1-0000-0000-0000-0000000000a1',gen_random_uuid(), now() + interval '60 seconds')$q$, '23514');

-- V144_106 ---------------------------------------------------------------------
INSERT INTO results(check_name, outcome)
SELECT 'V144_106 rate cards ship empty (no invented Meta prices)',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL (' || count(*) || ')' END FROM platform.provider_rate_cards;
INSERT INTO results(check_name, outcome)
SELECT 'V144_106 pooled billing switch is OFF',
       CASE WHEN bool_and(NOT marketing_pooled_billing_enabled) THEN 'PASS' ELSE 'FAIL' END FROM platform.billing_settings;
SELECT pg_temp.expect_ok('V144_106 map a WABA to company A1 (defaults to DIRECT_CUSTOMER)',
  $q$INSERT INTO platform.marketing_channel_accounts (tenant_id, company_id, waba_id)
     VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','a1a1a1a1-0000-0000-0000-0000000000a1','1234567890')$q$);
INSERT INTO results(check_name, outcome)
SELECT 'V144_106 new channel account defaults to DIRECT_CUSTOMER',
       CASE WHEN billing_mode = 'DIRECT_CUSTOMER' THEN 'PASS' ELSE 'FAIL' END
  FROM platform.marketing_channel_accounts WHERE waba_id = '1234567890';
SELECT pg_temp.expect_error('V144_106 the same WABA cannot belong to two companies',
  $q$INSERT INTO platform.marketing_channel_accounts (tenant_id, company_id, waba_id)
     VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','a2a2a2a2-0000-0000-0000-0000000000a2','1234567890')$q$, '23505');
SELECT pg_temp.expect_error('V144_106 a rate card must cite where its price came from',
  $q$INSERT INTO platform.provider_rate_cards (provider, category, market, currency, provider_unit_cost, valid_from, source_note)
     VALUES ('META_WHATSAPP','MARKETING','IN','INR',0.5,now(),'x')$q$, '23514');
SELECT pg_temp.expect_ok('V144_106 record a usage event',
  $q$INSERT INTO platform.usage_ledger (idempotency_key, tenant_id, company_id, provider, usage_type, occurred_at)
     VALUES ('meta:wamid.1:conversation','aaaaaaaa-0000-0000-0000-00000000000a','a1a1a1a1-0000-0000-0000-0000000000a1','META_WHATSAPP','CONVERSATION',now())$q$);
SELECT pg_temp.expect_error('V144_106 the same provider event cannot be recorded twice (idempotency)',
  $q$INSERT INTO platform.usage_ledger (idempotency_key, tenant_id, company_id, provider, usage_type, occurred_at)
     VALUES ('meta:wamid.1:conversation','aaaaaaaa-0000-0000-0000-00000000000a','a1a1a1a1-0000-0000-0000-0000000000a1','META_WHATSAPP','CONVERSATION',now())$q$, '23505');
SELECT pg_temp.expect_error('V144_106 a row cannot be RATED without a rate card and cost',
  $q$UPDATE platform.usage_ledger SET status='RATED' WHERE idempotency_key='meta:wamid.1:conversation'$q$, '23514');
SELECT pg_temp.expect_error('V144_106 usage cannot be filed against another workspace''s company',
  $q$INSERT INTO platform.usage_ledger (idempotency_key, tenant_id, company_id, provider, usage_type, occurred_at)
     VALUES ('meta:wamid.2:conversation','aaaaaaaa-0000-0000-0000-00000000000a','b1b1b1b1-0000-0000-0000-0000000000b1','META_WHATSAPP','CONVERSATION',now())$q$, '23503');

\echo
SELECT n, outcome, check_name FROM results ORDER BY n;
SELECT count(*) FILTER (WHERE outcome LIKE 'PASS%') AS pass,
       count(*) FILTER (WHERE outcome LIKE 'FAIL%') AS fail,
       count(*) FILTER (WHERE outcome LIKE 'SKIP%') AS skip
  FROM results;
ROLLBACK;
