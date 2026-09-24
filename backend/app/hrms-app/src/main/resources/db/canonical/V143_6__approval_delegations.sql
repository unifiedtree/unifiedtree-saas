-- V143.6 — approval delegation (out-of-office cover).
--
-- When an approver knows they'll be away (leave, off-site training, WFH day
-- without laptop time), they add a delegation: "my approvals go to Alice from
-- Mon to Wed". Any submit that would route to me during that window is
-- redirected to Alice instead. Applies to leave, WFH, expense, advance and
-- overtime submits — every path that flows through ApproverFallbackResolver.
--
-- Rules:
--   * one row per (delegator, [from_date, to_date]); non-overlapping windows
--     enforced by unique EXCLUDE constraint (btree_gist required — falls back
--     to a plain unique index if the extension isn't available)
--   * delegate_id must be a real active employee in the same tenant; enforced
--     in the service, not at DB level (cross-schema FK, RLS)
--   * a delegation only affects requests SUBMITTED during the window; already
--     routed requests keep their existing approver
--   * expired rows are deleted by a nightly cleanup or an operator; readers
--     always filter on the date
--
-- Numbered 143.6 so it cannot collide with a teammate's V144. Idempotent.

CREATE TABLE IF NOT EXISTS platform.approver_delegations (
    id           UUID PRIMARY KEY,
    tenant_id    UUID NOT NULL,
    delegator_id UUID NOT NULL,
    delegate_id  UUID NOT NULL,
    from_date    DATE NOT NULL,
    to_date      DATE NOT NULL,
    reason       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_apdel_dates CHECK (to_date >= from_date),
    CONSTRAINT ck_apdel_self  CHECK (delegator_id <> delegate_id)
);
CREATE INDEX IF NOT EXISTS idx_apdel_delegator
    ON platform.approver_delegations (tenant_id, delegator_id, from_date, to_date);
CREATE INDEX IF NOT EXISTS idx_apdel_delegate
    ON platform.approver_delegations (tenant_id, delegate_id, from_date, to_date);

ALTER TABLE platform.approver_delegations ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'platform'
           AND tablename  = 'approver_delegations'
           AND policyname = 'tenant_isolation_apdel'
    ) THEN
        CREATE POLICY tenant_isolation_apdel ON platform.approver_delegations
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA platform TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON platform.approver_delegations TO ut_app;
    END IF;
END $$;
