package com.hrms.api.attendance;

import com.hrms.attendance.dto.AttendanceDto;
import com.hrms.attendance.dto.ManualAttendanceRequest;
import com.hrms.attendance.dto.StaffStatusResponse;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The day register CSV (BW-19) and "Mark attendance" for several people
 * (BW-17).
 */
class RegisterAndBulkMarkTest {

    private static final LocalDate DAY = LocalDate.of(2026, 9, 28);
    /** A day already over, for "Mark attendance" (it refuses days that haven't happened). */
    private static final LocalDate PAST = LocalDate.of(2026, 9, 25);

    private static StaffStatusResponse row(String name, String effective, String type, Instant in, Instant out, Integer worked,
                                           boolean onLeave, String method, String leaveType) {
        return new StaffStatusResponse(UUID.randomUUID(), "E-1", name, null, null, "Engineering", null,
                "PRESENT", in, out, null, null, null, false, type, onLeave, "General", null, null, null, effective, null,
                false, false, false, false, false, null, worked,
                "Head office", method, onLeave ? leaveType : null, onLeave ? DAY : null, onLeave ? DAY : null, false);
    }

    // ── the register ─────────────────────────────────────────────────────────

    @Test void theRegisterHasTheDesignsColumnsAndOneLinePerPerson() {
        String csv = AttendanceRegisterController.csv(List.of(
                row("Asha Rao", "PRESENT", "OFFICE", Instant.parse("2026-09-28T03:50:00Z"), Instant.parse("2026-09-28T12:50:00Z"), 540, false, "FACE_RECOGNITION", null),
                row("Ravi Kumar", "LATE", "WFH", Instant.parse("2026-09-28T04:40:00Z"), null, null, false, "WEB", null),
                row("Sita Devi", "ON_LEAVE", null, null, null, null, true, null, "Casual leave")), DAY);
        String[] lines = csv.split("\r\n");
        assertEquals(AttendanceRegisterController.HEADER, lines[0]);
        assertEquals(4, lines.length);
        assertEquals("Asha Rao,E-1,Engineering,Head office,General,09:20,18:20,9.00,Present,Face", lines[1]);
        assertEquals("Ravi Kumar,E-1,Engineering,Head office,General,10:10,,,Late (work from home),Web", lines[2]);
        assertEquals("Sita Devi,E-1,Engineering,Head office,General,,,,On leave,Casual leave", lines[3]);
    }

    @Test void aNightShiftsCheckOutCarriesItsDate() {
        assertEquals("2026-09-29 06:10", AttendanceRegisterController.time(Instant.parse("2026-09-29T00:40:00Z"), DAY));
        assertEquals("21:00", AttendanceRegisterController.time(Instant.parse("2026-09-28T15:30:00Z"), DAY));
    }

    @Test void cellsAreQuotedAndFormulasDefused() {
        assertEquals("\"Rao, Asha\"", AttendanceRegisterController.cell("Rao, Asha"));
        assertEquals("\"say \"\"hi\"\"\"", AttendanceRegisterController.cell("say \"hi\""));
        assertEquals("'=SUM(A1)", AttendanceRegisterController.cell("=SUM(A1)"));
        assertEquals("'@cmd", AttendanceRegisterController.cell("@cmd"));
        assertEquals("-5", AttendanceRegisterController.cell("-5"));
        assertEquals("", AttendanceRegisterController.cell(null));
    }

    @Test void everyPunchMethodHasAPlainLabel() {
        assertEquals("Web", AttendanceRegisterController.methodLabel("WEB"));
        assertEquals("Added by HR", AttendanceRegisterController.methodLabel("MANAGER_OVERRIDE"));
        assertEquals("Mobile (GPS)", AttendanceRegisterController.methodLabel("GPS"));
        assertEquals("Face", AttendanceRegisterController.methodLabel("FACE_RECOGNITION"));
    }

    // ── mark attendance for several people ───────────────────────────────────

    private final AttendanceService attendance = mock(AttendanceService.class);
    private final AttendanceContextResolver contexts = mock(AttendanceContextResolver.class);
    private final EmployeeRepository employees = mock(EmployeeRepository.class);

    private Employee person(String first) {
        Employee e = new Employee();
        e.setId(UUID.randomUUID());
        e.setFirstName(first);
        e.setLastName("K");
        when(employees.findById(e.getId())).thenReturn(Optional.of(e));
        when(contexts.resolve(e.getId())).thenReturn(new AttendanceContextResolver.Context(e.getId(), UUID.randomUUID(),
                null, null, null, null, 100, null));
        return e;
    }

    private static ManualEntryBulkService.BulkRequest request(List<UUID> ids) {
        return new ManualEntryBulkService.BulkRequest(PAST, Instant.parse("2026-09-25T03:30:00Z"),
                Instant.parse("2026-09-25T12:30:00Z"), "OFFICE", null, null, "Biometric was down", ids);
    }

    @Test void everyoneListedIsMarkedExceptYourselfRepeatsAndStrangers() {
        ManualEntryBulkService bulk = new ManualEntryBulkService(attendance, contexts, employees);
        Employee a = person("Asha"), b = person("Ravi"), me = person("Me");
        UUID stranger = UUID.randomUUID();
        when(attendance.manualEntry(any(), any(), any(), any(), any(), any()))
                .thenReturn(new AttendanceDto(UUID.randomUUID(), "2026-09-28", "2026-09-28T03:30:00Z", "2026-09-28T12:30:00Z",
                        "OFFICE", "ON_TIME", "MANAGER_OVERRIDE", null, 9.0, null, null, null, null, 0, 0, true));
        ManualEntryBulkService.BulkResult r = bulk.apply(request(List.of(a.getId(), b.getId(), a.getId(), me.getId(), stranger)), me.getId());
        assertEquals(2, r.saved());
        assertEquals(3, r.skipped());
        assertEquals(List.of("SAVED", "SAVED", "SKIPPED", "SKIPPED", "SKIPPED"), r.results().stream().map(ManualEntryBulkService.Result::outcome).toList());
        assertEquals(List.of("DUPLICATE", "MANUAL_ENTRY_SELF", "EMPLOYEE_NOT_FOUND"),
                r.results().stream().skip(2).map(ManualEntryBulkService.Result::code).toList());
        ArgumentCaptor<ManualAttendanceRequest> sent = ArgumentCaptor.forClass(ManualAttendanceRequest.class);
        verify(attendance, times(2)).manualEntry(sent.capture(), eq(me.getId()), any(), any(), any(), any());
        assertEquals(List.of(a.getId(), b.getId()), sent.getAllValues().stream().map(ManualAttendanceRequest::employeeId).toList());
        assertEquals("Biometric was down", sent.getAllValues().get(0).reason());
    }

    @Test void aBadRequestWritesNothing() {
        LocalDate today = LocalDate.of(2026, 9, 28);
        UUID x = UUID.randomUUID();
        assertEquals("MANUAL_DATE_FUTURE", ManualEntryBulkService.invalid(new ManualEntryBulkService.BulkRequest(today.plusDays(1),
                Instant.now(), null, null, null, null, "reason", List.of(x)), today).getErrorCode());
        assertEquals("MANUAL_TIME_REQUIRED", ManualEntryBulkService.invalid(new ManualEntryBulkService.BulkRequest(today,
                null, null, null, null, null, "reason", List.of(x)), today).getErrorCode());
        assertEquals("MANUAL_TIME_ORDER", ManualEntryBulkService.invalid(new ManualEntryBulkService.BulkRequest(today,
                Instant.parse("2026-09-28T12:00:00Z"), Instant.parse("2026-09-28T03:00:00Z"), null, null, null, "reason", List.of(x)), today).getErrorCode());
        assertEquals("MANUAL_PEOPLE_REQUIRED", ManualEntryBulkService.invalid(new ManualEntryBulkService.BulkRequest(today,
                Instant.now(), null, null, null, null, "reason", List.of()), today).getErrorCode());
        assertEquals("MANUAL_REASON_REQUIRED", ManualEntryBulkService.invalid(new ManualEntryBulkService.BulkRequest(today,
                Instant.now(), null, null, null, null, " ", List.of(x)), today).getErrorCode());
        assertNull(ManualEntryBulkService.invalid(request(List.of(x)), today));

        ManualEntryBulkService bulk = new ManualEntryBulkService(attendance, contexts, employees);
        assertThrows(BusinessRuleException.class, () -> bulk.apply(new ManualEntryBulkService.BulkRequest(PAST,
                null, null, null, null, null, "reason", List.of(x)), UUID.randomUUID()));
        verifyNoInteractions(attendance);
    }

    @Test void theAuditLineSaysWhoseDayWhatAndWhy() {
        AttendanceDto dto = new AttendanceDto(UUID.randomUUID(), "2026-09-28", "2026-09-28T03:30:00Z", "2026-09-28T12:30:00Z",
                "OFFICE", "ON_TIME", "MANAGER_OVERRIDE", null, 9.0, null, null, null, null, 0, 0, true);
        assertEquals("Manual entry for Asha Rao on 28 Sep 2026: in 09:00, out 18:00. Reason: Forgot to punch",
                AttendanceController.manualEntrySummary("Asha Rao", dto, "Forgot to punch"));
    }
}
