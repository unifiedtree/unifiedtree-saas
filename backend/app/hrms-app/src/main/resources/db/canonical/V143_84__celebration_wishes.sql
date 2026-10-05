-- V143.84: "Send wishes" on Celebrations. A colleague sends a short message to someone
-- on their birthday, their work anniversary, or to welcome them aboard; the person is
-- told in the app and on their phone (notification type CELEBRATION_WISH, event
-- people.celebration_wish) and sees who wished them on their own Celebrations card.
--
-- Why. The owner approved it (5 Oct 2026). Until now Celebrations only listed people;
-- nothing let one person send another a message.
--
-- hrms.celebration_wishes: one row per wish.
--   * company_id        the company both people work in (a wish never crosses companies).
--   * occasion          BIRTHDAY, ANNIVERSARY or WELCOME.
--   * occasion_date     the day it is for: today for a birthday or a work anniversary, the
--                       joining date for a welcome.
--   * message           the sender's words, plain text, 1 to 280 characters.
-- One wish per sender, per person, per occasion, per date (uq_celebration_wishes_once):
-- sending again answers with the wish already sent and tells nobody twice. Nobody can wish
-- themself (ck_celebration_wishes_not_self).
--
-- Rules the server applies (CelebrationWishService): the same people as the Celebrations
-- list (active, in the sender's own company), only on the day for a birthday or an
-- anniversary, within the first 30 days for a welcome, and no birthday wishes in a company
-- that hides birthdays (V143.89).
--
-- Safety. A new table, read and written with JDBC only (no JPA entity maps it), so nothing
-- that exists today changes. Until this file is applied the wishes endpoints answer 503
-- FEATURE_NOT_READY and the website and the app hide "Send wishes". No grant changes to
-- existing tables and no new permission (anyone who can see Celebrations can send), so
-- OwnerPermissionInvariantCheck is unaffected.
--
-- Numbered 143.84 (reserved). Idempotent (IF NOT EXISTS, guarded DO blocks). Production has
-- Flyway OFF: apply by hand, as the table owner (a superuser: row-level security and grants).

CREATE TABLE IF NOT EXISTS hrms.celebration_wishes (
    id                UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    company_id        UUID          NOT NULL,
    from_employee_id  UUID          NOT NULL,
    to_employee_id    UUID          NOT NULL,
    occasion          VARCHAR(20)   NOT NULL,
    occasion_date     DATE          NOT NULL,
    message           VARCHAR(280)  NOT NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT pk_celebration_wishes PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_celebration_wishes_once UNIQUE (tenant_id, from_employee_id, to_employee_id, occasion, occasion_date),
    CONSTRAINT ck_celebration_wishes_occasion CHECK (occasion IN ('BIRTHDAY', 'ANNIVERSARY', 'WELCOME')),
    CONSTRAINT ck_celebration_wishes_not_self CHECK (from_employee_id <> to_employee_id),
    CONSTRAINT ck_celebration_wishes_message CHECK (char_length(btrim(message)) BETWEEN 1 AND 280)
);

-- "Who wished me" (newest first). The unique constraint above serves "who I wished".
CREATE INDEX IF NOT EXISTS idx_celebration_wishes_to
    ON hrms.celebration_wishes (tenant_id, to_employee_id, created_at DESC);

COMMENT ON TABLE hrms.celebration_wishes IS
    'Wishes one colleague sent another from Celebrations: a birthday, a work anniversary or a welcome, with a short plain-text message (V143.84). One per sender, person, occasion and date. JDBC only.';
COMMENT ON COLUMN hrms.celebration_wishes.occasion_date IS
    'The day the wish is for: the birthday or work anniversary (always the day it was sent), or the joining date for a welcome.';

ALTER TABLE hrms.celebration_wishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.celebration_wishes FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'hrms' AND tablename = 'celebration_wishes'
                      AND policyname = 'tenant_isolation_celebration_wishes') THEN
        CREATE POLICY tenant_isolation_celebration_wishes ON hrms.celebration_wishes
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id());
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') THEN
        GRANT USAGE ON SCHEMA hrms TO ut_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON hrms.celebration_wishes TO ut_app;
    ELSE
        RAISE NOTICE 'V143.84: role ut_app not present — grants skipped';
    END IF;
END $$;
