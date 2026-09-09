package com.hrms.employee.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.OnboardingInstance;
import com.hrms.employee.entity.OnboardingInstanceTask;
import com.hrms.employee.entity.OnboardingTask;
import com.hrms.employee.entity.OnboardingTemplate;
import com.hrms.employee.repository.OnboardingInstanceRepository;
import com.hrms.employee.repository.OnboardingInstanceTaskRepository;
import com.hrms.employee.repository.OnboardingTaskRepository;
import com.hrms.employee.repository.OnboardingTemplateRepository;
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
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    public OnboardingService(
            OnboardingTemplateRepository templateRepo,
            OnboardingTaskRepository taskRepo,
            OnboardingInstanceRepository instanceRepo,
            OnboardingInstanceTaskRepository instanceTaskRepo,
            org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.templateRepo = templateRepo;
        this.taskRepo = taskRepo;
        this.instanceRepo = instanceRepo;
        this.instanceTaskRepo = instanceTaskRepo;
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
                instance.setStatus("COMPLETED");
                instance.setCompletedAt(Instant.now());
                instanceRepo.save(instance);
                log.info("Onboarding instance {} completed", instanceId);
            });
        }
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
