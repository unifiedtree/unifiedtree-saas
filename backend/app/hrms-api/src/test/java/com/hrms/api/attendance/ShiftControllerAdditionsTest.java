package com.hrms.api.attendance;

import com.hrms.attendance.dto.ShiftDtos.ShiftPolicyResponse;
import com.hrms.attendance.enums.ShiftType;
import com.hrms.attendance.service.EmployeeShiftService;
import com.hrms.attendance.service.ShiftChangeRequestService;
import com.hrms.attendance.service.ShiftHistoryService;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** BW-32 people per shift on GET /v1/shifts, and BW-34 withdraw on the controller. */
class ShiftControllerAdditionsTest {

    private final EmployeeShiftService shifts = mock(EmployeeShiftService.class);
    private final ShiftChangeRequestService requests = mock(ShiftChangeRequestService.class);
    private final ShiftHeadcount headcount = mock(ShiftHeadcount.class);
    private final ShiftController controller = new ShiftController(shifts, requests, mock(TeamEmployeeScope.class), mock(ShiftHistoryService.class));
    private final UUID company = UUID.randomUUID();

    private static ShiftPolicyResponse shift(String name) {
        return new ShiftPolicyResponse(UUID.randomUUID(), name, ShiftType.FIXED, LocalTime.of(9, 0), LocalTime.of(17, 0), 15, 8.0,
                false, null, null, null, null, null);
    }

    @Test void eachShiftCarriesThePeopleOnItToday() {
        ShiftPolicyResponse general = shift("General"), night = shift("Night");
        when(shifts.listShifts(company)).thenReturn(List.of(general, night));
        when(headcount.byShift(company)).thenReturn(Map.of(general.id(), 41));
        ReflectionTestUtils.setField(controller, "headcount", headcount);

        List<ShiftPolicyResponse> out = controller.list(company).getBody();

        assertEquals(41, out.get(0).employeeCount());
        assertEquals(0, out.get(1).employeeCount(), "a shift nobody is on");
        assertEquals(general.withEmployeeCount(41), out.get(0), "every other field unchanged");
    }

    @Test void theListStillWorksWhenTheCountCannotBeRead() {
        ShiftPolicyResponse general = shift("General");
        when(shifts.listShifts(company)).thenReturn(List.of(general));
        when(headcount.byShift(company)).thenThrow(new IllegalStateException("boom"));
        ReflectionTestUtils.setField(controller, "headcount", headcount);

        assertEquals(List.of(general), controller.list(company).getBody());
    }

    @Test void withdrawIsTheCallersOwnWithTheSelfPermission() throws Exception {
        UUID me = UUID.randomUUID(), request = UUID.randomUUID();
        Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", me.toString()).build();

        controller.withdrawChange(jwt, request);

        verify(requests).withdraw(request, me);
        String guard = ShiftController.class.getMethod("withdrawChange", Jwt.class, UUID.class).getAnnotation(PreAuthorize.class).value();
        assertEquals("hasAuthority('attendance.checkin.self')", guard);
        verify(requests, never()).decide(any(), any(), any());
    }

    @Test void theHeadCountQueryCountsStillEmployedPeopleByTheShiftInForceToday() {
        assertTrue(ShiftHeadcount.SQL.contains("a.effective_from <= :today"));
        assertTrue(ShiftHeadcount.SQL.contains("(a.effective_to IS NULL OR a.effective_to >= :today)"));
        assertTrue(ShiftHeadcount.SQL.contains("e.company_id = :company"));
        assertTrue(ShiftHeadcount.SQL.contains("NOT IN ('TERMINATED', 'RESIGNED', 'RETIRED', 'EXITED')"));
    }
}
