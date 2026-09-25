package com.unifiedtree.notifications.events;

import java.util.UUID;

/**
 * A manager or HR approved or rejected an employee's proposed skill level
 * (V143.21). The employee is notified; an approval has already updated their
 * skill matrix when this fires.
 */
public record SkillAssessmentDecidedEvent(
        UUID assessmentId,
        UUID employeeId,
        UUID tenantId,
        boolean approved,
        String skillName,
        int proposedLevel,
        String decisionNote,
        String deciderName
) {}
