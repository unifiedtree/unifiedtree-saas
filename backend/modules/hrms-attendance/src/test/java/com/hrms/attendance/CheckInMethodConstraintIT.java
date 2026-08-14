package com.hrms.attendance;

import com.hrms.attendance.enums.CheckInMethod;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * B10 — CheckInMethod enum vs. Postgres CHECK constraint drift guard
 * (memory: attendance-method-enum-constraint).
 *
 * <p><b>Why this test exists.</b> The Java {@code CheckInMethod} enum and
 * the {@code ck_attendance_records_check_in_method} /
 * {@code ck_attendance_records_check_out_method} CHECK constraints on
 * {@code attendance.records} must agree on the exact list of allowed
 * values. Live incident recap: adding {@code GPS} to the enum without
 * updating the DB check constraint 500'd every GPS check-out with a
 * {@code new row for relation "records" violates check constraint} error,
 * which superuser-run tests never surfaced because they bypass the
 * constraint enforcement path we saw. The lesson (recorded in memory)
 * was to reproduce the writes as the {@code ut_app} / {@code hrms_app}
 * (RLS-enforced) role.
 *
 * <p><b>Test shape.</b> As {@code hrms_app} (NOT the Testcontainers
 * superuser), insert one {@code attendance.records} row for each value
 * of {@link CheckInMethod}. Each insert must succeed. Any single failure
 * signals a drift the CHECK constraint has to be brought in line with —
 * either add the missing value to the constraint via a Flyway
 * migration, or remove it from the enum.
 *
 * <p><b>Wiring notes for whoever enables this:</b>
 * <ul>
 *   <li>Reuse the {@code hrms-app} test harness: {@code HrmsApp} boot,
 *       {@code AbstractIntegrationTest.withTenantJdbc(tenantId, block)}
 *       which already drops the role to {@code hrms_app} and sets
 *       {@code SET LOCAL app.tenant_id} — mandatory to reproduce the
 *       real prod insert path.</li>
 *   <li>Seed one tenant + one employee + a shift + a policy row so the
 *       {@code attendance.records} FK columns resolve.</li>
 *   <li>Loop over {@code CheckInMethod.values()} — do NOT hard-code the
 *       list; the whole point is the enum is the source of truth.</li>
 * </ul>
 *
 * @see com.hrms.attendance.enums.CheckInMethod
 * @see com.hrms.attendance.entity.AttendanceRecord
 */
class CheckInMethodConstraintIT {

    @Test
    void enumHasAllExpectedValues_sanityCheck() {
        // Pure sanity so a *removal* from the enum trips a compile-time or
        // test-time signal before we notice via a failing insert loop that
        // would only fire under the disabled integration variant below.
        assertThat(CheckInMethod.values())
            .as("CheckInMethod enum members — update this list AND the "
                + "attendance.records CHECK constraint together")
            .containsExactlyInAnyOrder(
                CheckInMethod.FACE_RECOGNITION,
                CheckInMethod.GPS,
                CheckInMethod.PIN,
                CheckInMethod.MANAGER_OVERRIDE,
                CheckInMethod.BIOMETRIC_DEVICE,
                CheckInMethod.MANUAL);
    }

    @Test
    @Disabled(
        "TODO(B10): needs Testcontainers Postgres + canonical Flyway migrations "
        + "+ hrms_app role (NOT superuser — see memory attendance-method-enum-constraint) "
        + "+ seed rows for tenant/employee/shift/policy so the FKs resolve.")
    void everyCheckInMethodValueInsertsSuccessfullyAsHrmsAppRole() {
        // WITH the RLS role hrms_app and app.tenant_id set:
        //   for each method in CheckInMethod.values():
        //     jdbc.update("""
        //         INSERT INTO attendance.records
        //           (id, tenant_id, employee_id, work_date,
        //            check_in_time, check_in_method, status, created_at)
        //         VALUES (?, ?, ?, ?, now(), ?::attendance_method, 'PRESENT', now())
        //         """, UUID.randomUUID(), tenantId, employeeId,
        //         LocalDate.now().plusDays(method.ordinal()), method.name());
        //     -- assert no exception thrown for THIS specific method value.
        // A CheckConstraintViolation on any value means the enum has drifted
        // past ck_attendance_records_check_in_method. Fix: add the missing
        // value in a new Flyway migration; do not weaken the constraint.
        throw new UnsupportedOperationException("skeleton — see @Disabled reason");
    }
}
