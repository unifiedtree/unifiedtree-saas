package com.hrms.api.workforce;

import com.hrms.api.hiring.ConversionOnboardingStarter;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceEmployeeResponse;
import com.unifiedtree.rbac.security.PermissionChecker;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * "Start onboarding" for people added by hand or imported (redesign BW-94).
 * Opt-in: nothing starts unless the caller asks. It then uses the hiring
 * conversion's starter unchanged ({@link ConversionOnboardingStarter#start}),
 * which picks the checklist that fits the person's department and designation.
 *
 * <p>Always called after the employee has been saved and committed, outside
 * that transaction: when no checklist fits, the caller may not start
 * onboardings, or starting fails, the new employee still stands and HR starts
 * the onboarding by hand, as for a hiring conversion.
 */
@Component
public class NewHireOnboarding {

    private static final Logger log = LoggerFactory.getLogger(NewHireOnboarding.class);
    static final String INSTANCE_WRITE = "hrms.onboarding.instance.write";

    /** What happened: STARTED (with the run), NO_CHECKLIST, NOT_ALLOWED or FAILED. */
    public enum Status { STARTED, NO_CHECKLIST, NOT_ALLOWED, FAILED }

    /** The onboarding run that was started (the web contract's {@code onboarding {instanceId, templateName}}). */
    public record Started(UUID instanceId, String templateName) {}

    public record Outcome(Status status, Started onboarding) {
        static Outcome of(Status status) { return new Outcome(status, null); }
    }

    private final ConversionOnboardingStarter starter;
    private final ObjectProvider<PermissionChecker> permissions;

    public NewHireOnboarding(ConversionOnboardingStarter starter, ObjectProvider<PermissionChecker> permissions) {
        this.starter = starter;
        this.permissions = permissions;
    }

    /** Whether the signed-in person may start onboardings (token, else the database: the hiring conversion's rule). */
    public boolean allowed() {
        if (WorkforceAccess.holds(INSTANCE_WRITE)) return true;
        PermissionChecker checker = permissions.getIfAvailable();
        try {
            return checker != null && checker.check(INSTANCE_WRITE);
        } catch (RuntimeException e) {
            log.warn("Onboarding permission lookup failed; treating it as not held: {}", e.getMessage());
            return false;
        }
    }

    /** Starts the fitting checklist for {@code employee}; never throws. */
    public Outcome start(WorkforceEmployeeResponse employee, boolean allowed) {
        if (!allowed) return Outcome.of(Status.NOT_ALLOWED);
        try {
            ConversionOnboardingStarter.Started started = starter.start(employee);
            if (started == null) return Outcome.of(Status.NO_CHECKLIST);
            return new Outcome(Status.STARTED, new Started(started.instanceId(), started.templateName()));
        } catch (RuntimeException e) {
            log.warn("Onboarding not started for new employee {}: {}", employee == null ? null : employee.id(), e.getMessage());
            return Outcome.of(Status.FAILED);
        }
    }
}
