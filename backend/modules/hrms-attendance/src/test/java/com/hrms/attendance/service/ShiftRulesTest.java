package com.hrms.attendance.service;

import com.hrms.attendance.dto.ShiftDtos.ShiftPolicyRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftPolicyResponse;
import com.hrms.attendance.entity.ShiftPolicy;
import com.hrms.attendance.enums.ShiftType;
import com.hrms.attendance.repository.EmployeeShiftAssignmentRepository;
import com.hrms.attendance.repository.ShiftPolicyRepository;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Shift code, core hours, weekly offs and the Standard 9-6 to General rule (V143.23). */
class ShiftRulesTest {

    private final ShiftPolicyRepository repo = mock(ShiftPolicyRepository.class);
    private final EmployeeShiftService service = new EmployeeShiftService(repo, mock(EmployeeShiftAssignmentRepository.class));
    private final UUID company = UUID.randomUUID();

    private static ShiftPolicyRequest req(ShiftType type, String code, LocalTime coreStart, LocalTime coreEnd, List<Integer> offs) {
        return new ShiftPolicyRequest("Flexi", type, LocalTime.of(8, 0), LocalTime.of(20, 0), 0, 8.0, false, null,
                code, coreStart, coreEnd, offs);
    }

    private ShiftPolicy shift(String name, String code, boolean active) {
        ShiftPolicy p = new ShiftPolicy();
        p.setId(UUID.randomUUID());
        p.setCompanyId(company);
        p.setName(name);
        p.setCode(code);
        p.setActive(active);
        p.setShiftType(ShiftType.FIXED);
        return p;
    }

    @Test void weeklyOffsAreStoredAsSortedIsoDaysAndNeedAWorkingDay() {
        assertEquals("6,7", EmployeeShiftService.weeklyOffCsv(List.of(7, 6, 7)));
        assertNull(EmployeeShiftService.weeklyOffCsv(List.of()));
        assertEquals(List.of(6, 7), EmployeeShiftService.weeklyOffList("6,7"));
        assertNull(EmployeeShiftService.weeklyOffList(" "));
        assertThrows(BusinessRuleException.class, () -> EmployeeShiftService.weeklyOffCsv(List.of(0)));
        assertThrows(BusinessRuleException.class, () -> EmployeeShiftService.weeklyOffCsv(List.of(1, 2, 3, 4, 5, 6, 7)));
    }

    @Test void coreHoursMustRunForwardsInsideTheShift() {
        EmployeeShiftService.validateCoreHours(LocalTime.of(8, 0), LocalTime.of(20, 0), LocalTime.of(11, 0), LocalTime.of(16, 0));
        assertEquals("SHIFT_CORE_INVALID", assertThrows(BusinessRuleException.class, () -> EmployeeShiftService.validateCoreHours(
                LocalTime.of(8, 0), LocalTime.of(20, 0), LocalTime.of(16, 0), LocalTime.of(11, 0))).getErrorCode());
        assertEquals("SHIFT_CORE_OUTSIDE", assertThrows(BusinessRuleException.class, () -> EmployeeShiftService.validateCoreHours(
                LocalTime.of(8, 0), LocalTime.of(20, 0), LocalTime.of(7, 0), LocalTime.of(16, 0))).getErrorCode());
    }

    @Test void aFlexibleShiftIsSavedWithItsCodeCoreHoursAndWeeklyOffs() {
        when(repo.findByCompanyIdAndActiveTrue(company)).thenReturn(List.of());
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        ShiftPolicyResponse r = service.createShift(company,
                req(ShiftType.FLEXIBLE, " flx-1 ", LocalTime.of(11, 0), LocalTime.of(16, 0), List.of(6, 7)));
        assertEquals("FLX-1", r.code());
        assertEquals(LocalTime.of(11, 0), r.coreStartTime());
        assertEquals(LocalTime.of(16, 0), r.coreEndTime());
        assertEquals(List.of(6, 7), r.weeklyOffDays());
    }

    @Test void coreHoursAreDroppedWhenTheShiftIsNotFlexible() {
        when(repo.findByCompanyIdAndActiveTrue(company)).thenReturn(List.of());
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        ShiftPolicyResponse r = service.createShift(company,
                req(ShiftType.FIXED, null, LocalTime.of(11, 0), LocalTime.of(16, 0), null));
        assertNull(r.coreStartTime());
        assertNull(r.weeklyOffDays());
    }

    @Test void aCodeAnotherActiveShiftUsesIsRefused() {
        when(repo.findByCompanyIdAndActiveTrue(company)).thenReturn(List.of(shift("General", "GEN", true)));
        HrmsException e = assertThrows(HrmsException.class, () -> service.createShift(company,
                req(ShiftType.FIXED, "gen", null, null, null)));
        assertEquals("SHIFT_CODE_DUPLICATE", e.getErrorCode());
        verify(repo, never()).save(any());
    }

    @Test void anUpdateThatLeavesTheNewFieldsOutKeepsThem() {
        ShiftPolicy existing = shift("Flexi", "FLX", true);
        existing.setShiftType(ShiftType.FLEXIBLE);
        existing.setStartTime(LocalTime.of(8, 0));
        existing.setEndTime(LocalTime.of(20, 0));
        existing.setCoreStartTime(LocalTime.of(11, 0));
        existing.setCoreEndTime(LocalTime.of(16, 0));
        existing.setWeeklyOffDays("7");
        when(repo.findById(existing.getId())).thenReturn(Optional.of(existing));
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        // The pre-V143.23 request shape (the kit Shift rules tab) sends none of them.
        ShiftPolicyResponse r = service.updateShift(existing.getId(),
                new ShiftPolicyRequest("Flexi 2", null, null, null, 10, null, null, null));
        assertEquals("Flexi 2", r.name());
        assertEquals("FLX", r.code());
        assertEquals(LocalTime.of(11, 0), r.coreStartTime());
        assertEquals(List.of(7), r.weeklyOffDays());
    }

    @Test void aCompanyWithOnlyTheSignupShiftGetsGeneralOnce() {
        when(repo.findByCompanyId(company)).thenReturn(List.of(shift("Standard 9-6", null, true)));
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        assertTrue(service.addGeneralForLegacyOnly(company));
        ArgumentCaptor<ShiftPolicy> saved = ArgumentCaptor.forClass(ShiftPolicy.class);
        verify(repo, atLeastOnce()).save(saved.capture());
        ShiftPolicy general = saved.getValue();
        assertEquals("General", general.getName());
        assertEquals("GEN", general.getCode());
        assertEquals(LocalTime.of(9, 0), general.getStartTime());

        // Any other shift (General included, archived or not) means it was already handled.
        reset(repo);
        when(repo.findByCompanyId(company)).thenReturn(List.of(shift("Standard 9-6", null, true), shift("General", "GEN", false)));
        assertFalse(service.addGeneralForLegacyOnly(company));
        verify(repo, never()).save(any());
    }
}
