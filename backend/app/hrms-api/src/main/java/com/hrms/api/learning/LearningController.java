package com.hrms.api.learning;

import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Training programs + enrollments. Wave 6 (2026-08-11).
 *
 * <ul>
 *   <li>Read → {@code hrms.learning.read}</li>
 *   <li>Manage programs → {@code hrms.learning.manage}</li>
 *   <li>Self-enrol / drop → {@code hrms.learning.enroll.self}</li>
 * </ul>
 *
 * <p>Sits alongside the existing learning JPA module — this raw-JDBC layer
 * covers the CRUD + bulk-enrol flows that mismatch JPA's per-entity idiom.
 */
@RestController
@RequestMapping("/v1/learning")
public class LearningController {

    private final LearningService service;

    public LearningController(LearningService service) {
        this.service = service;
    }

    // ── Programs ─────────────────────────────────────────────────────────────

    @GetMapping("/programs")
    @PreAuthorize("hasAuthority('hrms.learning.read')")
    public LearningService.PageDto<LearningService.ProgramDto> listPrograms(
            @RequestParam(required = false) UUID companyId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {
        return service.listPrograms(TenantContext.getTenantId(),
                companyId, status, search, page, size);
    }

    @GetMapping("/programs/{id}")
    @PreAuthorize("hasAuthority('hrms.learning.read')")
    public LearningService.ProgramDto getProgram(@PathVariable UUID id) {
        return service.getProgram(TenantContext.getTenantId(), id);
    }

    @PostMapping("/programs")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.learning.manage')")
    public LearningService.ProgramDto createProgram(
            @Valid @RequestBody LearningService.CreateProgramRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.createProgram(TenantContext.getTenantId(), req, actorId(jwt));
    }

    @PutMapping("/programs/{id}")
    @PreAuthorize("hasAuthority('hrms.learning.manage')")
    public LearningService.ProgramDto updateProgram(
            @PathVariable UUID id,
            @Valid @RequestBody LearningService.UpdateProgramRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.updateProgram(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    // ── Enrollments ──────────────────────────────────────────────────────────

    @GetMapping("/programs/{id}/enrollments")
    @PreAuthorize("hasAuthority('hrms.learning.read')")
    public List<LearningService.EnrollmentDto> listEnrollments(@PathVariable UUID id) {
        return service.listEnrollments(TenantContext.getTenantId(), id);
    }

    @PostMapping("/programs/{id}/enrollments")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.learning.manage')")
    public LearningService.EnrollmentDto enroll(
            @PathVariable UUID id,
            @Valid @RequestBody LearningService.EnrollRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.enroll(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    @PostMapping("/programs/{id}/enrollments/bulk")
    @PreAuthorize("hasAuthority('hrms.learning.manage')")
    public LearningService.BulkEnrollResult bulkEnroll(
            @PathVariable UUID id,
            @Valid @RequestBody LearningService.BulkEnrollRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.bulkEnroll(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    @PostMapping("/enrollments/{id}/drop")
    @PreAuthorize("hasAuthority('hrms.learning.enroll.self')")
    public LearningService.EnrollmentDto drop(@PathVariable UUID id,
                                             @AuthenticationPrincipal Jwt jwt) {
        return service.drop(TenantContext.getTenantId(), id, actorId(jwt));
    }

    @PostMapping("/enrollments/{id}/complete")
    @PreAuthorize("hasAuthority('hrms.learning.manage')")
    public LearningService.EnrollmentDto complete(
            @PathVariable UUID id,
            @RequestBody(required = false) LearningService.CompleteEnrollmentRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.complete(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    /** Employee self-service list of their own enrollments. */
    @GetMapping("/enrollments/me")
    @PreAuthorize("hasAuthority('hrms.learning.enroll.self')")
    public List<LearningService.EnrollmentDto> myEnrollments(@AuthenticationPrincipal Jwt jwt) {
        UUID empId = employeeId(jwt);
        if (empId == null) return List.of();
        return service.myEnrollments(TenantContext.getTenantId(), empId);
    }

    private static UUID actorId(Jwt jwt) {
        if (jwt == null) return null;
        try { return UUID.fromString(jwt.getSubject()); } catch (Exception e) { return null; }
    }

    private static UUID employeeId(Jwt jwt) {
        if (jwt == null) return null;
        Object claim = jwt.getClaim("employee_id");
        if (claim != null) {
            try { return UUID.fromString(claim.toString()); } catch (Exception e) { /* fall through */ }
        }
        try { return UUID.fromString(jwt.getSubject()); } catch (Exception e) { return null; }
    }
}
