package com.hrms.attendance.repository;

import com.hrms.attendance.entity.EmployeeShiftAssignment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Employee ↔ shift-policy assignments (attendance.employee_shift_assignments).
 *
 * <p>An employee's OPEN assignment is the row with {@code effective_to IS NULL}
 * (open-ended). Reassigning closes the old row (sets effective_to) and opens a
 * new one, so history is preserved. Since reassignments can be future-dated,
 * "open" and "in force today" are different questions: a change scheduled for
 * next Monday is open now but not in force until then — use
 * {@link #findEffectiveOn} for what applies on a given date.
 */
public interface EmployeeShiftAssignmentRepository extends JpaRepository<EmployeeShiftAssignment, UUID> {

    /** The employee's open (open-ended) assignment, if any — see the class note. */
    Optional<EmployeeShiftAssignment> findFirstByEmployeeIdAndEffectiveToIsNullOrderByEffectiveFromDesc(UUID employeeId);

    /**
     * The assignment in force on {@code date}: started on or before it and
     * either open-ended or ending on/after it. Same predicate the team
     * schedule SQL uses, so the shift shown here and the shift on the roster
     * for that day can never disagree.
     */
    @Query("""
            select a from EmployeeShiftAssignment a
            where a.employeeId = :employeeId
              and a.effectiveFrom <= :date
              and (a.effectiveTo is null or a.effectiveTo >= :date)
            order by a.effectiveFrom desc
            """)
    List<EmployeeShiftAssignment> findEffectiveOn(@Param("employeeId") UUID employeeId, @Param("date") LocalDate date);

    /** The next assignment starting after {@code date} (a scheduled reassignment), if any. */
    Optional<EmployeeShiftAssignment> findFirstByEmployeeIdAndEffectiveFromAfterOrderByEffectiveFromAsc(UUID employeeId, LocalDate date);

    /** All open-ended assignments for an employee (should be at most one; used to close stragglers). */
    List<EmployeeShiftAssignment> findByEmployeeIdAndEffectiveToIsNull(UUID employeeId);

    /**
     * Count employees currently (open-endedly) assigned to a shift. Used by
     * {@code DELETE /v1/shifts/{id}} to refuse deletion (409 SHIFT_IN_USE) when
     * anyone still points at the shift being removed.
     */
    long countByShiftPolicyIdAndEffectiveToIsNull(UUID shiftPolicyId);
}
