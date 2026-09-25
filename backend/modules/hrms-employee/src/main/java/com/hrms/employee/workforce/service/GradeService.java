package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.workforce.dto.WorkforceDtos.EmployeePayBandResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.GradeResponse;
import com.hrms.employee.workforce.entity.Grade;
import com.hrms.employee.workforce.repository.GradeRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

@Service
public class GradeService {

    /** Bound on one pay-band lookup (the Salary Structure page asks for the people on screen). */
    static final int MAX_BAND_LOOKUP = 500;

    private final GradeRepository repo;
    private final JdbcTemplate jdbc;

    public GradeService(GradeRepository repo, JdbcTemplate jdbc) {
        this.repo = repo;
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public List<Grade> listForCompany(UUID companyId) {
        return repo.findByCompanyIdAndActiveTrueOrderByLevelAsc(companyId);
    }

    @Transactional
    /**
     * Revives a soft-deleted grade with the same code instead of rejecting it.
     * archive() only sets active=false and the list filters activeTrue, so the
     * row is hidden from the user but still seen by the old exists-check —
     * "add, delete, add the same again" returned 422 (client report
     * 2026-08-30). Filtering the check by active would instead collide with the
     * non-partial unique index uq_grade_tenant_code and surface as a 500.
     *
     * <p>{@code bandEditable}: whether the caller may set the pay band (see
     * {@link #update}). A caller who can't see bands creates the grade without one.
     */
    public Grade create(Grade grade, boolean bandEditable) {
        if (!bandEditable) {
            grade.setMinCtcAnnual(null);
            grade.setMaxCtcAnnual(null);
        }
        validateBand(grade.getMinCtcAnnual(), grade.getMaxCtcAnnual());
        Grade existing = grade.getCode() == null ? null
                : repo.findByCompanyIdAndCode(grade.getCompanyId(), grade.getCode()).orElse(null);

        if (existing != null && existing.isActive()) {
            throw new BusinessRuleException("Grade code already exists for this company: " + grade.getCode());
        }
        Grade saved;
        if (existing != null) {
            // Copy the incoming values onto the archived row so it keeps its id
            // (and every FK pointing at it) while taking the new content.
            existing.setName(grade.getName());
            existing.setLevel(grade.getLevel());
            existing.setDescription(grade.getDescription());
            existing.setMinCtcAnnual(grade.getMinCtcAnnual());
            existing.setMaxCtcAnnual(grade.getMaxCtcAnnual());
            existing.setActive(true);
            existing.setTenantId(TenantContext.getTenantId());
            saved = repo.saveAndFlush(existing);
        } else {
            grade.setTenantId(TenantContext.getTenantId());
            // Flushed now: linkLegacyDesignations below writes designations.grade_id
            // over JDBC, and its foreign key to org.grades needs this row inserted
            // first (a plain save() defers the INSERT to commit -> FK violation, 500).
            saved = repo.saveAndFlush(grade);
        }
        linkLegacyDesignations(saved);
        return saved;
    }

    /**
     * {@code bandEditable} is false for a caller without hrms.grade.band.read:
     * they were sent the grade without its band, so the null band in their
     * full-replace body means "not shown", not "clear it". The stored band is
     * kept.
     */
    @Transactional
    public Grade update(UUID id, Grade update, boolean bandEditable) {
        Grade existing = repo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Grade", id));
        String oldCode = existing.getCode();
        // The code is NOT NULL and unique per company (archived grades included);
        // say so here instead of letting the flush below fail with a 500.
        if (update.getCode() == null || update.getCode().isBlank()) {
            throw new BusinessRuleException("The grade needs a code", "GRADE_CODE_REQUIRED");
        }
        if (!update.getCode().equals(oldCode)) {
            repo.findByCompanyIdAndCode(existing.getCompanyId(), update.getCode())
                    .filter(other -> !other.getId().equals(existing.getId()))
                    .ifPresent(other -> {
                        throw new BusinessRuleException("Grade code already exists for this company: " + update.getCode()
                                + (other.isActive() ? "" : " (deactivated)"), "DUPLICATE_GRADE_CODE");
                    });
        }
        existing.setName(update.getName());
        // 2026-09-09: code was never copied, so the Code field on the grade
        // edit form was accepted by the API and silently discarded — the
        // request succeeded, the toast said saved, the value never changed.
        existing.setCode(update.getCode());
        existing.setLevel(update.getLevel());
        existing.setDescription(update.getDescription());
        existing.setActive(update.isActive());
        if (bandEditable) {
            validateBand(update.getMinCtcAnnual(), update.getMaxCtcAnnual());
            existing.setMinCtcAnnual(update.getMinCtcAnnual());
            existing.setMaxCtcAnnual(update.getMaxCtcAnnual());
        }
        // Flushed before the JDBC writes below, so they see the new code (and a
        // duplicate code fails here as a constraint error, not after them).
        Grade saved = repo.saveAndFlush(existing);
        if (saved.getCode() != null && !saved.getCode().equals(oldCode)) {
            // Designations linked by id keep showing the grade's code as text for
            // older readers; keep that text in step with the rename.
            jdbc.update("UPDATE hrms.designations SET grade = ? WHERE grade_id = ?", saved.getCode(), saved.getId());
        }
        linkLegacyDesignations(saved);
        return saved;
    }

    @Transactional
    public void archive(UUID id) {
        Grade grade = repo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Grade", id));
        grade.setActive(false);
        repo.save(grade);
    }

    /**
     * The pay band of each employee's designation's grade. Employees without a
     * designation, or whose designation has no linked grade, are left out.
     */
    @Transactional(readOnly = true)
    public List<EmployeePayBandResponse> bandsForEmployees(Collection<UUID> employeeIds) {
        List<UUID> ids = employeeIds == null ? List.of() : employeeIds.stream().filter(java.util.Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return List.of();
        if (ids.size() > MAX_BAND_LOOKUP) {
            throw new BusinessRuleException("Ask for at most " + MAX_BAND_LOOKUP + " people at a time", "TOO_MANY_IDS");
        }
        String marks = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        List<EmployeePayBandResponse> out = new ArrayList<>();
        jdbc.query("""
                SELECT e.id, e.designation_id, g.id, g.code, g.name, g.min_ctc_annual, g.max_ctc_annual
                  FROM hrms.employees e
                  JOIN hrms.designations d ON d.id = e.designation_id
                  JOIN org.grades g ON g.id = d.grade_id
                 WHERE e.id IN (""" + marks + ")",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> out.add(new EmployeePayBandResponse(
                        rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getObject(3, UUID.class),
                        rs.getString(4), rs.getString(5), rs.getBigDecimal(6), rs.getBigDecimal(7))),
                ids.toArray());
        return out;
    }

    /** The API shape; the band is left out when the caller may not see pay bands. */
    public static GradeResponse toResponse(Grade g, boolean bandVisible) {
        return new GradeResponse(
                g.getId(), g.getTenantId(), g.getCompanyId(), g.getName(), g.getCode(), g.getLevel(),
                g.getDescription(), g.isActive(),
                bandVisible ? g.getMinCtcAnnual() : null,
                bandVisible ? g.getMaxCtcAnnual() : null,
                bandVisible, g.getCreatedAt(), g.getUpdatedAt());
    }

    /** Both set or both empty; not negative; the maximum above the minimum. */
    static void validateBand(BigDecimal min, BigDecimal max) {
        if (min == null && max == null) return;
        if (min == null || max == null) {
            throw new BusinessRuleException("Enter both the minimum and the maximum of the pay band, or leave both empty", "INVALID_PAY_BAND");
        }
        if (min.signum() < 0) {
            throw new BusinessRuleException("The pay band can't start below zero", "INVALID_PAY_BAND");
        }
        if (max.compareTo(min) <= 0) {
            throw new BusinessRuleException("The maximum of the pay band must be more than the minimum", "INVALID_PAY_BAND");
        }
    }

    /**
     * Designations created before grades were linked by id carry the grade as
     * text. When a grade with that code exists (again), link them to it, so
     * "unmatched" chips turn into real grades without anyone re-saving them.
     */
    private void linkLegacyDesignations(Grade g) {
        if (!g.isActive() || g.getCode() == null || g.getCode().isBlank()) return;
        jdbc.update("""
                UPDATE hrms.designations
                   SET grade_id = ?, grade = ?
                 WHERE company_id = ? AND grade_id IS NULL AND grade IS NOT NULL
                   AND upper(trim(grade)) = upper(trim(?))""",
                g.getId(), g.getCode(), g.getCompanyId(), g.getCode());
    }
}
