-- Offer email attempt ledger.
--
-- Sending an offer is a network call to a mail provider; a timeout or a lost
-- response leaves "was it accepted?" unknowable from our side. Each send is
-- now recorded here BEFORE the provider is called (PENDING) and finished
-- after (ACCEPTED / NOT_SENT / UNCERTAIN). While an attempt is PENDING or
-- UNCERTAIN, further sends for that offer are refused until an operator
-- records what actually happened — so an ambiguous send is never repeated
-- automatically, and every send, failure and resolution has a trail.
CREATE TABLE IF NOT EXISTS hiring_mgmt.offer_email_attempts (
    id              UUID         PRIMARY KEY,
    tenant_id       UUID         NOT NULL,
    offer_id        UUID         NOT NULL REFERENCES hiring_mgmt.offers(id) ON DELETE CASCADE,
    recipient       VARCHAR(254) NOT NULL,
    status          VARCHAR(12)  NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'NOT_SENT', 'UNCERTAIN')),
    failure_reason  VARCHAR(500),
    requested_by    VARCHAR(255),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    resolved_by     VARCHAR(255),
    resolution_note VARCHAR(500)
);
CREATE INDEX IF NOT EXISTS offer_email_attempts_offer
    ON hiring_mgmt.offer_email_attempts (tenant_id, offer_id, created_at DESC);
-- At most one unresolved attempt per offer: the database, not only the
-- service, refuses a second concurrent send.
CREATE UNIQUE INDEX IF NOT EXISTS offer_email_attempts_one_open
    ON hiring_mgmt.offer_email_attempts (tenant_id, offer_id)
    WHERE status IN ('PENDING', 'UNCERTAIN');

ALTER TABLE hiring_mgmt.offer_email_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY offer_email_attempts_tenant ON hiring_mgmt.offer_email_attempts
    USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hiring_mgmt.offer_email_attempts TO hrms_app;
END IF; END $$;
