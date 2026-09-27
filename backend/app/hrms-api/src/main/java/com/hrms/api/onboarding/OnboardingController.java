package com.hrms.api.onboarding;

import com.hrms.employee.entity.OnboardingInstance;
import com.hrms.employee.entity.OnboardingInstanceTask;
import com.hrms.employee.entity.OnboardingTask;
import com.hrms.employee.entity.OnboardingAsset;
import com.hrms.employee.entity.OnboardingTemplate;
import com.hrms.employee.service.OnboardingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/onboarding")
@Tag(name = "Onboarding", description = "Onboarding template and instance management")
@SecurityRequirement(name = "bearerAuth")
public class OnboardingController {

    private final OnboardingService onboardingService;
    private final OnboardingHireDetailsService hireDetails;
    private final OnboardingOverviewService overview;
    private final AssetCareService assetCare;

    public OnboardingController(OnboardingService onboardingService, OnboardingHireDetailsService hireDetails,
                                OnboardingOverviewService overview, AssetCareService assetCare) {
        this.onboardingService = onboardingService;
        this.hireDetails = hireDetails;
        this.overview = overview;
        this.assetCare = assetCare;
    }


    /**
     * The asset records as before, plus (redesign BW-69, BW-70) who has each
     * one and who had it last (only for callers who may read employee records),
     * the holder's confirmation and any open problem report.
     */
    @GetMapping("/assets")
    @Operation(summary = "List onboarding and employee assets")
    @PreAuthorize("hasAnyAuthority('hrms.onboarding.asset.read','hrms.onboarding.instance.write')")
    public List<OnboardingViews.AssetView> listAssets(@RequestParam(required = false) UUID companyId,
                                                      @AuthenticationPrincipal Jwt jwt) {
        return assetCare.listAssets(companyId, holds(jwt, "hrms.employee.read"));
    }

    @GetMapping("/assets/issues")
    @Operation(summary = "Problems employees reported with their assets (OPEN by default, RESOLVED or ALL)")
    @PreAuthorize("hasAuthority('hrms.onboarding.asset.write')")
    public List<AssetCareService.Issue> assetIssues(@RequestParam(required = false) String status,
                                                    @RequestParam(required = false) UUID companyId,
                                                    @AuthenticationPrincipal Jwt jwt) {
        return assetCare.issues(status, companyId, holds(jwt, "hrms.employee.read"));
    }

    @PostMapping("/assets/issues/{issueId}/resolve")
    @Operation(summary = "Mark a reported asset problem as resolved")
    @PreAuthorize("hasAuthority('hrms.onboarding.asset.write')")
    public AssetCareService.Issue resolveAssetIssue(@PathVariable UUID issueId,
                                                    @RequestBody(required = false) ResolveIssueRequest req,
                                                    @AuthenticationPrincipal Jwt jwt) {
        String email = jwt == null ? null : jwt.getClaimAsString("email");
        return assetCare.resolve(issueId, req == null ? null : req.note(),
                assetCare.actorName(employeeIdOrNull(jwt), email), holds(jwt, "hrms.employee.read"));
    }

    @PostMapping("/assets")
    @Operation(summary = "Create an asset record")
    @PreAuthorize("hasAnyAuthority('hrms.onboarding.asset.write','hrms.onboarding.instance.write')")
    public ResponseEntity<OnboardingAsset> createAsset(@Valid @RequestBody OnboardingAsset asset) {
        return ResponseEntity.status(HttpStatus.CREATED).body(onboardingService.createAsset(asset));
    }

    @GetMapping("/assets/{assetId}/history")
    @PreAuthorize("hasAnyAuthority('hrms.onboarding.asset.read','hrms.onboarding.instance.write')")
    public List<java.util.Map<String,Object>> assetHistory(@PathVariable UUID assetId) {
        return onboardingService.assetHistory(assetId);
    }

    @PostMapping("/assets/{assetId}/assign")
    @Operation(summary = "Assign an asset to an employee/onboarding run")
    @PreAuthorize("hasAnyAuthority('hrms.onboarding.asset.write','hrms.onboarding.instance.write')")
    public OnboardingAsset assignAsset(@PathVariable UUID assetId, @Valid @RequestBody AssignAssetRequest req) {
        return onboardingService.assignAsset(assetId, req.employeeId(), req.onboardingInstanceId(), req.assignedAt());
    }

    @PostMapping("/assets/{assetId}/return")
    @Operation(summary = "Mark an asset as returned")
    @PreAuthorize("hasAnyAuthority('hrms.onboarding.asset.write','hrms.onboarding.instance.write')")
    public OnboardingAsset returnAsset(@PathVariable UUID assetId, @RequestBody(required = false) ReturnAssetRequest req) {
        return onboardingService.returnAsset(assetId, req == null ? null : req.notes());
    }

    // ── Templates ─────────────────────────────────────────────────────────

    @GetMapping("/templates")
    @Operation(summary = "List active onboarding templates (optionally filtered by company)")
    @PreAuthorize("@perm.check('hrms.onboarding.template.read')")
    public List<OnboardingViews.TemplateView> listTemplates(@RequestParam(required = false) UUID companyId) {
        // The templates as before, plus usedBy: onboardings started from each (redesign BW-69).
        List<OnboardingTemplate> templates = onboardingService.listTemplates(companyId);
        java.util.Map<UUID, Long> usage = templates.isEmpty() ? java.util.Map.of() : overview.usageByTemplate();
        return templates.stream()
                .map(t -> new OnboardingViews.TemplateView(t, usage.getOrDefault(t.getId(), 0L)))
                .toList();
    }

    @GetMapping("/templates/{id}")
    @Operation(summary = "Get onboarding template by ID")
    @PreAuthorize("@perm.check('hrms.onboarding.template.read')")
    public OnboardingTemplate getTemplate(@PathVariable UUID id) {
        return onboardingService.getTemplate(id);
    }

    @PostMapping("/templates")
    @Operation(summary = "Create a new onboarding template")
    @PreAuthorize("@perm.check('hrms.onboarding.template.write')")
    public ResponseEntity<OnboardingTemplate> createTemplate(@Valid @RequestBody OnboardingTemplate template) {
        return ResponseEntity.status(HttpStatus.CREATED).body(onboardingService.createTemplate(template));
    }

    @PutMapping("/templates/{id}")
    @Operation(summary = "Update an onboarding template")
    @PreAuthorize("@perm.check('hrms.onboarding.template.write')")
    public OnboardingTemplate updateTemplate(@PathVariable UUID id,
                                             @Valid @RequestBody OnboardingTemplate template) {
        return onboardingService.updateTemplate(id, template);
    }

    @DeleteMapping("/templates/{id}")
    @Operation(summary = "Archive (soft-delete) an onboarding template")
    @PreAuthorize("@perm.check('hrms.onboarding.template.write')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void archiveTemplate(@PathVariable UUID id) {
        onboardingService.archiveTemplate(id);
    }

    @PostMapping("/templates/{templateId}/tasks")
    @Operation(summary = "Add a task to an onboarding template")
    @PreAuthorize("@perm.check('hrms.onboarding.template.write')")
    public ResponseEntity<OnboardingTask> addTask(@PathVariable UUID templateId,
                                                   @Valid @RequestBody OnboardingTask task) {
        return ResponseEntity.status(HttpStatus.CREATED).body(onboardingService.addTask(templateId, task));
    }

    @DeleteMapping("/templates/{templateId}/tasks/{taskId}")
    @Operation(summary = "Remove a task from an onboarding template")
    @PreAuthorize("@perm.check('hrms.onboarding.template.write')")
    public ResponseEntity<Void> removeTask(@PathVariable UUID templateId, @PathVariable UUID taskId) {
        onboardingService.removeTask(templateId, taskId);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/templates/{templateId}/tasks/order")
    @Operation(summary = "Put a template's tasks in a new order (every task exactly once); onboardings already started keep theirs")
    @PreAuthorize("hasAuthority('hrms.onboarding.template.write')")
    public OnboardingTemplate reorderTasks(@PathVariable UUID templateId, @Valid @RequestBody ReorderTasksRequest req) {
        return onboardingService.reorderTasks(templateId, req.taskIds());
    }

    @GetMapping("/owner-roles")
    @Operation(summary = "The workspace's roles a checklist task can be owned by")
    @PreAuthorize("hasAnyAuthority('hrms.onboarding.template.read','hrms.onboarding.template.write')")
    public List<java.util.Map<String, Object>> ownerRoles() {
        return onboardingService.ownerRoles();
    }

    // ── Instances ─────────────────────────────────────────────────────────

    // 2026-09-08 audit: horizontal privilege escalation. V038 seeds the base
    // EMPLOYEE role with instance.read + task.complete (so a new hire can follow
    // their OWN checklist), but every instance endpoint was tenant-scoped only.
    // Any employee could list every colleague's onboarding, open their checklist,
    // and mark their tasks complete. HR/admin — identified by instance.write —
    // keep the tenant-wide view; everyone else is scoped to their own employee id.

    @GetMapping("/instances")
    @Operation(summary = "List onboarding instances (tenant-wide for HR/admin, own-only otherwise)")
    @PreAuthorize("@perm.check('hrms.onboarding.instance.read')")
    public List<OnboardingInstance> listInstances(@RequestParam(required = false) String status,
                                                  @AuthenticationPrincipal Jwt jwt) {
        if (isHrOrAdmin(jwt)) return onboardingService.listInstances(status);
        return onboardingService.listInstancesForEmployee(extractEmployeeId(jwt), status);
    }

    /**
     * The New hires page in one call (redesign BW-69): each onboarding with the
     * new hire's name, department, joining date, checklist name and task
     * counts, and the page's counts. Same scope as the list: everyone's for
     * people who manage onboarding, otherwise the caller's own.
     */
    @GetMapping("/instances/overview")
    @Operation(summary = "New hires: each onboarding with name, department, joining date, checklist and task counts, plus the counts")
    @PreAuthorize("@perm.check('hrms.onboarding.instance.read')")
    public OnboardingOverviewService.Overview instancesOverview(@RequestParam(required = false) String status,
                                                               @RequestParam(required = false) UUID companyId,
                                                               @AuthenticationPrincipal Jwt jwt) {
        java.time.LocalDate today = java.time.LocalDate.now(OnboardingOverviewService.IST);
        if (isHrOrAdmin(jwt)) return overview.overview(null, status, companyId, today);
        UUID mine = employeeIdOrNull(jwt);
        if (mine == null) {
            return new OnboardingOverviewService.Overview(OnboardingOverviewService.count(List.of(), today), List.of());
        }
        return overview.overview(mine, status, companyId, today);
    }

    @GetMapping("/instances/{instanceId}")
    @Operation(summary = "Get one onboarding instance by id")
    @PreAuthorize("@perm.check('hrms.onboarding.instance.read')")
    public OnboardingInstance getInstance(@PathVariable UUID instanceId,
                                          @AuthenticationPrincipal Jwt jwt) {
        OnboardingInstance instance = onboardingService.getInstance(instanceId);
        assertCanView(instance, jwt);
        return instance;
    }

    @PostMapping("/instances")
    @Operation(summary = "Manually create an onboarding instance for an employee")
    @PreAuthorize("@perm.check('hrms.onboarding.instance.write')")
    public ResponseEntity<OnboardingInstance> createInstance(@Valid @RequestBody CreateInstanceRequest req) {
        OnboardingInstance instance = onboardingService.createInstanceForEmployee(
                req.employeeId(), req.templateId(), req.joiningDate());
        return ResponseEntity.status(HttpStatus.CREATED).body(instance);
    }

    @PatchMapping("/instances/{instanceId}/status")
    @Operation(summary = "Put an onboarding run on hold, resume it, or close it out")
    @PreAuthorize("@perm.check('hrms.onboarding.instance.write')")
    public OnboardingInstance setInstanceStatus(@PathVariable UUID instanceId,
                                                @Valid @RequestBody UpdateInstanceStatusRequest req) {
        // instance.write only — an employee who can tick off their own tasks
        // must not be able to park their own onboarding.
        return onboardingService.setInstanceStatus(instanceId, req.status());
    }

    @GetMapping("/instances/employee/{employeeId}")
    @Operation(summary = "Get the latest onboarding instance for an employee (any status)")
    @PreAuthorize("@perm.check('hrms.onboarding.instance.read')")
    public OnboardingInstance getInstanceForEmployee(@PathVariable UUID employeeId,
                                                     @AuthenticationPrincipal Jwt jwt) {
        if (!isHrOrAdmin(jwt) && !employeeId.equals(extractEmployeeId(jwt))) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "You can only view your own onboarding checklist.");
        }
        // Was IN_PROGRESS-only; a finished run then read as "no onboarding".
        return onboardingService.getLatestInstanceForEmployee(employeeId);
    }

    @GetMapping("/instances/{instanceId}/hire-details")
    @Operation(summary = "Offer accepted date, hiring manager, recruiter, source and buddy of an onboarding")
    @PreAuthorize("hasAuthority('hrms.onboarding.instance.read')")
    public OnboardingHireDetailsService.HireDetails getHireDetails(@PathVariable UUID instanceId,
                                                                  @AuthenticationPrincipal Jwt jwt) {
        if (!isHrOrAdmin(jwt) && !hireDetails.employeeOf(instanceId).equals(extractEmployeeId(jwt))) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "You can only view your own onboarding.");
        }
        return hireDetails.get(instanceId);
    }

    @PutMapping("/instances/{instanceId}/hire-details")
    @Operation(summary = "Change the hire details of an onboarding")
    @PreAuthorize("hasAuthority('hrms.onboarding.instance.write')")
    public OnboardingHireDetailsService.HireDetails updateHireDetails(@PathVariable UUID instanceId,
                                                                     @RequestBody OnboardingHireDetailsService.UpdateRequest req) {
        return hireDetails.update(instanceId, req);
    }

    @GetMapping("/instances/{instanceId}/tasks")
    @Operation(summary = "List tasks for an onboarding instance")
    @PreAuthorize("@perm.check('hrms.onboarding.instance.read')")
    public List<OnboardingInstanceTask> getInstanceTasks(@PathVariable UUID instanceId,
                                                         @AuthenticationPrincipal Jwt jwt) {
        if (!isHrOrAdmin(jwt)) {
            assertCanView(onboardingService.getInstance(instanceId), jwt);
        }
        return onboardingService.getTasksForInstance(instanceId);
    }

    @PostMapping("/instance-tasks/{taskId}/complete")
    @Operation(summary = "Mark an onboarding task as complete")
    @PreAuthorize("@perm.check('hrms.onboarding.task.complete')")
    public OnboardingInstanceTask completeTask(@PathVariable UUID taskId,
                                               @RequestBody CompleteTaskRequest req,
                                               @AuthenticationPrincipal Jwt jwt) {
        if (!isHrOrAdmin(jwt)) {
            onboardingService.assertTaskBelongsToEmployee(taskId, extractEmployeeId(jwt));
        }
        UUID actorId = UUID.fromString(jwt.getSubject());
        return onboardingService.completeTask(taskId, actorId, req.notes());
    }

    @PostMapping("/instance-tasks/{taskId}/skip")
    @Operation(summary = "Skip a non-required onboarding task")
    @PreAuthorize("@perm.check('hrms.onboarding.task.complete')")
    public OnboardingInstanceTask skipTask(@PathVariable UUID taskId,
                                           @RequestBody CompleteTaskRequest req,
                                           @AuthenticationPrincipal Jwt jwt) {
        if (!isHrOrAdmin(jwt)) {
            onboardingService.assertTaskBelongsToEmployee(taskId, extractEmployeeId(jwt));
        }
        UUID actorId = UUID.fromString(jwt.getSubject());
        return onboardingService.skipTask(taskId, actorId, req.notes());
    }

    // ── Scoping helpers ───────────────────────────────────────────────────

    /** HR/admin tier = anyone who can CREATE instances. Same marker the leave
     *  and expense controllers use for "sees the whole tenant". */
    private static boolean isHrOrAdmin(Jwt jwt) {
        List<String> perms = jwt.getClaimAsStringList("permissions");
        return perms != null && perms.contains("hrms.onboarding.instance.write");
    }

    /** True when the token carries {@code permission} (what hasAuthority checks). */
    static boolean holds(Jwt jwt, String permission) {
        if (jwt == null) return false;
        List<String> perms = jwt.getClaimAsStringList("permissions");
        return perms != null && perms.contains(permission);
    }

    /** The caller's employee record, or null for an account without one. */
    private static UUID employeeIdOrNull(Jwt jwt) {
        String empId = jwt == null ? null : jwt.getClaimAsString("employee_id");
        if (empId == null || empId.isBlank()) return null;
        try {
            return UUID.fromString(empId);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }

    private static void assertCanView(OnboardingInstance instance, Jwt jwt) {
        if (isHrOrAdmin(jwt)) return;
        UUID mine = extractEmployeeId(jwt);
        if (instance == null || instance.getEmployeeId() == null || !instance.getEmployeeId().equals(mine)) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "You can only view your own onboarding checklist.");
        }
    }

    // ── Request records ───────────────────────────────────────────────────

    public record AssignAssetRequest(@NotNull UUID employeeId, UUID onboardingInstanceId, LocalDate assignedAt) {}

    public record ReturnAssetRequest(String notes) {}

    public record ResolveIssueRequest(String note) {}

    public record CreateInstanceRequest(
            @NotNull UUID employeeId,
            @NotNull UUID templateId,
            LocalDate joiningDate) {}

    public record CompleteTaskRequest(String notes) {}

    public record UpdateInstanceStatusRequest(@NotBlank String status) {}

    public record ReorderTasksRequest(@NotNull List<UUID> taskIds) {}
}
