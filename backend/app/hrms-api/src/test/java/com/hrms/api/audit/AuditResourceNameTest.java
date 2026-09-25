package com.hrms.api.audit;

import com.hrms.core.tenant.TenantContext;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.audit.entity.AuditEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The activity feed (w2i) on the merged controller: record names come from
 * AuditRecordNames (w2h); a page where no event has an actor must not 500
 * (w2i's fix: Map.of() throws on a null key).
 */
class AuditResourceNameTest {

    private final UUID tenant = UUID.randomUUID();
    private final AuditService audit = mock(AuditService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AuditRecordNames names = mock(AuditRecordNames.class);
    private final AuditController controller = new AuditController(audit, jdbc, names);

    @AfterEach
    void clear() {
        TenantContext.clear();
    }

    @Test
    void aPageWithNoActorsStillAnswersAndNamesTheRecords() {
        TenantContext.setTenantId(tenant);
        UUID job = UUID.randomUUID(), employee = UUID.randomUUID();
        List<AuditEvent> events = List.of(
                AuditEvent.of(tenant, null, "letters", "DISTRIBUTION_CREATED", "distribution_job", job, "Created"),
                AuditEvent.of(tenant, null, "hrms", "UPDATE", "Employee", employee, null),
                AuditEvent.of(tenant, null, "system", "SWEEP", null, null, "Nightly sweep"));
        when(audit.query(eq(tenant), any(), any(), any(), any(), any(), any(), any())).thenReturn(new PageImpl<>(events));
        when(names.actor(null)).thenReturn(new AuditRecordNames.ActorFilter(true, null));
        when(names.resolve(anyCollection())).thenReturn(Map.of(
                AuditRecordNames.key("distribution_job", job), new AuditRecordNames.Named("Diwali bonus letter", "/hrms/letters/distributions"),
                AuditRecordNames.key("Employee", employee), new AuditRecordNames.Named("Ravi Kumar", "/hrms/employees/" + employee)));

        List<AuditController.AuditEventDto> data = controller.getEvents(null, null, null, null, null, null, 0, 25).data();

        assertEquals(3, data.size());
        assertEquals("Diwali bonus letter", data.get(0).resourceName());
        assertEquals("/hrms/letters/distributions", data.get(0).resourcePath());
        assertEquals("Ravi Kumar", data.get(1).resourceName());
        assertNull(data.get(2).resourceName(), "an event about no record has no name");
        assertNull(data.get(2).actorName(), "system events have no actor");
    }
}
