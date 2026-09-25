package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateDesignationRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.DesignationResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateDesignationRequest;
import com.hrms.employee.workforce.entity.Designation;
import com.hrms.employee.workforce.entity.Grade;
import com.hrms.employee.workforce.repository.DesignationRepository;
import com.hrms.employee.workforce.repository.GradeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Designation → grade by id, and designation codes (V143.22). */
class DesignationServiceTest {

    private DesignationRepository repo;
    private GradeRepository grades;
    private DesignationService service;
    private final UUID company = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        repo = mock(DesignationRepository.class);
        grades = mock(GradeRepository.class);
        LiveHeadcount headcount = mock(LiveHeadcount.class);
        service = new DesignationService(repo, headcount, grades);
        when(repo.save(any(Designation.class))).thenAnswer(i -> {
            Designation d = i.getArgument(0);
            if (d.getId() == null) d.setId(UUID.randomUUID());
            return d;
        });
        when(repo.findByCompanyIdAndTitleIgnoreCase(any(), anyString())).thenReturn(Optional.empty());
        when(repo.findFirstByCompanyIdAndCodeIgnoreCase(any(), anyString())).thenReturn(Optional.empty());
        when(grades.findByCompanyIdAndCode(any(), anyString())).thenReturn(Optional.empty());
    }

    private Grade grade(UUID companyId, String code, boolean active) {
        Grade g = new Grade();
        g.setId(UUID.randomUUID());
        g.setCompanyId(companyId);
        g.setCode(code);
        g.setName("Grade " + code);
        g.setActive(active);
        when(grades.findById(g.getId())).thenReturn(Optional.of(g));
        return g;
    }

    @Test
    void createLinksTheGradeByIdAndMirrorsItsCode() {
        Grade l3 = grade(company, "L3", true);
        DesignationResponse r = service.create(new CreateDesignationRequest(company, "Senior Engineer", null, null, null, null, l3.getId(), " sse "));
        assertThat(r.gradeId()).isEqualTo(l3.getId());
        assertThat(r.grade()).isEqualTo("L3");
        assertThat(r.code()).isEqualTo("SSE");
    }

    @Test
    void aGradeOfAnotherCompanyIsRefused() {
        Grade other = grade(UUID.randomUUID(), "L3", true);
        assertThatThrownBy(() -> service.create(new CreateDesignationRequest(company, "Analyst", null, null, null, null, other.getId(), null)))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("another company");
    }

    @Test
    void anInactiveGradeCanOnlyBeKeptNotNewlyPicked() {
        Grade old = grade(company, "L9", false);
        assertThatThrownBy(() -> service.create(new CreateDesignationRequest(company, "Analyst", null, null, null, null, old.getId(), null)))
                .hasMessageContaining("inactive");

        Designation d = new Designation();
        d.setId(UUID.randomUUID());
        d.setCompanyId(company);
        d.setGradeId(old.getId());
        service.applyGrade(d, old.getId(), null);   // unchanged: allowed
        assertThat(d.getGradeId()).isEqualTo(old.getId());
    }

    @Test
    void freeTextMatchingAGradeCodeIsLinkedAndOtherTextStaysAsText() {
        Grade l2 = grade(company, "L2", true);
        when(grades.findByCompanyIdAndCode(eq(company), eq("L2"))).thenReturn(Optional.of(l2));

        Designation matched = new Designation();
        matched.setCompanyId(company);
        service.applyGrade(matched, null, "l2");
        assertThat(matched.getGradeId()).isEqualTo(l2.getId());
        assertThat(matched.getGrade()).isEqualTo("L2");

        Designation legacy = new Designation();
        legacy.setCompanyId(company);
        service.applyGrade(legacy, null, "Band C");
        assertThat(legacy.getGradeId()).isNull();
        assertThat(legacy.getGrade()).isEqualTo("Band C");

        service.applyGrade(legacy, null, "  ");
        assertThat(legacy.getGrade()).isNull();
    }

    @Test
    void aCodeUsedByAnotherTitleIsRefused() {
        Designation other = new Designation();
        other.setId(UUID.randomUUID());
        other.setTitle("Tech Lead");
        other.setActive(true);
        when(repo.findFirstByCompanyIdAndCodeIgnoreCase(company, "TL")).thenReturn(Optional.of(other));

        Designation d = new Designation();
        d.setId(UUID.randomUUID());
        d.setCompanyId(company);
        assertThatThrownBy(() -> service.checkedCode(d, "tl")).hasMessageContaining("Tech Lead");
        assertThat(service.checkedCode(other, "tl")).isEqualTo("TL");
        assertThat(service.checkedCode(d, "")).isNull();
    }

    @Test
    void updateWithoutACodeKeepsTheCode() {
        Designation d = new Designation();
        d.setId(UUID.randomUUID());
        d.setCompanyId(company);
        d.setTitle("Analyst");
        d.setCode("AN");
        when(repo.findById(d.getId())).thenReturn(Optional.of(d));

        DesignationResponse r = service.update(d.getId(), new UpdateDesignationRequest("Analyst", "Band C", null, null, null, null, null));

        assertThat(r.code()).isEqualTo("AN");
        assertThat(r.grade()).isEqualTo("Band C");
        assertThat(r.gradeId()).isNull();
    }
}
