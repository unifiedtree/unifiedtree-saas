package com.hrms.attendance.service;

import com.hrms.attendance.dto.ShiftDtos.AssignShiftRequest;
import com.hrms.attendance.dto.ShiftDtos.EmployeeShiftResponse;
import com.hrms.attendance.entity.EmployeeShiftAssignment;
import com.hrms.attendance.entity.ShiftPolicy;
import com.hrms.attendance.repository.EmployeeShiftAssignmentRepository;
import com.hrms.attendance.repository.ShiftPolicyRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A reassignment can be future-dated ("night shift from next Monday"). The
 * service closes the previous row the day before the new one starts, which
 * leaves the FUTURE row as the only open-ended one. "Current shift" must
 * therefore mean "in force today", never "the open row" — otherwise the
 * profile, roster and change-request baseline all jump to the new shift the
 * moment HR schedules it, while the date-aware team schedule still shows the
 * old one. These tests pin that contract.
 */
class EmployeeShiftServiceTest {

    private final ShiftPolicyRepository policyRepo = mock(ShiftPolicyRepository.class);
    private final EmployeeShiftAssignmentRepository assignmentRepo = mock(EmployeeShiftAssignmentRepository.class);
    private final EmployeeShiftService service = new EmployeeShiftService(policyRepo, assignmentRepo);

    private final UUID employeeId = UUID.randomUUID();
    private final UUID generalId = UUID.randomUUID();
    private final UUID nightId = UUID.randomUUID();
    private final LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));

    private ShiftPolicy policy(UUID id, String name) {
        ShiftPolicy p = new ShiftPolicy();
        p.setId(id); // assignShift copies policy.getId() onto the new assignment row
        p.setName(name);
        p.setActive(true);
        when(policyRepo.findById(id)).thenReturn(Optional.of(p));
        return p;
    }

    private EmployeeShiftAssignment assignment(UUID policyId, LocalDate from, LocalDate to) {
        EmployeeShiftAssignment a = new EmployeeShiftAssignment();
        a.setEmployeeId(employeeId);
        a.setShiftPolicyId(policyId);
        a.setEffectiveFrom(from);
        a.setEffectiveTo(to);
        return a;
    }

    @Test
    void scheduledChangeIsReportedAsUpcomingNotCurrent() {
        policy(generalId, "General");
        policy(nightId, "Night");
        EmployeeShiftAssignment inForce = assignment(generalId, today.minusDays(30), today.plusDays(6));
        EmployeeShiftAssignment scheduled = assignment(nightId, today.plusDays(7), null);
        when(assignmentRepo.findEffectiveOn(employeeId, today)).thenReturn(List.of(inForce));
        when(assignmentRepo.findFirstByEmployeeIdAndEffectiveFromAfterOrderByEffectiveFromAsc(employeeId, today))
                .thenReturn(Optional.of(scheduled));
        // The old contract would have returned this — the open row — as current.
        when(assignmentRepo.findFirstByEmployeeIdAndEffectiveToIsNullOrderByEffectiveFromDesc(employeeId))
                .thenReturn(Optional.of(scheduled));

        EmployeeShiftResponse r = service.getCurrentShift(employeeId);

        assertEquals("General", r.shiftName());
        assertEquals(today.minusDays(30), r.effectiveFrom());
        assertEquals(today.plusDays(6), r.effectiveTo());
        assertEquals("Night", r.upcomingShiftName());
        assertEquals(today.plusDays(7), r.upcomingEffectiveFrom());
    }

    @Test
    void nothingInForceYetButAChangeIsScheduled() {
        policy(nightId, "Night");
        EmployeeShiftAssignment scheduled = assignment(nightId, today.plusDays(3), null);
        when(assignmentRepo.findEffectiveOn(employeeId, today)).thenReturn(List.of());
        when(assignmentRepo.findFirstByEmployeeIdAndEffectiveFromAfterOrderByEffectiveFromAsc(employeeId, today))
                .thenReturn(Optional.of(scheduled));

        EmployeeShiftResponse r = service.getCurrentShift(employeeId);

        assertNull(r.shiftPolicyId());
        assertNull(r.shiftName());
        assertEquals("Night", r.upcomingShiftName());
        assertEquals(today.plusDays(3), r.upcomingEffectiveFrom());
    }

    @Test
    void unassignedWhenNothingInForceOrScheduled() {
        when(assignmentRepo.findEffectiveOn(employeeId, today)).thenReturn(List.of());
        when(assignmentRepo.findFirstByEmployeeIdAndEffectiveFromAfterOrderByEffectiveFromAsc(employeeId, today))
                .thenReturn(Optional.empty());

        EmployeeShiftResponse r = service.getCurrentShift(employeeId);

        assertNull(r.shiftName());
        assertNull(r.effectiveFrom());
        assertNull(r.upcomingShiftPolicyId());
        assertNull(r.upcomingEffectiveFrom());
    }

    @Test
    void futureDatedAssignmentClosesTheCurrentOneTheDayBefore() {
        policy(nightId, "Night");
        EmployeeShiftAssignment current = assignment(generalId, today.minusDays(30), null);
        when(assignmentRepo.findByEmployeeIdAndEffectiveToIsNull(employeeId)).thenReturn(List.of(current));
        when(assignmentRepo.save(any(EmployeeShiftAssignment.class))).thenAnswer(inv -> inv.getArgument(0));

        EmployeeShiftResponse r = service.assignShift(employeeId, new AssignShiftRequest(nightId, today.plusDays(7)));

        assertEquals(today.plusDays(6), current.getEffectiveTo(), "previous assignment ends the day before the new one");
        ArgumentCaptor<EmployeeShiftAssignment> saved = ArgumentCaptor.forClass(EmployeeShiftAssignment.class);
        verify(assignmentRepo).save(saved.capture());
        assertEquals(today.plusDays(7), saved.getValue().getEffectiveFrom());
        assertNull(saved.getValue().getEffectiveTo());
        assertEquals(nightId, saved.getValue().getShiftPolicyId());
        assertEquals(today.plusDays(7), r.effectiveFrom(), "the response describes the assignment just made");
        verify(assignmentRepo).saveAll(eq(List.of(current)));
    }
}
