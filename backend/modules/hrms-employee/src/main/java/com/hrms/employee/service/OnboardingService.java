package com.hrms.employee.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.OnboardingInstance;
import com.hrms.employee.entity.OnboardingInstanceTask;
import com.hrms.employee.entity.OnboardingTask;
import com.hrms.employee.entity.OnboardingTemplate;
import com.hrms.employee.entity.OnboardingAsset;
import com.hrms.employee.repository.OnboardingInstanceRepository;
import com.hrms.employee.repository.OnboardingInstanceTaskRepository;
import com.hrms.employee.repository.OnboardingTaskRepository;
import com.hrms.employee.repository.OnboardingTemplateRepository;
import com.hrms.employee.repository.OnboardingAssetRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Service
public class OnboardingService {

    private static final Logger log = LoggerFactory.getLogger(OnboardingService.class);

    private final OnboardingTemplateRepository templateRepo;
    private final OnboardingTaskRepository taskRepo;
    private final OnboardingInstanceRepository instanceRepo;
    private final OnboardingInstanceTaskRepository instanceTaskRepo;
    private final OnboardingAssetRepository assetRepository;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    public OnboardingService(
            OnboardingTemplateRepository templateRepo,
            OnboardingTaskRepository taskRepo,
            OnboardingInstanceRepository instanceRepo,
            OnboardingInstanceTaskRepository instanceTaskRepo,
            OnboardingAssetRepository assetRepository,
            org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.templateRepo = templateRepo;
        this.taskRepo = taskRepo;
        this.instanceRepo = instanceRepo;
        this.instanceTaskRepo = instanceTaskRepo;
        this.assetRepository = assetRepository;
        this.jdbc = jdbc;
    }

    /**
     * The employee's recorded date of joining, or null when there is no row or
     * no date on file. RLS scopes the read to the current tenant, so this
     * cannot reach across workspaces. Never throws: a missing DOJ simply means
     * the onboarding tasks get no due dates, which is the pre-existing
     * behaviour rather than a reason to fail the whole run.
     */
    private LocalDate lookupDateOfJoining(UUID employeeId) {
        if (employeeId == null) return null;
        try {
            return jdbc.query(
                    "SELECT date_of_joining FROM hrms.employees WHERE id = ?",
                    rs -> rs.next() ? rs.getObject(1, LocalDate.class) : null,
                    employeeId);
        } catch (RuntimeException e) {
            log.warn("Could not read date_of_joining for employee {}: {}", employeeId, e.getMessage());
            return null;
        }
    }

    // ── Template management ───────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<OnboardingAsset> listAssets(UUID companyId) {
        return companyId == null ? assetRepository.findAllByOrderByCreatedAtDesc()
                : assetRepository.findByCompanyIdOrderByCreatedAtDesc(companyId);
    }

    @Transactional
    public OnboardingAsset createAsset(OnboardingAsset asset) {
        if (asset.getCompanyId() == null || asset.getAssetTag() == null || asset.getAssetTag().isBlank()
                || asset.getAssetName() == null || asset.getAssetName().isBlank()
                || asset.getAssetType() == null || asset.getAssetType().isBlank()) {
            throw new BusinessRuleException("Company, tag, name and category are required", "ASSET_FIELDS_REQUIRED");
        }
        // Copy writable fields into a new entity. Clients cannot overwrite IDs,
        // audit fields, tenant, assignment or lifecycle state through creation.
        Integer companyMatches = jdbc.queryForObject("SELECT count(*) FROM org.companies WHERE id = ? AND tenant_id = ?",
                Integer.class, asset.getCompanyId(), TenantContext.getTenantId());
        if (companyMatches == null || companyMatches == 0) throw new BusinessRuleException("Company not found in this workspace", "ASSET_COMPANY_INVALID");
        if (asset.getAssetTag().length() > 80 || asset.getAssetType().length() > 80 || asset.getAssetName().length() > 200
                || (asset.getSerialNo() != null && asset.getSerialNo().length() > 120)) {
            throw new BusinessRuleException("Asset fields exceed the allowed length", "ASSET_FIELDS_TOO_LONG");
        }
        OnboardingAsset created = new OnboardingAsset();
        created.setTenantId(TenantContext.getTenantId());
        created.setCompanyId(asset.getCompanyId());
        created.setAssetTag(asset.getAssetTag().trim());
        created.setAssetName(asset.getAssetName().trim());
        created.setAssetType(asset.getAssetType().trim());
        created.setSerialNo(asset.getSerialNo());
        created.setConditionNotes(asset.getConditionNotes());
        created.setStatus("AVAILABLE");
        return assetRepository.save(created);
    }

    @Transactional
    public OnboardingAsset assignAsset(UUID assetId, UUID employeeId, UUID onboardingInstanceId, LocalDate assignedAt) {
        OnboardingAsset asset = assetRepository.findById(assetId)
                .orElseThrow(() -> new IllegalArgumentException("Asset not found: " + assetId));
        if ("ASSIGNED".equals(asset.getStatus())) {
            throw new BusinessRuleException("Record the current employee's return before reassigning this asset", "ASSET_ALREADY_ASSIGNED");
        }
        Integer matches = jdbc.queryForObject("SELECT count(*) FROM hrms.employees WHERE id = ? AND company_id = ? AND tenant_id = ?",
                Integer.class, employeeId, asset.getCompanyId(), TenantContext.getTenantId());
        if (matches == null || matches == 0) throw new BusinessRuleException("Choose an employee in this asset's company", "ASSET_EMPLOYEE_INVALID");
        if (assignedAt != null && assignedAt.isAfter(LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")))) throw new BusinessRuleException("Assignment date cannot be in the future", "ASSET_DATE_INVALID");
        if (onboardingInstanceId != null) {
            OnboardingInstance instance = instanceRepo.findById(onboardingInstanceId)
                    .orElseThrow(() -> new ResourceNotFoundException("OnboardingInstance", onboardingInstanceId));
            if (!employeeId.equals(instance.getEmployeeId())) throw new BusinessRuleException("Onboarding instance belongs to another employee", "ASSET_INSTANCE_INVALID");
        }
        asset.setEmployeeId(employeeId);
        asset.setOnboardingInstanceId(onboardingInstanceId);
        asset.setAssignedAt(assignedAt == null ? LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")) : assignedAt);
        asset.setReturnedAt(null);
        asset.setStatus("ASSIGNED");
        jdbc.update("INSERT INTO hrms.asset_allocations(tenant_id,asset_id,employee_id,assigned_at) VALUES(?,?,?,?)",
                TenantContext.getTenantId(), assetId, employeeId, asset.getAssignedAt());
        return assetRepository.save(asset);
    }

    @Transactional
    public OnboardingAsset returnAsset(UUID assetId, String notes) {
        OnboardingAsset asset = assetRepository.findById(assetId)
                .orElseThrow(() -> new IllegalArgumentException("Asset not found: " + assetId));
        if (!"ASSIGNED".equals(asset.getStatus())) throw new BusinessRuleException("Only assigned assets can be returned", "ASSET_NOT_ASSIGNED");
        asset.setStatus("RETURNED");
        asset.setReturnedAt(LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")));
        asset.setConditionNotes(notes);
        jdbc.update("UPDATE hrms.asset_allocations SET returned_at=?,return_notes=? WHERE tenant_id=? AND asset_id=? AND returned_at IS NULL",
                asset.getReturnedAt(), notes, TenantContext.getTenantId(), assetId);
        return assetRepository.save(asset);
    }

    @Transactional(readOnly = true)
    public List<java.util.Map<String,Object>> assetHistory(UUID assetId) {
        // An unknown asset is a 404, not an empty history that looks like "never assigned".
        if (!assetRepository.existsById(assetId)) throw new ResourceNotFoundException("OnboardingAsset", assetId);
        return jdbc.queryForList("""
                SELECT a.id,a.employee_id AS "employeeId",concat_ws(' ',e.first_name,e.last_name) AS "employeeName",
                  a.assigned_at AS "assignedAt",a.returned_at AS "returnedAt",a.return_notes AS notes
                FROM hrms.asset_allocations a JOIN hrms.employees e ON e.id=a.employee_id AND e.tenant_id=a.tenant_id
                WHERE a.tenant_id=? AND a.asset_id=? ORDER BY a.created_at DESC,a.id
                """,TenantContext.getTenantId(),assetId);
    }

    @Transactional(readOnly = true)
    public List<OnboardingTemplate> listTemplates(UUID companyId) {
        // companyId is optional: when omitted, return every active template for the
        // current tenant (RLS already scopes the query to this tenant).
        List<OnboardingTemplate> templates = companyId != null
                ? templateRepo.findByCompanyIdAndActiveTrueOrderByNameAsc(companyId)
                : templateRepo.findByActiveTrueOrderByNameAsc();
        // Initialise the lazy tasks collection inside the transaction so the
        // controller can serialize it — open-in-view is disabled in the canonical
        // profiles, so a lazy proxy would otherwise fail at JSON serialization.
        templates.forEach(t -> t.getTasks().size());
        return templates;
    }

    @Transactional(readOnly = true)
    public OnboardingTemplate getTemplate(UUID id) {
        OnboardingTemplate template = templateRepo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("OnboardingTemplate", id));
        // Init lazy tasks inside the tx — open-in-view is disabled in the canonical
        // profiles. Also covers updateTemplate(), which loads via this method.
        template.getTasks().size();
        return template;
    }

    @Transactional
    public OnboardingTemplate createTemplate(OnboardingTemplate template) {
        template.setTenantId(TenantContext.getTenantId());
        return templateRepo.save(template);
    }

    @Transactional
    public OnboardingTemplate updateTemplate(UUID id, OnboardingTemplate update) {
        OnboardingTemplate existing = getTemplate(id);
        existing.setName(update.getName());
        existing.setDescription(update.getDescription());
        existing.setDesignationId(update.getDesignationId());
        existing.setDepartmentId(update.getDepartmentId());
        existing.setActive(update.isActive());
        return templateRepo.save(existing);
    }

    @Transactional
    public void archiveTemplate(UUID id) {
        // Soft-delete: templates are referenced by historical instances, so we
        // deactivate rather than hard-delete to preserve those references.
        OnboardingTemplate existing = templateRepo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("OnboardingTemplate", id));
        existing.setActive(false);
        templateRepo.save(existing);
        log.info("Archived onboarding template {}", id);
    }

    @Transactional
    public OnboardingTask addTask(UUID templateId, OnboardingTask task) {
        OnboardingTemplate template = getTemplate(templateId);
        task.setTenantId(template.getTenantId());
        task.setTemplateId(templateId);
        return taskRepo.save(task);
    }

    @Transactional
    public void removeTask(UUID taskId) {
        taskRepo.deleteById(taskId);
    }

    // ── Instance lifecycle (called on hire) ───────────────────────────────

    @Transactional
    public OnboardingInstance createInstanceForEmployee(UUID employeeId, UUID templateId, LocalDate joiningDate) {
        OnboardingTemplate template = getTemplate(templateId);

        // 2026-09-09: when the caller omits joiningDate, fall back to the
        // employee's recorded date of joining rather than leaving every task
        // without a due date. Task due dates are the whole point of the
        // dueOffsetDays column on the template, and HR should not have to
        // retype a date already stored on the employee record. Still null
        // (no DOJ on file) leaves due dates unset, exactly as before.
        if (joiningDate == null) {
            joiningDate = lookupDateOfJoining(employeeId);
        }

        OnboardingInstance instance = new OnboardingInstance();
        instance.setTenantId(TenantContext.getTenantId());
        instance.setEmployeeId(employeeId);
        instance.setTemplateId(templateId);
        instance.setStatus("IN_PROGRESS");
        instance.setStartedAt(Instant.now());
        instanceRepo.save(instance);

        List<OnboardingTask> tasks = taskRepo.findByTemplateIdOrderBySequenceNoAsc(templateId);
        for (OnboardingTask task : tasks) {
            OnboardingInstanceTask it = new OnboardingInstanceTask();
            it.setTenantId(instance.getTenantId());
            it.setInstanceId(instance.getId());
            it.setTaskId(task.getId());
            it.setSequenceNo(task.getSequenceNo());
            it.setTitle(task.getTitle());
            it.setOwnerRole(task.getOwnerRole());
            it.setRequired(task.isRequired());
            it.setStatus("PENDING");
            if (joiningDate != null) {
                it.setDueDate(joiningDate.plusDays(task.getDueOffsetDays()));
            }
            instanceTaskRepo.save(it);
        }

        log.info("Created onboarding instance {} for employee {} with {} tasks",
                instance.getId(), employeeId, tasks.size());
        // Init lazy instanceTasks so the controller can serialize the returned
        // entity (open-in-view disabled in the canonical profiles).
        instance.getInstanceTasks().size();
        return instance;
    }

    // ── Task completion ───────────────────────────────────────────────────

    @Transactional
    public OnboardingInstanceTask completeTask(UUID instanceTaskId, UUID completedBy, String notes) {
        OnboardingInstanceTask task = instanceTaskRepo.findById(instanceTaskId)
                .orElseThrow(() -> new ResourceNotFoundException("OnboardingInstanceTask", instanceTaskId));

        if ("COMPLETED".equals(task.getStatus())) {
            throw new BusinessRuleException("Task already completed");
        }

        task.setStatus("COMPLETED");
        task.setCompletedBy(completedBy);
        task.setCompletedAt(Instant.now());
        task.setNotes(notes);
        instanceTaskRepo.save(task);

        checkAndCompleteInstance(task.getInstanceId());
        return task;
    }

    @Transactional
    public OnboardingInstanceTask skipTask(UUID instanceTaskId, UUID actorId, String reason) {
        OnboardingInstanceTask task = instanceTaskRepo.findById(instanceTaskId)
                .orElseThrow(() -> new ResourceNotFoundException("OnboardingInstanceTask", instanceTaskId));

        if (task.isRequired()) {
            throw new BusinessRuleException("Required tasks cannot be skipped");
        }

        task.setStatus("SKIPPED");
        task.setCompletedBy(actorId);
        task.setCompletedAt(Instant.now());
        task.setNotes(reason);
        OnboardingInstanceTask saved = instanceTaskRepo.save(task);
        // Skipping the last outstanding task must complete the instance too —
        // completeTask() does this; without it the instance is stuck IN_PROGRESS.
        checkAndCompleteInstance(task.getInstanceId());
        return saved;
    }

    private void checkAndCompleteInstance(UUID instanceId) {
        long pending = instanceTaskRepo.countPendingByInstanceId(instanceId);
        if (pending == 0) {
            instanceRepo.findById(instanceId).ifPresent(instance -> {
                // An ON_HOLD run stays on hold even when its last task is
                // ticked off: HR paused it deliberately, and flipping it to
                // COMPLETED here would silently discard that decision.
                if (!"IN_PROGRESS".equals(instance.getStatus())) return;
                instance.setStatus("COMPLETED");
                instance.setCompletedAt(Instant.now());
                instanceRepo.save(instance);
                log.info("Onboarding instance {} completed", instanceId);
            });
        }
    }

    /** The states an instance may hold. IN_PROGRESS and COMPLETED are driven by
     *  task progress; ON_HOLD is HR pausing a run by hand (a start date that
     *  slipped, paperwork stuck at the candidate's end) and can only be set
     *  through {@link #setInstanceStatus}. Stored as a plain VARCHAR(20) with
     *  no CHECK constraint, so this set is the only thing keeping the column
     *  honest — validate before writing. */
    private static final java.util.Set<String> INSTANCE_STATUSES =
            java.util.Set.of("IN_PROGRESS", "ON_HOLD", "COMPLETED");

    @Transactional
    public OnboardingInstance setInstanceStatus(UUID instanceId, String status) {
        if (status == null || !INSTANCE_STATUSES.contains(status)) {
            throw new BusinessRuleException(
                    "Unknown onboarding status '" + status + "'. Expected one of " + INSTANCE_STATUSES);
        }
        OnboardingInstance instance = instanceRepo.findById(instanceId)
                .orElseThrow(() -> new ResourceNotFoundException("OnboardingInstance", instanceId));

        String previous = instance.getStatus();
        instance.setStatus(status);
        // completed_at has to track the status, not just accumulate: reopening a
        // finished run must clear it, or the dashboard shows a completion date
        // for something still in progress.
        instance.setCompletedAt("COMPLETED".equals(status) ? Instant.now() : null);
        instanceRepo.save(instance);
        // Init lazy tasks inside the tx so the controller can serialize the
        // returned entity (open-in-view is disabled in the canonical profiles).
        instance.getInstanceTasks().size();
        log.info("Onboarding instance {} status {} -> {}", instanceId, previous, status);
        return instance;
    }

    // ── Queries ───────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<OnboardingInstance> listInstances(String status) {
        // status is optional: when omitted, return every instance for the current
        // tenant (RLS already scopes the query to this tenant).
        List<OnboardingInstance> instances = status != null
                ? instanceRepo.findByStatusOrderByCreatedAtDesc(status)
                : instanceRepo.findAllByOrderByCreatedAtDesc();
        // Init the lazy instanceTasks collection inside the tx so the controller can
        // serialize it (open-in-view is disabled in the canonical profiles); the FE
        // uses it to compute completion progress.
        instances.forEach(i -> i.getInstanceTasks().size());
        return instances;
    }

    @Transactional(readOnly = true)
    public OnboardingInstance getInstanceForEmployee(UUID employeeId) {
        OnboardingInstance instance = instanceRepo.findByEmployeeIdAndStatus(employeeId, "IN_PROGRESS")
                .orElse(null);
        // Init lazy instanceTasks inside the tx (open-in-view disabled in prod).
        if (instance != null) {
            instance.getInstanceTasks().size();
        }
        return instance;
    }

    @Transactional(readOnly = true)
    public List<OnboardingInstanceTask> getTasksForInstance(UUID instanceId) {
        return instanceTaskRepo.findByInstanceIdOrderBySequenceNoAsc(instanceId);
    }

    // ── 2026-09-08 audit additions ────────────────────────────────────────

    /** Fetch by instance id. The Instances list used to navigate by employeeId
     *  into getInstanceForEmployee(), which only matched IN_PROGRESS — so every
     *  COMPLETED row (the whole "Completed" filter) dead-ended on an empty page. */
    @Transactional(readOnly = true)
    public OnboardingInstance getInstance(UUID instanceId) {
        OnboardingInstance instance = instanceRepo.findById(instanceId)
                .orElseThrow(() -> new ResourceNotFoundException("OnboardingInstance", instanceId));
        instance.getInstanceTasks().size();
        return instance;
    }

    /** Latest instance for an employee regardless of status (employee-keyed deep links). */
    @Transactional(readOnly = true)
    public OnboardingInstance getLatestInstanceForEmployee(UUID employeeId) {
        OnboardingInstance instance = instanceRepo.findFirstByEmployeeIdOrderByCreatedAtDesc(employeeId)
                .orElse(null);
        if (instance != null) {
            instance.getInstanceTasks().size();
        }
        return instance;
    }

    /** Self-scoped list for non-HR callers (the EMPLOYEE role is seeded
     *  instance.read + task.complete so a new hire can follow their OWN checklist —
     *  it was never meant to expose every colleague's). */
    @Transactional(readOnly = true)
    public List<OnboardingInstance> listInstancesForEmployee(UUID employeeId, String status) {
        List<OnboardingInstance> all = instanceRepo.findByEmployeeId(employeeId);
        List<OnboardingInstance> out = status == null
                ? all
                : all.stream().filter(i -> status.equals(i.getStatus())).toList();
        out.forEach(i -> i.getInstanceTasks().size());
        return out;
    }

    /**
     * Ownership guard for complete/skip. completeTask()/skipTask() resolve the
     * task by id only, so before this any employee who reached
     * /hrms/onboarding/instances/&lt;colleague&gt; could tick off a colleague's
     * tasks — and flip that colleague's instance to COMPLETED. HR/admin
     * callers bypass this in the controller; everyone else must own the run.
     */
    @Transactional(readOnly = true)
    public void assertTaskBelongsToEmployee(UUID instanceTaskId, UUID employeeId) {
        OnboardingInstanceTask task = instanceTaskRepo.findById(instanceTaskId)
                .orElseThrow(() -> new ResourceNotFoundException("OnboardingInstanceTask", instanceTaskId));
        OnboardingInstance instance = instanceRepo.findById(task.getInstanceId())
                .orElseThrow(() -> new ResourceNotFoundException("OnboardingInstance", task.getInstanceId()));
        if (employeeId == null || !employeeId.equals(instance.getEmployeeId())) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "You can only complete tasks on your own onboarding checklist.");
        }
    }
}
