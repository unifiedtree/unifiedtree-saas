package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateDesignationRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.DesignationResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateDesignationRequest;
import com.hrms.employee.workforce.entity.Designation;
import com.hrms.employee.workforce.repository.DesignationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class DesignationService {

    private final DesignationRepository repository;

    public DesignationService(DesignationRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<DesignationResponse> listForCompany(UUID companyId, UUID departmentFilter) {
        // Always include company-wide designations (no department set); when a
        // department is selected, ALSO include that department's designations.
        // Filtering strictly on department_id hid null-department ("global")
        // designations from the Add-Employee form the moment a department was
        // picked — so a designation created without a department was unusable.
        var rows = repository.findAllByCompanyIdAndActiveTrueOrderByTitleAsc(companyId);
        var filtered = departmentFilter == null
                ? rows
                : rows.stream()
                        .filter(d -> d.getDepartmentId() == null || departmentFilter.equals(d.getDepartmentId()))
                        .toList();
        return filtered.stream().map(this::toResponse).toList();
    }

    public DesignationResponse create(CreateDesignationRequest req) {
        if (repository.existsByCompanyIdAndTitleIgnoreCase(req.companyId(), req.title())) {
            throw new BusinessRuleException("Designation '" + req.title() + "' already exists", "DUPLICATE_DESIGNATION");
        }
        Designation d = new Designation();
        d.setCompanyId(req.companyId());
        d.setTitle(req.title());
        d.setGrade(req.grade());
        d.setDepartmentId(req.departmentId());
        d.setReportsToDesignationId(req.reportsToDesignationId());
        d.setJobResponsibilities(req.jobResponsibilities());
        d.setActive(true);
        return toResponse(repository.save(d));
    }

    public DesignationResponse update(UUID id, UpdateDesignationRequest req) {
        Designation d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Designation " + id + " not found"));
        if (!d.getTitle().equalsIgnoreCase(req.title())
                && repository.existsByCompanyIdAndTitleIgnoreCase(d.getCompanyId(), req.title())) {
            throw new BusinessRuleException("Designation '" + req.title() + "' already exists", "DUPLICATE_DESIGNATION");
        }
        d.setTitle(req.title());
        d.setGrade(req.grade());
        d.setDepartmentId(req.departmentId());
        d.setReportsToDesignationId(req.reportsToDesignationId());
        d.setJobResponsibilities(req.jobResponsibilities());
        return toResponse(repository.save(d));
    }

    public void archive(UUID id) {
        Designation d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Designation " + id + " not found"));
        d.setActive(false);
        repository.save(d);
    }

    private DesignationResponse toResponse(Designation d) {
        return new DesignationResponse(
                d.getId(), d.getCompanyId(), d.getTitle(), d.getGrade(),
                d.getDepartmentId(), d.getReportsToDesignationId(),
                d.getJobResponsibilities(), d.getHeadcountCached(), d.isActive());
    }
}
