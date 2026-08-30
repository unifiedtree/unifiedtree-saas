package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.workforce.entity.Grade;
import com.hrms.employee.workforce.repository.GradeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class GradeService {

    private final GradeRepository repo;

    public GradeService(GradeRepository repo) {
        this.repo = repo;
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
     */
    public Grade create(Grade grade) {
        Grade existing = grade.getCode() == null ? null
                : repo.findByCompanyIdAndCode(grade.getCompanyId(), grade.getCode()).orElse(null);

        if (existing != null && existing.isActive()) {
            throw new BusinessRuleException("Grade code already exists for this company: " + grade.getCode());
        }
        if (existing != null) {
            // Copy the incoming values onto the archived row so it keeps its id
            // (and every FK pointing at it) while taking the new content.
            existing.setName(grade.getName());
            existing.setLevel(grade.getLevel());
            existing.setDescription(grade.getDescription());
            existing.setActive(true);
            existing.setTenantId(TenantContext.getTenantId());
            return repo.save(existing);
        }
        grade.setTenantId(TenantContext.getTenantId());
        return repo.save(grade);
    }

    @Transactional
    public Grade update(UUID id, Grade update) {
        Grade existing = repo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Grade", id));
        existing.setName(update.getName());
        existing.setLevel(update.getLevel());
        existing.setDescription(update.getDescription());
        existing.setActive(update.isActive());
        return repo.save(existing);
    }

    @Transactional
    public void archive(UUID id) {
        Grade grade = repo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Grade", id));
        grade.setActive(false);
        repo.save(grade);
    }
}
