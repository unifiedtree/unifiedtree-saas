package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateContractorRequest;
import com.hrms.employee.workforce.entity.Contractor;
import com.hrms.employee.workforce.repository.ContractorRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Agency edit / reactivate and the contract-worker link (V143.22). */
class ContractorServiceTest {

    private ContractorRepository repo;
    private JdbcTemplate jdbc;
    private ContractorService service;
    private final UUID company = UUID.randomUUID();
    private Contractor agency;

    @BeforeEach
    void setUp() {
        repo = mock(ContractorRepository.class);
        jdbc = mock(JdbcTemplate.class);
        service = new ContractorService(repo, jdbc);
        agency = new Contractor();
        agency.setId(UUID.randomUUID());
        agency.setCompanyId(company);
        agency.setAgencyName("Apex Staffing");
        agency.setGstin("29AACCU1234F1Z5");
        agency.setCity("Pune");
        agency.setActive(true);
        when(repo.findById(agency.getId())).thenReturn(Optional.of(agency));
        when(repo.save(any(Contractor.class))).thenAnswer(i -> i.getArgument(0));
        when(repo.saveAndFlush(any(Contractor.class))).thenAnswer(i -> i.getArgument(0));
        when(repo.findAllByCompanyIdOrderByActiveDescAgencyNameAsc(company)).thenReturn(List.of(agency));
        when(repo.findFirstByCompanyIdAndAgencyNameIgnoreCase(any(), anyString())).thenReturn(Optional.empty());
    }

    private UpdateContractorRequest edit(String name, String licenceNo, String licenceDate, String service, List<UUID> sites) {
        return new UpdateContractorRequest(name, null, null, null, null, null, null, null, null, licenceNo, licenceDate, service, sites);
    }

    @Test
    void editIsPartialSoFieldsTheFormDoesntShowSurvive() {
        service.update(agency.getId(), edit("Apex Staffing Solutions", "clra/77", "2027-03-31", "Plant manpower", null));

        assertThat(agency.getAgencyName()).isEqualTo("Apex Staffing Solutions");
        assertThat(agency.getLicenceNumber()).isEqualTo("clra/77");
        assertThat(agency.getLicenceValidUntil()).isEqualTo(LocalDate.of(2027, 3, 31));
        assertThat(agency.getServiceType()).isEqualTo("Plant manpower");
        assertThat(agency.getGstin()).isEqualTo("29AACCU1234F1Z5");
        assertThat(agency.getCity()).isEqualTo("Pune");
        // Sites weren't sent: untouched.
        verify(jdbc, never()).update(eq("DELETE FROM hrms.contractor_sites WHERE contractor_id = ?"), any(Object.class));

        service.update(agency.getId(), edit(null, "", "", null, null));
        assertThat(agency.getLicenceNumber()).isNull();
        assertThat(agency.getLicenceValidUntil()).isNull();
        assertThat(agency.getServiceType()).isEqualTo("Plant manpower");
    }

    @Test
    void editRefusesABadDateABlankNameAndADuplicateName() {
        assertThatThrownBy(() -> service.update(agency.getId(), edit(null, null, "31-03-2027", null, null))).hasMessageContaining("valid date");
        assertThatThrownBy(() -> service.update(agency.getId(), edit("  ", null, null, null, null))).hasMessageContaining("needs a name");
        Contractor other = new Contractor();
        other.setId(UUID.randomUUID());
        when(repo.findFirstByCompanyIdAndAgencyNameIgnoreCase(company, "Sentinel")).thenReturn(Optional.of(other));
        assertThatThrownBy(() -> service.update(agency.getId(), edit("Sentinel", null, null, null, null))).hasMessageContaining("already exists");
    }

    @Test
    void sitesMustBeBranchesOfTheAgencysCompany() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any(Object[].class))).thenReturn(1);
        assertThatThrownBy(() -> service.update(agency.getId(), edit(null, null, null, null, List.of(UUID.randomUUID(), UUID.randomUUID()))))
                .hasMessageContaining("own company");
    }

    @Test
    void sitesAreReplaced() {
        UUID b = UUID.randomUUID();
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any(Object[].class))).thenReturn(1);
        service.update(agency.getId(), edit(null, null, null, null, List.of(b)));
        verify(jdbc).update(eq("DELETE FROM hrms.contractor_sites WHERE contractor_id = ?"), any(Object.class));
        verify(jdbc).update(eq("INSERT INTO hrms.contractor_sites (tenant_id, contractor_id, branch_id) VALUES (?, ?, ?)"), any(), eq(agency.getId()), eq(b));
    }

    @Test
    void reactivateTurnsAnEndedAgencyBackOn() {
        agency.setActive(false);
        assertThat(service.restore(agency.getId()).active()).isTrue();
        assertThat(agency.isActive()).isTrue();
    }

    @Test
    void onlyContractWorkersOfTheSameCompanyCanBeLinked() {
        UUID emp = UUID.randomUUID();
        when(jdbc.queryForList(anyString(), eq(emp))).thenReturn(List.of(Map.of("company_id", company, "employment_type", "FULL_TIME")));
        assertThatThrownBy(() -> service.linkWorker(agency.getId(), emp, "hr@x")).hasMessageContaining("Only contract workers");

        when(jdbc.queryForList(anyString(), eq(emp))).thenReturn(List.of(Map.of("company_id", UUID.randomUUID(), "employment_type", "CONTRACT")));
        assertThatThrownBy(() -> service.linkWorker(agency.getId(), emp, "hr@x")).hasMessageContaining("another company");

        when(jdbc.queryForList(anyString(), eq(emp))).thenReturn(List.of());
        assertThatThrownBy(() -> service.linkWorker(agency.getId(), emp, "hr@x")).hasMessageContaining("not found");
    }

    @Test
    void anEndedAgencyTakesNoNewWorkers() {
        agency.setActive(false);
        assertThatThrownBy(() -> service.linkWorker(agency.getId(), UUID.randomUUID(), "hr@x"))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("reactivate");
    }
}
