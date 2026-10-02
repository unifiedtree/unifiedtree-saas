package com.hrms.api.letters;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.api.hiring.FakeJdbc;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.letters.domain.LetterTemplate;
import com.hrms.letters.dto.CreateDistributionRequest;
import com.hrms.letters.dto.DistributionJobDto;
import com.hrms.letters.dto.RecipientFilter;
import com.hrms.letters.repository.LetterTemplateRepository;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * BW-73 "Send on": a send is kept for a later date, cancelled by deleting it,
 * started on its date from 09:00 India time (only due ones, each once), and
 * kept as FAILED with the reason when it can't start. FEATURE_NOT_READY
 * without the table.
 */
class DistributionScheduleTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private final UUID tenant = UUID.randomUUID();
    private final UUID templateId = UUID.randomUUID();
    private final LetterDistributionService distributions = mock(LetterDistributionService.class);
    private final LetterTemplateRepository templates = mock(LetterTemplateRepository.class);
    private final AuditService audit = mock(AuditService.class);
    private final ObjectMapper json = new ObjectMapper();

    @BeforeEach void tenant() { TenantContext.setTenantId(tenant); }
    @AfterEach void clear() { TenantContext.clear(); }

    private DistributionScheduleService service(FakeJdbc db) {
        return new DistributionScheduleService(db.jdbc, json, distributions, templates, audit);
    }

    private static FakeJdbc ready() {
        return new FakeJdbc().tables(Map.of(DistributionScheduleService.TABLE, true));
    }

    private DistributionScheduleService.ScheduleRequest req(LocalDate sendOn) {
        return new DistributionScheduleService.ScheduleRequest(templateId, "Holiday list 2027", "Hi all", null,
                new RecipientFilter(RecipientFilter.BY_BRANCH, List.of(UUID.randomUUID().toString()), null), sendOn);
    }

    private Map<String, Object> scheduleRow(UUID id) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", id);
        m.put("template_id", templateId);
        m.put("title", "Holiday list 2027");
        m.put("custom_message", "Hi all");
        m.put("subject_override", null);
        m.put("recipient_filter", "{\"type\":\"ALL_EMPLOYEES\",\"values\":null,\"employeeIds\":null}");
        m.put("send_on", LocalDate.now(IST).plusDays(3));
        m.put("status", "SCHEDULED");
        m.put("failure_reason", null);
        m.put("recipients_at_schedule", 12);
        m.put("created_at", Instant.now());
        m.put("created_by", UUID.randomUUID());
        return m;
    }

    // ── when sends are due ───────────────────────────────────────────────────

    @Test void sendsAreDueFromNineInTheMorningIndiaTime() {
        ZonedDateTime before = ZonedDateTime.of(2026, 10, 12, 8, 59, 0, 0, IST);
        ZonedDateTime at = ZonedDateTime.of(2026, 10, 12, 9, 0, 0, 0, IST);
        assertEquals(LocalDate.of(2026, 10, 11), DistributionScheduleService.dueThrough(before));
        assertEquals(LocalDate.of(2026, 10, 12), DistributionScheduleService.dueThrough(at));
        // 03:40 UTC is 09:10 India time
        assertEquals(LocalDate.of(2026, 10, 12),
                DistributionScheduleService.dueThrough(ZonedDateTime.of(2026, 10, 12, 3, 40, 0, 0, ZoneId.of("UTC"))));
    }

    // ── scheduling ───────────────────────────────────────────────────────────

    @Test void aSendIsKeptForALaterDateWithTodaysCount() {
        UUID id = UUID.randomUUID();
        FakeJdbc db = ready().on("INSERT INTO letters.distribution_schedules", id).on("WHERE tenant_id = ? AND id = ?", List.of(scheduleRow(id)));
        when(templates.findActiveById(templateId)).thenReturn(Optional.of(new LetterTemplate()));
        when(distributions.countRecipients(any())).thenReturn(new int[]{12, 1});
        when(distributions.templateNames(any())).thenReturn(Map.of(templateId, "Holiday list"));
        UUID me = UUID.randomUUID();
        var out = service(db).schedule(req(LocalDate.now(IST).plusDays(3)), me);
        assertEquals(id, out.id());
        assertEquals("Holiday list", out.templateName());
        FakeJdbc.Call insert = db.callsContaining("INSERT INTO letters.distribution_schedules").get(0);
        assertEquals(tenant, insert.args().get(0));
        assertTrue(String.valueOf(insert.args().get(5)).contains("BY_BRANCH"));
        assertEquals(12, insert.args().get(7));
        assertEquals(me, insert.args().get(8));
    }

    @Test void todayOrThePastIsRefused() {
        FakeJdbc db = ready();
        assertEquals("SEND_ON_NOT_FUTURE",
                assertThrows(HrmsException.class, () -> service(db).schedule(req(LocalDate.now(IST)), UUID.randomUUID())).getErrorCode());
        assertEquals("SEND_ON_TOO_FAR",
                assertThrows(HrmsException.class, () -> service(db).schedule(req(LocalDate.now(IST).plusDays(400)), UUID.randomUUID())).getErrorCode());
        assertTrue(db.callsContaining("INSERT").isEmpty());
    }

    @Test void noRecipientsIsRefusedNow() {
        FakeJdbc db = ready();
        when(templates.findActiveById(templateId)).thenReturn(Optional.of(new LetterTemplate()));
        when(distributions.countRecipients(any())).thenReturn(new int[]{0, 0});
        assertEquals("NO_RECIPIENTS",
                assertThrows(HrmsException.class, () -> service(db).schedule(req(LocalDate.now(IST).plusDays(2)), UUID.randomUUID())).getErrorCode());
    }

    @Test void withoutTheTableSchedulingIsNotSwitchedOn() {
        FakeJdbc db = new FakeJdbc().tables(Map.of());
        assertThrows(FeatureNotReady.class, () -> service(db).schedule(req(LocalDate.now(IST).plusDays(2)), UUID.randomUUID()));
        assertThrows(FeatureNotReady.class, () -> service(db).list());
        assertThrows(FeatureNotReady.class, () -> service(db).cancel(UUID.randomUUID()));
        assertEquals(List.of(), service(db).dueIds(tenant, LocalDate.now()));
    }

    @Test void cancellingDeletesOnlyASendThatHasNotStarted() {
        FakeJdbc db = ready().on("DELETE FROM letters.distribution_schedules", List.of("Holiday list 2027"));
        service(db).cancel(UUID.randomUUID());
        assertTrue(db.callsContaining("DELETE").get(0).sql().contains("status IN ('SCHEDULED', 'FAILED')"));

        FakeJdbc started = ready().on("DELETE FROM letters.distribution_schedules", List.of());
        assertEquals("SCHEDULE_NOT_CANCELLABLE",
                assertThrows(HrmsException.class, () -> service(started).cancel(UUID.randomUUID())).getErrorCode());
    }

    // ── starting ─────────────────────────────────────────────────────────────

    @Test void aDueSendStartsAsAnOrdinaryDistributionOnce() {
        UUID id = UUID.randomUUID();
        Map<String, Object> row = scheduleRow(id);
        UUID jobId = UUID.randomUUID();
        FakeJdbc db = ready().on("SET status = 'STARTING'", 1).on("SET status = 'STARTED'", 1).on("WHERE tenant_id = ? AND id = ?", List.of(row));
        when(distributions.createDistribution(any(), any())).thenReturn(new DistributionJobDto(jobId, templateId, "Holiday list 2027",
                null, null, null, Instant.now(), "PENDING", 12, 0, 0, null, null, null));
        LocalDate through = LocalDate.now(IST);
        assertEquals(jobId, service(db).startOne(tenant, id, through));
        verify(distributions).createDistribution(eq(new CreateDistributionRequest(templateId, "Holiday list 2027", "Hi all", null,
                new RecipientFilter(RecipientFilter.ALL_EMPLOYEES, null, null))), eq((UUID) row.get("created_by")));
        FakeJdbc.Call claim = db.callsContaining("SET status = 'STARTING'").get(0);
        assertTrue(claim.sql().contains("status = 'SCHEDULED' AND send_on <= ?"));
        assertEquals(List.of(tenant, id, through), claim.args());
        assertEquals(jobId, db.callsContaining("SET status = 'STARTED'").get(0).args().get(0));
    }

    @Test void aSendAnotherServerTookIsLeftAlone() {
        FakeJdbc db = ready().on("SET status = 'STARTING'", 0);
        assertNull(service(db).startOne(tenant, UUID.randomUUID(), LocalDate.now()));
        verifyNoInteractions(distributions);
    }

    @Test void theJobStartsOnlyDueSendsAndKeepsFailuresWithTheirReason() {
        UUID due = UUID.randomUUID(), bad = UUID.randomUUID();
        DistributionScheduleService schedules = mock(DistributionScheduleService.class);
        FakeJdbc db = new FakeJdbc().on("platform.tenants", List.of(tenant));
        when(schedules.ready()).thenReturn(true);
        when(schedules.dueIds(eq(tenant), any())).thenReturn(List.of(due, bad));
        when(schedules.startOne(eq(tenant), eq(due), any())).thenReturn(UUID.randomUUID());
        when(schedules.startOne(eq(tenant), eq(bad), any())).thenThrow(new HrmsException("No employees match the selected recipients",
                org.springframework.http.HttpStatus.BAD_REQUEST, "NO_RECIPIENTS"));
        ZonedDateTime morning = ZonedDateTime.of(2026, 10, 12, 9, 10, 0, 0, IST);

        assertEquals(1, new DistributionScheduleJob(schedules, db.jdbc).runAcrossTenants(morning));
        verify(schedules).dueIds(tenant, LocalDate.of(2026, 10, 12));
        verify(schedules).markFailed(tenant, bad, "No employees match the selected recipients");
        verify(schedules, never()).markFailed(eq(tenant), eq(due), any());
        assertNull(TenantContext.getTenantId());
    }

    @Test void theJobDoesNothingWithoutTheTable() {
        DistributionScheduleService schedules = mock(DistributionScheduleService.class);
        FakeJdbc db = new FakeJdbc();
        when(schedules.ready()).thenReturn(false);
        assertEquals(0, new DistributionScheduleJob(schedules, db.jdbc).runAcrossTenants(ZonedDateTime.now()));
        assertTrue(db.calls.isEmpty());
    }
}
