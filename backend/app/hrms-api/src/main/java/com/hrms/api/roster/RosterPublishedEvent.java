package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.ChangeKind;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * A roster was published (first time or again), raised inside the publish's transaction and acted on
 * by {@link RosterNotifier} only after it commits. It carries everything the notices need, so nothing
 * is read again on the notifier's thread.
 *
 * @param periodText    "October 2026", "1 Oct – 15 Oct 2026"
 * @param from          the first day this publish wrote (today, or the roster's start when later)
 * @param to            the roster's end
 * @param hadDaysBefore people who had a published day of this roster from {@code from} on before it
 * @param haveDaysNow   people who have one now
 * @param changes       every day this publish added, changed or removed
 */
public record RosterPublishedEvent(UUID tenantId, UUID rosterId, String rosterName, String periodText,
                                   LocalDate from, LocalDate to, Set<UUID> hadDaysBefore, Set<UUID> haveDaysNow,
                                   List<Change> changes) {

    /**
     * One changed day of one person. {@code newText}: "B (Evening, 14:00–22:00)" for a shift, null for
     * a weekly off or a removed day.
     */
    public record Change(UUID employeeId, LocalDate date, ChangeKind change, String newKind, String newText) {}
}
