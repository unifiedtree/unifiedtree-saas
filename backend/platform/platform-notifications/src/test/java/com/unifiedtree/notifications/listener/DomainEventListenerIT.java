package com.unifiedtree.notifications.listener;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

/**
 * B10 — DomainEventListener leave-approved fan-out integration test.
 *
 * <p>Regression guard for the AFTER_COMMIT + tenant-GUC fan-out path
 * (memory: rls-after-commit-trap and notifications-architecture). If any of
 * these break, the mobile Alerts tab silently stays empty and the push
 * fan-out never fires — historically our worst class of "works locally,
 * silent in prod" bug.
 *
 * <p><b>Under test.</b> When a {@code LeaveDecidedEvent} with
 * {@code approved=true} is published through {@code ApplicationEventPublisher}
 * inside a live transaction, {@code DomainEventListener#onLeaveDecided}
 * (registered on {@code TransactionPhase.AFTER_COMMIT}) must:
 * <ol>
 *   <li>INSERT one row into {@code notif.notifications} with
 *       {@code type = 'LEAVE_APPROVED'}, {@code user_id = event.employeeId},
 *       {@code tenant_id = event.tenantId}.</li>
 *   <li>Queue a push job for that recipient via {@code ExpoPushSender}
 *       (assert on either a captured argument via {@code @SpyBean} on
 *       ExpoPushSender, or the persisted push-audit row if wired).</li>
 * </ol>
 *
 * <p><b>Naming note.</b> The B10 brief calls this a "LeaveApprovedEvent",
 * but the actual event class is {@link com.unifiedtree.notifications.events.LeaveDecidedEvent}
 * with an {@code approved()} boolean that the listener maps to
 * {@code AppNotificationType.LEAVE_APPROVED} vs {@code LEAVE_REJECTED}.
 * A dedicated {@code LeaveApprovedEvent} class does not exist; we exercise
 * the approved branch via {@code approved=true}.
 *
 * <p><b>Wiring notes for whoever enables this:</b>
 * <ul>
 *   <li>Boot via {@code hrms-app} test app entry-point ({@code HrmsApp} +
 *       {@code AbstractIntegrationTest}) — {@code platform-notifications}
 *       has no runnable Spring Boot main and its listener depends on
 *       {@code NotificationLookupService} (which requires the full canonical
 *       Flyway migrations for {@code hrms.employees} + {@code rbac.*}).</li>
 *   <li>Publish inside a {@code TransactionTemplate} block so
 *       {@code TransactionPhase.AFTER_COMMIT} actually fires. Publishing from
 *       outside a live sync now works too (the listener uses
 *       {@code fallbackExecution=true}) but the production trigger site is
 *       always inside a leave-approval tx.</li>
 *   <li>Set {@code app.tenant_id} on the same connection before the block
 *       (see {@code AbstractIntegrationTest.withTenantJdbc}) so RLS on
 *       {@code notif.notifications} does not silently reject the INSERT.</li>
 *   <li>Assert the INSERT went through with {@code jdbc.queryForObject(
 *       "SELECT count(*) FROM notif.notifications WHERE type=? AND user_id=?",
 *       ...)}.</li>
 * </ul>
 *
 * @see com.unifiedtree.notifications.listener.DomainEventListener
 * @see com.unifiedtree.notifications.events.LeaveDecidedEvent
 */
class DomainEventListenerIT {

    @Test
    @Disabled(
        "TODO(B10): needs Testcontainers Postgres + canonical Flyway seed "
        + "+ hrms-app HrmsApp Spring context (this module has no boot main). "
        + "Verify AFTER_COMMIT fires inside a real tx and push job is queued.")
    void leaveApprovedEventCreatesNotificationAndQueuesPush() {
        // GIVEN: seed one tenant + one employee with a resolvable email
        //        AND a live TransactionTemplate that sets SET LOCAL app.tenant_id
        // WHEN:  ApplicationEventPublisher.publishEvent(new LeaveDecidedEvent(
        //          tenantId, employeeId, approverId, leaveRequestId,
        //          leaveTypeName, startDate, endDate, /* approved= */ true, null))
        //        AND the enclosing transaction COMMITs
        // THEN:  notif.notifications has one row with:
        //          - type       = 'LEAVE_APPROVED'
        //          - user_id    = employeeId
        //          - tenant_id  = tenantId
        //          - data->>'leaveRequestId' = leaveRequestId
        //        AND ExpoPushSender was invoked once for employeeId
        //          (assert via @SpyBean or the push-audit table if wired)
        throw new UnsupportedOperationException("skeleton — see @Disabled reason");
    }
}
