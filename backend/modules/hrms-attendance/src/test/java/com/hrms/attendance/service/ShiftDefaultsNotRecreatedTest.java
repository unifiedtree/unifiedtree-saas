package com.hrms.attendance.service;

import com.hrms.attendance.dto.ShiftDtos.ShiftPolicyResponse;
import com.hrms.attendance.entity.EmployeeShiftAssignment;
import com.hrms.attendance.entity.ShiftPolicy;
import com.hrms.attendance.enums.ShiftType;
import com.hrms.attendance.repository.EmployeeShiftAssignmentRepository;
import com.hrms.attendance.repository.ShiftPolicyRepository;
import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * BW-33: reading the shift list must not bring back default shifts an admin
 * archived or renamed. Defaults are created once, only for a company that has
 * never had a shift (archived ones count). Also the end of a temporary shift
 * change for someone with no previous shift ({@code endAssignment}, BW-31).
 */
class ShiftDefaultsNotRecreatedTest {

    private final ShiftPolicyRepository repo = mock(ShiftPolicyRepository.class);
    private final EmployeeShiftAssignmentRepository assignments = mock(EmployeeShiftAssignmentRepository.class);
    private final EmployeeShiftService service = new EmployeeShiftService(repo, assignments);
    private final UUID company = UUID.randomUUID();

    private ShiftPolicy shift(String name, boolean active) {
        ShiftPolicy p = new ShiftPolicy();
        p.setId(UUID.randomUUID());
        p.setCompanyId(company);
        p.setName(name);
        p.setActive(active);
        p.setShiftType(ShiftType.FIXED);
        p.setStartTime(LocalTime.of(9, 0));
        p.setEndTime(LocalTime.of(17, 0));
        return p;
    }

    @Test void archivedDefaultsStayArchivedWhenEveryShiftIsArchived() {
        List<ShiftPolicy> archived = List.of(shift("General", false), shift("Morning", false), shift("Afternoon", false), shift("Night", false));
        when(repo.findByCompanyIdAndActiveTrue(company)).thenReturn(List.of());
        when(repo.countByCompanyId(company)).thenReturn(4L);
        when(repo.findByCompanyId(company)).thenReturn(archived);

        List<ShiftPolicyResponse> listed = service.listShifts(company);

        assertTrue(listed.isEmpty());
        verify(repo, never()).save(any());
    }

    @Test void aRenamedOrArchivedDefaultIsNotAddedBackBesideTheOthers() {
        ShiftPolicy renamed = shift("Day shift", true); // was "General"
        List<ShiftPolicy> active = List.of(renamed, shift("Night", true));
        when(repo.findByCompanyIdAndActiveTrue(company)).thenReturn(active);
        when(repo.countByCompanyId(company)).thenReturn(4L);
        when(repo.findByCompanyId(company)).thenReturn(List.of(renamed, active.get(1), shift("Morning", false), shift("Afternoon", false)));

        List<ShiftPolicyResponse> listed = service.listShifts(company);

        assertEquals(List.of("Day shift", "Night"), listed.stream().map(ShiftPolicyResponse::name).toList());
        verify(repo, never()).save(any());
    }

    @Test void aCompanyThatNeverHadAShiftGetsTheDefaultsOnce() {
        when(repo.findByCompanyIdAndActiveTrue(company)).thenReturn(List.of());
        when(repo.countByCompanyId(company)).thenReturn(0L);
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));

        service.listShifts(company);

        ArgumentCaptor<ShiftPolicy> saved = ArgumentCaptor.forClass(ShiftPolicy.class);
        verify(repo, times(4)).save(saved.capture());
        assertEquals(List.of("General", "Morning", "Afternoon", "Night"), saved.getAllValues().stream().map(ShiftPolicy::getName).toList());
    }

    @Test void theListHasNoHeadCountOfItsOwn() {
        when(repo.findByCompanyIdAndActiveTrue(company)).thenReturn(List.of(shift("General", true)));
        when(repo.findByCompanyId(company)).thenReturn(List.of(shift("General", true)));
        // The controller adds employeeCount; the service's shape is unchanged.
        assertNull(service.listShifts(company).get(0).employeeCount());
    }

    @Test void endAssignmentClosesOnlyTheMatchingOpenAssignment() {
        UUID employee = UUID.randomUUID(), night = UUID.randomUUID();
        LocalDate from = LocalDate.of(2026, 10, 5);
        EmployeeShiftAssignment open = new EmployeeShiftAssignment();
        open.setEmployeeId(employee);
        open.setShiftPolicyId(night);
        open.setEffectiveFrom(from);
        when(assignments.findByEmployeeIdAndEffectiveToIsNull(employee)).thenReturn(List.of(open));

        assertFalse(service.endAssignment(employee, UUID.randomUUID(), from, from.plusDays(4)), "another shift: untouched");
        assertFalse(service.endAssignment(employee, night, from.plusDays(1), from.plusDays(4)), "another start: untouched");
        assertNull(open.getEffectiveTo());

        assertTrue(service.endAssignment(employee, night, from, from.plusDays(4)));
        assertEquals(from.plusDays(4), open.getEffectiveTo());
        verify(assignments).save(open);

        assertEquals("SHIFT_DATE_INVALID", assertThrows(BusinessRuleException.class,
                () -> service.endAssignment(employee, night, from, from.minusDays(1))).getErrorCode());
    }
}
