package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.workforce.entity.EmploymentType;
import com.hrms.employee.workforce.repository.EmploymentTypeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class EmploymentTypeService {

    private final EmploymentTypeRepository repo;

    public EmploymentTypeService(EmploymentTypeRepository repo) {
        this.repo = repo;
    }

    @Transactional(readOnly = true)
    public List<EmploymentType> listForCompany(UUID companyId) {
        return repo.findByCompanyIdAndActiveTrueOrderByNameAsc(companyId);
    }

    @Transactional
    /**
     * Revives a soft-deleted employment type with the same code instead of
     * rejecting it. archive() only sets active=false and the list filters
     * activeTrue, so the row is hidden from the user but still seen by the old
     * exists-check — "add, delete, add the same again" returned 422 (client
     * report 2026-08-30). Filtering the check by active would instead collide
     * with the non-partial unique index uq_emp_type_tenant_code and surface as
     * a 500.
     */
    public EmploymentType create(EmploymentType type) {
        EmploymentType existing = repo
                .findByCompanyIdAndCode(type.getCompanyId(), type.getCode())
                .orElse(null);

        if (existing != null && existing.isActive()) {
            throw new BusinessRuleException("Employment type code already exists: " + type.getCode());
        }
        if (existing != null) {
            existing.setName(type.getName());
            existing.setPayrollEligible(type.isPayrollEligible());
            existing.setActive(true);
            existing.setTenantId(TenantContext.getTenantId());
            return repo.save(existing);
        }
        type.setTenantId(TenantContext.getTenantId());
        return repo.save(type);
    }

    @Transactional
    public EmploymentType update(UUID id, EmploymentType update) {
        EmploymentType existing = repo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("EmploymentType", id));
        existing.setName(update.getName());
        existing.setActive(update.isActive());
        return repo.save(existing);
    }

    @Transactional
    public void archive(UUID id) {
        EmploymentType type = repo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("EmploymentType", id));
        type.setActive(false);
        repo.save(type);
    }
}
