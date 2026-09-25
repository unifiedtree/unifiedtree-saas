package com.hrms.api.hiring;

import com.hrms.employee.entity.OnboardingInstance;
import com.hrms.employee.entity.OnboardingTemplate;
import com.hrms.employee.service.OnboardingService;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceEmployeeResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * After a candidate is converted into an employee, start their onboarding
 * when a checklist template clearly fits, so the hire details (offer accepted
 * date, hiring manager, recruiter, source) land on the onboarding straight
 * away. Runs in its own transaction after the conversion has committed: if
 * no template fits, or starting fails, the employee still exists and HR can
 * start the onboarding by hand.
 */
@Service
public class ConversionOnboardingStarter {

    private static final Logger log = LoggerFactory.getLogger(ConversionOnboardingStarter.class);

    private final OnboardingService onboarding;

    public ConversionOnboardingStarter(OnboardingService onboarding) {
        this.onboarding = onboarding;
    }

    public record Started(UUID instanceId, String templateName) {}

    @Transactional
    public Started start(WorkforceEmployeeResponse employee) {
        if (employee == null || employee.companyId() == null) return null;
        OnboardingTemplate template = pick(onboarding.listTemplates(employee.companyId()), employee.departmentId(), employee.designationId());
        if (template == null) return null;
        OnboardingInstance instance = onboarding.createInstanceForEmployee(employee.id(), template.getId(), employee.dateOfJoining());
        log.info("Onboarding {} started for converted employee {} with template {}", instance.getId(), employee.id(), template.getId());
        return new Started(instance.getId(), template.getName());
    }

    /**
     * Which active template fits: one for the hire's department and
     * designation, then department, then designation, then a general one (no
     * department or designation). More than one at the same level: the first
     * by name (the list comes sorted by name). Nothing fits (for example only
     * other departments' templates exist): null, and HR starts it by hand.
     */
    static OnboardingTemplate pick(List<OnboardingTemplate> templates, UUID departmentId, UUID designationId) {
        if (templates == null || templates.isEmpty()) return null;
        List<OnboardingTemplate> active = templates.stream().filter(OnboardingTemplate::isActive).toList();
        if (active.isEmpty()) return null;
        if (departmentId != null && designationId != null) {
            for (OnboardingTemplate t : active)
                if (departmentId.equals(t.getDepartmentId()) && designationId.equals(t.getDesignationId())) return t;
        }
        if (departmentId != null) {
            for (OnboardingTemplate t : active)
                if (departmentId.equals(t.getDepartmentId()) && t.getDesignationId() == null) return t;
        }
        if (designationId != null) {
            for (OnboardingTemplate t : active)
                if (designationId.equals(t.getDesignationId()) && t.getDepartmentId() == null) return t;
        }
        for (OnboardingTemplate t : active)
            if (t.getDepartmentId() == null && t.getDesignationId() == null) return t;
        return null;
    }
}
