-- ============================================================================
-- V091 - Marketing-lead intake table.
-- ----------------------------------------------------------------------------
-- Backs the new POST /v1/public/lead-request (LeadRequestController), which
-- receives submissions from the website's "Request demo" and "Contact sales"
-- forms. Prior to Bundle H, those forms setTimeout(700)'d and dropped the
-- lead on the floor — see git log for the "Website Demo Request + Contact
-- Sales forms are mocked in prod" QA finding.
--
-- Idempotent: uses IF NOT EXISTS so both prod (applied manually via psycopg
-- following the Flyway-off runbook) and Testcontainers ITs run this as a
-- no-op the second time.
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform.lead_requests (
    id              UUID         PRIMARY KEY,
    intent          VARCHAR(16)  NOT NULL,   -- 'demo' | 'sales' | 'unknown'
    name            VARCHAR(200) NOT NULL,
    email           VARCHAR(320) NOT NULL,
    company         VARCHAR(200),
    company_size    VARCHAR(50),
    preferred_time  VARCHAR(200),            -- demo form only
    timeline        VARCHAR(50),             -- sales form only
    notes           TEXT,                    -- demo form only
    message         TEXT,                    -- sales form only
    user_agent      VARCHAR(500),
    ip_address      VARCHAR(80),             -- TEXT (not inet) so we never
                                             -- reject a lead over a malformed
                                             -- forwarded-for header
    received_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Ops queries pivot on time (recent leads) and on email (dupe suppression).
CREATE INDEX IF NOT EXISTS ix_lead_requests_received_at
    ON platform.lead_requests (received_at DESC);
CREATE INDEX IF NOT EXISTS ix_lead_requests_email
    ON platform.lead_requests (lower(email));

-- The public endpoint runs unauthenticated; ut_app is the only role that
-- writes here from the app. No RLS — this is a platform-owned table with no
-- tenant scope.
GRANT INSERT, SELECT ON platform.lead_requests TO ut_app;
