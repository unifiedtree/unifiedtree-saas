package com.hrms.api.audit;

import com.hrms.core.tenant.TenantContext;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.audit.entity.AuditEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

import java.sql.ResultSet;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The activity feed names the record an event changed (dashboard "… for <record>"). */
class AuditResourceNameTest {

    private final UUID tenant = UUID.randomUUID();
    private final AuditService audit = mock(AuditService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AuditController controller = new AuditController(audit, jdbc);

    @AfterEach
    void clear() {
        TenantContext.clear();
    }

    private void row(String table, UUID id, String name, UUID parent) throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getObject("id", UUID.class)).thenReturn(id);
        when(rs.getString("name")).thenReturn(name);
        when(rs.getObject("parent_id")).thenReturn(parent);
        doAnswer(inv -> {
            RowCallbackHandler handler = inv.getArgument(1);
            handler.processRow(rs);
            return null;
        }).when(jdbc).query(contains(table), any(RowCallbackHandler.class), eq(id));
    }

    @Test
    void namesDistributionsRecipientsAndEmployees() throws Exception {
        TenantContext.setTenantId(tenant);
        UUID job = UUID.randomUUID(), recipient = UUID.randomUUID(), employee = UUID.randomUUID();
        List<AuditEvent> events = List.of(
                AuditEvent.of(tenant, null, "letters", "DISTRIBUTION_CREATED", "distribution_job", job, "Created"),
                AuditEvent.of(tenant, null, "letters", "DISTRIBUTION_SENT", "distribution_recipient", recipient, "Sent"),
                AuditEvent.of(tenant, null, "hrms", "UPDATE", "Employee", employee, null),
                AuditEvent.of(tenant, null, "payroll", "LOCK", "payroll_run", UUID.randomUUID(), null));
        when(audit.query(eq(tenant), any(), any(), any(), any(), any(), any(), any())).thenReturn(new PageImpl<>(events));
        row("letters.distribution_jobs", job, "Diwali bonus letter", null);
        row("letters.distribution_recipients", recipient, "Asha Rao", job);
        row("hrms.employees", employee, "Ravi Kumar", null);

        List<AuditController.AuditEventDto> data = controller.getEvents(null, null, null, null, null, null, 0, 25).data();

        assertEquals("Diwali bonus letter", data.get(0).resourceName());
        assertNull(data.get(0).resourceParentId());
        assertEquals("Asha Rao", data.get(1).resourceName());
        assertEquals(job.toString(), data.get(1).resourceParentId(), "a recipient opens its distribution");
        assertEquals("Ravi Kumar", data.get(2).resourceName(), "entity types match case-insensitively");
        assertNull(data.get(3).resourceName(), "types without a name stay null");
    }

    @Test
    void aFailedLookupLeavesTheNameOut() {
        TenantContext.setTenantId(tenant);
        UUID job = UUID.randomUUID();
        when(audit.query(eq(tenant), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(new PageImpl<>(List.of(AuditEvent.of(tenant, null, "letters", "X", "distribution_job", job, null))));
        doAnswer(inv -> { throw new org.springframework.dao.DataAccessResourceFailureException("down"); })
                .when(jdbc).query(contains("letters.distribution_jobs"), any(RowCallbackHandler.class), eq(job));

        assertNull(controller.getEvents(null, null, null, null, null, null, 0, 25).data().get(0).resourceName());
    }
}
