-- ============================================================================
-- V144_5 - Ownership transfer
-- ============================================================================
-- Owner decisions (6 Oct 2026, docs/redesign/OWNERSHIP_TRANSFER_DESIGN.md): the owner hands the
-- business to someone who already has a login in it; they accept within 7 days; ownership moves in
-- one step; the old owner keeps full Admin for up to 15 days, then only employee self-service if
-- they are an employee; exactly one owner. One row per transfer; at most one open per business.
--
-- Flyway is OFF in production: apply by hand as the owner. Idempotent. Until it is applied the
-- Ownership section answers "not available yet".
-- Rollback: DROP TABLE platform.ownership_transfers;
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform.ownership_transfers (
    id                  UUID        PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    from_user_id        UUID        NOT NULL,
    to_user_id          UUID        NOT NULL,
    status              VARCHAR(16) NOT NULL CHECK (status IN ('PENDING', 'DECLINED', 'CANCELLED', 'EXPIRED', 'TRANSITION', 'COMPLETED')),
    note                TEXT,
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL,
    accepted_at         TIMESTAMPTZ,
    transition_ends_at  TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    ended_by            UUID,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one open transfer (pending or in transition) per business.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ownership_transfers_open
    ON platform.ownership_transfers (tenant_id) WHERE status IN ('PENDING', 'TRANSITION');

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT SELECT, INSERT, UPDATE ON platform.ownership_transfers TO ut_app;
    ELSE
        RAISE NOTICE 'V144.5: role ut_app not present — grants skipped';
    END IF;
END $$;
