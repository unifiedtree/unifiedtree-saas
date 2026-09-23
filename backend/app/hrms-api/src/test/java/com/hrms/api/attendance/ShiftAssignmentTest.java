package com.hrms.api.attendance;

import com.hrms.attendance.dto.ShiftDtos.AssignShiftRequest;
import com.hrms.attendance.entity.EmployeeShiftAssignment;
import com.hrms.attendance.entity.ShiftPolicy;
import com.hrms.attendance.repository.EmployeeShiftAssignmentRepository;
import com.hrms.attendance.repository.ShiftPolicyRepository;
import com.hrms.attendance.service.EmployeeShiftService;
import org.junit.jupiter.api.Test;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ShiftAssignmentTest {
    @Test void sameDayReassignmentDoesNotCreateAnInvertedHistoricalPeriod() {
        var policies = mock(ShiftPolicyRepository.class);
        var assignments = mock(EmployeeShiftAssignmentRepository.class);
        var employee = UUID.randomUUID();
        var target = new ShiftPolicy(); target.setId(UUID.randomUUID()); target.setName("Morning");
        var existing = new EmployeeShiftAssignment();
        existing.setEmployeeId(employee); existing.setShiftPolicyId(UUID.randomUUID());
        existing.setEffectiveFrom(LocalDate.of(2026, 9, 22));
        when(policies.findById(target.getId())).thenReturn(Optional.of(target));
        when(assignments.findByEmployeeIdAndEffectiveToIsNull(employee)).thenReturn(List.of(existing));
        when(assignments.save(existing)).thenReturn(existing);
        var service = new EmployeeShiftService(policies, assignments);
        var result = service.assignShift(employee, new AssignShiftRequest(target.getId(), existing.getEffectiveFrom()));
        assertEquals(target.getId(), result.shiftPolicyId());
        assertNull(existing.getEffectiveTo());
        verify(assignments).save(existing);
        verify(assignments, never()).saveAll(any());
    }
}
