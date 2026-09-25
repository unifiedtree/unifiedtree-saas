package com.unifiedtree.notifications.events;

import java.util.UUID;

/**
 * An employee proposed a proficiency level for one of their skills (skill
 * self-assessment, V143.21). The approver is notified: the manager whose team
 * includes the employee ({@code approverEmployeeId}), or HR when there is none.
 *
 * @param currentLevel the recorded level at proposal time; null for a new skill
 */
public record SkillAssessmentSubmittedEvent(
        UUID assessmentId,
        UUID employeeId,
        UUID tenantId,
        UUID approverEmployeeId,
        String skillName,
        int proposedLevel,
        Integer currentLevel
) {}
