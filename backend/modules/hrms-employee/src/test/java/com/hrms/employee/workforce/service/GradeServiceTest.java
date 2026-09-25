package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.workforce.dto.WorkforceDtos.GradeResponse;
import com.hrms.employee.workforce.entity.Grade;
import com.hrms.employee.workforce.repository.GradeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.util.List;
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

/** Grade pay bands (V143.22): validation, masking and "not shown means keep". */
class GradeServiceTest {

    private GradeRepository repo;
    private JdbcTemplate jdbc;
    private GradeService service;
    private final UUID company = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        repo = mock(GradeRepository.class);
        jdbc = mock(JdbcTemplate.class);
        service = new GradeService(repo, jdbc);
        when(repo.save(any(Grade.class))).thenAnswer(i -> i.getArgument(0));
        when(repo.saveAndFlush(any(Grade.class))).thenAnswer(i -> i.getArgument(0));
    }

    private Grade grade(String code, Long min, Long max) {
        Grade g = new Grade();
        g.setId(UUID.randomUUID());
        g.setCompanyId(company);
        g.setCode(code);
        g.setName("Senior");
        g.setLevel(3);
        g.setMinCtcAnnual(min == null ? null : BigDecimal.valueOf(min));
        g.setMaxCtcAnnual(max == null ? null : BigDecimal.valueOf(max));
        return g;
    }

    @Test
    void bandMustBeBothOrNeitherAndIncreasing() {
        GradeService.validateBand(null, null);
        GradeService.validateBand(BigDecimal.ZERO, BigDecimal.ONE);
        assertThatThrownBy(() -> GradeService.validateBand(BigDecimal.TEN, null)).isInstanceOf(BusinessRuleException.class);
        assertThatThrownBy(() -> GradeService.validateBand(null, BigDecimal.TEN)).isInstanceOf(BusinessRuleException.class);
        assertThatThrownBy(() -> GradeService.validateBand(BigDecimal.TEN, BigDecimal.TEN)).hasMessageContaining("more than the minimum");
        assertThatThrownBy(() -> GradeService.validateBand(BigDecimal.valueOf(-1), BigDecimal.TEN)).hasMessageContaining("below zero");
    }

    @Test
    void updateStoresTheBandForSomeoneWhoMaySeeIt() {
        Grade stored = grade("L3", null, null);
        when(repo.findById(stored.getId())).thenReturn(Optional.of(stored));
        Grade body = grade("L3", 800_000L, 1_500_000L);
        body.setActive(true);

        Grade saved = service.update(stored.getId(), body, true);

        assertThat(saved.getMinCtcAnnual()).isEqualByComparingTo("800000");
        assertThat(saved.getMaxCtcAnnual()).isEqualByComparingTo("1500000");
    }

    @Test
    void updateKeepsTheBandForSomeoneWhoCannotSeeIt() {
        Grade stored = grade("L3", 800_000L, 1_500_000L);
        when(repo.findById(stored.getId())).thenReturn(Optional.of(stored));
        Grade body = grade("L3", null, null);   // the band was masked in their list
        body.setName("Senior II");
        body.setActive(true);

        Grade saved = service.update(stored.getId(), body, false);

        assertThat(saved.getName()).isEqualTo("Senior II");
        assertThat(saved.getMinCtcAnnual()).isEqualByComparingTo("800000");
        assertThat(saved.getMaxCtcAnnual()).isEqualByComparingTo("1500000");
    }

    @Test
    void anInvalidBandIsRefusedOnUpdate() {
        Grade stored = grade("L3", null, null);
        when(repo.findById(stored.getId())).thenReturn(Optional.of(stored));
        assertThatThrownBy(() -> service.update(stored.getId(), grade("L3", 900_000L, 500_000L), true))
                .isInstanceOf(BusinessRuleException.class);
        verify(repo, never()).save(any());
        verify(repo, never()).saveAndFlush(any());
    }

    @Test
    void renamingTheCodeUpdatesLinkedDesignationText() {
        Grade stored = grade("L3", null, null);
        when(repo.findById(stored.getId())).thenReturn(Optional.of(stored));
        Grade body = grade("SR", null, null);
        body.setActive(true);

        service.update(stored.getId(), body, true);

        verify(jdbc).update("UPDATE hrms.designations SET grade = ? WHERE grade_id = ?", "SR", stored.getId());
    }

    @Test
    void createWithoutBandAccessDropsTheBandAndLinksLegacyTitles() {
        when(repo.findByCompanyIdAndCode(company, "L4")).thenReturn(Optional.empty());
        Grade body = grade("L4", 1_400_000L, 2_400_000L);

        Grade saved = service.create(body, false);

        assertThat(saved.getMinCtcAnnual()).isNull();
        assertThat(saved.getMaxCtcAnnual()).isNull();
        verify(jdbc).update(anyString(), eq(saved.getId()), eq("L4"), eq(company), eq("L4"));
    }

    @Test
    void renamingToACodeAnotherGradeUsesIsRefusedBeforeSaving() {
        Grade stored = grade("L3", null, null);
        Grade other = grade("L4", null, null);
        other.setActive(false);
        when(repo.findById(stored.getId())).thenReturn(Optional.of(stored));
        when(repo.findByCompanyIdAndCode(company, "L4")).thenReturn(Optional.of(other));

        assertThatThrownBy(() -> service.update(stored.getId(), grade("L4", null, null), true))
                .isInstanceOf(BusinessRuleException.class)
                .hasMessageContaining("L4");
        assertThatThrownBy(() -> service.update(stored.getId(), grade(" ", null, null), true))
                .isInstanceOf(BusinessRuleException.class);
        verify(repo, never()).saveAndFlush(any());
    }

    @Test
    void createInsertsTheGradeBeforeLinkingLegacyTitles() {
        // designations.grade_id has a foreign key to org.grades: the INSERT must
        // reach the database before the JDBC update that points titles at it.
        when(repo.findByCompanyIdAndCode(company, "L5")).thenReturn(Optional.empty());
        Grade body = grade("L5", null, null);

        service.create(body, true);

        org.mockito.InOrder order = org.mockito.Mockito.inOrder(repo, jdbc);
        order.verify(repo).saveAndFlush(body);
        order.verify(jdbc).update(anyString(), eq(body.getId()), eq("L5"), eq(company), eq("L5"));
        verify(repo, never()).save(any());
    }

    @Test
    void responseLeavesTheBandOutWhenNotVisible() {
        Grade g = grade("L2", 500_000L, 900_000L);
        GradeResponse hidden = GradeService.toResponse(g, false);
        GradeResponse shown = GradeService.toResponse(g, true);
        assertThat(hidden.minCtcAnnual()).isNull();
        assertThat(hidden.maxCtcAnnual()).isNull();
        assertThat(hidden.bandVisible()).isFalse();
        assertThat(shown.minCtcAnnual()).isEqualByComparingTo("500000");
        assertThat(shown.bandVisible()).isTrue();
    }

    @Test
    void bandLookupRefusesTooManyIdsAndSkipsEmpty() {
        assertThat(service.bandsForEmployees(List.of())).isEmpty();
        List<UUID> many = java.util.stream.Stream.generate(UUID::randomUUID).limit(GradeService.MAX_BAND_LOOKUP + 1).toList();
        assertThatThrownBy(() -> service.bandsForEmployees(many)).isInstanceOf(BusinessRuleException.class);
    }
}
