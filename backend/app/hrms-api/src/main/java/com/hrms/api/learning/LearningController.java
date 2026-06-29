package com.hrms.api.learning;

import com.hrms.core.dto.PageResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.learning.dto.CompleteEnrollmentRequest;
import com.hrms.learning.dto.EmployeeSkillRequest;
import com.hrms.learning.dto.EmployeeSkillResponse;
import com.hrms.learning.dto.EnrollmentResponse;
import com.hrms.learning.dto.ProgramStatusRequest;
import com.hrms.learning.dto.TrainingProgramRequest;
import com.hrms.learning.dto.TrainingProgramResponse;
import com.hrms.learning.service.LearningService;
import com.hrms.learning.service.SkillService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Learning &amp; Development: training program administration, employee
 * self-enrollment, completion tracking, and a per-employee skill / certification
 * matrix. Tenant isolation is enforced at the database layer (RLS); this layer
 * resolves employee identity from the JWT and enriches list responses with the
 * enrolled employee's name / code.
 */
@RestController
@RequestMapping("/v1/learning")
@Tag(name = "Learning & Development", description = "Training programs, enrollments, skills and certifications")
@SecurityRequirement(name = "bearerAuth")
public class LearningController {

    private final LearningService learningService;
    private final SkillService skillService;
    private final EmployeeRepository employeeRepository;

    public LearningController(LearningService learningService,
                             SkillService skillService,
                             EmployeeRepository employeeRepository) {
        this.learningService = learningService;
        this.skillService = skillService;
        this.employeeRepository = employeeRepository;
    }

    // ─── Programs ────────────────────────────────────────────────────────────

    @Operation(summary = "Create a training program")
    @PostMapping("/programs")
    @PreAuthorize("hasAuthority('hrms.learning.write')")
    public ResponseEntity<TrainingProgramResponse> createProgram(
            @Valid @RequestBody TrainingProgramRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        UUID companyId = request.companyId();
        if (companyId == null) {
            Employee creator = employeeRepository.findById(employeeId)
                    .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
            companyId = creator.getCompanyId();
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(learningService.createProgram(companyId, request));
    }

    @Operation(summary = "List training programs")
    @GetMapping("/programs")
    @PreAuthorize("hasAuthority('hrms.learning.read')")
    public ResponseEntity<PageResponse<TrainingProgramResponse>> listPrograms(
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(learningService.listPrograms(pageable));
    }

    @Operation(summary = "Get a single training program")
    @GetMapping("/programs/{id}")
    @PreAuthorize("hasAuthority('hrms.learning.read')")
    public ResponseEntity<TrainingProgramResponse> getProgram(@PathVariable UUID id) {
        return ResponseEntity.ok(learningService.getProgram(id));
    }

    @Operation(summary = "Change the status of a training program")
    @PostMapping("/programs/{id}/status")
    @PreAuthorize("hasAuthority('hrms.learning.write')")
    public ResponseEntity<TrainingProgramResponse> changeStatus(
            @PathVariable UUID id,
            @Valid @RequestBody ProgramStatusRequest request) {
        return ResponseEntity.ok(learningService.changeStatus(id, request));
    }

    // ─── Enrollments ─────────────────────────────────────────────────────────

    @Operation(summary = "Enroll the current employee in a training program")
    @PostMapping("/programs/{id}/enroll")
    @PreAuthorize("hasAuthority('hrms.learning.enroll.self')")
    public ResponseEntity<EnrollmentResponse> enroll(
            @PathVariable UUID id,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(enrichOne(learningService.enroll(id, extractEmployeeId(jwt))));
    }

    @Operation(summary = "List enrollments for a training program")
    @GetMapping("/programs/{id}/enrollments")
    @PreAuthorize("hasAuthority('hrms.learning.read')")
    public ResponseEntity<List<EnrollmentResponse>> programEnrollments(@PathVariable UUID id) {
        return ResponseEntity.ok(enrichList(learningService.getProgramEnrollments(id)));
    }

    @Operation(summary = "Mark an enrollment as completed")
    @PostMapping("/enrollments/{id}/complete")
    @PreAuthorize("hasAuthority('hrms.learning.write')")
    public ResponseEntity<EnrollmentResponse> completeEnrollment(
            @PathVariable UUID id,
            @Valid @RequestBody CompleteEnrollmentRequest request) {
        return ResponseEntity.ok(enrichOne(learningService.completeEnrollment(id, request)));
    }

    @Operation(summary = "Get my training enrollments")
    @GetMapping("/my-enrollments")
    @PreAuthorize("hasAuthority('hrms.learning.enroll.self')")
    public ResponseEntity<List<EnrollmentResponse>> myEnrollments(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(enrichList(learningService.getMyEnrollments(extractEmployeeId(jwt))));
    }

    // ─── Skills & certifications ─────────────────────────────────────────────

    @Operation(summary = "List skills and certifications for an employee")
    @GetMapping("/skills/{employeeId}")
    @PreAuthorize("hasAuthority('hrms.learning.read')")
    public ResponseEntity<List<EmployeeSkillResponse>> employeeSkills(@PathVariable UUID employeeId) {
        return ResponseEntity.ok(skillService.getSkills(employeeId));
    }

    @Operation(summary = "Add or update an employee skill")
    @PostMapping("/skills")
    @PreAuthorize("hasAuthority('hrms.learning.write')")
    public ResponseEntity<EmployeeSkillResponse> upsertSkill(
            @Valid @RequestBody EmployeeSkillRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(skillService.upsertSkill(request));
    }

    @Operation(summary = "Get my skills and certifications")
    @GetMapping("/my-skills")
    @PreAuthorize("hasAuthority('hrms.learning.enroll.self')")
    public ResponseEntity<List<EmployeeSkillResponse>> mySkills(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(skillService.getSkills(extractEmployeeId(jwt)));
    }

    // ─── Enrollee identity enrichment ────────────────────────────────────────
    // The learning module has no dependency on hrms-employee, so the enrolled
    // employee's name / code are resolved here (the API layer) and folded into
    // the response so program rosters can show WHO is enrolled.

    private List<EnrollmentResponse> enrichList(List<EnrollmentResponse> rows) {
        List<UUID> employeeIds = rows.stream()
                .map(EnrollmentResponse::employeeId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, Employee> employeeMap = employeeIds.isEmpty()
                ? Map.of()
                : employeeRepository.findAllById(employeeIds).stream()
                        .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        return rows.stream()
                .map(r -> enrich(r, employeeMap.get(r.employeeId())))
                .toList();
    }

    private EnrollmentResponse enrichOne(EnrollmentResponse r) {
        Employee employee = r.employeeId() == null
                ? null
                : employeeRepository.findById(r.employeeId()).orElse(null);
        return enrich(r, employee);
    }

    private EnrollmentResponse enrich(EnrollmentResponse r, Employee employee) {
        String employeeName = employee != null
                ? (employee.getFirstName() + " " + employee.getLastName()).trim()
                : null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        return new EnrollmentResponse(
                r.id(), r.programId(), r.programTitle(), r.employeeId(),
                employeeName, employeeCode, r.status(), r.completedAt(), r.score(), r.createdAt());
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
