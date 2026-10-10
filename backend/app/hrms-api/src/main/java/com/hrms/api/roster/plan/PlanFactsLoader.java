package com.hrms.api.roster.plan;

import java.time.LocalDate;
import java.util.Collection;
import java.util.UUID;

/** Loads the {@link PlanFacts} of one plan, in bulk (design §1.3). Implemented by package B. */
public interface PlanFactsLoader {

    /**
     * @param rosterId the roster being edited, or null for a new one (its own published days are
     *                 not "another roster")
     * @param from     the day before the period's start (for the rest check)
     * @param to       the period's end
     */
    PlanFacts load(UUID tenantId, UUID companyId, UUID rosterId, Collection<UUID> employeeIds,
                   LocalDate from, LocalDate to);
}
