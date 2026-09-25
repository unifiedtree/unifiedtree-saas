package com.hrms.api.workforce;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.employee.workforce.dto.WorkforceDtos.ClassificationRuleResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.ContractorResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.ContractorWorkerResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.DepartmentBranchesRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.DepartmentResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.EmployeePayBandResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateClassificationRuleRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateContractorRequest;
import com.hrms.employee.workforce.service.ClassificationRuleService;
import com.hrms.employee.workforce.service.ContractorService;
import com.hrms.employee.workforce.service.DepartmentService;
import com.hrms.employee.workforce.service.GradeService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Master data, organisation setup: the endpoints added on 2026-09-25 (V143.22)
 * so the Master pages' "Coming soon" controls could be switched on. Kept apart
 * from {@link WorkforceController} so that file only changes where an existing
 * endpoint changed. Same base path, same permission codes as their siblings.
 *
 * <ul>
 *   <li>Contractor agencies: edit, reactivate, and the contract workers linked
 *       to each one.</li>
 *   <li>Departments: move under another department (no loops), and the
 *       branches a department works in.</li>
 *   <li>Classification rules: update.</li>
 *   <li>Pay bands: the grade band that applies to each employee, for the
 *       Salary Structure warning.</li>
 * </ul>
 */
@RestController
@RequestMapping("/v1/hrms")
public class MasterDataController {

    private final ContractorService contractors;
    private final DepartmentService departments;
    private final ClassificationRuleService classifications;
    private final GradeService grades;
    private final TeamEmployeeScope teamScope;

    public MasterDataController(ContractorService contractors,
                                @Qualifier("workforceDepartmentService") DepartmentService departments,
                                ClassificationRuleService classifications,
                                GradeService grades,
                                TeamEmployeeScope teamScope) {
        this.contractors = contractors;
        this.departments = departments;
        this.classifications = classifications;
        this.grades = grades;
        this.teamScope = teamScope;
    }

    /** Whether the signed-in user holds {@code authority} (a permission code). */
    static boolean holds(String authority) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }

    // -- Contractor agencies -------------------------------------------------

    /** Edit an agency (partial: fields left out are unchanged). Works on ended agencies too. */
    @PutMapping("/contractors/{id}")
    @PreAuthorize("hasAuthority('hrms.contractor.write')")
    public ContractorResponse updateContractor(@PathVariable UUID id, @Valid @RequestBody UpdateContractorRequest req) {
        return contractors.update(id, req);
    }

    /** Reactivate an agency whose contract was ended. */
    @PostMapping("/contractors/{id}/restore")
    @PreAuthorize("hasAuthority('hrms.contractor.write')")
    public ContractorResponse restoreContractor(@PathVariable UUID id) {
        return contractors.restore(id);
    }

    /**
     * The contract workers linked to an agency. People who manage agencies or
     * employee records see all of them; anyone else with agency read access (a
     * department manager) sees only the workers in their own team.
     */
    @GetMapping("/contractors/{id}/workers")
    @PreAuthorize("hasAuthority('hrms.contractor.read')")
    public List<ContractorWorkerResponse> contractorWorkers(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        List<ContractorWorkerResponse> all = contractors.workers(id);
        if (holds("hrms.contractor.write") || holds("hrms.employee.write")) return all;
        Set<UUID> team = team(jwt);
        return all.stream().filter(w -> team.contains(w.employeeId())).toList();
    }

    /** The caller's team (department head: the department; otherwise direct reports). Empty without an employee record. */
    private Set<UUID> team(Jwt jwt) {
        if (jwt == null) return Set.of();
        try {
            return teamScope.resolve(jwt, null).stream()
                    .map(com.hrms.employee.entity.Employee::getId)
                    .collect(Collectors.toSet());
        } catch (IllegalArgumentException noEmployeeRecord) {
            return Set.of();
        }
    }

    /**
     * Link a contract worker to this agency (moving them from another agency if
     * needed). Part of the employee's record, so employee editors may do it as
     * well as agency managers.
     */
    @PutMapping("/contractors/{id}/workers/{employeeId}")
    @PreAuthorize("hasAnyAuthority('hrms.contractor.write','hrms.employee.write')")
    public ContractorWorkerResponse linkWorker(@PathVariable UUID id, @PathVariable UUID employeeId,
                                               @AuthenticationPrincipal Jwt jwt) {
        return contractors.linkWorker(id, employeeId, actor(jwt));
    }

    @DeleteMapping("/contractors/{id}/workers/{employeeId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAnyAuthority('hrms.contractor.write','hrms.employee.write')")
    public void unlinkWorker(@PathVariable UUID id, @PathVariable UUID employeeId) {
        contractors.unlinkWorker(id, employeeId);
    }

    // -- Departments ---------------------------------------------------------

    /** Move a department under {@code parentId}, or to the top level when it is left out. */
    @PatchMapping("/departments/{id}/parent")
    @PreAuthorize("hasAuthority('hrms.department.write')")
    public DepartmentResponse moveDepartment(@PathVariable UUID id, @RequestParam(required = false) UUID parentId) {
        return departments.moveUnder(id, parentId);
    }

    /** Replace the branches a department works in (empty = not limited to any branch). */
    @PutMapping("/departments/{id}/branches")
    @PreAuthorize("hasAuthority('hrms.department.write')")
    public DepartmentResponse setDepartmentBranches(@PathVariable UUID id, @Valid @RequestBody DepartmentBranchesRequest req) {
        return departments.setBranches(id, req.branchIds());
    }

    // -- Classification rules ------------------------------------------------

    /** Update a classification rule; the same permission as creating and deleting one. */
    @PutMapping("/classifications/{id}")
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    public ClassificationRuleResponse updateClassification(@PathVariable UUID id,
                                                           @Valid @RequestBody UpdateClassificationRuleRequest req) {
        return classifications.update(id, req);
    }

    // -- Pay bands -----------------------------------------------------------

    /**
     * The pay band of each listed employee's designation's grade (at most 500
     * ids). People with no linked grade are left out. Pay data: needs
     * hrms.grade.band.read.
     */
    @GetMapping("/pay-bands")
    @PreAuthorize("hasAuthority('hrms.grade.band.read')")
    public List<EmployeePayBandResponse> payBands(@RequestParam("employeeIds") List<UUID> employeeIds) {
        return grades.bandsForEmployees(employeeIds);
    }

    private static String actor(Jwt jwt) {
        if (jwt == null) return null;
        Object email = jwt.getClaims().get("email");
        return email != null ? email.toString() : jwt.getSubject();
    }
}
