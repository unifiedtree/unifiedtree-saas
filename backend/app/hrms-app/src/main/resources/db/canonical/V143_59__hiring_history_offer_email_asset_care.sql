-- V143.59: hiring stage history, the candidate email on an offer, and asset
-- confirmation / problem reports (HRMS redesign, package P-HIRE: BW-66, BW-67, BW-70).
--
-- 1. hiring_mgmt.candidate_stage_events: one row per move of a candidate
--    through the pipeline (added, stage change, offer created, offer accepted,
--    converted to an employee), written in the SAME transaction as the move.
--    The funnel's conversion rates and time to hire are exact from the day
--    this table exists; candidates added before it have no history and are
--    left out of the rates (the page shows "—" for them). No backfill: the
--    moves before today were never recorded, and guessing them would not be exact.
-- 2. hiring_mgmt.offer_candidate_emails: the candidate's email typed on an
--    offer (hiring_mgmt.offers is mapped by the HiringOffer entity, so the
--    email lives in this side table instead of a new column). One-click
--    "Send offer email" uses it, falling back to the linked candidate's email.
-- 3. hrms.asset_confirmations: an employee confirming they received an asset,
--    one row per hand-over (hrms.asset_allocations row). BACKFILLED ONCE, when
--    the table is created: every hand-over that is open at that moment counts
--    as confirmed (source BACKFILL), so equipment people already have does not
--    all start asking "Did you get it?". Hand-overs after that wait for the
--    employee. Re-running this file never backfills again (the table exists).
-- 4. hrms.asset_issue_reports: "Report a problem" on an asset (lost, damaged,
--    not working, other), OPEN until HR resolves it. At most one open report
--    per asset.
--
-- All four tables are read and written with JDBC only (no JPA entity maps
-- them), so no entity changes. The app answers FEATURE_NOT_READY (or leaves
-- the new fields empty) until this file is applied. No new permissions: the
-- endpoints use hrms.hiring.read, hrms.onboarding.asset.self and
-- hrms.onboarding.asset.write, which already exist.
--
-- Numbered 143.59 (assigned slot). Idempotent. Production has Flyway OFF:
-- apply by hand, as a superuser (row-level security; the backfill must see
-- every tenant's rows).

-- ── 1. candidate stage history ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hiring_mgmt.candidate_stage_events (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID          NOT NULL,
    candidate_id  UUID          NOT NULL REFERENCES hiring_mgmt.candidates(id) ON DELETE CASCADE,
    from_stage    VARCHAR(30),
    to_stage      VARCHAR(30)   NOT NULL,
    event_kind    VARCHAR(20)   NOT NULL,
    changed_at    TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
    changed_by    UUID,
    CONSTRAINT ck_candidate_stage_events_kind
        CHECK (event_kind IN ('ADDED', 'STAGE_CHANGE', 'OFFER_CREATED', 'OFFER_ACCEPTED', 'CONVERTED'))
);
CREATE INDEX IF NOT EXISTS idx_candidate_stage_events_candidate
    ON hiring_mgmt.candidate_stage_events (tenant_id, candidate_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_candidate_stage_events_kind_time
    ON hiring_mgmt.candidate_stage_events (tenant_id, event_kind, changed_at);

COMMENT ON TABLE hiring_mgmt.candidate_stage_events IS
    'Every move of a candidate through the hiring pipeline, written with the move (V143.59). Source of the funnel''s conversion rates and time to hire, exact from the day this table was created.';

ALTER TABLE hiring_mgmt.candidate_stage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hiring_mgmt.candidate_stage_events FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hiring_mgmt' AND tablename = 'candidate_stage_events'
                      AND policyname = 'tenant_isolation_candidate_stage_events') THEN
        CREATE POLICY tenant_isolation_candidate_stage_events ON hiring_mgmt.candidate_stage_events
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 2. candidate email on an offer ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hiring_mgmt.offer_candidate_emails (
    tenant_id   UUID          NOT NULL,
    offer_id    UUID          NOT NULL REFERENCES hiring_mgmt.offers(id) ON DELETE CASCADE,
    email       VARCHAR(254)  NOT NULL,
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_by  UUID,
    PRIMARY KEY (tenant_id, offer_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_candidate_emails_offer
    ON hiring_mgmt.offer_candidate_emails (offer_id);

COMMENT ON TABLE hiring_mgmt.offer_candidate_emails IS
    'The candidate''s email typed on an offer, used by one-click "Send offer email" (V143.59). Side table: hiring_mgmt.offers is JPA-mapped.';

ALTER TABLE hiring_mgmt.offer_candidate_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE hiring_mgmt.offer_candidate_emails FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hiring_mgmt' AND tablename = 'offer_candidate_emails'
                      AND policyname = 'tenant_isolation_offer_candidate_emails') THEN
        CREATE POLICY tenant_isolation_offer_candidate_emails ON hiring_mgmt.offer_candidate_emails
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 3. asset confirmations (created and backfilled once) ────────────────────
-- The table and its one-time backfill happen together: when the table already
-- exists, nothing here runs again, so later hand-overs are never marked
-- confirmed on the employee's behalf. The backfill runs before row-level
-- security is switched on, and this file is applied as a superuser.
DO $$
BEGIN
    IF to_regclass('hrms.asset_confirmations') IS NULL THEN
        CREATE TABLE hrms.asset_confirmations (
            id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id      UUID          NOT NULL,
            allocation_id  UUID          NOT NULL REFERENCES hrms.asset_allocations(id) ON DELETE CASCADE,
            asset_id       UUID          NOT NULL REFERENCES hrms.onboarding_assets(id) ON DELETE CASCADE,
            employee_id    UUID          NOT NULL,
            confirmed_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
            source         VARCHAR(10)   NOT NULL DEFAULT 'EMPLOYEE',
            UNIQUE (allocation_id),
            CHECK (source IN ('EMPLOYEE', 'BACKFILL'))
        );

        INSERT INTO hrms.asset_confirmations (tenant_id, allocation_id, asset_id, employee_id, confirmed_at, source)
        SELECT al.tenant_id, al.id, al.asset_id, al.employee_id, now(), 'BACKFILL'
          FROM hrms.asset_allocations al
          JOIN hrms.onboarding_assets a ON a.id = al.asset_id AND a.tenant_id = al.tenant_id
         WHERE al.returned_at IS NULL
           AND a.status = 'ASSIGNED'
           AND a.employee_id = al.employee_id;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_asset_confirmations_asset
    ON hrms.asset_confirmations (tenant_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_confirmations_employee
    ON hrms.asset_confirmations (tenant_id, employee_id);

COMMENT ON TABLE hrms.asset_confirmations IS
    'An employee confirming they received an asset, one row per hand-over (V143.59). Hand-overs open when the table was created were backfilled as confirmed (source BACKFILL).';

ALTER TABLE hrms.asset_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.asset_confirmations FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hrms' AND tablename = 'asset_confirmations'
                      AND policyname = 'tenant_isolation_asset_confirmations') THEN
        CREATE POLICY tenant_isolation_asset_confirmations ON hrms.asset_confirmations
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 4. asset problem reports ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms.asset_issue_reports (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID          NOT NULL,
    asset_id             UUID          NOT NULL REFERENCES hrms.onboarding_assets(id) ON DELETE CASCADE,
    allocation_id        UUID          REFERENCES hrms.asset_allocations(id) ON DELETE SET NULL,
    employee_id          UUID          NOT NULL,
    kind                 VARCHAR(20)   NOT NULL,
    note                 TEXT,
    status               VARCHAR(10)   NOT NULL DEFAULT 'OPEN',
    reported_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    reported_by_user_id  UUID,
    resolved_at          TIMESTAMPTZ,
    resolved_by_user_id  UUID,
    resolved_by_name     VARCHAR(200),
    resolution_note      TEXT,
    CONSTRAINT ck_asset_issue_reports_kind   CHECK (kind IN ('LOST', 'DAMAGED', 'NOT_WORKING', 'OTHER')),
    CONSTRAINT ck_asset_issue_reports_status CHECK (status IN ('OPEN', 'RESOLVED')),
    CONSTRAINT ck_asset_issue_reports_note   CHECK (note IS NULL OR length(note) <= 1000),
    CONSTRAINT ck_asset_issue_reports_resolution CHECK (resolution_note IS NULL OR length(resolution_note) <= 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_issue_reports_one_open
    ON hrms.asset_issue_reports (tenant_id, asset_id) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_asset_issue_reports_status
    ON hrms.asset_issue_reports (tenant_id, status, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_issue_reports_employee
    ON hrms.asset_issue_reports (tenant_id, employee_id);

COMMENT ON TABLE hrms.asset_issue_reports IS
    'Problems employees report with an asset issued to them (lost, damaged, not working, other), open until HR resolves them (V143.59).';

ALTER TABLE hrms.asset_issue_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.asset_issue_reports FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hrms' AND tablename = 'asset_issue_reports'
                      AND policyname = 'tenant_isolation_asset_issue_reports') THEN
        CREATE POLICY tenant_isolation_asset_issue_reports ON hrms.asset_issue_reports
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 5. grants for the runtime role ──────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA hiring_mgmt TO ut_app;
        GRANT USAGE ON SCHEMA hrms TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hiring_mgmt.candidate_stage_events TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hiring_mgmt.offer_candidate_emails TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.asset_confirmations TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.asset_issue_reports TO ut_app;
    ELSE
        RAISE NOTICE 'V143.59: role ut_app not present — grants skipped';
    END IF;
END $$;
