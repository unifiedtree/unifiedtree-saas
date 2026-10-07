-- Behaviour tests for V144_101..V144_107. Runs against a DISPOSABLE database only:
--   psql -X -d <disposable db> -c "SET ut.disposable = 'yes'" -f v144_constraints_test.sql
-- Two passes inside one transaction that is rolled back: the checks as the migration owner, then the
-- application's own role (ut_app: no BYPASSRLS, no DELETE on most platform tables) with a workspace bound.
-- Each check prints PASS or FAIL; the script never stops on an expected error.

-- Guard: stop BEFORE writing anything unless this is a throwaway database. It needs the explicit
-- opt-in above, and refuses any database holding a workspace created more than a day ago (real tenants;
-- a fresh migrate + seed + fixtures database has none), or one named like production.
\set ON_ERROR_STOP 1
DO $guard$
BEGIN
    IF current_setting('ut.disposable', true) IS DISTINCT FROM 'yes' THEN
        RAISE EXCEPTION 'Refusing to run: not marked disposable (psql -c "SET ut.disposable = ''yes''" -f ...)';
    END IF;
    IF current_database() IN ('railway', 'postgres', 'unifiedtree', 'hrms') THEN
        RAISE EXCEPTION 'Refusing to run on database %', current_database();
    END IF;
    IF EXISTS (SELECT 1 FROM platform.tenants
                WHERE created_at < now() - interval '1 day'
                  AND id <> '00000000-0000-0000-0000-000000000000') THEN
        RAISE EXCEPTION 'Refusing to run: this database has real workspaces (created before yesterday)';
    END IF;
END $guard$;
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

-- Runs stmt as the application role with app.tenant_id bound (what TenantAwareDataSource does), then
-- records the outcome as the owner. expect = 'ok' or a SQLSTATE pattern.
CREATE OR REPLACE FUNCTION pg_temp.as_app(label text, tenant uuid, stmt text, expect text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE outcome text;
BEGIN
    BEGIN
        SET LOCAL ROLE ut_app;
        PERFORM set_config('app.tenant_id', tenant::text, true);
        EXECUTE stmt;
        outcome := CASE WHEN expect = 'ok' THEN 'PASS' ELSE 'FAIL (no error)' END;
        RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
        outcome := CASE WHEN expect <> 'ok' AND SQLSTATE LIKE expect THEN 'PASS (' || SQLSTATE || ')'
                        ELSE 'FAIL (' || SQLSTATE || ': ' || SQLERRM || ')' END;
    END;
    RESET ROLE;
    PERFORM set_config('app.tenant_id', '', true);
    INSERT INTO results(check_name, outcome) VALUES ('[ut_app] ' || label, outcome);
END $$;

-- Fixtures: workspace A with companies A1, A2; workspace B with company B1.
-- RLS on org.companies: this script runs as superuser, which bypasses it.
INSERT INTO platform.tenants (id, subdomain, display_name, status, plan_type)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'ws-a', 'Workspace A', 'ACTIVE', 'STARTER'),
       ('bbbbbbbb-0000-0000-0000-00000000000b', 'ws-b', 'Workspace B', 'ACTIVE', 'STARTER')
ON CONFLICT DO NOTHING;   -- B and B1 may already exist (the e2e fixtures use the same ids)
INSERT INTO org.companies (id, tenant_id, name)
VALUES ('a1a1a1a1-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'A1'),
       ('a2a2a2a2-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-00000000000a', 'A2'),
       ('b1b1b1b1-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-00000000000b', 'B1')
ON CONFLICT DO NOTHING;
INSERT INTO platform.accounts (id, email, display_name, password_hash)
VALUES ('acc00000-0000-0000-0000-000000000001', 'person@example.test', 'Person', 'x')
ON CONFLICT DO NOTHING;
INSERT INTO platform.accounts (id, email, display_name, password_hash)
VALUES ('acc00000-0000-0000-0000-0000000000c9', 'mapped-person@example.test', 'Mapped person', 'x');

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
SELECT pg_temp.expect_ok('V144_102 a company-level subscription for A2',
  $q$INSERT INTO platform.subscriptions (id, tenant_id, company_id, plan_keys, current_period_end)
     VALUES ('5a5a0000-0000-0000-0000-000000000002'::uuid, 'aaaaaaaa-0000-0000-0000-00000000000a',
             'a2a2a2a2-0000-0000-0000-0000000000a2', ARRAY['marketing'], now() + interval '30 days')$q$);
SELECT pg_temp.expect_error('V144_102 deleting a company with a company-level subscription is refused (not SET NULL: NULL = whole business)',
  $q$DELETE FROM org.companies WHERE id = 'a2a2a2a2-0000-0000-0000-0000000000a2'$q$, '23001');
SELECT pg_temp.expect_error('V144_102 deleting a company with entitlement rows is refused (RESTRICT)',
  $q$DELETE FROM org.companies WHERE id = 'a1a1a1a1-0000-0000-0000-0000000000a1'$q$, '23001');
SELECT pg_temp.expect_error('V144_102 deleting a workspace with entitlement rows is refused (RESTRICT)',
  $q$DELETE FROM platform.tenants WHERE id = 'aaaaaaaa-0000-0000-0000-00000000000a'$q$, '23001');
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
INSERT INTO results(check_name, outcome)
SELECT 'V144_104 billing profile holds no legal name / GSTIN / PAN (org.companies owns them)',
       CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'platform'
                              AND table_name = 'company_billing_profiles' AND column_name IN ('legal_name', 'gstin', 'pan'))
            THEN 'PASS' ELSE 'FAIL' END;
SELECT pg_temp.expect_error('V144_104 a state code is two digits',
  $q$INSERT INTO platform.company_billing_profiles (company_id, tenant_id, state_code)
     VALUES ('a1a1a1a1-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','KA')$q$, '23514');
SELECT pg_temp.expect_ok('V144_104 valid billing profile for A1',
  $q$INSERT INTO platform.company_billing_profiles (company_id, tenant_id, billing_email, state_code, address_line1, city)
     VALUES ('a1a1a1a1-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','billing@a1.test','29','1 MG Road','Bengaluru')$q$);
SELECT pg_temp.expect_error('V144_104 a SAC code is 6 digits starting with 99',
  $q$UPDATE platform.billing_settings SET default_sac_code = '123456' WHERE id = 1$q$, '23514');
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
SELECT pg_temp.expect_error('V144_104 issuing without a place of supply is refused',
  $q$UPDATE platform.invoices SET status='ISSUED', invoice_number='UT/26-27/00001', issued_at=now(),
            billing_snapshot='{"legal_name":"A One Pvt Ltd"}'::jsonb WHERE id='11110000-0000-0000-0000-000000000001'$q$, '23514');
SELECT pg_temp.expect_error('V144_104 a line cannot carry both CGST/SGST and IGST',
  $q$UPDATE platform.invoice_lines SET cgst_amount = 90, sgst_amount = 0, igst_amount = 90
      WHERE invoice_id='11110000-0000-0000-0000-000000000001'$q$, '23514');
SELECT pg_temp.expect_error('V144_104 a line''s GST split must add up to its tax',
  $q$UPDATE platform.invoice_lines SET cgst_amount = 90, sgst_amount = 80
      WHERE invoice_id='11110000-0000-0000-0000-000000000001'$q$, '23514');
SELECT pg_temp.expect_ok('V144_104 an intra-state line: CGST + SGST, with its SAC',
  $q$UPDATE platform.invoice_lines SET sac_code = '998431', cgst_amount = 90, sgst_amount = 90
      WHERE invoice_id='11110000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_ok('V144_104 issue the invoice properly',
  $q$UPDATE platform.invoices SET status='ISSUED', invoice_number='UT/26-27/00001', issued_at=now(), place_of_supply='29',
            billing_snapshot='{"legal_name":"A One Pvt Ltd"}'::jsonb WHERE id='11110000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_error('V144_104 an issued invoice''s place of supply is frozen (trigger)',
  $q$UPDATE platform.invoices SET place_of_supply='07' WHERE id='11110000-0000-0000-0000-000000000001'$q$, '23514');
SELECT pg_temp.expect_error('V144_104 deleting the company of an invoice is refused (RESTRICT)',
  $q$DELETE FROM platform.company_modules WHERE company_id = 'a1a1a1a1-0000-0000-0000-0000000000a1';
     DELETE FROM platform.company_billing_profiles WHERE company_id = 'a1a1a1a1-0000-0000-0000-0000000000a1';
     DELETE FROM org.companies WHERE id = 'a1a1a1a1-0000-0000-0000-0000000000a1'$q$, '23001');
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
SELECT pg_temp.expect_ok('V144_104 a payment draft as InvoiceService first writes it (Rs 49 -> 41.53 + 7.48 = 49.01)',
  $q$INSERT INTO platform.invoices (id, tenant_id, status, subtotal, tax_total, total)
     VALUES ('11110000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','DRAFT',41.53,7.48,49.01)$q$);
SELECT pg_temp.expect_ok('V144_104 the paisa fix-up (tax and total move together) satisfies ck_invoices_total',
  $q$UPDATE platform.invoices SET tax_total = tax_total + (-0.01), total = total + (-0.01)
      WHERE id = '11110000-0000-0000-0000-000000000003' AND status = 'DRAFT'$q$);
INSERT INTO results(check_name, outcome)
SELECT 'V144_104 after the fix-up the draft adds up to exactly what was paid',
       CASE WHEN total = 49.00 AND subtotal - discount_total + tax_total = total THEN 'PASS' ELSE 'FAIL (' || total || ')' END
  FROM platform.invoices WHERE id = '11110000-0000-0000-0000-000000000003';
SELECT pg_temp.expect_error('V144_104 a fix-up that moved only the tax would break ck_invoices_total',
  $q$UPDATE platform.invoices SET tax_total = tax_total + 0.01 WHERE id = '11110000-0000-0000-0000-000000000003'$q$, '23514');
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
SELECT pg_temp.expect_ok('V144_105 map a person (MEMBER) in A1',
  $q$INSERT INTO platform.marketing_identity_map (kind, legacy_marketing_user_id, account_id, tenant_id, company_id, status, source, mapped_at)
     VALUES ('MEMBER','65a1b2c3d4e5f60718293a4f','acc00000-0000-0000-0000-0000000000c9','aaaaaaaa-0000-0000-0000-00000000000a',
             'a1a1a1a1-0000-0000-0000-0000000000a1','MAPPED','SSO',now())$q$);
SELECT pg_temp.expect_error('V144_105 deleting the account of a mapped person is refused (the only identity record)',
  $q$DELETE FROM platform.accounts WHERE id = 'acc00000-0000-0000-0000-0000000000c9'$q$, '23001');
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
SELECT pg_temp.expect_error('V144_106 a payload hash is a hex SHA-256',
  $q$INSERT INTO platform.usage_ledger (idempotency_key, payload_hash, tenant_id, company_id, provider, usage_type, occurred_at)
     VALUES ('meta:wamid.3:conversation','not-a-hash','aaaaaaaa-0000-0000-0000-00000000000a','a1a1a1a1-0000-0000-0000-0000000000a1','META_WHATSAPP','CONVERSATION',now())$q$, '23514');
SELECT pg_temp.expect_error('V144_106 one event cannot claim an unbounded quantity',
  $q$INSERT INTO platform.usage_ledger (idempotency_key, tenant_id, company_id, provider, usage_type, occurred_at, quantity)
     VALUES ('meta:wamid.4:conversation','aaaaaaaa-0000-0000-0000-00000000000a','a1a1a1a1-0000-0000-0000-0000000000a1','META_WHATSAPP','CONVERSATION',now(),20000)$q$, '23514');
INSERT INTO results(check_name, outcome)
SELECT 'V144_102-106 no new foreign key cascades or nulls (only SSO tickets and invoice lines cascade)',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL (' || string_agg(conrelid::regclass || '.' || conname, ', ') || ')' END
  FROM pg_constraint
 WHERE contype = 'f'
   AND conrelid IN ('platform.company_modules'::regclass, 'platform.subscriptions'::regclass,
                    'platform.module_plan_prices'::regclass, 'platform.company_billing_profiles'::regclass,
                    'platform.invoices'::regclass, 'platform.invoice_lines'::regclass,
                    'platform.marketing_identity_map'::regclass, 'platform.marketing_channel_accounts'::regclass,
                    'platform.usage_ledger'::regclass)
   AND confdeltype NOT IN ('r', 'a')   -- RESTRICT or NO ACTION: both refuse the delete
   AND NOT (conrelid = 'platform.invoice_lines'::regclass AND confrelid = 'platform.invoices'::regclass)
   AND NOT (conrelid = 'platform.subscriptions'::regclass AND conname <> 'fk_subscriptions_company');
SELECT pg_temp.expect_error('V144_104 an issued (now void) invoice cannot be deleted, even by the owner (trigger)',
  $q$DELETE FROM platform.invoices WHERE id = '11110000-0000-0000-0000-000000000001'$q$, '23514');
SELECT pg_temp.expect_error('V144_104 a discarded draft stays on record (trigger)',
  $q$DELETE FROM platform.invoices WHERE id = '11110000-0000-0000-0000-000000000002'$q$, '23514');

-- V144_107 ---------------------------------------------------------------------
INSERT INTO results(check_name, outcome)
SELECT 'V144_107 the Razorpay plan cache is keyed by price (old module+cycle key gone)',
       CASE WHEN to_regclass('platform.uq_razorpay_plans_module_cycle_price') IS NOT NULL
                 AND to_regclass('platform.razorpay_plans_module_key_billing_cycle_key') IS NULL
            THEN 'PASS' ELSE 'FAIL' END;
SELECT pg_temp.expect_ok('V144_107 two prices of one module and cycle are both cached',
  $q$INSERT INTO platform.razorpay_plans (module_key, billing_cycle, razorpay_plan_id, unit_price_paise)
     VALUES ('ctest-mod','MONTHLY','plan_ctest_old',4000), ('ctest-mod','MONTHLY','plan_ctest_new',4900)$q$);
SELECT pg_temp.expect_error('V144_107 the same price is cached once',
  $q$INSERT INTO platform.razorpay_plans (module_key, billing_cycle, razorpay_plan_id, unit_price_paise)
     VALUES ('ctest-mod','MONTHLY','plan_ctest_dup',4900)$q$, '23505');

-- ── Second pass: as the application role (ut_app), workspace bound ───────────────
-- Production's ut_app reads org.companies and writes audit.events (grants applied by hand before V142); a
-- fresh migrate-only database lacks them, so they are given here, inside this rolled-back transaction.
-- Nothing on platform.* is granted: the platform checks below see exactly what the migrations grant.
GRANT USAGE ON SCHEMA org, audit TO ut_app;
GRANT SELECT ON org.companies TO ut_app;
GRANT SELECT, INSERT ON audit.events TO ut_app;
SELECT pg_temp.as_app('sees its own workspace''s companies only (RLS)', 'aaaaaaaa-0000-0000-0000-00000000000a',
  $q$DO $x$ BEGIN
       IF (SELECT count(*) FROM org.companies
            WHERE id IN ('a1a1a1a1-0000-0000-0000-0000000000a1','a2a2a2a2-0000-0000-0000-0000000000a2',
                         'b1b1b1b1-0000-0000-0000-0000000000b1')) <> 2 THEN
         RAISE EXCEPTION 'RLS let another workspace''s company through';
       END IF;
     END $x$$q$, 'ok');
SELECT pg_temp.as_app('switches Marketing on for a company of its workspace', 'aaaaaaaa-0000-0000-0000-00000000000a',
  $q$INSERT INTO platform.company_modules (tenant_id, company_id, module_key, source, reason, granted_by)
     VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','a2a2a2a2-0000-0000-0000-0000000000a2','whatsapp','MANUAL','ut_app pass check','ops@test')$q$, 'ok');
SELECT pg_temp.as_app('cannot DELETE an entitlement row (retired by status instead)', 'aaaaaaaa-0000-0000-0000-00000000000a',
  $q$DELETE FROM platform.company_modules WHERE company_id = 'a2a2a2a2-0000-0000-0000-0000000000a2'$q$, '42501');
SELECT pg_temp.as_app('cannot DELETE an invoice, not even a draft (no grant)', 'aaaaaaaa-0000-0000-0000-00000000000a',
  $q$DELETE FROM platform.invoices WHERE id = '11110000-0000-0000-0000-000000000003'$q$, '42501');
SELECT pg_temp.as_app('cannot edit an issued invoice either (trigger)', 'aaaaaaaa-0000-0000-0000-00000000000a',
  $q$UPDATE platform.invoices SET total = 1 WHERE id = '11110000-0000-0000-0000-000000000001'$q$, '23514');
SELECT pg_temp.as_app('writes an audit row for its bound workspace', 'aaaaaaaa-0000-0000-0000-00000000000a',
  $q$INSERT INTO audit.events (id, tenant_id, occurred_at, occurred_date, module, action, summary)
     VALUES (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-00000000000a', now(), current_date, 'platform', 'CTEST', 'ut_app pass')$q$, 'ok');
SELECT pg_temp.as_app('cannot write an audit row for another workspace (insert policy)', 'aaaaaaaa-0000-0000-0000-00000000000a',
  $q$INSERT INTO audit.events (id, tenant_id, occurred_at, occurred_date, module, action, summary)
     VALUES (gen_random_uuid(), 'bbbbbbbb-0000-0000-0000-00000000000b', now(), current_date, 'platform', 'CTEST', 'ut_app pass')$q$, '42501');
SELECT pg_temp.as_app('cannot DELETE usage or an identity mapping (no grant)', 'aaaaaaaa-0000-0000-0000-00000000000a',
  $q$DELETE FROM platform.usage_ledger WHERE false; DELETE FROM platform.marketing_identity_map WHERE false$q$, '42501');
SELECT pg_temp.as_app('records usage and reads it back', 'aaaaaaaa-0000-0000-0000-00000000000a',
  $q$INSERT INTO platform.usage_ledger (idempotency_key, payload_hash, tenant_id, company_id, provider, usage_type, occurred_at)
     VALUES ('meta:wamid.ut:conversation', repeat('ab', 32), 'aaaaaaaa-0000-0000-0000-00000000000a',
             'a2a2a2a2-0000-0000-0000-0000000000a2','META_WHATSAPP','CONVERSATION',now())$q$, 'ok');
SELECT pg_temp.as_app('consumes an SSO ticket and deletes expired ones (the only DELETE it has)', 'aaaaaaaa-0000-0000-0000-00000000000a',
  $q$UPDATE platform.sso_handoff_tickets SET consumed_at = now() WHERE ticket_hash = repeat('a',64);
     DELETE FROM platform.sso_handoff_tickets WHERE expires_at < now() - interval '1 day'$q$, 'ok');
SELECT pg_temp.as_app('publishes a price version and caches a Razorpay plan by price', 'aaaaaaaa-0000-0000-0000-00000000000a',
  $q$INSERT INTO platform.razorpay_plans (module_key, billing_cycle, razorpay_plan_id, unit_price_paise)
     VALUES ('ctest-mod','ANNUAL','plan_ctest_annual',47000) ON CONFLICT DO NOTHING$q$, 'ok');

\echo
SELECT n, outcome, check_name FROM results ORDER BY n;
SELECT count(*) FILTER (WHERE outcome LIKE 'PASS%') AS pass,
       count(*) FILTER (WHERE outcome LIKE 'FAIL%') AS fail,
       count(*) FILTER (WHERE outcome LIKE 'SKIP%') AS skip
  FROM results;
ROLLBACK;
