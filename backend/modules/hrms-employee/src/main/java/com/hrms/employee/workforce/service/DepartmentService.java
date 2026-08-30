package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateDepartmentRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.DepartmentResponse;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service("workforceDepartmentService")
@Transactional
public class DepartmentService {

    private final WorkforceDepartmentRepository repository;

    public DepartmentService(WorkforceDepartmentRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<DepartmentResponse> listForCompany(UUID companyId) {
        return repository.findAllByCompanyIdAndActiveTrueOrderByNameAsc(companyId)
                .stream().map(this::toResponse).toList();
    }

    /**
     * Create a department, REVIVING a previously archived one of the same name
     * rather than rejecting it.
     *
     * <p>Why the revive branch exists: {@link #archive(UUID)} is a SOFT delete
     * (sets active=false, the row stays), and {@code listForCompany} filters on
     * activeTrue — so after archiving, the user sees the department gone. The
     * old duplicate check called {@code existsByCompanyIdAndNameIgnoreCase},
     * which has NO active filter, so it still saw the hidden row and threw
     * DUPLICATE_DEPARTMENT (HTTP 422). Net effect reported by the client on
     * 2026-08-30: "add a department, delete it, add the same one again -> 422",
     * with nothing on screen to explain why.
     *
     * <p>Simply adding {@code AndActiveTrue} to the check would be WORSE: the
     * unique index {@code uq_dept_tenant_name (tenant_id, company_id, name)} is
     * NOT partial, so a second row with the same name would pass validation and
     * then fail at the database with a constraint violation — a 500 instead of
     * a 422.
     *
     * <p>Reviving is also the semantically right answer: employees and other
     * rows may still carry this department's id as an FK, so re-using the row
     * keeps those references intact instead of orphaning them.
     */
    public DepartmentResponse create(CreateDepartmentRequest req) {
        Department existing = repository
                .findByCompanyIdAndNameIgnoreCase(req.companyId(), req.name())
                .orElse(null);

        if (existing != null && existing.isActive()) {
            // A genuinely live department with this name — real duplicate.
            throw new BusinessRuleException("Department '" + req.name() + "' already exists", "DUPLICATE_DEPARTMENT");
        }

        // Either revive the archived row (keeps its id, and therefore every FK
        // pointing at it) or start a fresh one.
        Department d = existing != null ? existing : new Department();
        d.setCompanyId(req.companyId());
        d.setName(req.name());
        d.setCode(req.code());
        d.setParentDepartmentId(req.parentDepartmentId());
        d.setDepartmentHeadEmployeeId(req.departmentHeadEmployeeId());
        d.setDescription(req.description());
        d.setActive(true);
        return toResponse(repository.save(d));
    }

    public DepartmentResponse rename(UUID id, String newName) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        if (!d.getName().equalsIgnoreCase(newName)
                && repository.existsByCompanyIdAndNameIgnoreCase(d.getCompanyId(), newName)) {
            throw new BusinessRuleException("Department '" + newName + "' already exists", "DUPLICATE_DEPARTMENT");
        }
        d.setName(newName);
        return toResponse(repository.save(d));
    }

    public DepartmentResponse setHead(UUID id, UUID employeeId) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        d.setDepartmentHeadEmployeeId(employeeId);   // null clears the head
        return toResponse(repository.save(d));
    }

    public void archive(UUID id) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        d.setActive(false);
        repository.save(d);
    }

    private DepartmentResponse toResponse(Department d) {
        return new DepartmentResponse(
                d.getId(), d.getCompanyId(), d.getName(), d.getCode(),
                d.getParentDepartmentId(), d.getDepartmentHeadEmployeeId(),
                d.getDescription(), d.getEmployeeCountCached(), d.isActive());
    }
}
