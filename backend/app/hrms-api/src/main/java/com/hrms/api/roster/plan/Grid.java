package com.hrms.api.roster.plan;

import com.hrms.api.roster.RosterContract;
import com.hrms.api.roster.RosterContract.Overlay;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * The worked-out plan the coverage and the checks read: one row per member, one column per date of the
 * period. Built once by {@link RosterPlanner}; package-private and never changed after it is built.
 */
final class Grid {

    final List<LocalDate> dates;
    final List<UUID> members;
    /** Each member's employee record; null = not found (E2). */
    final List<PlanFacts.Person> persons;
    /** Each member's designation; null = the "No designation" bucket. */
    final List<UUID> designations;
    /** {@code tokens[m][i]}: a shift id, {@code WO} or null. */
    final String[][] tokens;
    final boolean[][] edited;
    /** Before joining or after the last working day. */
    final boolean[][] outside;
    /** What shows on top of the cell: PH, else approved leave (L / COFF). */
    final Overlay[][] overlays;
    /** Approved full-day leave (L or COFF) that day: the person does not work it. */
    final boolean[][] fullLeave;
    /** Another published roster plans this person-date. */
    final PlanFacts.OtherDay[][] other;
    /** The company has a holiday that day. */
    final boolean[] holiday;
    final PlanFacts facts;
    final UUID departmentId;
    final UUID branchId;

    Grid(List<LocalDate> dates, List<UUID> members, List<PlanFacts.Person> persons, List<UUID> designations,
         String[][] tokens, boolean[][] edited, boolean[][] outside, Overlay[][] overlays, boolean[][] fullLeave,
         PlanFacts.OtherDay[][] other, boolean[] holiday, PlanFacts facts, UUID departmentId, UUID branchId) {
        this.dates = dates;
        this.members = members;
        this.persons = persons;
        this.designations = designations;
        this.tokens = tokens;
        this.edited = edited;
        this.outside = outside;
        this.overlays = overlays;
        this.fullLeave = fullLeave;
        this.other = other;
        this.holiday = holiday;
        this.facts = facts;
        this.departmentId = departmentId;
        this.branchId = branchId;
    }

    int days() {
        return dates.size();
    }

    /** The person does not work this day although a cell may say so: a holiday, or full-day approved leave. */
    boolean dayOff(int m, int i) {
        return holiday[i] || fullLeave[m][i];
    }

    /** The member's name for messages. */
    String name(int m) {
        PlanFacts.Person p = persons.get(m);
        return p == null || p.name() == null || p.name().isBlank() ? "A person on this roster" : p.name();
    }

    static boolean isWo(String token) {
        return RosterContract.WO.equals(token);
    }

    /** The shift a token names, or null (empty, WO, unknown id or not an id). */
    PlanFacts.Shift shift(String token) {
        UUID id = shiftId(token);
        return id == null ? null : facts.shifts().get(id);
    }

    /** The shift id a token names (whether or not the shift is known), or null for empty / WO / not an id. */
    static UUID shiftId(String token) {
        if (token == null || isWo(token)) return null;
        try {
            return UUID.fromString(token);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
