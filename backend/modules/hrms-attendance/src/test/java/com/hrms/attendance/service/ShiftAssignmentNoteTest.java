package com.hrms.attendance.service;

import com.hrms.attendance.dto.ShiftDtos.AssignShiftRequest;
import com.hrms.attendance.entity.EmployeeShiftAssignment;
import com.hrms.attendance.entity.ShiftPolicy;
import com.hrms.attendance.repository.EmployeeShiftAssignmentRepository;
import com.hrms.attendance.repository.ShiftPolicyRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * The Change-shift drawer's note is kept with the assignment (V143.25) and an
 * approved shift change request leaves the employee's reason on it, so the
 * shift history can say why each change happened.
 */
class ShiftAssignmentNoteTest {

    private final ShiftPolicyRepository policies = mock(ShiftPolicyRepository.class);
    private final EmployeeShiftAssignmentRepository assignments = mock(EmployeeShiftAssignmentRepository.class);
    private final EmployeeShiftService service = new EmployeeShiftService(policies, assignments);
    private final UUID employee = UUID.randomUUID();

    private ShiftPolicy policy(String name) {
        ShiftPolicy p = new ShiftPolicy();
        p.setId(UUID.randomUUID());
        p.setName(name);
        p.setActive(true);
        when(policies.findById(p.getId())).thenReturn(Optional.of(p));
        return p;
    }

    @Test void aNewAssignmentKeepsTheNoteHrTyped() {
        ShiftPolicy night = policy("Night");
        when(assignments.findByEmployeeIdAndEffectiveToIsNull(employee)).thenReturn(List.of());
        when(assignments.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.assignShift(employee, new AssignShiftRequest(night.getId(), LocalDate.of(2026, 10, 1),
                "  Swapped with Vikram\nfor the quarter  "));

        ArgumentCaptor<EmployeeShiftAssignment> saved = ArgumentCaptor.forClass(EmployeeShiftAssignment.class);
        verify(assignments).save(saved.capture());
        assertEquals("Swapped with Vikram for the quarter", saved.getValue().getNote());
    }

    @Test void replacingTodaysAssignmentReplacesItsNoteToo() {
        ShiftPolicy morning = policy("Morning");
        EmployeeShiftAssignment today = new EmployeeShiftAssignment();
        today.setEmployeeId(employee);
        today.setShiftPolicyId(UUID.randomUUID());
        today.setEffectiveFrom(LocalDate.of(2026, 9, 25));
        today.setNote("First try");
        when(assignments.findByEmployeeIdAndEffectiveToIsNull(employee)).thenReturn(List.of(today));
        when(assignments.save(today)).thenReturn(today);

        service.assignShift(employee, new AssignShiftRequest(morning.getId(), today.getEffectiveFrom(), "Bus timings"));

        assertEquals(morning.getId(), today.getShiftPolicyId());
        assertEquals("Bus timings", today.getNote());
    }

    @Test void noNoteMeansNullNotBlank() {
        ShiftPolicy general = policy("General");
        when(assignments.findByEmployeeIdAndEffectiveToIsNull(employee)).thenReturn(List.of());
        when(assignments.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.assignShift(employee, new AssignShiftRequest(general.getId(), LocalDate.of(2026, 10, 1)));
        service.assignShift(employee, new AssignShiftRequest(general.getId(), LocalDate.of(2026, 10, 2), "   "));

        ArgumentCaptor<EmployeeShiftAssignment> saved = ArgumentCaptor.forClass(EmployeeShiftAssignment.class);
        verify(assignments, times(2)).save(saved.capture());
        saved.getAllValues().forEach(a -> assertNull(a.getNote()));
    }

    @Test void theNoteIsCutToTheColumnWidth() {
        assertEquals(500, EmployeeShiftService.assignmentNote("x".repeat(900)).length());
        assertNull(EmployeeShiftService.assignmentNote(null));
        assertNull(EmployeeShiftService.assignmentNote(" \t\n "));
        assertEquals("a b", EmployeeShiftService.assignmentNote("a\r\n\tb"));
    }

    @Test void anApprovedRequestLeavesTheEmployeesReasonOnTheAssignment() {
        assertEquals("Approved shift change request: My bus timings changed",
                ShiftChangeRequestService.assignmentNote("  My bus timings changed "));
        assertEquals("Approved shift change request", ShiftChangeRequestService.assignmentNote(null));
        assertEquals("Approved shift change request", ShiftChangeRequestService.assignmentNote("  "));
        assertEquals(500, ShiftChangeRequestService.assignmentNote("y".repeat(600)).length());
    }

    @Test void theTwoArgumentRequestStillWorksForOlderCallers() {
        AssignShiftRequest r = new AssignShiftRequest(UUID.randomUUID(), LocalDate.of(2026, 9, 1));
        assertNull(r.note());
    }
}
