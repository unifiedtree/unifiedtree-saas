package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.workforce.dto.WorkforceDtos.ClassificationRuleResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.CompanyResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateClassificationRuleRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateCompanyRequest;
import com.hrms.employee.workforce.entity.Branch;
import com.hrms.employee.workforce.entity.ClassificationRule;
import com.hrms.employee.workforce.entity.Company;
import com.hrms.employee.workforce.repository.ClassificationRuleRepository;
import com.hrms.employee.workforce.repository.WorkforceCompanyRepository;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Branch types, company TAN / incorporation / description, classification update (V143.22). */
class MasterOrgServicesTest {

    // ── branch types ──

    @Test
    void theHeadOfficeFlagDecidesTheHeadOfficeType() {
        Branch b = new Branch();
        b.setBranchType("PLANT");
        assertThat(BranchService.typeOf(b)).isEqualTo("PLANT");
        b.setHeadquarters(true);
        assertThat(BranchService.typeOf(b)).isEqualTo("HEAD_OFFICE");
        // Demoted by someone who only flipped the flag: reads as an ordinary branch.
        b.setBranchType("HEAD_OFFICE");
        b.setHeadquarters(false);
        assertThat(BranchService.typeOf(b)).isEqualTo("BRANCH");
    }

    @Test
    void aTypeWinsOverTheFlag() {
        Branch b = new Branch();
        BranchService.applyType(b, "warehouse", true);
        assertThat(b.getBranchType()).isEqualTo("WAREHOUSE");
        assertThat(b.isHeadquarters()).isFalse();

        BranchService.applyType(b, "Head office", null);
        assertThat(b.isHeadquarters()).isTrue();
        assertThat(b.getBranchType()).isEqualTo("HEAD_OFFICE");

        // Old clients only send the flag.
        BranchService.applyType(b, null, false);
        assertThat(b.isHeadquarters()).isFalse();
        assertThat(b.getBranchType()).isEqualTo("BRANCH");

        assertThatThrownBy(() -> BranchService.applyType(b, "Castle", null)).isInstanceOf(BusinessRuleException.class);
    }

    // ── companies ──

    private UpdateCompanyRequest companyUpdate(String tan, String inc, String desc) {
        return new UpdateCompanyRequest("Acme", null, null, null, null, null, null, null, null, null, tan, inc, desc);
    }

    @Test
    void companyStoresTanIncorporationAndDescription() {
        WorkforceCompanyRepository repo = mock(WorkforceCompanyRepository.class);
        CompanyService service = new CompanyService(repo, mock(LiveHeadcount.class));
        Company c = new Company();
        c.setId(UUID.randomUUID());
        c.setName("Acme");
        c.setPanNumber("AACCU1234F");
        when(repo.findById(c.getId())).thenReturn(Optional.of(c));
        when(repo.save(any(Company.class))).thenAnswer(i -> i.getArgument(0));

        CompanyResponse r = service.update(c.getId(), companyUpdate("blru01234e", "2019-07-01", " Our retail arm "));
        assertThat(r.tanNumber()).isEqualTo("BLRU01234E");
        assertThat(r.incorporationDate()).isEqualTo(LocalDate.of(2019, 7, 1));
        assertThat(r.description()).isEqualTo("Our retail arm");
        assertThat(r.panNumber()).isEqualTo("AACCU1234F");   // not sent, kept

        // Not sent: kept. Blank: cleared.
        r = service.update(c.getId(), companyUpdate(null, null, null));
        assertThat(r.tanNumber()).isEqualTo("BLRU01234E");
        r = service.update(c.getId(), companyUpdate("", "", ""));
        assertThat(r.tanNumber()).isNull();
        assertThat(r.incorporationDate()).isNull();
        assertThat(r.description()).isNull();
    }

    @Test
    void incorporationCannotBeInTheFutureOrMalformed() {
        String tomorrow = LocalDate.now(ZoneId.of("Asia/Kolkata")).plusDays(1).toString();
        assertThatThrownBy(() -> CompanyService.incorporation(tomorrow)).hasMessageContaining("future");
        assertThatThrownBy(() -> CompanyService.incorporation("01/07/2019")).hasMessageContaining("valid date");
        assertThat(CompanyService.incorporation(" ")).isNull();
    }

    // ── classification rules ──

    @Test
    void classificationUpdateIsPartial() {
        ClassificationRuleRepository repo = mock(ClassificationRuleRepository.class);
        ClassificationRuleService service = new ClassificationRuleService(repo);
        ClassificationRule r = new ClassificationRule();
        r.setId(UUID.randomUUID());
        r.setName("Apprentice");
        r.setCode("AP");
        r.setDescription("Trainees");
        when(repo.findById(r.getId())).thenReturn(Optional.of(r));
        when(repo.save(any(ClassificationRule.class))).thenAnswer(i -> i.getArgument(0));

        ClassificationRuleResponse out = service.update(r.getId(), new UpdateClassificationRuleRequest(" Apprentices ", null, ""));
        assertThat(out.name()).isEqualTo("Apprentices");
        assertThat(out.code()).isEqualTo("AP");
        assertThat(out.description()).isNull();

        out = service.update(r.getId(), new UpdateClassificationRuleRequest(null, "ap2", null));
        assertThat(out.code()).isEqualTo("AP2");
        assertThat(out.name()).isEqualTo("Apprentices");

        assertThatThrownBy(() -> service.update(r.getId(), new UpdateClassificationRuleRequest(" ", null, null)))
                .hasMessageContaining("needs a name");
    }
}
