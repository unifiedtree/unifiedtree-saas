package com.hrms.api.ess.requests;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSourceRunner;
import com.hrms.api.saasguard.TenantModuleLookup;
import com.hrms.api.workforce.TimesheetService;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionOperations;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** "My requests" lists submitted timesheet weeks (BW-119's "timesheet weeks when present"). */
class TimesheetWeeksSourceTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID ME = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 1);

    private static TimesheetService.Week week(String status, LocalDate monday, String by) {
        return new TimesheetService.Week(UUID.randomUUID(), ME, "Reader User", monday, status, 2400,
                Instant.parse("2026-09-28T05:00:00Z"), "SUBMITTED".equals(status) ? null : Instant.parse("2026-09-29T05:00:00Z"),
                by, null, "EMP002", null);
    }

    @Test void submittedWeeksWaitForTheNotifiedApprover() {
        TimesheetService timesheets = mock(TimesheetService.class);
        LocalDate monday = LocalDate.of(2026, 9, 21);
        when(timesheets.myWeeks(ME, TODAY.minusWeeks(26), TODAY)).thenReturn(List.of(
                week("APPROVED", monday.minusWeeks(1), "Dept Manager"),
                week("SUBMITTED", monday, null)));
        NotifiedApprover notified = mock(NotifiedApprover.class);
        when(notified.nameFor(ME)).thenReturn("Dept Manager");
        TenantModuleLookup modules = mock(TenantModuleLookup.class);
        when(modules.hasActiveModule(any(), any())).thenReturn(true);

        TimesheetWeeksSource s = new TimesheetWeeksSource(timesheets, notified);
        assertEquals("TIMESHEET", s.key());
        assertEquals("hrms", s.module());
        assertFalse(s.allowed(new EssCaller(TENANT, ME, Set.of("hrms.ess.read"), null, TODAY)));

        MyRequest.Response r = new MyRequestsService(List.of(s), new EssSourceRunner(modules, TransactionOperations.withoutTransaction()))
                .myRequests(new EssCaller(TENANT, ME, Set.of("attendance.checkin.self"), null, TODAY), 6);
        assertEquals(2, r.requests().size());
        MyRequest waiting = r.requests().get(0);
        assertEquals("WAITING", waiting.state());
        assertEquals("Timesheet · week of 21 Sep", waiting.title());
        assertEquals("Dept Manager", waiting.waitingForName());
        assertEquals(LocalDate.of(2026, 9, 27), waiting.toDate());
        assertEquals(50, waiting.progress());
        assertNull(waiting.days());
        assertEquals("Approved", r.requests().get(1).statusLabel());
        assertEquals("Dept Manager", r.requests().get(1).decidedByName());
    }

    @Test void aWeekSentBackReadsSentBack() {
        MyRequest m = TimesheetWeeksSource.toRequest(week("REJECTED", LocalDate.of(2026, 9, 14), "Dept Manager"), null);
        assertEquals("REJECTED", m.state());
        assertEquals("Sent back", m.statusLabel());
        assertEquals(100, m.progress());
    }
}
