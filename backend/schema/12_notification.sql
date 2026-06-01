-- =============================================================================
-- MODULE: hrms-notification
-- Tables: notifications
-- Purpose: Unified notification store for all delivery channels.
--          Produced by every other module via Spring Application Events.
--          Consumed by NotificationDispatchService (email/SMS/push/in-app).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: notifications
-- type (NotificationType):
--   LEAVE_REQUEST | LEAVE_APPROVED | LEAVE_REJECTED |
--   PAYSLIP_AVAILABLE | ATTENDANCE_ALERT |
--   EXPENSE_SUBMITTED | EXPENSE_APPROVED |
--   INTERVIEW_SCHEDULED | OFFER_EXTENDED |
--   GOAL_DUE | COURSE_ASSIGNED | GENERAL
--
-- channel (NotificationChannel): EMAIL | SMS | IN_APP | PUSH
--
-- reference_id + reference_type: polymorphic link back to the source entity.
--   e.g. reference_type=LEAVE_REQUEST, reference_id=<leave_requests.id>
--
-- action_url: deep-link URL opened when user taps the notification in the app.
-- is_sent: false until the dispatcher confirms delivery via provider API.
-- is_read: in-app read status; irrelevant for EMAIL/SMS channels.
-- -----------------------------------------------------------------------------
CREATE TABLE notifications (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    recipient_id   UUID          NOT NULL,   -- → employees.id
    type           VARCHAR(60)   NOT NULL,   -- see NotificationType enum above
    title          VARCHAR(300)  NOT NULL,
    body           TEXT,
    channel        VARCHAR(30),              -- EMAIL | SMS | IN_APP | PUSH
    is_read        BOOLEAN       NOT NULL DEFAULT false,
    read_at        TIMESTAMPTZ,
    reference_id   UUID,                    -- polymorphic source entity ID
    reference_type VARCHAR(60),             -- e.g. LEAVE_REQUEST, PAYSLIP, INTERVIEW
    action_url     TEXT,                    -- deep-link for mobile/web
    is_sent        BOOLEAN       NOT NULL DEFAULT false,
    sent_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by     VARCHAR(255),
    updated_by     VARCHAR(255),
    version        BIGINT        NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient  ON notifications (recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant     ON notifications (tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_reference  ON notifications (reference_id, reference_type);
CREATE INDEX IF NOT EXISTS idx_notifications_unsent     ON notifications (is_sent, channel) WHERE is_sent = false;

COMMENT ON COLUMN notifications.reference_type IS 'Source entity type: LEAVE_REQUEST | PAYSLIP | INTERVIEW | EXPENSE_CLAIM | GOAL | COURSE | etc.';
COMMENT ON COLUMN notifications.is_sent        IS 'True once delivery confirmed by email/SMS/push provider.';
COMMENT ON COLUMN notifications.action_url     IS 'Deep link opened when user taps notification. e.g. /leaves/123/review';
