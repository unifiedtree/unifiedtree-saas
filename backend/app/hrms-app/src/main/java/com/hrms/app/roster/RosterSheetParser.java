package com.hrms.app.roster;

import com.hrms.api.roster.RosterContract.Level;
import com.hrms.app.roster.RosterSheetLayout.Column;
import com.hrms.app.roster.RosterSheetLayout.Total;
import org.apache.poi.ooxml.POIXMLException;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.util.CellReference;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.MonthDay;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.format.DateTimeParseException;
import java.time.format.TextStyle;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads a roster sheet (design §1.7): an {@code .xlsx} workbook (Apache POI, as the employee import) or a
 * {@code .csv} file, laid out as {@link RosterSheetLayout} describes. Pure: bytes in, a {@link ParsedSheet} out;
 * no database, no people or shift matching (that is {@link RosterImportCheck}).
 *
 * <ul>
 *   <li>The header row is the first of the first 10 rows with an employee header ("Employee", "Name" …); rows above
 *       it (a title) are ignored. A workbook's sheet "Roster" is read when it has one, else the first sheet that
 *       has such a header.</li>
 *   <li>Day columns: 1–31 or "01"–"31" (the dates of the period, in order), real Excel dates, or text dates
 *       ("01 Oct", "1-Oct"). A day column whose date is not in the period must be empty (a day 31 in a 30-day
 *       month). Totals columns are read only to compare.</li>
 *   <li>Rows with no employee name or code are skipped when they hold only weekday letters (the row under the
 *       header) or nothing; a "Total" row is skipped too.</li>
 * </ul>
 * A file that can't be read at all (wrong type, too big, no header, no day column, too many rows) is refused with
 * 400 {@code IMPORT_FILE_INVALID}; everything else comes back as {@link Note}s with row and column.
 */
public final class RosterSheetParser {

    private RosterSheetParser() {}

    // ── result ───────────────────────────────────────────────────────────────

    /**
     * A day column. {@code date} null = not a date of the period ({@code outside} says why, for messages);
     * {@code duplicate} = a second column for a date another column already has (its cells are not read).
     */
    public record DayColumn(int index, String letter, String header, LocalDate date, String outside, boolean duplicate) {}

    /** A non-blank cell in a day column that is not a date of the period. */
    public record OutsideCell(DayColumn column, String raw) {}

    /**
     * One person row. {@code cells}: the non-blank codes of the period's dates (raw, trimmed). {@code totals}: the
     * numbers the sheet's totals columns hold (a blank or non-number total is left out).
     */
    public record SheetRow(int rowNo, String employee, String code, String department, String designation, String building,
                           Map<LocalDate, String> cells, List<OutsideCell> outside, Map<Total, Double> totals) {}

    /** A finding about the file itself; {@code rowNo} and {@code column} as Excel shows them (row 1, column A). */
    public record Note(Integer rowNo, String column, LocalDate date, String code, Level severity, String message) {}

    /**
     * {@code headerRow}: 1-based. {@code columns}: where each identity column is (missing optional ones are absent).
     * {@code dayByDate}: the column of each period date the file has.
     */
    public record ParsedSheet(String sheetName, int headerRow, Map<Column, Integer> columns, List<DayColumn> dayColumns,
                              Map<LocalDate, DayColumn> dayByDate, Map<Total, Integer> totalColumns,
                              List<SheetRow> rows, List<Note> notes) {

        /** The column letter of an identity column, or null. */
        public String letter(Column c) {
            Integer i = columns.get(c);
            return i == null ? null : RosterSheetParser.letter(i);
        }
    }

    /** One cell as read: text (numbers written without a trailing ".0"), and a date when the cell is one. */
    record Value(String text, LocalDate date, Double number) {
        static final Value BLANK = new Value("", null, null);

        static Value text(String s) {
            return new Value(s == null ? "" : s.trim(), null, null);
        }

        boolean blank() {
            return date == null && number == null && text.isBlank();
        }
    }

    // ── entry point ──────────────────────────────────────────────────────────

    /**
     * Reads {@code bytes} (named {@code fileName}) for the period {@code start..end}. Refuses an unreadable file
     * with 400 {@code IMPORT_FILE_INVALID}.
     */
    public static ParsedSheet parse(String fileName, byte[] bytes, LocalDate start, LocalDate end) {
        if (bytes == null || bytes.length == 0) throw RosterImportErrors.fileInvalid("The file is empty.");
        if (bytes.length > RosterSheetLayout.MAX_FILE_BYTES) {
            throw RosterImportErrors.fileInvalid("The file is larger than 2 MB. Remove other sheets or split it, then upload it again.");
        }
        String name = fileName == null ? "" : fileName.trim().toLowerCase(Locale.ROOT);
        if (name.endsWith(".csv")) return parseGrid("CSV", readCsv(bytes), start, end);
        if (name.endsWith(".xlsx")) return parseXlsx(bytes, start, end);
        if (name.endsWith(".xls")) {
            throw RosterImportErrors.fileInvalid("This is an old Excel file (.xls). Save it as .xlsx and upload it again.");
        }
        throw RosterImportErrors.fileInvalid("Upload an Excel file (.xlsx) or a CSV file (.csv).");
    }

    // ── xlsx ─────────────────────────────────────────────────────────────────

    private static ParsedSheet parseXlsx(byte[] bytes, LocalDate start, LocalDate end) {
        String sheetName = null;
        List<List<Value>> grid = null;
        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
            Sheet chosen = null;
            for (int s = 0; s < wb.getNumberOfSheets(); s++) {
                Sheet sheet = wb.getSheetAt(s);
                if (RosterSheetLayout.ROSTER_SHEET.equalsIgnoreCase(sheet.getSheetName().trim())
                        && headerRow(read(sheet, RosterSheetLayout.HEADER_SEARCH_ROWS)) >= 0) {
                    chosen = sheet;
                    break;
                }
            }
            for (int s = 0; chosen == null && s < wb.getNumberOfSheets(); s++) {
                Sheet sheet = wb.getSheetAt(s);
                if (RosterSheetLayout.CODES_SHEET.equalsIgnoreCase(sheet.getSheetName().trim())) continue;
                if (headerRow(read(sheet, RosterSheetLayout.HEADER_SEARCH_ROWS)) >= 0) chosen = sheet;
            }
            if (chosen != null) {
                sheetName = chosen.getSheetName();
                // Room for the header search and blank or weekday rows; more people than MAX_ROWS is refused anyway.
                grid = read(chosen, RosterSheetLayout.HEADER_SEARCH_ROWS + RosterSheetLayout.MAX_ROWS * 2 + 1);
            }
        } catch (POIXMLException | IllegalArgumentException | IllegalStateException | IOException e) {
            // A CSV or any other file renamed to .xlsx: a client error, not a server fault (as the employee import).
            throw RosterImportErrors.fileInvalid("This file can't be read as an Excel workbook (.xlsx). Save it from Excel again, or upload a CSV.");
        }
        if (grid == null) throw noHeader();
        return parseGrid(sheetName, grid, start, end);
    }

    /** The first {@code maxRows} rows of a sheet as values (formula cells give their saved result). */
    private static List<List<Value>> read(Sheet sheet, int maxRows) {
        List<List<Value>> grid = new ArrayList<>();
        int last = Math.min(sheet.getLastRowNum(), maxRows - 1);
        for (int r = 0; r <= last; r++) {
            Row row = sheet.getRow(r);
            List<Value> values = new ArrayList<>();
            if (row != null) {
                for (int c = 0; c < Math.max(0, row.getLastCellNum()); c++) values.add(value(row.getCell(c)));
            }
            grid.add(values);
        }
        return grid;
    }

    private static Value value(Cell cell) {
        if (cell == null) return Value.BLANK;
        CellType type = cell.getCellType() == CellType.FORMULA ? cell.getCachedFormulaResultType() : cell.getCellType();
        try {
            return switch (type) {
                case STRING -> Value.text(cell.getStringCellValue());
                case NUMERIC -> {
                    double n = cell.getNumericCellValue();
                    if (DateUtil.isCellDateFormatted(cell)) {
                        LocalDate d = cell.getLocalDateTimeCellValue().toLocalDate();
                        yield new Value(d.toString(), d, null);
                    }
                    yield new Value(number(n), null, n);
                }
                case BOOLEAN -> Value.text(String.valueOf(cell.getBooleanCellValue()));
                default -> Value.BLANK;
            };
        } catch (RuntimeException e) {
            return Value.BLANK;
        }
    }

    private static String number(double n) {
        if (n == Math.rint(n) && Math.abs(n) < 1e15) return Long.toString((long) n);
        return Double.toString(n);
    }

    // ── csv ──────────────────────────────────────────────────────────────────

    /** RFC 4180 records (quoted fields, doubled quotes, commas and line breaks inside quotes), UTF-8, BOM dropped. */
    static List<List<Value>> readCsv(byte[] bytes) {
        String s = new String(bytes, StandardCharsets.UTF_8);
        if (!s.isEmpty() && s.charAt(0) == '﻿') s = s.substring(1);
        List<List<Value>> out = new ArrayList<>();
        List<Value> cur = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        int n = s.length();
        for (int i = 0; i < n; i++) {
            char c = s.charAt(i);
            if (quoted) {
                if (c != '"') field.append(c);
                else if (i + 1 < n && s.charAt(i + 1) == '"') { field.append('"'); i++; }
                else quoted = false;
            } else if (c == '"') {
                quoted = true;
            } else if (c == ',') {
                cur.add(Value.text(field.toString()));
                field.setLength(0);
            } else if (c == '\n' || c == '\r') {
                if (c == '\r' && i + 1 < n && s.charAt(i + 1) == '\n') i++;
                cur.add(Value.text(field.toString()));
                field.setLength(0);
                out.add(cur);
                cur = new ArrayList<>();
            } else {
                field.append(c);
            }
        }
        if (!field.isEmpty() || !cur.isEmpty()) {
            cur.add(Value.text(field.toString()));
            out.add(cur);
        }
        return out;
    }

    // ── the layout ───────────────────────────────────────────────────────────

    /** The 0-based index of the header row among the first rows, or −1. */
    static int headerRow(List<List<Value>> grid) {
        for (int r = 0; r < Math.min(grid.size(), RosterSheetLayout.HEADER_SEARCH_ROWS); r++) {
            for (Value v : grid.get(r)) {
                if (v.date() == null && RosterSheetLayout.column(v.text()) == Column.EMPLOYEE) return r;
            }
        }
        return -1;
    }

    static ParsedSheet parseGrid(String sheetName, List<List<Value>> grid, LocalDate start, LocalDate end) {
        int h = headerRow(grid);
        if (h < 0) throw noHeader();
        List<Value> header = grid.get(h);
        List<Note> notes = new ArrayList<>();

        Map<Column, Integer> columns = new EnumMap<>(Column.class);
        Map<Total, Integer> totals = new EnumMap<>(Total.class);
        List<DayColumn> days = new ArrayList<>();
        Map<LocalDate, DayColumn> byDate = new LinkedHashMap<>();
        LocalDate cursor = start;
        for (int c = 0; c < header.size(); c++) {
            Value v = header.get(c);
            if (v.blank()) continue;
            Column col = v.date() == null ? RosterSheetLayout.column(v.text()) : null;
            if (col != null) {
                if (columns.containsKey(col)) {
                    notes.add(new Note(h + 1, letter(c), null, "COLUMN_TWICE", Level.warning, "There are two '" + v.text()
                            + "' columns (" + letter(columns.get(col)) + " and " + letter(c) + "). Column " + letter(columns.get(col)) + " is used."));
                } else {
                    columns.put(col, c);
                }
                continue;
            }
            DayHeader dh = dayHeader(v, start, end, cursor);
            if (dh != null) {
                DayColumn existing = dh.date() == null ? null : byDate.get(dh.date());
                DayColumn dc = new DayColumn(c, letter(c), v.text(), existing == null ? dh.date() : null,
                        dh.date() == null ? dh.outside() : null, existing != null);
                days.add(dc);
                if (existing != null) {
                    notes.add(new Note(h + 1, letter(c), dh.date(), "DAY_COLUMN_TWICE", Level.error, "Columns " + existing.letter()
                            + " and " + letter(c) + " are both for " + RosterImportCheck.day(dh.date()) + ". Keep one of them."));
                } else if (dh.date() != null) {
                    byDate.put(dh.date(), dc);
                    cursor = dh.date().plusDays(1);
                }
                continue;
            }
            Total t = RosterSheetLayout.total(v.text());
            if (t != null) totals.putIfAbsent(t, c);
        }
        if (days.isEmpty()) {
            throw RosterImportErrors.fileInvalid("No day columns were found next to the '" + header.get(columns.get(Column.EMPLOYEE)).text()
                    + "' header. Name them 01, 02 … 31, or with dates such as 01 Oct.");
        }
        List<LocalDate> missing = new ArrayList<>();
        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) if (!byDate.containsKey(d)) missing.add(d);
        if (!missing.isEmpty()) {
            notes.add(new Note(null, null, missing.get(0), "DAY_COLUMN_MISSING", Level.info, "The file has no column for "
                    + RosterImportCheck.ranges(missing) + "; " + (missing.size() == 1 ? "that day stays" : "those days stay") + " unplanned."));
        }

        int employeeCol = columns.get(Column.EMPLOYEE);
        Integer codeCol = columns.get(Column.CODE);
        List<SheetRow> rows = new ArrayList<>();
        for (int r = h + 1; r < grid.size(); r++) {
            List<Value> row = grid.get(r);
            if (row.stream().allMatch(Value::blank)) continue;
            String employee = text(row, employeeCol);
            String code = codeCol == null ? "" : text(row, codeCol);
            if (employee.isEmpty() && code.isEmpty()) {
                boolean weekdays = true;
                for (DayColumn dc : days) weekdays &= RosterSheetLayout.weekdayWord(text(row, dc.index()));
                if (!weekdays) {
                    notes.add(new Note(r + 1, letter(employeeCol), null, "NO_EMPLOYEE", Level.error,
                            "This row has codes but no employee name or code."));
                }
                continue;
            }
            if (code.isEmpty() && RosterSheetLayout.summaryRow(employee)) {
                notes.add(new Note(r + 1, letter(employeeCol), null, "SUMMARY_ROW", Level.info, "'" + employee + "' is a totals row; it is skipped."));
                continue;
            }
            if (rows.size() >= RosterSheetLayout.MAX_ROWS) {
                throw RosterImportErrors.fileInvalid("The file has more than " + String.format(Locale.ROOT, "%,d", RosterSheetLayout.MAX_ROWS)
                        + " rows of people. Split it into smaller files.");
            }
            Map<LocalDate, String> cells = new LinkedHashMap<>();
            List<OutsideCell> outside = new ArrayList<>();
            for (DayColumn dc : days) {
                String raw = text(row, dc.index());
                if (raw.isEmpty() || dc.duplicate()) continue;
                if (dc.date() != null) cells.put(dc.date(), raw);
                else outside.add(new OutsideCell(dc, raw));
            }
            Map<Total, Double> sums = new EnumMap<>(Total.class);
            totals.forEach((t, c) -> {
                Double n = numberAt(row, c);
                if (n != null) sums.put(t, n);
            });
            rows.add(new SheetRow(r + 1, employee, code, optional(row, columns.get(Column.DEPARTMENT)),
                    optional(row, columns.get(Column.DESIGNATION)), optional(row, columns.get(Column.BUILDING)), cells, outside, sums));
        }
        return new ParsedSheet(sheetName, h + 1, columns, days, byDate, totals, rows, notes);
    }

    /** A day header: the date of the period it names, or why it names none. */
    record DayHeader(LocalDate date, String outside) {}

    private static final Pattern DAY_NUMBER = Pattern.compile("^(\\d{1,2})$");
    /** "1 Thu", "01\nThu", "Thu 1": a day number with its weekday. */
    private static final Pattern DAY_WITH_WEEKDAY = Pattern.compile("^(?:(\\d{1,2})[\\s,/-]+([A-Za-z]{1,9})|([A-Za-z]{1,9})[\\s,/-]+(\\d{1,2}))$");
    private static final List<DateTimeFormatter> WITH_YEAR = new ArrayList<>();
    private static final List<DateTimeFormatter> WITHOUT_YEAR = new ArrayList<>();

    static {
        for (String p : RosterSheetLayout.DATE_HEADER_PATTERNS) {
            DateTimeFormatter f = new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern(p).toFormatter(Locale.ENGLISH);
            (p.contains("y") ? WITH_YEAR : WITHOUT_YEAR).add(f);
        }
    }

    /**
     * Whether a header cell is a day column, and for which date. Day numbers are read as the dates of the period in
     * order: the first date on or after {@code cursor} (the day after the previous day column) with that day of the
     * month, so 15 … 31, 1 … 14 reads as 15 Oct – 14 Nov.
     */
    static DayHeader dayHeader(Value v, LocalDate start, LocalDate end, LocalDate cursor) {
        if (v.date() != null) return inPeriod(v.date(), start, end);
        Integer n = null;
        if (v.number() != null) {
            double d = v.number();
            if (d == Math.rint(d) && d >= 1 && d <= 31) n = (int) d;
            else if (d == Math.rint(d) && d > 20000 && d < 80000) return inPeriod(DateUtil.getLocalDateTime(d).toLocalDate(), start, end);
            else return null;
        } else {
            String t = v.text().replace(' ', ' ').trim().replaceAll("\\s+", " ");
            Matcher m = DAY_NUMBER.matcher(t);
            if (m.matches()) n = Integer.parseInt(m.group(1));
            else {
                Matcher w = DAY_WITH_WEEKDAY.matcher(t);
                if (w.matches()) {
                    String num = w.group(1) != null ? w.group(1) : w.group(4);
                    String word = w.group(1) != null ? w.group(2) : w.group(3);
                    if (RosterSheetLayout.WEEKDAY_WORDS.contains(word.toLowerCase(Locale.ROOT))) n = Integer.parseInt(num);
                }
                if (n == null) {
                    LocalDate d = textDate(t, start, end);
                    if (d != null) return inPeriod(d, start, end);
                }
            }
            if (n == null || n < 1 || n > 31) return null;
        }
        for (LocalDate d = cursor.isBefore(start) ? start : cursor; !d.isAfter(end); d = d.plusDays(1)) {
            if (d.getDayOfMonth() == n) return new DayHeader(d, null);
        }
        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
            if (d.getDayOfMonth() == n) return new DayHeader(d, null);   // a second column for that date (reported)
        }
        return new DayHeader(null, "Day " + n + " isn't in the period (" + RosterImportCheck.period(start, end) + ")");
    }

    private static DayHeader inPeriod(LocalDate d, LocalDate start, LocalDate end) {
        if (d.isBefore(start) || d.isAfter(end)) {
            return new DayHeader(null, RosterImportCheck.day(d) + " isn't in the period (" + RosterImportCheck.period(start, end) + ")");
        }
        return new DayHeader(d, null);
    }

    /** A text date in one of the layout's patterns; one without a year takes the period's (the one it falls in). */
    static LocalDate textDate(String t, LocalDate start, LocalDate end) {
        for (DateTimeFormatter f : WITH_YEAR) {
            try {
                return LocalDate.parse(t, f);
            } catch (DateTimeParseException ignored) {
                // next pattern
            }
        }
        for (DateTimeFormatter f : WITHOUT_YEAR) {
            try {
                MonthDay md = MonthDay.parse(t, f);
                for (int y = start.getYear(); y <= end.getYear(); y++) {
                    if (!md.isValidYear(y)) continue;
                    LocalDate d = md.atYear(y);
                    if (!d.isBefore(start) && !d.isAfter(end)) return d;
                }
                return md.isValidYear(start.getYear()) ? md.atYear(start.getYear()) : null;
            } catch (DateTimeParseException ignored) {
                // next pattern
            }
        }
        return null;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /** "A", "B" … "AA": the column letter Excel shows. */
    static String letter(int index) {
        return CellReference.convertNumToColString(index);
    }

    private static String text(List<Value> row, int c) {
        return c < row.size() ? row.get(c).text().trim() : "";
    }

    private static String optional(List<Value> row, Integer c) {
        if (c == null) return null;
        String t = text(row, c);
        return t.isEmpty() ? null : t;
    }

    private static Double numberAt(List<Value> row, int c) {
        if (c >= row.size()) return null;
        Value v = row.get(c);
        if (v.number() != null) return v.number();
        try {
            return v.text().isBlank() ? null : Double.parseDouble(v.text().trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static com.hrms.core.exception.HrmsException noHeader() {
        return RosterImportErrors.fileInvalid("No header row was found. One of the first " + RosterSheetLayout.HEADER_SEARCH_ROWS
                + " rows needs an '" + RosterSheetLayout.header(Column.EMPLOYEE) + "' column.");
    }

    /** The weekday letter the template writes under a day header ("M", "T" …). */
    static String weekdayLetter(LocalDate d) {
        return d.getDayOfWeek().getDisplayName(TextStyle.NARROW, Locale.ENGLISH);
    }

    /** Days from {@code start} to {@code end}, both included. */
    static int days(LocalDate start, LocalDate end) {
        return (int) ChronoUnit.DAYS.between(start, end) + 1;
    }
}
