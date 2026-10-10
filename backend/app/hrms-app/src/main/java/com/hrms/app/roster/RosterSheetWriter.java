package com.hrms.app.roster;

import com.hrms.app.roster.RosterSheetLayout.Column;
import com.hrms.app.roster.RosterSheetLayout.Reserved;
import com.hrms.app.roster.RosterSheetLayout.Total;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.DataValidation;
import org.apache.poi.ss.usermodel.DataValidationConstraint;
import org.apache.poi.ss.usermodel.DataValidationHelper;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.util.CellRangeAddressList;
import org.apache.poi.xssf.usermodel.XSSFFormulaEvaluator;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Writes the roster sheet in the S13 layout (design §1.7): the import template (names filled in, days empty) and
 * the export of a roster (the same layout with the codes), so an export can be imported again as it is.
 *
 * <ul>
 *   <li>Sheet "Roster": row 1 a title (ignored on import), row 2 the headers
 *       ({@code Employee | Employee code | Department | Designation | Building | 01 … 31 | Working days | WO | PH | L | COFF};
 *       a date range uses headers like {@code 01 Oct}), row 3 the weekday letters (skipped on import), then one row
 *       per person. The totals are COUNTIF formulas (worked out once, so the file shows numbers even before Excel
 *       recalculates). The day cells offer a drop-down of the codes.</li>
 *   <li>Sheet "Codes": each active shift's code, name, start and end, then WO, PH, L and COFF, and the shifts that
 *       can't be used yet because they have no code.</li>
 * </ul>
 * Pure: the caller hands over everything to write; no database.
 */
public final class RosterSheetWriter {

    private RosterSheetWriter() {}

    /** A shift the Codes sheet lists. */
    public record SheetShift(String code, String name, LocalTime start, LocalTime end, boolean night) {}

    /** One person row; {@code codes} has one entry per day of the period (null = empty). */
    public record SheetPerson(String name, String code, String department, String designation, String building,
                              List<String> codes) {}

    /**
     * What to write. {@code uncodedShifts}: names of active shifts with no code (listed on the Codes sheet as not
     * usable yet). {@code holidays}: the company's holidays (their day columns are tinted). {@code spareRows}:
     * extra empty rows under the people that still offer the code drop-down (the template).
     */
    public record Spec(String title, LocalDate start, LocalDate end, List<SheetShift> shifts, List<String> uncodedShifts,
                       Map<LocalDate, String> holidays, List<SheetPerson> people, int spareRows) {}

    /** Row indexes (0-based) and the first day column. */
    static final int TITLE_ROW = 0, HEADER_ROW = 1, WEEKDAY_ROW = 2, FIRST_PERSON_ROW = 3;
    static final int FIRST_DAY_COL = RosterSheetLayout.Column.values().length;
    /** The totals the sheet writes, in order (ALL is only read). */
    static final List<Total> WRITTEN_TOTALS = List.of(Total.WORKING, Total.WO, Total.PH, Total.L, Total.COFF);

    private static final DateTimeFormatter RANGE_HEADER = DateTimeFormatter.ofPattern(RosterSheetLayout.RANGE_DAY_HEADER, Locale.ENGLISH);
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");

    public static byte[] write(Spec spec) {
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Styles st = new Styles(wb);
            Sheet roster = wb.createSheet(RosterSheetLayout.ROSTER_SHEET);
            Sheet codes = wb.createSheet(RosterSheetLayout.CODES_SHEET);
            int codeRows = writeCodes(codes, spec, st);
            writeRoster(roster, spec, st, codeRows);
            XSSFFormulaEvaluator.evaluateAllFormulaCells(wb);
            wb.setActiveSheet(0);
            wb.write(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    // ── Roster ───────────────────────────────────────────────────────────────

    private static void writeRoster(Sheet sheet, Spec spec, Styles st, int codeRows) {
        List<LocalDate> dates = new ArrayList<>();
        for (LocalDate d = spec.start(); !d.isAfter(spec.end()); d = d.plusDays(1)) dates.add(d);
        boolean month = spec.start().getDayOfMonth() == 1 && spec.end().equals(spec.start().withDayOfMonth(spec.start().lengthOfMonth()));
        int lastDayCol = FIRST_DAY_COL + dates.size() - 1;
        int firstTotalCol = lastDayCol + 1;

        Cell title = sheet.createRow(TITLE_ROW).createCell(0);
        title.setCellValue(spec.title());
        title.setCellStyle(st.title);

        Row header = sheet.createRow(HEADER_ROW);
        Row weekdays = sheet.createRow(WEEKDAY_ROW);
        int c = 0;
        for (Column col : Column.values()) {
            set(header, c, RosterSheetLayout.header(col), st.header);
            set(weekdays, c, "", st.weekday);
            sheet.setColumnWidth(c, 256 * (col == Column.EMPLOYEE ? 28 : col == Column.CODE ? 14 : 18));
            c++;
        }
        for (LocalDate d : dates) {
            boolean holiday = spec.holidays() != null && spec.holidays().containsKey(d);
            boolean weekend = d.getDayOfWeek() == DayOfWeek.SATURDAY || d.getDayOfWeek() == DayOfWeek.SUNDAY;
            CellStyle style = holiday ? st.holidayHeader : weekend ? st.weekendHeader : st.dayHeader;
            set(header, c, month ? String.format(Locale.ROOT, "%02d", d.getDayOfMonth()) : RANGE_HEADER.format(d), style);
            set(weekdays, c, RosterSheetParser.weekdayLetter(d), holiday ? st.holidayHeader : weekend ? st.weekendHeader : st.weekday);
            sheet.setColumnWidth(c, 256 * 6);
            c++;
        }
        for (Total t : WRITTEN_TOTALS) {
            set(header, c, RosterSheetLayout.header(t), st.header);
            set(weekdays, c, "", st.weekday);
            sheet.setColumnWidth(c, 256 * (t == Total.WORKING ? 13 : 7));
            c++;
        }

        int r = FIRST_PERSON_ROW;
        for (SheetPerson p : spec.people()) {
            Row row = sheet.createRow(r);
            set(row, 0, p.name(), st.text);
            set(row, 1, p.code(), st.text);
            set(row, 2, p.department(), st.text);
            set(row, 3, p.designation(), st.text);
            set(row, 4, p.building(), st.text);
            for (int i = 0; i < dates.size(); i++) {
                String code = p.codes() == null || i >= p.codes().size() ? null : p.codes().get(i);
                set(row, FIRST_DAY_COL + i, code, st.day);
            }
            totals(row, r + 1, firstTotalCol, letter(FIRST_DAY_COL) + (r + 1) + ":" + letter(lastDayCol) + (r + 1), st);
            r++;
        }
        int lastRow = r - 1 + Math.max(0, spec.spareRows());
        if (lastRow >= FIRST_PERSON_ROW && codeRows > 0) {
            DataValidationHelper helper = sheet.getDataValidationHelper();
            DataValidationConstraint list = helper.createFormulaListConstraint(
                    RosterSheetLayout.CODES_SHEET + "!$A$2:$A$" + (codeRows + 1));
            DataValidation v = helper.createValidation(list, new CellRangeAddressList(FIRST_PERSON_ROW, lastRow, FIRST_DAY_COL, lastDayCol));
            // Offer the codes but let any value in: the import checks every cell and says what is wrong where.
            v.setShowErrorBox(false);
            v.setSuppressDropDownArrow(true);   // XSSF: true shows the in-cell drop-down
            sheet.addValidationData(v);
        }
        sheet.createFreezePane(2, FIRST_PERSON_ROW);
    }

    /** The totals of one row: COUNTIF per reserved code (every spelling), working days = the rest. */
    private static void totals(Row row, int excelRow, int firstTotalCol, String range, Styles st) {
        int c = firstTotalCol;
        List<String> reservedCells = new ArrayList<>();
        for (Total t : WRITTEN_TOTALS) {
            if (t == Total.WORKING) {
                c++;
                continue;
            }
            List<String> parts = new ArrayList<>();
            for (String spelling : RosterSheetLayout.RESERVED_CODES.get(Reserved.valueOf(t.name()))) {
                parts.add("COUNTIF(" + range + ",\"" + spelling + "\")");
            }
            Cell cell = row.createCell(c);
            cell.setCellFormula(String.join("+", parts));
            cell.setCellStyle(st.total);
            reservedCells.add(letter(c) + excelRow);
            c++;
        }
        Cell working = row.createCell(firstTotalCol);
        working.setCellFormula("COUNTA(" + range + ")-" + String.join("-", reservedCells));
        working.setCellStyle(st.total);
    }

    // ── Codes ────────────────────────────────────────────────────────────────

    /** Writes the Codes sheet; returns how many code rows it has (the drop-down's list). */
    private static int writeCodes(Sheet sheet, Spec spec, Styles st) {
        Row header = sheet.createRow(0);
        set(header, 0, "Code", st.header);
        set(header, 1, "What it is", st.header);
        set(header, 2, "Start", st.header);
        set(header, 3, "End", st.header);
        sheet.setColumnWidth(0, 256 * 10);
        sheet.setColumnWidth(1, 256 * 60);
        sheet.setColumnWidth(2, 256 * 8);
        sheet.setColumnWidth(3, 256 * 8);
        int r = 1;
        for (SheetShift s : spec.shifts()) {
            Row row = sheet.createRow(r++);
            set(row, 0, s.code(), st.text);
            set(row, 1, s.name() + (s.night() ? " (night shift: it belongs to the day it starts)" : ""), st.text);
            set(row, 2, s.start() == null ? null : TIME.format(s.start()), st.text);
            set(row, 3, s.end() == null ? null : TIME.format(s.end()), st.text);
        }
        for (Reserved res : Reserved.values()) {
            Row row = sheet.createRow(r++);
            set(row, 0, RosterSheetLayout.code(res), st.text);
            List<String> spellings = RosterSheetLayout.RESERVED_CODES.get(res);
            String also = spellings.size() > 1 ? " (also " + String.join(", ", spellings.subList(1, spellings.size())) + ")" : "";
            set(row, 1, RosterSheetLayout.RESERVED_MEANING.get(res) + also, st.text);
        }
        int codeRows = r - 1;
        if (spec.uncodedShifts() != null && !spec.uncodedShifts().isEmpty()) {
            r++;
            set(sheet.createRow(r++), 1, "Shifts with no code can't be used in this sheet yet. Add a code in Shifts › Shift Schedules:", st.note);
            for (String name : spec.uncodedShifts()) set(sheet.createRow(r++), 1, name, st.text);
        }
        r++;
        set(sheet.createRow(r++), 1, "Codes can be typed in any case. A blank day stays unplanned.", st.note);
        set(sheet.createRow(r), 1, "Totals are worked out again from the codes when the file is imported.", st.note);
        return codeRows;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static void set(Row row, int c, String value, CellStyle style) {
        Cell cell = row.createCell(c);
        if (value != null && !value.isEmpty()) cell.setCellValue(value);
        if (style != null) cell.setCellStyle(style);
    }

    private static String letter(int c) {
        return RosterSheetParser.letter(c);
    }

    /** The few cell styles the sheet uses. */
    private static final class Styles {
        final CellStyle title, header, dayHeader, weekendHeader, holidayHeader, weekday, text, day, total, note;

        Styles(XSSFWorkbook wb) {
            Font bold = wb.createFont();
            bold.setBold(true);
            Font big = wb.createFont();
            big.setBold(true);
            big.setFontHeightInPoints((short) 13);
            Font grey = wb.createFont();
            grey.setItalic(true);
            grey.setColor(IndexedColors.GREY_50_PERCENT.getIndex());

            title = wb.createCellStyle();
            title.setFont(big);
            header = filled(wb, bold, IndexedColors.GREY_25_PERCENT, HorizontalAlignment.LEFT);
            dayHeader = filled(wb, bold, IndexedColors.GREY_25_PERCENT, HorizontalAlignment.CENTER);
            weekendHeader = filled(wb, bold, IndexedColors.GREY_40_PERCENT, HorizontalAlignment.CENTER);
            holidayHeader = filled(wb, bold, IndexedColors.LIGHT_ORANGE, HorizontalAlignment.CENTER);
            weekday = wb.createCellStyle();
            weekday.setAlignment(HorizontalAlignment.CENTER);
            weekday.setBorderBottom(BorderStyle.THIN);
            text = wb.createCellStyle();
            day = wb.createCellStyle();
            day.setAlignment(HorizontalAlignment.CENTER);
            total = wb.createCellStyle();
            total.setAlignment(HorizontalAlignment.CENTER);
            note = wb.createCellStyle();
            note.setFont(grey);
        }

        private static CellStyle filled(XSSFWorkbook wb, Font font, IndexedColors color, HorizontalAlignment align) {
            CellStyle s = wb.createCellStyle();
            s.setFont(font);
            s.setFillForegroundColor(color.getIndex());
            s.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            s.setAlignment(align);
            s.setBorderBottom(BorderStyle.THIN);
            return s;
        }
    }
}
