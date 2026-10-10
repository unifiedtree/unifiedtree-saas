package com.hrms.api.roster;

import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The one place {@link BaselineSchedule} meets the shared shift resolver (branch
 * {@code shift/p0-resolver}, design §0.2): when the resolver's API lands, only this class changes.
 *
 * <p>Contract stub: nothing calls it yet, and it refuses rather than guess, so no copy of the
 * "which shift is in force" or weekly-off rule is ever written here. Package A fills it in.
 */
@Component
public class BaselineScheduleAdapter implements BaselineSchedule {

    @Override
    public Map<UUID, List<BaselineDay>> between(UUID tenantId, Collection<UUID> employeeIds,
                                                LocalDate from, LocalDate to) {
        throw new UnsupportedOperationException("BaselineSchedule waits for the shift resolver (shift/p0-resolver)");
    }
}
