package com.hrms.api.performance;

import com.hrms.core.dto.PageResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.performance.dto.GoalProgressRequest;
import com.hrms.performance.dto.GoalRequest;
import com.hrms.performance.dto.GoalResponse;
import com.hrms.performance.dto.PerformanceReviewRequest;
import com.hrms.performance.dto.PerformanceReviewResponse;
import com.hrms.performance.dto.ReviewCycleRequest;
import com.hrms.performance.dto.ReviewCycleResponse;
import com.hrms.performance.dto.ReviewSubmitRequest;
import com.hrms.performance.service.GoalService;
import com.hrms.performance.service.PerformanceReviewService;
import com.hrms.performance.service.ReviewCycleService;
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

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Performance management: review cycles, performance reviews (manager-authored,
 * employee-visible), and employee self-service goals with progress tracking.
 */
@RestController
@RequestMapping("/v1/performance")
@Tag(name = "Performance", description = "Review cycles, performance reviews, and goals")
@SecurityRequirement(name = "bearerAuth")
public class PerformanceController {

    private final ReviewCycleService cycleService;
    private final PerformanceReviewService reviewService;
    private final GoalService goalService;
    private final EmployeeRepository employeeRepository;

    public PerformanceController(ReviewCycleService cycleService,
                                 PerformanceReviewService reviewService,
                                 GoalService goalService,
                                 EmployeeRepository employeeRepository) {
        this.cycleService = cycleService;
        this.reviewService = reviewService;
        this.goalService = goalService;
        this.employeeRepository = employeeRepository;
    }

    // ─── Review cycles (admin) ───────────────────────────────────────────────

    @Operation(summary = "Create a review cycle")
    @PostMapping("/cycles")
    @PreAuthorize("hasAuthority('hrms.performance.write')")
    public ResponseEntity<ReviewCycleResponse> createCycle(
            @Valid @RequestBody ReviewCycleRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        UUID companyId = request.companyId() != null
                ? request.companyId()
                : employeeRepository.findById(employeeId).map(Employee::getCompanyId).orElse(null);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(cycleService.createCycle(companyId, request));
    }

    @Operation(summary = "List review cycles")
    @GetMapping("/cycles")
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    public ResponseEntity<List<ReviewCycleResponse>> listCycles() {
        return ResponseEntity.ok(cycleService.listCycles());
    }

    @Operation(summary = "Activate a review cycle")
    @PostMapping("/cycles/{id}/activate")
    @PreAuthorize("hasAuthority('hrms.performance.write')")
    public ResponseEntity<ReviewCycleResponse> activateCycle(@PathVariable UUID id) {
        return ResponseEntity.ok(cycleService.activateCycle(id));
    }

    // ─── Reviews ─────────────────────────────────────────────────────────────

    @Operation(summary = "Get my performance reviews")
    @GetMapping("/reviews/my")
    @PreAuthorize("hasAuthority('hrms.performance.review.self')")
    public ResponseEntity<List<PerformanceReviewResponse>> myReviews(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(enrichList(reviewService.getMyReviews(extractEmployeeId(jwt))));
    }

    @Operation(summary = "List performance reviews, optionally filtered by cycle")
    @GetMapping("/reviews")
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    public ResponseEntity<PageResponse<PerformanceReviewResponse>> listReviews(
            @RequestParam(required = false) UUID cycleId,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(enrichPage(reviewService.listReviews(cycleId, pageable)));
    }

    @Operation(summary = "Create a performance review for an employee")
    @PostMapping("/reviews")
    @PreAuthorize("hasAuthority('hrms.performance.write')")
    public ResponseEntity<PerformanceReviewResponse> createReview(
            @Valid @RequestBody PerformanceReviewRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(enrichOne(reviewService.createReview(extractEmployeeId(jwt), request)));
    }

    @Operation(summary = "Submit (fill in) a pending performance review")
    @PostMapping("/reviews/{id}/submit")
    @PreAuthorize("hasAuthority('hrms.performance.review.self')")
    public ResponseEntity<PerformanceReviewResponse> submitReview(
            @PathVariable UUID id,
            @Valid @RequestBody ReviewSubmitRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(enrichOne(reviewService.submitReview(id, extractEmployeeId(jwt), request)));
    }

    // ─── Goals (employee self-service) ───────────────────────────────────────

    @Operation(summary = "Get my goals")
    @GetMapping("/goals/my")
    @PreAuthorize("hasAuthority('hrms.performance.review.self')")
    public ResponseEntity<List<GoalResponse>> myGoals(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(goalService.getMyGoals(extractEmployeeId(jwt)));
    }

    @Operation(summary = "Create a goal")
    @PostMapping("/goals")
    @PreAuthorize("hasAuthority('hrms.performance.review.self')")
    public ResponseEntity<GoalResponse> createGoal(
            @Valid @RequestBody GoalRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(goalService.createGoal(extractEmployeeId(jwt), request));
    }

    @Operation(summary = "Update progress on a goal")
    @PutMapping("/goals/{id}/progress")
    @PreAuthorize("hasAuthority('hrms.performance.review.self')")
    public ResponseEntity<GoalResponse> updateGoalProgress(
            @PathVariable UUID id,
            @Valid @RequestBody GoalProgressRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(goalService.updateProgress(id, extractEmployeeId(jwt), request));
    }

    // ─── Employee identity enrichment ────────────────────────────────────────
    // The performance module has no dependency on hrms-employee, so the
    // reviewee's / reviewer's name + code are resolved here (the API layer) and
    // folded into the response so admin/self cards can show WHO is involved.

    private PageResponse<PerformanceReviewResponse> enrichPage(PageResponse<PerformanceReviewResponse> page) {
        Map<UUID, Employee> employeeMap = loadEmployees(page.content());
        List<PerformanceReviewResponse> enriched = page.content().stream()
                .map(r -> enrich(r, employeeMap))
                .toList();
        return new PageResponse<>(enriched, page.page(), page.size(),
                page.totalElements(), page.totalPages(), page.last());
    }

    private List<PerformanceReviewResponse> enrichList(List<PerformanceReviewResponse> reviews) {
        Map<UUID, Employee> employeeMap = loadEmployees(reviews);
        return reviews.stream().map(r -> enrich(r, employeeMap)).toList();
    }

    private PerformanceReviewResponse enrichOne(PerformanceReviewResponse r) {
        return enrich(r, loadEmployees(List.of(r)));
    }

    private Map<UUID, Employee> loadEmployees(List<PerformanceReviewResponse> reviews) {
        Set<UUID> ids = new HashSet<>();
        for (PerformanceReviewResponse r : reviews) {
            if (r.employeeId() != null) ids.add(r.employeeId());
            if (r.reviewerId() != null) ids.add(r.reviewerId());
        }
        if (ids.isEmpty()) return Map.of();
        return employeeRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
    }

    private PerformanceReviewResponse enrich(PerformanceReviewResponse r, Map<UUID, Employee> employeeMap) {
        Employee employee = r.employeeId() != null ? employeeMap.get(r.employeeId()) : null;
        Employee reviewer = r.reviewerId() != null ? employeeMap.get(r.reviewerId()) : null;
        String employeeName = fullName(employee);
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        String reviewerName = fullName(reviewer);
        return new PerformanceReviewResponse(
                r.id(), r.cycleId(), r.employeeId(), employeeName, employeeCode,
                r.reviewerId(), reviewerName, r.status(), r.overallRating(),
                r.strengths(), r.improvements(), r.submittedAt(), r.createdAt());
    }

    private String fullName(Employee employee) {
        return employee != null ? (employee.getFirstName() + " " + employee.getLastName()).trim() : null;
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
