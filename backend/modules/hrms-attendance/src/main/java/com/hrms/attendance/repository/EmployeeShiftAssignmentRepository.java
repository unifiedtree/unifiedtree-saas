package com.hrms.attendance.repository;

import com.hrms.attendance.entity.EmployeeShiftAssignment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Employee ↔ shift-policy assignments (attendance.employee_shift_assignments).
 *
 * <p>An employee's CURRENT shift is the row with {@code effective_to IS NULL}
 * (open-ended). Reassigning closes the old row (sets effective_to) and opens a
 * new one, so history is preserved.
 */
public interface EmployeeShiftAssignmentRepository extends JpaRepository<EmployeeShiftAssignment, UUID> {

    /** The employee's current (open-ended) assignment, if any. */
    Optional<EmployeeShiftAssignment> findFirstByEmployeeIdAndEffectiveToIsNullOrderByEffectiveFromDesc(UUID employeeId);

    /** All open-ended assignments for an employee (should be at most one; used to close stragglers). */
    List<EmployeeShiftAssignment> findByEmployeeIdAndEffectiveToIsNull(UUID employeeId);
}
