package com.hrms.api.learning;

import com.hrms.learning.dto.EmployeeSkillRequest;
import com.hrms.learning.dto.EmployeeSkillResponse;
import com.hrms.learning.service.SkillService;
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
 *   <li>Manage programs → {@code hrms.learning.write}</li>
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
    private final SkillService skillService;

    public LearningController(LearningService service, SkillService skillService) {
        this.service = service;
        this.skillService = skillService;
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
    @PreAuthorize("hasAuthority('hrms.learning.write')")
    public LearningService.ProgramDto createProgram(
            @Valid @RequestBody LearningService.CreateProgramRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.createProgram(TenantContext.getTenantId(), req, actorId(jwt));
    }

    @PutMapping("/programs/{id}")
    @PreAuthorize("hasAuthority('hrms.learning.write')")
    public LearningService.ProgramDto updateProgram(
            @PathVariable UUID id,
            @Valid @RequestBody LearningService.UpdateProgramRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.updateProgram(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    // ── Enrollments ──────────────────────────────────────────────────────────

    /**
     * A program's roster — who is enrolled, their status and their SCORE.
     *
     * <p>2026-09-09: was hrms.learning.read, which V073 grants to EMPLOYEE and
     * DEPT_MANAGER so they can browse the training catalogue. That made every
     * colleague's training result readable by the whole company through a
     * single GET — the same leak the narrower hrms.learning.skill.read (V116)
     * was created to close on the skill matrix, via a different door.
     *
     * <p>Hiding the control in the SPA is not enough; the client's rule for
     * this workspace is to drop the capability and let the admin grant it back.
     * Managing a roster is a write-tier activity, so it takes the write
     * permission. Employees still see their OWN enrollments at /enrollments/me.
     */
    @GetMapping("/programs/{id}/enrollments")
    @PreAuthorize("hasAuthority('hrms.learning.write')")
    public List<LearningService.EnrollmentDto> listEnrollments(@PathVariable UUID id) {
        return service.listEnrollments(TenantContext.getTenantId(), id);
    }

    @PostMapping("/programs/{id}/enrollments")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.learning.write')")
    public LearningService.EnrollmentDto enroll(
            @PathVariable UUID id,
            @Valid @RequestBody LearningService.EnrollRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.enroll(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    /**
     * Self-enrolment — the "Enroll" button on the Programs tab.
     *
     * <p>2026-09-09: the SPA has always POSTed here, but no such mapping
     * existed — every click 404'd. The only enrol route was
     * {@code POST /programs/{id}/enrollments}, which takes an explicit
     * employeeId and is gated on {@code hrms.learning.write} — a permission
     * plain employees do not hold, so they could never enrol at all.
     *
     * <p>The employee id comes from the token, never the request body, so this
     * cannot be used to enrol somebody else. HR enrolling others keeps using
     * the {@code /enrollments} + {@code /enrollments/bulk} routes.
     */
    @PostMapping("/programs/{id}/enroll")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.learning.enroll.self')")
    public LearningService.EnrollmentDto enrollSelf(
            @PathVariable UUID id,
            @AuthenticationPrincipal Jwt jwt) {
        UUID empId = selfEmployeeId(jwt);
        return service.enroll(TenantContext.getTenantId(), id,
                new LearningService.EnrollRequest(empId), actorId(jwt));
    }

    @PostMapping("/programs/{id}/enrollments/bulk")
    @PreAuthorize("hasAuthority('hrms.learning.write')")
    public LearningService.BulkEnrollResult bulkEnroll(
            @PathVariable UUID id,
            @Valid @RequestBody LearningService.BulkEnrollRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.bulkEnroll(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    /**
     * Self-service drop — an employee drops their OWN enrollment.
     * QA FIX (2026-08-11): previously any user with this perm could drop
     * anyone's enrollment (intra-tenant IDOR). Service now enforces the
     * (actor employee_id == enrollment employee_id) check.
     */
    @PostMapping("/enrollments/{id}/drop")
    @PreAuthorize("hasAuthority('hrms.learning.enroll.self')")
    public LearningService.EnrollmentDto drop(@PathVariable UUID id,
                                             @AuthenticationPrincipal Jwt jwt) {
        return service.drop(TenantContext.getTenantId(), id, employeeId(jwt), actorId(jwt));
    }

    /**
     * Admin drop — HR / manager drops someone else's enrollment. Gated by
     * the higher permission so the self-perm can't be used for IDOR.
     */
    @PostMapping("/enrollments/{id}/admin-drop")
    @PreAuthorize("hasAuthority('hrms.learning.write')")
    public LearningService.EnrollmentDto adminDrop(@PathVariable UUID id,
                                                  @AuthenticationPrincipal Jwt jwt) {
        return service.adminDrop(TenantContext.getTenantId(), id, actorId(jwt));
    }

    @PostMapping("/enrollments/{id}/complete")
    @PreAuthorize("hasAuthority('hrms.learning.write')")
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

    // ── Skills & certifications ──────────────────────────────────────────────
    //
    // 2026-09-09: the SPA's entire "Skill Matrix" tab called three endpoints
    // that had NO mapping anywhere in the backend — GET /skills/{employeeId},
    // GET /my-skills and POST /skills. SkillService (hrms-learning module) has
    // implemented all of it since Wave 6; it simply was never exposed over
    // HTTP. Every read 404'd and every "Save Skill" click 404'd.
    //
    // Reading SOMEONE ELSE'S skills is gated on the new, narrower
    // hrms.learning.skill.read (V116) rather than hrms.learning.read, because
    // the latter is held by every EMPLOYEE so they can browse the program
    // catalogue — reusing it here would have let any employee read every
    // colleague's proficiency and certification record. Employees read their
    // own via /skills/me. Admins can widen it per role in Roles & Permissions.

    /** Employee self-service — own skills. Declared before /skills/{employeeId}
     *  so the literal "me" never reaches the UUID path-variable converter. */
    @GetMapping("/skills/me")
    @PreAuthorize("hasAuthority('hrms.learning.enroll.self')")
    public List<EmployeeSkillResponse> mySkills(@AuthenticationPrincipal Jwt jwt) {
        UUID empId = employeeId(jwt);
        if (empId == null) return List.of();
        return skillService.getSkills(empId);
    }

    @GetMapping("/skills/{employeeId}")
    @PreAuthorize("hasAuthority('hrms.learning.skill.read')")
    public List<EmployeeSkillResponse> employeeSkills(@PathVariable UUID employeeId) {
        return skillService.getSkills(employeeId);
    }

    @PostMapping("/skills")
    @PreAuthorize("hasAuthority('hrms.learning.write')")
    public EmployeeSkillResponse upsertSkill(@Valid @RequestBody EmployeeSkillRequest req) {
        return skillService.upsertSkill(req);
    }

    private static UUID actorId(Jwt jwt) {
        if (jwt == null) return null;
        try { return UUID.fromString(jwt.getSubject()); } catch (Exception e) { return null; }
    }

    /**
     * Strict variant of {@link #employeeId(Jwt)} for WRITES.
     *
     * <p>{@code employeeId()} falls back to the JWT subject (a user id) when
     * the employee_id claim is absent, which is harmless for a read that then
     * matches nothing — but on an INSERT it would persist a user id in
     * employee_id and produce an enrollment nobody can see or drop. Writes
     * therefore demand the real claim and 400 otherwise.
     */
    private static UUID selfEmployeeId(Jwt jwt) {
        String claim = jwt == null ? null : jwt.getClaimAsString("employee_id");
        if (claim == null || claim.isBlank()) {
            throw new com.hrms.core.exception.BusinessRuleException(
                    "Your login is not linked to an employee record, so you cannot enrol yourself. "
                            + "Ask HR to enrol you in this program.",
                    "NO_EMPLOYEE_RECORD");
        }
        try {
            return UUID.fromString(claim.trim());
        } catch (IllegalArgumentException e) {
            throw new com.hrms.core.exception.BusinessRuleException(
                    "Your session is malformed. Sign out and sign in again.",
                    "NO_EMPLOYEE_RECORD");
        }
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
