package com.hrms.api.payroll;

import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** A payroll run's create / process / lock / reopen each leave one line in the audit log. */
class PayrollRunAuditTest {

    private static final UUID TENANT = UUID.randomUUID();
    private final UUID runId = UUID.randomUUID();
    private final PayrollRunService service = mock(PayrollRunService.class);
    private final AuditService audit = mock(AuditService.class);
    private final PayrollRunController controller = new PayrollRunController(service);
    private final org.springframework.security.oauth2.jwt.Jwt jwt = new org.springframework.security.oauth2.jwt.Jwt("t",
            java.time.Instant.now(), java.time.Instant.now().plusSeconds(60), java.util.Map.of("alg", "none"),
            java.util.Map.of("sub", UUID.randomUUID().toString()));

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(controller, "auditService", audit);
        TenantContext.setTenantId(TENANT);
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
    }

    private PayrollRunService.RunDto run(String status) {
        return new PayrollRunService.RunDto(runId, UUID.randomUUID(), "Acme Pvt Ltd", 11, 2026, "2026-11-01", "2026-11-30",
                status, 12, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, null, null, null, 0, null, null,
                null, null, null, null, BigDecimal.ZERO, null);
    }

    @Test
    void creatingARunIsRecordedWithItsMonthAndCompany() {
        when(service.createDraftRun(eq(TENANT), any(), any())).thenReturn(run("DRAFT"));
        controller.create(new PayrollRunService.CreateRunRequest(UUID.randomUUID(), 11, 2026), jwt);
        verify(audit).record("payroll", "CREATE", "PAYROLL_RUN", runId, "Created the Nov 2026 payroll run for Acme Pvt Ltd");
    }

    @Test
    void processLockAndReopenAreRecorded() {
        when(service.processRun(eq(TENANT), eq(runId), any())).thenReturn(run("PROCESSED"));
        when(service.lockRun(eq(TENANT), eq(runId), any())).thenReturn(run("LOCKED"));
        when(service.reopenRun(eq(TENANT), eq(runId), any(), any())).thenReturn(run("DRAFT"));
        controller.process(runId, jwt);
        controller.lock(runId, jwt);
        controller.reopen(runId, new PayrollRunController.ReopenRequest(" Wrong bonus 100% "), jwt);
        verify(audit).record("payroll", "PAYROLL_PROCESSED", "PAYROLL_RUN", runId, "Processed the Nov 2026 payroll run for Acme Pvt Ltd");
        verify(audit).record("payroll", "PAYROLL_LOCKED", "PAYROLL_RUN", runId, "Locked the Nov 2026 payroll run for Acme Pvt Ltd");
        verify(audit).record("payroll", "PAYROLL_REOPENED", "PAYROLL_RUN", runId,
                "Reopened the Nov 2026 payroll run for Acme Pvt Ltd. Reason: Wrong bonus 100%");
    }

    @Test
    void aFailedAuditWriteNeverFailsTheRun() {
        when(service.lockRun(eq(TENANT), eq(runId), any())).thenReturn(run("LOCKED"));
        doThrow(new IllegalStateException("db")).when(audit).record(any(), any(), any(), any(), any());
        assertEquals(runId, controller.lock(runId, jwt).id());
    }
}
