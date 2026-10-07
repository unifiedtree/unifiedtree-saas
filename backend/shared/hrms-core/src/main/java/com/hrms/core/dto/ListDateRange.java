package com.hrms.core.dto;

import com.hrms.core.exception.HrmsException;
import org.springframework.http.HttpStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;

/**
 * The optional {@code ?from=&to=} of a paged list (owner + client, 7 Oct 2026: "calendar everywhere"):
 * two India calendar days, both included. Neither = the list exactly as before ({@link #parse} answers
 * null). Each list says which of its dates the range is about (a leave's days, a claim's submitted day,
 * a settlement's last working day, ...).
 *
 * <p>Refused with 400 INVALID_DATE_RANGE and a plain message: only one of the two, a date that isn't
 * yyyy-MM-dd, a start after the end, or more than {@link #MAX_DAYS} days.
 */
public record ListDateRange(LocalDate from, LocalDate to) {

    /** The longest range a list answers, in days (both ends counted): a year, a leap year included. */
    public static final int MAX_DAYS = 366;
    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    public static final String ERROR_CODE = "INVALID_DATE_RANGE";

    /** The range of {@code ?from=&to=}; null when neither is given (the list as before). */
    public static ListDateRange parse(String from, String to) {
        boolean hasFrom = from != null && !from.isBlank();
        boolean hasTo = to != null && !to.isBlank();
        if (!hasFrom && !hasTo) return null;
        if (!hasFrom || !hasTo) throw bad("Pick both a start date and an end date, or neither.");
        LocalDate f = day(from), t = day(to);
        if (f.isAfter(t)) throw bad("The start date must be on or before the end date.");
        long days = ChronoUnit.DAYS.between(f, t) + 1;
        if (days > MAX_DAYS) throw bad("Pick " + MAX_DAYS + " days or fewer. This range is " + days + " days.");
        return new ListDateRange(f, t);
    }

    private static LocalDate day(String raw) {
        try {
            return LocalDate.parse(raw.trim());
        } catch (DateTimeParseException e) {
            throw bad("Dates must be written as yyyy-MM-dd, for example 2026-10-07.");
        }
    }

    private static HrmsException bad(String message) {
        return new HrmsException(message, HttpStatus.BAD_REQUEST, ERROR_CODE);
    }

    /** The first moment of the start day in India. */
    public Instant startsAt() { return from.atStartOfDay(IST).toInstant(); }

    /** The first moment after the end day in India (exclusive). */
    public Instant endsBefore() { return to.plusDays(1).atStartOfDay(IST).toInstant(); }

    /** {@link #startsAt()} for a JdbcTemplate argument. */
    public OffsetDateTime startsAtOffset() { return from.atStartOfDay(IST).toOffsetDateTime(); }

    /** {@link #endsBefore()} for a JdbcTemplate argument. */
    public OffsetDateTime endsBeforeOffset() { return to.plusDays(1).atStartOfDay(IST).toOffsetDateTime(); }
}
