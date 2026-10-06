package com.hrms.api.performance;

import com.hrms.core.dto.PageResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
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
import com.hrms.performance.repository.ReviewCycleRepository;
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
    private final ReviewCycleRepository cycleRepository;
    private final PerformanceTeamScope teamScope;
    private final PerformanceInsightService insightService;
    private final PerformanceCycleService cycles;

    public PerformanceController(ReviewCycleService cycleService,
                                 PerformanceReviewService reviewService,
                                 GoalService goalService,
                                 EmployeeRepository employeeRepository,
                                 ReviewCycleRepository cycleRepository,
                                 PerformanceTeamScope teamScope,
                                 PerformanceInsightService insightService,
                                 PerformanceCycleService cycles) {
        this.cycleService = cycleService;
        this.reviewService = reviewService;
        this.goalService = goalService;
        this.employeeRepository = employeeRepository;
        this.cycleRepository = cycleRepository;
        this.teamScope = teamScope;
        this.insightService = insightService;
        this.cycles = cycles;
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
                : com.unifiedtree.security.tenant.CompanyContext.currentOr(  // the selected company (X-Company-Id), else the caller's own
                        employeeRepository.findById(employeeId).map(Employee::getCompanyId).orElse(null));
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(cycleService.createCycle(companyId, request));
    }

    /** Today's fields, plus each cycle's step dates ({@code milestones}; null until V143.61 is applied). */
    @Operation(summary = "List review cycles")
    @GetMapping("/cycles")
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    public ResponseEntity<List<PerformanceCycleService.CycleView>> listCycles() {
        return ResponseEntity.ok(cycles.withMilestones(tenant(), cycleService.listCycles()));
    }

    // Redesign BW-78/79/84. Literal paths (summary, my-current) are mapped
    // explicitly; Spring prefers them over the {id} patterns below.

    @Operation(summary = "Reviews and submitted per cycle, in your performance scope")
    @GetMapping("/cycles/summary")
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    public List<PerformanceCycleService.CycleCount> cycleSummary() {
        return cycles.summary(tenant(), teamScope.visibleEmployeeIds());
    }

    @Operation(summary = "A cycle's reviews by reviewer type and status, with its dates")
    @GetMapping("/cycles/{id}/stages")
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    public PerformanceCycleService.CycleStages cycleStages(@PathVariable UUID id) {
        return cycles.stages(tenant(), id, teamScope.visibleEmployeeIds());
    }

    @Operation(summary = "Submitted manager reviews in a cycle by rating")
    @GetMapping("/cycles/{id}/ratings")
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    public PerformanceCycleService.CycleRatings cycleRatings(@PathVariable UUID id) {
        return cycles.ratings(tenant(), id, teamScope.visibleEmployeeIds());
    }

    @Operation(summary = "Set a cycle's step dates and whether feedback waits until it's shared")
    @PutMapping("/cycles/{id}/milestones")
    @PreAuthorize("hasAuthority('hrms.performance.write')")
    public PerformanceCycleService.Milestones saveMilestones(@PathVariable UUID id,
                                                             @RequestBody PerformanceCycleService.MilestonesRequest request,
                                                             @AuthenticationPrincipal Jwt jwt) {
        return cycles.saveMilestones(tenant(), id, request, actorUserId(jwt));
    }

    @Operation(summary = "Share a cycle's feedback with the people reviewed")
    @PostMapping("/cycles/{id}/share")
    @PreAuthorize("hasAuthority('hrms.performance.write')")
    public PerformanceCycleService.Milestones shareCycle(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return cycles.share(tenant(), id, actorUserId(jwt));
    }

    @Operation(summary = "My steps in the open cycles I'm reviewed in")
    @GetMapping("/cycles/my-current")
    @PreAuthorize("hasAuthority('hrms.performance.review.self')")
    public List<PerformanceCycleService.MyCycle> myCurrentCycle(@AuthenticationPrincipal Jwt jwt) {
        return cycles.myCurrent(tenant(), PerformanceInsightController.employeeId(jwt));
    }

    @Operation(summary = "Activate a review cycle")
    @PostMapping("/cycles/{id}/activate")
    @PreAuthorize("hasAuthority('hrms.performance.write')")
    public ResponseEntity<ReviewCycleResponse> activateCycle(@PathVariable UUID id) {
        return ResponseEntity.ok(cycleService.activateCycle(id));
    }

    // ─── Reviews ─────────────────────────────────────────────────────────────

    /**
     * Reviews I write and reviews about me. Redesign BW-78: while a cycle holds its
     * feedback until it's shared, SUBMITTED reviews other people wrote about me in
     * that cycle are left out until an admin shares the cycle.
     */
    @Operation(summary = "Get my performance reviews")
    @GetMapping("/reviews/my")
    @PreAuthorize("hasAuthority('hrms.performance.review.self')")
    public ResponseEntity<List<PerformanceReviewResponse>> myReviews(@AuthenticationPrincipal Jwt jwt) {
        UUID me = extractEmployeeId(jwt);
        List<PerformanceReviewResponse> mine = reviewService.getMyReviews(me);
        Set<UUID> held = cycles.heldCycles(tenant(), mine.stream().map(PerformanceReviewResponse::cycleId)
                .filter(java.util.Objects::nonNull).collect(Collectors.toSet()));
        List<PerformanceReviewResponse> visible = mine.stream()
                .filter(r -> !PerformanceCycleService.hiddenFrom(me, r.employeeId(), r.reviewerId(),
                        r.status() == null ? null : r.status().name(), held.contains(r.cycleId())))
                .toList();
        return ResponseEntity.ok(enrichList(visible));
    }

    /** {@code status}: WAITING (to write or drafted), SUBMITTED or MISSED; blank = every review, as before. */
    @Operation(summary = "List performance reviews, optionally filtered by cycle and status")
    @GetMapping("/reviews")
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    public ResponseEntity<PageResponse<PerformanceReviewResponse>> listReviews(
            @RequestParam(required = false) UUID cycleId,
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        List<String> statuses = PerformanceCycleService.statusesFor(status);
        // Admin / HR see the company; a department manager sees reviews about their team only.
        return ResponseEntity.ok(enrichPage(reviewService.listReviews(cycleId, teamScope.visibleEmployeeIds(),
                statuses == null ? null : statuses.stream().map(com.hrms.performance.enums.ReviewStatus::valueOf).toList(),
                pageable)));
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

    /** Body of the draft save: every field optional; the rating, when given, is 0 to 5. */
    public record ReviewDraftRequest(java.math.BigDecimal overallRating,
                                     @jakarta.validation.constraints.Size(max = 5000) String strengths,
                                     @jakarta.validation.constraints.Size(max = 5000) String improvements) {}

    /** Redesign BW-84: save a review you write as a draft (it becomes IN_PROGRESS). */
    @Operation(summary = "Save a review you write as a draft")
    @PutMapping("/reviews/{id}/draft")
    @PreAuthorize("hasAuthority('hrms.performance.review.self')")
    public ResponseEntity<PerformanceReviewResponse> saveDraft(
            @PathVariable UUID id,
            @Valid @RequestBody ReviewDraftRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(enrichOne(reviewService.saveDraft(id, PerformanceInsightController.employeeId(jwt),
                request.overallRating(), request.strengths(), request.improvements())));
    }

    // ─── Goals (employee self-service) ───────────────────────────────────────

    /** Redesign BW-84: each goal also carries its due date and its last progress update. */
    @Operation(summary = "Get my goals")
    @GetMapping("/goals/my")
    @PreAuthorize("hasAuthority('hrms.performance.review.self')")
    public ResponseEntity<List<GoalResponse>> myGoals(@AuthenticationPrincipal Jwt jwt) {
        UUID me = extractEmployeeId(jwt);
        return ResponseEntity.ok(insightService.withExtras(tenant(), me, goalService.getMyGoals(me)));
    }

    /** Redesign BW-84: an optional due date (and company KPI, BW-83) is saved with the goal. */
    @Operation(summary = "Create a goal")
    @PostMapping("/goals")
    @PreAuthorize("hasAuthority('hrms.performance.review.self')")
    public ResponseEntity<GoalResponse> createGoal(
            @Valid @RequestBody GoalRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID me = extractEmployeeId(jwt);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(insightService.createMyGoal(tenant(), me, request, actorUserId(jwt)));
    }

    @Operation(summary = "Update progress on a goal")
    @PutMapping("/goals/{id}/progress")
    @PreAuthorize("hasAuthority('hrms.performance.review.self')")
    public ResponseEntity<GoalResponse> updateGoalProgress(
            @PathVariable UUID id,
            @Valid @RequestBody PerformanceInsightService.SelfGoalProgressRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        // Same rules as before (GoalService), and each change now lands in the
        // goal's progress history with the optional note (2026-09-25).
        return ResponseEntity.ok(insightService.updateMyGoalProgress(
                com.unifiedtree.security.tenant.TenantContext.getTenantId(), id, extractEmployeeId(jwt),
                request, actorUserId(jwt)));
    }

    // ─── Employee identity enrichment ────────────────────────────────────────
    // The performance module has no dependency on hrms-employee, so the
    // reviewee's / reviewer's name + code are resolved here (the API layer) and
    // folded into the response so admin/self cards can show WHO is involved.
    // Redesign BW-81: also the reviewer type, the reviewee's department and the
    // review's due date (JDBC; the entity doesn't map reviewer_type).

    private PageResponse<PerformanceReviewResponse> enrichPage(PageResponse<PerformanceReviewResponse> page) {
        List<PerformanceReviewResponse> enriched = enrichList(page.content());
        return new PageResponse<>(enriched, page.page(), page.size(),
                page.totalElements(), page.totalPages(), page.last());
    }

    private List<PerformanceReviewResponse> enrichList(List<PerformanceReviewResponse> reviews) {
        Map<UUID, Employee> employeeMap = loadEmployees(reviews);
        Map<UUID, String> cycleNames = loadCycleNames(reviews);
        Map<UUID, PerformanceCycleService.ReviewExtras> extras =
                cycles.extras(tenant(), reviews.stream().map(PerformanceReviewResponse::id).toList());
        return reviews.stream().map(r -> enrich(r, employeeMap, cycleNames, extras.get(r.id()))).toList();
    }

    private PerformanceReviewResponse enrichOne(PerformanceReviewResponse r) {
        return enrichList(List.of(r)).get(0);
    }

    private Map<UUID, String> loadCycleNames(List<PerformanceReviewResponse> reviews) {
        Set<UUID> ids = reviews.stream().map(PerformanceReviewResponse::cycleId)
                .filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        if (ids.isEmpty()) return Map.of();
        return cycleRepository.findAllById(ids).stream().collect(Collectors.toMap(
                com.hrms.performance.entity.ReviewCycle::getId,
                com.hrms.performance.entity.ReviewCycle::getName));
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

    private PerformanceReviewResponse enrich(PerformanceReviewResponse r, Map<UUID, Employee> employeeMap,
                                             Map<UUID, String> cycleNames, PerformanceCycleService.ReviewExtras extra) {
        Employee employee = r.employeeId() != null ? employeeMap.get(r.employeeId()) : null;
        Employee reviewer = r.reviewerId() != null ? employeeMap.get(r.reviewerId()) : null;
        String employeeName = fullName(employee);
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        String reviewerName = fullName(reviewer);
        return new PerformanceReviewResponse(
                r.id(), r.cycleId(), r.employeeId(), employeeName, employeeCode,
                r.reviewerId(), reviewerName, r.status(), r.overallRating(),
                r.strengths(), r.improvements(), r.submittedAt(), r.createdAt(), cycleNames.get(r.cycleId()),
                extra == null ? null : extra.reviewerType(), extra == null ? null : extra.department(),
                extra == null ? null : extra.dueDate());
    }

    private String fullName(Employee employee) {
        return employee != null ? (employee.getFirstName() + " " + (employee.getLastName() == null ? "" : employee.getLastName())).trim() : null;
    }

    private static UUID tenant() {
        return com.unifiedtree.security.tenant.TenantContext.getTenantId();
    }

    private static UUID actorUserId(Jwt jwt) {
        if (jwt == null) return null;
        try { return UUID.fromString(jwt.getSubject()); } catch (Exception e) { return null; }
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
