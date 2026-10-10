package com.hrms.api.roster;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Today's answer for a person and date with no roster: the shift in force and whether it is a
 * weekly off, exactly as attendance works it out today (design §0.2). Phase 1 reads it, never
 * changes it, and never copies its rule: the only implementation is {@link BaselineScheduleAdapter},
 * over the shared shift resolver.
 */
public interface BaselineSchedule {

    /** Today's answer, no roster: for each person, one entry per date {@code from..to} (both included). */
    Map<UUID, List<BaselineDay>> between(UUID tenantId, Collection<UUID> employeeIds, LocalDate from, LocalDate to);

    /** {@code shiftPolicyId} null = no shift. */
    record BaselineDay(LocalDate date, UUID shiftPolicyId, boolean weeklyOff) {}
}
