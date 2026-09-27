package com.hrms.api.ess;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Locale;

/** Small helpers the Home sources share for reading rows. */
public final class Rows {

    private Rows() {}

    /** A timestamptz column as an instant; null stays null. */
    public static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp t = rs.getTimestamp(column);
        return t == null ? null : t.toInstant();
    }

    /** The latest of the given instants, ignoring nulls; null when all are. */
    public static Instant latest(Instant... instants) {
        Instant best = null;
        for (Instant i : instants) if (i != null && (best == null || i.isAfter(best))) best = i;
        return best;
    }

    /** "APPROVED_FOR_PAY" → "Approved for pay"; null or blank stays null. */
    public static String pretty(String code) {
        if (code == null || code.isBlank()) return null;
        String s = code.replace('_', ' ').toLowerCase(Locale.ROOT);
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
