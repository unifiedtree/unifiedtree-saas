package com.hrms.api.ess;

import com.hrms.api.leave.ApproverFallbackResolver;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.unifiedtree.notifications.service.NotificationLookupService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Locale;
import java.util.UUID;

/**
 * Who a request of someone's goes to: the one place the approver chain lives
 * (BW-122).
 *
 * <p><b>Leave and work from home</b> ({@link #requestApprover}) run exactly the
 * chain {@code LeaveController.apply} and {@code WfhController.apply} run, step
 * for step, with the same refusals:
 * <ol>
 *   <li>the reporting manager;</li>
 *   <li>else the department head;</li>
 *   <li>else the terminal fallback ({@link ApproverFallbackResolver}: the longest-serving
 *       active HR manager, else super admin), refused with {@code NO_APPROVER_AVAILABLE}
 *       when there is none;</li>
 *   <li>a person picked above who is not an active employee of the same workspace is
 *       replaced by the terminal fallback ({@code APPROVER_INVALID} when that fails too);</li>
 *   <li>then any delegation the approver has on for today (IST).</li>
 * </ol>
 * Those two controllers keep their own copy, unchanged; {@code ApproverChainFixtureTest}
 * runs both controllers and this service over the same fixtures and checks every one
 * picks the same person. New code (the preview, the WFH batch) uses this service.
 *
 * <p><b>Fixes and shift changes</b> ({@link #notificationApprover}) are decided by
 * anyone with {@code attendance.regularization.approve} in scope, so "who it goes to"
 * is the person their notification goes to: {@code DomainEventListener}'s chain
 * (reporting manager, else department head; else the first active HR manager; else
 * the first super admin; never the person themself), through the same
 * {@link NotificationLookupService} lookups.
 */
@Service
public class ApproverChainService {

    /** What the request is. Matches the {@code for} values of {@code GET /v1/me/approvers}. */
    public enum Kind {
        LEAVE("leave"), WFH("wfh"), CORRECTION("correction"), SHIFT("shift");

        public final String key;

        Kind(String key) { this.key = key; }

        /** The kind for a {@code for} value, or null when it isn't one. */
        public static Kind of(String key) {
            if (key == null) return null;
            String k = key.trim().toLowerCase(Locale.ROOT);
            for (Kind kind : values()) if (kind.key.equals(k)) return kind;
            return null;
        }
    }

    /** How the approver was chosen, in the order the chain tries them. */
    public enum Source { MANAGER, DEPARTMENT_HEAD, HR, ADMIN, DELEGATE }

    /**
     * The approver the chain picked.
     *
     * @param approverId     the employee the request goes to
     * @param source         how they were chosen
     * @param delegateForId  when {@code source} is DELEGATE, the approver they stand in for; else null
     */
    public record Choice(UUID approverId, Source source, UUID delegateForId) {}

    /** Seeded system role (V004, tenant_id NULL); the same id ApproverFallbackResolver and DomainEventListener use. */
    static final UUID HR_MANAGER = UUID.fromString("00000000-0000-0000-0000-000000000002");
    static final UUID SUPER_ADMIN = UUID.fromString("00000000-0000-0000-0000-000000000001");

    private final EmployeeRepository employees;
    private final WorkforceDepartmentRepository departments;
    private final ApproverFallbackResolver fallback;
    private final NotificationLookupService lookup;
    private final JdbcTemplate jdbc;
    /** "Today" for delegations: the India business date, as the controllers use. Tests fix it. */
    Clock clock = Clock.system(ZoneId.of("Asia/Kolkata"));

    public ApproverChainService(EmployeeRepository employees, WorkforceDepartmentRepository departments,
                                ApproverFallbackResolver fallback, NotificationLookupService lookup,
                                JdbcTemplate jdbc) {
        this.employees = employees;
        this.departments = departments;
        this.fallback = fallback;
        this.lookup = lookup;
        this.jdbc = jdbc;
    }

    /**
     * The approver a leave or work-from-home request of {@code applicant} is sent
     * to, refused exactly as the apply endpoints refuse it.
     *
     * @throws BusinessRuleException {@code NO_APPROVER_AVAILABLE} or {@code APPROVER_INVALID}
     */
    public Choice requestApprover(Employee applicant, Kind kind) {
        if (kind != Kind.LEAVE && kind != Kind.WFH) {
            throw new IllegalArgumentException("requestApprover is for leave and work from home, not " + kind);
        }
        UUID approverId = applicant.getManagerId();
        Source source = approverId != null ? Source.MANAGER : null;
        if (approverId == null && applicant.getDepartmentId() != null) {
            approverId = departments.findById(applicant.getDepartmentId())
                    .map(Department::getDepartmentHeadEmployeeId)
                    .orElse(null);
            if (approverId != null) source = Source.DEPARTMENT_HEAD;
        }
        if (approverId == null) {
            approverId = fallback.resolveTerminalApprover(applicant.getTenantId())
                    .orElseThrow(() -> new BusinessRuleException(
                            "No approver available — assign this employee a reporting manager, set a "
                                    + "department head, or add an HR manager before applying for "
                                    + (kind == Kind.LEAVE ? "leave" : "WFH"),
                            "NO_APPROVER_AVAILABLE"));
            source = terminalSource(applicant.getTenantId(), approverId);
        }
        Employee resolved = employees.findById(approverId).orElse(null);
        if (!isValidApprover(resolved, applicant)) {
            approverId = fallback.resolveTerminalApprover(applicant.getTenantId())
                    .orElseThrow(() -> new BusinessRuleException(
                            "Resolved approver is not a valid active employee in this tenant; "
                                    + "assign a reporting manager or department head before applying.",
                            "APPROVER_INVALID"));
            resolved = employees.findById(approverId).orElse(null);
            if (!isValidApprover(resolved, applicant)) {
                throw new BusinessRuleException(
                        "No valid active approver could be resolved for this employee; "
                                + "please contact HR to set up the approval chain.",
                        "APPROVER_INVALID");
            }
            source = terminalSource(applicant.getTenantId(), approverId);
        }
        UUID picked = approverId;
        UUID delegate = fallback.redirectIfDelegated(picked, LocalDate.now(clock));
        if (delegate != null && !delegate.equals(picked)) {
            return new Choice(delegate, Source.DELEGATE, picked);
        }
        return new Choice(picked, source, null);
    }

    /**
     * The person a fix or shift change of {@code applicant} is announced to, or
     * null when the workspace has nobody to tell (the notification is then skipped).
     */
    public Choice notificationApprover(Employee applicant) {
        UUID self = applicant.getId();
        UUID tenant = applicant.getTenantId();
        if (self == null || tenant == null) return null;
        UUID direct = lookup.directApprover(self, tenant);
        if (direct != null && !direct.equals(self)) {
            return new Choice(direct, direct.equals(applicant.getManagerId()) ? Source.MANAGER : Source.DEPARTMENT_HEAD, null);
        }
        UUID hr = lookup.firstEmployeeWithRole(tenant, HR_MANAGER);
        if (hr != null && !hr.equals(self)) return new Choice(hr, Source.HR, null);
        UUID admin = lookup.firstEmployeeWithRole(tenant, SUPER_ADMIN);
        return admin != null && !admin.equals(self) ? new Choice(admin, Source.ADMIN, null) : null;
    }

    /**
     * Who a request of this kind would go to now, for the preview: the same
     * answers as above, with "nobody can be found" as null instead of a refusal.
     */
    public Choice preview(Employee applicant, Kind kind) {
        if (kind == Kind.CORRECTION || kind == Kind.SHIFT) return notificationApprover(applicant);
        try {
            return requestApprover(applicant, kind);
        } catch (BusinessRuleException noApprover) {
            return null;
        }
    }

    /**
     * The terminal fallback returns the first HR manager when the workspace has
     * one, else the first super admin; which of the two it was is read back from
     * the person's roles.
     */
    Source terminalSource(UUID tenantId, UUID employeeId) {
        Boolean hr = jdbc.queryForObject("""
                SELECT EXISTS (
                    SELECT 1 FROM rbac.user_roles ur
                      JOIN auth.user_credentials uc ON uc.id = ur.user_id
                     WHERE ur.tenant_id = ? AND ur.role_id = ?
                       AND uc.employee_id = ? AND uc.is_active = TRUE
                )
                """, Boolean.class, tenantId, HR_MANAGER, employeeId);
        return Boolean.TRUE.equals(hr) ? Source.HR : Source.ADMIN;
    }

    /** Same predicate as the two controllers' isValidApprover: same workspace, not in a terminal or inactive state. */
    static boolean isValidApprover(Employee approver, Employee applicant) {
        if (approver == null || applicant == null) return false;
        if (approver.getTenantId() == null || !approver.getTenantId().equals(applicant.getTenantId())) {
            return false;
        }
        EmploymentStatus status = approver.getEmploymentStatus();
        if (status == null) return true; // legacy rows: assume active
        return switch (status) {
            case EXITED, TERMINATED, RESIGNED, RETIRED, SUSPENDED -> false;
            default -> true;
        };
    }
}
