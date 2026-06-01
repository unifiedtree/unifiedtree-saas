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
    public Grade create(Grade grade) {
        if (grade.getCode() != null && repo.existsByCompanyIdAndCode(grade.getCompanyId(), grade.getCode())) {
            throw new BusinessRuleException("Grade code already exists for this company: " + grade.getCode());
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
