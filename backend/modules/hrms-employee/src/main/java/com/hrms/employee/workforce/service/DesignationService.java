package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateDesignationRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.DesignationResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateDesignationRequest;
import com.hrms.employee.workforce.entity.Designation;
import com.hrms.employee.workforce.entity.Grade;
import com.hrms.employee.workforce.repository.DesignationRepository;
import com.hrms.employee.workforce.repository.GradeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@Transactional
public class DesignationService {

    private final DesignationRepository repository;
    private final LiveHeadcount headcount;
    private final GradeRepository grades;

    public DesignationService(DesignationRepository repository, LiveHeadcount headcount, GradeRepository grades) {
        this.repository = repository;
        this.headcount = headcount;
        this.grades = grades;
    }

    @Transactional(readOnly = true)
    public List<DesignationResponse> listForCompany(UUID companyId, UUID departmentFilter) {
        Map<UUID, Integer> counts = headcount.byColumn("designation_id");
        Map<UUID, String> gradeCodes = new HashMap<>();
        grades.findByCompanyId(companyId).forEach(g -> gradeCodes.put(g.getId(), g.getCode()));
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
        return filtered.stream().map(x -> toResponse(x, counts.getOrDefault(x.getId(), 0), gradeCodes)).toList();
    }

    /**
     * Revives a soft-deleted designation of the same title rather than
     * rejecting it. archive() only flips active=false and the list filters on
     * activeTrue, so the row is invisible to the user but still visible to the
     * old exists-check — "add, delete, add the same again" returned 422
     * (client report 2026-08-30). Filtering the check by active would instead
     * hit the non-partial unique index uq_designation_tenant_title and fail as
     * a 500. Re-using the row also keeps any FK pointing at this designation.
     */
    public DesignationResponse create(CreateDesignationRequest req) {
        Designation existing = repository
                .findByCompanyIdAndTitleIgnoreCase(req.companyId(), req.title())
                .orElse(null);
        if (existing != null && existing.isActive()) {
            throw new BusinessRuleException("Designation '" + req.title() + "' already exists", "DUPLICATE_DESIGNATION");
        }
        Designation d = existing != null ? existing : new Designation();
        d.setCompanyId(req.companyId());
        d.setTitle(req.title());
        applyGrade(d, req.gradeId(), req.grade());
        d.setCode(checkedCode(d, req.code()));
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
        applyGrade(d, req.gradeId(), req.grade());
        // Older callers don't send a code: keep the one it has.
        if (req.code() != null) d.setCode(checkedCode(d, req.code()));
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

    /**
     * Link the designation to a grade. A {@code gradeId} must be a grade of the
     * same company; the text then mirrors its code. Without one, text that is
     * exactly a grade's code is linked to that grade; any other text is kept as
     * it is (it shows as a plain chip) and blank clears the grade.
     */
    void applyGrade(Designation d, UUID gradeId, String gradeText) {
        if (gradeId != null) {
            Grade g = grades.findById(gradeId)
                    .orElseThrow(() -> new BusinessRuleException("That grade doesn't exist any more", "GRADE_NOT_FOUND"));
            if (!g.getCompanyId().equals(d.getCompanyId())) {
                throw new BusinessRuleException("That grade belongs to another company", "GRADE_OTHER_COMPANY");
            }
            if (!g.isActive() && !gradeId.equals(d.getGradeId())) {
                throw new BusinessRuleException("Grade " + g.getCode() + " is inactive; pick an active grade", "GRADE_INACTIVE");
            }
            d.setGradeId(g.getId());
            d.setGrade(g.getCode());
            return;
        }
        String text = gradeText == null || gradeText.isBlank() ? null : gradeText.trim();
        Grade match = text == null ? null : grades.findByCompanyIdAndCode(d.getCompanyId(), text)
                .or(() -> grades.findByCompanyIdAndCode(d.getCompanyId(), text.toUpperCase()))
                .filter(Grade::isActive)
                .orElse(null);
        d.setGradeId(match == null ? null : match.getId());
        d.setGrade(match == null ? text : match.getCode());
    }

    /** Upper-case, blank = none, unique within the company (archived titles included). */
    String checkedCode(Designation d, String code) {
        String next = code == null || code.isBlank() ? null : code.trim().toUpperCase();
        if (next == null) return null;
        repository.findFirstByCompanyIdAndCodeIgnoreCase(d.getCompanyId(), next)
                .filter(other -> !other.getId().equals(d.getId()))
                .ifPresent(other -> {
                    throw new BusinessRuleException("Code " + next + " is already used by " + other.getTitle()
                            + (other.isActive() ? "" : " (deactivated)"), "DUPLICATE_DESIGNATION_CODE");
                });
        return next;
    }

    private DesignationResponse toResponse(Designation d) {
        Map<UUID, String> gradeCodes = new HashMap<>();
        if (d.getGradeId() != null) grades.findById(d.getGradeId()).ifPresent(g -> gradeCodes.put(g.getId(), g.getCode()));
        return toResponse(d, headcount.countFor("designation_id", d.getId()), gradeCodes);
    }

    /** {@code employees}: people working there now (see LiveHeadcount), not the never-updated cached column. */
    private DesignationResponse toResponse(Designation d, int employees, Map<UUID, String> gradeCodes) {
        String grade = d.getGradeId() != null ? gradeCodes.getOrDefault(d.getGradeId(), d.getGrade()) : d.getGrade();
        return new DesignationResponse(
                d.getId(), d.getCompanyId(), d.getTitle(), grade,
                d.getDepartmentId(), d.getReportsToDesignationId(),
                d.getJobResponsibilities(), employees, d.isActive(),
                d.getGradeId(), d.getCode());
    }
}
