package com.hrms.api.workforce;

import com.hrms.employee.workforce.dto.WorkforceDtos.CompanyResponse;
import com.hrms.employee.workforce.service.CompanyService;
import com.unifiedtree.audit.AuditService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The company list's includeArchived switch, and one audit row per company actually archived or restored. */
class CompanyArchiveAuditTest {

    private final UUID id = UUID.randomUUID();
    private CompanyService companies;
    private AuditService audit;
    private WorkforceController controller;

    @BeforeEach
    void setUp() {
        companies = mock(CompanyService.class);
        audit = mock(AuditService.class);
        controller = new WorkforceController(companies, null, null, null, null, null, null, null, null, null, null);
        ReflectionTestUtils.setField(controller, "audit", audit);
    }

    private CompanyResponse company(boolean active) {
        return new CompanyResponse(id, "Acme Logistics", null, null, null, null, null, "India", "Asia/Kolkata",
                "INR", "APRIL", null, 0, active, null, null, null);
    }

    @Test
    void listPassesIncludeArchivedThrough() {
        when(companies.list(true)).thenReturn(List.of(company(true), company(false)));
        when(companies.list(false)).thenReturn(List.of(company(true)));
        assertEquals(2, controller.listCompanies(true).size());
        assertEquals(1, controller.listCompanies(false).size());
    }

    @Test
    void archiveAndRestoreAreAudited() {
        when(companies.archive(id)).thenReturn(new CompanyService.StatusChange(company(false), true));
        controller.archiveCompany(id);
        verify(audit).record("org", "ARCHIVE", "COMPANY", id, "Archived company Acme Logistics");

        when(companies.restore(id)).thenReturn(new CompanyService.StatusChange(company(true), true));
        CompanyResponse back = controller.restoreCompany(id);
        assertEquals(true, back.active());
        verify(audit).record("org", "RESTORE", "COMPANY", id, "Restored company Acme Logistics");
    }

    @Test
    void nothingIsAuditedWhenNothingChanged() {
        when(companies.archive(id)).thenReturn(new CompanyService.StatusChange(company(false), false));
        when(companies.restore(id)).thenReturn(new CompanyService.StatusChange(company(true), false));
        controller.archiveCompany(id);
        controller.restoreCompany(id);
        verify(audit, never()).record(anyString(), anyString(), anyString(), any(), anyString());
    }

    @Test
    void aFailedAuditWriteDoesNotFailTheRestore() {
        when(companies.restore(id)).thenReturn(new CompanyService.StatusChange(company(true), true));
        doThrow(new IllegalStateException("audit down")).when(audit).record(anyString(), anyString(), anyString(), any(), anyString());
        assertEquals(true, controller.restoreCompany(id).active());
    }
}
