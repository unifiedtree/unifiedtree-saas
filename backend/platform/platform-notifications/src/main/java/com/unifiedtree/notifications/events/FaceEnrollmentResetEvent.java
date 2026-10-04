package com.unifiedtree.notifications.events;

import java.util.UUID;

/**
 * Published by the face module after HR or an admin reset someone's face
 * enrollment (templates deactivated, enrollment REVOKED). Handler produces
 * FACE_ENROLLMENT_RESET for the person, whose phone opens face enrollment
 * when they tap it.
 *
 * <p>{@code employeeId} is the notification recipient: the HR employee record
 * id, which is what {@code notif.notifications.user_id} and the device tokens
 * are keyed by. NOT the login id the face rows are keyed by — for anyone who
 * was invited the two differ, and a row stored under the login id never
 * reaches their phone or their Alerts list. For an account with no employee
 * record it is the account id, as the notifications controller falls back to.
 *
 * @param resetByEmployeeId who reset it (their employee record id), or null when unknown
 * @param reason            the reason the admin gave, or null when they gave none
 */
public record FaceEnrollmentResetEvent(
        UUID tenantId,
        UUID employeeId,
        UUID resetByEmployeeId,
        String reason
) {}
