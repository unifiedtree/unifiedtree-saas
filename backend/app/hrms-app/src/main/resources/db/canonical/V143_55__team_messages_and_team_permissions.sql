-- V143.55: "Message team" and team probation decisions (HRMS redesign BW-11,
-- BW-12, package P-TEAM).
--
-- 1. hrms.team_messages + hrms.team_message_recipients: a manager's short
--    message to their own team (the departments they head, else their direct
--    reports), and exactly who it went to. Read and written with JDBC only (no
--    JPA entity maps them), so no entity changes. While these tables are
--    missing, the message endpoints answer FEATURE_NOT_READY and nothing else
--    changes.
-- 2. Permissions, shown on Roles & permissions:
--      hrms.probation.team.decide — confirm or extend probation for people in
--        their own team, from Team today. OWNER and SUPER_ADMIN only by
--        default (redesign DECISIONS 15); admins can give it to managers.
--      hrms.team.message — post a message to their own team. OWNER,
--        SUPER_ADMIN, DEPT_MANAGER, MANAGER.
--    OWNER and SUPER_ADMIN get both (OwnerPermissionInvariantCheck refuses to
--    start the app otherwise).
--
-- Idempotent. Production has Flyway OFF: apply by hand, as a superuser
-- (row-level security).

-- ── 1. team messages ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms.team_messages (
    id                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    tenant_id           UUID         NOT NULL,
    sender_employee_id  UUID         NOT NULL,
    sender_user_id      UUID,
    body                VARCHAR(500) NOT NULL,
    team_label          VARCHAR(300),
    recipient_count     INTEGER      NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_team_messages PRIMARY KEY (tenant_id, id),
    CONSTRAINT ck_team_messages_body CHECK (char_length(btrim(body)) BETWEEN 1 AND 500)
);
CREATE INDEX IF NOT EXISTS idx_team_messages_sender
    ON hrms.team_messages (tenant_id, sender_employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hrms.team_message_recipients (
    tenant_id    UUID NOT NULL,
    message_id   UUID NOT NULL,
    employee_id  UUID NOT NULL,
    CONSTRAINT pk_team_message_recipients PRIMARY KEY (tenant_id, message_id, employee_id),
    CONSTRAINT fk_team_message_recipients_message FOREIGN KEY (tenant_id, message_id)
        REFERENCES hrms.team_messages (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_team_message_recipients_employee
    ON hrms.team_message_recipients (tenant_id, employee_id);

COMMENT ON TABLE hrms.team_messages IS
    'A manager''s short message (up to 500 characters) to their own team: the departments they head, else their direct reports (V143.55, redesign BW-12). JDBC only.';
COMMENT ON TABLE hrms.team_message_recipients IS
    'Who each team message went to (V143.55). JDBC only.';

ALTER TABLE hrms.team_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.team_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE hrms.team_message_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.team_message_recipients FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hrms' AND tablename = 'team_messages'
                      AND policyname = 'tenant_isolation_team_messages') THEN
        CREATE POLICY tenant_isolation_team_messages ON hrms.team_messages
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hrms' AND tablename = 'team_message_recipients'
                      AND policyname = 'tenant_isolation_team_message_recipients') THEN
        CREATE POLICY tenant_isolation_team_message_recipients ON hrms.team_message_recipients
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

-- ── 2. permissions ───────────────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.probation.team.decide', 'Confirm or extend team probation', 'hrms',
     'Confirm or extend probation for people in your own team, from Team today. HR and the employee are told. Without it, managers still see their team''s probation dates.'),
    ('hrms.team.message', 'Message your team', 'hrms',
     'Post a short message to everyone in your team. They see it in their notifications and on their Home.')
ON CONFLICT (code) DO NOTHING;

-- Risk level shown on Roles & permissions (V143.17 columns; guarded like V143.33).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'rbac' AND table_name = 'permissions' AND column_name = 'risk_level') THEN
    UPDATE rbac.permissions
       SET risk_level = 'MEDIUM'
     WHERE code = 'hrms.probation.team.decide'
       AND risk_level = 'LOW';
  END IF;
END $$;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.probation.team.decide'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.team.message'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'DEPT_MANAGER', 'MANAGER')
ON CONFLICT DO NOTHING;

-- ── 3. grants for the runtime role ───────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA hrms TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.team_messages TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.team_message_recipients TO ut_app;
    ELSE
        RAISE NOTICE 'V143.55: role ut_app not present — grants skipped';
    END IF;
END $$;
