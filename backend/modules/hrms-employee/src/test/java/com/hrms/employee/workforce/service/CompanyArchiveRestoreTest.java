package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos.CompanyResponse;
import com.hrms.employee.workforce.entity.Company;
import com.hrms.employee.workforce.repository.WorkforceCompanyRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Archived companies in the list, restoring one, and the two archive guards. */
class CompanyArchiveRestoreTest {

    private WorkforceCompanyRepository repo;
    private LiveHeadcount headcount;
    private CompanyService service;

    @BeforeEach
    void setUp() {
        repo = mock(WorkforceCompanyRepository.class);
        headcount = mock(LiveHeadcount.class);
        service = new CompanyService(repo, headcount);
        when(repo.save(any(Company.class))).thenAnswer(i -> i.getArgument(0));
    }

    private Company company(String name, boolean active) {
        Company c = new Company();
        c.setId(UUID.randomUUID());
        c.setName(name);
        c.setActive(active);
        when(repo.findById(c.getId())).thenReturn(Optional.of(c));
        return c;
    }

    // ── list ──

    @Test
    void listLeavesArchivedCompaniesOutUnlessAskedFor() {
        Company acme = company("Acme", true);
        Company old = company("Old Co", false);
        when(repo.findAllByActiveTrueOrderByNameAsc()).thenReturn(List.of(acme));
        when(repo.findAllByOrderByNameAsc()).thenReturn(List.of(acme, old));
        when(headcount.byColumn("company_id")).thenReturn(Map.of(acme.getId(), 12));

        List<CompanyResponse> active = service.list();
        assertThat(active).extracting(CompanyResponse::name).containsExactly("Acme");
        assertThat(service.list(false)).extracting(CompanyResponse::name).containsExactly("Acme");

        List<CompanyResponse> all = service.list(true);
        assertThat(all).extracting(CompanyResponse::name).containsExactly("Acme", "Old Co");
        assertThat(all).extracting(CompanyResponse::active).containsExactly(true, false);
        // The live headcount, as for active companies (none recorded = 0).
        assertThat(all).extracting(CompanyResponse::employeeCount).containsExactly(12, 0);
    }

    // ── restore ──

    @Test
    void restoreBringsAnArchivedCompanyBack() {
        Company old = company("Old Co", false);

        CompanyService.StatusChange r = service.restore(old.getId());
        assertThat(r.changed()).isTrue();
        assertThat(r.company().active()).isTrue();
        assertThat(old.isActive()).isTrue();
        verify(repo).save(old);
    }

    @Test
    void restoringAnActiveCompanyChangesNothing() {
        Company acme = company("Acme", true);

        CompanyService.StatusChange r = service.restore(acme.getId());
        assertThat(r.changed()).isFalse();
        assertThat(r.company().active()).isTrue();
        assertThat(r.company().name()).isEqualTo("Acme");
        verify(repo, never()).save(any(Company.class));
    }

    @Test
    void restoreOrArchiveOfAnUnknownCompanyIsNotFound() {
        UUID unknown = UUID.randomUUID();
        when(repo.findById(unknown)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.restore(unknown)).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.archive(unknown)).isInstanceOf(ResourceNotFoundException.class);
        verify(repo, never()).save(any(Company.class));
    }

    // ── archive ──

    @Test
    void archiveHidesACompanyNobodyWorksAt() {
        Company spare = company("Spare Co", true), acme = company("Acme", true);
        when(repo.findAllByActiveTrue()).thenReturn(List.of(acme, spare));
        when(headcount.countFor("company_id", spare.getId())).thenReturn(0);

        CompanyService.StatusChange r = service.archive(spare.getId());
        assertThat(r.changed()).isTrue();
        assertThat(r.company().active()).isFalse();
        assertThat(spare.isActive()).isFalse();
        verify(repo).save(spare);
    }

    @Test
    void theLastActiveCompanyCannotBeArchived() {
        Company only = company("Acme", true);
        when(repo.findAllByActiveTrue()).thenReturn(List.of(only));

        assertThatThrownBy(() -> service.archive(only.getId()))
                .isInstanceOf(BusinessRuleException.class)
                .hasMessage("This is the only active company. Add or restore another company before archiving this one.")
                .extracting(e -> ((BusinessRuleException) e).getErrorCode()).isEqualTo("LAST_ACTIVE_COMPANY");
        assertThat(only.isActive()).isTrue();
        verify(repo, never()).save(any(Company.class));
    }

    @Test
    void aCompanyPeopleStillWorkAtCannotBeArchived() {
        Company acme = company("Acme", true), beta = company("Beta", true);
        when(repo.findAllByActiveTrue()).thenReturn(List.of(acme, beta));
        when(headcount.countFor("company_id", acme.getId())).thenReturn(12);

        assertThatThrownBy(() -> service.archive(acme.getId()))
                .isInstanceOf(BusinessRuleException.class)
                .hasMessage("12 people still work at Acme. Move them to another company or record their exit first.")
                .extracting(e -> ((BusinessRuleException) e).getErrorCode()).isEqualTo("COMPANY_HAS_EMPLOYEES");

        when(headcount.countFor("company_id", acme.getId())).thenReturn(1);
        assertThatThrownBy(() -> service.archive(acme.getId()))
                .hasMessage("1 person still works at Acme. Move them to another company or record their exit first.");
        assertThat(acme.isActive()).isTrue();
        verify(repo, never()).save(any(Company.class));
    }

    @Test
    void archivingAnArchivedCompanyChangesNothing() {
        Company old = company("Old Co", false);

        CompanyService.StatusChange r = service.archive(old.getId());
        assertThat(r.changed()).isFalse();
        assertThat(r.company().active()).isFalse();
        verify(repo, never()).save(any(Company.class));
    }

    @Test
    void archiveLocksTheActiveCompaniesBeforeItChecks() {
        Company spare = company("Spare Co", true), acme = company("Acme", true);
        when(repo.findAllByActiveTrue()).thenReturn(List.of(acme, spare));

        service.archive(spare.getId());
        // The lock comes first, so a second archive at the same moment waits and then sees this one.
        var order = inOrder(repo);
        order.verify(repo).findAllByActiveTrue();
        order.verify(repo).findById(spare.getId());
        order.verify(repo).save(spare);
    }
}
