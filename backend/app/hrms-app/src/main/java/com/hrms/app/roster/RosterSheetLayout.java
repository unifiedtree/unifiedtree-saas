package com.hrms.app.roster;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The roster sheet's layout (design §1.7, D-S13): every header name, code and limit the Excel import, the
 * template and the export use, in ONE table. When the client's January file arrives, adjust the lists here
 * (plus the parser tests) and nothing else.
 *
 * <p>Until then the layout is the owner's description (S13): a title row, then a header row
 * {@code Employee | Employee code | Department | Designation | Building | 01 … 31 | Working days | WO | PH | L | COFF},
 * a row of weekday letters, then one row per person with a code in each day column. Synonyms beyond the owner's
 * list are a guess and live only here.
 *
 * <p>Header and code matching ignores case, surrounding spaces, repeated spaces and a trailing full stop.
 */
public final class RosterSheetLayout {

    private RosterSheetLayout() {}

    // ── Sheets ───────────────────────────────────────────────────────────────

    /** The sheet the template and export write, and the one the import prefers when a workbook has several. */
    public static final String ROSTER_SHEET = "Roster";
    /** The template's list of codes (the day cells' drop-down reads it). */
    public static final String CODES_SHEET = "Codes";

    // ── Limits ───────────────────────────────────────────────────────────────

    /** Largest file accepted: 2 MB. */
    public static final long MAX_FILE_BYTES = 2L * 1024 * 1024;
    /** Most person rows accepted. */
    public static final int MAX_ROWS = 2000;
    /** The header row is the first of this many rows that has an employee header. */
    public static final int HEADER_SEARCH_ROWS = 10;
    /** Most problems listed in one answer (all of them are still counted). */
    public static final int MAX_PROBLEMS_LISTED = 1000;
    /** File types read: Excel workbooks and comma-separated text. */
    public static final List<String> FILE_EXTENSIONS = List.of(".xlsx", ".csv");

    // ── Columns ──────────────────────────────────────────────────────────────

    /** What a non-day column holds. */
    public enum Column { EMPLOYEE, CODE, DEPARTMENT, DESIGNATION, BUILDING }

    /**
     * Header names per column, in the order the template writes them (the first name of each is the one written).
     * Employee is required; the others may be missing.
     */
    public static final Map<Column, List<String>> HEADERS = headers();

    private static Map<Column, List<String>> headers() {
        Map<Column, List<String>> m = new LinkedHashMap<>();
        m.put(Column.EMPLOYEE, List.of("Employee", "Employee name", "Name"));
        m.put(Column.CODE, List.of("Employee code", "Emp code", "Emp ID", "Code"));
        m.put(Column.DEPARTMENT, List.of("Department", "Dept"));
        m.put(Column.DESIGNATION, List.of("Designation", "Category"));
        m.put(Column.BUILDING, List.of("Building", "Branch", "Location", "Site"));
        return m;
    }

    /** What a totals column counts. */
    public enum Total { WORKING, WO, PH, L, COFF, ALL }

    /**
     * Totals columns (after the day columns): ignored on import and worked out again from the codes; a different
     * number in the sheet is an info line. The template writes the first header of WORKING, WO, PH, L and COFF.
     */
    public static final Map<Total, List<String>> TOTAL_HEADERS = totals();

    private static Map<Total, List<String>> totals() {
        Map<Total, List<String>> m = new LinkedHashMap<>();
        m.put(Total.WORKING, List.of("Working days", "Working", "Work days", "Days worked"));
        m.put(Total.WO, List.of("WO", "W/O", "Weekly off", "Weekly offs"));
        m.put(Total.PH, List.of("PH", "Holidays", "Holiday"));
        m.put(Total.L, List.of("L", "Leave", "Leaves"));
        m.put(Total.COFF, List.of("COFF", "Comp off", "C-OFF"));
        m.put(Total.ALL, List.of("Total", "Total days", "Days"));
        return m;
    }

    // ── Codes in the day cells ───────────────────────────────────────────────

    /** A reserved day code. Anything else is looked up among the company's active shift codes. */
    public enum Reserved { WO, PH, L, COFF }

    /**
     * The reserved codes and the spellings read as each (the first is the one written). They win over a shift with
     * the same code (the import warns once per such shift).
     */
    public static final Map<Reserved, List<String>> RESERVED_CODES = reserved();

    private static Map<Reserved, List<String>> reserved() {
        Map<Reserved, List<String>> m = new LinkedHashMap<>();
        m.put(Reserved.WO, List.of("WO", "W/O", "OFF"));
        m.put(Reserved.PH, List.of("PH"));
        m.put(Reserved.L, List.of("L"));
        m.put(Reserved.COFF, List.of("COFF", "CO", "C-OFF"));
        return m;
    }

    /** What the template's Codes sheet says each reserved code means. */
    public static final Map<Reserved, String> RESERVED_MEANING = Map.of(
            Reserved.WO, "Weekly off",
            Reserved.PH, "Holiday. The day stays unplanned; the holiday shows from Settings › Holidays",
            Reserved.L, "Leave. The day stays unplanned; approved leave shows on its own",
            Reserved.COFF, "Comp off. The day stays unplanned; approved comp-off leave shows on its own");

    // ── Rows that are not people ─────────────────────────────────────────────

    /**
     * Words a day cell may hold on a row with no employee (the weekday row under the header). Such rows are
     * skipped. The template writes the first letter of each weekday.
     */
    public static final Set<String> WEEKDAY_WORDS = Set.of(
            "m", "t", "w", "th", "f", "s", "sa", "su",
            "mo", "tu", "we", "fr",
            "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
            "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday");

    /** An employee cell that starts with one of these is a summary row at the bottom (skipped, info line). */
    public static final List<String> SUMMARY_ROW_PREFIXES = List.of("total", "grand total", "count");

    // ── Day headers ──────────────────────────────────────────────────────────

    /**
     * Text date headers read as a day column (besides 1–31 / "01"–"31" and real Excel dates). A pattern without a
     * year takes the year of the period. Patterns are {@link java.time.format.DateTimeFormatter} patterns, English
     * month names, any case.
     */
    public static final List<String> DATE_HEADER_PATTERNS = List.of(
            "yyyy-MM-dd", "d MMM", "d-MMM", "d MMM yyyy", "d-MMM-yyyy", "d-MMM-yy", "d MMM yy",
            "dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "d MMMM", "d MMMM yyyy", "MMM d", "MMM d yyyy");

    /** How the template titles a RANGE period's day columns ("01 Oct"); a MONTH period uses "01" … "31". */
    public static final String RANGE_DAY_HEADER = "dd MMM";

    // ── Matching ─────────────────────────────────────────────────────────────

    /** A header or code as compared: trimmed, lower case, single spaces, no trailing full stop. */
    public static String key(String s) {
        if (s == null) return "";
        String k = s.replace(' ', ' ').trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        while (k.endsWith(".")) k = k.substring(0, k.length() - 1).trim();
        return k;
    }

    /** The column a header names, or null. */
    public static Column column(String header) {
        String k = key(header);
        if (k.isEmpty()) return null;
        for (Map.Entry<Column, List<String>> e : HEADERS.entrySet()) {
            for (String name : e.getValue()) if (key(name).equals(k)) return e.getKey();
        }
        return null;
    }

    /** The total a header names, or null. */
    public static Total total(String header) {
        String k = key(header);
        if (k.isEmpty()) return null;
        for (Map.Entry<Total, List<String>> e : TOTAL_HEADERS.entrySet()) {
            for (String name : e.getValue()) if (key(name).equals(k)) return e.getKey();
        }
        return null;
    }

    /** The reserved code a cell holds, or null (a shift code, or blank). */
    public static Reserved reserved(String code) {
        String k = key(code);
        if (k.isEmpty()) return null;
        for (Map.Entry<Reserved, List<String>> e : RESERVED_CODES.entrySet()) {
            for (String name : e.getValue()) if (key(name).equals(k)) return e.getKey();
        }
        return null;
    }

    /** The first header name of a column: what the template writes. */
    public static String header(Column c) {
        return HEADERS.get(c).get(0);
    }

    /** The first header name of a total: what the template writes. */
    public static String header(Total t) {
        return TOTAL_HEADERS.get(t).get(0);
    }

    /** The spelling the template and export write for a reserved code. */
    public static String code(Reserved r) {
        return RESERVED_CODES.get(r).get(0);
    }

    /** Whether a cell on a row with no employee is a weekday word (or blank). */
    public static boolean weekdayWord(String cell) {
        String k = key(cell);
        return k.isEmpty() || WEEKDAY_WORDS.contains(k);
    }

    /** Whether an employee cell marks a summary row ("Total"). */
    public static boolean summaryRow(String employeeCell) {
        String k = key(employeeCell);
        for (String p : SUMMARY_ROW_PREFIXES) if (k.equals(p) || k.startsWith(p + " ") || k.startsWith(p + ":")) return true;
        return false;
    }
}
