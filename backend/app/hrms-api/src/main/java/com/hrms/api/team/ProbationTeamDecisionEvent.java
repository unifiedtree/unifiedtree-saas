package com.hrms.api.team;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * A manager confirmed or extended probation from Team today; {@link TeamNotifier}
 * tells the employee and HR after the commit.
 *
 * @param decision   "confirmed" or "extended"
 * @param newEndDate the new last day when extended, else null
 */
public record ProbationTeamDecisionEvent(UUID tenantId, UUID employeeId, String employeeName, String decision,
                                         String decidedBy, LocalDate newEndDate, List<UUID> hrRecipients) {
}
