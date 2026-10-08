-- ============================================================================
-- V144_5 - Ownership transfer
-- ============================================================================
-- Owner decisions (6 Oct 2026, docs/redesign/OWNERSHIP_TRANSFER_DESIGN.md): the owner hands the
-- business to someone who already has a login in it; they accept within 7 days; ownership moves in
-- one step; the old owner keeps full Admin for up to 15 days, then only employee self-service if
-- they are an employee; exactly one owner. One row per transfer; at most one open per business.
--
-- A record of who owned the business when: never deleted by the app. No tenant foreign key, like
-- platform.subscriptions; a business is closed, never deleted.
--
-- ── Applying by hand (Flyway is OFF in production) ─────────────────────────────
-- After V144_101 → 107 (PR #12); depends on nothing new. Deploy the code first: until this is applied
-- the Ownership section answers "not available yet". Then, as the owner role, one transaction:
--     psql -1 -v ON_ERROR_STOP=1 -f V144_5__ownership_transfers.sql
-- lock_timeout = 5s: a lock it cannot get fails the file (nothing applied) instead of queueing
-- requests behind it. Re-run it when traffic is lower. Idempotent.
-- Rollback (only while no row is TRANSITION or COMPLETED — those moved real ownership):
--     DROP TABLE platform.ownership_transfers;
-- ============================================================================

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS platform.ownership_transfers (
    id                  UUID        PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    from_user_id        UUID        NOT NULL,
    to_user_id          UUID        NOT NULL,
    status              VARCHAR(16) NOT NULL CHECK (status IN ('PENDING', 'DECLINED', 'CANCELLED', 'EXPIRED', 'TRANSITION', 'COMPLETED')),
    note                TEXT        CHECK (note IS NULL OR char_length(note) <= 500),
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
        GRANT USAGE ON SCHEMA platform TO ut_app;
        GRANT SELECT, INSERT, UPDATE ON platform.ownership_transfers TO ut_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
        GRANT USAGE ON SCHEMA platform TO hrms_app;
        GRANT SELECT, INSERT, UPDATE ON platform.ownership_transfers TO hrms_app;
    END IF;
END $$;

-- Explicit, because V089's ALTER DEFAULT PRIVILEGES (where its owner role ran it) hands DELETE on every
-- new platform table to the app roles; production has no default privileges (as PR #12, f1220e79).
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['ut_app', 'hrms_app', 'app_user'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE DELETE ON platform.ownership_transfers FROM %I', r);
        END IF;
    END LOOP;
END $$;
