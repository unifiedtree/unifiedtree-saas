-- V144.104: invoices and company billing profiles.
--
-- Why. UnifiedTree takes money (platform.payments, platform.subscriptions) but
-- has never issued an invoice: there is no invoice table and no Java code that
-- produces one. A business paying per company also needs that company's
-- billing details (address, billing email, GSTIN) on its invoice, and
-- org.companies has no address or billing email (HRMS owns that table, so the
-- billing side gets its own).
--
-- What it does.
--   1. platform.billing_settings gains the seller's details printed on every
--      invoice, the default GST rate, the invoice number prefix, and the switch
--      for pooled Meta billing (FALSE: not approved by Meta, see V144.106).
--   2. platform.company_billing_profiles: one per company, for what org.companies
--      does not hold (billing address, state code for GST place of supply, billing
--      email). Its legal name / GSTIN / PAN override the company's when filled.
--   3. platform.invoice_number_series + platform.invoices + platform.invoice_lines.
--      An invoice carries an immutable billing_snapshot taken when it is issued,
--      so a company editing its address later does not rewrite old invoices.
--      Numbers are PREFIX/26-27/00001: GST Rule 46(b) caps them at 16 characters,
--      hence the 1-4 character prefix.
--   4. Triggers make an ISSUED / PAID / VOID / DISCARDED invoice's amounts, number,
--      parties and snapshot unchangeable, and freeze its lines. The only way to
--      correct an issued one is to void it and issue another; a wrong DRAFT is
--      DISCARDED (it never had a number).
--
-- Not created: a payment-methods table. How a workspace pays is already on
-- platform.subscriptions (payment_method, razorpay_subscription_id); no code needs
-- another copy.
--
-- Not done here: wiring invoice issue into the live Razorpay webhook. Invoices
-- are issued from the admin console for now (platform.billing.manage), so the
-- payment path that is earning money today is untouched.
--
-- Safety. Additive. No RLS on platform.* (V002:4-7). Idempotent.
-- Production has Flyway OFF: apply by hand.

ALTER TABLE platform.billing_settings
    ADD COLUMN IF NOT EXISTS seller_legal_name     VARCHAR(255),
    ADD COLUMN IF NOT EXISTS seller_gstin          VARCHAR(15),
    ADD COLUMN IF NOT EXISTS seller_pan            VARCHAR(10),
    ADD COLUMN IF NOT EXISTS seller_address        TEXT,
    ADD COLUMN IF NOT EXISTS seller_state_code     VARCHAR(2),
    ADD COLUMN IF NOT EXISTS seller_email          VARCHAR(255),
    ADD COLUMN IF NOT EXISTS invoice_prefix        VARCHAR(10)  NOT NULL DEFAULT 'UT',
    ADD COLUMN IF NOT EXISTS default_gst_rate_pct  NUMERIC(5,2) NOT NULL DEFAULT 18.00,
    ADD COLUMN IF NOT EXISTS invoice_due_days      INTEGER      NOT NULL DEFAULT 7,
    ADD COLUMN IF NOT EXISTS marketing_pooled_billing_enabled BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_billing_settings_invoice_prefix') THEN
        ALTER TABLE platform.billing_settings
            ADD CONSTRAINT ck_billing_settings_invoice_prefix CHECK (invoice_prefix ~ '^[A-Z0-9]{1,4}$');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS platform.company_billing_profiles (
    company_id      UUID         PRIMARY KEY,
    tenant_id       UUID         NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    legal_name      VARCHAR(255),
    gstin           VARCHAR(15),
    pan             VARCHAR(10),
    billing_email   VARCHAR(255),
    billing_phone   VARCHAR(30),
    address_line1   VARCHAR(255),
    address_line2   VARCHAR(255),
    city            VARCHAR(100),
    state           VARCHAR(100),
    state_code      VARCHAR(2),
    postal_code     VARCHAR(20),
    country         VARCHAR(2)   NOT NULL DEFAULT 'IN',
    currency        VARCHAR(3)   NOT NULL DEFAULT 'INR',
    updated_by      VARCHAR(255),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_billing_profile_company FOREIGN KEY (company_id, tenant_id)
        REFERENCES org.companies (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT ck_billing_profile_gstin CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
    CONSTRAINT ck_billing_profile_pan   CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$')
);
CREATE INDEX IF NOT EXISTS ix_billing_profiles_tenant ON platform.company_billing_profiles (tenant_id);

CREATE TABLE IF NOT EXISTS platform.invoice_number_series (
    series_key  VARCHAR(40) PRIMARY KEY,
    last_number BIGINT      NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.invoices (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number      VARCHAR(40)   UNIQUE,
    tenant_id           UUID          NOT NULL REFERENCES platform.tenants(id),
    company_id          UUID,
    subscription_id     UUID          REFERENCES platform.subscriptions(id) ON DELETE SET NULL,
    payment_id          UUID          REFERENCES platform.payments(id) ON DELETE SET NULL,
    status              VARCHAR(20)   NOT NULL DEFAULT 'DRAFT',
    currency            VARCHAR(3)    NOT NULL DEFAULT 'INR',
    subtotal            NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_total           NUMERIC(14,2) NOT NULL DEFAULT 0,
    total               NUMERIC(14,2) NOT NULL DEFAULT 0,
    amount_paid         NUMERIC(14,2) NOT NULL DEFAULT 0,
    period_start        TIMESTAMPTZ,
    period_end          TIMESTAMPTZ,
    issued_at           TIMESTAMPTZ,
    due_at              TIMESTAMPTZ,
    paid_at             TIMESTAMPTZ,
    voided_at           TIMESTAMPTZ,
    void_reason         TEXT,
    billing_snapshot    JSONB,
    notes               TEXT,
    created_by          VARCHAR(255),
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT fk_invoices_company FOREIGN KEY (company_id, tenant_id)
        REFERENCES org.companies (id, tenant_id),
    CONSTRAINT ck_invoices_status  CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'VOID', 'DISCARDED')),
    CONSTRAINT ck_invoices_amounts CHECK (subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0
                                          AND total >= 0 AND amount_paid >= 0),
    CONSTRAINT ck_invoices_total   CHECK (total = subtotal - discount_total + tax_total),
    -- Anything issued has a number, an issue date and the snapshot it was issued with. A DISCARDED draft never did.
    CONSTRAINT ck_invoices_issued  CHECK (status IN ('DRAFT', 'DISCARDED')
                                          OR (invoice_number IS NOT NULL AND issued_at IS NOT NULL
                                              AND billing_snapshot IS NOT NULL)),
    CONSTRAINT ck_invoices_discarded CHECK (status <> 'DISCARDED' OR invoice_number IS NULL),
    CONSTRAINT ck_invoices_void    CHECK (status NOT IN ('VOID', 'DISCARDED')
                                          OR (voided_at IS NOT NULL AND void_reason IS NOT NULL)),
    CONSTRAINT ck_invoices_period  CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS ix_invoices_tenant_issued ON platform.invoices (tenant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS ix_invoices_company ON platform.invoices (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_invoices_status ON platform.invoices (status);
-- One live invoice per payment: a payment is invoiced once (void or discard it to re-draft).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_payment_live
    ON platform.invoices (payment_id) WHERE payment_id IS NOT NULL AND status NOT IN ('VOID', 'DISCARDED');

CREATE TABLE IF NOT EXISTS platform.invoice_lines (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id       UUID          NOT NULL REFERENCES platform.invoices(id) ON DELETE CASCADE,
    line_no          INTEGER       NOT NULL,
    plan_key         VARCHAR(50),
    module_key       VARCHAR(50),
    price_version_id UUID          REFERENCES platform.module_plan_prices(id),
    description      VARCHAR(500)  NOT NULL,
    quantity         NUMERIC(14,4) NOT NULL DEFAULT 1,
    unit_price       NUMERIC(14,2) NOT NULL,
    discount         NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_rate_pct     NUMERIC(5,2)  NOT NULL DEFAULT 0,
    tax_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
    amount           NUMERIC(14,2) NOT NULL,
    period_start     TIMESTAMPTZ,
    period_end       TIMESTAMPTZ,
    CONSTRAINT uq_invoice_line_no      UNIQUE (invoice_id, line_no),
    CONSTRAINT ck_invoice_lines_values CHECK (quantity > 0 AND unit_price >= 0 AND discount >= 0
                                              AND tax_rate_pct >= 0 AND tax_amount >= 0 AND amount >= 0)
);

-- An issued invoice is a legal document: its money and parties are frozen.
CREATE OR REPLACE FUNCTION platform.guard_issued_invoice() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status IN ('ISSUED', 'PAID', 'VOID', 'DISCARDED') THEN
        IF NEW.invoice_number   IS DISTINCT FROM OLD.invoice_number
        OR NEW.tenant_id        IS DISTINCT FROM OLD.tenant_id
        OR NEW.company_id       IS DISTINCT FROM OLD.company_id
        OR NEW.currency         IS DISTINCT FROM OLD.currency
        OR NEW.subtotal         IS DISTINCT FROM OLD.subtotal
        OR NEW.discount_total   IS DISTINCT FROM OLD.discount_total
        OR NEW.tax_total        IS DISTINCT FROM OLD.tax_total
        OR NEW.total            IS DISTINCT FROM OLD.total
        OR NEW.issued_at        IS DISTINCT FROM OLD.issued_at
        OR NEW.billing_snapshot IS DISTINCT FROM OLD.billing_snapshot
        OR NEW.period_start     IS DISTINCT FROM OLD.period_start
        OR NEW.period_end       IS DISTINCT FROM OLD.period_end THEN
            RAISE EXCEPTION 'Invoice % is %: its amounts and billing details cannot change. Void it and issue a new one.',
                OLD.invoice_number, OLD.status USING ERRCODE = 'check_violation';
        END IF;
        IF OLD.status IN ('VOID', 'DISCARDED') AND NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Invoice % is % and cannot be reopened.', COALESCE(OLD.invoice_number, OLD.id::text),
                lower(OLD.status) USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.status = 'DRAFT' THEN
            RAISE EXCEPTION 'Invoice % has been issued and cannot go back to draft.', OLD.invoice_number
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_issued_invoice ON platform.invoices;
CREATE TRIGGER trg_guard_issued_invoice
    BEFORE UPDATE ON platform.invoices
    FOR EACH ROW EXECUTE FUNCTION platform.guard_issued_invoice();

CREATE OR REPLACE FUNCTION platform.guard_issued_invoice_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    parent_status VARCHAR(20);
BEGIN
    SELECT status INTO parent_status FROM platform.invoices
     WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'The lines of an issued invoice cannot change.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_guard_issued_invoice_lines ON platform.invoice_lines;
CREATE TRIGGER trg_guard_issued_invoice_lines
    BEFORE INSERT OR UPDATE OR DELETE ON platform.invoice_lines
    FOR EACH ROW EXECUTE FUNCTION platform.guard_issued_invoice_lines();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA platform TO ut_app;
        GRANT SELECT, INSERT, UPDATE ON platform.company_billing_profiles,
            platform.invoice_number_series, platform.invoices, platform.invoice_lines TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA platform TO hrms_app;
        GRANT SELECT, INSERT, UPDATE ON platform.company_billing_profiles,
            platform.invoice_number_series, platform.invoices, platform.invoice_lines TO hrms_app;
    END IF;
END $$;
