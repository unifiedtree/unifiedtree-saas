-- V143.12: notification templates are used, notification choices are honoured.
--
-- No schema change is needed:
--   * Templates stay in notiftemplate_mgmt.notification_templates. Senders now
--     read the active template for (company, event_key, channel) and fall back
--     to the built-in wording, which lives in code (NotificationEventCatalog).
--     So a new workspace has every default from its first minute: nothing to
--     seed, per tenant or otherwise.
--   * Per-user choices stay in auth.user_credentials.notification_preferences
--     (JSONB, V114). Per-event choices are stored under its "events" key.
--
-- This migration only:
--   1. gives the two template permissions a plain-English description; and
--   2. rewrites event keys saved in the old enum spelling (LEAVE_APPROVED) to
--      the key the senders use (leave.approved). The senders accept both, so
--      this is tidy-up, not a fix; it makes the template list read the same
--      as the event picker.
--
-- Idempotent. Numbered 143.12 so it cannot collide with a teammate's V144.

UPDATE rbac.permissions
   SET description = 'See the wording of notifications (in-app, push and email) and which template each company uses for each event.'
 WHERE code = 'hrms.notiftemplate.read'
   AND (description IS NULL OR btrim(description) = '');

UPDATE rbac.permissions
   SET description = 'Change the wording people receive in notifications and emails, including invitation and password-reset emails. Takes effect on the next message sent.'
 WHERE code = 'hrms.notiftemplate.write'
   AND (description IS NULL OR btrim(description) = '');

UPDATE notiftemplate_mgmt.notification_templates t
   SET event_key = m.event_key,
       updated_at = now()
  FROM (VALUES
        ('LEAVE_SUBMITTED', 'leave.submitted'),
        ('LEAVE_APPROVED', 'leave.approved'),
        ('LEAVE_REJECTED', 'leave.rejected'),
        ('LEAVE_CANCELLED', 'leave.cancelled'),
        ('WFH_SUBMITTED', 'wfh.submitted'),
        ('WFH_APPROVED', 'wfh.approved'),
        ('WFH_REJECTED', 'wfh.rejected'),
        ('WFH_CANCELLED', 'wfh.cancelled'),
        ('CORRECTION_SUBMITTED', 'attendance.correction_submitted'),
        ('CORRECTION_APPROVED', 'attendance.correction_approved'),
        ('CORRECTION_REJECTED', 'attendance.correction_rejected'),
        ('OVERTIME_APPROVED', 'attendance.overtime_approved'),
        ('OVERTIME_REJECTED', 'attendance.overtime_rejected'),
        ('FACE_ENROLLMENT_COMPLETE', 'attendance.face_enrolled'),
        ('FACE_ENROLLMENT_FAILED', 'attendance.face_enrolment_failed'),
        ('SHIFT_CHANGE_SUBMITTED', 'shift.change_submitted'),
        ('SHIFT_CHANGE_APPROVED', 'shift.change_approved'),
        ('SHIFT_CHANGE_REJECTED', 'shift.change_rejected'),
        ('EXPENSE_SUBMITTED', 'expense.submitted'),
        ('EXPENSE_APPROVED', 'expense.approved'),
        ('EXPENSE_REJECTED', 'expense.rejected'),
        ('ADVANCE_SUBMITTED', 'advance.submitted'),
        ('ADVANCE_APPROVED', 'advance.approved'),
        ('ADVANCE_REJECTED', 'advance.rejected'),
        ('DOCUMENT_UPLOADED', 'document.uploaded'),
        ('DOCUMENT_VERIFIED', 'document.verified'),
        ('DOCUMENT_REJECTED', 'document.rejected'),
        ('WELCOME', 'people.welcome')
       ) AS m(old_key, event_key)
 WHERE upper(t.event_key) = m.old_key;
