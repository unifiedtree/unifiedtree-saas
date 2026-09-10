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
        // 2026-09-10: persist the colour + icon the admin picked instead of
        // storing them per-browser (see V118). Nullable, so a caller that omits
        // them keeps the current row's value on revive and starts with NULL on
        // a fresh insert (SPA falls back to a default palette).
        if (req.colorHex() != null) d.setColorHex(req.colorHex());
        if (req.iconKey()  != null) d.setIconKey(req.iconKey());
        d.setActive(true);
        return toResponse(repository.save(d));
    }

    /**
     * Update the cosmetic settings on an existing department. Kept separate
     * from rename() and setHead() because those are their own PATCH endpoints
     * already, and this one takes both fields together so a save can't blank
     * one by omission. Null means "leave alone".
     */
    public DepartmentResponse updateAppearance(UUID id, String colorHex, String iconKey) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        if (colorHex != null) d.setColorHex(colorHex);
        if (iconKey  != null) d.setIconKey(iconKey);
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

    /**
     * Edit a department's code and/or description.
     *
     * Both are settable at create time and neither could be changed afterwards
     * — there was no route for them at all, so a typo in a department code was
     * permanent short of archiving and recreating the department (which orphans
     * every employee pointing at it).
     *
     * Null means "leave unchanged" so callers can send only what they touched.
     * Blank clears the field, which matters for description; code is uppercased
     * and uniqueness-checked within the company, same as create.
     */
    public DepartmentResponse updateDetails(UUID id, String code, String description) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        if (code != null) {
            String next = code.isBlank() ? null : code.trim().toUpperCase();
            if (next != null && !next.equalsIgnoreCase(d.getCode())
                    && repository.existsByCompanyIdAndCodeIgnoreCase(d.getCompanyId(), next)) {
                throw new BusinessRuleException(
                        "Department code '" + next + "' is already used", "DUPLICATE_DEPARTMENT_CODE");
            }
            d.setCode(next);
        }
        if (description != null) {
            d.setDescription(description.isBlank() ? null : description.trim());
        }
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
                d.getDescription(), d.getColorHex(), d.getIconKey(),
                d.getEmployeeCountCached(), d.isActive());
    }
}
